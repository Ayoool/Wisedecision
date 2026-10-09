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
