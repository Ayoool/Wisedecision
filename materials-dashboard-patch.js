// ==================== WISE DECISION MATERIALS DASHBOARD REDESIGN (v1) ====================
// Load AFTER materials-patch.js and materials-polish-patch.js.
// Replaces the look and layout of the Materials Dashboard. Same data, cleaner screen:
//   * one big "Today" card (sales, profit, number of sales)
//   * one big green "Start New Sale" button
//   * Month / Capital tiles
//   * quick-action buttons in a tidy 2-column grid
//   * 7-day sales bars
//   * Low stock, Recent sales, Top sellers as clean lists
// Nothing else in the app is touched.

console.log("Wise Decision materials-dashboard-patch.js — v1 loaded");

(function () {
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function num(n) { return Number(n) || 0; }
    function money(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + num(n).toLocaleString()); }
    function pad(n) { return String(n).padStart(2, '0'); }
    function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

    // ---------- styles (added once) ----------
    function addStyles() {
        if (document.getElementById('wdd-styles')) return;
        var st = document.createElement('style');
        st.id = 'wdd-styles';
        st.textContent =
        '.wdd{max-width:720px;margin:0 auto;color:#0f172a;}' +
        '.wdd *{box-sizing:border-box;}' +
        '.wdd-head{margin:0 0 14px 0;}' +
        '.wdd-hi{font-size:20px;font-weight:800;}' +
        '.wdd-date{font-size:12px;color:#64748b;margin-top:2px;}' +
        '.wdd-hero{background:linear-gradient(135deg,#f97316 0%,#c2410c 100%);color:#fff;border-radius:18px;padding:18px;margin-bottom:12px;box-shadow:0 10px 24px rgba(234,88,12,.28);}' +
        '.wdd-hero-label{font-size:12px;opacity:.85;text-transform:uppercase;letter-spacing:.6px;font-weight:700;}' +
        '.wdd-hero-amt{font-size:32px;font-weight:800;margin:4px 0 14px 0;line-height:1.1;}' +
        '.wdd-hero-row{display:flex;gap:10px;}' +
        '.wdd-hero-row>div{flex:1;background:rgba(255,255,255,.14);border-radius:12px;padding:10px 12px;}' +
        '.wdd-hero-row b{display:block;font-size:16px;}' +
        '.wdd-hero-row span{font-size:11px;opacity:.85;}' +
        '.wdd-cta{width:100%;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:800;color:#fff;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);box-shadow:0 8px 18px rgba(22,163,74,.3);cursor:pointer;margin-bottom:12px;}' +
        '.wdd-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;}' +
        '.wdd-tile{background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:12px 14px;}' +
        '.wdd-tile small{display:block;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}' +
        '.wdd-tile b{display:block;font-size:17px;margin-top:4px;}' +
        '.wdd-tile em{font-style:normal;font-size:10px;color:#94a3b8;}' +
        '.wdd-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}' +
        '.wdd-act{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e8eef5;border-radius:12px;padding:12px;font-size:13px;font-weight:700;color:#334155;cursor:pointer;text-align:left;}' +
        '.wdd-act span{font-size:18px;}' +
        '.wdd-card{background:#fff;border:1px solid #e8eef5;border-radius:16px;padding:14px;margin-bottom:12px;}' +
        '.wdd-card-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}' +
        '.wdd-card-h h3{margin:0;font-size:14px;}' +
        '.wdd-badge{font-size:11px;font-weight:800;padding:3px 9px;border-radius:99px;background:#fee2e2;color:#b91c1c;}' +
        '.wdd-badge.ok{background:#dcfce7;color:#166534;}' +
        '.wdd-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13px;}' +
        '.wdd-row:last-child{border-bottom:none;}' +
        '.wdd-sub{display:block;font-size:11px;color:#64748b;margin-top:2px;}' +
        '.wdd-empty{font-size:13px;color:#94a3b8;padding:6px 0;}' +
        '.wdd-bars{display:flex;align-items:flex-end;gap:8px;height:96px;}' +
        '.wdd-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;}' +
        '.wdd-bar i{display:block;width:100%;background:#fed7aa;border-radius:6px 6px 0 0;min-height:3px;}' +
        '.wdd-bar.today i{background:#ea580c;}' +
        '.wdd-bar small{font-size:10px;color:#64748b;margin-top:4px;}';
        document.head.appendChild(st);
    }

    // ---------- screen ----------
    window.wdmShowMaterialsDashboard = function () {
        var ws = document.getElementById('workspace-content');
        if (!ws) return;
        addStyles();

        var now = new Date();
        var h = now.getHours();
        var hi = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
        var who = (typeof currentStaffName !== 'undefined' && currentStaffName) ? ', ' + esc(String(currentStaffName).split(' ')[0]) : '';
        var dateStr = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

        ws.innerHTML =
        '<div class="wdd">' +
            '<div class="wdd-head"><div class="wdd-hi">' + hi + who + ' 👋</div><div class="wdd-date">' + esc(dateStr) + '</div></div>' +

            '<div class="wdd-hero">' +
                '<div class="wdd-hero-label">Today\'s sales</div>' +
                '<div class="wdd-hero-amt" id="wdd-rev">₦0</div>' +
                '<div class="wdd-hero-row">' +
                    '<div><b id="wdd-profit">₦0</b><span>Profit</span></div>' +
                    '<div><b id="wdd-count">0</b><span>Sales</span></div>' +
                '</div>' +
            '</div>' +

            '<button class="wdd-cta" onclick="switchView(\'pos-view\')">🛒 Start New Sale</button>' +

            '<div class="wdd-tiles">' +
                '<div class="wdd-tile"><small>This month</small><b id="wdd-month">₦0</b></div>' +
                '<div class="wdd-tile"><small>Capital locked</small><b id="wdd-capital">₦0</b><em>in unsold stock</em></div>' +
            '</div>' +

            '<div class="wdd-actions">' +
                '<button class="wdd-act" onclick="switchView(\'inventory-view\')"><span>📦</span>Manage Stock</button>' +
                '<button class="wdd-act" onclick="wdpOpenQuickAddModal && wdpOpenQuickAddModal()"><span>📚</span>Common Materials</button>' +
                '<button class="wdd-act" onclick="wdmShowWastageLog()"><span>🔨</span>Wastage Log</button>' +
                '<button class="wdd-act" onclick="switchView(\'suppliers-view\')"><span>🚚</span>Suppliers</button>' +
            '</div>' +

            '<div class="wdd-card"><div class="wdd-card-h"><h3>Last 7 days</h3></div><div class="wdd-bars" id="wdd-bars"></div></div>' +

            '<div class="wdd-card"><div class="wdd-card-h"><h3>⚠️ Low stock</h3><span class="wdd-badge" id="wdd-low-badge">…</span></div><div id="wdd-low">Checking inventory...</div></div>' +

            '<div class="wdd-card"><div class="wdd-card-h"><h3>🧾 Recent sales</h3></div><div id="wdd-recent">Loading...</div></div>' +

            '<div class="wdd-card"><div class="wdd-card-h"><h3>🏆 Top sellers this week</h3></div><div id="wdd-top">Loading...</div></div>' +
        '</div>';

        loadData();
    };

    // ---------- data ----------
    function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
    function setHtml(id, v) { var el = document.getElementById(id); if (el) el.innerHTML = v; }

    async function loadData() {
        if (typeof currentStoreId === 'undefined' || !currentStoreId) return;
        try {
            var db = firebase.database();
            var res = await Promise.all([
                db.ref('stores/' + currentStoreId + '/inventory').once('value'),
                db.ref('stores/' + currentStoreId + '/transactions').limitToLast(500).once('value')
            ]);
            var invByBranch = res[0].val() || {};
            var txSnap = res[1];

            // inventory
            var items = [];
            Object.keys(invByBranch).forEach(function (b) {
                Object.keys(invByBranch[b] || {}).forEach(function (id) {
                    if (invByBranch[b][id]) items.push(invByBranch[b][id]);
                });
            });

            var capital = 0, low = [], costMap = {};
            items.forEach(function (p) {
                var stock = num(p.stock !== undefined ? p.stock : p.stockQty);
                var cost = num(p.costPrice);
                capital += stock * cost;
                var nm = (p.name || p.productName || '').toLowerCase().trim();
                if (nm) costMap[nm] = cost;
                var thr = (p.lowStockThreshold != null) ? num(p.lowStockThreshold) : 5;
                if (stock <= thr && stock >= 0) {
                    low.push({ name: p.name || p.productName || 'Unnamed', stock: stock, unit: p.bulkUnitName || 'Pack' });
                }
            });
            low.sort(function (a, b) { return a.stock - b.stock; });
            setText('wdd-capital', money(capital));

            var badge = document.getElementById('wdd-low-badge');
            if (badge) {
                badge.textContent = low.length === 0 ? 'All good' : low.length + ' item' + (low.length === 1 ? '' : 's');
                badge.className = 'wdd-badge' + (low.length === 0 ? ' ok' : '');
            }
            setHtml('wdd-low', low.length === 0
                ? '<div class="wdd-empty">✅ All stock is healthy.</div>'
                : low.slice(0, 8).map(function (p) {
                    return '<div class="wdd-row"><span>' + esc(p.name) + '</span><strong style="color:#b91c1c;">' + p.stock + ' ' + esc(p.unit) + '</strong></div>';
                }).join(''));

            // sales
            var todayKey = dayKey(new Date());
            var monthKey = todayKey.substring(0, 7);
            var todayRev = 0, todayProfit = 0, todayCount = 0, monthRev = 0;
            var recent = [], sellers = {};
            var weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0, 0, 0, 0);

            var last7 = [];
            for (var i = 6; i >= 0; i--) {
                var d = new Date(); d.setDate(d.getDate() - i);
                last7.push({ key: dayKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }).substring(0, 3), total: 0, isToday: i === 0 });
            }

            txSnap.forEach(function (child) {
                var tx = child.val();
                if (!tx || !tx.date) return;
                var total = num(tx.totalAmount);
                var d = new Date(tx.date);
                if (isNaN(d.getTime())) return;
                var k = dayKey(d);

                if (k === todayKey) {
                    todayRev += total; todayCount++;
                    var cost = 0;
                    (tx.items || []).forEach(function (it) {
                        var c = num(it.costPrice) || costMap[(it.name || '').toLowerCase().trim()] || 0;
                        cost += c * num(it.piecesNeeded !== undefined ? it.piecesNeeded : it.qty);
                    });
                    todayProfit += total - cost;
                }
                if (k.substring(0, 7) === monthKey) monthRev += total;
                last7.forEach(function (x) { if (x.key === k) x.total += total; });

                recent.push({ id: tx.txId || child.key, date: tx.date, total: total, customer: tx.customerName || 'Walk-In', staff: tx.staff || tx.soldBy || 'Staff' });

                if (d >= weekStart) {
                    (tx.items || []).forEach(function (it) {
                        if (it.id === '__delivery__') return;
                        var nm = it.name || 'Unnamed';
                        if (!sellers[nm]) sellers[nm] = { qty: 0, rev: 0 };
                        sellers[nm].qty += num(it.qty);
                        sellers[nm].rev += num(it.total);
                    });
                }
            });

            setText('wdd-rev', money(todayRev));
            setText('wdd-profit', money(todayProfit));
            setText('wdd-count', String(todayCount));
            setText('wdd-month', money(monthRev));

            // 7-day bars
            var max = Math.max.apply(null, last7.map(function (x) { return x.total; }).concat([1]));
            setHtml('wdd-bars', last7.map(function (x) {
                var pct = Math.round((x.total / max) * 100);
                return '<div class="wdd-bar' + (x.isToday ? ' today' : '') + '" title="' + esc(money(x.total)) + '"><i style="height:' + pct + '%"></i><small>' + esc(x.label) + '</small></div>';
            }).join(''));

            // recent
            recent.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
            setHtml('wdd-recent', recent.length === 0
                ? '<div class="wdd-empty">No sales yet.</div>'
                : recent.slice(0, 8).map(function (r) {
                    return '<div class="wdd-row"><div><strong>' + esc(r.customer) + '</strong><span class="wdd-sub">' + esc(r.id) + ' · ' + esc(r.staff) + '</span></div>' +
                           '<div style="text-align:right;"><strong>' + money(r.total) + '</strong><span class="wdd-sub">' + new Date(r.date).toLocaleDateString() + '</span></div></div>';
                }).join(''));

            // top sellers
            var top = Object.keys(sellers).map(function (k) { return { name: k, qty: sellers[k].qty, rev: sellers[k].rev }; })
                .sort(function (a, b) { return b.rev - a.rev; }).slice(0, 5);
            setHtml('wdd-top', top.length === 0
                ? '<div class="wdd-empty">No sales this week yet.</div>'
                : top.map(function (t, i) {
                    return '<div class="wdd-row"><span>' + (i + 1) + '. ' + esc(t.name) + '</span><strong style="color:#166534;">' + money(t.rev) + ' <span style="color:#64748b;font-weight:normal;font-size:11px;">×' + t.qty + '</span></strong></div>';
                }).join(''));
        } catch (e) {
            console.warn('[materials-dashboard-patch] load error:', e);
        }
    }
})();

