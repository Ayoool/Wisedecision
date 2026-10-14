// ==================== WISE DECISION VERTICAL-FIRST PATCH (v2) ====================
// Load LAST — after every other vertical patch.
//
// v2: Fixed the redirect. Instead of checking for element IDs that don't exist,
//     this version reads the current screen's <h2> title. If it says "Store
//     Overview" or "Point of Sale (POS) Register" and the store is a vertical,
//     it clicks the vertical's sidebar button to move the user to the right screen.

console.log("Wise Decision vertical-first-patch.js v2 loaded");

var WDV_MAP = {
    'fashion':      { btn: 'wdf-sidebar-btn',  label: '👗 Fashion Sales' },
    'boutique':     { btn: 'wdf-sidebar-btn',  label: '👗 Fashion Sales' },
    'phone_vendor': { btn: 'wdph-sidebar-btn', label: '📱 Phone Sales' },
    'phone':        { btn: 'wdph-sidebar-btn', label: '📱 Phone Sales' },
    'phone shop':   { btn: 'wdph-sidebar-btn', label: '📱 Phone Sales' },
    'water':        { btn: 'wdw-sidebar-btn',  label: '💧 Water Sales' },
    'drinks':       { btn: 'wdw-sidebar-btn',  label: '💧 Water Sales' },
    'materials':    { btn: 'wdm-sidebar-btn',  label: '🏗️ Materials' },
    'hardware':     { btn: 'wdm-sidebar-btn',  label: '🏗️ Materials' }
};

var wdvResolved = null;   // { btn, label } once we know the store's vertical
var wdvLastCheck = 0;

function wdvGetType() {
    if (typeof currentStoreId === 'undefined' || !currentStoreId) return Promise.resolve(null);
    return firebase.database().ref('stores/' + currentStoreId + '/storeType').once('value')
        .then(function (s) { return String(s.val() || '').toLowerCase(); })
        .catch(function () { return null; });
}

function wdvMatchVertical(type) {
    if (!type) return null;
    var keys = Object.keys(WDV_MAP);
    for (var i = 0; i < keys.length; i++) {
        if (type.indexOf(keys[i]) !== -1) return WDV_MAP[keys[i]];
    }
    return null;
}

// Look at the current screen's <h2> to decide if we're on a generic view
function wdvOnGenericScreen() {
    var ws = document.getElementById('workspace-content');
    if (!ws) return false;
    var h2 = ws.querySelector('h2');
    if (!h2) return false;
    var t = (h2.textContent || '').trim();
    // Generic Store Overview dashboard
    if (t.indexOf('Store Overview') !== -1) return true;
    // Generic POS Register (pharmacy style)
    if (t.indexOf('Point of Sale') !== -1) return true;
    return false;
}

// Move the vertical button to the top of the sidebar and hide the generic POS button
function wdvRearrangeSidebar() {
    if (!wdvResolved) return;
    var sidebar = document.querySelector('#dashboard-main-wrapper .sidebar');
    if (!sidebar) return;

    var btn = document.getElementById(wdvResolved.btn);
    if (!btn) return;

    // Find the Dashboard button
    var dashBtn = null;
    sidebar.querySelectorAll('button').forEach(function (x) {
        if (!dashBtn && (x.textContent || '').indexOf('Dashboard') !== -1) dashBtn = x;
    });

    // Move vertical button right under Dashboard (only if not already there)
    if (dashBtn && dashBtn.nextSibling !== btn) {
        sidebar.insertBefore(btn, dashBtn.nextSibling);
    }

    // Style the vertical button as primary
    btn.style.background = 'linear-gradient(135deg,#0ea5e9 0%,#0284c7 100%)';
    btn.style.color = '#fff';
    btn.style.fontWeight = 'bold';
    btn.style.border = 'none';

    // Hide the generic POS Sales button
    sidebar.querySelectorAll('button').forEach(function (x) {
        var t = (x.textContent || '').trim();
        if (t.indexOf('POS Sales') !== -1) x.style.display = 'none';
    });
}

// If we're on a generic screen and the vertical button exists, click it
function wdvRedirectIfNeeded() {
    if (!wdvResolved) return;
    var btn = document.getElementById(wdvResolved.btn);
    if (!btn) return;
    if (!wdvOnGenericScreen()) return;
    try { btn.click(); } catch (e) { /* silent */ }
}

// Main tick — runs every 500ms
async function wdvTick() {
    if (typeof currentStoreId === 'undefined' || !currentStoreId) return;

    // Resolve the vertical once
    if (!wdvResolved) {
        var type = await wdvGetType();
        var v = wdvMatchVertical(type);
        if (!v) return;    // not a vertical store — leave alone
        wdvResolved = v;
        console.log('[vertical-first] store type = ' + type + ' → ' + v.label);
    }

    wdvRearrangeSidebar();
    wdvRedirectIfNeeded();
}

// Run on load and keep running — cheap operation
setTimeout(function () { wdvTick(); }, 1500);
setInterval(wdvTick, 500);

// Also react to DOM changes for immediate effect
var wdvObs = new MutationObserver(function () {
    if (Date.now() - wdvLastCheck < 300) return;
    wdvLastCheck = Date.now();
    wdvTick();
});
window.addEventListener('load', function () {
    setTimeout(function () { if (document.body) wdvObs.observe(document.body, { childList: true, subtree: true }); }, 1000);
});
