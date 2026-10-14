// ==================== WISE DECISION VERTICAL-FIRST DASHBOARD PATCH (v1) ====================
// Load LAST — after every other vertical patch (fashion, phone, water, materials, etc.).
//
// When a store's storeType matches a known vertical, this patch:
//   • Puts that vertical's sidebar button at the TOP (right after Dashboard)
//   • Redirects the landing page to the vertical's main screen instead of the
//     generic "Store Overview" dashboard
//   • Hides the generic POS Sales button for that store (they sell through
//     their vertical screen, not the pharmacy-style POS)
//
// A Fashion store now opens straight into Fashion Sales. Same for Phone Vendor,
// Water Distributor, Materials, etc.

console.log("Wise Decision vertical-first-patch.js — v1 loaded");

// ---------- Known verticals ----------
// Map: storeType slug → { sidebarButtonId, openFn, label }
var WDV_VERTICALS = {
    'fashion':      { btn: 'wdf-sidebar-btn',  open: 'wdfShowStock',  label: '👗 Fashion Sales' },
    'boutique':     { btn: 'wdf-sidebar-btn',  open: 'wdfShowStock',  label: '👗 Fashion Sales' },
    'phone_vendor': { btn: 'wdph-sidebar-btn', open: 'wdphShowStock', label: '📱 Phone Sales' },
    'phone':        { btn: 'wdph-sidebar-btn', open: 'wdphShowStock', label: '📱 Phone Sales' },
    'water':        { btn: 'wdw-sidebar-btn',  open: 'wdwShowStock',  label: '💧 Water Sales' },
    'drinks':       { btn: 'wdw-sidebar-btn',  open: 'wdwShowStock',  label: '💧 Drinks Sales' },
    'materials':    { btn: 'wdm-sidebar-btn',  open: 'wdmShowStock',  label: '🏗️ Materials' },
    'hardware':     { btn: 'wdm-sidebar-btn',  open: 'wdmShowStock',  label: '🏗️ Materials' }
};

function wdvEl(id) { return document.getElementById(id); }

// ---------- Get the store type for the currently logged-in store ----------
async function wdvGetStoreType() {
    if (typeof currentStoreId === 'undefined' || !currentStoreId) return null;
    if (currentStoreId === 'SUPER_ADMIN' || currentStoreId === '__demo__' || currentStoreId.indexOf('__demo__') !== -1) {
        // In demo mode, read the store type directly
        try {
            var snap = await firebase.database().ref('stores/' + currentStoreId + '/storeType').once('value');
            return String(snap.val() || '').toLowerCase();
        } catch (e) { return null; }
    }
    try {
        var snap2 = await firebase.database().ref('stores/' + currentStoreId + '/storeType').once('value');
        return String(snap2.val() || '').toLowerCase();
    } catch (e) { return null; }
}

// ---------- Make the vertical the primary view ----------
async function wdvApply() {
    if (typeof currentStoreId === 'undefined' || !currentStoreId) return;

    var type = await wdvGetStoreType();
    if (!type) return;

    var vertical = WDV_VERTICALS[type];
    if (!vertical) return;   // not a vertical store, leave general dashboard alone

    var sidebar = document.querySelector('#dashboard-main-wrapper .sidebar');
    if (!sidebar) return;

    // The vertical's button may not be injected yet — retry a few times
    var btn = wdvEl(vertical.btn);
    if (!btn) {
        if (!window.__wdvRetries) window.__wdvRetries = 0;
        if (window.__wdvRetries < 12) {
            window.__wdvRetries++;
            setTimeout(wdvApply, 400);
        }
        return;
    }
    window.__wdvRetries = 0;

    // Move the vertical button to the TOP (right after the Dashboard button)
    var dashBtn = null;
    sidebar.querySelectorAll('button').forEach(function (x) {
        if (!dashBtn && (x.textContent || '').indexOf('Dashboard') !== -1) dashBtn = x;
    });
    if (dashBtn && dashBtn.nextSibling) {
        sidebar.insertBefore(btn, dashBtn.nextSibling);
    }

    // Make the button bold/highlighted so it reads as the primary action
    btn.style.background = 'linear-gradient(135deg,#0ea5e9 0%,#0284c7 100%)';
    btn.style.color = '#fff';
    btn.style.fontWeight = 'bold';
    btn.style.border = 'none';

    // Hide the generic POS Sales button for this store — they use the vertical screen instead
    sidebar.querySelectorAll('button').forEach(function (x) {
        var t = (x.textContent || '').trim();
        if (t.indexOf('POS Sales') !== -1) {
            x.style.display = 'none';
        }
    });

    // If we're sitting on the generic "Store Overview" dashboard, jump to the vertical screen
    var workspace = wdvEl('workspace-content');
    var showingGeneric = workspace && workspace.querySelector('h2') &&
        (workspace.querySelector('h2').textContent || '').indexOf('Store Overview') !== -1;

    // Also handle the case where the app just loaded and shows the main dashboard view
    var mainView = wdvEl('main-dashboard-view');
    var mainViewVisible = mainView && mainView.style.display !== 'none';

    if (showingGeneric || mainViewVisible || (typeof currentView !== 'undefined' && (currentView === 'main-dashboard-view' || currentView === 'main-dashboard'))) {
        if (typeof window[vertical.open] === 'function') {
            try { window[vertical.open](); } catch (e) { /* silent */ }
        }
    }
}

// ---------- Watch the workspace so we keep the vertical button on top ----------
function wdvAttach() {
    try { wdvApply(); } catch (e) { /* silent */ }
}

window.addEventListener('load', function () {
    setTimeout(wdvAttach, 2500);
    setInterval(wdvAttach, 3000);
    var obs = new MutationObserver(function () {
        if (window.__wdvSched) return;
        window.__wdvSched = true;
        setTimeout(function () {
            window.__wdvSched = false;
            wdvAttach();
        }, 300);
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
});
