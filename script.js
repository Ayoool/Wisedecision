// ==================== FIREBASE INITIALIZATION ====================
let db = null;
try {
    const firebaseConfig = {
      apiKey: "AIzaSyCMDSWRCAeOw_r1gwOnJRYwm8Q1GP1Eces",
      authDomain: "wisedecision-24c4e.firebaseapp.com",
      databaseURL: "https://wisedecision-24c4e-default-rtdb.firebaseio.com",
      projectId: "wisedecision-24c4e",
      storageBucket: "wisedecision-24c4e.firebasestorage.app",
      messagingSenderId: "611325659817",
      appId: "1:611325659817:web:6de5db4f41868f297e77b8",
      measurementId: "G-JD2FCGVSKX"
    };
    
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.database();
    }
} catch (e) {
    console.error("Firebase init error:", e);
}

// ==================== GLOBAL APP STATE ====================
let currentStoreId = null;
let currentBranch = "main";           // Branch ID the logged-in user is currently operating in
let currentUserRole = "Admin";
let inventoryCache = {};              // { branchId: { productId: item } }  (nested, per-branch)
let currentCart = [];
let currentActiveOrder = null;
let currentCustomerType = "Retail"; // Default customer type

// ==================== BRANCH MODULE STATE ====================
let branchesCache = {};               // { branchId: { name, phone, address, isMain, createdAt } }
let currentInventoryBranchFilter = "main"; // "all" (Admin aggregate view) or a specific branchId
let currentReportBranchFilter = "all";     // "all" or a specific branchId, Admin-only reports scope
let currentActiveTransfer = null;

// Customer module state
let customersCache = {};
let currentSelectedCustomer = null; // { id, name, phone, balance, creditLimit } attached to the active POS sale
let currentProfileCustomerId = null; // customer currently open in the profile modal

// Supplier module state
let suppliersCache = {};
let supplyBranchProductNames = []; // product names in the currently-selected supply branch, for autocomplete
let supplyItemRowCounter = 0;

// Initialize application on load
window.onload = function() {
    console.log("Wise Decision Enterprise Suite Initialized.");
};

// ==================== OFFLINE MODE & SYNC HANDLER ====================
window.addEventListener('online', () => {
    console.log("Internet connection restored. Syncing offline data...");
    syncOfflineQueueToFirebase();
    showOfflineBanner(false);
});

window.addEventListener('offline', () => {
    console.log("Device is offline. Switching to local storage cache.");
    showOfflineBanner(true);
});

function showOfflineBanner(isOffline) {
    let banner = document.getElementById('offline-status-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offline-status-banner';
        banner.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; background: #dc2626; color: #fff; text-align: center; font-size: 12px; font-weight: bold; padding: 6px; z-index: 9999; display: none;";
        banner.innerText = "⚠ You are currently offline. Sales and changes are saving locally and will sync automatically when reconnected.";
        document.body.prepend(banner);
    }
    banner.style.display = isOffline ? 'block' : 'none';
}

function saveRecordLocallyOrCloud(storageKey, recordData, cloudFirebasePath, successCallback) {
    if (navigator.onLine && db) {
        firebase.database().ref(cloudFirebasePath).set(recordData, (error) => {
            if (error) {
                console.warn("Cloud sync failed, falling back to local cache:", error);
                cacheLocally(storageKey, recordData);
            }
            if (successCallback) successCallback();
        });
    } else {
        cacheLocally(storageKey, recordData);
        alert("Offline Mode: Record saved locally on this laptop. It will auto-sync when connection returns.");
        if (successCallback) successCallback();
    }
}

function cacheLocally(key, data) {
    let existingQueue = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(existingQueue)) {
        existingQueue = [];
    }
    existingQueue.push(data);
    localStorage.setItem(key, JSON.stringify(existingQueue));
}

function syncOfflineQueueToFirebase() {
    if (!currentStoreId || !db) return;

    ['offline_pending_orders', 'offline_inventory_queue'].forEach(key => {
        let queue = JSON.parse(localStorage.getItem(key) || "[]");
        if (queue.length > 0) {
            let targetPath = key === 'offline_pending_orders' ? 
                `stores/${currentStoreId}/pendingOrders` : 
                `stores/${currentStoreId}/inventory/${currentBranch}`;
            
            queue.forEach(item => {
                let pushRef = key === 'offline_pending_orders' ? 
                    firebase.database().ref(`${targetPath}/${item.txId}`) : 
                    firebase.database().ref(targetPath).push();
                
                pushRef.set(item);
            });
            
            localStorage.removeItem(key);
            console.log(`Successfully synced ${queue.length} items from ${key} to cloud.`);
        }
    });
}

// ==================== VIEW & ROUTING ENGINE ====================
function switchView(viewId) {
    // Accountants and Cashiers can view the accountant queue, receipt view, business settings,
    // POS view, and customers (to record debt repayments) — but never staff management,
    // inventory, reports, expenses, transfers, branches, or suppliers.
    if (currentUserRole === 'Accountant' || currentUserRole === 'Cashier') {
        const allowedAccountantViews = [
            'accountant-view', 'accountant-view-template', 
            'receipt-view', 'receipt-view-template', 
            'settings-view', 'settings-view-template',
            'pos-view', 'pos-view-template',
            'customers-view', 'customers-view-template',
            'debt-receipt-view', 'debt-receipt-view-template'
        ];
        if (!allowedAccountantViews.includes(viewId)) {
            alert(`Access Restricted: ${currentUserRole}s are permitted to accept payments, manage the queue, print receipts, and manage customers for their assigned branch.`);
            return;
        }
    }

    // Standard Workers are restricted to making sales only (POS view).
    // NOTE: the role value stored for these staff is "Standard Worker" (matches the
    // staff-role-input dropdown), not "Staff" — the old check here never matched
    // anything real, which is why standard workers previously saw the full sidebar.
    if (currentUserRole === 'Standard Worker' && viewId !== 'pos-view' && viewId !== 'pos-view-template') {
        alert("Access Restricted: Standard workers are only permitted to make sales for their assigned branch.");
        return;
    }

    if (viewId.includes('dashboard') || viewId.includes('view') && viewId !== 'login-view' && viewId !== 'register-view' && viewId !== 'super-admin-view') {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        
        const templateId = viewId.includes('-template') ? viewId : viewId + '-template';
        const templateEl = document.getElementById(templateId);
        
        if (templateEl) {
            const mainWrapper = document.getElementById('dashboard-main-wrapper');
            if (mainWrapper) {
                mainWrapper.classList.add('active');
                mainWrapper.style.display = 'block';
            }
            document.getElementById('workspace-content').innerHTML = templateEl.innerHTML;
            
            if (viewId === 'main-dashboard-view') {
                loadDashboardMetrics();
                loadProfitAndLossModule();
            }
            if (viewId === 'pos-view') {
                loadPosInventoryDropdown();
                updatePosCustomerBadge();
                const posBranchLabel = document.getElementById('pos-branch-label');
                if (posBranchLabel) posBranchLabel.textContent = branchNameOf(currentBranch);
            }
            if (viewId === 'inventory-view') {
                populateInventoryBranchFilter();
                loadInventoryTable();
            }
            if (viewId === 'accountant-view') {
                loadPendingOrdersQueue();
                const accBranchLabel = document.getElementById('accountant-branch-label');
                if (accBranchLabel) accBranchLabel.textContent = branchNameOf(currentBranch);
            }
            if (viewId === 'staff-view') {
                populateStaffBranchDropdown();
                loadStaffTable();
            }
            if (viewId === 'reports-view' || viewId === 'sales-history-view') {
                populateReportsBranchFilter();
                loadPastSalesHistory();
                loadProfitAndLossModule();
            }
            if (viewId === 'settings-view') loadBusinessSettings();
            if (viewId === 'expenses-view') {
                const expBranchLabel = document.getElementById('expenses-branch-label');
                if (expBranchLabel) expBranchLabel.textContent = branchNameOf(currentBranch);
                loadExpensesTable();
                loadProfitAndLossModule();
            }
            if (viewId === 'customers-view') {
                renderCustomersTable(customersCache);
                updateCustomerStatsUI();
            }
            if (viewId === 'branches-view') {
                loadBranchesTable();
            }
            if (viewId === 'transfers-view') {
                loadTransfersView();
            }
            if (viewId === 'suppliers-view') {
                renderSuppliersTable(suppliersCache);
                loadSuppliesHistory();
            }
        } else {
            const fullView = document.getElementById(viewId);
            if (fullView) fullView.classList.add('active');
        }
    } else {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        const target = document.getElementById(viewId);
        if (target) target.classList.add('active');
    }
}

// ==================== SIDEBAR ROLE RESTRICTIONS ====================
function adjustSidebarForRole(role) {
    // FIX: scoped to the actual sidebar element only (class="sidebar" in the HTML).
    // The old selector included the bare `.menu-btn` class, which also matches
    // buttons OUTSIDE the sidebar (e.g. the "Accept Payment & Print Receipt" and
    // "Cancel" buttons inside the split payment modal). Because those buttons'
    // onclick attributes don't contain "accountant-view", "pos-view", or "logout",
    // they were being hidden for Accountant and Staff roles — which is why the
    // Accountant couldn't see the Accept Payment / Print button.
    const menuButtons = document.querySelectorAll('.sidebar button');
    
    menuButtons.forEach(btn => {
        const action = btn.getAttribute('onclick') || '';
        
        if (role === 'Accountant' || role === 'Cashier') {
            if (
                action.includes('accountant-view') || 
                action.includes('pos-view') || 
                action.includes('customers-view') ||
                action.includes('logout')
            ) {
                btn.style.display = 'block';
            } else {
                btn.style.display = 'none';
            }
        } else if (role === 'Standard Worker') {
            if (action.includes('pos-view') || action.includes('logout')) {
                btn.style.display = 'block';
            } else {
                btn.style.display = 'none';
            }
        } else {
            btn.style.display = 'block';
        }
    });
}

// ==================== BRANCH HELPERS ====================
function branchNameOf(branchId) {
    if (!branchId) return "Main";
    if (branchesCache[branchId]) return branchesCache[branchId].name || branchId;
    return branchId === 'main' ? 'Main' : branchId;
}

