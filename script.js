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
let currentBranch = "Main";
let currentUserRole = "Admin";
let inventoryCache = {};
let currentCart = [];
let currentActiveOrder = null;
let currentCustomerType = "Retail"; // Default customer type

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
        banner.innerText = "⚠️ You are currently offline. Sales and changes are saving locally and will sync automatically when reconnected.";
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
                `stores/${currentStoreId}/inventory`;
            
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
    // Accountants can view the accountant queue, receipt view, business settings, or POS view
    if (currentUserRole === 'Accountant') {
        const allowedAccountantViews = [
            'accountant-view', 'accountant-view-template', 
            'receipt-view', 'receipt-view-template', 
            'settings-view', 'settings-view-template',
            'pos-view', 'pos-view-template'
        ];
        if (!allowedAccountantViews.includes(viewId)) {
            alert("Access Restricted: Accountants are permitted to accept payments, manage the queue, and print receipts.");
            return;
        }
    }

    if (currentUserRole === 'Staff' && viewId !== 'pos-view' && viewId !== 'pos-view-template') {
        alert("Access Restricted: Standard workers are only permitted to make sales.");
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
            if (viewId === 'pos-view') loadPosInventoryDropdown();
            if (viewId === 'inventory-view') loadInventoryTable();            
            if (viewId === 'accountant-view') loadPendingOrdersQueue();
            if (viewId === 'staff-view') loadStaffTable();
            if (viewId === 'reports-view' || viewId === 'sales-history-view') {
                loadPastSalesHistory();
                loadProfitAndLossModule();
            }
            if (viewId === 'settings-view') loadBusinessSettings();
            if (viewId === 'expenses-view') {
                loadExpensesTable();
                loadProfitAndLossModule();
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
    const menuButtons = document.querySelectorAll('.dashboard-sidebar button, .menu-btn, [onclick*="switchView"], [onclick*="logout"]');
    
    menuButtons.forEach(btn => {
        const action = btn.getAttribute('onclick') || '';
        
        if (role === 'Accountant') {
            if (
                action.includes('accountant-view') || 
                action.includes('pos-view') || 
                action.includes('logout')
            ) {
                btn.style.display = 'block';
            } else {
                btn.style.display = 'none';
            }
        } else if (role === 'Staff') {
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
            const masterPin = snapshot.val() || "2026";
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
            document.getElementById('dashboard-store-title').textContent = storeData.businessName || "";
            document.getElementById('user-role-label').textContent = "Admin (Owner)";
            adjustSidebarForRole("Admin");
            switchView('main-dashboard-view');
            syncOfflineQueueToFirebase();
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
                    document.getElementById('dashboard-store-title').textContent = storeData.businessName || "";
                    document.getElementById('user-role-label').textContent = `${staff.name} (${staff.role})`;
                    adjustSidebarForRole(staff.role);
                    switchView(staff.role === 'Accountant' ? 'accountant-view' : 'pos-view');
                    syncOfflineQueueToFirebase();
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

    const secretRegistrationCode = "Mazanest2026";
    const userEnteredCode = prompt("Enter the authorized developer license/activation code to register this store:");

    if (userEnteredCode !== secretRegistrationCode) {
        alert("Access Denied: Invalid or missing authorization code.");
        return;
    }

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
            alert("Business registered successfully! You can now log in.");
            switchView('login-view');
        });
    });
}

function logout() {
    currentStoreId = null;
    currentUserRole = "Admin";
    currentCart = [];
    adjustSidebarForRole("Admin");
    switchView('login-view');
}

