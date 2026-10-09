// ==================== WISE DECISION MATERIALS PATCH (v1) ====================
// Loads AFTER every other patch. Adds a dedicated Building Materials / Hardware
// dashboard with delivery charges, wastage log, and materials-aware selling.
//
// Nothing existing is touched. Materials stores are detected via
// stores/{storeId}/storeType === 'hardware' OR starts with 'hardware:'.

console.log("Wise Decision materials-patch.js — v1 loaded");

// =====================================================================
// STATE
// =====================================================================
var wdmStoreType = null;
var wdmListenerAttached = false;

// =====================================================================
// HELPERS
// =====================================================================
function wdmEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function wdmMoney(n) {
    return window.formatMoney ? window.formatMoney(n) : ('₦' + (Number(n) || 0).toLocaleString());
}
function wdmNum(n) { return Number(n) || 0; }
function wdmPad(n) { return String(n).padStart(2, '0'); }
function wdmToday() {
    const d = new Date();
    return d.getFullYear() + '-' + wdmPad(d.getMonth()+1) + '-' + wdmPad(d.getDate());
}
function wdmNow() { return new Date().toISOString(); }

// =====================================================================
// DETECT IF THIS IS A MATERIALS STORE
// =====================================================================
function wdmIsMaterialsStore() {
    if (!wdmStoreType) return false;
    var t = String(wdmStoreType).toLowerCase();
    return t === 'hardware' || t.indexOf('hardware:') === 0;
}

// =====================================================================
// SIDEBAR SWITCHER — replace retail sidebar with materials sidebar
// =====================================================================
function wdmApplySidebar() {
    var side = document.querySelector('#dashboard-main-wrapper .sidebar');
    if (!side) return;

    var isMaterials = wdmIsMaterialsStore();
    var isAdmin = (typeof currentUserRole !== 'undefined') && currentUserRole === 'Admin'
                  && (typeof currentStoreId !== 'undefined') && currentStoreId && currentStoreId !== 'SUPER_ADMIN';

    // Find all existing sidebar buttons
    var buttons = side.querySelectorAll('button');

    // Buttons we want to KEEP for materials (by text match)
    var keepLabels = ['Dashboard', 'POS Sales', 'Inventory', 'Accountant', 'Reports', 'Expenses', 'Staff', 'Customers', 'Suppliers', 'Stock Transfers', 'Branches', 'Business Settings', 'Audit Log', 'Logout'];

    if (isMaterials && isAdmin) {
        // Hide POS Sales + Inventory (materials dashboard replaces them)
        buttons.forEach(function (b) {
            var t = (b.textContent || '').trim();
            if (t.indexOf('POS Sales') !== -1) b.style.display = 'none';
            else if (t.indexOf('Inventory') !== -1 && t.indexOf('Materials') === -1) b.style.display = 'none';
        });

        // Insert Materials Dashboard + New Sale + Wastage + Delivery Settings after the Dashboard button
        var dashBtn = null;
        buttons.forEach(function (b) {
            if ((b.textContent || '').indexOf('Dashboard') !== -1 && !dashBtn) dashBtn = b;
        });

        if (dashBtn && !document.getElementById('wdm-sidebar-materials-btn')) {
            var matBtn = document.createElement('button');
            matBtn.id = 'wdm-sidebar-materials-btn';
            matBtn.className = 'menu-btn';
            matBtn.style.cssText = 'background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; border-left:4px solid #f97316; font-weight:700;';
            matBtn.textContent = '🏗️ Materials Dashboard';
            matBtn.onclick = function () { wdmShowMaterialsDashboard(); };
            dashBtn.parentNode.insertBefore(matBtn, dashBtn.nextSibling);
        }

        if (dashBtn && !document.getElementById('wdm-sidebar-newsale-btn')) {
            var saleBtn = document.createElement('button');
            saleBtn.id = 'wdm-sidebar-newsale-btn';
            saleBtn.className = 'menu-btn';
            saleBtn.style.cssText = 'background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-left:4px solid #22c55e; font-weight:700;';
            saleBtn.textContent = '🛒 New Sale';
            saleBtn.onclick = function () { switchView('pos-view'); };
            var anchor = document.getElementById('wdm-sidebar-materials-btn');
            (anchor || dashBtn).parentNode.insertBefore(saleBtn, (anchor || dashBtn).nextSibling);
        }

        if (!document.getElementById('wdm-sidebar-wastage-btn')) {
            var wastBtn = document.createElement('button');
            wastBtn.id = 'wdm-sidebar-wastage-btn';
            wastBtn.className = 'menu-btn';
            wastBtn.style.cssText = 'background:#fef2f2; color:#991b1b; border:1px solid #fecaca; border-left:4px solid #ef4444; font-weight:700;';
            wastBtn.textContent = '🔨 Damaged / Wastage';
            wastBtn.onclick = function () { wdmShowWastageLog(); };
            var anchor2 = document.getElementById('wdm-sidebar-newsale-btn') || dashBtn;
            anchor2.parentNode.insertBefore(wastBtn, anchor2.nextSibling);
        }
    } else {
        // Remove materials-only buttons if switching away
        ['wdm-sidebar-materials-btn', 'wdm-sidebar-newsale-btn', 'wdm-sidebar-wastage-btn'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.remove();
        });

        // Restore POS + Inventory if they were hidden
        buttons.forEach(function (b) {
            var t = (b.textContent || '').trim();
            if (t.indexOf('POS Sales') !== -1) b.style.display = '';
            else if (t.indexOf('Inventory') !== -1 && t.indexOf('Materials') === -1) b.style.display = '';
        });
    }
}

