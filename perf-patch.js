// ==================== WISE DECISION PERFORMANCE PATCH (v21) ====================
// Load this AFTER script.js (both with `defer`). It replaces the slow functions in
// script.js with faster versions and adds a loading spinner for login.

console.log("Wise Decision perf-patch.js — v21 loaded");

// ---------- 1. Loading spinner ----------
(function injectLoaderStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #wd-loader {
            display: none; position: fixed; inset: 0; z-index: 3000;
            background: rgba(15, 23, 42, 0.65);
            flex-direction: column; align-items: center; justify-content: center; gap: 14px;
        }
        #wd-loader .wd-spinner {
            width: 52px; height: 52px; border-radius: 50%;
            border: 5px solid rgba(255,255,255,0.25); border-top-color: #38bdf8;
            animation: wd-spin 0.8s linear infinite;
        }
        #wd-loader .wd-loader-text { color: #fff; font-size: 14px; font-weight: 600; }
        @keyframes wd-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
})();

function wdShowLoader(message) {
    let el = document.getElementById('wd-loader');
    if (!el) {
        el = document.createElement('div');
        el.id = 'wd-loader';
        el.innerHTML = '<div class="wd-spinner"></div><div class="wd-loader-text"></div>';
        document.body.appendChild(el);
    }
    el.querySelector('.wd-loader-text').textContent = message || 'Loading...';
    el.style.display = 'flex';
}

function wdHideLoader() {
    const el = document.getElementById('wd-loader');
    if (el) el.style.display = 'none';
}

// ---------- 2. Light store-profile read (name/address/phone only) ----------
function getStoreProfile() {
    const base = firebase.database().ref(`stores/${currentStoreId}`);
    return Promise.all([
        base.child('businessName').once('value'),
        base.child('address').once('value'),
        base.child('phone').once('value')
    ]).then(([n, a, p]) => ({ businessName: n.val(), address: a.val(), phone: p.val() }));
}

// ---------- 3. Date helpers ----------
function todayStartISO() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }
function monthStartISO() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); }

// ---------- 4. Login: spinner + only read the fields we need ----------
let wdLoginBusy = false;

function handleStoreLogin() {
    if (wdLoginBusy) return;

    const storeId = document.getElementById('store-id-input').value.trim().toLowerCase();
    const pin = document.getElementById('staff-pin').value.trim();

    if (!storeId || !pin) {
        alert("Please enter both Store ID and PIN.");
        return;
    }

    wdLoginBusy = true;
    wdShowLoader('Logging in...');
    let safety = null;
    const done = () => {
        if (safety) { clearTimeout(safety); safety = null; }
        wdLoginBusy = false;
        wdHideLoader();
    };
    safety = setTimeout(done, 15000); // never leave the spinner stuck forever

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
                done();
                switchView('super-admin-view');
                resetIdleTimer();
            } else {
                done();
                alert("Invalid Super Admin Master PIN.");
            }
        }).catch(error => {
            console.error("Super Admin login error:", error);
            done();
            alert("Connection error during login. Check network.");
        });
        return;
    }

    const base = firebase.database().ref('stores/' + storeId);
    Promise.all([
        base.child('businessName').once('value'),
        base.child('status').once('value'),
        base.child('adminPin').once('value'),
        base.child('staff').once('value')
    ]).then(([nameSnap, statusSnap, pinSnap, staffSnap]) => {
        if (!nameSnap.exists() && !pinSnap.exists()) {
            done();
            alert("Store ID not found on cloud database.");
            return;
        }

        const storeData = {
            businessName: nameSnap.val(),
            status: statusSnap.val(),
            adminPin: pinSnap.val(),
            staff: staffSnap.val()
        };

        if (storeData.status === "suspended") {
            done();
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
            loadBranchesCache(() => { done(); switchView('main-dashboard-view'); });
            syncOfflineQueueToFirebase();
            subscribeCustomersCache();
            subscribeSuppliersCache();
            resetIdleTimer();
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
                    loadBranchesCache(() => { done(); switchView(staff.role === 'Accountant' ? 'accountant-view' : 'pos-view'); });
                    syncOfflineQueueToFirebase();
                    subscribeCustomersCache();
                    subscribeSuppliersCache();
                    resetIdleTimer();
                }
            });
        }

        if (!foundStaff) {
            done();
            alert("Invalid PIN or Store credentials.");
        }
    }).catch(error => {
        console.error("Login error:", error);
        done();
        alert("Connection error during login. Check network.");
    });
}

