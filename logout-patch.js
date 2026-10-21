// ==================== LOGOUT PATCH v30 ====================
// Overrides window.logout with a full state-clearing implementation:
//   - detaches every real-time listener (including 'staff' — the old one missed it)
//   - signs out of Firebase Auth (register flow creates a session that was leaking)
//   - clears all in-memory session state (cart, caches, active order/refund, etc.)
//   - wipes sensitive UI so no stale store data flashes on next login
//   - closes any open modals
//   - clears the inline display:block on #dashboard-main-wrapper
//     (the actual "dashboard still visible after logout" bug)
//   - restores the full Admin sidebar for the next login
//
// Safe to load after script.js. Wins over the original logout() by explicit
// window.logout assignment. If this patch is later deleted, the original
// function takes over again — no dead code, no dependency.

console.log("Wise Decision logout-patch.js — v30 loaded");

window.logout = function logout() {
    // 1. Detach ALL real-time listeners (original missed 'staff' → cross-store leak)
    if (typeof currentStoreId !== 'undefined' && currentStoreId) {
        const listenerPaths = [
            'branches', 'pendingOrders', 'transactions', 'heldCarts',
            'customers', 'transfers', 'supplies', 'suppliers',
            'expenses', 'refunds', 'staff'
        ];
        listenerPaths.forEach(path => {
            try {
                firebase.database().ref(`stores/${currentStoreId}/${path}`).off();
            } catch (e) { /* path may not exist for this store */ }
        });
    }

    // 2. Sign out of Firebase Auth (registration creates a session that was persisting)
    try {
        if (typeof firebase !== 'undefined' && typeof firebase.auth === 'function') {
            const authInstance = firebase.auth();
            if (authInstance && authInstance.currentUser) {
                authInstance.signOut().catch(err => {
                    console.warn("Firebase Auth signOut failed (non-fatal):", err);
                });
            }
        }
    } catch (e) { /* firebase-auth module not loaded — nothing to sign out */ }

    // 3. Clear idle timer
    if (typeof idleTimer !== 'undefined' && idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (typeof hideIdleWarningModal === 'function') hideIdleWarningModal();
    if (typeof idleSecondsRemaining !== 'undefined' && typeof IDLE_WARNING_SECONDS !== 'undefined') {
        idleSecondsRemaining = IDLE_WARNING_SECONDS;
    }

    // 4. Reset all in-memory session state
    currentStoreId = null;
    currentUserRole = "Admin";
    currentBranch = "main";
    currentInventoryBranchFilter = "main";
    currentReportBranchFilter = "all";
    currentCart = [];
    currentSelectedCustomer = null;
    currentProfileCustomerId = null;
    currentActiveOrder = null;
    currentActiveRefund = null;
    currentCustomerType = "Retail";
    currentSaleUnit = "Piece";
    customersCache = {};
    branchesCache = {};
    suppliersCache = {};
    inventoryCache = {};

    // 5. Wipe sensitive UI so no stale store data flashes on next login
    const titleEl = document.getElementById('dashboard-store-title');
    if (titleEl) titleEl.textContent = 'WISE DECISION';
    const roleEl = document.getElementById('user-role-label');
    if (roleEl) roleEl.textContent = 'Logged in as Admin';
    const workspace = document.getElementById('workspace-content');
    if (workspace) workspace.innerHTML = '';
    const branchBadge = document.getElementById('branch-badge-container');
    if (branchBadge) branchBadge.innerHTML = '';
    const heldBadge = document.getElementById('held-carts-count');
    if (heldBadge) heldBadge.textContent = '0';

    // 6. Clear the login form
    const storeInput = document.getElementById('store-id-input');
    const pinInput = document.getElementById('staff-pin');
    if (storeInput) storeInput.value = '';
    if (pinInput) pinInput.value = '';

    // 7. Close any open modals
    document.querySelectorAll('[id$="-modal"]').forEach(m => {
        if (m.style.display === 'flex') m.style.display = 'none';
    });

    // 8. THE FIX — clear the inline display:block on the dashboard wrapper.
    //    CSS .view-section { display:none } cannot override inline styles, so
    //    removing the 'active' class alone was leaving the dashboard visible.
    const mainWrapper = document.getElementById('dashboard-main-wrapper');
    if (mainWrapper) {
        mainWrapper.style.display = '';
        mainWrapper.classList.remove('active');
    }

    // 9. Restore full Admin sidebar for the next login
    if (typeof adjustSidebarForRole === 'function') adjustSidebarForRole("Admin");

    // 10. Return to login screen
    if (typeof switchView === 'function') switchView('login-view');
};