// =====================================================================
// MATERIALS DASHBOARD
// =====================================================================
window.wdmShowMaterialsDashboard = function () {
    var ws = document.getElementById('workspace-content');
    if (!ws) return;

    ws.innerHTML =
        '<h2 style="margin:0 0 6px 0;">🏗️ Materials Dashboard</h2>' +
        '<p style="font-size:13px; color:var(--text-muted); margin:0 0 16px 0;">Everything you sell and stock — roofing, boards, nails, accessories — all in one view.</p>' +

        // Top summary cards
        '<div id="wdm-summary-cards" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:16px;">' +
          '<div style="background:linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%); border:1px solid #a7f3d0; padding:14px; border-radius:12px;">' +
            '<span style="font-size:11px; color:#047857; font-weight:bold; text-transform:uppercase;">Today Revenue</span>' +
            '<h3 id="wdm-card-today-revenue" style="font-size:20px; color:#065f46; margin:6px 0 0 0;">₦0</h3>' +
          '</div>' +
          '<div style="background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%); border:1px solid #bfdbfe; padding:14px; border-radius:12px;">' +
            '<span style="font-size:11px; color:#1e40af; font-weight:bold; text-transform:uppercase;">Today Profit</span>' +
            '<h3 id="wdm-card-today-profit" style="font-size:20px; color:#1d4ed8; margin:6px 0 0 0;">₦0</h3>' +
          '</div>' +
          '<div style="background:linear-gradient(135deg,#fef3c7 0%,#fde68a 100%); border:1px solid #fde68a; padding:14px; border-radius:12px;">' +
            '<span style="font-size:11px; color:#92400e; font-weight:bold; text-transform:uppercase;">This Month Revenue</span>' +
            '<h3 id="wdm-card-month-revenue" style="font-size:20px; color:#78350f; margin:6px 0 0 0;">₦0</h3>' +
          '</div>' +
          '<div style="background:linear-gradient(135deg,#fee2e2 0%,#fecaca 100%); border:1px solid #fecaca; padding:14px; border-radius:12px;">' +
            '<span style="font-size:11px; color:#991b1b; font-weight:bold; text-transform:uppercase;">Capital Locked</span>' +
            '<h3 id="wdm-card-capital" style="font-size:20px; color:#b91c1c; margin:6px 0 0 0;">₦0</h3>' +
            '<span style="font-size:10px; color:#7f1d1d;">in unsold stock</span>' +
          '</div>' +
        '</div>' +

        // Quick action buttons
        '<div style="display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap;">' +
          '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:10px 16px;" onclick="switchView(\'pos-view\')">🛒 New Sale</button>' +
          '<button class="menu-btn" style="width:auto; margin:0; padding:10px 16px; background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8; font-weight:bold;" onclick="switchView(\'inventory-view\')">📦 Manage Stock</button>' +
          '<button class="menu-btn" style="width:auto; margin:0; padding:10px 16px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-weight:bold;" onclick="wdmShowWastageLog()">🔨 Wastage Log</button>' +
          '<button class="menu-btn" style="width:auto; margin:0; padding:10px 16px; background:#f5f3ff; border:1px solid #ddd6fe; color:#6d28d9; font-weight:bold;" onclick="switchView(\'suppliers-view\')">🚚 Suppliers</button>' +
        '</div>' +

        // Two-column grid: Low stock + Recent sales
        '<div style="display:grid; grid-template-columns:1fr; gap:16px;">' +

          // Low stock panel
          '<div class="security-card" style="margin:0;">' +
            '<h3 style="margin:0 0 10px 0; font-size:14px;">⚠️ Low Stock Alerts</h3>' +
            '<div id="wdm-low-stock-body" style="font-size:13px; color:#64748b;">Checking inventory...</div>' +
          '</div>' +

          // Recent sales panel
          '<div class="security-card" style="margin:0;">' +
            '<h3 style="margin:0 0 10px 0; font-size:14px;">🧾 Recent Sales (last 10)</h3>' +
            '<div id="wdm-recent-sales-body" style="font-size:13px; color:#64748b;">Loading sales...</div>' +
          '</div>' +

          // Top sellers panel
          '<div class="security-card" style="margin:0;">' +
            '<h3 style="margin:0 0 10px 0; font-size:14px;">🏆 Top Sellers This Week</h3>' +
            '<div id="wdm-top-sellers-body" style="font-size:13px; color:#64748b;">Loading...</div>' +
          '</div>' +

        '</div>';

    wdmLoadDashboardData();
};

