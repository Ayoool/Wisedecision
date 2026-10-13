// ==================== WISE DECISION AUTO-LOCK PATCH (v1) ====================
// Load AFTER superadmin-patch.js.
//
// Automatically locks stores whose billing due date has passed.
// Auto-unlocks when the due date is moved to the future (i.e. payment recorded).
//
// Fields used (tries multiple names for compatibility):
//   stores/{storeId}/billingDueDate   (or dueDate, or planDueDate)
//   stores/{storeId}/locked           (bool)
//   stores/{storeId}/lockedAt         (iso)
//   stores/{storeId}/lockedReason     ("auto" | "manual")
//   stores/{storeId}/autoLockDisabled (bool — Super Admin can opt out per store)
//
// Every action is logged to superadmin/autoLockLog.

console.log("Wise Decision auto-lock-patch.js — v1 loaded");

var wdalRunning = false;
var wdalLastResult = null;

function wdalEl(id) { return document.getElementById(id); }
function wdalPad(n) { return String(n).padStart(2, '0'); }
function wdalToday() { var d = new Date(); return d.getFullYear() + '-' + wdalPad(d.getMonth()+1) + '-' + wdalPad(d.getDate()); }

function wdalGetDueDate(s) {
    return s.billingDueDate || s.dueDate || s.planDueDate || s.nextDueDate || '';
}

function wdalIsPastDue(dueDate) {
    if (!dueDate) return false;
    var today = wdalToday();
    var due = String(dueDate).substring(0, 10);
    // Lock the day AFTER the due date (so a due date of Oct 15 locks on Oct 16)
    return today > due;
}

function wdalMoney(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + (Number(n)||0).toLocaleString()); }

// ---------- Run the check ----------
async function wdalCheckAll() {
    if (wdalRunning) return;
    wdalRunning = true;

    var db = firebase.database();
    var result = { locked: [], unlocked: [], skipped: 0, errors: 0 };

    try {
        var snap = await db.ref('stores').once('value');
        var stores = snap.val() || {};

        var ids = Object.keys(stores);
        for (var i = 0; i < ids.length; i++) {
            var sid = ids[i];
            var s = stores[sid] || {};
            var due = wdalGetDueDate(s);
            var isLocked = !!s.locked;
            var pastDue = wdalIsPastDue(due);
            var optedOut = !!s.autoLockDisabled;

            try {
                // Case 1: Past due + not locked + auto-lock enabled → lock
                if (pastDue && !isLocked && !optedOut) {
                    await db.ref('stores/' + sid).update({
                        locked: true,
                        lockedAt: new Date().toISOString(),
                        lockedReason: 'auto',
                        lockedBy: 'auto-lock'
                    });
                    await db.ref('superadmin/autoLockLog').push({
                        storeId: sid,
                        storeName: s.businessName || s.name || sid,
                        action: 'locked',
                        reason: 'Billing overdue (due ' + due + ')',
                        at: new Date().toISOString()
                    });
                    result.locked.push({ storeId: sid, name: s.businessName || sid, due: due });
                }
                // Case 2: Not past due + auto-locked → unlock (payment extended the date)
                else if (!pastDue && isLocked && s.lockedReason === 'auto') {
                    await db.ref('stores/' + sid).update({
                        locked: false,
                        lockedAt: null,
                        lockedReason: null,
                        lockedBy: null,
                        unlockedAt: new Date().toISOString(),
                        unlockedReason: 'auto-unlock'
                    });
                    await db.ref('superadmin/autoLockLog').push({
                        storeId: sid,
                        storeName: s.businessName || s.name || sid,
                        action: 'unlocked',
                        reason: 'Due date extended',
                        at: new Date().toISOString()
                    });
                    result.unlocked.push({ storeId: sid, name: s.businessName || sid });
                } else {
                    result.skipped++;
                }
            } catch (e) {
                result.errors++;
            }
        }
    } catch (e) {
        result.errors++;
    }

    wdalRunning = false;
    wdalLastResult = result;
    return result;
}

// ---------- Show a summary toast ----------
function wdalShowSummary(result) {
    if (!result) return;
    var total = result.locked.length + result.unlocked.length;
    if (total === 0) return;

    var box = wdalEl('wdal-toast');
    if (!box) {
        box = document.createElement('div');
        box.id = 'wdal-toast';
        box.style.cssText = 'position:fixed; top:16px; right:16px; background:#fff; border-radius:12px; padding:16px; box-shadow:0 10px 30px rgba(15,23,42,0.18); max-width:340px; z-index:3000; border-left:4px solid #0284c7; font-size:13px;';
        document.body.appendChild(box);
    }
    var lines = [];
    if (result.locked.length) {
        lines.push('🔒 <strong>' + result.locked.length + ' store' + (result.locked.length === 1 ? '' : 's') + ' auto-locked</strong> for overdue billing:');
        result.locked.slice(0, 5).forEach(function (s) {
            lines.push('&nbsp;&nbsp;• ' + wdalEsc(s.name) + ' (due ' + wdalEsc(s.due) + ')');
        });
        if (result.locked.length > 5) lines.push('&nbsp;&nbsp;• and ' + (result.locked.length - 5) + ' more');
    }
    if (result.unlocked.length) {
        if (lines.length) lines.push('');
        lines.push('🔓 <strong>' + result.unlocked.length + ' store' + (result.unlocked.length === 1 ? '' : 's') + ' auto-unlocked</strong> (payment received):');
        result.unlocked.slice(0, 5).forEach(function (s) { lines.push('&nbsp;&nbsp;• ' + wdalEsc(s.name)); });
    }
    box.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">' +
            '<div>' + lines.join('<br>') + '</div>' +
            '<button onclick="document.getElementById(\'wdal-toast\').remove()" style="background:none; border:none; cursor:pointer; color:#64748b; font-size:16px; padding:0; margin-left:8px;">✕</button>' +
        '</div>';
    setTimeout(function () { if (box && box.parentElement) box.remove(); }, 12000);
}

function wdalEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ---------- Run once per dashboard visit ----------
var wdalRanThisSession = false;

function wdalMaybeRun() {
    // Only run when we're actually on the Super Admin dashboard
    var sa = wdalEl('super-admin-view');
    if (!sa || sa.style.display === 'none') return;

    // Only run once per page-load to avoid hammering Firebase
    if (wdalRanThisSession) return;
    wdalRanThisSession = true;

    setTimeout(async function () {
        try {
            var result = await wdalCheckAll();
            wdalShowSummary(result);
        } catch (e) { /* silent */ }
    }, 2500);
}

// ---------- Manual trigger (for the button you can add later) ----------
window.wdalRunNow = async function () {
    wdalRanThisSession = false;
    var result = await wdalCheckAll();
    wdalShowSummary(result);
    alert('Auto-lock check complete.\n\nLocked: ' + result.locked.length + '\nUnlocked: ' + result.unlocked.length + '\nSkipped: ' + result.skipped);
};

window.addEventListener('load', function () {
    setTimeout(wdalMaybeRun, 2000);
    // Some SPAs switch views without reloading — watch for it
    var obs = new MutationObserver(function () {
        if (wdalEl('super-admin-view') && wdalEl('super-admin-view').style.display !== 'none') wdalMaybeRun();
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
});
