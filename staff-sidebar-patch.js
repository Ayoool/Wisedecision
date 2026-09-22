// ==================== WISE DECISION STAFF SIDEBAR SAFETY-NET PATCH (v33) ====================
// Load LAST (after all the other patches), with `defer`.
//
// Fixes: after the 4-6 minute idle timeout logs someone out and they log back in, some staff
// have seen the full Admin sidebar (Staff, Suppliers, Branches, Reports, etc.) instead of the
// buttons their role is meant to see.
//
// This re-applies the correct sidebar for whoever is actually logged in — right after every
// screen change, and once a second as a safety net — so no matter what caused it to go wrong
// once, it can never stay wrong.

console.log("Wise Decision staff-sidebar-patch.js — v1 loaded");

function wdxEnforceSidebar() {
    if (typeof adjustSidebarForRole !== 'function') return;
    if (!currentStoreId || currentStoreId === 'SUPER_ADMIN') return;   // Super Admin has its own screen, no sidebar to restrict
    adjustSidebarForRole(currentUserRole);
}

(function hookSwitchView() {
    var prev = window.switchView;
    if (typeof prev !== 'function') return;
    window.switchView = function (viewId) {
        var result = prev.apply(this, arguments);
        try {
            if (viewId !== 'login-view' && viewId !== 'register-view' && viewId !== 'super-admin-view') wdxEnforceSidebar();
        } catch (e) { /* never block navigation */ }
        return result;
    };
})();

setInterval(function () { try { wdxEnforceSidebar(); } catch (e) { console.warn(e); } }, 1000);