// =====================================================================
// LOAD MATERIALS DASHBOARD DATA
// =====================================================================
async function wdmLoadDashboardData() {
    if (!currentStoreId) return;
    try {
        const db = firebase.database();
        const [invSnap, txSnap] = await Promise.all([
            db.ref('stores/' + currentStoreId + '/inventory').once('value'),
            db.ref('stores/' + currentStoreId + '/transactions').limitToLast(500).once('value')
        ]);

        // --- Build inventory cache ---
        var invByBranch = invSnap.val() || {};
        var allItems = [];
        Object.keys(invByBranch).forEach(function (branchId) {
            Object.keys(invByBranch[branchId] || {}).forEach(function (id) {
                var it = invByBranch[branchId][id];
                if (it) allItems.push(Object.assign({}, it, { _branch: branchId, _id: id }));
            });
        });

        // --- Capital locked ---
        var capital = 0, lowStock = [];
        allItems.forEach(function (p) {
            var stock = wdmNum(p.stock !== undefined ? p.stock : (p.stockQty || 0));
            var cost = wdmNum(p.costPrice);
            capital += stock * cost;
            var threshold = (p.lowStockThreshold != null) ? wdmNum(p.lowStockThreshold) : 5;
            if (stock <= threshold && stock >= 0) {
                lowStock.push({
                    name: p.name || p.productName || 'Unnamed',
                    stock: stock,
                    threshold: threshold,
                    unit: p.bulkUnitName || 'Pack'
                });
            }
        });
        lowStock.sort(function (a, b) { return a.stock - b.stock; });

        var capitalEl = document.getElementById('wdm-card-capital');
        if (capitalEl) capitalEl.textContent = wdmMoney(capital);

        // --- Low stock list ---
        var ls = document.getElementById('wdm-low-stock-body');
        if (ls) {
            if (lowStock.length === 0) {
                ls.innerHTML = '<div style="color:#166534; font-weight:bold;">✅ All stock healthy.</div>';
            } else {
                ls.innerHTML = lowStock.slice(0, 12).map(function (p) {
                    return '<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9;">' +
                        '<span>' + wdmEsc(p.name) + '</span>' +
                        '<span style="color:#b91c1c; font-weight:bold;">' + p.stock + ' ' + wdmEsc(p.unit) + '</span>' +
                    '</div>';
                }).join('');
            }
        }

        // --- Today / month revenue + profit ---
        var today = wdmToday();
        var thisMonth = today.substring(0, 7);
        var todayRev = 0, todayProfit = 0, monthRev = 0;

        // --- Recent sales + top sellers ---
        var recent = [];
        var sellerCounts = {};   // name → { qty, revenue }
        var startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        // --- Cost lookup for profit calculation ---
        var costMap = {};
        allItems.forEach(function (p) {
            var name = (p.name || p.productName || '').toLowerCase().trim();
            if (name) costMap[name] = wdmNum(p.costPrice);
        });

        txSnap.forEach(function (child) {
            var tx = child.val();
            if (!tx || !tx.date) return;
            var total = wdmNum(tx.totalAmount);
            var d = new Date(tx.date);
            var dayStr = d.toISOString().substring(0, 10);
            var monthStr = dayStr.substring(0, 7);

            if (dayStr === today) todayRev += total;
            if (monthStr === thisMonth) monthRev += total;

            // Profit estimate
            var txCost = 0;
            (tx.items || []).forEach(function (item) {
                var key = (item.name || '').toLowerCase().trim();
                var itemCost = wdmNum(item.costPrice) || costMap[key] || 0;
                var pieces = wdmNum(item.piecesNeeded !== undefined ? item.piecesNeeded : item.qty);
                txCost += itemCost * pieces;
            });
            var txProfit = total - txCost;
            if (dayStr === today) todayProfit += txProfit;

            recent.push({
                txId: tx.txId || child.key,
                date: tx.date,
                total: total,
                customer: tx.customerName || 'Walk-In',
                staff: tx.staff || tx.soldBy || 'Staff'
            });

            // Top sellers (this week)
            if (d >= startOfWeek) {
                (tx.items || []).forEach(function (item) {
                    var key = item.name || 'Unnamed';
                    if (!sellerCounts[key]) sellerCounts[key] = { qty: 0, revenue: 0 };
                    var qty = wdmNum(item.qty);
                    sellerCounts[key].qty += qty;
                    sellerCounts[key].revenue += wdmNum(item.total);
                });
            }
        });

        var revEl = document.getElementById('wdm-card-today-revenue');
        if (revEl) revEl.textContent = wdmMoney(todayRev);
        var profEl = document.getElementById('wdm-card-today-profit');
        if (profEl) profEl.textContent = wdmMoney(todayProfit);
        var monthEl = document.getElementById('wdm-card-month-revenue');
        if (monthEl) monthEl.textContent = wdmMoney(monthRev);

        // --- Recent sales list ---
        recent.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
        recent = recent.slice(0, 10);
        var rs = document.getElementById('wdm-recent-sales-body');
        if (rs) {
            if (recent.length === 0) {
                rs.innerHTML = '<div style="color:#94a3b8;">No sales yet.</div>';
            } else {
                rs.innerHTML = recent.map(function (r) {
                    return '<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9; gap:8px;">' +
                        '<div><strong>' + wdmEsc(r.txId) + '</strong><br><small style="color:#64748b;">' + wdmEsc(r.customer) + ' · ' + wdmEsc(r.staff) + '</small></div>' +
                        '<div style="text-align:right;"><strong>' + wdmMoney(r.total) + '</strong><br><small style="color:#64748b;">' + new Date(r.date).toLocaleDateString() + '</small></div>' +
                    '</div>';
                }).join('');
            }
        }

        // --- Top sellers list ---
        var topArr = Object.keys(sellerCounts).map(function (k) {
            return { name: k, qty: sellerCounts[k].qty, revenue: sellerCounts[k].revenue };
        }).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 5);

        var ts = document.getElementById('wdm-top-sellers-body');
        if (ts) {
            if (topArr.length === 0) {
                ts.innerHTML = '<div style="color:#94a3b8;">No sales this week yet.</div>';
            } else {
                ts.innerHTML = topArr.map(function (t, i) {
                    return '<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9;">' +
                        '<span>' + (i + 1) + '. ' + wdmEsc(t.name) + '</span>' +
                        '<span style="font-weight:bold; color:#166534;">' + wdmMoney(t.revenue) + ' <small style="color:#64748b; font-weight:normal;">×' + t.qty + '</small></span>' +
                    '</div>';
                }).join('');
            }
        }

    } catch (e) {
        console.warn('[materials-patch] dashboard load error:', e);
    }
}