// ==================== MATERIALS SIDEBAR RESTYLE (part of v1) ====================
// Style only. It does not add, remove or reorder any buttons (vertical-first-patch.js and
// materials-patch.js still control that). Applies only while a materials store is open.
(function () {
    function addSidebarStyles() {
        if (document.getElementById('wdd-sidebar-styles')) return;
        var st = document.createElement('style');
        st.id = 'wdd-sidebar-styles';
        var S = 'body.wdd-mat #dashboard-main-wrapper .sidebar ';
        st.textContent =
        S + '.menu-btn{background:#fff !important;color:#334155 !important;border:1px solid #e8eef5 !important;border-left:4px solid transparent !important;border-radius:12px !important;padding:12px 14px !important;margin:0 0 8px 0 !important;font-size:14px !important;font-weight:600 !important;text-align:left !important;box-shadow:none !important;transition:background .15s,border-color .15s;}' +
        S + '.menu-btn:hover{background:#fff7ed !important;border-left-color:#ea580c !important;}' +
        S + '#wdm-sidebar-materials-btn{background:#ea580c !important;color:#fff !important;border-color:#ea580c !important;font-weight:700 !important;}' +
        S + '#wdm-sidebar-materials-btn:hover{background:#9a3412 !important;border-left-color:#9a3412 !important;}' +
        S + '#wdm-sidebar-newsale-btn{background:#f0fdf4 !important;color:#15803d !important;border-color:#bbf7d0 !important;border-left-color:#22c55e !important;font-weight:700 !important;}' +
        S + '#wdm-sidebar-wastage-btn{border-left-color:#ef4444 !important;}' +
        S + '.btn-logout{color:#b91c1c !important;border-color:#fecaca !important;background:#fff !important;}' +
        S + '.btn-logout:hover{background:#fef2f2 !important;border-left-color:#ef4444 !important;}' +
        // Phones: one swipeable row of buttons so the dashboard shows straight away
        '@media (max-width:767px){' +
            'body.wdd-mat #dashboard-main-wrapper .sidebar{flex-direction:row !important;flex-wrap:nowrap !important;align-items:center !important;gap:8px !important;overflow-x:auto !important;overflow-y:hidden !important;padding:10px 12px !important;border-right:none !important;border-bottom:1px solid #e2e8f0 !important;box-shadow:none !important;position:sticky;top:0;z-index:20;-webkit-overflow-scrolling:touch;}' +
            'body.wdd-mat #dashboard-main-wrapper .sidebar > *{flex-shrink:0 !important;}' +
            S + '.menu-btn{width:auto !important;margin:0 !important;white-space:nowrap !important;padding:10px 14px !important;}' +
            S + '.menu-btn:hover{transform:none !important;}' +
        '}';
        document.head.appendChild(st);
    }

    function syncSidebarClass() {
        if (!document.body) return;
        var on = (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore();
        if (document.body.classList.contains('wdd-mat') !== on) document.body.classList.toggle('wdd-mat', on);
    }

    window.addEventListener('load', function () {
        addSidebarStyles();
        syncSidebarClass();
        var obs = new MutationObserver(function () { try { syncSidebarClass(); } catch (e) {} });
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    });
})();

// ==================== MATERIALS "ADD MATERIAL" FORM (part of v1) ====================
// In a materials store, tapping "Add New Product" opens this form instead of the general one.
// Built for building materials: category list, "sold by" unit, bundle/bag size, cost + retail +
// wholesale price, opening stock, low-stock alert. No expiry date. Saves the same record shape
// as Common Materials, so the rest of the app reads it as normal.
(function () {
    // Opening stock is saved in BULK units (bundle/bag/carton), the way the dashboard shows stock.
    // If your inventory counts stock in single pieces instead, change this to 'base'.
    var STOCK_IN = 'bulk';

    var CATS = ['Roofing', 'Nails & Screws', 'Boards', 'Doors', 'Cement & Blocks', 'Wire & Rods', 'Plumbing', 'Tiles & Ceramics', 'Wardrobe', 'Paint', 'Electrical', 'Tools', 'Other'];
    var BASE = ['sheet', 'piece', 'kg', 'bag', 'roll', 'length', 'box', 'tin', 'drum', 'pack', 'metre'];
    var BULK = ['bundle', 'bag', 'carton', 'pallet', 'roll', 'tonne', 'pack', 'tin'];

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function num(n) { return Number(n) || 0; }
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }
    function $(id) { return document.getElementById(id); }

    function opts(list, sel) {
        return list.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
    }
    var INP = 'width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;';
    var LBL = 'display:block;font-size:11px;font-weight:800;color:#334155;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.4px;';

    window.wdmOpenAddMaterial = function () {
        var m = $('wdd-add-modal'); if (m) m.remove();
        m = document.createElement('div');
        m.id = 'wdd-add-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:1800;display:flex;justify-content:center;align-items:flex-end;padding:0;';
        m.innerHTML =
        '<div style="background:#f8fafc;color:#0f172a;width:100%;max-width:520px;max-height:94vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:18px 16px 20px;box-sizing:border-box;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<h3 style="margin:0;font-size:18px;">🏗️ Add Material</h3>' +
            '<button onclick="document.getElementById(\'wdd-add-modal\').remove()" style="border:none;background:#e2e8f0;border-radius:99px;width:34px;height:34px;font-size:16px;cursor:pointer;">✕</button>' +
          '</div>' +
          '<div style="font-size:12px;color:#64748b;">Start typing a name — common materials fill the units for you.</div>' +

          '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:4px 14px 14px;margin-top:10px;">' +
            '<label style="' + LBL + '">Material name</label>' +
            '<input id="wdd-a-name" list="wdd-a-names" placeholder="e.g. Roofing Sheet 4m" style="' + INP + '" oninput="wdmAddMatFill()">' +
            '<datalist id="wdd-a-names">' + ((typeof WDP_COMMON_MATERIALS !== 'undefined' ? WDP_COMMON_MATERIALS : []).map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('')) + '</datalist>' +
            '<label style="' + LBL + '">Category</label>' +
            '<select id="wdd-a-cat" style="' + INP + '">' + opts(CATS) + '</select>' +
          '</div>' +

          '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:4px 14px 14px;margin-top:10px;">' +
            '<label style="' + LBL + '">Sold by (single unit)</label>' +
            '<input id="wdd-a-base" list="wdd-a-bases" placeholder="sheet, kg, piece…" style="' + INP + '" oninput="wdmAddMatLabels()">' +
            '<datalist id="wdd-a-bases">' + BASE.map(function (x) { return '<option value="' + x + '">'; }).join('') + '</datalist>' +
            '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;font-weight:600;">' +
              '<input type="checkbox" id="wdd-a-single" onchange="wdmAddMatSingle()" style="width:18px;height:18px;margin:0;"> Sold only as single items (no bundle / bag)</label>' +
            '<div id="wdd-a-bulkwrap">' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                '<div><label style="' + LBL + '">Bundle / bag name</label><input id="wdd-a-bulk" list="wdd-a-bulks" placeholder="bundle, bag…" style="' + INP + '" oninput="wdmAddMatLabels()"></div>' +
                '<div><label style="' + LBL + '"><span class="wdd-l-per">How many per bundle</span></label><input id="wdd-a-per" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 10" style="' + INP + '"></div>' +
              '</div>' +
              '<datalist id="wdd-a-bulks">' + BULK.map(function (x) { return '<option value="' + x + '">'; }).join('') + '</datalist>' +
            '</div>' +
          '</div>' +

          '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:4px 14px 14px;margin-top:10px;">' +
            '<label style="' + LBL + '">Cost price <span class="wdd-l-bulk">(per bundle)</span></label>' +
            '<input id="wdd-a-cost" type="number" min="0" inputmode="decimal" placeholder="₦" style="' + INP + '">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
              '<div><label style="' + LBL + '">Retail <span class="wdd-l-bulk">(per bundle)</span></label><input id="wdd-a-retail" type="number" min="0" inputmode="decimal" placeholder="₦" style="' + INP + '"></div>' +
              '<div><label style="' + LBL + '">Wholesale <span class="wdd-l-bulk">(per bundle)</span></label><input id="wdd-a-whole" type="number" min="0" inputmode="decimal" placeholder="₦" style="' + INP + '"></div>' +
            '</div>' +
            '<div id="wdd-a-piecewrap" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
              '<div><label style="' + LBL + '">Retail <span class="wdd-l-base">(per sheet)</span></label><input id="wdd-a-pretail" type="number" min="0" inputmode="decimal" placeholder="auto" style="' + INP + '"></div>' +
              '<div><label style="' + LBL + '">Wholesale <span class="wdd-l-base">(per sheet)</span></label><input id="wdd-a-pwhole" type="number" min="0" inputmode="decimal" placeholder="auto" style="' + INP + '"></div>' +
            '</div>' +
            '<div style="font-size:11px;color:#94a3b8;margin-top:6px;">Leave the single-unit prices blank to work them out from the bundle price.</div>' +
          '</div>' +

          '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:4px 14px 14px;margin-top:10px;">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
              '<div><label style="' + LBL + '">Opening stock <span class="wdd-l-bulk">(bundles)</span></label><input id="wdd-a-stock" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" style="' + INP + '"></div>' +
              '<div><label style="' + LBL + '">Alert when below</label><input id="wdd-a-low" type="number" min="0" inputmode="numeric" placeholder="5" style="' + INP + '"></div>' +
            '</div>' +
          '</div>' +

          '<div id="wdd-a-err" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px;border-radius:10px;font-size:13px;margin-top:12px;"></div>' +
          '<button onclick="wdmSaveAddMaterial()" style="width:100%;margin-top:14px;padding:15px;border:none;border-radius:14px;font-size:16px;font-weight:800;color:#fff;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);cursor:pointer;">Save Material</button>' +
        '</div>';
        document.body.appendChild(m);
        wdmAddMatLabels();
    };

    // fill units when the typed name matches a common material
    window.wdmAddMatFill = function () {
        var list = (typeof WDP_COMMON_MATERIALS !== 'undefined') ? WDP_COMMON_MATERIALS : [];
        var v = ($('wdd-a-name').value || '').toLowerCase().trim();
        for (var i = 0; i < list.length; i++) {
            if (list[i].name.toLowerCase() === v) {
                $('wdd-a-cat').value = list[i].category;
                $('wdd-a-base').value = list[i].baseUnit;
                var single = list[i].piecesPerBulk === 1;
                $('wdd-a-single').checked = single;
                if (!single) { $('wdd-a-bulk').value = list[i].bulkUnit; $('wdd-a-per').value = list[i].piecesPerBulk; }
                wdmAddMatSingle();
                return;
            }
        }
    };

    // keep the little labels in sync with the unit names typed
    window.wdmAddMatLabels = function () {
        var base = ($('wdd-a-base').value || '').trim() || 'unit';
        var single = $('wdd-a-single') && $('wdd-a-single').checked;
        var bulk = single ? base : (($('wdd-a-bulk').value || '').trim() || 'bundle');
        document.querySelectorAll('#wdd-add-modal .wdd-l-bulk').forEach(function (e) { e.textContent = '(per ' + bulk + ')'; });
        document.querySelectorAll('#wdd-add-modal .wdd-l-base').forEach(function (e) { e.textContent = '(per ' + base + ')'; });
        document.querySelectorAll('#wdd-add-modal .wdd-l-per').forEach(function (e) { e.textContent = 'How many ' + base + ' per ' + bulk; });
        var st = document.querySelector('#wdd-add-modal #wdd-a-stock');
        if (st && st.parentNode) { var sl = st.parentNode.querySelector('label span'); if (sl) sl.textContent = '(' + bulk + 's)'; }
    };

    window.wdmAddMatSingle = function () {
        var single = $('wdd-a-single').checked;
        $('wdd-a-bulkwrap').style.display = single ? 'none' : 'block';
        $('wdd-a-piecewrap').style.display = single ? 'none' : 'grid';
        wdmAddMatLabels();
    };

    window.wdmSaveAddMaterial = async function () {
        var err = $('wdd-a-err'); err.style.display = 'none';
        function fail(msg) { err.textContent = msg; err.style.display = 'block'; }

        var name = ($('wdd-a-name').value || '').trim();
        if (!name) return fail('Enter the material name.');
        var base = ($('wdd-a-base').value || '').trim().toLowerCase();
        if (!base) return fail('Enter how it is sold (sheet, kg, piece…).');

        var single = $('wdd-a-single').checked;
        var bulk = single ? 'pack' : ($('wdd-a-bulk').value || '').trim().toLowerCase();
        var per = single ? 1 : Math.floor(num($('wdd-a-per').value));
        if (!single && !bulk) return fail('Enter the bundle / bag name, or tick "Sold only as single items".');
        if (!single && per < 1) return fail('Enter how many ' + base + ' come in one ' + bulk + '.');

        var cost = num($('wdd-a-cost').value), retail = num($('wdd-a-retail').value), whole = num($('wdd-a-whole').value);
        if (retail <= 0) return fail('Enter the retail price.');
        var pretail = num($('wdd-a-pretail').value), pwhole = num($('wdd-a-pwhole').value);
        if (!single) {
            if (!pretail) pretail = Math.round(retail / per);
            if (!pwhole) pwhole = whole ? Math.round(whole / per) : 0;
        } else { pretail = 0; pwhole = 0; }

        var openBulk = num($('wdd-a-stock').value);
        var stock = (STOCK_IN === 'base') ? openBulk * per : openBulk;
        var low = ($('wdd-a-low').value === '') ? 5 : num($('wdd-a-low').value);

        var branchId = (typeof currentInventoryBranchFilter !== 'undefined' && currentInventoryBranchFilter && currentInventoryBranchFilter !== 'all')
            ? currentInventoryBranchFilter : (typeof currentBranch !== 'undefined' && currentBranch ? currentBranch : 'main');

        try {
            var db = firebase.database();
            var ref = db.ref('stores/' + currentStoreId + '/inventory/' + branchId);
            var snap = await ref.once('value');
            var ex = snap.val() || {};
            var dup = Object.keys(ex).some(function (id) {
                return ((ex[id].name || ex[id].productName || '').toLowerCase().trim()) === name.toLowerCase();
            });
            if (dup) return fail('"' + name + '" is already in this branch. Edit it from the stock list instead.');

            var node = ref.push();
            await node.set({
                name: name, productName: name,
                category: $('wdd-a-cat').value,
                baseUnitName: base, bulkUnitName: bulk, unitsPerPack: per,
                costPrice: cost,
                price: retail, retailPrice: retail, wholesalePrice: whole,
                piecePrice: pretail, pieceWholesalePrice: pwhole,
                stock: stock, stockQty: stock,
                lowStockThreshold: low,
                expiry: '', expiryDate: '',
                branchId: branchId,
                createdAt: new Date().toISOString(),
                createdBy: (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'
            });
            $('wdd-add-modal').remove();
            alert('✅ ' + name + ' added.');
            if (typeof loadInventoryTable === 'function') loadInventoryTable();
        } catch (e) {
            fail('Could not save: ' + (e.message || e));
        }
    };

    // Catch the "Add New Product" button in materials stores (runs before the button's own handler)
    document.addEventListener('click', function (ev) {
        if (!isMat()) return;
        var b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!b || b.closest('#wdd-add-modal') || b.closest('#wdp-quick-modal')) return;
        if (!/add\s+(new\s+)?(product|item|material)/i.test(b.textContent || '')) return;
        if (!b.closest('#inventory-view') && !b.closest('#workspace-content')) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        wdmOpenAddMaterial();
    }, true);
})();
