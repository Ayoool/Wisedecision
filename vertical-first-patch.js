// ==================== WISE DECISION VERTICAL-FIRST PATCH (v3) ====================
// Load LAST — after every other vertical patch.
//
// v3: Phone vendor stores now see ONLY their own phone dashboard.
//     - Every sidebar button is hidden except the Phone Sales button (and Logout).
//     - The generic Dashboard button is hidden too.
//     - The store type is watched live, so switching type (demo mode, Super Admin
//       override) updates the sidebar straight away, and hidden buttons come back
//       when the store is no longer a phone vendor.
//
// v2: Redirects away from the generic "Store Overview" / "Point of Sale" screens
//     by clicking the vertical's sidebar button.

console.log("Wise Decision vertical-first-patch.js v3 loaded");

// btn      = id(s) of the vertical's sidebar button (first one that exists is used)
// exclusive = true  -> hide EVERY other sidebar button (except WDV_KEEP_TEXT)
//             false -> only hide the generic POS Sales button (old behaviour)
var WDV_MAP = {
    'fashion':      { btn: ['wdf-sidebar-btn'],  label: '👗 Fashion Sales', exclusive: false },
    'boutique':     { btn: ['wdf-sidebar-btn'],  label: '👗 Fashion Sales', exclusive: false },
    'phone_vendor': { btn: ['wdph-sidebar-btn', 'wdv-sidebar-phone-btn'], label: '📱 Phone Sales', exclusive: true },
    'phone':        { btn: ['wdph-sidebar-btn', 'wdv-sidebar-phone-btn'], label: '📱 Phone Sales', exclusive: true },
    'phone shop':   { btn: ['wdph-sidebar-btn', 'wdv-sidebar-phone-btn'], label: '📱 Phone Sales', exclusive: true },
    'water':        { btn: ['wdw-sidebar-btn'],  label: '💧 Water Sales', exclusive: false },
    'drinks':       { btn: ['wdw-sidebar-btn'],  label: '💧 Water Sales', exclusive: false },
    'materials':    { btn: ['wdm-sidebar-btn'],  label: '🏗️ Materials', exclusive: false },
    'hardware':     { btn: ['wdm-sidebar-btn'],  label: '🏗️ Materials', exclusive: false }
};

// Buttons that stay visible for exclusive verticals (lower-case text match)
var WDV_KEEP_TEXT = ['logout', 'log out', 'sign out'];

var wdvResolved = null;     // entry from WDV_MAP once we know the store's vertical
var wdvWatchedStore = null; // store whose storeType we are listening to
var wdvTypeRef = null;
var wdvLastCheck = 0;

function wdvMatchVertical(type) {
    if (!type) return null;
    var keys = Object.keys(WDV_MAP);
    for (var i = 0; i < keys.length; i++) {
        if (type.indexOf(keys[i]) !== -1) return WDV_MAP[keys[i]];
    }
    return null;
}

function wdvSidebar() {
    return document.querySelector('#dashboard-main-wrapper .sidebar');
}

// Put back every button this patch hid
function wdvRestoreSidebar() {
    var sidebar = wdvSidebar();
    if (!sidebar) return;
    sidebar.querySelectorAll('[data-wdv-hidden="1"]').forEach(function (b) {
        b.style.display = '';
        b.removeAttribute('data-wdv-hidden');
    });
}

// Listen to stores/{id}/storeType live (handles store switches and demo-mode changes)
function wdvWatchType() {
    var sid = (typeof currentStoreId !== 'undefined') ? currentStoreId : null;
    if (!sid || sid === 'SUPER_ADMIN') {
        if (wdvWatchedStore) {
            if (wdvTypeRef) { try { wdvTypeRef.off(); } catch (e) {} }
            wdvTypeRef = null; wdvWatchedStore = null;
            wdvRestoreSidebar();
            wdvResolved = null;
        }
        return;
    }
    if (wdvWatchedStore === sid) return;

    if (wdvTypeRef) { try { wdvTypeRef.off(); } catch (e) {} }
    wdvRestoreSidebar();
    wdvResolved = null;
    wdvWatchedStore = sid;

    wdvTypeRef = firebase.database().ref('stores/' + sid + '/storeType');
    wdvTypeRef.on('value', function (snap) {
        var type = String(snap.val() || '').toLowerCase();
        var v = wdvMatchVertical(type);
        if (v !== wdvResolved) {
            wdvRestoreSidebar();
            wdvResolved = v;
            if (v) console.log('[vertical-first] store type = ' + type + ' → ' + v.label);
        }
        wdvTick();
    }, function () {});
}

function wdvFindBtn(v) {
    if (!v) return null;
    for (var i = 0; i < v.btn.length; i++) {
        var b = document.getElementById(v.btn[i]);
        if (b) return b;
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
    if (t.indexOf('Store Overview') !== -1) return true;   // generic dashboard
    if (t.indexOf('Point of Sale') !== -1) return true;    // generic POS register
    return false;
}

function wdvHide(b) {
    if (b.style.display !== 'none') b.style.display = 'none';
    b.setAttribute('data-wdv-hidden', '1');
}

function wdvRearrangeSidebar() {
    if (!wdvResolved) return;
    var sidebar = wdvSidebar();
    if (!sidebar) return;

    var btn = wdvFindBtn(wdvResolved);
    if (!btn) return;   // never hide everything if the vertical's own button is missing

    // Make sure the vertical's button is visible
    if (btn.style.display === 'none') btn.style.display = '';

    // Style the vertical button as primary
    btn.style.background = 'linear-gradient(135deg,#0ea5e9 0%,#0284c7 100%)';
    btn.style.color = '#fff';
    btn.style.fontWeight = 'bold';
    btn.style.border = 'none';

    if (wdvResolved.exclusive) {
        // Vertical button goes to the very top
        if (sidebar.firstElementChild !== btn) sidebar.insertBefore(btn, sidebar.firstChild);

        // Hide everything else (including the generic Dashboard and any duplicate phone button)
        sidebar.querySelectorAll('button').forEach(function (x) {
            if (x === btn) return;
            var t = (x.textContent || '').trim().toLowerCase();
            var keep = WDV_KEEP_TEXT.some(function (k) { return t.indexOf(k) !== -1; });
            if (!keep) wdvHide(x);
        });
    } else {
        // Old behaviour: vertical button under Dashboard, hide only generic POS Sales
        var dashBtn = null;
        sidebar.querySelectorAll('button').forEach(function (x) {
            if (!dashBtn && (x.textContent || '').indexOf('Dashboard') !== -1) dashBtn = x;
        });
        if (dashBtn && dashBtn.nextSibling !== btn) sidebar.insertBefore(btn, dashBtn.nextSibling);

        sidebar.querySelectorAll('button').forEach(function (x) {
            if ((x.textContent || '').trim().indexOf('POS Sales') !== -1) wdvHide(x);
        });
    }
}

// If we're on a generic screen and the vertical button exists, click it
function wdvRedirectIfNeeded() {
    if (!wdvResolved) return;
    var btn = wdvFindBtn(wdvResolved);
    if (!btn) return;
    if (!wdvOnGenericScreen()) return;
    try { btn.click(); } catch (e) { /* silent */ }
}

function wdvTick() {
    try {
        wdvWatchType();
        wdvRearrangeSidebar();
        wdvRedirectIfNeeded();
    } catch (e) { console.warn('[vertical-first]', e); }
}

// Run on load and keep running — cheap operation
setTimeout(wdvTick, 1500);
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