// Loads all branches for the current store, seeds a default "Main" branch if none
// exist yet (covers stores registered before this module existed), and refreshes
// every branch-aware UI element currently on screen.
function loadBranchesCache(afterLoadCallback) {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/branches`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            const seedBranch = { name: "Main", phone: "", address: "", isMain: true, createdAt: new Date().toISOString() };
            firebase.database().ref(`stores/${currentStoreId}/branches/main`).set(seedBranch).then(() => {
                branchesCache = { main: seedBranch };
                finishBranchLoad(afterLoadCallback);
            });
            return;
        }

        branchesCache = {};
        snapshot.forEach(child => { branchesCache[child.key] = child.val(); });
        finishBranchLoad(afterLoadCallback);
    });
}

function finishBranchLoad(afterLoadCallback) {
    updateBranchBadge();
    if (afterLoadCallback) afterLoadCallback();

    // Keep it live so Admins adding/renaming branches reflect instantly across the app
    firebase.database().ref(`stores/${currentStoreId}/branches`).off();
    firebase.database().ref(`stores/${currentStoreId}/branches`).on('value', snapshot => {
        branchesCache = {};
        snapshot.forEach(child => { branchesCache[child.key] = child.val(); });
        updateBranchBadge();
        populateInventoryBranchFilter();
        populateReportsBranchFilter();
        populateStaffBranchDropdown();
    });
}

// Renders the sidebar branch indicator. Admin gets a live switcher (to change which
// branch's POS/Inventory/Dashboard they are currently operating in); branch-locked
// staff just see a read-only badge for their assigned branch.
function updateBranchBadge() {
    const container = document.getElementById('branch-badge-container');
    if (!container) return;

    if (currentUserRole === 'Admin' && Object.keys(branchesCache).length > 1) {
        let options = Object.keys(branchesCache).map(id =>
            `<option value="${id}" ${id === currentBranch ? 'selected' : ''}>${branchesCache[id].name}</option>`
        ).join('');
        container.innerHTML = `
            <label style="font-size:10px; font-weight:bold; color:#166534; display:block; margin-bottom:2px;">Operating Branch</label>
            <select id="branch-badge-select" onchange="switchCurrentBranch(this.value)" style="font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 6px; border: 1px solid #86efac; background:#dcfce7; color:#166534;">
                ${options}
            </select>
        `;
    } else {
        container.innerHTML = `<span id="branch-badge" style="background: linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%); color: #166534; font-size: 11px; font-weight: bold; padding: 4px 10px; border-radius: 6px; display: inline-block; border: 1px solid #86efac;">Branch: ${branchNameOf(currentBranch)}</span>`;
    }
}

// Admin switches which branch they're currently "standing in" — affects POS, live
// Inventory default scope, Dashboard metrics, and the Accountant queue.
function switchCurrentBranch(branchId) {
    currentBranch = branchId;
    currentInventoryBranchFilter = branchId;
    currentCart = [];
    clearPosCustomer();
    updateBranchBadge();
    // Re-render whichever workspace view is currently open so it reflects the new branch
    const workspace = document.getElementById('workspace-content');
    if (workspace && workspace.innerHTML.trim() !== '') {
        // Detect current view by a distinctive element and re-run its loader
        if (document.getElementById('pos-product-select')) switchView('pos-view');
        else if (document.getElementById('inventory-body')) switchView('inventory-view');
        else if (document.getElementById('dashboard-alerts-tbody')) switchView('main-dashboard-view');
        else if (document.getElementById('accountant-queue-body')) switchView('accountant-view');
        else if (document.getElementById('expenses-body')) switchView('expenses-view');
    }
}

// ==================== AUTHENTICATION & REGISTRATION ====================
function handleStoreLogin() {
    const storeId = document.getElementById('store-id-input').value.trim().toLowerCase();
    const pin = document.getElementById('staff-pin').value.trim();

    if (!storeId || !pin) {
        alert("Please enter both Store ID and PIN.");
        return;
    }

    if (storeId === "superadmin") {
        firebase.database().ref('superAdmin/masterPin').once('value').then(snapshot => {
            // FIX: no more hardcoded "2026" fallback. If the master PIN hasn't been
            // configured in the database yet, login must fail closed rather than
            // silently accepting a guessable default.
            if (!snapshot.exists() || !snapshot.val()) {
                alert("Super Admin access is not configured yet. Set superAdmin/masterPin in the database first.");
                return;
            }
            const masterPin = snapshot.val();
            if (pin === masterPin) {
                currentStoreId = "SUPER_ADMIN";
                currentUserRole = "SuperAdmin";
                document.getElementById('dashboard-store-title').textContent = "Wise Decision Master Control";
                document.getElementById('user-role-label').textContent = "Logged in as Super Admin";
                adjustSidebarForRole("SuperAdmin");
                loadSuperAdminDashboard();
                switchView('super-admin-view');
            } else {
                alert("Invalid Super Admin Master PIN.");
            }
        }).catch(error => {
            console.error("Super Admin login error:", error);
            alert("Connection error during login. Check network.");
        });
        return;
    }

    firebase.database().ref('stores/' + storeId).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            alert("Store ID not found on cloud database.");
            return;
        }

        const storeData = snapshot.val();

        if (storeData.status === "suspended") {
            alert("ACCOUNT SUSPENDED: Your monthly maintenance fee is overdue or your account has been locked. Please contact Wise Decision Support to pay and restore access.");
            return;
        }
        
        if (pin === storeData.adminPin) {
            currentStoreId = storeId;
            currentUserRole = "Admin";
            currentBranch = "main";
            currentInventoryBranchFilter = "main";
            document.getElementById('dashboard-store-title').textContent = storeData.businessName || "";
            document.getElementById('user-role-label').textContent = "Admin (Owner)";
            adjustSidebarForRole("Admin");
            loadBranchesCache(() => switchView('main-dashboard-view'));
            syncOfflineQueueToFirebase();
            subscribeCustomersCache();
            subscribeSuppliersCache();
            return;
        }

        let foundStaff = false;
        if (storeData.staff) {
            Object.keys(storeData.staff).forEach(staffKey => {
                const staff = storeData.staff[staffKey];
                if (staff.pin === pin) {
                    foundStaff = true;
                    currentStoreId = storeId;
                    currentUserRole = staff.role;
                    currentBranch = staff.branchId || "main";
                    currentInventoryBranchFilter = currentBranch;
                    document.getElementById('dashboard-store-title').textContent = storeData.businessName || "";
                    document.getElementById('user-role-label').textContent = `${staff.name} (${staff.role})`;
                    adjustSidebarForRole(staff.role);
                    loadBranchesCache(() => switchView(staff.role === 'Accountant' ? 'accountant-view' : 'pos-view'));
                    syncOfflineQueueToFirebase();
                    subscribeCustomersCache();
                    subscribeSuppliersCache();
                }
            });
        }

        if (!foundStaff) {
            alert("Invalid PIN or Store credentials.");
        }
    }).catch(error => {
        console.error("Login error:", error);
        alert("Connection error during login. Check network.");
    });
}

function registerBusinessAccount() {
    const storeId = document.getElementById('reg-store-id').value.trim().toLowerCase();
    const businessName = document.getElementById('reg-store-name').value.trim();
    const phone = document.getElementById('reg-store-phone').value.trim();
    const address = document.getElementById('reg-store-address').value.trim();
    const adminPin = document.getElementById('reg-admin-pin').value.trim();

    if (!storeId || !businessName || !adminPin) {
        alert("Store ID, Business Name, and Admin PIN are required.");
        return;
    }

    // FIX: the previous hardcoded "Mazanest2026" activation code was readable by
    // anyone who opened this script.js file in the browser, so it provided no real
    // protection. Registration gating like this needs to live server-side (Firebase
    // security rules or a Cloud Function that checks an invite/license record before
    // allowing a write to /stores/{storeId}) — a client-side string can't be a secret.
    // Registration now proceeds directly; lock this down with database rules instead.

    const storeRef = firebase.database().ref('stores/' + storeId);
    storeRef.once('value').then(snapshot => {
        if (snapshot.exists()) {
            alert("Store ID already exists. Please choose another or login.");
            return;
        }

        storeRef.set({
            businessName,
            phone,
            address,
            adminPin,
            status: "active",
            createdAt: new Date().toISOString()
        }).then(() => {
            // Seed the default "Main" branch so inventory/POS/reports have somewhere to live from day one
            return firebase.database().ref(`stores/${storeId}/branches/main`).set({
                name: "Main",
                phone,
                address,
                isMain: true,
                createdAt: new Date().toISOString()
            });
        }).then(() => {
            alert("Business registered successfully! You can now log in.");
            switchView('login-view');
        });
    });
}

function logout() {
    if (currentStoreId) {
        firebase.database().ref(`stores/${currentStoreId}/branches`).off();
        firebase.database().ref(`stores/${currentStoreId}/inventory`).off();
        firebase.database().ref(`stores/${currentStoreId}/pendingOrders`).off();
        firebase.database().ref(`stores/${currentStoreId}/staff`).off();
        firebase.database().ref(`stores/${currentStoreId}/expenses`).off();
        firebase.database().ref(`stores/${currentStoreId}/transactions`).off();
        firebase.database().ref(`stores/${currentStoreId}/transfers`).off();
        firebase.database().ref(`stores/${currentStoreId}/suppliers`).off();
        firebase.database().ref(`stores/${currentStoreId}/supplies`).off();
        firebase.database().ref(`stores/${currentStoreId}/customers`).off();
    }
    currentStoreId = null;
    currentUserRole = "Admin";
    currentBranch = "main";
    currentInventoryBranchFilter = "main";
    currentReportBranchFilter = "all";
    currentCart = [];
    currentSelectedCustomer = null;
    currentProfileCustomerId = null;
    customersCache = {};
    branchesCache = {};
    suppliersCache = {};
    adjustSidebarForRole("Admin");
    switchView('login-view');
}

// ==================== SUPER ADMIN DASHBOARD CONTROL ====================
function loadSuperAdminDashboard() {
    firebase.database().ref('stores').off();
    firebase.database().ref('stores').on('value', snapshot => {
        const tbody = document.getElementById('super-admin-stores-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        snapshot.forEach(child => {
            const storeId = child.key;
            const data = child.val();
            const status = data.status || 'active';
            const statusColor = status === 'active' ? 'green' : 'red';

            tbody.innerHTML += `
                <tr>
                    <td><strong>${storeId}</strong></td>
                    <td>${data.businessName || 'N/A'}</td>
                    <td>${data.phone || 'N/A'}</td>
                    <td><span style="color: ${statusColor}; font-weight: bold;">${status.toUpperCase()}</span></td>
                    <td>
                        <button class="menu-btn" style="padding: 4px 8px; font-size: 11px; width: auto;" onclick="toggleStoreLock('${storeId}', '${status}')">
                            ${status === 'active' ? '🔒 Lock' : '🔓 Unlock'}
                        </button>
                        <button class="menu-btn" style="padding: 4px 8px; font-size: 11px; width: auto; background: #0284c7; color: #fff;" onclick="promptChangeStorePassword('${storeId}')">🔑 PIN</button>
                        <button class="menu-btn" style="padding: 4px 8px; font-size: 11px; width: auto; background: #d97706; color: #fff;" onclick="sendMaintenanceNotice('${storeId}', '${data.phone}')">📢 Notice</button>
                        <button class="menu-btn btn-logout" style="padding: 4px 8px; font-size: 11px; width: auto;" onclick="deleteBusinessAccount('${storeId}')">🗑 Delete</button>
                    </td>
                </tr>
            `;
        });
    });
}

function toggleStoreLock(storeId, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
    const actionText = newStatus === 'suspended' ? 'lock and suspend' : 'unlock and restore';
    
    if (confirm(`Are you sure you want to ${actionText} store ID: ${storeId}?`)) {
        firebase.database().ref(`stores/${storeId}`).update({ status: newStatus }).then(() => {
            alert(`Store ${storeId} has been successfully ${newStatus}.`);
        });
    }
}

function promptChangeStorePassword(storeId) {
    const newPin = prompt(`Enter a new Admin PIN for store: ${storeId}`);
    if (!newPin || newPin.trim() === "") return;

    firebase.database().ref(`stores/${storeId}`).update({ adminPin: newPin.trim() }).then(() => {
        alert(`Admin PIN for ${storeId} has been updated successfully.`);
    }).catch(error => {
        alert("Failed to update PIN: " + error.message);
    });
}

// FIX: normalizes a locally-formatted Nigerian number (e.g. "08012345678") into the
// full international format wa.me requires ("2348012345678"). Previously the raw
// stored number was passed straight through, which produced broken wa.me links for
// any phone saved in local format.
function normalizePhoneForWhatsApp(phone) {
    if (!phone) return '';
    let digits = String(phone).replace(/\D/g, '');
    if (digits.startsWith('0')) {
        digits = '234' + digits.slice(1);
    } else if (!digits.startsWith('234')) {
        digits = '234' + digits;
    }
    return digits;
}

function sendMaintenanceNotice(storeId, phone) {
    const message = `Hello, this is a reminder from Wise Decision support regarding your software subscription. Your monthly maintenance fee is due to keep your store account active and unlocked.\n\nStore ID: ${storeId}\n\nPayment Details:\nBank Name: MONIEPOINT\nAccount Number: 9168140710\nAccount Name: EMMANUEL AYOOLA FISUYI\n\nPlease send proof of payment once done. Thank you!`;
    
    if (phone) {
        const normalizedPhone = normalizePhoneForWhatsApp(phone);
        const whatsappUrl = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
    } else {
        prompt("Copy payment notice message for store owner:", message);
    }
}

function deleteBusinessAccount(storeId) {
    if (confirm(`⚠ DANGER: Are you absolutely sure you want to completely delete store ID "${storeId}" and all its associated data (inventory, transactions, staff, expenses)? This action cannot be undone!`)) {
        const confirmationCode = prompt(`Type the exact store ID "${storeId}" to confirm permanent deletion:`);
        if (confirmationCode === storeId) {
            firebase.database().ref(`stores/${storeId}`).remove().then(() => {
                alert(`Store ${storeId} has been permanently deleted from the database.`);
            }).catch(error => {
                alert("Failed to delete store: " + error.message);
            });
        } else {
            alert("Deletion cancelled. Store ID confirmation did not match.");
        }
    }
}

// ==================== DASHBOARD METRICS & ALERTS ====================
// Scoped to currentBranch — the branch the logged-in user (or Admin, via the sidebar
// switcher) is currently operating in.
function loadDashboardMetrics() {
    if (!currentStoreId) return;

    const branchLabelEl = document.getElementById('dash-branch-label');
    if (branchLabelEl) branchLabelEl.textContent = branchNameOf(currentBranch);
    
    firebase.database().ref(`stores/${currentStoreId}/transactions`).once('value').then(snapshot => {
        let todaySales = 0;
        const todayStr = new Date().toDateString();
        
        snapshot.forEach(child => {
            const tx = child.val();
            if ((tx.branchId || 'main') === currentBranch && new Date(tx.date).toDateString() === todayStr) {
                todaySales += (Number(tx.totalAmount) || 0);
            }
        });
        
        const salesEl = document.getElementById('dash-today-sales');
        if (salesEl) salesEl.textContent = '₦' + todaySales.toLocaleString();
    });

    firebase.database().ref(`stores/${currentStoreId}/inventory/${currentBranch}`).once('value').then(snapshot => {
        const tbody = document.getElementById('dashboard-alerts-tbody');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        let alertCount = 0;
        const now = new Date();

        snapshot.forEach(child => {
            const item = child.val();
            const stock = Number(item.stock !== undefined ? item.stock : (item.stockQty !== undefined ? item.stockQty : 0)) || 0;
            const expiryVal = item.expiry || item.expiryDate;
            const expiryDate = expiryVal ? new Date(expiryVal) : null;
            const itemName = item.name || item.productName || 'Unnamed Item';
            
            let isLowStock = stock <= 5;
            let isExpiringSoon = expiryDate && (expiryDate - now) / (1000 * 60 * 60 * 24) <= 30;

            if (isLowStock || isExpiringSoon) {
                alertCount++;
                let badge = isLowStock ? '<span style="color:red; font-weight:bold;">Low Stock</span> ' : '';
                if (isExpiringSoon) badge += '<span style="color:orange; font-weight:bold;">Expiring Soon</span>';

                tbody.innerHTML += `
                    <tr>
                        <td>${itemName}</td>
                        <td>${stock}</td>
                        <td>${expiryVal || 'N/A'}</td>
                        <td>${badge}</td>
                    </tr>
                `;
            }
        });

        if (alertCount === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No stock or expiry alerts. Inventory is healthy!</td></tr>`;
        }
    });
}

// ==================== BULLETPROOF INVENTORY LOADER (branch-aware) ====================
// inventoryCache is nested: { branchId: { productId: item } }. We always listen to the
// whole /inventory node (all branches) so an Admin can flip between "All Branches"
// (aggregated, read-only) and any single branch (full CRUD) without re-subscribing.
function loadInventoryTable() {
    if (!currentStoreId) return;
    
    firebase.database().ref(`stores/${currentStoreId}/inventory`).off();
    firebase.database().ref(`stores/${currentStoreId}/inventory`).on('value', snapshot => {
        inventoryCache = {};
        snapshot.forEach(branchChild => {
            const branchId = branchChild.key;
            inventoryCache[branchId] = {};
            branchChild.forEach(prodChild => {
                const item = prodChild.val();
                if (item && typeof item === 'object') {
                    inventoryCache[branchId][prodChild.key] = item;
                }
            });
        });
        renderInventoryTable();
    });
}

function populateInventoryBranchFilter() {
    const select = document.getElementById('inventory-branch-filter');
    if (!select) return;

    let options = '';
    if (currentUserRole === 'Admin') {
        options += `<option value="all" ${currentInventoryBranchFilter === 'all' ? 'selected' : ''}>🌐 All Branches (combined, view-only)</option>`;
        Object.keys(branchesCache).forEach(id => {
            options += `<option value="${id}" ${currentInventoryBranchFilter === id ? 'selected' : ''}>${branchesCache[id].name}</option>`;
        });
        select.disabled = false;
    } else {
        // Non-admin staff are locked to their assigned branch
        options = `<option value="${currentBranch}" selected>${branchNameOf(currentBranch)}</option>`;
        select.disabled = true;
        currentInventoryBranchFilter = currentBranch;
    }
    select.innerHTML = options;
}

function onInventoryBranchFilterChange() {
    const select = document.getElementById('inventory-branch-filter');
    if (!select) return;
    currentInventoryBranchFilter = select.value;
    resetInventoryForm();
    renderInventoryTable();
}