// =====================================================================
// WASTAGE / DAMAGED LOG — a page to record broken/spoiled stock
// =====================================================================
window.wdmShowWastageLog = function () {
    var ws = document.getElementById('workspace-content');
    if (!ws) return;

    ws.innerHTML =
        '<h2 style="margin:0 0 6px 0;">🔨 Damaged / Wastage Log</h2>' +
        '<p style="font-size:13px; color:var(--text-muted); margin:0 0 16px 0;">Record broken, spoiled, or otherwise unsellable stock. This deducts from inventory and logs the loss.</p>' +

        // Record wastage form
        '<div style="background:#fff; padding:16px; border-radius:12px; border:1px solid #eef2f7; margin-bottom:16px; box-shadow:0 6px 18px rgba(15,23,42,0.04);">' +
          '<h3 style="margin:0 0 12px 0; font-size:14px;">Record New Wastage</h3>' +

          '<label style="display:block; font-size:11px; font-weight:bold; color:#334155; margin-bottom:4px; text-transform:uppercase;">Select Product</label>' +
          '<select id="wdm-w-product" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box; margin-bottom:12px;"></select>' +

          '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div>' +
              '<label style="display:block; font-size:11px; font-weight:bold; color:#334155; margin-bottom:4px; text-transform:uppercase;">Quantity Wasted</label>' +
              '<input id="wdm-w-qty" type="number" min="0.01" step="0.01" placeholder="e.g. 3" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;">' +
            '</div>' +
            '<div>' +
              '<label style="display:block; font-size:11px; font-weight:bold; color:#334155; margin-bottom:4px; text-transform:uppercase;">Reason</label>' +
              '<select id="wdm-w-reason" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;">' +
                '<option>Broken</option>' +
                '<option>Damp / Water damage</option>' +
                '<option>Termite / Pest</option>' +
                '<option>Stolen</option>' +
                '<option>Lost</option>' +
                '<option>Theft by staff</option>' +
                '<option>Customer damage</option>' +
                '<option>Other</option>' +
              '</select>' +
            '</div>' +
          '</div>' +

          '<label style="display:block; font-size:11px; font-weight:bold; color:#334155; margin-top:12px; margin-bottom:4px; text-transform:uppercase;">Note (optional)</label>' +
          '<textarea id="wdm-w-note" rows="2" placeholder="e.g. Fell off truck during delivery" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;"></textarea>' +

          '<div id="wdm-w-error" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:12px;"></div>' +

          '<div style="display:flex; gap:10px; margin-top:14px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center; background:linear-gradient(135deg,#dc2626 0%,#991b1b 100%);" onclick="wdmSaveWastage()">🔨 Record Wastage & Deduct Stock</button>' +
          '</div>' +
        '</div>' +

        // History
        '<div style="background:#fff; border-radius:12px; border:1px solid #eef2f7; overflow-x:auto; box-shadow:0 6px 18px rgba(15,23,42,0.04);">' +
          '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
            '<thead><tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1; color:#475569;">' +
              '<th style="padding:10px; text-align:left;">Date</th>' +
              '<th style="padding:10px; text-align:left;">Product</th>' +
              '<th style="padding:10px; text-align:right;">Qty</th>' +
              '<th style="padding:10px; text-align:left;">Reason</th>' +
              '<th style="padding:10px; text-align:right;">Loss Value</th>' +
              '<th style="padding:10px; text-align:left;">Recorded By</th>' +
            '</tr></thead>' +
            '<tbody id="wdm-w-history-body"><tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">Loading...</td></tr></tbody>' +
          '</table>' +
        '</div>';

    wdmPopulateWastageProductDropdown();
    wdmLoadWastageHistory();
};