// ---------- 5. Idle timer: throttle so mousemove/scroll don't hammer it ----------
(function throttleIdleTimer() {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach(evt => window.removeEventListener(evt, resetIdleTimer, { passive: true }));

    let lastReset = 0;
    function onUserActivity() {
        const now = Date.now();
        if (now - lastReset < 1000) return;
        lastReset = now;
        resetIdleTimer();
    }
    events.forEach(evt => window.addEventListener(evt, onUserActivity, { passive: true }));
})();

// ---------- 6. Dashboard: only today's transactions ----------
function loadDashboardMetrics() {
    if (!currentStoreId) return;

    const branchLabelEl = document.getElementById('dash-branch-label');
    if (branchLabelEl) branchLabelEl.textContent = branchNameOf(currentBranch);

    firebase.database().ref(`stores/${currentStoreId}/transactions`)
        .orderByChild('date').startAt(todayStartISO()).once('value').then(snapshot => {
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
        const now = new Date();
        const alerts = [];

        snapshot.forEach(child => {
            const item = child.val();
            const stock = Number(item.stock !== undefined ? item.stock : (item.stockQty !== undefined ? item.stockQty : 0)) || 0;
            const expiryVal = item.expiry || item.expiryDate;
            const expiryDate = expiryVal ? new Date(expiryVal) : null;
            const itemName = item.name || item.productName || 'Unnamed Item';
            const category = item.category || '';

            const threshold = (item.lowStockThreshold !== null && item.lowStockThreshold !== undefined) ? Number(item.lowStockThreshold) : 5;
            const isLowStock = stock <= threshold;
            const isExpiringSoon = expiryDate && (expiryDate - now) / (1000 * 60 * 60 * 24) <= 30;

            if (isLowStock || isExpiringSoon) {
                alerts.push({ name: itemName, category, stock, soldByWeight: !!item.soldByWeight, weightUnit: item.weightUnit || 'Kg', expiryVal, isLowStock, isExpiringSoon });
            }
        });

        dashboardAlertsCache = alerts;
        renderDashboardAlerts();
    });
}