function renderInventoryTable() {
    const tbody = document.getElementById('inventory-body');
    if (!tbody) return;

    const modeNote = document.getElementById('inventory-mode-note');
    const addProductBtn = document.getElementById('add-product-trigger-btn');
    const isAggregate = currentInventoryBranchFilter === 'all';

    if (modeNote) modeNote.style.display = isAggregate ? 'inline-block' : 'none';
    if (addProductBtn) addProductBtn.style.opacity = isAggregate ? '0.6' : '1';

    tbody.innerHTML = '';

    if (isAggregate) {
        // Combined enterprise view: sum stock for matching product names across all branches
        const combined = {}; // name -> { costPrice, price, wholesalePrice, stock, expiry, branches: {branchName: stock} }
        Object.keys(inventoryCache).forEach(branchId => {
            const branchName = branchNameOf(branchId);
            Object.values(inventoryCache[branchId] || {}).forEach(item => {
                const name = item.name || item.productName || 'Unnamed Item';
                const key = name.toLowerCase().trim();
                if (!combined[key]) {
                    combined[key] = { name, costPrice: item.costPrice || 0, price: item.price || item.retailPrice || 0, wholesalePrice: item.wholesalePrice || 0, stock: 0, expiry: item.expiry || item.expiryDate || 'N/A', branches: {} };
                }
                const stock = item.stock !== undefined ? item.stock : (item.stockQty || 0);
                combined[key].stock += Number(stock) || 0;
                combined[key].branches[branchName] = (combined[key].branches[branchName] || 0) + (Number(stock) || 0);
            });
        });

        const keys = Object.keys(combined);
        keys.forEach(key => {
            const item = combined[key];
            const branchBreakdown = Object.keys(item.branches).map(bn => `${bn}: ${item.branches[bn]}`).join(', ');
            tbody.innerHTML += `
                <tr>
                    <td>${item.name}</td>
                    <td>₦${Number(item.costPrice).toLocaleString()}</td>
                    <td>₦${Number(item.price).toLocaleString()}</td>
                    <td>₦${Number(item.wholesalePrice).toLocaleString()}</td>
                    <td>${item.stock} <br><small style="color:var(--text-muted);">${branchBreakdown}</small></td>
                    <td>${item.expiry}</td>
                    <td><small style="color:var(--text-muted);">Select a branch to edit</small></td>
                </tr>
            `;
        });

        if (keys.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No products found in any branch yet.</td></tr>`;
        }
        return;
    }

    const branchId = currentInventoryBranchFilter;
    const branchItems = inventoryCache[branchId] || {};
    const ids = Object.keys(branchItems);

    ids.forEach(id => {
        const item = branchItems[id];
        const pName = item.name || item.productName || item.title || item.itemName || 'Unnamed Item';
        const cPrice = item.costPrice !== undefined ? item.costPrice : (item.cost || 0);
        const rPrice = item.price !== undefined ? item.price : (item.retailPrice || 0);
        const wPrice = item.wholesalePrice !== undefined ? item.wholesalePrice : 0;
        const pStock = item.stock !== undefined ? item.stock : (item.stockQty !== undefined ? item.stockQty : 0);
        const pExpiry = item.expiry || item.expiryDate || 'N/A';

        tbody.innerHTML += `
            <tr>
                <td>${pName}</td>
                <td>₦${Number(cPrice).toLocaleString()}</td>
                <td>₦${Number(rPrice).toLocaleString()}</td>
                <td>₦${Number(wPrice).toLocaleString()}</td>
                <td>${pStock}</td>
                <td>${pExpiry}</td>
                <td>
                    <button class="menu-btn" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="editProduct('${branchId}','${id}')">Edit</button>
                    <button class="menu-btn btn-logout" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="deleteProduct('${branchId}','${id}')">Delete</button>
                </td>
            </tr>
        `;
    });

    if (ids.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No products found in ${branchNameOf(branchId)}. Add your first item above!</td></tr>`;
    }
}

function filterInventoryTable() {
    const query = (document.getElementById('inventory-search-input')?.value || '').toLowerCase().trim();
    if (!query) {
        renderInventoryTable();
        return;
    }

    const tbody = document.getElementById('inventory-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const isAggregate = currentInventoryBranchFilter === 'all';
    let matchCount = 0;

    if (isAggregate) {
        Object.keys(inventoryCache).forEach(branchId => {
            const branchName = branchNameOf(branchId);
            Object.values(inventoryCache[branchId] || {}).forEach(item => {
                const pName = item.name || item.productName || 'Unnamed Item';
                if (!pName.toLowerCase().includes(query)) return;
                matchCount++;
                const cPrice = item.costPrice || 0;
                const rPrice = item.price || item.retailPrice || 0;
                const wPrice = item.wholesalePrice || 0;
                const pStock = item.stock !== undefined ? item.stock : (item.stockQty || 0);
                const pExpiry = item.expiry || item.expiryDate || 'N/A';
                tbody.innerHTML += `
                    <tr>
                        <td>${pName} <br><small style="color:var(--text-muted);">${branchName}</small></td>
                        <td>₦${Number(cPrice).toLocaleString()}</td>
                        <td>₦${Number(rPrice).toLocaleString()}</td>
                        <td>₦${Number(wPrice).toLocaleString()}</td>
                        <td>${pStock}</td>
                        <td>${pExpiry}</td>
                        <td><small style="color:var(--text-muted);">Select a branch to edit</small></td>
                    </tr>
                `;
            });
        });
    } else {
        const branchId = currentInventoryBranchFilter;
        const branchItems = inventoryCache[branchId] || {};
        Object.keys(branchItems).forEach(id => {
            const item = branchItems[id];
            const pName = item.name || item.productName || 'Unnamed Item';
            if (!pName.toLowerCase().includes(query)) return;
            matchCount++;
            const cPrice = item.costPrice || 0;
            const rPrice = item.price || item.retailPrice || 0;
            const wPrice = item.wholesalePrice || 0;
            const pStock = item.stock !== undefined ? item.stock : (item.stockQty || 0);
            const pExpiry = item.expiry || item.expiryDate || 'N/A';
            tbody.innerHTML += `
                <tr>
                    <td>${pName}</td>
                    <td>₦${Number(cPrice).toLocaleString()}</td>
                    <td>₦${Number(rPrice).toLocaleString()}</td>
                    <td>₦${Number(wPrice).toLocaleString()}</td>
                    <td>${pStock}</td>
                    <td>${pExpiry}</td>
                    <td>
                        <button class="menu-btn" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="editProduct('${branchId}','${id}')">Edit</button>
                        <button class="menu-btn btn-logout" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="deleteProduct('${branchId}','${id}')">Delete</button>
                    </td>
                </tr>
            `;
        });
    }

    if (matchCount === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No matching products found.</td></tr>`;
    }
}

// ==================== PRODUCT FORM MODAL (Add / Edit) ====================
// The Add/Edit product form now lives in a popup modal instead of an inline card, so
// staff editing an item lower down the table don't have to scroll back up to reach it.
function openAddProductModal() {
    if (currentInventoryBranchFilter === 'all') {
        alert("Please select a specific branch before adding a new product — stock is tracked per branch.");
        return;
    }
    resetInventoryForm();
    document.getElementById('product-form-modal').style.display = 'flex';
}

function closeProductModal() {
    document.getElementById('product-form-modal').style.display = 'none';
}

// ==================== BULLETPROOF PRODUCT SAVER (branch-scoped) ====================
function saveProduct() {
    if (!currentStoreId) {
        alert("Error: No active Store ID found. Please log out and log back in.");
        return;
    }

    if (currentInventoryBranchFilter === 'all') {
        alert("Please select a specific branch before adding or editing products — stock is tracked per branch.");
        return;
    }

    const targetBranch = currentInventoryBranchFilter;
    const editId = document.getElementById('edit-product-id').value;
    const editBranch = document.getElementById('edit-product-branch').value || targetBranch;
    const name = document.getElementById('inv-name').value.trim();
    const costPrice = parseFloat(document.getElementById('inv-cost-price').value) || 0;
    const price = parseFloat(document.getElementById('inv-price').value) || 0;
    const wholesalePrice = parseFloat(document.getElementById('inv-wholesale-price').value) || 0;
    const stock = parseInt(document.getElementById('inv-stock').value) || 0;
    const expiry = document.getElementById('inv-expiry').value;

    if (!name) {
        alert("Please provide a product name.");
        return;
    }

    const prodData = { 
        name,
        productName: name,
        costPrice, 
        price, 
        retailPrice: price,
        wholesalePrice, 
        stock, 
        stockQty: stock,
        expiry,
        expiryDate: expiry,
        branchId: editId ? editBranch : targetBranch
    };

    const invRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${editId ? editBranch : targetBranch}`);

    if (editId) {
        invRef.child(editId).update(prodData).then(() => {
            alert("Product updated successfully!");
            resetInventoryForm();
            closeProductModal();
        }).catch(err => {
            alert("Failed to update product: " + err.message);
        });
    } else {
        const newRef = invRef.push();
        newRef.set(prodData).then(() => {
            alert(`Product saved successfully to ${branchNameOf(targetBranch)}!`);
            resetInventoryForm();
            closeProductModal();
        }).catch(err => {
            saveRecordLocallyOrCloud('offline_inventory_queue', prodData, `stores/${currentStoreId}/inventory/${targetBranch}`, () => {
                resetInventoryForm();
                closeProductModal();
            });
        });
    }
}

function editProduct(branchId, id) {
    const item = inventoryCache[branchId] && inventoryCache[branchId][id];
    if (!item) return;

    document.getElementById('edit-product-id').value = id;
    document.getElementById('edit-product-branch').value = branchId;
    document.getElementById('inv-name').value = item.name || item.productName || '';
    document.getElementById('inv-cost-price').value = item.costPrice || '';
    document.getElementById('inv-price').value = item.price || item.retailPrice || '';
    document.getElementById('inv-wholesale-price').value = item.wholesalePrice || '';
    document.getElementById('inv-stock').value = item.stock !== undefined ? item.stock : (item.stockQty || '');
    document.getElementById('inv-expiry').value = item.expiry || item.expiryDate || '';
    
    document.getElementById('inv-form-title').textContent = `Edit Product (${branchNameOf(branchId)})`;
    document.getElementById('save-product-btn').textContent = "Update Product";

    // Pop the form up as a modal right where the user is, instead of making them
    // scroll back up the page to find it.
    document.getElementById('product-form-modal').style.display = 'flex';
}

function resetInventoryForm() {
    document.getElementById('edit-product-id').value = '';
    document.getElementById('edit-product-branch').value = '';
    document.getElementById('inv-name').value = '';
    document.getElementById('inv-cost-price').value = '';
    document.getElementById('inv-price').value = '';
    document.getElementById('inv-wholesale-price').value = '';
    document.getElementById('inv-stock').value = '';
    document.getElementById('inv-expiry').value = '';
    
    document.getElementById('inv-form-title').textContent = "Add New Product";
    document.getElementById('save-product-btn').textContent = "Save Product to Cloud";
}

function deleteProduct(branchId, id) {
    if (confirm("Are you sure you want to delete this product?")) {
        firebase.database().ref(`stores/${currentStoreId}/inventory/${branchId}/${id}`).remove();
    }
}

// ==================== POS & CART REGISTER (branch-scoped) ====================
function setCustomerType(type) {
    currentCustomerType = type;
    const retailBtn = document.getElementById('btn-type-retail');
    const wholesaleBtn = document.getElementById('btn-type-wholesale');
    
    if (retailBtn && wholesaleBtn) {
        if (type === 'Wholesale') {
            wholesaleBtn.style.background = '#0284c7';
            wholesaleBtn.style.color = '#fff';
            retailBtn.style.background = '#e2e8f0';
            retailBtn.style.color = '#1e293b';
        } else {
            retailBtn.style.background = '#0284c7';
            retailBtn.style.color = '#fff';
            wholesaleBtn.style.background = '#e2e8f0';
            wholesaleBtn.style.color = '#1e293b';
        }
    }
    onPosProductChange();
}

// POS always sells from the logged-in user's active branch (currentBranch) — never
// the aggregate "All Branches" view, since a sale must draw down one physical location's stock.
function loadPosInventoryDropdown() {
    if (!currentStoreId) return;
    
    firebase.database().ref(`stores/${currentStoreId}/inventory/${currentBranch}`).once('value').then(snapshot => {
        const select = document.getElementById('pos-product-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">-- Choose Inventory Item --</option>';
        if (!inventoryCache[currentBranch]) inventoryCache[currentBranch] = {};

        snapshot.forEach(child => {
            const id = child.key;
            const item = child.val();
            inventoryCache[currentBranch][id] = item;
            
            const pName = item.name || item.productName || 'Unnamed Item';
            const pStock = item.stock !== undefined ? item.stock : (item.stockQty || 0);
            const rPrice = item.price || item.retailPrice || 0;
            const wPrice = item.wholesalePrice || 0;

            select.innerHTML += `<option value="${id}">${pName} (Stock: ${pStock}) - Retail: ₦${rPrice} | Wholesale: ₦${wPrice}</option>`;
        });
    });
}

function filterPosInventory() {
    const query = (document.getElementById('pos-search-input')?.value || '').toLowerCase().trim();
    const select = document.getElementById('pos-product-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- Choose Inventory Item --</option>';
    const branchItems = inventoryCache[currentBranch] || {};
    
    Object.keys(branchItems).forEach(id => {
        const item = branchItems[id];
        const pName = item.name || item.productName || 'Unnamed Item';
        const pStock = item.stock !== undefined ? item.stock : (item.stockQty || 0);
        const rPrice = item.price || item.retailPrice || 0;
        const wPrice = item.wholesalePrice || 0;

        if (pName.toLowerCase().includes(query)) {
            select.innerHTML += `<option value="${id}">${pName} (Stock: ${pStock}) - Retail: ₦${rPrice} | Wholesale: ₦${wPrice}</option>`;
        }
    });
}

function onPosProductChange() {
    const id = document.getElementById('pos-product-select').value;
    const priceInput = document.getElementById('pos-custom-price');
    const branchItems = inventoryCache[currentBranch] || {};
    if (id && branchItems[id]) {
        const item = branchItems[id];
        const rPrice = item.price || item.retailPrice || 0;
        const wPrice = item.wholesalePrice || rPrice;

        priceInput.value = (currentCustomerType === 'Wholesale') ? wPrice : rPrice;
    } else {
        priceInput.value = '';
    }
}

function addToCart() {
    const id = document.getElementById('pos-product-select').value;
    const qty = parseInt(document.getElementById('pos-qty').value) || 1;
    const customPrice = parseFloat(document.getElementById('pos-custom-price').value);
    const branchItems = inventoryCache[currentBranch] || {};

    if (!id || !branchItems[id]) {
        alert("Please select a valid product.");
        return;
    }

    const item = branchItems[id];
    const pName = item.name || item.productName || 'Unnamed Item';
    const pStock = item.stock !== undefined ? item.stock : (item.stockQty || 0);
    const rPrice = item.price || item.retailPrice || 0;
    const wPrice = item.wholesalePrice || rPrice;

    const price = !isNaN(customPrice) ? customPrice : (currentCustomerType === 'Wholesale' ? wPrice : rPrice);

    if (qty > pStock) {
        alert(`Warning: Requested quantity exceeds available stock (${pStock}).`);
    }

    currentCart.push({
        id,
        name: pName,
        qty,
        price,
        total: qty * price,
        customerType: currentCustomerType
    });

    renderCart();
}

function removeFromCart(index) {
    currentCart.splice(index, 1);
    renderCart();
}

function renderCart() {
    const tbody = document.getElementById('cart-body');
    const totalEl = document.getElementById('cart-total');
    if (!tbody || !totalEl) return;

    tbody.innerHTML = '';
    let grandTotal = 0;

    currentCart.forEach((cartItem, index) => {
        grandTotal += cartItem.total;
        tbody.innerHTML += `
            <tr>
                <td>${cartItem.name} <br><small style="color:var(--text-muted);">[${cartItem.customerType}]</small></td>
                <td>
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <button class="menu-btn" style="padding: 2px 6px; font-size: 10px; width: auto;" onclick="decreaseQty(${index})">-</button>
                        <span>${cartItem.qty}</span>
                        <button class="menu-btn" style="padding: 2px 6px; font-size: 10px; width: auto;" onclick="increaseQty(${index})">+</button>
                    </div>
                </td>
                <td>₦${cartItem.total.toLocaleString()}</td>
                <td><button class="menu-btn btn-logout" style="padding: 2px 6px; font-size: 10px; width:auto;" onclick="removeFromCart(${index})">X</button></td>
            </tr>
        `;
    });

    if (currentCart.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Cart is empty</td></tr>`;
    }

    totalEl.textContent = grandTotal.toLocaleString();
}

function increaseQty(index) {
    const item = currentCart[index];
    const branchItems = inventoryCache[currentBranch] || {};
    const stockItem = branchItems[item.id];
    const pStock = stockItem ? (stockItem.stock !== undefined ? stockItem.stock : (stockItem.stockQty || 0)) : 0;

    if (stockItem && item.qty + 1 > pStock) {
        alert(`Warning: Requested quantity exceeds available stock (${pStock}).`);
        return;
    }

    item.qty += 1;
    item.total = item.qty * item.price;
    renderCart();
}

function decreaseQty(index) {
    const item = currentCart[index];
    if (item.qty > 1) {
        item.qty -= 1;
        item.total = item.qty * item.price;
    } else {
        removeFromCart(index);
        return;
    }
    renderCart();
}

function submitOrderForAccountant() {
    if (currentUserRole === 'Accountant') {
        processDirectPosPayment();
        return;
    }

    if (currentCart.length === 0) {
        alert("Cart is empty. Add items before submitting.");
        return;
    }

    const txId = 'WD-' + Math.floor(100000 + Math.random() * 900000);
    const grandTotal = currentCart.reduce((sum, i) => sum + i.total, 0);
    
    const activeStaffName = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;

    const orderData = {
        txId,
        items: currentCart,
        totalAmount: grandTotal,
        staff: activeStaffName,
        soldBy: activeStaffName,
        date: new Date().toISOString(),
        status: 'Pending Verification',
        branchId: currentBranch,
        customerId: currentSelectedCustomer ? currentSelectedCustomer.id : null,
        customerName: currentSelectedCustomer ? currentSelectedCustomer.name : 'Walk-In Customer'
    };

    saveRecordLocallyOrCloud(
        'offline_pending_orders', 
        orderData, 
        `stores/${currentStoreId}/pendingOrders/${txId}`, 
        () => {
            alert(`Order sent to Accountant queue! Receipt ID: ${txId}`);
            currentCart = [];
            renderCart();
            loadPosInventoryDropdown();
            clearPosCustomer();
        }
    );
}

function processDirectPosPayment() {
    if (currentCart.length === 0) {
        alert("Cart is empty. Add items before checking out.");
        return;
    }

    const txId = 'WD-' + Math.floor(100000 + Math.random() * 900000);
    const grandTotal = currentCart.reduce((sum, i) => sum + i.total, 0);
    const activeStaffName = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;

    const orderData = {
        txId,
        items: currentCart,
        totalAmount: grandTotal,
        staff: activeStaffName,
        soldBy: activeStaffName,
        date: new Date().toISOString(),
        status: 'Pending Verification',
        branchId: currentBranch,
        customerId: currentSelectedCustomer ? currentSelectedCustomer.id : null,
        customerName: currentSelectedCustomer ? currentSelectedCustomer.name : 'Walk-In Customer'
    };

    // Temporarily push to pending/active processing so the split checkout can process it directly
    firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).set(orderData).then(() => {
        currentCart = [];
        renderCart();
        loadPosInventoryDropdown();
        openSplitModal(txId, grandTotal);
        clearPosCustomer();
    });
}

// ==================== ACCOUNTANT & QUEUE VERIFICATION (branch-scoped) ====================
function loadPendingOrdersQueue() {
    if (!currentStoreId) return;

    if (currentUserRole !== 'Accountant' && currentUserRole !== 'Cashier' && currentUserRole !== 'Admin') {
        return;
    }

    firebase.database().ref(`stores/${currentStoreId}/pendingOrders`).off();
    firebase.database().ref(`stores/${currentStoreId}/pendingOrders`).on('value', snapshot => {
        const tbody = document.getElementById('accountant-queue-body');
        if (!tbody) return;

        tbody.innerHTML = '';

        snapshot.forEach(child => {
            const order = child.val();
            // Accountants/Cashiers only ever process their own branch's queue. Admin sees
            // the queue for whichever branch they're currently standing in (see branch switcher).
            if ((order.branchId || 'main') !== currentBranch) return;

            if (order.status === 'Pending Verification') {
                tbody.innerHTML += `
                    <tr>
                        <td><strong>${order.txId}</strong>${order.customerName && order.customerName !== 'Walk-In Customer' ? `<br><small style="color:var(--text-muted);">👤 ${order.customerName}</small>` : ''}</td>
                        <td>${order.staff || order.soldBy || 'Staff'}</td>
                        <td>₦${Number(order.totalAmount || 0).toLocaleString()}</td>
                        <td><span style="color: #d97706; font-weight: bold;">Pending Payment</span></td>
                        <td>
                            <button class="menu-btn btn-action-primary" style="padding: 4px 10px; font-size: 11px; width: auto; display: inline-block;" onclick="openSplitModal('${order.txId}', ${order.totalAmount})">Process Payment 💳</button>
                            <button class="menu-btn btn-logout" style="padding: 4px 10px; font-size: 11px; width: auto; display: inline-block;" onclick="cancelPendingOrder('${order.txId}')">Cancel ✕</button>
                        </td>
                    </tr>
                `;
            }
        });

        if (tbody.innerHTML === '') {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 25px;">No pending payments in queue for ${branchNameOf(currentBranch)}.</td></tr>`;
        }
    }, error => {
        console.error("loadPendingOrdersQueue error:", error);
    });
}

// Cancels a pending (unpaid) order — used when a customer walks away before paying.
// No inventory reversal is needed here because stock is only deducted once payment
// is actually completed in completeSplitCheckout(). We log the cancellation for
// audit purposes before removing it from the live queue.
function cancelPendingOrder(txId) {
    const reason = prompt(`Cancel order ${txId}?\n\nOptional: enter a reason (e.g. "Customer changed mind", "Wrong item added"). Leave blank to skip.`);
    if (reason === null) return; // user pressed Cancel on the prompt itself

    firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            alert("This order is no longer in the pending queue (it may have already been processed or cancelled).");
            return;
        }

        const orderData = snapshot.val();
        const cancelledBy = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;

        const cancelledRecord = {
            ...orderData,
            status: 'Cancelled',
            cancelledBy,
            cancelledAt: new Date().toISOString(),
            cancelReason: reason || 'No reason given'
        };

        // Log it for record-keeping, then remove from the live pending queue
        firebase.database().ref(`stores/${currentStoreId}/cancelledOrders/${txId}`).set(cancelledRecord).then(() => {
            return firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).remove();
        }).then(() => {
            alert(`Order ${txId} has been cancelled.`);
        }).catch(err => {
            alert("Failed to cancel order: " + err.message);
        });
    });
}