async function wdmPopulateWastageProductDropdown() {
    if (!currentStoreId) return;
    try {
        const snap = await firebase.database().ref('stores/' + currentStoreId + '/inventory').once('value');
        const invByBranch = snap.val() || {};
        const options = [];
        const seen = {};
        Object.keys(invByBranch).forEach(function (branchId) {
            Object.keys(invByBranch[branchId] || {}).forEach(function (id) {
                const it = invByBranch[branchId][id];
                if (!it) return;
                const name = it.name || it.productName || 'Unnamed';
                const key = name.toLowerCase().trim();
                if (seen[key]) return;
                seen[key] = true;
                options.push({ name: name, id: id, branch: branchId, cost: wdmNum(it.costPrice) });
            });
        });
        options.sort(function (a, b) { return a.name.localeCompare(b.name); });

        const sel = document.getElementById('wdm-w-product');
        if (sel) {
            sel.innerHTML = options.map(function (o) {
                return '<option value="' + wdmEsc(o.branch) + '|' + wdmEsc(o.id) + '">' + wdmEsc(o.name) + '</option>';
            }).join('') || '<option value="">No products yet</option>';
        }
    } catch (e) {
        console.warn('[materials-patch] wastage dropdown load error:', e);
    }
}

window.wdmSaveWastage = async function () {
    var err = document.getElementById('wdm-w-error');
    err.style.display = 'none';
    var fail = function (m) { err.textContent = m; err.style.display = 'block'; };

    var selVal = document.getElementById('wdm-w-product').value;
    if (!selVal || selVal.indexOf('|') === -1) return fail('Select a product.');
    var parts = selVal.split('|');
    var branchId = parts[0];
    var productId = parts[1];

    var qty = parseFloat(document.getElementById('wdm-w-qty').value) || 0;
    if (qty <= 0) return fail('Quantity must be greater than 0.');

    var reason = document.getElementById('wdm-w-reason').value;
    var note = (document.getElementById('wdm-w-note').value || '').trim();
    var recordedBy = (typeof currentStaffName !== 'undefined' && currentStaffName) || (document.getElementById('user-role-label')?.textContent || 'Admin');

    try {
        const db = firebase.database();
        const prodRef = db.ref('stores/' + currentStoreId + '/inventory/' + branchId + '/' + productId);
        const prodSnap = await prodRef.once('value');
        const prod = prodSnap.val();
        if (!prod) return fail('Product not found.');

        var currentStock = wdmNum(prod.stock !== undefined ? prod.stock : (prod.stockQty || 0));
        if (qty > currentStock) return fail('You only have ' + currentStock + ' in stock. Cannot write off ' + qty + '.');

        var costPerUnit = wdmNum(prod.costPrice);
        var lossValue = costPerUnit * qty;
        var newStock = currentStock - qty;
        var nowIso = wdmNow();

        var wastageId = 'WST-' + Date.now();
        var updates = {};
        updates['stores/' + currentStoreId + '/inventory/' + branchId + '/' + productId + '/stock'] = newStock;
        updates['stores/' + currentStoreId + '/inventory/' + branchId + '/' + productId + '/stockQty'] = newStock;
        updates['stores/' + currentStoreId + '/wastage/' + wastageId] = {
            wastageId: wastageId,
            productId: productId,
            productName: prod.name || prod.productName || 'Unnamed',
            branchId: branchId,
            quantity: qty,
            reason: reason,
            note: note,
            lossValue: lossValue,
            costPerUnit: costPerUnit,
            stockBefore: currentStock,
            stockAfter: newStock,
            recordedBy: recordedBy,
            date: nowIso
        };

        await db.ref().update(updates);

        document.getElementById('wdm-w-qty').value = '';
        document.getElementById('wdm-w-note').value = '';
        alert('✅ Wastage recorded. Stock updated.');

        wdmLoadWastageHistory();
        wdmPopulateWastageProductDropdown();
    } catch (e) {
        fail('Could not record: ' + (e.message || e));
    }
};