// ==================== SUPER ADMIN DASHBOARD CONTROL ====================
function loadSuperAdminDashboard() {
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
                        <button class="menu-btn btn-logout" style="padding: 4px 8px; font-size: 11px; width: auto;" onclick="deleteBusinessAccount('${storeId}')">🗑️ Delete</button>
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

function sendMaintenanceNotice(storeId, phone) {
    const message = `Hello, this is a reminder from Wise Decision support regarding your software subscription. Your monthly maintenance fee is due to keep your store account active and unlocked.\n\nStore ID: ${storeId}\n\nPayment Details:\nBank Name: MONIEPOINT\nAccount Number: 9168140710\nAccount Name: EMMANUEL AYOOLA FISUYI\n\nPlease send proof of payment once done. Thank you!`;
    
    if (phone) {
        const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
    } else {
        prompt("Copy payment notice message for store owner:", message);
    }
}

function deleteBusinessAccount(storeId) {
    if (confirm(`⚠️ DANGER: Are you absolutely sure you want to completely delete store ID "${storeId}" and all its associated data (inventory, transactions, staff, expenses)? This action cannot be undone!`)) {
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
function loadDashboardMetrics() {
    if (!currentStoreId) return;
    
    firebase.database().ref(`stores/${currentStoreId}/transactions`).once('value').then(snapshot => {
        let todaySales = 0;
        const todayStr = new Date().toDateString();
        
        snapshot.forEach(child => {
            const tx = child.val();
            if (new Date(tx.date).toDateString() === todayStr) {
                todaySales += (Number(tx.totalAmount) || 0);
            }
        });
        
        const salesEl = document.getElementById('dash-today-sales');
        if (salesEl) salesEl.textContent = '₦' + todaySales.toLocaleString();
    });

    firebase.database().ref(`stores/${currentStoreId}/inventory`).once('value').then(snapshot => {
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

// ==================== BULLETPROOF INVENTORY LOADER ====================
function loadInventoryTable() {
    if (!currentStoreId) return;
    
    firebase.database().ref(`stores/${currentStoreId}/inventory`).on('value', snapshot => {
        const tbody = document.getElementById('inventory-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        inventoryCache = {};

        snapshot.forEach(child => {
            const id = child.key;
            const item = child.val();
            if (!item || typeof item !== 'object') return;
            
            inventoryCache[id] = item;

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
                        <button class="menu-btn" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="editProduct('${id}')">Edit</button>
                        <button class="menu-btn btn-logout" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="deleteProduct('${id}')">Delete</button>
                    </td>
                </tr>
            `;
        });

        if (snapshot.numChildren() === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No products found in inventory. Add your first item above!</td></tr>`;
        }
    });
}

function filterInventoryTable() {
    const query = (document.getElementById('inventory-search-input')?.value || '').toLowerCase().trim();
    const tbody = document.getElementById('inventory-body');
    if (!tbody) return;

    tbody.innerHTML = '';
    let matchCount = 0;

    Object.keys(inventoryCache).forEach(id => {
        const item = inventoryCache[id];
        const pName = item.name || item.productName || 'Unnamed Item';
        const cPrice = item.costPrice || 0;
        const rPrice = item.price || item.retailPrice || 0;
        const wPrice = item.wholesalePrice || 0;
        const pStock = item.stock !== undefined ? item.stock : (item.stockQty || 0);
        const pExpiry = item.expiry || item.expiryDate || 'N/A';

        if (pName.toLowerCase().includes(query)) {
            matchCount++;
            tbody.innerHTML += `
                <tr>
                    <td>${pName}</td>
                    <td>₦${Number(cPrice).toLocaleString()}</td>
                    <td>₦${Number(rPrice).toLocaleString()}</td>
                    <td>₦${Number(wPrice).toLocaleString()}</td>
                    <td>${pStock}</td>
                    <td>${pExpiry}</td>
                    <td>
                        <button class="menu-btn" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="editProduct('${id}')">Edit</button>
                        <button class="menu-btn btn-logout" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="deleteProduct('${id}')">Delete</button>
                    </td>
                </tr>
            `;
        }
    });

    if (matchCount === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No matching products found.</td></tr>`;
    }
}

// ==================== BULLETPROOF PRODUCT SAVER ====================
function saveProduct() {
    if (!currentStoreId) {
        alert("Error: No active Store ID found. Please log out and log back in.");
        return;
    }

    const editId = document.getElementById('edit-product-id').value;
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
        expiryDate: expiry
    };

    const invRef = firebase.database().ref(`stores/${currentStoreId}/inventory`);

    if (editId) {
        invRef.child(editId).update(prodData).then(() => {
            alert("Product updated successfully!");
            resetInventoryForm();
            loadInventoryTable();
        }).catch(err => {
            alert("Failed to update product: " + err.message);
        });
    } else {
        const newRef = invRef.push();
        newRef.set(prodData).then(() => {
            alert("Product saved successfully to cloud!");
            resetInventoryForm();
            loadInventoryTable();
        }).catch(err => {
            saveRecordLocallyOrCloud('offline_inventory_queue', prodData, `stores/${currentStoreId}/inventory`, () => {
                resetInventoryForm();
                loadInventoryTable();
            });
        });
    }
}

function editProduct(id) {
    const item = inventoryCache[id];
    if (!item) return;

    document.getElementById('edit-product-id').value = id;
    document.getElementById('inv-name').value = item.name || item.productName || '';
    document.getElementById('inv-cost-price').value = item.costPrice || '';
    document.getElementById('inv-price').value = item.price || item.retailPrice || '';
    document.getElementById('inv-wholesale-price').value = item.wholesalePrice || '';
    document.getElementById('inv-stock').value = item.stock !== undefined ? item.stock : (item.stockQty || '');
    document.getElementById('inv-expiry').value = item.expiry || item.expiryDate || '';
    
    document.getElementById('inv-form-title').textContent = "Edit Product";
    document.getElementById('save-product-btn').textContent = "Update Product";
    document.getElementById('cancel-edit-btn').style.display = 'block';
}

function resetInventoryForm() {
    document.getElementById('edit-product-id').value = '';
    document.getElementById('inv-name').value = '';
    document.getElementById('inv-cost-price').value = '';
    document.getElementById('inv-price').value = '';
    document.getElementById('inv-wholesale-price').value = '';
    document.getElementById('inv-stock').value = '';
    document.getElementById('inv-expiry').value = '';
    
    document.getElementById('inv-form-title').textContent = "Add New Product";
    document.getElementById('save-product-btn').textContent = "Save Product to Cloud";
    document.getElementById('cancel-edit-btn').style.display = 'none';
}

function deleteProduct(id) {
    if (confirm("Are you sure you want to delete this product?")) {
        firebase.database().ref(`stores/${currentStoreId}/inventory/${id}`).remove();
    }
}

// ==================== POS & CART REGISTER ====================
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

function loadPosInventoryDropdown() {
    if (!currentStoreId) return;
    
    firebase.database().ref(`stores/${currentStoreId}/inventory`).once('value').then(snapshot => {
        const select = document.getElementById('pos-product-select');
        if (!select) return;
        
        select.innerHTML = '<option value="">-- Choose Inventory Item --</option>';
        inventoryCache = {};

        snapshot.forEach(child => {
            const id = child.key;
            const item = child.val();
            inventoryCache[id] = item;
            
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
    
    Object.keys(inventoryCache).forEach(id => {
        const item = inventoryCache[id];
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
    if (id && inventoryCache[id]) {
        const item = inventoryCache[id];
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

    if (!id || !inventoryCache[id]) {
        alert("Please select a valid product.");
        return;
    }

    const item = inventoryCache[id];
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
    const stockItem = inventoryCache[item.id];
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
        status: 'Pending Verification'
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
        status: 'Pending Verification'
    };

    // Temporarily push to pending/active processing so the split checkout can process it directly
    firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).set(orderData).then(() => {
        currentCart = [];
        renderCart();
        loadPosInventoryDropdown();
        openSplitModal(txId, grandTotal);
    });
}

// ==================== ACCOUNTANT & QUEUE VERIFICATION ====================
function loadPendingOrdersQueue() {
    if (!currentStoreId) return;

    if (currentUserRole !== 'Accountant' && currentUserRole !== 'Admin') {
        return;
    }

    firebase.database().ref(`stores/${currentStoreId}/pendingOrders`).on('value', snapshot => {
        const tbody = document.getElementById('accountant-queue-body');
        if (!tbody) return;

        tbody.innerHTML = '';

        snapshot.forEach(child => {
            const order = child.val();
            if (order.status === 'Pending Verification') {
                tbody.innerHTML += `
                    <tr>
                        <td><strong>${order.txId}</strong></td>
                        <td>${order.staff || order.soldBy || 'Staff'}</td>
                        <td>₦${Number(order.totalAmount || 0).toLocaleString()}</td>
                        <td><span style="color: #d97706; font-weight: bold;">Pending Payment</span></td>
                        <td>
                            <button class="menu-btn btn-action-primary" style="padding: 4px 10px; font-size: 11px; width: auto; display: inline-block;" onclick="openSplitModal('${order.txId}', ${order.totalAmount})">Process Payment 💳</button>
                        </td>
                    </tr>
                `;
            }
        });

        if (tbody.innerHTML === '') {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 25px;">No pending payments in queue.</td></tr>`;
        }
    });
}

// ==================== SPLIT PAYMENT & RECEIPT LOGIC ====================
function openSplitModal(txId, totalAmount) {
    const numericTotal = Number(totalAmount) || 0;
    currentActiveOrder = { txId, totalAmount: numericTotal };
    
    document.getElementById('modal-tx-id-label').textContent = txId;
    document.getElementById('split-modal-total').textContent = numericTotal.toLocaleString();
    document.getElementById('split-cash').value = numericTotal;
    document.getElementById('split-transfer').value = 0;
    
    document.getElementById('split-modal').style.display = 'flex';
    calcSplit();
}

function closeSplitModal() {
    document.getElementById('split-modal').style.display = 'none';
    currentActiveOrder = null;
}

function calcSplit() {
    let totalDue = parseFloat(document.getElementById('split-modal-total').innerText.replace(/,/g, '')) || 0;
    let cashVal = parseFloat(document.getElementById('split-cash').value) || 0;
    let transferVal = parseFloat(document.getElementById('split-transfer').value) || 0;
    
    let totalPaid = cashVal + transferVal;
    let statusField = document.getElementById('split-status');
    let acceptBtn = document.getElementById('dynamic-accept-print-btn');

    if (totalPaid === totalDue && totalDue > 0) {
        statusField.value = "Status: Balanced ✅";
        statusField.style.background = "#dcfce7";
        statusField.style.color = "#166534";
        
        acceptBtn.disabled = false;
        acceptBtn.style.opacity = "1";
        acceptBtn.style.cursor = "pointer";
    } else if (totalPaid > totalDue) {
        let excess = totalPaid - totalDue;
        statusField.value = `Status: Overpaid by ₦${excess.toLocaleString()} ⚠️`;
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

// ==================== NEW FINALIZATION & METRICS INTEGRATION ====================
function finalizeCompleteSale() {
    const cashTendered = parseFloat(document.getElementById('cash-amount').value) || 0;
    const transferTendered = parseFloat(document.getElementById('transfer-amount').value) || 0;
    const totalDue = currentActiveOrder ? currentActiveOrder.totalAmount : 0;

    // 1. Validation sanity check
    if ((cashTendered + transferTendered) < totalDue) {
        alert("Amount tendered is less than total due!");
        return;
    }

    // 2. Build the transaction payload for dashboard and storage sync
    const receiptNo = document.getElementById('modal-receipt-no') ? document.getElementById('modal-receipt-no').innerText : (currentActiveOrder ? currentActiveOrder.txId : 'WD-000000');
    const transactionData = {
        receiptNo,
        total: totalDue,
        cash: cashTendered,
        transfer: transferTendered,
        timestamp: new Date().toISOString(),
        cashier: document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : "Accountant"
    };

    // 3. Save transaction (LocalStorage, Firebase, or Backend API)
    saveTransactionToDatabase(transactionData);

    // 4. Update Accountant Dashboard metrics immediately
    updateAccountantDashboardMetrics(transactionData);

    // 5. Close payment modal and trigger receipt print
    closeSplitModal();
    if (typeof triggerThermalReceiptPrint === 'function') {
        triggerThermalReceiptPrint(transactionData);
    }
}

function saveTransactionToDatabase(data) {
    let salesHistory = JSON.parse(localStorage.getItem('wd_sales_history')) || [];
    salesHistory.push(data);
    localStorage.setItem('wd_sales_history', JSON.stringify(salesHistory));
}

function updateAccountantDashboardMetrics(data) {
    let currentRevenue = parseFloat(localStorage.getItem('wd_total_revenue') || '0');
    currentRevenue += data.total;
    localStorage.setItem('wd_total_revenue', currentRevenue);
    
    if (typeof refreshDashboardUI === 'function') {
        refreshDashboardUI();
    }
}

// ==================== UPDATED SPLIT CHECKOUT & INVENTORY DEDUCTION ====================
function completeSplitCheckout() {
    if (!currentActiveOrder) return;
    
    const cash = parseFloat(document.getElementById('split-cash').value) || 0;
    const transfer = parseFloat(document.getElementById('split-transfer').value) || 0;
    const txId = currentActiveOrder.txId;
    
    closeSplitModal();
    
    firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).once('value').then(snapshot => {
        if (snapshot.exists()) {
            const orderData = snapshot.val();
            orderData.status = 'Completed';
            orderData.paymentBreakdown = { cash, transfer };
            orderData.date = new Date().toISOString();
            
            // 1. Save transaction and remove from pending queue
            firebase.database().ref(`stores/${currentStoreId}/transactions/${txId}`).set(orderData);
            firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).remove();

            // 2. DEDUCT INVENTORY FOR EACH SOLD ITEM
            if (Array.isArray(orderData.items)) {
                orderData.items.forEach(cartItem => {
                    const productId = cartItem.id;
                    const soldQty = Number(cartItem.qty) || 0;

                    if (productId && soldQty > 0) {
                        const productRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${productId}`);
                        
                        productRef.once('value').then(prodSnap => {
                            if (prodSnap.exists()) {
                                const prodData = prodSnap.val();
                                let currentStock = Number(prodData.stock !== undefined ? prodData.stock : (prodData.stockQty || 0));
                                let newStock = Math.max(0, currentStock - soldQty);

                                productRef.update({
                                    stock: newStock,
                                    stockQty: newStock
                                });

                                if (typeof inventoryCache !== 'undefined' && inventoryCache[productId]) {
                                    inventoryCache[productId].stock = newStock;
                                    inventoryCache[productId].stockQty = newStock;
                                }
                            }
                        });
                    }
                });
            }

            // 3. Render and print the receipt
            renderReceiptView(orderData, false);
        }
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
        if (breakdownEl) {
            breakdownEl.textContent = `Cash: ₦${cash.toLocaleString()} | POS/Transfer: ₦${transfer.toLocaleString()}`;
        }

        const reprintWatermark = workspace.querySelector('#reprintWatermark');
        if (reprintWatermark) {
            reprintWatermark.style.display = isReprint ? 'block' : 'none';
        }

        const printableBox = workspace.querySelector('#printable-receipt-box');
        if (printableBox) {
            let cashierName = orderData.staff || orderData.soldBy || "Staff";
            let cashierRow = printableBox.querySelector('#receipt-cashier-row');
            
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
            cashierRow.innerHTML = `Cashier: ${cashierName}`;
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
function triggerThermalPrint(htmlContent) {
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
                    width: 72mm;
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

// ==================== PAST SALES HISTORY & REPORTS ====================
function loadPastSalesHistory(selectedDateString = null) {
    if (!currentStoreId) return;

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

        snapshot.forEach(child => {
            const tx = child.val();
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

            tbody.innerHTML += `
                <tr>
                    <td><strong>${transactionId}</strong></td>
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

        if (snapshot.numChildren() === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No past sales transactions found in the database.</td></tr>`;
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

// ==================== STAFF MANAGEMENT ====================
function loadStaffTable() {
    if (!currentStoreId) return;

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
                    <td><button class="menu-btn btn-logout" style="padding: 3px 8px; font-size:11px; width:auto;" onclick="deleteStaff('${id}')">Remove</button></td>
                </tr>
            `;
        });

        if (snapshot.numChildren() === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align: center;">No additional staff registered.</td></tr>`;
        }
    });
}

function addStaffMember() {
    const name = document.getElementById('staff-name-input').value.trim();
    const pin = document.getElementById('staff-pin-input').value.trim();
    const role = document.getElementById('staff-role-input').value;

    if (!name || !pin) {
        alert("Staff Name and PIN are required.");
        return;
    }

    firebase.database().ref(`stores/${currentStoreId}/staff`).push({ name, pin, role }).then(() => {
        alert("Staff member added successfully!");
        document.getElementById('staff-name-input').value = '';
        document.getElementById('staff-pin-input').value = '';
    });
}

function deleteStaff(id) {
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

// ==================== EXPENSES MANAGEMENT MODULE ====================
function loadExpensesTable() {
    if (!currentStoreId) return;
    
    firebase.database().ref(`stores/${currentStoreId}/expenses`).on('value', snapshot => {
        const tbody = document.getElementById('expenses-body');
        if (!tbody) return;
        
        tbody.innerHTML = '';
        let totalExpenses = 0;

        snapshot.forEach(child => {
            const id = child.key;
            const item = child.val();
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

        if (snapshot.numChildren() === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 20px;">No expenses recorded yet.</td></tr>`;
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
        recordedBy: document.getElementById('user-role-label').textContent
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

// ==================== PROFIT & LOSS (P&L) ANALYTICS MODULE ====================
function loadProfitAndLossModule() {
    if (!currentStoreId) return;

    Promise.all([
        firebase.database().ref(`stores/${currentStoreId}/transactions`).once('value'),
        firebase.database().ref(`stores/${currentStoreId}/inventory`).once('value'),
        firebase.database().ref(`stores/${currentStoreId}/expenses`).once('value')
    ]).then(([txSnapshot, invSnapshot, expSnapshot]) => {
        
        const costPriceMap = {};
        invSnapshot.forEach(child => {
            const item = child.val();
            const cPrice = Number(item.costPrice) || 0;
            const itemName = item.name || item.productName || '';
            
            costPriceMap[child.key] = cPrice;
            if (itemName) {
                costPriceMap[itemName.toLowerCase().trim()] = cPrice;
            }
        });

        let monthRevenue = 0, monthCost = 0, monthExpenses = 0;
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        txSnapshot.forEach(child => {
            const tx = child.val();
            const txDate = tx.date ? new Date(tx.date) : null;
            const txTotal = Number(tx.totalAmount) || 0;

            let txCogs = 0;
            if (Array.isArray(tx.items)) {
                tx.items.forEach(cartItem => {
                    const unitCost = costPriceMap[cartItem.id] || costPriceMap[(cartItem.name || '').toLowerCase().trim()] || 0;
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