// ==================== SPLIT PAYMENT & RECEIPT LOGIC ====================
function openSplitModal(txId, totalAmount) {
    const numericTotal = Number(totalAmount) || 0;
    currentActiveOrder = { txId, totalAmount: numericTotal, customerId: null, customerName: 'Walk-In Customer', branchId: currentBranch };
    
    document.getElementById('modal-tx-id-label').textContent = txId;
    document.getElementById('split-modal-total').textContent = numericTotal.toLocaleString();
    document.getElementById('split-cash').value = numericTotal;
    document.getElementById('split-transfer').value = 0;
    const creditInput = document.getElementById('split-credit');
    if (creditInput) creditInput.value = 0;

    const creditContainer = document.getElementById('split-credit-container');
    const custInfo = document.getElementById('split-modal-customer-info');

    // Look up the full pending order so we know whether a registered customer is attached
    firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).once('value').then(snapshot => {
        if (snapshot.exists()) {
            const order = snapshot.val();
            currentActiveOrder.customerId = order.customerId || null;
            currentActiveOrder.customerName = order.customerName || 'Walk-In Customer';
            currentActiveOrder.branchId = order.branchId || 'main';
        }

        if (currentActiveOrder.customerId && customersCache[currentActiveOrder.customerId]) {
            const c = customersCache[currentActiveOrder.customerId];
            const available = Math.max(0, (Number(c.creditLimit) || 0) - (Number(c.balance) || 0));
            if (custInfo) custInfo.innerHTML = `Customer: <strong>${c.name}</strong> &nbsp;|&nbsp; Current Balance: ₦${(Number(c.balance) || 0).toLocaleString()} &nbsp;|&nbsp; Credit Available: ₦${available.toLocaleString()}`;
            if (creditContainer) creditContainer.style.display = 'block';
        } else {
            if (custInfo) custInfo.innerHTML = `Customer: <strong>${currentActiveOrder.customerName}</strong> &nbsp;|&nbsp; Branch: <strong>${branchNameOf(currentActiveOrder.branchId)}</strong>`;
            if (creditContainer) creditContainer.style.display = 'none';
        }

        document.getElementById('split-modal').style.display = 'flex';
        calcSplit();
    });
}

function closeSplitModal() {
    document.getElementById('split-modal').style.display = 'none';
    currentActiveOrder = null;
}

function calcSplit() {
    let totalDue = parseFloat(document.getElementById('split-modal-total').innerText.replace(/,/g, '')) || 0;
    let cashVal = parseFloat(document.getElementById('split-cash').value) || 0;
    let transferVal = parseFloat(document.getElementById('split-transfer').value) || 0;

    const creditContainer = document.getElementById('split-credit-container');
    const creditVisible = creditContainer && creditContainer.style.display !== 'none';
    let creditVal = creditVisible ? (parseFloat(document.getElementById('split-credit').value) || 0) : 0;

    let totalPaid = cashVal + transferVal + creditVal;
    let statusField = document.getElementById('split-status');
    let acceptBtn = document.getElementById('dynamic-accept-print-btn');

    // Enforce the customer's credit limit before allowing the credit portion through
    if (creditVal > 0 && currentActiveOrder && currentActiveOrder.customerId && customersCache[currentActiveOrder.customerId]) {
        const c = customersCache[currentActiveOrder.customerId];
        const available = Math.max(0, (Number(c.creditLimit) || 0) - (Number(c.balance) || 0));
        if (creditVal > available) {
            statusField.value = `Status: Credit exceeds available limit (₦${available.toLocaleString()}) ⚠`;
            statusField.style.background = "#fef9c3";
            statusField.style.color = "#854d0e";
            acceptBtn.disabled = true;
            acceptBtn.style.opacity = "0.6";
            acceptBtn.style.cursor = "not-allowed";
            return;
        }
    }

    if (totalPaid === totalDue && totalDue > 0) {
        statusField.value = "Status: Balanced ✅";
        statusField.style.background = "#dcfce7";
        statusField.style.color = "#166534";
        
        acceptBtn.disabled = false;
        acceptBtn.style.opacity = "1";
        acceptBtn.style.cursor = "pointer";
    } else if (totalPaid > totalDue) {
        let excess = totalPaid - totalDue;
        statusField.value = `Status: Overpaid by ₦${excess.toLocaleString()} ⚠`;
        statusField.style.background = "#fef9c3";
        statusField.style.color = "#854d0e";
        
        acceptBtn.disabled = true;
        acceptBtn.style.opacity = "0.6";
        acceptBtn.style.cursor = "not-allowed";
    } else {
        let deficit = totalDue - totalPaid;
        statusField.value = `Status: Balance Remaining ₦${deficit.toLocaleString()}`;
        statusField.style.background = "#fee2e2";
        statusField.style.color = "#991b1b";
        
        acceptBtn.disabled = true;
        acceptBtn.style.opacity = "0.6";
        acceptBtn.style.cursor = "not-allowed";
    }
}

// ==================== UPDATED SPLIT CHECKOUT & INVENTORY DEDUCTION (branch-scoped) ====================
function completeSplitCheckout() {
    if (!currentActiveOrder) return;
    
    const cash = parseFloat(document.getElementById('split-cash').value) || 0;
    const transfer = parseFloat(document.getElementById('split-transfer').value) || 0;
    const creditContainer = document.getElementById('split-credit-container');
    const creditVisible = creditContainer && creditContainer.style.display !== 'none';
    const credit = creditVisible ? (parseFloat(document.getElementById('split-credit').value) || 0) : 0;

    const txId = currentActiveOrder.txId;
    const customerId = currentActiveOrder.customerId;
    const customerName = currentActiveOrder.customerName;
    
    closeSplitModal();
    
    firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).once('value').then(snapshot => {
        if (snapshot.exists()) {
            const orderData = snapshot.val();
            const branchId = orderData.branchId || 'main';
            orderData.status = 'Completed';
            orderData.paymentBreakdown = { cash, transfer, credit };
            orderData.date = new Date().toISOString();
            orderData.branchId = branchId;
            orderData.customerId = customerId;
            orderData.customerName = customerName;
            
            // 1. Save transaction and remove from pending queue
            firebase.database().ref(`stores/${currentStoreId}/transactions/${txId}`).set(orderData);
            firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).remove();

            // 2. DEDUCT INVENTORY FOR EACH SOLD ITEM (from the branch that made the sale)
            if (Array.isArray(orderData.items)) {
                orderData.items.forEach(cartItem => {
                    const productId = cartItem.id;
                    const soldQty = Number(cartItem.qty) || 0;

                    if (productId && soldQty > 0) {
                        const productRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${branchId}/${productId}`);
                        
                        productRef.once('value').then(prodSnap => {
                            if (prodSnap.exists()) {
                                const prodData = prodSnap.val();
                                let currentStock = Number(prodData.stock !== undefined ? prodData.stock : (prodData.stockQty || 0));
                                let newStock = Math.max(0, currentStock - soldQty);

                                productRef.update({
                                    stock: newStock,
                                    stockQty: newStock
                                });

                                if (inventoryCache[branchId] && inventoryCache[branchId][productId]) {
                                    inventoryCache[branchId][productId].stock = newStock;
                                    inventoryCache[branchId][productId].stockQty = newStock;
                                }
                            }
                        });
                    }
                });
            }

            // 3. CUSTOMER LEDGER, CREDIT BALANCE & LIFETIME VALUE UPDATE
            if (customerId) {
                const custRef = firebase.database().ref(`stores/${currentStoreId}/customers/${customerId}`);
                custRef.once('value').then(custSnap => {
                    if (custSnap.exists()) {
                        const c = custSnap.val();
                        const balanceBefore = Number(c.balance) || 0;
                        const balanceAfter = balanceBefore + credit;

                        custRef.update({
                            balance: balanceAfter,
                            totalSpent: (Number(c.totalSpent) || 0) + (Number(orderData.totalAmount) || 0),
                            visitCount: (Number(c.visitCount) || 0) + 1,
                            lastVisit: orderData.date
                        });

                        if (credit > 0) {
                            firebase.database().ref(`stores/${currentStoreId}/customers/${customerId}/ledger`).push({
                                type: 'credit_sale',
                                amount: credit,
                                balanceBefore,
                                balanceAfter,
                                date: orderData.date,
                                txId,
                                recordedBy: orderData.staff || orderData.soldBy || 'Staff',
                                note: `Credit portion of sale ${txId}`
                            });
                        }
                    }
                });
            }

            // 4. Render and print the receipt
            renderReceiptView(orderData, false);
        }
    }).catch(error => {
        console.error("completeSplitCheckout error:", error);
        alert("Failed to complete checkout: " + error.message);
    });
}

// ==================== FIXED RECEIPT & PRINTING ROUTINE ====================
function renderReceiptView(orderData, isReprint = false) {
    const mainWrapper = document.getElementById('dashboard-main-wrapper');
    if (mainWrapper) {
        mainWrapper.classList.add('active');
        mainWrapper.style.display = 'block';
    }

    const workspace = document.getElementById('workspace-content');
    const receiptTemplate = document.getElementById('receipt-view-template');
    
    if (!workspace || !receiptTemplate) {
        alert("Error: Receipt template view is missing from your HTML structure.");
        return;
    }

    workspace.innerHTML = receiptTemplate.innerHTML;
    
    setTimeout(() => {
        const txIdEl = workspace.querySelector('#receipt-tx-id');
        const dateEl = workspace.querySelector('#receipt-date');
        const totalEl = workspace.querySelector('#receipt-grand-total');
        const breakdownEl = workspace.querySelector('#receipt-payment-breakdown');

        if (txIdEl) txIdEl.textContent = orderData.txId || '--';
        if (dateEl) dateEl.textContent = orderData.date ? new Date(orderData.date).toLocaleString() : new Date().toLocaleString();
        
        const numericTotal = Number(orderData.totalAmount);
        if (totalEl) {
            totalEl.textContent = !isNaN(numericTotal) ? numericTotal.toLocaleString() : '0';
        }
        
        const cash = orderData.paymentBreakdown ? Number(orderData.paymentBreakdown.cash) || 0 : (!isNaN(numericTotal) ? numericTotal : 0);
        const transfer = orderData.paymentBreakdown ? Number(orderData.paymentBreakdown.transfer) || 0 : 0;
        const credit = orderData.paymentBreakdown ? Number(orderData.paymentBreakdown.credit) || 0 : 0;
        if (breakdownEl) {
            let breakdownText = `Cash: ₦${cash.toLocaleString()} | POS/Transfer: ₦${transfer.toLocaleString()}`;
            if (credit > 0) breakdownText += ` | Credit: ₦${credit.toLocaleString()}`;
            breakdownEl.textContent = breakdownText;
        }

        const reprintWatermark = workspace.querySelector('#reprintWatermark');
        if (reprintWatermark) {
            reprintWatermark.style.display = isReprint ? 'block' : 'none';
        }

        const printableBox = workspace.querySelector('#printable-receipt-box');
        let cashierRow = null;
        if (printableBox) {
            let cashierName = orderData.staff || orderData.soldBy || "Staff";
            cashierRow = printableBox.querySelector('#receipt-cashier-row');
            
            if (!cashierRow) {
                cashierRow = document.createElement('div');
                cashierRow.id = 'receipt-cashier-row';
                cashierRow.style.cssText = 'font-size: 12px; font-weight: bold; margin-bottom: 5px;';
                
                const dateElem = printableBox.querySelector('#receipt-date');
                if (dateElem && dateElem.parentNode) {
                    dateElem.parentNode.insertBefore(cashierRow, dateElem.nextSibling);
                } else {
                    printableBox.prepend(cashierRow);
                }
            }
            cashierRow.innerHTML = `Cashier: ${cashierName}${orderData.branchId ? ` &middot; Branch: ${branchNameOf(orderData.branchId)}` : ''}`;

            // Insert customer name row right after the cashier row when a registered
            // customer (not Walk-In) is attached to this sale
            let custRow = printableBox.querySelector('#receipt-customer-row');
            if (orderData.customerId && orderData.customerName) {
                if (!custRow) {
                    custRow = document.createElement('div');
                    custRow.id = 'receipt-customer-row';
                    custRow.style.cssText = 'font-size: 11px; color: #333; margin-bottom: 5px;';
                    cashierRow.parentNode.insertBefore(custRow, cashierRow.nextSibling);
                }
                custRow.innerHTML = `Customer: ${orderData.customerName}`;
            } else if (custRow) {
                custRow.remove();
            }
        }

        const receiptItemsContainer = workspace.querySelector('#receipt-items-body');
        if (receiptItemsContainer && orderData.items) {
            receiptItemsContainer.innerHTML = '';
            orderData.items.forEach(item => {
                const itemTotal = Number(item.total);
                const safeItemTotal = !isNaN(itemTotal) ? itemTotal.toLocaleString() : '0';
                receiptItemsContainer.innerHTML += `
                    <tr>
                        <td style="font-weight: bold;">${item.name || ''}</td>
                        <td>${item.qty || 0}</td>
                        <td>₦${safeItemTotal}</td>
                    </tr>
                `;
            });
        }

        if (printableBox && !printableBox.querySelector('.receipt-promo-footer')) {
            const promoDiv = document.createElement('div');
            promoDiv.className = 'receipt-promo-footer';
            promoDiv.style.cssText = 'text-align: center; margin-top: 15px; font-size: 11px; font-weight: bold; border-top: 1px dashed #ccc; padding-top: 10px;';
            promoDiv.innerHTML = 'FOR SIMILAR RECEIPT FOR YOUR BUSINESS: 09168140710';
            printableBox.appendChild(promoDiv);
        }

        if (currentStoreId) {
            firebase.database().ref(`stores/${currentStoreId}`).once('value').then(snapshot => {
                if (snapshot.exists()) {
                    const storeData = snapshot.val();
                    const nameEl = workspace.querySelector('#receipt-store-name');
                    const addressEl = workspace.querySelector('#receipt-store-address');
                    const phoneEl = workspace.querySelector('#receipt-store-phone');

                    if (nameEl) nameEl.textContent = storeData.businessName || "";
                    if (addressEl) addressEl.textContent = storeData.address || "";
                    if (phoneEl) phoneEl.textContent = storeData.phone ? `Tel: ${storeData.phone}` : "";
                    
                    triggerThermalPrint(printableBox.innerHTML);
                }
            }).catch(() => {
                triggerThermalPrint(printableBox.innerHTML);
            });
        } else {
            triggerThermalPrint(printableBox.innerHTML);
        }
    }, 150);
}

// ==================== DEDICATED THERMAL PRINTER IFRAME BRIDGE ====================
// Supports both 58mm and 80mm thermal paper widths. Defaults to 80mm; pass '58mm' as
// paperWidth when printing from a branch fitted with a 58mm printer.
function triggerThermalPrint(htmlContent, paperWidth = '80mm') {
    let existingIframe = document.getElementById('thermal-print-iframe');
    if (existingIframe) existingIframe.remove();

    let printWindow = document.createElement('iframe');
    printWindow.id = 'thermal-print-iframe';
    printWindow.style.position = 'absolute';
    printWindow.style.top = '-1000px';
    printWindow.style.left = '-1000px';
    printWindow.style.width = '0px';
    printWindow.style.height = '0px';
    document.body.appendChild(printWindow);

    const bodyWidth = paperWidth === '58mm' ? '50mm' : '72mm';

    let doc = printWindow.contentWindow.document;
    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Receipt Print</title>
            <style>
                body {
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 12px;
                    font-weight: bold;
                    width: ${bodyWidth};
                    margin: 0;
                    padding: 2mm;
                    color: #000000;
                    background: #ffffff;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                * {
                    font-weight: bold !important;
                    color: #000000 !important;
                }
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                    margin-top: 5px; 
                }
                th, td { 
                    padding: 4px 2px; 
                    text-align: left; 
                    font-size: 12px; 
                    border-bottom: 1px dashed #000000; 
                }
                .text-right { text-align: right; }
                .text-center { text-align: center; }
            </style>
        </head>
        <body>
            ${htmlContent}
        </body>
        </html>
    `);
    doc.close();

    setTimeout(() => {
        printWindow.contentWindow.focus();
        printWindow.contentWindow.print();
    }, 500);
}

function viewPastReceipt(txId) {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/transactions/${txId}`).once('value').then(snapshot => {
        if (snapshot.exists()) {
            renderReceiptView(snapshot.val(), true);
        } else {
            alert("Transaction record not found.");
        }
    });
}

// ==================== PAST SALES HISTORY & REPORTS (branch filterable) ====================
function populateReportsBranchFilter() {
    const select = document.getElementById('sales-branch-filter');
    if (!select) return;

    if (currentUserRole !== 'Admin') {
        // Non-admins never reach reports-view (blocked in switchView), but guard anyway.
        select.innerHTML = `<option value="${currentBranch}">${branchNameOf(currentBranch)}</option>`;
        select.disabled = true;
        currentReportBranchFilter = currentBranch;
        return;
    }

    let options = `<option value="all" ${currentReportBranchFilter === 'all' ? 'selected' : ''}>🌐 All Branches</option>`;
    Object.keys(branchesCache).forEach(id => {
        options += `<option value="${id}" ${currentReportBranchFilter === id ? 'selected' : ''}>${branchesCache[id].name}</option>`;
    });
    select.innerHTML = options;
    select.disabled = false;
}

function onReportsBranchFilterChange() {
    const select = document.getElementById('sales-branch-filter');
    if (!select) return;
    currentReportBranchFilter = select.value;
    loadPastSalesHistory(document.getElementById('sales-date-filter')?.value || null);
    loadProfitAndLossModule();
}

function loadPastSalesHistory(selectedDateString = null) {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/transactions`).off();
    firebase.database().ref(`stores/${currentStoreId}/transactions`).on('value', snapshot => {
        const tbody = document.getElementById('sales-history-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        let dayRevenue = 0;
        let weekRevenue = 0;
        let monthRevenue = 0;
        let totalCash = 0;
        let totalTransfer = 0;

        const targetDate = selectedDateString ? new Date(selectedDateString) : new Date();
        const targetYear = targetDate.getUTCFullYear();
        const targetMonth = targetDate.getUTCMonth();
        const targetDay = targetDate.getUTCDate();

        let selectedDayRevenue = 0;
        let selectedDayCash = 0;
        let selectedDayTransfer = 0;

        const now = new Date();
        const todayDateStr = now.toDateString();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const branchFilter = currentReportBranchFilter || 'all';

        snapshot.forEach(child => {
            const tx = child.val();
            const txBranch = tx.branchId || 'main';
            if (branchFilter !== 'all' && txBranch !== branchFilter) return;

            const txTotal = Number(tx.totalAmount) || 0;
            const txDate = tx.date ? new Date(tx.date) : null;

            if (txDate) {
                if (txDate.toDateString() === todayDateStr) {
                    dayRevenue += txTotal;
                }
                if (txDate >= startOfWeek) {
                    weekRevenue += txTotal;
                }
                if (txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth) {
                    monthRevenue += txTotal;
                }
            }

            const cashPaid = tx.paymentBreakdown ? Number(tx.paymentBreakdown.cash) || 0 : txTotal;
            const transferPaid = tx.paymentBreakdown ? Number(tx.paymentBreakdown.transfer) || 0 : 0;

            totalCash += cashPaid;
            totalTransfer += transferPaid;

            if (txDate) {
                if (txDate.getFullYear() === targetYear && txDate.getMonth() === targetMonth && txDate.getDate() === targetDay) {
                    selectedDayRevenue += txTotal;
                    selectedDayCash += cashPaid;
                    selectedDayTransfer += transferPaid;
                }
            }

            const dateStr = txDate ? txDate.toLocaleString() : 'N/A';
            const transactionId = tx.txId || child.key;
            const sellerName = tx.staff || tx.soldBy || 'Staff';
            const customerTag = tx.customerName && tx.customerName !== 'Walk-In Customer' ? `<br><small style="color:var(--text-muted);">👤 ${tx.customerName}</small>` : '';

            tbody.innerHTML += `
                <tr>
                    <td><strong>${transactionId}</strong>${customerTag}</td>
                    <td>${branchNameOf(txBranch)}</td>
                    <td>${dateStr}</td>
                    <td>${sellerName}</td>
                    <td>₦${txTotal.toLocaleString()}</td>
                    <td>Cash: ₦${cashPaid.toLocaleString()}<br>Transfer: ₦${transferPaid.toLocaleString()}</td>
                    <td><span style="color: green; font-weight: bold;">${tx.status || 'Completed'}</span></td>
                    <td>
                        <button class="menu-btn btn-action-primary" style="padding: 5px 10px; font-size: 11px; width: auto;" onclick="viewPastReceipt('${transactionId}')">View / Reprint</button>
                    </td>
                </tr>
            `;
        });

        if (tbody.innerHTML === '') {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">No past sales transactions found for this filter.</td></tr>`;
        }
        
        const dayEl = document.getElementById('todays-revenue-card') || document.getElementById('total-revenue-day-label');
        if (dayEl) dayEl.textContent = '₦' + selectedDayRevenue.toLocaleString();

        const cashEl = document.getElementById('total-cash-card') || document.getElementById('total-cash-label');
        if (cashEl) cashEl.textContent = '₦' + selectedDayCash.toLocaleString();

        const transferEl = document.getElementById('total-pos-card') || document.getElementById('total-transfer-label');
        if (transferEl) transferEl.textContent = '₦' + selectedDayTransfer.toLocaleString();

        const weekEl = document.getElementById('total-revenue-week-label');
        if (weekEl) weekEl.textContent = '₦' + weekRevenue.toLocaleString();

        const monthEl = document.getElementById('total-revenue-month-label');
        if (monthEl) monthEl.textContent = '₦' + monthRevenue.toLocaleString();
    });
}

function filterSalesByDate() {
    const datePickerVal = document.getElementById('sales-date-filter').value;
    if (datePickerVal) {
        loadPastSalesHistory(datePickerVal);
    }
}

function resetSalesDateFilter() {
    const dateInput = document.getElementById('sales-date-filter');
    if (dateInput) dateInput.value = '';
    loadPastSalesHistory(); 
}

function filterTransactions() {
    const input = document.getElementById('txidSearchInput');
    if (!input) return;
    const filter = input.value.toUpperCase();
    const table = document.getElementById('transactionTable');
    if (!table) return;
    const tr = table.getElementsByTagName('tr');

    for (let i = 1; i < tr.length; i++) {
        const td = tr[i].getElementsByTagName('td')[0];
        if (td) {
            const txtValue = td.textContent || td.innerText;
            if (txtValue.toUpperCase().indexOf(filter) > -1) {
                tr[i].style.display = "";
            } else {
                tr[i].style.display = "none";
            }
        }
    }
}

// ==================== MANUAL LOOKUP & UTILITIES ====================
function openManualLookupModal() {
    document.getElementById('manual-lookup-modal').style.display = 'flex';
}

function closeManualLookupModal() {
    document.getElementById('manual-lookup-modal').style.display = 'none';
}

function executeManualLookup() {
    const txId = document.getElementById('manual-tx-input').value.trim();
    if (!txId) {
        alert("Please enter a Receipt ID.");
        return;
    }

    firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).once('value').then(snapshot => {
        if (snapshot.exists()) {
            closeManualLookupModal();
            openSplitModal(txId, snapshot.val().totalAmount);
        } else {
            alert("Receipt ID not found in active pending queue.");
        }
    });
}

function downloadReceiptPDF() {
    const element = document.getElementById('printable-receipt-box');
    const opt = {
        margin: 5,
        filename: 'Receipt-' + document.getElementById('receipt-tx-id').textContent + '.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a6', orientation: 'portrait' }
    };
    html2pdf().from(element).set(opt).save();
}

// ==================== STAFF MANAGEMENT (branch assignment) ====================
function populateStaffBranchDropdown() {
    const select = document.getElementById('staff-branch-input');
    if (!select) return;
    let options = '';
    Object.keys(branchesCache).forEach(id => {
        options += `<option value="${id}">${branchesCache[id].name}</option>`;
    });
    select.innerHTML = options || `<option value="main">Main</option>`;
}

function loadStaffTable() {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/staff`).off();
    firebase.database().ref(`stores/${currentStoreId}/staff`).on('value', snapshot => {
        const tbody = document.getElementById('staff-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        snapshot.forEach(child => {
            const id = child.key;
            const staff = child.val();
            tbody.innerHTML += `
                <tr>
                    <td>${staff.name}</td>
                    <td>${staff.role}</td>
                    <td>${branchNameOf(staff.branchId || 'main')}</td>
                    <td><button class="menu-btn btn-logout" style="padding: 3px 8px; font-size:11px; width:auto;" onclick="deleteStaff('${id}')">Remove</button></td>
                </tr>
            `;
        });

        if (snapshot.numChildren() === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center;">No additional staff registered.</td></tr>`;
        }
    });
}

