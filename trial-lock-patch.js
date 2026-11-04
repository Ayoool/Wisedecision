// ==================== WISE DECISION TRIAL LOCK PATCH (v2) ====================
// Load AFTER payments-patch.js, payments-auto-patch.js, activation-patch.js and auto-lock-patch.js
// (and before vertical-first-patch.js).
//
// auto-lock-patch.js ALREADY locks any store whose billing/<store>/dueDate has arrived (a trial's due date is its
// end date). This patch adds the two things that were missing:
//
//   1. STORES WITH NO BILLING RECORD YET. A new store's trial record is only created when the Super Admin opens the
//      dashboard (the owner's own write is blocked by the database rules). Until then auto-lock sees nothing, so
//      the store could use the app free forever. This patch works the trial end out from the activation code the
//      store registered with (usedAt + trialDays) and shows a full-screen "Subscribe to continue" page.
//      Stores that DO have a billing date are left to auto-lock-patch.js (no double lock).
//   2. CHOOSE ANY PLAN. A "Choose your plan" screen (every plan, monthly or yearly) opens from the lock page, and a
//      "Compare & choose a plan" button is added to the subscription form of trial stores. Trial stores no longer
//      see "Keep my current arrangement" (there is nothing to keep): they must pick a plan.
//
// If anything cannot be read (offline, permission), the app is NOT locked by this patch.
// Super Admin is never affected. This is a screen lock; real enforcement needs Firebase database rules.

console.log("Wise Decision trial-lock-patch.js — v2 loaded");

// Days after the trial end date before the lock appears. 0 = locks ON the end date (same as auto-lock-patch.js).
var WDT_TRIAL_GRACE_DAYS = 0;
var WDT_RECHECK_MS = 60000;

var wdtLastCheck = 0, wdtCheckedFor = null, wdtLocked = null, wdtChecking = false;

function wdtEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdtPad(n) { return String(n).padStart(2, '0'); }
function wdtToday() { var d = new Date(); return d.getFullYear() + '-' + wdtPad(d.getMonth() + 1) + '-' + wdtPad(d.getDate()); }
function wdtIsDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function wdtDayMs(s) { var p = String(s).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function wdtDaysPast(endDay) { return Math.round((wdtDayMs(wdtToday()) - wdtDayMs(endDay)) / 86400000); }   // >0 = days after the end date
function wdtPretty(s) {
    var d = new Date(String(s) + 'T00:00:00Z');
    return isNaN(d) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function wdtTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
        promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
}
function wdtRole() { return (typeof currentUserRole !== 'undefined' && currentUserRole) ? String(currentUserRole).replace(/\s+/g, '').toLowerCase() : ''; }
function wdtRead(path) { return wdtTimeout(firebase.database().ref(path).once('value'), 12000).then(function (s) { return s.val(); }); }

// The store the person is logged in to (null on the login screen / Super Admin)
function wdtStore() {
    var wrap = document.getElementById('dashboard-main-wrapper');
    var sid = (typeof currentStoreId !== 'undefined') ? currentStoreId : null;
    var role = wdtRole();
    if (!wrap || !wrap.classList.contains('active') || !sid || sid === 'SUPER_ADMIN' || !role || role === 'superadmin') return null;
    return sid;
}

// Returns { lock, endDate, overBy }. Never throws; anything unknown means "do not lock".
async function wdtEvaluate(sid) {
    // 1) Does the store have a billing date? If yes, auto-lock-patch.js handles it. If we cannot even read it, do nothing.
    try {
        var due = await wdtRead('billing/' + sid + '/dueDate');
        if (wdtIsDay(due)) return { lock: false };
    } catch (e) { return { lock: false }; }

    // 2) No billing record yet: work the trial out from the activation code the store registered with.
    try {
        if (typeof wdaHash !== 'function' || typeof wdaAddDays !== 'function' || typeof wdaLocalDateStr !== 'function') return { lock: false };
        var code = await wdtRead('stores/' + sid + '/activationCode');
        if (!code) return { lock: false };
        var rec = await wdtRead('activationCodes/' + (await wdaHash(code)));
        var days = rec ? Number(rec.trialDays) || 0 : 0;
        if (!rec || days <= 0 || !rec.usedAt) return { lock: false };
        var end = wdaAddDays(wdaLocalDateStr(new Date(rec.usedAt)), days);
        if (!wdtIsDay(end)) return { lock: false };
        var over = wdtDaysPast(end);
        return { lock: over >= WDT_TRIAL_GRACE_DAYS, endDate: end, overBy: over };
    } catch (e) { return { lock: false }; }
}

// ---------- the lock page ----------
function wdtHide() {
    var o = document.getElementById('wdt-lock');
    if (o) o.remove();
    if (document.body && document.body.dataset.wdtScroll === '1') { document.body.style.overflow = ''; delete document.body.dataset.wdtScroll; }
}

function wdtShow(info) {
    if (document.body.classList.contains('wdal-locked')) return;   // auto-lock is already showing
    var isAdmin = wdtRole() === 'admin';
    var sid = (typeof currentStoreId !== 'undefined') ? currentStoreId : '';
    var sig = info.endDate + '|' + info.overBy + '|' + (isAdmin ? 'a' : 'o');
    var o = document.getElementById('wdt-lock');
    if (o && o.dataset.sig === sig) return;
    if (!o) {
        o = document.createElement('div');
        o.id = 'wdt-lock';
        document.body.appendChild(o);
    }
    o.dataset.sig = sig;
    o.style.cssText = 'position:fixed; inset:0; z-index:1400; background:rgba(15,23,42,.94); display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; overflow-y:auto;';
    if (document.body.dataset.wdtScroll !== '1') { document.body.style.overflow = 'hidden'; document.body.dataset.wdtScroll = '1'; }

    var support = (typeof WDP_SUPPORT_WA !== 'undefined' && WDP_SUPPORT_WA) || '2349168140710';
    var waLink = 'https://wa.me/' + support + '?text=' + encodeURIComponent('Hello, my Wise Decision free trial has ended and I want to subscribe. Store ID: ' + sid);
    var ago = info.overBy <= 0 ? 'today' : info.overBy + ' day' + (info.overBy === 1 ? '' : 's') + ' ago';

    o.innerHTML =
        '<div style="background:#fff; color:#0f172a; border-radius:20px; width:100%; max-width:420px; padding:26px 22px; box-sizing:border-box; text-align:center; border-top:5px solid #14b8a6;">' +
            '<div style="font-size:42px; margin-bottom:6px;">🔒</div>' +
            '<h2 style="margin:0 0 8px; font-size:20px;">Your free trial has ended</h2>' +
            '<div style="font-size:13px; color:#64748b; margin-bottom:14px;">It ended on <strong>' + wdtEsc(wdtPretty(info.endDate)) + '</strong> (' + wdtEsc(ago) + ').<br>' +
            (isAdmin ? 'Subscribe to keep using Wise Decision. Your stock, sales and customers are safe and come back as soon as you pay.'
                     : 'Please ask the owner of this business to subscribe. Everything is safe and works again as soon as they pay.') + '</div>' +
            (isAdmin ? '<button id="wdt-sub" style="width:100%; padding:15px; border:none; border-radius:12px; font-size:16px; font-weight:800; color:#fff; background:linear-gradient(135deg,#14b8a6 0%,#0284c7 100%); cursor:pointer; margin-bottom:8px;">💳 Subscribe now</button>' +
                       '<button id="wdt-again" style="width:100%; padding:12px; border:1px solid #cbd5e1; border-radius:12px; font-size:14px; font-weight:700; background:#f8fafc; cursor:pointer; margin-bottom:8px;">↻ I have paid — check again</button>' : '') +
            '<a href="' + waLink + '" target="_blank" rel="noopener" style="display:block; padding:12px; border:1px solid #bbf7d0; border-radius:12px; font-size:14px; font-weight:700; background:#f0fdf4; color:#166534; text-decoration:none; margin-bottom:8px;">💬 Chat with support</a>' +
            '<button id="wdt-out" style="width:100%; padding:12px; border:1px solid #fecaca; border-radius:12px; font-size:14px; font-weight:700; background:#fef2f2; color:#b91c1c; cursor:pointer;">Logout</button>' +
        '</div>';

    var sub = document.getElementById('wdt-sub');
    if (sub) sub.onclick = async function () {
        if (typeof wdpOpenRenew !== 'function') { alert('The subscription screen is not available. Please use the support link.'); return; }
        await wdpOpenRenew(sid);
        // let them choose ANY plan, monthly or yearly
        try { if (typeof wdpCtx !== 'undefined' && wdpCtx && wdpCtx.id === sid && typeof wdpSortedPlanIds === 'function' && wdpSortedPlanIds(wdpCtx.plans).length > 0) wdtOpenPlanPicker(); } catch (e) { console.warn(e); }
    };
    var again = document.getElementById('wdt-again');
    if (again) again.onclick = function () {
        again.textContent = 'Checking…';
        wdtLastCheck = 0;
        wdtTick(true).then(function () { var a = document.getElementById('wdt-again'); if (a) a.textContent = '↻ I have paid — check again'; });
    };
    var out = document.getElementById('wdt-out');
    if (out) out.onclick = function () {
        var wrap = document.getElementById('dashboard-main-wrapper');
        var btn = (wrap && typeof wdpFindShownButton === 'function') ? wdpFindShownButton(wrap, function (t) { return /logout$/.test(t); }) : null;
        if (btn) { btn.click(); return; }
        try { firebase.auth().signOut().then(function () { location.reload(); }, function () { location.reload(); }); } catch (e) { location.reload(); }
    };
}

// ---------- choose ANY plan ----------
function wdtLimitText(p) {
    var u = function (n) { return Number(n) > 0 ? String(Number(n)) : 'unlimited'; };
    return u(p.maxBranches) + ' branch' + (Number(p.maxBranches) === 1 ? '' : 'es') + ' · ' + u(p.maxStaff) + ' staff · ' + u(p.maxProducts) + ' products';
}
function wdtMoney(n) { return typeof wdpMoney === 'function' ? wdpMoney(n) : '₦' + (Number(n) || 0).toLocaleString(); }

function wdtOpenPlanPicker() {
    var c = wdpCtx;
    if (!c || typeof wdpModal !== 'function') return;
    var ids = wdpSortedPlanIds(c.plans);
    var cards = ids.map(function (pid) {
        var p = c.plans[pid], yf = Number(p.yearlyFee) || 0, save = (Number(p.monthlyFee) || 0) * 12 - yf, e = wdtEsc(pid);
        return '<div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px; margin-bottom:10px;">' +
            '<div style="font-weight:800; font-size:15px;">' + wdtEsc(p.name) + '</div>' +
            '<div style="font-size:12px; color:#475569; margin:4px 0 8px;">' + wdtEsc(wdtLimitText(p)) + '</div>' +
            '<div style="display:flex; gap:8px;">' +
                '<button data-id="' + e + '" data-cy="monthly" onclick="wdtChoose(this.dataset.id, this.dataset.cy)" style="flex:1; padding:10px 6px; border:none; border-radius:10px; background:#0284c7; color:#fff; font-weight:800; font-size:13px; cursor:pointer;">' + wdtMoney(p.monthlyFee) + '<br><span style="font-weight:500; font-size:11px;">per month</span></button>' +
                (yf > 0 ? '<button data-id="' + e + '" data-cy="yearly" onclick="wdtChoose(this.dataset.id, this.dataset.cy)" style="flex:1; padding:10px 6px; border:none; border-radius:10px; background:#16a34a; color:#fff; font-weight:800; font-size:13px; cursor:pointer;">' + wdtMoney(yf) + '<br><span style="font-weight:500; font-size:11px;">per year' + (save > 0 ? ' · save ' + wdtMoney(save) : '') + '</span></button>' : '') +
            '</div></div>';
    }).join('');
    wdpModal('Choose your plan', '<div style="font-size:12px; color:#64748b; margin-bottom:10px;">Pick any plan. You can change it later.</div>' + cards +
        '<button class="menu-btn" style="margin:0; justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdpRenderRenew()">Skip — use the normal form</button>');
}
window.wdtOpenPlanPicker = wdtOpenPlanPicker;

window.wdtChoose = function (pid, cycle) {
    if (typeof wdpRenderRenew !== 'function') return;
    wdpRenderRenew();
    var sel = document.getElementById('wdp-plan'), cy = document.getElementById('wdp-cycle'), form = document.getElementById('wdp-form');
    if (sel) sel.value = pid;
    if (cy) cy.value = cycle === 'yearly' ? 'yearly' : 'monthly';
    if (form) form.style.display = '';
    if (typeof wdpRecalc === 'function') wdpRecalc();
    if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// On a trial store the plan list must not offer "Keep my current arrangement" (there is nothing to keep): they pick a plan.
(function () {
    var orig = window.wdpRenderRenew;
    if (typeof orig !== 'function' || orig.__wdt) return;
    var wrapped = function () {
        var r = orig.apply(this, arguments);
        try {
            var c = (typeof wdpCtx !== 'undefined') ? wdpCtx : null;
            if (c && ((c.billing && c.billing.trial) || wdtLocked)) {
                var sel = document.getElementById('wdp-plan');
                if (sel) {
                    var keep = sel.querySelector('option[value=""]');
                    if (keep) keep.remove();
                    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
                    if (typeof wdpRecalc === 'function') wdpRecalc();
                    var form = document.getElementById('wdp-form');
                    if (form && !document.getElementById('wdt-compare')) {
                        var b = document.createElement('button');
                        b.id = 'wdt-compare';
                        b.textContent = '📋 Compare & choose a plan';
                        b.style.cssText = 'width:100%; margin-bottom:10px; padding:10px; font-size:13px; font-weight:bold; border-radius:8px; cursor:pointer; border:1px solid #bae6fd; background:#f0f9ff; color:#0369a1;';
                        b.onclick = function () { wdtOpenPlanPicker(); };
                        form.parentNode.insertBefore(b, form);
                    }
                }
            }
        } catch (e) { console.warn(e); }
        return r;
    };
    wrapped.__wdt = true;
    window.wdpRenderRenew = wrapped;
})();

// ---------- the loop ----------
async function wdtTick(force) {
    var sid = wdtStore();
    if (!sid) { wdtHide(); wdtCheckedFor = null; wdtLocked = null; return; }

    if (wdtCheckedFor !== sid) { wdtLocked = null; wdtHide(); }
    var due = force || wdtCheckedFor !== sid || (Date.now() - wdtLastCheck > WDT_RECHECK_MS);
    if (due && !wdtChecking) {
        wdtChecking = true; wdtLastCheck = Date.now(); wdtCheckedFor = sid;
        try {
            var r = await wdtEvaluate(sid);
            if (sid === wdtStore()) wdtLocked = r && r.lock ? r : null;
        } catch (e) { /* keep the previous state */ }
        wdtChecking = false;
    }
    if (sid !== wdtStore()) return;
    if (wdtLocked) wdtShow(wdtLocked); else wdtHide();
}

window.addEventListener('load', function () { setTimeout(function () { wdtTick(false).catch(function () {}); }, 1500); });
setInterval(function () { wdtTick(false).catch(function () {}); }, 4000);
