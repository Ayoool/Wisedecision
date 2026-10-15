// ==================== WISE DECISION VERTICAL-FIRST PATCH (v3.6) ====================
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

console.log("Wise Decision vertical-first-patch.js v3.6 loaded");

// ---------------------------------------------------------------------
// Compatibility shim: materials-patch.js and materials-polish-patch.js only treat a store as a
// materials store when storeType is 'hardware' (or 'hardware:...'). The demo store (and any store
// typed 'materials') uses 'materials', so their buttons were never created. Both files call
// these two functions by name, so redefining them here (this file loads last) fixes both.
// ---------------------------------------------------------------------
function wdvIsMaterialsTypeNow() {
    if (typeof wdmStoreType === 'undefined' || !wdmStoreType) return false;
    var t = String(wdmStoreType).toLowerCase();
    return t === 'hardware' || t === 'materials' || t.indexOf('hardware:') === 0 || t.indexOf('materials:') === 0;
}
window.wdmIsMaterialsStore = wdvIsMaterialsTypeNow;
window.wdpIsMaterialsStore = wdvIsMaterialsTypeNow;


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
    // Building materials (materials-patch.js adds these 3 sidebar buttons for the Admin):
    //   🏗️ Materials Dashboard (main), 🛒 New Sale, 🔨 Damaged / Wastage.
    // New Sale opens the normal POS screen, so we must NOT redirect away from it (redirectOn).
    // Inventory and Suppliers are reached from buttons on the Materials Dashboard.
    // To bring back more sidebar buttons, add their text to keep, e.g. 'reports', 'expenses', 'staff'.
    'materials':    { btn: ['wdm-sidebar-materials-btn'], label: '🏗️ Materials', exclusive: true,
                      keep: ['new sale', 'damaged', 'wastage'], redirectOn: ['Store Overview'], restyle: false },
    'hardware':     { btn: ['wdm-sidebar-materials-btn'], label: '🏗️ Materials', exclusive: true,
                      keep: ['new sale', 'damaged', 'wastage'], redirectOn: ['Store Overview'], restyle: false }
};

// Buttons that stay visible for exclusive verticals (lower-case text match)
var WDV_KEEP_TEXT = ['logout', 'log out', 'sign out'];
// Each vertical may add its own extra keepers with a  keep: [...]  list in WDV_MAP

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

// CSS rule (with !important) so it still wins when another patch (e.g. staff-sidebar-patch.js,
// which re-applies the role buttons every second) sets display on the buttons.
function wdvEnsureStyle() {
    if (document.getElementById('wdv-style')) return;
    var st = document.createElement('style');
    st.id = 'wdv-style';
    st.textContent =
        'body.wdv-exclusive #dashboard-main-wrapper .sidebar button:not(.wdv-keep),' +
        'body.wdv-exclusive #dashboard-main-wrapper .sidebar .menu-btn:not(.wdv-keep){display:none !important;}' +
        '.wdv-hide-card{display:none !important;}';
    document.head.appendChild(st);
}

function wdvSidebar() {
    return document.querySelector('#dashboard-main-wrapper .sidebar');
}