function addStaffMember() {
    if (currentUserRole !== 'Admin') {
        alert("Access Restricted: Only the Admin can add staff members.");
        return;
    }

    const name = document.getElementById('staff-name-input').value.trim();
    const pin = document.getElementById('staff-pin-input').value.trim();
    const role = document.getElementById('staff-role-input').value;
    const branchSelect = document.getElementById('staff-branch-input');
    const branchId = branchSelect && branchSelect.value ? branchSelect.value : 'main';

    if (!name || !pin) {
        alert("Staff Name and PIN are required.");
        return;
    }

    firebase.database().ref(`stores/${currentStoreId}/staff`).push({ name, pin, role, branchId }).then(() => {
        alert(`Staff member added successfully to ${branchNameOf(branchId)}!`);
        document.getElementById('staff-name-input').value = '';
        document.getElementById('staff-pin-input').value = '';
    });
}

function deleteStaff(id) {
    if (currentUserRole !== 'Admin') {
        alert("Access Restricted: Only the Admin can remove staff members.");
        return;
    }

    if (confirm("Remove this staff member?")) {
        firebase.database().ref(`stores/${currentStoreId}/staff/${id}`).remove();
    }
}

// ==================== BUSINESS SETTINGS & PROFILE ====================
function loadBusinessSettings() {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) return;
        const storeData = snapshot.val();

        const nameInput = document.getElementById('settings-store-name');
        const phoneInput = document.getElementById('settings-store-phone');
        const addressInput = document.getElementById('settings-store-address');

        if (nameInput) nameInput.value = storeData.businessName || '';
        if (phoneInput) phoneInput.value = storeData.phone || '';
        if (addressInput) addressInput.value = storeData.address || '';
    });
}

function updateBusinessProfile() {
    if (!currentStoreId) return;

    const businessName = document.getElementById('settings-store-name').value.trim();
    const phone = document.getElementById('settings-store-phone').value.trim();
    const address = document.getElementById('settings-store-address').value.trim();

    if (!businessName) {
        alert("Business name cannot be empty.");
        return;
    }

    firebase.database().ref(`stores/${currentStoreId}`).update({
        businessName,
        phone,
        address
    }).then(() => {
        alert("Business profile updated successfully!");
        document.getElementById('dashboard-store-title').textContent = businessName;
    }).catch(error => {
        alert("Failed to update profile. Please try again.");
    });
}

// ==================== EXPENSES MANAGEMENT MODULE (branch-scoped) ====================
function loadExpensesTable() {
    if (!currentStoreId) return;
    
    firebase.database().ref(`stores/${currentStoreId}/expenses`).off();
    firebase.database().ref(`stores/${currentStoreId}/expenses`).on('value', snapshot => {
        const tbody = document.getElementById('expenses-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        let totalExpenses = 0;

        snapshot.forEach(child => {
            const id = child.key;
            const item = child.val();
            if ((item.branchId || 'main') !== currentBranch) return;

            const amount = Number(item.amount) || 0;
            totalExpenses += amount;

            tbody.innerHTML += `
                <tr>
                    <td>${item.date ? new Date(item.date).toLocaleDateString() : 'N/A'}</td>
                    <td><strong>${item.category}</strong></td>
                    <td>${item.description || 'N/A'}</td>
                    <td>₦${amount.toLocaleString()}</td>
                    <td>${item.recordedBy || 'Admin'}</td>
                    <td>
                        <button class="menu-btn btn-logout" style="padding: 3px 8px; font-size:11px; width:auto;" onclick="deleteExpense('${id}')">Delete</button>
                    </td>
                </tr>
            `;
        });

        if (totalExpenses === 0 && tbody.innerHTML === '') {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No expenses recorded yet for ${branchNameOf(currentBranch)}.</td></tr>`;
        }

        const totalLabel = document.getElementById('total-expenses-label');
        if (totalLabel) {
            totalLabel.textContent = '₦' + totalExpenses.toLocaleString();
        }
    });
}

function saveExpense() {
    if (!currentStoreId) return;

    const category = document.getElementById('expense-category').value;
    const description = document.getElementById('expense-desc').value.trim();
    const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
    const dateInput = document.getElementById('expense-date').value;

    if (amount <= 0) {
        alert("Please enter a valid expense amount.");
        return;
    }

    const expenseData = {
        category,
        description,
        amount,
        date: dateInput ? new Date(dateInput).toISOString() : new Date().toISOString(),
        recordedBy: document.getElementById('user-role-label').textContent,
        branchId: currentBranch
    };

    firebase.database().ref(`stores/${currentStoreId}/expenses`).push(expenseData).then(() => {
        alert("Expense recorded successfully!");
        document.getElementById('expense-desc').value = '';
        document.getElementById('expense-amount').value = '';
        document.getElementById('expense-date').value = '';
        loadExpensesTable();
        loadProfitAndLossModule();
    });
}

function deleteExpense(id) {
    if (confirm("Are you sure you want to delete this expense record?")) {
        firebase.database().ref(`stores/${currentStoreId}/expenses/${id}`).remove().then(() => {
            loadExpensesTable();
            loadProfitAndLossModule();
        });
    }
}

// ==================== PROFIT & LOSS (P&L) ANALYTICS MODULE (branch filterable) ====================
function loadProfitAndLossModule() {
    if (!currentStoreId) return;

    const plBranchFilter = document.getElementById('sales-branch-filter') ? currentReportBranchFilter : currentBranch;
    const plLabel = document.getElementById('pl-branch-label');
    if (plLabel) plLabel.textContent = plBranchFilter === 'all' ? '(All Branches)' : `(${branchNameOf(plBranchFilter)})`;

    Promise.all([
        firebase.database().ref(`stores/${currentStoreId}/transactions`).once('value'),
        firebase.database().ref(`stores/${currentStoreId}/inventory`).once('value'),
        firebase.database().ref(`stores/${currentStoreId}/expenses`).once('value')
    ]).then(([txSnapshot, invSnapshot, expSnapshot]) => {
        
        // costPriceMap keyed by "branchId_productId" (exact) and by lowercased product
        // name (fallback, used e.g. after a stock transfer creates a new product id
        // at the destination branch).
        const costPriceMap = {};
        invSnapshot.forEach(branchChild => {
            const branchId = branchChild.key;
            branchChild.forEach(prodChild => {
                const item = prodChild.val();
                const cPrice = Number(item.costPrice) || 0;
                const itemName = item.name || item.productName || '';

                costPriceMap[`${branchId}_${prodChild.key}`] = cPrice;
                if (itemName) {
                    costPriceMap[itemName.toLowerCase().trim()] = cPrice;
                }
            });
        });

        let monthRevenue = 0, monthCost = 0, monthExpenses = 0;
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        txSnapshot.forEach(child => {
            const tx = child.val();
            const txBranch = tx.branchId || 'main';
            if (plBranchFilter !== 'all' && txBranch !== plBranchFilter) return;

            const txDate = tx.date ? new Date(tx.date) : null;
            const txTotal = Number(tx.totalAmount) || 0;

            let txCogs = 0;
            if (Array.isArray(tx.items)) {
                tx.items.forEach(cartItem => {
                    const unitCost = costPriceMap[`${txBranch}_${cartItem.id}`] || costPriceMap[(cartItem.name || '').toLowerCase().trim()] || 0;
                    txCogs += unitCost * (Number(cartItem.qty) || 1);
                });
            }

            if (txDate && txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth) {
                monthRevenue += txTotal;
                monthCost += txCogs;
            }
        });

        expSnapshot.forEach(child => {
            const exp = child.val();
            const expBranch = exp.branchId || 'main';
            if (plBranchFilter !== 'all' && expBranch !== plBranchFilter) return;

            const expDate = exp.date ? new Date(exp.date) : null;
            const amount = Number(exp.amount) || 0;

            if (expDate && expDate.getFullYear() === currentYear && expDate.getMonth() === currentMonth) {
                monthExpenses += amount;
            }
        });

        const monthGross = monthRevenue - monthCost;
        const monthNet = monthGross - monthExpenses;

        const netProfitDisplay = document.getElementById('net-profit-display');
        if (netProfitDisplay) {
            netProfitDisplay.textContent = '₦' + monthNet.toLocaleString();
            netProfitDisplay.style.color = monthNet >= 0 ? '#065f46' : '#dc2626';
        }
    });
}

// ==================== BRANCH MANAGEMENT MODULE ====================
// Data model (Firebase): stores/{storeId}/branches/{branchId} = { name, phone, address, isMain, createdAt }
function loadBranchesTable() {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/branches`).off('value');
    firebase.database().ref(`stores/${currentStoreId}/branches`).on('value', snapshot => {
        const tbody = document.getElementById('branches-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        snapshot.forEach(child => {
            const id = child.key;
            const b = child.val();
            tbody.innerHTML += `
                <tr>
                    <td><strong>${b.name}</strong>${b.isMain ? ' <span style="font-size:10px; color:#166534; background:#dcfce7; padding:2px 6px; border-radius:4px; border:1px solid #86efac;">MAIN</span>' : ''}</td>
                    <td>${b.phone || 'N/A'}</td>
                    <td>${b.address || 'N/A'}</td>
                    <td>
                        <button class="menu-btn" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="editBranch('${id}')">Edit</button>
                        ${!b.isMain ? `<button class="menu-btn btn-logout" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="deleteBranch('${id}')">Delete</button>` : ''}
                    </td>
                </tr>
            `;
        });

        if (snapshot.numChildren() === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">No branches yet.</td></tr>`;
        }
    });
}

function saveBranch() {
    if (!currentStoreId) return;
    if (currentUserRole !== 'Admin') {
        alert("Access Restricted: Only the Admin can manage branches.");
        return;
    }

    const editId = document.getElementById('edit-branch-id').value;
    const name = document.getElementById('branch-name-input').value.trim();
    const phone = document.getElementById('branch-phone-input').value.trim();
    const address = document.getElementById('branch-address-input').value.trim();

    if (!name) {
        alert("Branch name is required.");
        return;
    }

    const branchRef = firebase.database().ref(`stores/${currentStoreId}/branches`);

    if (editId) {
        branchRef.child(editId).update({ name, phone, address }).then(() => {
            alert("Branch updated successfully!");
            resetBranchForm();
        });
    } else {
        const newRef = branchRef.push();
        newRef.set({ name, phone, address, isMain: false, createdAt: new Date().toISOString() }).then(() => {
            alert(`Branch "${name}" created successfully!`);
            resetBranchForm();
        });
    }
}

function editBranch(id) {
    const b = branchesCache[id];
    if (!b) return;

    document.getElementById('edit-branch-id').value = id;
    document.getElementById('branch-name-input').value = b.name || '';
    document.getElementById('branch-phone-input').value = b.phone || '';
    document.getElementById('branch-address-input').value = b.address || '';
    document.getElementById('save-branch-btn').textContent = 'Update Branch';
    document.getElementById('cancel-branch-edit-btn').style.display = 'block';
}

function resetBranchForm() {
    document.getElementById('edit-branch-id').value = '';
    document.getElementById('branch-name-input').value = '';
    document.getElementById('branch-phone-input').value = '';
    document.getElementById('branch-address-input').value = '';
    document.getElementById('save-branch-btn').textContent = 'Save Branch';
    document.getElementById('cancel-branch-edit-btn').style.display = 'none';
}

function deleteBranch(id) {
    const b = branchesCache[id];
    if (!b) return;
    if (b.isMain) {
        alert("The Main branch cannot be deleted.");
        return;
    }

    if (confirm(`Delete branch "${b.name}"? Its inventory records will remain in the database but will no longer be selectable. Staff assigned to it should be reassigned first.`)) {
        firebase.database().ref(`stores/${currentStoreId}/branches/${id}`).remove();
    }
}

// ==================== INTER-BRANCH STOCK TRANSFERS MODULE ====================
// Data model (Firebase):
//   stores/{storeId}/transfers/{transferId} = {
//     fromBranch, toBranch, items: [{productId, name, qty}],
//     status: 'In Transit' | 'Completed' | 'Cancelled',
//     createdBy, createdAt, receivedBy, receivedAt
//   }
// Stock is deducted from the source branch the moment a transfer is dispatched, and
// only added to the destination branch once the receiving side confirms receipt —
// this keeps a truthful "goods in transit" state and avoids double-counting stock.
function loadTransfersView() {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/transfers`).off();
    firebase.database().ref(`stores/${currentStoreId}/transfers`).on('value', snapshot => {
        const tbody = document.getElementById('transfers-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        const rows = [];
        snapshot.forEach(child => rows.push({ id: child.key, ...child.val() }));
        rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        rows.forEach(t => {
            const itemsSummary = Array.isArray(t.items) ? t.items.map(i => `${i.name} x${i.qty}`).join(', ') : '';
            const statusColor = t.status === 'Completed' ? '#166534' : (t.status === 'Cancelled' ? '#991b1b' : '#b45309');
            let actions = `<button class="menu-btn btn-dash" style="padding:4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="printWaybill('${t.id}')">🖨 Waybill</button>`;

            if (t.status === 'In Transit') {
                actions += ` <button class="menu-btn btn-action-primary" style="padding:4px 8px; font-size:11px; width:auto; display:inline-block; background:#16a34a;" onclick="confirmTransferReceipt('${t.id}')">✅ Confirm Receipt</button>`;
                actions += ` <button class="menu-btn btn-logout" style="padding:4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="cancelTransfer('${t.id}')">✕ Cancel</button>`;
            }

            tbody.innerHTML += `
                <tr>
                    <td><strong>${t.id}</strong></td>
                    <td>${branchNameOf(t.fromBranch)}</td>
                    <td>${branchNameOf(t.toBranch)}</td>
                    <td style="max-width:220px;">${itemsSummary}</td>
                    <td><span style="color:${statusColor}; font-weight:bold;">${t.status}</span></td>
                    <td>${t.createdAt ? new Date(t.createdAt).toLocaleString() : 'N/A'}</td>
                    <td>${actions}</td>
                </tr>
            `;
        });

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">No stock transfers yet. Click "+ New Transfer" to dispatch goods between branches.</td></tr>`;
        }
    });
}