// ---------- 7. Profit & Loss: only this month's data ----------
function loadProfitAndLossModule() {
    if (!currentStoreId) return;

    const plBranchFilter = document.getElementById('sales-branch-filter') ? currentReportBranchFilter : currentBranch;
    const plLabel = document.getElementById('pl-branch-label');
    if (plLabel) plLabel.textContent = plBranchFilter === 'all' ? '(All Branches)' : `(${branchNameOf(plBranchFilter)})`;

    const from = monthStartISO();
    const root = `stores/${currentStoreId}`;

    Promise.all([
        firebase.database().ref(`${root}/transactions`).orderByChild('date').startAt(from).once('value'),
        firebase.database().ref(`${root}/inventory`).once('value'),
        firebase.database().ref(`${root}/expenses`).orderByChild('date').startAt(from).once('value'),
        firebase.database().ref(`${root}/refunds`).orderByChild('date').startAt(from).once('value')
    ]).then(([txSnapshot, invSnapshot, expSnapshot, refundSnapshot]) => {

        const costPriceMap = {};
        invSnapshot.forEach(branchChild => {
            const branchId = branchChild.key;
            branchChild.forEach(prodChild => {
                const item = prodChild.val();
                const unitsPerPack = Number(item.unitsPerPack) || 1;
                const cPricePerPiece = (Number(item.costPrice) || 0) / unitsPerPack;
                const itemName = item.name || item.productName || '';

                costPriceMap[`${branchId}_${prodChild.key}`] = cPricePerPiece;
                if (itemName) costPriceMap[itemName.toLowerCase().trim()] = cPricePerPiece;
            });
        });

        let monthRevenue = 0, monthCost = 0, monthExpenses = 0, monthRefunds = 0, monthRefundCost = 0;
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
                    const unitCostPerPiece = costPriceMap[`${txBranch}_${cartItem.id}`] || costPriceMap[(cartItem.name || '').toLowerCase().trim()] || 0;
                    const piecesSold = Number(cartItem.piecesNeeded !== undefined ? cartItem.piecesNeeded : cartItem.qty) || 0;
                    txCogs += unitCostPerPiece * piecesSold;
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

        refundSnapshot.forEach(child => {
            const r = child.val();
            const rBranch = r.branchId || 'main';
            if (plBranchFilter !== 'all' && rBranch !== plBranchFilter) return;

            const rDate = r.date ? new Date(r.date) : null;
            if (rDate && rDate.getFullYear() === currentYear && rDate.getMonth() === currentMonth) {
                monthRefunds += Number(r.totalRefund) || 0;
                if (Array.isArray(r.items)) {
                    r.items.forEach(ri => { monthRefundCost += Number(ri.totalCost) || 0; });
                }
            }
        });

        const monthGross = (monthRevenue - monthRefunds) - (monthCost - monthRefundCost);
        const monthNet = monthGross - monthExpenses;

        const netProfitDisplay = document.getElementById('net-profit-display');
        if (netProfitDisplay) {
            netProfitDisplay.textContent = '₦' + monthNet.toLocaleString();
            netProfitDisplay.style.color = monthNet >= 0 ? '#065f46' : '#dc2626';
        }
    });
}

// ---------- 8. Reports: only fetch from the earliest date needed ----------
let wdSalesQuery = null;

