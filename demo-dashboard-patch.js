// ==================== WISE DECISION DEMO DASHBOARD PATCH (v2) ====================
// Load AFTER superadmin-patch.js and AFTER email-auth-patch.js.
//
// Lets the Super Admin preview any business-type dashboard (Fashion, Phone Vendor,
// Water, Materials, Pharmacy, etc.) without registering a real store for each.
//
// How it works:
//   • Creates one hidden demo store at stores/__demo__ on first use
//   • When you pick a type, the demo store's storeType is set, then the app
//     switches into it — the same way a real login would
//   • A purple banner stays on top with a dropdown to switch types instantly
//   • Click "Exit demo" to return to the Super Admin dashboard
//
// v2 FIXES
//   * Waits for the Firebase sign-in to be ready (no more "null is not an object ... currentUser.uid").
//   * Checks that the signed-in account is listed under admins/ BEFORE touching stores/__demo__, and says
//     exactly which account is signed in if it is not (instead of a bare "permission_denied").
//   * The "switch type" dropdown in the banner works again (inside the demo you are the store's Admin, so the
//     old "Only Super Admin" check blocked it).
//   * "Wipe demo data" also clears the phone paths your database rules actually use.
//
// Nothing is written to your real stores. Demo data lives only under
// stores/__demo__ and can be wiped any time with the "Wipe demo data" button.

console.log("Wise Decision demo-dashboard-patch.js — v2 loaded");

var wddemo = {
    active: false,
    storeId: '__demo__',
    currentType: null,
    currentLabel: null
};

// ---------- Verticals available to preview ----------
// storeType slugs are best-guesses based on each patch's filter logic.
// If a dashboard doesn't activate, use the "Custom type" field to test a different slug.
var WDDEMO_VERTICALS = [
    { type: 'retail',       label: 'Retail / Provision Store', icon: '🛒' },
    { type: 'fashion',      label: 'Fashion / Boutique',        icon: '👗' },
    { type: 'phone_vendor', label: 'Phone Vendor / Phone Shop', icon: '📱' },
    { type: 'pharmacy',     label: 'Pharmacy / Chemist',        icon: '💊' },
    { type: 'restaurant',   label: 'Restaurant / Food',         icon: '🍽️' },
    { type: 'materials',    label: 'Hardware / Building',       icon: '🏗️' },
    { type: 'stationery',   label: 'Stationery / Bookshop',     icon: '📚' },
    { type: 'water',        label: 'Water / Drinks Distributor', icon: '💧' },
    { type: 'cosmetics',    label: 'Cosmetics Shop',            icon: '🎨' }
];

function wddemoEl(id) { return document.getElementById(id); }
function wddemoEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// Inside a demo you are signed in as the demo store's Admin, so "Super Admin" also means "a demo is running".
// (Writes are still protected by the database rules, which only allow admins/ accounts to touch stores/__demo__.)
function wddemoIsSuper() {
    if (wddemo.active) return true;
    return typeof currentUserRole !== 'undefined' && currentUserRole === 'SuperAdmin';
}

// =====================================================================
// SIGN-IN HELPERS (v2)
// =====================================================================
// Wait (up to 4 seconds) for Firebase to restore the signed-in user.
function wddemoWaitUser() {
    return new Promise(function (resolve) {
        var a;
        try { a = firebase.auth(); } catch (e) { resolve(null); return; }
        if (a.currentUser) { resolve(a.currentUser); return; }
        var done = false, off = null;
        function finish(u) {
            if (done) return;
            done = true;
            try { if (off) off(); } catch (e) {}
            resolve(u || a.currentUser || null);
        }
        off = a.onAuthStateChanged(function (u) { if (u) finish(u); });
        setTimeout(function () { finish(null); }, 4000);
    });
}

// True only if this account is listed as true under admins/<uid>
async function wddemoIsAdminUser(user) {
    try {
        var snap = await firebase.database().ref('admins/' + user.uid).once('value');
        return snap.val() === true;
    } catch (e) { return false; }
}