async function wdmLoadWastageHistory() {
    if (!currentStoreId) return;
    const tbody = document.getElementById('wdm-w-history-body');
    if (!tbody) return;

    try {
        const snap = await firebase.database().ref('stores/' + currentStoreId + '/wastage').once('value');
        const rows = [];
        snap.forEach(function (child) { rows.push(child.val()); });
        rows.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">No wastage recorded yet. Good news!</td></tr>';
            return;
        }
        tbody.innerHTML = rows.slice(0, 100).map(function (w) {
            return '<tr style="border-bottom:1px solid #f1f5f9;">' +
                '<td style="padding:8px;">' + (w.date ? new Date(w.date).toLocaleString() : '—') + '</td>' +
                '<td style="padding:8px;"><strong>' + wdmEsc(w.productName) + '</strong></td>' +
                '<td style="padding:8px; text-align:right;">' + wdmNum(w.quantity) + '</td>' +
                '<td style="padding:8px;">' + wdmEsc(w.reason) + '</td>' +
                '<td style="padding:8px; text-align:right; color:#b91c1c; font-weight:bold;">' + wdmMoney(w.lossValue) + '</td>' +
                '<td style="padding:8px;">' + wdmEsc(w.recordedBy) + '</td>' +
            '</tr>';
        }).join('');
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#991b1b; padding:20px;">Failed to load: ' + wdmEsc(e.message) + '</td></tr>';
    }
}