function loadPastSalesHistory(selectedDateString = null) {
    if (!currentStoreId) return;

    const targetDate = selectedDateString ? new Date(selectedDateString) : new Date();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const from = new Date(Math.min(
        weekStart.getTime(),
        new Date(monthStartISO()).getTime(),
        targetDate.getTime() - 86400000
    )).toISOString();

    if (wdSalesQuery) wdSalesQuery.off();
    wdSalesQuery = firebase.database().ref(`stores/${currentStoreId}/transactions`).orderByChild('date').startAt(from);

    wdSalesQuery.on('value', snapshot => {
        const tbody = document.getElementById('sales-history-body');
        if (!tbody) return;

        let dayRevenue = 0, weekRevenue = 0, monthRevenue = 0;

        const targetYear = targetDate.getUTCFullYear();
        const targetMonth = targetDate.getUTCMonth();
        const targetDay = targetDate.getUTCDate();

        let selectedDayRevenue = 0, selectedDayCash = 0, selectedDayTransfer = 0;

        const now = new Date();
        const todayDateStr = now.toDateString();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        const branchFilter = currentReportBranchFilter || 'all';
        const canRefund = (currentUserRole === 'Admin' || currentUserRole === 'Accountant');
        const rows = [];

        snapshot.forEach(child => {
            const tx = child.val();
            const txBranch = tx.branchId || 'main';
            if (branchFilter !== 'all' && txBranch !== branchFilter) return;

            const txTotal = Number(tx.totalAmount) || 0;
            const txDate = tx.date ? new Date(tx.date) : null;

            if (txDate) {
                if (txDate.toDateString() === todayDateStr) dayRevenue += txTotal;
                if (txDate >= weekStart) weekRevenue += txTotal;
                if (txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth) monthRevenue += txTotal;
            }

            const cashPaid = tx.paymentBreakdown ? Number(tx.paymentBreakdown.cash) || 0 : txTotal;
            const transferPaid = tx.paymentBreakdown ? Number(tx.paymentBreakdown.transfer) || 0 : 0;

            if (txDate && txDate.getFullYear() === targetYear && txDate.getMonth() === targetMonth && txDate.getDate() === targetDay) {
                selectedDayRevenue += txTotal;
                selectedDayCash += cashPaid;
                selectedDayTransfer += transferPaid;
            }

            const dateStr = txDate ? txDate.toLocaleString() : 'N/A';
            const transactionId = tx.txId || child.key;
            const sellerName = tx.staff || tx.soldBy || 'Staff';
            const customerTag = tx.customerName && tx.customerName !== 'Walk-In Customer' ? `<br><small style="color:var(--text-muted);">👤 ${tx.customerName}</small>` : '';
            const statusLabel = tx.refundStatus && tx.refundStatus !== 'Completed' ? (tx.refundStatus === 'Refunded' ? 'Refunded' : 'Partially Refunded') : (tx.status || 'Completed');
            const statusColor = tx.refundStatus === 'Refunded' ? '#991b1b' : (tx.refundStatus === 'Partially Refunded' ? '#b45309' : 'green');
            const refundBtn = canRefund && tx.refundStatus !== 'Refunded'
                ? `<button class="menu-btn btn-logout" style="padding: 5px 10px; font-size: 11px; width: auto; background:#fef2f2; color:#991b1b; border:1px solid #fecaca;" onclick="openRefundModal('${transactionId}')">↩ Refund</button>`
                : '';

            rows.push({ sortKey: txDate ? txDate.getTime() : 0, html: `
                <tr>
                    <td><strong>${transactionId}</strong>${customerTag}</td>
                    <td>${branchNameOf(txBranch)}</td>
                    <td>${dateStr}</td>
                    <td>${sellerName}</td>
                    <td>₦${txTotal.toLocaleString()}${refundStatusBadge(tx)}</td>
                    <td>Cash: ₦${cashPaid.toLocaleString()}<br>Transfer: ₦${transferPaid.toLocaleString()}</td>
                    <td><span style="color: ${statusColor}; font-weight: bold;">${statusLabel}</span></td>
                    <td>
                        <button class="menu-btn btn-action-primary" style="padding: 5px 10px; font-size: 11px; width: auto;" onclick="viewPastReceipt('${transactionId}')">View / Reprint</button>
                        ${refundBtn}
                    </td>
                </tr>
            ` });
        });

        rows.sort((a, b) => b.sortKey - a.sortKey); // newest first

        tbody.innerHTML = rows.length === 0
            ? `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">No past sales transactions found for this filter.</td></tr>`
            : rows.map(r => r.html).join('');

        const setText = (ids, val) => {
            for (const id of ids) { const el = document.getElementById(id); if (el) { el.textContent = val; return; } }
        };
        setText(['todays-revenue-card', 'total-revenue-day-label'], '₦' + selectedDayRevenue.toLocaleString());
        setText(['total-cash-card', 'total-cash-label'], '₦' + selectedDayCash.toLocaleString());
        setText(['total-pos-card', 'total-transfer-label'], '₦' + selectedDayTransfer.toLocaleString());
        setText(['total-revenue-week-label'], '₦' + weekRevenue.toLocaleString());
        setText(['total-revenue-month-label'], '₦' + monthRevenue.toLocaleString());
    });

    loadRefundsSummaryForDate(selectedDateString);
}

// ---------- 9. Accountant "Completed Sales": most recent 200 only ----------
let wdCompletedQuery = null;