// Put back every button this patch hid
function wdvRestoreSidebar() {
    if (document.body) document.body.classList.remove('wdv-exclusive');
    document.querySelectorAll('.wdv-hide-card').forEach(function (c) { c.classList.remove('wdv-hide-card'); });
    var sidebar = wdvSidebar();
    if (!sidebar) return;
    sidebar.querySelectorAll('.wdv-keep').forEach(function (b) { b.classList.remove('wdv-keep'); });
    sidebar.querySelectorAll('[data-wdv-hidden="1"]').forEach(function (b) {
        b.style.removeProperty('display');
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
function wdvOnGenericScreen(v) {
    var ws = document.getElementById('workspace-content');
    if (!ws) return false;
    var h2 = ws.querySelector('h2');
    if (!h2) return false;
    var t = (h2.textContent || '').trim();
    var titles = (v && v.redirectOn) || ['Store Overview', 'Point of Sale'];
    return titles.some(function (x) { return t.indexOf(x) !== -1; });
}

// 'important' so other patches that set display on the buttons can't undo the hiding
function wdvHide(b) {
    if (b.style.getPropertyValue('display') !== 'none' || b.style.getPropertyPriority('display') !== 'important') {
        b.style.setProperty('display', 'none', 'important');
    }
    b.setAttribute('data-wdv-hidden', '1');
}

function wdvRearrangeSidebar() {
    if (!wdvResolved) return;
    var sidebar = wdvSidebar();
    if (!sidebar) return;

    var btn = wdvFindBtn(wdvResolved);
    if (!btn) return;   // never hide everything if the vertical's own button is missing

    // Make sure the vertical's button is visible
    if (btn.style.getPropertyValue('display') === 'none') btn.style.removeProperty('display');

    // Style the vertical button as primary (unless the vertical has its own look)
    if (wdvResolved.restyle !== false) {
        btn.style.background = 'linear-gradient(135deg,#0ea5e9 0%,#0284c7 100%)';
        btn.style.color = '#fff';
        btn.style.fontWeight = 'bold';
        btn.style.border = 'none';
    }

    if (wdvResolved.exclusive) {
        // Vertical button goes to the very top
        if (sidebar.firstElementChild !== btn) sidebar.insertBefore(btn, sidebar.firstChild);

        // Everything except the vertical's button and Logout is hidden by the CSS rule
        wdvEnsureStyle();
        document.body.classList.add('wdv-exclusive');
        sidebar.querySelectorAll('button, .menu-btn').forEach(function (x) {
            var t = (x.textContent || '').trim().toLowerCase();
            var keepList = WDV_KEEP_TEXT.concat(wdvResolved.keep || []);
            var keep = (x === btn) || keepList.some(function (k) { return t.indexOf(k) !== -1; });
            if (keep) x.classList.add('wdv-keep'); else x.classList.remove('wdv-keep');
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
    if (!wdvOnGenericScreen(wdvResolved)) return;
    try { btn.click(); } catch (e) { /* silent */ }
}

// Phone vendors don't need the "How do you take payment?" (accountant / till) card
// that pos-mode-patch.js adds under the phone inventory table.
var WDV_HIDE_CARD_TEXT = ['How do you take payment'];

function wdvHideSettingCards() {
    var ws = document.getElementById('workspace-content');
    var table = document.getElementById('wdv-table-body');
    if (!ws || !table) return;   // only on the phone inventory screen
    var walker = document.createTreeWalker(ws, NodeFilter.SHOW_TEXT, null, false);
    var n;
    while ((n = walker.nextNode())) {
        var txt = n.nodeValue || '';
        if (!WDV_HIDE_CARD_TEXT.some(function (k) { return txt.indexOf(k) !== -1; })) continue;
        var el = n.parentElement;
        // climb to the whole card: stop just below the first ancestor that also holds the phone table
        while (el && el.parentElement && el.parentElement !== ws && !el.parentElement.contains(table)) {
            el = el.parentElement;
        }
        if (el && el !== ws && !el.contains(table) && !el.classList.contains('wdv-hide-card')) {
            el.classList.add('wdv-hide-card');
        }
    }
}

function wdvTick() {
    try {
        wdvWatchType();
        wdvRearrangeSidebar();
        if (wdvResolved && wdvResolved.exclusive) { wdvEnsureStyle(); wdvHideSettingCards(); }
        wdvRedirectIfNeeded();
    } catch (e) { console.warn('[vertical-first]', e); }
}

// Run on load and keep running — cheap operation
setTimeout(wdvTick, 1500);
setInterval(wdvTick, 250);

// Also react to DOM changes for immediate effect
var wdvObs = new MutationObserver(function () {
    if (Date.now() - wdvLastCheck < 300) return;
    wdvLastCheck = Date.now();
    wdvTick();
});
window.addEventListener('load', function () {
    setTimeout(function () { if (document.body) wdvObs.observe(document.body, { childList: true, subtree: true }); }, 1000);
});