// Returns the signed-in Super Admin user, or null after telling the person what is wrong.
async function wddemoRequireAdmin() {
    var user = await wddemoWaitUser();
    if (!user) {
        alert('You are not signed in with Firebase right now.\n\nTap "Logout / Exit", then sign in again with your Super Admin email and password.');
        return null;
    }
    var ok = await wddemoIsAdminUser(user);
    if (!ok) {
        alert('This sign-in (' + (user.email || user.uid) + ') is not listed as a Super Admin in the database, so Firebase blocks the demo store.\n\nTap "Logout / Exit" and sign in with your own Super Admin email and password.');
        return null;
    }
    return user;
}

// =====================================================================
// ENSURE DEMO STORE EXISTS
// =====================================================================
async function wddemoEnsureStore(storeType, businessName) {
    var db = firebase.database();
    var ref = db.ref('stores/' + wddemo.storeId);
    var updates = {
        storeType: storeType,
        businessName: businessName,
        isDemo: true,
        updatedAt: new Date().toISOString()
    };
    var snap = await ref.once('value');
    if (!snap.exists()) {
        updates.createdAt = new Date().toISOString();
        // Also create a minimal branch so the store loads cleanly
        await ref.set(updates);
        try {
            await db.ref('stores/' + wddemo.storeId + '/branches/main').set({
                name: 'Demo Branch',
                address: 'Demo',
                phone: ''
            });
        } catch (e) { /* non-fatal */ }
    } else {
        await ref.update(updates);
    }
}

// =====================================================================
// ENTER DEMO MODE
// =====================================================================
window.wddemoEnter = async function (storeType, label, icon) {
    if (!wddemoIsSuper()) { alert('Only Super Admin can use Demo Mode.'); return; }

    var type = String(storeType || '').trim().toLowerCase();
    if (!type) return;

    try {
        var user = await wddemoRequireAdmin();
        if (!user) return;

        var businessName = 'DEMO — ' + (label || type);
        await wddemoEnsureStore(type, businessName);

        wddemo.active = true;
        wddemo.currentType = type;
        wddemo.currentLabel = label || type;

        // Switch state via the same path a normal login uses
        if (typeof wdaeCompleteLogin === 'function') {
            wdaeCompleteLogin({
                kind: 'member',
                uid: user.uid,
                email: user.email,
                storeId: wddemo.storeId,
                storeName: businessName,
                role: 'Admin',
                branchId: 'main',
                name: 'Super Admin (demo)'
            });
        } else {
            wddemo.active = false;
            alert('Cannot enter demo mode — email-auth-patch.js is not loaded.');
            return;
        }

        // Close any open modal
        var mod = wddemoEl('wddemo-modal');
        if (mod) mod.remove();

        // Show the banner after the dashboard renders
        setTimeout(wddemoShowBanner, 250);

    } catch (e) {
        var msg = (e && e.message) || String(e);
        if (/permission_denied/i.test(msg)) {
            msg += '\n\nThe database rules refused this. Make sure you are signed in with your Super Admin email (listed under admins/).';
        }
        alert('Could not enter demo mode: ' + msg);
    }
};

// =====================================================================
// EXIT DEMO MODE
// =====================================================================
window.wddemoExit = async function () {
    if (!wddemo.active) return;
    if (!confirm('Exit demo mode and return to Super Admin?')) return;

    // Hide banner
    var banner = wddemoEl('wddemo-banner');
    if (banner) banner.remove();

    // Remove any store-specific sidebar buttons so they don't linger
    ['wdf-sidebar-btn', 'wdph-sidebar-btn', 'wdw-sidebar-btn', 'wdm-sidebar-btn',
     'wdphv-sidebar-btn', 'wdmr-sidebar-btn', 'wddemo-sidebar-btn'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) b.remove();
    });

    wddemo.active = false;
    wddemo.currentType = null;
    wddemo.currentLabel = null;

    var user = await wddemoWaitUser();
    if (typeof wdaeCompleteLogin === 'function' && user) {
        wdaeCompleteLogin({
            kind: 'super',
            uid: user.uid,
            email: user.email
        });
    } else {
        window.location.reload();
    }
};

// =====================================================================
// SWITCH TYPE WHILE STILL IN DEMO MODE
// =====================================================================
window.wddemoSwitch = async function (storeType) {
    if (!wddemo.active) return;
    var v = null;
    for (var i = 0; i < WDDEMO_VERTICALS.length; i++) {
        if (WDDEMO_VERTICALS[i].type === storeType) { v = WDDEMO_VERTICALS[i]; break; }
    }
    if (!v) return;
    await wddemoEnter(v.type, v.label, v.icon);
};