function loadCompletedTransactionsForAccountant() {
    if (!currentStoreId) return;
    if (currentUserRole !== 'Accountant' && currentUserRole !== 'Cashier' && currentUserRole !== 'Admin') return;

    if (wdCompletedQuery) wdCompletedQuery.off();
    wdCompletedQuery = firebase.database().ref(`stores/${currentStoreId}/transactions`).orderByChild('date').limitToLast(200);

    wdCompletedQuery.on('value', snapshot => {
        const tbody = document.getElementById('accountant-completed-body');
        if (!tbody) return;

        const rows = [];
        snapshot.forEach(child => {
            const tx = child.val();
            if ((tx.branchId || 'main') !== currentBranch) return;
            rows.push({ id: child.key, ...tx });
        });
        rows.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

        const canRefund = (currentUserRole === 'Admin' || currentUserRole === 'Accountant');

        const rowsHtml = rows.map(tx => {
            const transactionId = tx.txId || tx.id;
            const customerTag = tx.customerName && tx.customerName !== 'Walk-In Customer' ? `<br><small style="color:var(--text-muted);">👤 ${tx.customerName}</small>` : '';
            const refundBtn = canRefund && tx.refundStatus !== 'Refunded'
                ? `<button class="menu-btn btn-logout" style="padding: 4px 10px; font-size: 11px; width: auto; display: inline-block; background:#fef2f2; color:#991b1b; border:1px solid #fecaca;" onclick="openRefundModal('${transactionId}')">↩ Refund</button>`
                : '';
            return `
                <tr>
                    <td><strong>${transactionId}</strong>${customerTag}</td>
                    <td>${tx.date ? new Date(tx.date).toLocaleString() : 'N/A'}</td>
                    <td>${tx.staff || tx.soldBy || 'Staff'}</td>
                    <td>₦${Number(tx.totalAmount || 0).toLocaleString()}${refundStatusBadge(tx)}</td>
                    <td><button class="menu-btn btn-action-primary" style="padding: 4px 10px; font-size: 11px; width: auto; display: inline-block;" onclick="viewPastReceipt('${transactionId}')">View / Reprint</button> ${refundBtn}</td>
                </tr>
            `;
        });

        tbody.innerHTML = rows.length === 0
            ? `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 25px;">No completed sales yet for ${branchNameOf(currentBranch)}.</td></tr>`
            : rowsHtml.join('');
    }, error => {
        console.error("loadCompletedTransactionsForAccountant error:", error);
    });
}

// ---------- 10. Inventory: listen to one branch (or all only in the combined view) ----------
function loadInventoryTable() {
    if (!currentStoreId) return;

    const base = firebase.database().ref(`stores/${currentStoreId}/inventory`);
    if (window._wdInvRef) window._wdInvRef.off();

    const isAll = currentInventoryBranchFilter === 'all';
    const branchAtStart = currentInventoryBranchFilter;
    const ref = isAll ? base : base.child(branchAtStart);
    window._wdInvRef = ref;

    ref.on('value', snapshot => {
        inventoryCache = {};
        if (isAll) {
            snapshot.forEach(branchChild => {
                const branchId = branchChild.key;
                inventoryCache[branchId] = {};
                branchChild.forEach(prodChild => {
                    const item = prodChild.val();
                    if (item && typeof item === 'object') inventoryCache[branchId][prodChild.key] = item;
                });
            });
        } else {
            inventoryCache[branchAtStart] = {};
            snapshot.forEach(prodChild => {
                const item = prodChild.val();
                if (item && typeof item === 'object') inventoryCache[branchAtStart][prodChild.key] = item;
            });
        }
        renderInventoryTable();
        populateInventoryCategoryFilter();
        updateCategoryDatalist();
    });
}

function onInventoryBranchFilterChange() {
    const select = document.getElementById('inventory-branch-filter');
    if (!select) return;
    currentInventoryBranchFilter = select.value;
    currentInventoryCategoryFilter = 'all';
    resetInventoryForm();
    loadInventoryTable(); // re-subscribes to the newly chosen scope and re-renders
}