function openCreateTransferModal() {
    if (Object.keys(branchesCache).length < 2) {
        alert("You need at least two branches to create a stock transfer. Add another branch first.");
        return;
    }

    const fromSelect = document.getElementById('transfer-from-branch');
    const toSelect = document.getElementById('transfer-to-branch');
    let options = Object.keys(branchesCache).map(id => `<option value="${id}">${branchesCache[id].name}</option>`).join('');
    fromSelect.innerHTML = options;
    toSelect.innerHTML = options;

    // Default "From" to the branch the admin is currently in, "To" to a different one
    fromSelect.value = currentBranch;
    const otherBranch = Object.keys(branchesCache).find(id => id !== currentBranch);
    if (otherBranch) toSelect.value = otherBranch;

    document.getElementById('transfer-modal').style.display = 'flex';
    onTransferFromBranchChange();
}

function closeCreateTransferModal() {
    document.getElementById('transfer-modal').style.display = 'none';
}

function onTransferFromBranchChange() {
    const fromBranchId = document.getElementById('transfer-from-branch').value;
    const itemsList = document.getElementById('transfer-items-list');
    if (!itemsList) return;

    firebase.database().ref(`stores/${currentStoreId}/inventory/${fromBranchId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            itemsList.innerHTML = `<div style="text-align:center; color: var(--text-muted); font-size: 12px; padding: 10px;">No stock available at ${branchNameOf(fromBranchId)}.</div>`;
            return;
        }

        let html = '';
        snapshot.forEach(child => {
            const item = child.val();
            const stock = item.stock !== undefined ? item.stock : (item.stockQty || 0);
            if (stock <= 0) return;
            const name = item.name || item.productName || 'Unnamed Item';
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 4px; border-bottom:1px solid #f1f5f9; font-size:13px;">
                    <span>${name} <small style="color:var(--text-muted);">(Stock: ${stock})</small></span>
                    <input type="number" min="0" max="${stock}" value="0" data-product-id="${child.key}" data-product-name="${name}" data-max-stock="${stock}" class="transfer-qty-input" style="width:70px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:6px;">
                </div>
            `;
        });

        itemsList.innerHTML = html || `<div style="text-align:center; color: var(--text-muted); font-size: 12px; padding: 10px;">No stock available at ${branchNameOf(fromBranchId)}.</div>`;
    });
}