// =====================================================================
// WIPE DEMO DATA
// =====================================================================
window.wddemoWipe = async function () {
    if (!wddemoIsSuper()) return;
    if (!confirm('Delete ALL demo data? This clears everything under the hidden demo store.\n\nReal stores are not affected.')) return;
    try {
        var db = firebase.database();
        var id = wddemo.storeId;
        await db.ref('stores/' + id).remove();
        // Per-store data nodes (a node that does not exist, or is not allowed by the rules, is simply skipped)
        var nodes = ['fashionItems', 'fashionSales', 'fashionLayaways', 'fashionCategories', 'fashionStockLog', 'fashionCounters',
                     'phoneInventory', 'phoneSales', 'phoneCounters', 'phoneRepairs', 'phoneItems',
                     'materialsItems', 'materialsSales', 'waterItems', 'waterSales', 'waterCustomers', 'waterCounters'];
        for (var i = 0; i < nodes.length; i++) {
            try { await db.ref(nodes[i] + '/' + id).remove(); } catch (e) { /* skip */ }
        }
        alert('✅ Demo data wiped.');
    } catch (e) {
        alert('Could not wipe demo data: ' + (e.message || e));
    }
};

// =====================================================================
// BANNER (stays on top while in demo mode)
// =====================================================================
function wddemoShowBanner() {
    if (wddemoEl('wddemo-banner')) return;
    var wrapper = document.getElementById('dashboard-main-wrapper');
    if (!wrapper) return;

    var options = WDDEMO_VERTICALS.map(function (v) {
        return '<option value="' + wddemoEsc(v.type) + '"' + (v.type === wddemo.currentType ? ' selected' : '') + '>' +
            v.icon + ' ' + wddemoEsc(v.label) + '</option>';
    }).join('');

    var banner = document.createElement('div');
    banner.id = 'wddemo-banner';
    banner.style.cssText =
        'position:sticky; top:0; z-index:1500; background:linear-gradient(90deg,#7c3aed,#4c1d95); ' +
        'color:#fff; padding:10px 16px; display:flex; justify-content:space-between; align-items:center; ' +
        'gap:12px; flex-wrap:wrap; box-shadow:0 2px 8px rgba(0,0,0,0.15); font-size:13px;';
    banner.innerHTML =
        '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
            '<strong>🎨 DEMO MODE</strong>' +
            '<select onchange="wddemoSwitch(this.value)" style="padding:6px 10px; border-radius:6px; border:none; font-size:12px; font-family:inherit;">' + options + '</select>' +
            '<span style="opacity:0.85;">Data is shared with all demos — real stores are not affected.</span>' +
        '</div>' +
        '<div style="display:flex; gap:8px;">' +
            '<button onclick="wddemoWipe()" style="padding:6px 12px; background:transparent; color:#fff; border:1px solid rgba(255,255,255,0.4); border-radius:6px; cursor:pointer; font-size:12px;">🗑 Wipe demo data</button>' +
            '<button onclick="wddemoExit()" style="padding:6px 14px; background:#fff; color:#4c1d95; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;">⏻ Exit demo</button>' +
        '</div>';

    wrapper.insertBefore(banner, wrapper.firstChild);
}