// =====================================================================
// DELIVERY CHARGE ON POS — inject a checkbox into the POS screen
// =====================================================================
function wdmInjectDeliveryCharge() {
    var posView = document.getElementById('pos-view');
    if (!posView) return;
    if (document.getElementById('wdm-delivery-box')) return;
    if (!wdmIsMaterialsStore()) return;

    // Find the cart panel (contains "Current Order Cart" heading)
    var cartHeader = null;
    posView.querySelectorAll('h3').forEach(function (h) {
        if ((h.textContent || '').indexOf('Current Order Cart') !== -1) cartHeader = h;
    });
    if (!cartHeader) return;

    var box = document.createElement('div');
    box.id = 'wdm-delivery-box';
    box.style.cssText = 'background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px; margin-bottom:10px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;';
    box.innerHTML =
        '<input type="checkbox" id="wdm-delivery-check" style="width:16px; height:16px; margin:0;" onchange="wdmDeliveryToggle()">' +
        '<label for="wdm-delivery-check" style="margin:0; font-size:12px; font-weight:bold; color:#92400e; cursor:pointer;">🚚 Add delivery charge</label>' +
        '<input type="number" id="wdm-delivery-amount" placeholder="₦ Amount" min="0" style="width:120px; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; display:none;" oninput="wdmApplyDeliveryCharge()">';

    // Insert before the cart total row
    var cartContainer = cartHeader.parentNode;
    if (cartContainer) cartContainer.insertBefore(box, cartHeader.nextSibling);
}

window.wdmDeliveryToggle = function () {
    var cb = document.getElementById('wdm-delivery-check');
    var amt = document.getElementById('wdm-delivery-amount');
    if (!cb || !amt) return;
    amt.style.display = cb.checked ? 'inline-block' : 'none';
    if (!cb.checked) amt.value = '';
    wdmApplyDeliveryCharge();
};

window.wdmApplyDeliveryCharge = function () {
    if (typeof window.wdmDeliveryChargeValue === 'undefined') window.wdmDeliveryChargeValue = 0;
    var cb = document.getElementById('wdm-delivery-check');
    var amt = document.getElementById('wdm-delivery-amount');
    var val = (cb && cb.checked && amt) ? (parseFloat(amt.value) || 0) : 0;
    window.wdmDeliveryChargeValue = val;
    // Note: this value is read by the submitOrderForAccountant patch below
};

// Wrap submitOrderForAccountant to add the delivery charge to the order
window.addEventListener('load', function () {
    if (typeof window.submitOrderForAccountant === 'function' && !window.__wdmDeliveryHooked) {
        window.__wdmDeliveryHooked = true;
        var orig = window.submitOrderForAccountant;
        window.submitOrderForAccountant = function () {
            var result = orig.apply(this, arguments);
            try {
                var charge = wdmNum(window.wdmDeliveryChargeValue);
                if (charge > 0 && typeof currentCart !== 'undefined' && Array.isArray(currentCart)) {
                    // Add a synthetic "Delivery Charge" line item
                    currentCart.push({
                        id: '__delivery__',
                        name: 'Delivery Charge',
                        qty: 1,
                        saleUnit: 'Piece',
                        unitsPerPack: 1,
                        piecesNeeded: 1,
                        price: charge,
                        total: charge,
                        customerType: 'Retail',
                        baseUnitName: '',
                        bulkUnitName: ''
                    });
                    if (typeof renderCart === 'function') renderCart();
                }
            } catch (e) { console.warn('[materials-patch] delivery charge hook error:', e); }
            return result;
        };
    }
});

// =====================================================================
// DETECT STORE TYPE ON LOGIN — same pattern as phone vendor patch
// =====================================================================
function wdmWatchStoreType() {
    if (!currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
    try {
        firebase.database().ref('stores/' + currentStoreId + '/storeType').on('value', function (snap) {
            wdmStoreType = snap.val() || 'general';
            wdmApplySidebar();
        });
    } catch (e) { /* ignore */ }
}

// =====================================================================
// MAIN ATTACH — runs on every DOM change (idempotent)
// =====================================================================
function wdmAttach() {
    if (typeof currentStoreId !== 'undefined' && currentStoreId && currentStoreId !== 'SUPER_ADMIN' && !wdmStoreType) {
        wdmWatchStoreType();
    }
    wdmApplySidebar();
    wdmInjectDeliveryCharge();
}

window.addEventListener('load', function () {
    setTimeout(function () { try { wdmAttach(); } catch (e) { console.warn(e); } }, 900);

    var wdmObs = new MutationObserver(function () {
        try { wdmAttach(); } catch (e) { console.warn(e); }
    });
    if (document.body) wdmObs.observe(document.body, { childList: true, subtree: true });
});