function createTransfer() {
    const fromBranch = document.getElementById('transfer-from-branch').value;
    const toBranch = document.getElementById('transfer-to-branch').value;

    if (fromBranch === toBranch) {
        alert("Source and destination branches must be different.");
        return;
    }

    const inputs = document.querySelectorAll('.transfer-qty-input');
    const items = [];
    let overStock = null;

    inputs.forEach(input => {
        const qty = parseInt(input.value) || 0;
        const maxStock = parseInt(input.getAttribute('data-max-stock')) || 0;
        if (qty > 0) {
            if (qty > maxStock) {
                overStock = input.getAttribute('data-product-name');
                return;
            }
            items.push({ productId: input.getAttribute('data-product-id'), name: input.getAttribute('data-product-name'), qty });
        }
    });

    if (overStock) {
        alert(`Quantity for "${overStock}" exceeds available stock at the source branch.`);
        return;
    }

    if (items.length === 0) {
        alert("Please enter a quantity greater than zero for at least one item.");
        return;
    }

    const transferId = 'TRF-' + Math.floor(100000 + Math.random() * 900000);
    const createdBy = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;
    const transferData = {
        fromBranch,
        toBranch,
        items,
        status: 'In Transit',
        createdBy,
        createdAt: new Date().toISOString()
    };

    // Deduct stock from the source branch immediately upon dispatch
    const updates = {};
    let deductionPromise = Promise.resolve();
    items.forEach(item => {
        deductionPromise = deductionPromise.then(() => {
            const productRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${fromBranch}/${item.productId}`);
            return productRef.once('value').then(snap => {
                if (!snap.exists()) return;
                const prod = snap.val();
                const currentStock = Number(prod.stock !== undefined ? prod.stock : (prod.stockQty || 0));
                const newStock = Math.max(0, currentStock - item.qty);
                return productRef.update({ stock: newStock, stockQty: newStock });
            });
        });
    });

    deductionPromise.then(() => {
        return firebase.database().ref(`stores/${currentStoreId}/transfers/${transferId}`).set(transferData);
    }).then(() => {
        alert(`Transfer waybill ${transferId} dispatched from ${branchNameOf(fromBranch)} to ${branchNameOf(toBranch)}!`);
        closeCreateTransferModal();
        switchView('transfers-view');
    }).catch(err => {
        alert("Failed to create transfer: " + err.message);
    });
}

function confirmTransferReceipt(transferId) {
    firebase.database().ref(`stores/${currentStoreId}/transfers/${transferId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) return;
        const t = snapshot.val();
        if (t.status !== 'In Transit') return;

        if (!confirm(`Confirm that ${branchNameOf(t.toBranch)} has received this shipment from ${branchNameOf(t.fromBranch)}? This will add the items to ${branchNameOf(t.toBranch)}'s stock.`)) return;

        const destRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${t.toBranch}`);

        let chain = Promise.resolve();
        (t.items || []).forEach(item => {
            chain = chain.then(() => {
                // Match by product name within the destination branch; if it doesn't
                // exist there yet, create it (copying price fields from the source item).
                return destRef.once('value').then(destSnap => {
                    let matchId = null;
                    destSnap.forEach(prodChild => {
                        const p = prodChild.val();
                        const pName = (p.name || p.productName || '').toLowerCase().trim();
                        if (pName === item.name.toLowerCase().trim()) matchId = prodChild.key;
                    });

                    if (matchId) {
                        const prodRef = destRef.child(matchId);
                        return prodRef.once('value').then(pSnap => {
                            const p = pSnap.val();
                            const newStock = (Number(p.stock !== undefined ? p.stock : (p.stockQty || 0))) + item.qty;
                            return prodRef.update({ stock: newStock, stockQty: newStock });
                        });
                    } else {
                        // Look up source item's pricing to carry over into the new destination record
                        return firebase.database().ref(`stores/${currentStoreId}/inventory/${t.fromBranch}/${item.productId}`).once('value').then(srcSnap => {
                            const src = srcSnap.exists() ? srcSnap.val() : {};
                            return destRef.push().set({
                                name: item.name,
                                productName: item.name,
                                costPrice: src.costPrice || 0,
                                price: src.price || src.retailPrice || 0,
                                retailPrice: src.price || src.retailPrice || 0,
                                wholesalePrice: src.wholesalePrice || 0,
                                stock: item.qty,
                                stockQty: item.qty,
                                expiry: src.expiry || src.expiryDate || '',
                                expiryDate: src.expiry || src.expiryDate || '',
                                branchId: t.toBranch
                            });
                        });
                    }
                });
            });
        });

        chain.then(() => {
            const receivedBy = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;
            return firebase.database().ref(`stores/${currentStoreId}/transfers/${transferId}`).update({
                status: 'Completed',
                receivedBy,
                receivedAt: new Date().toISOString()
            });
        }).then(() => {
            alert("Transfer confirmed — stock has been added to the destination branch.");
        }).catch(err => alert("Failed to confirm transfer: " + err.message));
    });
}

function cancelTransfer(transferId) {
    firebase.database().ref(`stores/${currentStoreId}/transfers/${transferId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) return;
        const t = snapshot.val();
        if (t.status !== 'In Transit') {
            alert("Only transfers still In Transit can be cancelled.");
            return;
        }

        if (!confirm(`Cancel this transfer and return the stock to ${branchNameOf(t.fromBranch)}?`)) return;

        const sourceRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${t.fromBranch}`);
        let chain = Promise.resolve();

        (t.items || []).forEach(item => {
            chain = chain.then(() => {
                const prodRef = sourceRef.child(item.productId);
                return prodRef.once('value').then(pSnap => {
                    if (!pSnap.exists()) return;
                    const p = pSnap.val();
                    const newStock = (Number(p.stock !== undefined ? p.stock : (p.stockQty || 0))) + item.qty;
                    return prodRef.update({ stock: newStock, stockQty: newStock });
                });
            });
        });

        chain.then(() => {
            return firebase.database().ref(`stores/${currentStoreId}/transfers/${transferId}`).update({ status: 'Cancelled' });
        }).then(() => {
            alert("Transfer cancelled and stock returned to the source branch.");
        }).catch(err => alert("Failed to cancel transfer: " + err.message));
    });
}

function printWaybill(transferId) {
    firebase.database().ref(`stores/${currentStoreId}/transfers/${transferId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) return;
        const t = snapshot.val();

        const mainWrapper = document.getElementById('dashboard-main-wrapper');
        if (mainWrapper) {
            mainWrapper.classList.add('active');
            mainWrapper.style.display = 'block';
        }

        const workspace = document.getElementById('workspace-content');
        const template = document.getElementById('waybill-view-template');
        if (!workspace || !template) return;
        workspace.innerHTML = template.innerHTML;

        setTimeout(() => {
            const setText = (id, val) => { const el = workspace.querySelector(id); if (el) el.textContent = val; };
            setText('#waybill-id', transferId);
            setText('#waybill-from', branchNameOf(t.fromBranch));
            setText('#waybill-to', branchNameOf(t.toBranch));
            setText('#waybill-date', t.createdAt ? new Date(t.createdAt).toLocaleString() : 'N/A');
            setText('#waybill-status', t.status);

            const itemsBody = workspace.querySelector('#waybill-items-body');
            if (itemsBody && Array.isArray(t.items)) {
                itemsBody.innerHTML = t.items.map(i => `<tr><td>${i.name}</td><td>${i.qty}</td></tr>`).join('');
            }
        }, 100);
    });
}

// ==================== SUPPLIER MANAGEMENT MODULE ====================
// Data model (Firebase):
//   stores/{storeId}/suppliers/{supplierId} = {
//     name, phone, email, address,
//     totalSupplied, supplyCount, lastSupplyDate, createdAt
//   }
//   stores/{storeId}/supplies/{supplyId} = {
//     supplyId, supplierId, supplierName, branchId,
//     items: [{name, qty, costPrice, retailPrice, wholesalePrice}],
//     totalCost, notes, date, recordedBy
//   }
// Recording a supply automatically pushes the received quantities into that branch's
// inventory — matching an existing product by name (updating stock + cost price), or
// creating a brand new product record if nothing matches yet.

function subscribeSuppliersCache() {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/suppliers`).off();
    firebase.database().ref(`stores/${currentStoreId}/suppliers`).on('value', snapshot => {
        suppliersCache = {};
        snapshot.forEach(child => { suppliersCache[child.key] = child.val(); });

        if (document.getElementById('suppliers-body')) {
            renderSuppliersTable(suppliersCache);
        }
    }, error => console.error("subscribeSuppliersCache error:", error));
}

function renderSuppliersTable(dataset) {
    const tbody = document.getElementById('suppliers-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const ids = Object.keys(dataset || {});

    ids.forEach(id => {
        const s = dataset[id];
        tbody.innerHTML += `
            <tr>
                <td><strong>${s.name || 'Unnamed'}</strong></td>
                <td>${s.phone || 'N/A'}</td>
                <td>₦${(Number(s.totalSupplied) || 0).toLocaleString()}</td>
                <td>${Number(s.supplyCount) || 0}</td>
                <td>${s.lastSupplyDate ? new Date(s.lastSupplyDate).toLocaleDateString() : 'N/A'}</td>
                <td>
                    <button class="menu-btn" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="openAddSupplierModal('${id}')">Edit</button>
                    <button class="menu-btn btn-logout" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="deleteSupplier('${id}')">Delete</button>
                </td>
            </tr>
        `;
    });

    if (ids.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No suppliers registered yet. Click "+ Add Supplier" to get started.</td></tr>`;
    }
}

function filterSuppliersTable() {
    const query = (document.getElementById('supplier-search-input')?.value || '').toLowerCase().trim();
    if (!query) {
        renderSuppliersTable(suppliersCache);
        return;
    }

    const filtered = {};
    Object.keys(suppliersCache).forEach(id => {
        const s = suppliersCache[id];
        if ((s.name || '').toLowerCase().includes(query) || (s.phone || '').includes(query)) {
            filtered[id] = s;
        }
    });
    renderSuppliersTable(filtered);
}

function openAddSupplierModal(editId = null) {
    document.getElementById('edit-supplier-id').value = editId || '';

    if (editId && suppliersCache[editId]) {
        const s = suppliersCache[editId];
        document.getElementById('supp-name').value = s.name || '';
        document.getElementById('supp-phone').value = s.phone || '';
        document.getElementById('supp-email').value = s.email || '';
        document.getElementById('supp-address').value = s.address || '';
        document.getElementById('supplier-form-title').textContent = 'Edit Supplier';
    } else {
        ['supp-name', 'supp-phone', 'supp-email', 'supp-address'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('supplier-form-title').textContent = 'Add New Supplier';
    }

    document.getElementById('supplier-form-modal').style.display = 'flex';
}

function closeSupplierModal() {
    document.getElementById('supplier-form-modal').style.display = 'none';
}

function saveSupplier() {
    if (!currentStoreId) return;

    const editId = document.getElementById('edit-supplier-id').value;
    const name = document.getElementById('supp-name').value.trim();
    const phone = document.getElementById('supp-phone').value.trim();
    const email = document.getElementById('supp-email').value.trim();
    const address = document.getElementById('supp-address').value.trim();

    if (!name || !phone) {
        alert("Supplier name and phone number are required.");
        return;
    }

    const suppRef = firebase.database().ref(`stores/${currentStoreId}/suppliers`);

    if (editId) {
        suppRef.child(editId).update({ name, phone, email, address }).then(() => {
            alert("Supplier updated successfully!");
            closeSupplierModal();
        }).catch(err => alert("Failed to update supplier: " + err.message));
    } else {
        suppRef.push().set({
            name,
            phone,
            email,
            address,
            totalSupplied: 0,
            supplyCount: 0,
            lastSupplyDate: null,
            createdAt: new Date().toISOString()
        }).then(() => {
            alert("Supplier added successfully!");
            closeSupplierModal();
        }).catch(err => alert("Failed to save supplier: " + err.message));
    }
}

function deleteSupplier(id) {
    const s = suppliersCache[id];
    if (!s) return;

    if (confirm(`Are you sure you want to delete supplier "${s.name}"? Past supply records will remain for your history.`)) {
        firebase.database().ref(`stores/${currentStoreId}/suppliers/${id}`).remove();
    }
}

// ---------- Record a New Supply (restocking) ----------
function populateSupplySupplierDropdown() {
    const select = document.getElementById('supply-supplier-select');
    if (!select) return;
    let options = '<option value="">-- Select Supplier --</option>';
    Object.keys(suppliersCache).forEach(id => {
        options += `<option value="${id}">${suppliersCache[id].name}</option>`;
    });
    select.innerHTML = options;
}

function populateSupplyBranchDropdown() {
    const select = document.getElementById('supply-branch-select');
    if (!select) return;
    let options = '';
    if (currentUserRole === 'Admin') {
        Object.keys(branchesCache).forEach(id => {
            options += `<option value="${id}" ${id === currentBranch ? 'selected' : ''}>${branchesCache[id].name}</option>`;
        });
    } else {
        options = `<option value="${currentBranch}" selected>${branchNameOf(currentBranch)}</option>`;
    }
    select.innerHTML = options || `<option value="main">Main</option>`;
}

function openRecordSupplyModal() {
    if (Object.keys(suppliersCache).length === 0) {
        alert("Please add at least one supplier first.");
        return;
    }

    populateSupplySupplierDropdown();
    populateSupplyBranchDropdown();
    document.getElementById('supply-notes').value = '';

    const itemsContainer = document.getElementById('supply-items-container');
    itemsContainer.innerHTML = '';
    supplyItemRowCounter = 0;
    addSupplyItemRow();

    refreshSupplyBranchProducts();
    document.getElementById('record-supply-modal').style.display = 'flex';
}

function closeRecordSupplyModal() {
    document.getElementById('record-supply-modal').style.display = 'none';
}

// Refreshes the list of existing product names for the currently-selected supply
// branch, so item rows can offer autocomplete suggestions (helps staff match an
// existing product instead of accidentally creating a duplicate).
function refreshSupplyBranchProducts() {
    if (!currentStoreId) return;
    const branchId = document.getElementById('supply-branch-select')?.value || currentBranch;

    firebase.database().ref(`stores/${currentStoreId}/inventory/${branchId}`).once('value').then(snapshot => {
        supplyBranchProductNames = [];
        snapshot.forEach(child => {
            const item = child.val();
            const n = item.name || item.productName || '';
            if (n) supplyBranchProductNames.push(n);
        });
        updateAllSupplyDatalists();
    });
}

function updateAllSupplyDatalists() {
    const options = supplyBranchProductNames.map(n => `<option value="${n}">`).join('');
    document.querySelectorAll('.supply-item-datalist').forEach(dl => { dl.innerHTML = options; });
}

function addSupplyItemRow() {
    supplyItemRowCounter++;
    const rowId = 'supply-row-' + supplyItemRowCounter;
    const options = supplyBranchProductNames.map(n => `<option value="${n}">`).join('');

    const container = document.getElementById('supply-items-container');
    const row = document.createElement('div');
    row.id = rowId;
    row.style.cssText = 'border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px; background:#f8fafc;';
    row.innerHTML = `
        <datalist id="${rowId}-datalist" class="supply-item-datalist">${options}</datalist>
        <div class="form-group" style="margin-bottom:6px;">
            <input type="text" list="${rowId}-datalist" placeholder="Product name (existing or new)" class="supply-item-name" style="width:100%; padding:6px; border:1px solid #cbd5e1; border-radius:6px;">
        </div>
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:6px;">
            <input type="number" min="1" placeholder="Qty Received" class="supply-item-qty" style="padding:6px; border:1px solid #cbd5e1; border-radius:6px;">
            <input type="number" min="0" placeholder="Cost Price (₦)" class="supply-item-cost" style="padding:6px; border:1px solid #cbd5e1; border-radius:6px;">
        </div>
        <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:6px; margin-top:6px;">
            <input type="number" min="0" placeholder="Retail Price (new items)" class="supply-item-retail" style="padding:6px; border:1px solid #cbd5e1; border-radius:6px;">
            <input type="number" min="0" placeholder="Wholesale Price (new items)" class="supply-item-wholesale" style="padding:6px; border:1px solid #cbd5e1; border-radius:6px;">
        </div>
        <button type="button" class="menu-btn btn-logout" style="width:auto; margin-top:6px; margin-bottom:0; padding:3px 10px; font-size:11px;" onclick="document.getElementById('${rowId}').remove()">✕ Remove Item</button>
    `;
    container.appendChild(row);
}

function saveSupply() {
    if (!currentStoreId) return;

    const supplierId = document.getElementById('supply-supplier-select').value;
    const branchId = document.getElementById('supply-branch-select').value;
    const notes = document.getElementById('supply-notes').value.trim();

    if (!supplierId || !suppliersCache[supplierId]) {
        alert("Please select a valid supplier.");
        return;
    }
    if (!branchId) {
        alert("Please select a destination branch.");
        return;
    }

    const rows = document.querySelectorAll('#supply-items-container > div');
    const items = [];
    let invalidRow = false;
    let totalCost = 0;

    rows.forEach(row => {
        const name = row.querySelector('.supply-item-name')?.value.trim() || '';
        const qty = parseInt(row.querySelector('.supply-item-qty')?.value) || 0;
        const cost = parseFloat(row.querySelector('.supply-item-cost')?.value) || 0;
        const retailRaw = row.querySelector('.supply-item-retail')?.value;
        const wholesaleRaw = row.querySelector('.supply-item-wholesale')?.value;

        if (!name && qty === 0) return; // skip a fully empty row

        if (!name || qty <= 0) {
            invalidRow = true;
            return;
        }

        items.push({
            name,
            qty,
            costPrice: cost,
            retailPrice: (retailRaw !== '' && retailRaw !== undefined) ? parseFloat(retailRaw) : null,
            wholesalePrice: (wholesaleRaw !== '' && wholesaleRaw !== undefined) ? parseFloat(wholesaleRaw) : null
        });
        totalCost += cost * qty;
    });

    if (invalidRow) {
        alert("Each item needs a product name and a quantity greater than zero.");
        return;
    }
    if (items.length === 0) {
        alert("Please add at least one item received in this supply.");
        return;
    }

    // Use Firebase's push() key instead of a random 6-digit number — random IDs can
    // collide, and a collision silently overwrites the earlier supply record (which
    // is why some supplies were disappearing from Supply History while the supplier's
    // running totals still updated). push() keys are guaranteed unique.
    const supplyId = 'SUP-' + firebase.database().ref(`stores/${currentStoreId}/supplies`).push().key;
    const recordedBy = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;
    const nowIso = new Date().toISOString();

    const invRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${branchId}`);

    // 1. Read current inventory (read-only) to work out what each item's stock
    //    level will be before/after this delivery — nothing is written yet.
    invRef.once('value').then(snapshot => {
        const existingByName = {};
        snapshot.forEach(child => {
            const item = child.val();
            const n = (item.name || item.productName || '').toLowerCase().trim();
            if (n) existingByName[n] = { id: child.key, data: item };
        });

        items.forEach(item => {
            const key = item.name.toLowerCase().trim();
            const match = existingByName[key];
            if (match) {
                const currentStock = Number(match.data.stock !== undefined ? match.data.stock : (match.data.stockQty || 0));
                item.stockBefore = currentStock;
                item.stockAfter = currentStock + item.qty;
                item._matchId = match.id;
            } else {
                item.stockBefore = 0;
                item.stockAfter = item.qty;
                item._matchId = null;
            }
        });

        const supplyData = {
            supplyId,
            supplierId,
            supplierName: suppliersCache[supplierId].name,
            branchId,
            items: items.map(({ _matchId, ...rest }) => rest), // internal-only field, not stored
            totalCost,
            notes,
            date: nowIso,
            recordedBy
        };

        // 2. Save the Purchase Order / Supply record FIRST. This is the permanent
        //    log — if this write fails for any reason (weak signal, permissions,
        //    etc.), we stop right here and touch nothing else, so a failure can
        //    never again look like a successful restock that's missing from history.
        return firebase.database().ref(`stores/${currentStoreId}/supplies/${supplyId}`).set(supplyData).then(() => {
            // 3. Only after the history record is safely saved do we apply the
            //    actual inventory changes.
            let chain = Promise.resolve();
            items.forEach(item => {
                chain = chain.then(() => {
                    if (item._matchId) {
                        const updateData = { stock: item.stockAfter, stockQty: item.stockAfter, costPrice: item.costPrice };
                        if (item.retailPrice !== null && !isNaN(item.retailPrice)) {
                            updateData.price = item.retailPrice;
                            updateData.retailPrice = item.retailPrice;
                        }
                        if (item.wholesalePrice !== null && !isNaN(item.wholesalePrice)) {
                            updateData.wholesalePrice = item.wholesalePrice;
                        }
                        return invRef.child(item._matchId).update(updateData);
                    } else {
                        return invRef.push().set({
                            name: item.name,
                            productName: item.name,
                            costPrice: item.costPrice,
                            price: item.retailPrice || 0,
                            retailPrice: item.retailPrice || 0,
                            wholesalePrice: item.wholesalePrice || 0,
                            stock: item.qty,
                            stockQty: item.qty,
                            expiry: '',
                            expiryDate: '',
                            branchId
                        });
                    }
                });
            });
            return chain;
        });
    }).then(() => {
        // 4. Update the supplier's running totals — last, since it's just a
        //    summary derived from the history record, not the source of truth.
        const supp = suppliersCache[supplierId];
        return firebase.database().ref(`stores/${currentStoreId}/suppliers/${supplierId}`).update({
            totalSupplied: (Number(supp.totalSupplied) || 0) + totalCost,
            supplyCount: (Number(supp.supplyCount) || 0) + 1,
            lastSupplyDate: nowIso
        });
    }).then(() => {
        alert(`Supply recorded successfully! Inventory at ${branchNameOf(branchId)} has been updated automatically.`);
        closeRecordSupplyModal();
        loadSuppliesHistory();
    }).catch(err => {
        console.error("saveSupply error:", err);
        alert("⚠️ This supply was NOT saved. Nothing was changed — please check your connection and try again.\n\nError: " + err.message);
    });
}

// Shows/hides the Purchase Order History panel on demand instead of always
// cluttering the Suppliers screen. The underlying data (stores/{storeId}/supplies)
// is already kept in sync in real time by loadSuppliesHistory()'s Firebase listener —
// every supply submitted through "Record New Supply" pushes straight into that
// persistent history the moment it's saved, so this button always shows the full,
// current record with nothing extra to trigger.
function togglePurchaseOrderHistory() {
    const section = document.getElementById('purchase-order-history-section');
    if (!section) return;

    const isHidden = section.style.display === 'none' || section.style.display === '';
    section.style.display = isHidden ? 'block' : 'none';

    if (isHidden) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function loadSuppliesHistory() {
    if (!currentStoreId) return;

    const suppliesRef = firebase.database().ref(`stores/${currentStoreId}/supplies`);
    suppliesRef.off(); // clear any previous listener so re-opening this view doesn't stack duplicates
    suppliesRef.on('value', snapshot => {
        const tbody = document.getElementById('supplies-history-body');
        if (!tbody) return;

        const rows = [];
        snapshot.forEach(child => rows.push(child.val()));
        rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        tbody.innerHTML = '';
        rows.forEach(s => {
            const itemCount = Array.isArray(s.items) ? s.items.length : 0;
            tbody.innerHTML += `
                <tr>
                    <td><strong>${s.supplyId || ''}</strong></td>
                    <td>${s.date ? new Date(s.date).toLocaleString() : 'N/A'}</td>
                    <td>${s.supplierName || 'N/A'}</td>
                    <td>${branchNameOf(s.branchId)}</td>
                    <td>${itemCount} item${itemCount === 1 ? '' : 's'}</td>
                    <td>₦${(Number(s.totalCost) || 0).toLocaleString()}</td>
                    <td>${s.recordedBy || ''}</td>
                    <td><button class="menu-btn btn-dash" style="padding: 4px 10px; font-size:11px; width:auto; display:inline-block;" onclick="viewSupplyDetails('${s.supplyId}')">View</button></td>
                </tr>
            `;
        });

        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">No supply records yet. Click "+ Record New Supply" to log stock received from a supplier.</td></tr>`;
        }
    });
}

// Shows a clean breakdown of one supply delivery: stock before vs after per item,
// so an admin can confirm exactly what changed instead of reading a crammed list.
function viewSupplyDetails(supplyId) {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/supplies/${supplyId}`).once('value').then(snapshot => {
        if (!snapshot.exists()) {
            alert("Supply record not found.");
            return;
        }
        const s = snapshot.val();

        document.getElementById('supply-details-id').textContent = s.supplyId || supplyId;
        document.getElementById('supply-details-date').textContent = s.date ? new Date(s.date).toLocaleString() : 'N/A';
        document.getElementById('supply-details-supplier').textContent = s.supplierName || 'N/A';
        document.getElementById('supply-details-branch').textContent = branchNameOf(s.branchId);
        document.getElementById('supply-details-recorder').textContent = s.recordedBy || 'N/A';

        const notesEl = document.getElementById('supply-details-notes');
        if (notesEl) notesEl.textContent = s.notes ? `📝 ${s.notes}` : '';

        const tbody = document.getElementById('supply-details-items-body');
        tbody.innerHTML = '';
        (s.items || []).forEach(item => {
            const lineTotal = (Number(item.costPrice) || 0) * (Number(item.qty) || 0);
            const hasStockHistory = item.stockBefore !== undefined && item.stockAfter !== undefined;
            tbody.innerHTML += `
                <tr>
                    <td>${item.name}</td>
                    <td>${hasStockHistory ? item.stockBefore : '—'}</td>
                    <td style="color:#166534; font-weight:bold;">+${item.qty}</td>
                    <td>${hasStockHistory ? item.stockAfter : '—'}</td>
                    <td>₦${(Number(item.costPrice) || 0).toLocaleString()}</td>
                    <td>₦${lineTotal.toLocaleString()}</td>
                </tr>
            `;
        });

        if (!s.items || s.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:15px;">No items recorded for this supply.</td></tr>`;
        }

        document.getElementById('supply-details-total-cost').textContent = '₦' + (Number(s.totalCost) || 0).toLocaleString();

        document.getElementById('supply-details-modal').style.display = 'flex';
    }).catch(err => {
        alert("Failed to load supply details: " + err.message);
    });
}

function closeSupplyDetailsModal() {
    document.getElementById('supply-details-modal').style.display = 'none';
}

// ==================== CUSTOMER MANAGEMENT MODULE ====================
// Data model (Firebase):
//   stores/{storeId}/customers/{customerId} = {
//     name, phone, email, address, creditLimit, balance,
//     totalSpent, visitCount, createdAt, lastVisit
//   }
//   stores/{storeId}/customers/{customerId}/ledger/{entryId} = {
//     type: 'credit_sale' | 'payment' | 'adjustment',
//     amount, balanceBefore, balanceAfter, date, txId, recordedBy, note
//   }
// Purchase history is derived by filtering stores/{storeId}/transactions by customerId
// rather than duplicating sale data under each customer record. Customers are shared
// across all branches so store credit follows the customer, not the branch.

// Subscribes once per session (called right after login) so the customer directory,
// POS autocomplete, and any open profile modal all stay live-updated together.
function subscribeCustomersCache() {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/customers`).off();
    firebase.database().ref(`stores/${currentStoreId}/customers`).on('value', snapshot => {
        customersCache = {};
        snapshot.forEach(child => {
            customersCache[child.key] = child.val();
        });

        if (document.getElementById('customers-body')) {
            renderCustomersTable(customersCache);
            updateCustomerStatsUI();
        }

        // Keep an attached POS customer's live balance/limit in sync
        if (currentSelectedCustomer && customersCache[currentSelectedCustomer.id]) {
            const c = customersCache[currentSelectedCustomer.id];
            currentSelectedCustomer.balance = Number(c.balance) || 0;
            currentSelectedCustomer.creditLimit = Number(c.creditLimit) || 0;
            updatePosCustomerBadge();
        }

        // Refresh an open profile modal if it's showing this customer
        if (currentProfileCustomerId && customersCache[currentProfileCustomerId] && document.getElementById('customer-profile-modal') && document.getElementById('customer-profile-modal').style.display === 'flex') {
            refreshCustomerProfileSummary(currentProfileCustomerId);
        }
    }, error => {
        console.error("subscribeCustomersCache error:", error);
    });
}

function updateCustomerStatsUI() {
    let totalDebt = 0, owingCount = 0;
    Object.keys(customersCache).forEach(id => {
        const bal = Number(customersCache[id].balance) || 0;
        if (bal > 0) { totalDebt += bal; owingCount++; }
    });

    const countEl = document.getElementById('cust-total-count');
    const debtEl = document.getElementById('cust-total-debt');
    const owingEl = document.getElementById('cust-owing-count');
    if (countEl) countEl.textContent = Object.keys(customersCache).length;
    if (debtEl) debtEl.textContent = '₦' + totalDebt.toLocaleString();
    if (owingEl) owingEl.textContent = owingCount;
}

function renderCustomersTable(dataset) {
    const tbody = document.getElementById('customers-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    const ids = Object.keys(dataset || {});

    ids.forEach(id => {
        const c = dataset[id];
        const balance = Number(c.balance) || 0;
        const limit = Number(c.creditLimit) || 0;
        const spent = Number(c.totalSpent) || 0;
        const visits = Number(c.visitCount) || 0;
        const balanceColor = balance > 0 ? '#b91c1c' : '#166534';

        tbody.innerHTML += `
            <tr>
                <td><strong>${c.name || 'Unnamed'}</strong></td>
                <td>${c.phone || 'N/A'}</td>
                <td style="color:${balanceColor}; font-weight:bold;">₦${balance.toLocaleString()}</td>
                <td>₦${limit.toLocaleString()}</td>
                <td>₦${spent.toLocaleString()}</td>
                <td>${visits}</td>
                <td>
                    <button class="menu-btn btn-dash" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="openCustomerProfile('${id}')">View</button>
                    <button class="menu-btn" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="openAddCustomerModal('${id}')">Edit</button>
                    <button class="menu-btn btn-logout" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="deleteCustomer('${id}')">Delete</button>
                </td>
            </tr>
        `;
    });

    if (ids.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No customers registered yet. Click "Add New Customer" to get started.</td></tr>`;
    }
}