// ---------- 11. POS: build HTML once instead of innerHTML += in loops ----------
function loadPosInventoryDropdown() {
    if (!currentStoreId) return;

    firebase.database().ref(`stores/${currentStoreId}/inventory/${currentBranch}`).once('value').then(snapshot => {
        const select = document.getElementById('pos-product-select');
        if (!select) return;

        if (!inventoryCache[currentBranch]) inventoryCache[currentBranch] = {};
        let html = '<option value="">-- Choose Inventory Item --</option>';

        snapshot.forEach(child => {
            const id = child.key;
            const item = child.val();
            inventoryCache[currentBranch][id] = item;

            const pName = item.name || item.productName || 'Unnamed Item';
            const rPrice = item.price || item.retailPrice || 0;
            const wPrice = item.wholesalePrice || 0;
            const unitsPerPack = Number(item.unitsPerPack) || 1;
            const pieceNote = item.soldByWeight ? '' : (unitsPerPack > 1 ? ` [1 pack = ${unitsPerPack} pcs]` : '');

            html += `<option value="${id}">${pName} (Stock: ${formatStockLabel(item)})${pieceNote} - Retail: ₦${rPrice} | Wholesale: ₦${wPrice}</option>`;
        });

        select.innerHTML = html;
    });
}

function filterPosInventory() {
    const query = (document.getElementById('pos-search-input')?.value || '').toLowerCase().trim();
    const select = document.getElementById('pos-product-select');
    if (!select) return;

    const branchItems = inventoryCache[currentBranch] || {};
    let html = '<option value="">-- Choose Inventory Item --</option>';

    Object.keys(branchItems).forEach(id => {
        const item = branchItems[id];
        const pName = item.name || item.productName || 'Unnamed Item';
        if (!pName.toLowerCase().includes(query)) return;

        const rPrice = item.price || item.retailPrice || 0;
        const wPrice = item.wholesalePrice || 0;
        const unitsPerPack = Number(item.unitsPerPack) || 1;
        const pieceNote = item.soldByWeight ? '' : (unitsPerPack > 1 ? ` [1 pack = ${unitsPerPack} pcs]` : '');

        html += `<option value="${id}">${pName} (Stock: ${formatStockLabel(item)})${pieceNote} - Retail: ₦${rPrice} | Wholesale: ₦${wPrice}</option>`;
    });

    select.innerHTML = html;
}