// =====================================================================
// PICKER MODAL
// =====================================================================
window.wddemoOpenPicker = function () {
    if (!wddemoIsSuper()) { alert('Only Super Admin can open Demo Mode.'); return; }

    var mod = document.createElement('div');
    mod.id = 'wddemo-modal';
    mod.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; justify-content:center; align-items:flex-start; z-index:1800; padding:20px; box-sizing:border-box; overflow-y:auto;';

    var tiles = WDDEMO_VERTICALS.map(function (v) {
        return '<button data-type="' + wddemoEsc(v.type) + '" data-label="' + wddemoEsc(v.label) + '" data-icon="' + wddemoEsc(v.icon) + '" ' +
            'class="wddemo-pick" style="padding:16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; text-align:left; cursor:pointer; font-family:inherit; display:flex; align-items:center; gap:10px;">' +
                '<span style="font-size:22px;">' + v.icon + '</span>' +
                '<span>' +
                    '<span style="display:block; font-weight:bold; font-size:13px; color:#0f172a;">' + wddemoEsc(v.label) + '</span>' +
                    '<span style="display:block; font-size:11px; color:#64748b; margin-top:2px;">storeType: ' + wddemoEsc(v.type) + '</span>' +
                '</span>' +
            '</button>';
    }).join('');

    mod.innerHTML = '<div style="background:#fff; border-radius:14px; max-width:600px; width:100%; padding:20px; box-sizing:border-box; margin:auto; max-height:92vh; overflow-y:auto; color:#0f172a;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">' +
            '<h3 style="margin:0; font-size:17px;">🎨 Preview a Dashboard</h3>' +
            '<button onclick="document.getElementById(\'wddemo-modal\').remove()" style="width:auto; padding:6px 12px; border:none; background:#f1f5f9; border-radius:8px; cursor:pointer;">✕</button>' +
        '</div>' +
        '<p style="font-size:12px; color:#64748b; margin:0 0 14px;">Pick a business type to see how its dashboard, sidebar, and features look. Nothing here touches your real stores.</p>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' + tiles + '</div>' +
        '<div style="margin-top:18px; padding-top:14px; border-top:1px solid #e2e8f0;">' +
            '<div style="font-size:12px; font-weight:bold; color:#334155; margin-bottom:6px;">Custom store type</div>' +
            '<div style="font-size:11px; color:#64748b; margin-bottom:8px;">If a slug above doesn\'t activate the dashboard you expected, try a different one here.</div>' +
            '<div style="display:flex; gap:8px;">' +
                '<input id="wddemo-custom" type="text" placeholder="e.g. phone_sales" style="flex:1; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;">' +
                '<button onclick="wddemoEnterCustom()" style="padding:10px 16px; background:#7c3aed; color:#fff; border:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:12px;">Test</button>' +
            '</div>' +
        '</div>' +
    '</div>';
    document.body.appendChild(mod);

    mod.querySelectorAll('.wddemo-pick').forEach(function (btn) {
        btn.onclick = function () {
            window.wddemoEnter(
                btn.getAttribute('data-type'),
                btn.getAttribute('data-label'),
                btn.getAttribute('data-icon')
            );
        };
    });
};

window.wddemoEnterCustom = function () {
    var inp = wddemoEl('wddemo-custom');
    var v = inp ? (inp.value || '').trim().toLowerCase() : '';
    if (!v) { alert('Type a store type first.'); return; }
    window.wddemoEnter(v, 'Custom: ' + v, '🧪');
};

// =====================================================================
// HEADER BUTTON
// =====================================================================
function wddemoInjectHeaderButton() {
    if (!wddemoIsSuper()) return;
    if (wddemo.active) return;   // inside a demo there is no Super Admin header to put it in
    if (wddemoEl('wddemo-header-btn')) return;

    var anchor = null;
    document.querySelectorAll('button').forEach(function (b) {
        var t = (b.textContent || '').trim();
        if (t.indexOf('Activation codes') !== -1 && !anchor) anchor = b;
    });
    if (!anchor) return;

    var btn = document.createElement('button');
    btn.id = 'wddemo-header-btn';
    btn.className = anchor.className || 'menu-btn';
    btn.style.cssText = 'width:auto; margin:0; background:#7c3aed; color:#fff; padding:8px 14px; border-radius:8px; font-weight:bold; cursor:pointer;';
    btn.textContent = '🎨 Preview Dashboards';
    btn.onclick = window.wddemoOpenPicker;
    anchor.parentElement.insertBefore(btn, anchor.nextSibling);
}

// =====================================================================
// ATTACH
// =====================================================================
function wddemoAttach() {
    try { wddemoInjectHeaderButton(); } catch (e) { /* silent */ }
}

window.addEventListener('load', function () {
    setTimeout(wddemoAttach, 2000);
    setInterval(wddemoAttach, 3000);
    var obs = new MutationObserver(function () {
        if (window.__wddemoSched) return;
        window.__wddemoSched = true;
        setTimeout(function () {
            window.__wddemoSched = false;
            wddemoAttach();
        }, 250);
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
});
