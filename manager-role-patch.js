// ==================== WISE DECISION MANAGER ROLE PATCH (v3) ====================
// Load LAST (after materials-polish-patch.js), with `defer`.
//
// Adds a "Manager" staff role:
//   Can:    Dashboard, POS (takes payment at the till), Inventory (add/edit/restock),
//           Customers, Suppliers, Stock Transfers, Reports (view), Expenses (record)
//   Cannot: Staff, Branches, Business Settings, Audit Log, Accountant dashboard,
//           delete records, issue refunds, see Net Profit
// The store owner (label contains "(Owner)") is never restricted by this patch.

console.log("Wise Decision manager-role-patch.js — v3 loaded");

var WD_MGR_BLOCKED = ['staff-view', 'branches-view', 'settings-view', 'audit-log-view', 'accountant-view'];
var WD_MGR_HIDE_PROFIT = true;   // set false to let Managers see the Net Profit card

// A Manager, but never the store owner
function wdIsManager() {
    if (typeof currentUserRole === 'undefined' || currentUserRole !== 'Manager') return false;
    var l = document.getElementById('user-role-label');
    return !(l && /\(Owner\)/i.test(l.textContent));
}

// 1. Sidebar: hide admin-only buttons for Managers
(function () {
    var prev = window.adjustSidebarForRole;
    if (typeof prev !== 'function') return;
    window.adjustSidebarForRole = function (role) {
        var r = prev.apply(this, arguments);
        if (role === 'Manager' && wdIsManager()) {
            document.querySelectorAll('.sidebar button[onclick]').forEach(function (b) {
                var oc = b.getAttribute('onclick') || '';
                if (oc.indexOf('switchView') === -1) return;
                var blocked = WD_MGR_BLOCKED.some(function (v) { return oc.indexOf("'" + v + "'") !== -1; });
                b.style.display = blocked ? 'none' : 'block';
            });
        }
        return r;
    };
})();

// 2. Screen guard: Managers can't open blocked screens by any route
(function () {
    var prev = window.switchView;
    if (typeof prev !== 'function') return;
    window.switchView = function (viewId) {
        if (wdIsManager() && WD_MGR_BLOCKED.indexOf(viewId) !== -1) {
            alert('Access Restricted: only the Admin can open this section.');
            return;
        }
        return prev.apply(this, arguments);
    };
})();

// 3. Managers can't delete records
['deleteProduct', 'deleteExpense', 'deleteSupplier', 'deleteCustomer'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
        if (wdIsManager()) { alert('Access Restricted: only the Admin can delete records.'); return; }
        return orig.apply(this, arguments);
    };
});

// 4. Managers take payment at the till (works with pos-mode-patch.js)
(function () {
    var prev = window.wdpPolicy;
    if (typeof prev !== 'function') return;
    window.wdpPolicy = function (mode, role) {
        if (role === 'Manager' && wdIsManager()) return { showPay: true, showSend: false };
        return prev.apply(this, arguments);
    };
})();

// 5. Cosmetics: hide Delete buttons, hide profit, add "Manager" to the Add Staff dropdown
var wdMgrStyle = document.createElement('style');
wdMgrStyle.textContent =
    'body.wd-manager button[onclick*="deleteProduct"],' +
    'body.wd-manager button[onclick*="deleteExpense"],' +
    'body.wd-manager button[onclick*="deleteSupplier"],' +
    'body.wd-manager button[onclick*="deleteCustomer"]{display:none !important;}';
document.head.appendChild(wdMgrStyle);

setInterval(function () {
    try {
        var isMgr = wdIsManager();
        document.body.classList.toggle('wd-manager', isMgr);
        if (isMgr && WD_MGR_HIDE_PROFIT) {
            var np = document.getElementById('net-profit-display');
            if (np && np.parentElement) np.parentElement.style.display = 'none';
        }
        var sel = document.getElementById('staff-role-input');
        if (sel && !Array.prototype.some.call(sel.options, function (o) { return o.value === 'Manager'; })) {
            var o = document.createElement('option');
            o.value = 'Manager'; o.textContent = 'Manager';
            sel.appendChild(o);
        }
    } catch (e) { /* never break the app */ }
}, 1000);