function renderCart() {
    const tbody = document.getElementById('cart-body');
    const totalEl = document.getElementById('cart-total');
    if (!tbody || !totalEl) return;

    let grandTotal = 0;
    let html = '';

    currentCart.forEach((cartItem, index) => {
        grandTotal += cartItem.total;
        const unitLabel = cartItem.saleUnit === 'Piece' ? 'pcs' : ((cartItem.saleUnit === 'Kg' || cartItem.saleUnit === 'g') ? cartItem.saleUnit.toLowerCase() : 'pack(s)');
        html += `
            <tr>
                <td>${cartItem.name} <br><small style="color:var(--text-muted);">[${cartItem.customerType} · ${unitLabel}]</small></td>
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
        html = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Cart is empty</td></tr>`;
    }

    tbody.innerHTML = html;
    totalEl.textContent = grandTotal.toLocaleString();
}

// ---------- 12. Business settings: read profile fields only ----------
function loadBusinessSettings() {
    if (!currentStoreId) return;

    getStoreProfile().then(storeData => {
        const nameInput = document.getElementById('settings-store-name');
        const phoneInput = document.getElementById('settings-store-phone');
        const addressInput = document.getElementById('settings-store-address');

        if (nameInput) nameInput.value = storeData.businessName || '';
        if (phoneInput) phoneInput.value = storeData.phone || '';
        if (addressInput) addressInput.value = storeData.address || '';
    });

    const pinSection = document.getElementById('settings-pin-change-section');
    if (pinSection) pinSection.style.display = (currentUserRole === 'Admin') ? 'block' : 'none';

    ['settings-current-pin', 'settings-new-pin', 'settings-confirm-pin'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

// ---------- 13. Receipts: read name/address/phone only (not the whole store) ----------
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
        if (totalEl) totalEl.textContent = !isNaN(numericTotal) ? numericTotal.toLocaleString() : '0';

        const cash = orderData.paymentBreakdown ? Number(orderData.paymentBreakdown.cash) || 0 : (!isNaN(numericTotal) ? numericTotal : 0);
        const transfer = orderData.paymentBreakdown ? Number(orderData.paymentBreakdown.transfer) || 0 : 0;
        const credit = orderData.paymentBreakdown ? Number(orderData.paymentBreakdown.credit) || 0 : 0;
        if (breakdownEl) {
            let breakdownText = `Cash: ₦${cash.toLocaleString()} | POS/Transfer: ₦${transfer.toLocaleString()}`;
            if (credit > 0) breakdownText += ` | Credit: ₦${credit.toLocaleString()}`;
            if (Number(orderData.refundedAmount) > 0) breakdownText += ` | Refunded: ₦${Number(orderData.refundedAmount).toLocaleString()}`;
            breakdownEl.textContent = breakdownText;
        }

        const reprintWatermark = workspace.querySelector('#reprintWatermark');
        if (reprintWatermark) reprintWatermark.style.display = isReprint ? 'block' : 'none';

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

            let statusRow = printableBox.querySelector('#receipt-refund-status-row');
            if (orderData.refundStatus && orderData.refundStatus !== 'Completed') {
                if (!statusRow) {
                    statusRow = document.createElement('div');
                    statusRow.id = 'receipt-refund-status-row';
                    statusRow.style.cssText = 'font-size: 11px; font-weight: bold; color: #991b1b; margin-bottom: 5px;';
                    printableBox.insertBefore(statusRow, printableBox.querySelector('hr'));
                }
                statusRow.textContent = orderData.refundStatus === 'Refunded' ? '⚠ FULLY REFUNDED' : '⚠ PARTIALLY REFUNDED';
            } else if (statusRow) {
                statusRow.remove();
            }
        }

        const receiptItemsContainer = workspace.querySelector('#receipt-items-body');
        if (receiptItemsContainer && orderData.items) {
            let itemsHtml = '';
            orderData.items.forEach(item => {
                const itemTotal = Number(item.total);
                const safeItemTotal = !isNaN(itemTotal) ? itemTotal.toLocaleString() : '0';
                const unitLabel = item.saleUnit === 'Piece' ? 'pc' : ((item.saleUnit === 'Kg' || item.saleUnit === 'g') ? item.saleUnit.toLowerCase() : (item.saleUnit === 'Pack' ? 'pack' : ''));
                const qtyDisplay = unitLabel ? `${item.qty || 0} ${unitLabel}${(item.qty || 0) === 1 ? '' : 's'}` : (item.qty || 0);
                const refundedTag = Number(item.refundedQty) > 0 ? ` <small style="color:#991b1b;">(${item.refundedQty} refunded)</small>` : '';
                itemsHtml += `
                    <tr>
                        <td style="font-weight: bold;">${item.name || ''}${refundedTag}</td>
                        <td>${qtyDisplay}</td>
                        <td>₦${safeItemTotal}</td>
                    </tr>
                `;
            });
            receiptItemsContainer.innerHTML = itemsHtml;
        }

        if (printableBox && !printableBox.querySelector('.receipt-promo-footer')) {
            const promoDiv = document.createElement('div');
            promoDiv.className = 'receipt-promo-footer';
            promoDiv.style.cssText = 'text-align: center; margin-top: 15px; font-size: 11px; font-weight: bold; border-top: 1px dashed #ccc; padding-top: 10px;';
            promoDiv.innerHTML = 'FOR SIMILAR RECEIPT FOR YOUR BUSINESS: 09168140710';
            printableBox.appendChild(promoDiv);
        }

        if (currentStoreId) {
            getStoreProfile().then(storeData => {
                const nameEl = workspace.querySelector('#receipt-store-name');
                const addressEl = workspace.querySelector('#receipt-store-address');
                const phoneEl = workspace.querySelector('#receipt-store-phone');

                if (nameEl) nameEl.textContent = storeData.businessName || "";
                if (addressEl) addressEl.textContent = storeData.address || "";
                if (phoneEl) phoneEl.textContent = storeData.phone ? `Tel: ${storeData.phone}` : "";

                triggerThermalPrint(printableBox.innerHTML);
            }).catch(() => {
                triggerThermalPrint(printableBox.innerHTML);
            });
        } else {
            triggerThermalPrint(printableBox.innerHTML);
        }
    }, 150);
}

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
            getStoreProfile().then(storeData => {
                setText('#debt-receipt-store-name', storeData.businessName || "");
                setText('#debt-receipt-store-address', storeData.address || "");
                setText('#debt-receipt-store-phone', storeData.phone ? `Tel: ${storeData.phone}` : "");
                triggerThermalPrint(printableBox.innerHTML);
            }).catch(() => triggerThermalPrint(printableBox.innerHTML));
        }
    }, 150);
}