function filterCustomersTable() {
    const query = (document.getElementById('customer-search-input')?.value || '').toLowerCase().trim();
    if (!query) {
        renderCustomersTable(customersCache);
        return;
    }

    const filtered = {};
    Object.keys(customersCache).forEach(id => {
        const c = customersCache[id];
        if ((c.name || '').toLowerCase().includes(query) || (c.phone || '').includes(query)) {
            filtered[id] = c;
        }
    });
    renderCustomersTable(filtered);
}

function openAddCustomerModal(editId = null) {
    document.getElementById('edit-customer-id').value = editId || '';

    if (editId && customersCache[editId]) {
        const c = customersCache[editId];
        document.getElementById('cust-name').value = c.name || '';
        document.getElementById('cust-phone').value = c.phone || '';
        document.getElementById('cust-email').value = c.email || '';
        document.getElementById('cust-address').value = c.address || '';
        document.getElementById('cust-credit-limit').value = c.creditLimit || '';
        document.getElementById('customer-form-title').textContent = 'Edit Customer';
    } else {
        ['cust-name', 'cust-phone', 'cust-email', 'cust-address', 'cust-credit-limit'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        document.getElementById('customer-form-title').textContent = 'Add New Customer';
    }

    document.getElementById('customer-form-modal').style.display = 'flex';
}

function closeAddCustomerModal() {
    document.getElementById('customer-form-modal').style.display = 'none';
}

function saveCustomer() {
    if (!currentStoreId) return;

    const editId = document.getElementById('edit-customer-id').value;
    const name = document.getElementById('cust-name').value.trim();
    const phone = document.getElementById('cust-phone').value.trim();
    const email = document.getElementById('cust-email').value.trim();
    const address = document.getElementById('cust-address').value.trim();
    const creditLimit = parseFloat(document.getElementById('cust-credit-limit').value) || 0;

    if (!name || !phone) {
        alert("Customer name and phone number are required.");
        return;
    }

    const custRef = firebase.database().ref(`stores/${currentStoreId}/customers`);

    if (editId) {
        custRef.child(editId).update({ name, phone, email, address, creditLimit }).then(() => {
            alert("Customer updated successfully!");
            closeAddCustomerModal();
        }).catch(err => alert("Failed to update customer: " + err.message));
    } else {
        const newRef = custRef.push();
        newRef.set({
            name,
            phone,
            email,
            address,
            creditLimit,
            balance: 0,
            totalSpent: 0,
            visitCount: 0,
            createdAt: new Date().toISOString()
        }).then(() => {
            alert("Customer added successfully!");
            closeAddCustomerModal();
        }).catch(err => alert("Failed to save customer: " + err.message));
    }
}

function deleteCustomer(id) {
    const c = customersCache[id];
    if (!c) return;

    if (Number(c.balance) > 0) {
        if (!confirm(`Warning: ${c.name} has an outstanding balance of ₦${Number(c.balance).toLocaleString()}. Delete this customer anyway?`)) return;
    } else if (!confirm(`Are you sure you want to delete ${c.name}?`)) {
        return;
    }

    firebase.database().ref(`stores/${currentStoreId}/customers/${id}`).remove();
}

// ---------- Customer Profile (ledger + purchase history + lifetime value) ----------
function openCustomerProfile(id) {
    const c = customersCache[id];
    if (!c) return;

    currentProfileCustomerId = id;
    refreshCustomerProfileSummary(id);
    loadCustomerLedger(id);
    loadCustomerPurchaseHistory(id);

    document.getElementById('customer-profile-modal').style.display = 'flex';
}

function refreshCustomerProfileSummary(id) {
    const c = customersCache[id];
    if (!c) return;

    const setText = (elId, val) => { const el = document.getElementById(elId); if (el) el.textContent = val; };

    setText('profile-cust-name', c.name || 'Unnamed');
    setText('profile-cust-phone', c.phone || 'N/A');
    setText('profile-cust-email', c.email || 'N/A');
    setText('profile-cust-address', c.address || 'N/A');
    setText('profile-cust-balance', '₦' + (Number(c.balance) || 0).toLocaleString());
    setText('profile-cust-limit', '₦' + (Number(c.creditLimit) || 0).toLocaleString());
    setText('profile-cust-spent', '₦' + (Number(c.totalSpent) || 0).toLocaleString());
    setText('profile-cust-visits', Number(c.visitCount) || 0);

    const payBtn = document.getElementById('profile-record-payment-btn');
    if (payBtn) payBtn.style.display = (Number(c.balance) > 0) ? 'inline-block' : 'none';
}

function closeCustomerProfileModal() {
    document.getElementById('customer-profile-modal').style.display = 'none';
    currentProfileCustomerId = null;
}

function loadCustomerLedger(id) {
    const tbody = document.getElementById('profile-ledger-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Loading ledger...</td></tr>';

    firebase.database().ref(`stores/${currentStoreId}/customers/${id}/ledger`).once('value').then(snapshot => {
        const entries = [];
        snapshot.forEach(child => entries.push(child.val()));
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = '';
        entries.forEach(entry => {
            const isPayment = entry.type === 'payment';
            const typeLabel = isPayment ? '💵 Payment' : (entry.type === 'credit_sale' ? '🛒 Credit Sale' : '✏ Adjustment');
            const amtColor = isPayment ? '#166534' : '#b91c1c';
            const amtSign = isPayment ? '-' : '+';

            tbody.innerHTML += `
                <tr>
                    <td>${entry.date ? new Date(entry.date).toLocaleString() : 'N/A'}</td>
                    <td>${typeLabel}</td>
                    <td style="color:${amtColor}; font-weight:bold;">${amtSign}₦${Number(entry.amount || 0).toLocaleString()}</td>
                    <td>₦${Number(entry.balanceAfter || 0).toLocaleString()}</td>
                    <td>${entry.note || ''}</td>
                </tr>
            `;
        });

        if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:15px;">No ledger activity yet.</td></tr>';
        }
    });
}

function loadCustomerPurchaseHistory(id) {
    const tbody = document.getElementById('profile-purchases-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">Loading purchase history...</td></tr>';

    firebase.database().ref(`stores/${currentStoreId}/transactions`).once('value').then(snapshot => {
        const purchases = [];
        snapshot.forEach(child => {
            const tx = child.val();
            if (tx.customerId === id) purchases.push(tx);
        });
        purchases.sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = '';
        purchases.forEach(tx => {
            const itemsSummary = Array.isArray(tx.items) ? tx.items.map(i => `${i.name} x${i.qty}`).join(', ') : '';
            tbody.innerHTML += `
                <tr>
                    <td>${tx.date ? new Date(tx.date).toLocaleString() : 'N/A'}</td>
                    <td><strong>${tx.txId || ''}</strong> <br><small style="color:var(--text-muted);">${branchNameOf(tx.branchId || 'main')}</small></td>
                    <td style="max-width:220px;">${itemsSummary}</td>
                    <td>₦${Number(tx.totalAmount || 0).toLocaleString()}</td>
                </tr>
            `;
        });

        if (purchases.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:15px;">No purchase history yet.</td></tr>';
        }
    });
}

function startSaleForCustomer() {
    const id = currentProfileCustomerId;
    if (!id || !customersCache[id]) return;
    selectPosCustomer(id);
    closeCustomerProfileModal();
    switchView('pos-view');
}

// ---------- Debt Repayment (full or partial) & Receipt ----------
function openDebtPaymentModal() {
    const id = currentProfileCustomerId;
    const c = customersCache[id];
    if (!c) return;

    document.getElementById('debt-payment-customer-id').value = id;
    document.getElementById('debt-payment-cust-name').textContent = c.name || 'Customer';
    document.getElementById('debt-payment-current-balance').textContent = '₦' + (Number(c.balance) || 0).toLocaleString();
    document.getElementById('debt-payment-amount').value = Number(c.balance) || 0;
    document.getElementById('debt-payment-method').value = 'Cash';

    updateDebtPaymentPreview();
    document.getElementById('debt-payment-modal').style.display = 'flex';
}

function closeDebtPaymentModal() {
    document.getElementById('debt-payment-modal').style.display = 'none';
}

function updateDebtPaymentPreview() {
    const id = document.getElementById('debt-payment-customer-id').value;
    const c = customersCache[id];
    if (!c) return;

    const balance = Number(c.balance) || 0;
    const amount = parseFloat(document.getElementById('debt-payment-amount').value) || 0;
    const remaining = Math.max(0, balance - amount);

    const preview = document.getElementById('debt-payment-remaining-preview');
    if (preview) preview.textContent = '₦' + remaining.toLocaleString();

    const warn = document.getElementById('debt-payment-warning');
    const confirmBtn = document.getElementById('debt-payment-confirm-btn');
    if (warn) {
        if (amount <= 0) {
            warn.style.display = 'block';
            warn.textContent = 'Enter a payment amount greater than zero.';
            if (confirmBtn) confirmBtn.disabled = true;
        } else if (amount > balance) {
            warn.style.display = 'block';
            warn.textContent = `Amount exceeds the outstanding balance by ₦${(amount - balance).toLocaleString()}.`;
            if (confirmBtn) confirmBtn.disabled = true;
        } else {
            warn.style.display = 'none';
            if (confirmBtn) confirmBtn.disabled = false;
        }
    }
}

function processDebtPayment() {
    const id = document.getElementById('debt-payment-customer-id').value;
    const c = customersCache[id];
    if (!c) return;

    const amount = parseFloat(document.getElementById('debt-payment-amount').value) || 0;
    const method = document.getElementById('debt-payment-method').value;

    if (amount <= 0) {
        alert("Please enter a valid payment amount.");
        return;
    }

    const balanceBefore = Number(c.balance) || 0;
    if (amount > balanceBefore) {
        alert("Payment amount cannot exceed the outstanding balance.");
        return;
    }

    const balanceAfter = Math.max(0, balanceBefore - amount);
    const recordedBy = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;
    const nowIso = new Date().toISOString();

    const ledgerEntry = {
        type: 'payment',
        amount,
        method,
        balanceBefore,
        balanceAfter,
        date: nowIso,
        recordedBy,
        note: `Debt repayment via ${method}`
    };

    const custRef = firebase.database().ref(`stores/${currentStoreId}/customers/${id}`);
    custRef.update({ balance: balanceAfter }).then(() => {
        return firebase.database().ref(`stores/${currentStoreId}/customers/${id}/ledger`).push(ledgerEntry);
    }).then(() => {
        closeDebtPaymentModal();
        closeCustomerProfileModal();

        renderDebtReceiptView({
            customerName: c.name,
            balanceBefore,
            amountPaid: amount,
            balanceAfter,
            method,
            date: nowIso,
            recordedBy
        });
    }).catch(err => {
        alert("Failed to record payment: " + err.message);
    });
}

// ---------- Debt Repayment Receipt (thermal-compatible) ----------
function renderDebtReceiptView(paymentData) {
    const mainWrapper = document.getElementById('dashboard-main-wrapper');
    if (mainWrapper) {
        mainWrapper.classList.add('active');
        mainWrapper.style.display = 'block';
    }

    const workspace = document.getElementById('workspace-content');
    const template = document.getElementById('debt-receipt-view-template');
    if (!workspace || !template) return;

    workspace.innerHTML = template.innerHTML;

    setTimeout(() => {
        const setText = (sel, val) => {
            const el = workspace.querySelector(sel);
            if (el) el.textContent = val;
        };

        const paymentReceiptId = 'PMT-' + Math.floor(100000 + Math.random() * 900000);

        setText('#debt-receipt-tx-id', paymentReceiptId);
        setText('#debt-receipt-date', new Date(paymentData.date).toLocaleString());
        setText('#debt-receipt-customer-name', paymentData.customerName || 'Customer');
        setText('#debt-receipt-cashier', paymentData.recordedBy || '');
        setText('#debt-receipt-prev-balance', Number(paymentData.balanceBefore).toLocaleString());
        setText('#debt-receipt-amount-paid', Number(paymentData.amountPaid).toLocaleString());
        setText('#debt-receipt-remaining-balance', Number(paymentData.balanceAfter).toLocaleString());
        setText('#debt-receipt-method', paymentData.method || 'Cash');

        const printableBox = workspace.querySelector('#printable-debt-receipt-box');

        if (currentStoreId && printableBox) {
            firebase.database().ref(`stores/${currentStoreId}`).once('value').then(snapshot => {
                if (snapshot.exists()) {
                    const storeData = snapshot.val();
                    setText('#debt-receipt-store-name', storeData.businessName || "");
                    setText('#debt-receipt-store-address', storeData.address || "");
                    setText('#debt-receipt-store-phone', storeData.phone ? `Tel: ${storeData.phone}` : "");
                }
                triggerThermalPrint(printableBox.innerHTML);
            }).catch(() => triggerThermalPrint(printableBox.innerHTML));
        }
    }, 150);
}

function downloadDebtReceiptPDF() {
    const element = document.getElementById('printable-debt-receipt-box');
    if (!element) return;
    const opt = {
        margin: 5,
        filename: 'Payment-' + (document.getElementById('debt-receipt-tx-id')?.textContent || 'receipt') + '.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a6', orientation: 'portrait' }
    };
    html2pdf().from(element).set(opt).save();
}

// ---------- POS Customer Selection & Autocomplete (defaults to Walk-In) ----------
function filterPosCustomerSearch() {
    const query = (document.getElementById('pos-customer-search')?.value || '').toLowerCase().trim();
    const resultsBox = document.getElementById('pos-customer-results');
    if (!resultsBox) return;

    if (!query) {
        resultsBox.style.display = 'none';
        resultsBox.innerHTML = '';
        return;
    }

    const matches = Object.keys(customersCache).filter(id => {
        const c = customersCache[id];
        return (c.name || '').toLowerCase().includes(query) || (c.phone || '').includes(query);
    }).slice(0, 8);

    if (matches.length === 0) {
        resultsBox.innerHTML = '<div style="padding:10px; font-size:12px; color:var(--text-muted);">No matching customers found.</div>';
        resultsBox.style.display = 'block';
        return;
    }

    resultsBox.innerHTML = matches.map(id => {
        const c = customersCache[id];
        const bal = Number(c.balance) || 0;
        return `
            <div style="padding:10px; font-size:13px; cursor:pointer; border-bottom:1px solid #f1f5f9;" onclick="selectPosCustomer('${id}')">
                <strong>${c.name}</strong> — ${c.phone || ''}${bal > 0 ? ` <span style="color:#b91c1c;">(Owes ₦${bal.toLocaleString()})</span>` : ''}
            </div>
        `;
    }).join('');
    resultsBox.style.display = 'block';
}

function selectPosCustomer(id) {
    const c = customersCache[id];
    if (!c) return;

    currentSelectedCustomer = {
        id,
        name: c.name,
        phone: c.phone,
        balance: Number(c.balance) || 0,
        creditLimit: Number(c.creditLimit) || 0
    };

    const searchInput = document.getElementById('pos-customer-search');
    const resultsBox = document.getElementById('pos-customer-results');
    if (searchInput) searchInput.value = '';
    if (resultsBox) { resultsBox.style.display = 'none'; resultsBox.innerHTML = ''; }

    updatePosCustomerBadge();
}

function clearPosCustomer() {
    currentSelectedCustomer = null;
    updatePosCustomerBadge();
}

function updatePosCustomerBadge() {
    const badge = document.getElementById('pos-selected-customer-badge');
    if (!badge) return;

    if (currentSelectedCustomer) {
        const owesText = currentSelectedCustomer.balance > 0
            ? ` <span style="color:#b91c1c;">(Owes ₦${currentSelectedCustomer.balance.toLocaleString()})</span>`
            : '';
        badge.innerHTML = `Selling to: <strong>${currentSelectedCustomer.name}</strong>${owesText} <button class="menu-btn" style="display:inline-block; width:auto; padding:2px 8px; font-size:10px; margin-left:8px; margin-bottom:0;" onclick="clearPosCustomer()">Clear</button>`;
    } else {
        badge.textContent = 'Selling to: Walk-In Customer';
    }
}