function renderRefundReceiptView(refundData) {
    const mainWrapper = document.getElementById('dashboard-main-wrapper');
    if (mainWrapper) {
        mainWrapper.classList.add('active');
        mainWrapper.style.display = 'block';
    }

    const workspace = document.getElementById('workspace-content');
    const template = document.getElementById('refund-receipt-view-template');
    if (!workspace || !template) return;

    workspace.innerHTML = template.innerHTML;

    setTimeout(() => {
        const setText = (sel, val) => {
            const el = workspace.querySelector(sel);
            if (el) el.textContent = val;
        };

        setText('#refund-receipt-id', refundData.refundId || '--');
        setText('#refund-receipt-tx-id', refundData.txId || '--');
        setText('#refund-receipt-date', refundData.date ? new Date(refundData.date).toLocaleString() : new Date().toLocaleString());
        setText('#refund-receipt-customer-name', refundData.customerName || 'Walk-In Customer');
        setText('#refund-receipt-staff', refundData.processedBy || '');
        setText('#refund-receipt-method', refundData.method || 'Cash');
        setText('#refund-receipt-total', Number(refundData.totalRefund || 0).toLocaleString());

        const itemsBody = workspace.querySelector('#refund-receipt-items-body');
        if (itemsBody) {
            let itemsHtml = '';
            (refundData.items || []).forEach(item => {
                const unitLabel = item.saleUnit === 'Piece' ? 'pc' : ((item.saleUnit === 'Kg' || item.saleUnit === 'g') ? item.saleUnit.toLowerCase() : 'pack');
                itemsHtml += `
                    <tr>
                        <td>${item.name || ''}</td>
                        <td>${item.qty} ${unitLabel}${item.qty === 1 ? '' : 's'}</td>
                        <td style="text-align:right;">₦${Number(item.amount || 0).toLocaleString()}</td>
                    </tr>
                `;
            });
            itemsBody.innerHTML = itemsHtml;
        }

        const reasonEl = workspace.querySelector('#refund-receipt-reason');
        if (reasonEl) reasonEl.textContent = refundData.reason ? `Reason: ${refundData.reason}` : '';

        const printableBox = workspace.querySelector('#printable-refund-receipt-box');

        if (currentStoreId && printableBox) {
            getStoreProfile().then(storeData => {
                setText('#refund-receipt-store-name', storeData.businessName || "");
                setText('#refund-receipt-store-address', storeData.address || "");
                setText('#refund-receipt-store-phone', storeData.phone ? `Tel: ${storeData.phone}` : "");
                triggerThermalPrint(printableBox.innerHTML);
            }).catch(() => triggerThermalPrint(printableBox.innerHTML));
        }
    }, 150);
}
