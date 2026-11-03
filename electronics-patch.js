// ==================== WISE DECISION ELECTRONICS / APPLIANCES PATCH (v1) ====================
// For stores whose storeType is 'electronics' (TVs, fridges, freezers, ACs, generators, small items).
// Load AFTER materials-reorder-patch.js and BEFORE vertical-first-patch.js (v3.20 or newer).
//
//   * Stock is tracked two ways, per item:
//       - BY SERIAL NUMBER  (TVs, fridges, ACs, generators): every unit has its own serial and status
//       - BY QUANTITY       (remotes, cables, bulbs, brackets): just a count
//   * New Sale: pick items (or scan a serial), set price, discount, delivery fee, part payment, due date
//   * Warranty receipt per item with serial numbers and warranty end dates (print / WhatsApp)
//   * Who Owes Me (part payments, WhatsApp reminders), Warranty Check, Reports, returns/refunds
//   * Sidebar for this store type: Electronics dashboard, New Sale, Stock, Who Owes Me, Warranty Check, Reports
//   * The regular (grocery) inventory screen opens the electronics stock instead
//
// Data (all new, under the store, nothing existing is touched):
//   stores/{storeId}/elecStock/{itemId}   (+ units/{unitId} for serial items)
//   stores/{storeId}/elecSales/{saleId}
//   stores/{storeId}/elecCounter/lastSale
//
// Roles: Admin and Manager can manage stock, see Who Owes Me and Reports. Only Admin sees cost prices,
// profit, and can delete an item. Everyone else can make sales and check warranties.
// NOTE: these are screen rules. Real protection needs Firebase database rules.

console.log("Wise Decision electronics-patch.js — v1 loaded");

(function () {
    // ---------- helpers ----------
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function num(n) { return Number(n) || 0; }
    function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
    function money(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + num(n).toLocaleString()); }
    function pad(n, w) { return String(n).padStart(w || 2, '0'); }
    function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function today() { return dayKey(new Date()); }
    function localDate(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : dayKey(d); }
    function fmtDate(v) { if (!v) return '—'; var d = new Date(String(v).length === 10 ? v + 'T00:00:00' : v); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(); }
    function addMonths(dateStr, m) { var d = new Date(dateStr + 'T00:00:00'); d.setMonth(d.getMonth() + (Number(m) || 0)); return dayKey(d); }
    function daysUntil(dateStr) { return Math.round((new Date(dateStr + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function R(path) { return firebase.database().ref('stores/' + sid() + '/' + path); }
    function who() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
    function role() { return (typeof currentUserRole !== 'undefined' && currentUserRole) ? String(currentUserRole).toLowerCase().trim() : ''; }
    function isAdmin() { return role() === 'admin'; }
    function canManage() { return (typeof window.wdFullAccess === 'function') ? window.wdFullAccess() : (role() === 'admin' || role() === 'manager'); }
    function waNum(p) {
        var d = String(p || '').replace(/\D/g, '');
        if (!d) return '';
        if (d.indexOf('234') === 0) return d;
        if (d.charAt(0) === '0') return '234' + d.slice(1);
        return d;
    }

    // ---------- store type ----------
    var elecType = null, watchedStore = null, typeRef = null;
    function isElec() { return !!elecType && String(elecType).toLowerCase().indexOf('electronics') === 0; }
    window.wdeIsElectronics = isElec;
    function watchType() {
        var s = sid();
        if (!s || s === 'SUPER_ADMIN') {
            if (watchedStore) { try { if (typeRef) typeRef.off(); } catch (e) {} typeRef = null; watchedStore = null; elecType = null; }
            return;
        }
        if (watchedStore === s) return;
        try { if (typeRef) typeRef.off(); } catch (e) {}
        elecType = null; watchedStore = s;
        try {
            typeRef = firebase.database().ref('stores/' + s + '/storeType');
            typeRef.on('value', function (snap) { elecType = snap.val() || 'general'; attach(); });
        } catch (e) {}
    }
    var storeName = 'our shop', storeNameFor = null;
    function cacheStoreName() {
        if (!sid() || storeNameFor === sid()) return;
        storeNameFor = sid();
        firebase.database().ref('stores/' + sid() + '/businessName').once('value').then(function (s) { if (s.val()) storeName = s.val(); }).catch(function () {});
    }

    // ---------- data ----------
    var stock = {}, sales = {};
    async function loadStock() {
        var s = await R('elecStock').once('value');
        stock = s.val() || {};
        Object.keys(stock).forEach(function (k) { stock[k].id = k; });
    }
    async function loadSales() {
        var s = await R('elecSales').once('value');
        sales = s.val() || {};
        Object.keys(sales).forEach(function (k) { sales[k]._id = k; });
    }
    function itemList() { return Object.keys(stock).map(function (k) { return stock[k]; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }); }
    function unitsOf(it) { var u = it.units || {}; return Object.keys(u).map(function (k) { return Object.assign({ uid: k }, u[k]); }); }
    function inStock(it) { return it.mode === 'serial' ? unitsOf(it).filter(function (u) { return u.status === 'in_stock'; }).length : num(it.qty); }
    function alertAt(it) { return it.alert != null && it.alert !== '' ? num(it.alert) : 2; }
    function label(it) { return it.name + (it.spec ? ' (' + it.spec + ')' : ''); }
    function saleList() { return Object.keys(sales).map(function (k) { return sales[k]; }); }
    function bal(s) { return s.refunded ? 0 : num(s.balance); }
    function paysOf(s) {
        return s.payments ? Object.keys(s.payments).map(function (k) { return s.payments[k]; }).sort(function (a, b) { return String(a.at).localeCompare(String(b.at)); }) : [];
    }
    function allSerials() {
        var set = {};
        itemList().forEach(function (it) { unitsOf(it).forEach(function (u) { if (u.serial) set[String(u.serial).toLowerCase()] = true; }); });
        return set;
    }

    // ---------- styles ----------
    function addStyles() {
        if ($('wde-styles')) return;
        var S = '#dashboard-main-wrapper .sidebar ';
        var st = document.createElement('style');
        st.id = 'wde-styles';
        st.textContent =
        '.wde{max-width:760px;margin:0 auto;color:#0f172a;}' +
        '.wde *{box-sizing:border-box;}' +
        '.wde h2{margin:0 0 2px;font-size:20px;}' +
        '.wde-sub{font-size:12px;color:#64748b;margin-bottom:12px;}' +
        '.wde-hero{background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);color:#fff;border-radius:18px;padding:18px;box-shadow:0 10px 24px rgba(29,78,216,.25);}' +
        '.wde-hl{font-size:12px;opacity:.9;text-transform:uppercase;letter-spacing:.6px;font-weight:700;}' +
        '.wde-ha{font-size:32px;font-weight:800;margin:4px 0 14px;line-height:1.1;}' +
        '.wde-g{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
        '.wde-g>div{background:rgba(255,255,255,.17);border-radius:12px;padding:10px 12px;}' +
        '.wde-g b{display:block;font-size:16px;}.wde-g span{font-size:11px;opacity:.9;}' +
        '.wde-cta{width:100%;margin:12px 0;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:800;color:#fff;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);box-shadow:0 8px 18px rgba(22,163,74,.3);cursor:pointer;}' +
        '.wde-tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}' +
        '.wde-tile{background:#fff;border:1px solid #e8eef5;border-radius:12px;padding:10px 12px;}' +
        '.wde-tile small{display:block;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.3px;}' +
        '.wde-tile b{display:block;font-size:17px;margin-top:3px;}' +
        '.wde-card{background:#fff;border:1px solid #e8eef5;border-radius:16px;padding:14px;margin-bottom:12px;}' +
        '.wde-card h3{margin:0 0 8px;font-size:14px;}' +
        '.wde-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f1f5f9;font-size:13px;cursor:pointer;}' +
        '.wde-row:last-child{border-bottom:none;}' +
        '.wde-sub2{display:block;font-size:11px;color:#64748b;margin-top:2px;}' +
        '.wde-badge{font-size:10px;font-weight:800;padding:3px 8px;border-radius:99px;white-space:nowrap;background:#dcfce7;color:#166534;}' +
        '.wde-badge.red{background:#fee2e2;color:#b91c1c;}.wde-badge.amb{background:#fef3c7;color:#92400e;}.wde-badge.gry{background:#f1f5f9;color:#475569;}' +
        '.wde-empty{text-align:center;color:#94a3b8;padding:24px 10px;font-size:13px;}' +
        '.wde-search{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;margin-bottom:8px;background:#fff;}' +
        '.wde-add{width:100%;border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:800;color:#fff;background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);cursor:pointer;margin-bottom:10px;}' +
        '.wde-item{background:#fff;border:1px solid #e8eef5;border-left:4px solid #3b82f6;border-radius:14px;padding:12px 14px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:flex-start;}' +
        '.wde-item.low{border-left-color:#ef4444;}' +
        '.wde-line{background:#fff;border:1px solid #e8eef5;border-radius:12px;padding:10px;margin-bottom:8px;}' +
        '.wde-line input,.wde-line select{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:9px;font-size:16px;background:#fff;margin-top:6px;}' +
        '.wde-lg{display:grid;grid-template-columns:80px 1fr;gap:6px;}' +
        // sidebar
        S + '.wde-sb{border-width:1px !important;border-style:solid !important;border-left-width:4px !important;border-radius:12px !important;font-weight:700 !important;box-shadow:none !important;}' +
        S + '#wde-sidebar-main-btn{background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%) !important;color:#fff !important;border:none !important;box-shadow:0 4px 12px rgba(29,78,216,.28) !important;}' +
        S + '#wde-sb-sale{background:#f0fdf4 !important;color:#15803d !important;border-color:#bbf7d0 !important;border-left-color:#22c55e !important;}' +
        S + '#wde-sb-stock{background:#fff7ed !important;color:#c2410c !important;border-color:#fed7aa !important;border-left-color:#f97316 !important;}' +
        S + '#wde-sb-owe{background:#fff1f2 !important;color:#be123c !important;border-color:#fecdd3 !important;border-left-color:#f43f5e !important;}' +
        S + '#wde-sb-warranty{background:#ecfeff !important;color:#0e7490 !important;border-color:#a5f3fc !important;border-left-color:#06b6d4 !important;}' +
        S + '#wde-sb-reports{background:#fffbeb !important;color:#92400e !important;border-color:#fde68a !important;border-left-color:#f59e0b !important;}' +
        '.wde-dot{display:none;background:#dc2626;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;margin-left:6px;}' +
        '@media (max-width:767px){' +
            'body.wde-elec ' + S + '{flex-direction:row !important;flex-wrap:nowrap !important;align-items:center !important;gap:8px !important;overflow-x:auto !important;overflow-y:hidden !important;padding:10px 12px !important;border-right:none !important;border-bottom:1px solid #e2e8f0 !important;box-shadow:none !important;position:sticky;top:0;z-index:20;-webkit-overflow-scrolling:touch;}' +
            'body.wde-elec ' + S + '> *{flex-shrink:0 !important;}' +
            'body.wde-elec ' + S + '.menu-btn{width:auto !important;margin:0 !important;white-space:nowrap !important;padding:10px 14px !important;}' +
        '}';
        document.head.appendChild(st);
    }

    // ---------- modal ----------
    var INP = 'width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;';
    var LBL = 'display:block;font-size:11px;font-weight:800;color:#334155;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.4px;';
    function openModal(inner) {
        var m = $('wde-modal'); if (m) m.remove();
        m = document.createElement('div');
        m.id = 'wde-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:1800;display:flex;justify-content:center;align-items:flex-end;';
        m.innerHTML = '<div style="background:#f8fafc;color:#0f172a;width:100%;max-width:560px;max-height:95vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;">' + inner + '</div>';
        document.body.appendChild(m);
    }
    window.wdeClose = function () { var m = $('wde-modal'); if (m) m.remove(); };
    function head(t) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><h3 style="margin:0;font-size:18px;">' + t + '</h3>' +
               '<button onclick="wdeClose()" style="border:none;background:#e2e8f0;border-radius:99px;width:34px;height:34px;font-size:16px;cursor:pointer;">✕</button></div>';
    }
    function errBox() { return '<div id="wde-err" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px;border-radius:10px;font-size:13px;margin-top:12px;"></div>'; }
    function fail(m) { var e = $('wde-err'); if (e) { e.textContent = m; e.style.display = 'block'; e.scrollIntoView && e.scrollIntoView({ block: 'nearest' }); } else alert(m); }
    function btn(txt, fn, style) { return '<button onclick="' + fn + '" style="width:100%;margin-top:8px;padding:13px;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;' + (style || 'border:1px solid #cbd5e1;background:#fff;color:#0f172a;') + '">' + txt + '</button>'; }
    var PRIMARY = 'border:none;background:linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%);color:#fff;';
    var GREEN = 'border:none;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);color:#fff;';
    var RED = 'border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;';

    // =====================================================================
    // DASHBOARD
    // =====================================================================
    var CATS = ['TV', 'Refrigerator', 'Freezer', 'Air Conditioner', 'Washing Machine', 'Generator', 'Fan', 'Microwave / Cooker', 'Sound System', 'Decoder / Receiver', 'Laptop / Computer', 'Accessories', 'Other'];

    window.wdeShowDashboard = async function () {
        var ws = $('workspace-content'); if (!ws) return;
        addStyles();
        var now = new Date(), h = now.getHours();
        var hi = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
        var nm = (typeof currentStaffName !== 'undefined' && currentStaffName) ? ', ' + esc(String(currentStaffName).split(' ')[0]) : '';
        ws.innerHTML =
        '<div class="wde" id="wde-dash">' +
            '<div style="font-size:20px;font-weight:800;">' + hi + nm + ' 👋</div>' +
            '<div class="wde-sub">' + esc(now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })) + '</div>' +
            '<div class="wde-hero"><div class="wde-hl">Today\'s sales</div><div class="wde-ha" id="wde-rev">₦0</div>' +
                '<div class="wde-g"><div><b id="wde-n">0</b><span>Sales made</span></div><div><b id="wde-recv">₦0</b><span>Money received</span></div>' +
                (isAdmin() ? '<div><b id="wde-profit">₦0</b><span>Profit</span></div>' : '') +
                (canManage() ? '<div><b id="wde-owed">₦0</b><span>Customers owe you</span></div>' : '') +
            '</div></div>' +
            '<button class="wde-cta" onclick="wdeOpenSale()">🛒 New Sale</button>' +
            (canManage() ? '<div class="wde-tiles"><div class="wde-tile"><small>Units in stock</small><b id="wde-units">0</b></div>' +
                (isAdmin() ? '<div class="wde-tile"><small>Capital locked</small><b id="wde-cap">₦0</b></div>' : '<div class="wde-tile"><small>Low stock</small><b id="wde-lowc">0</b></div>') + '</div>' +
                '<div class="wde-card"><h3>⚠️ Low stock</h3><div id="wde-low">Checking…</div></div>' : '') +
            '<div class="wde-card"><h3>🧾 Recent sales</h3><div id="wde-recent">Loading…</div>' +
                (canManage() ? '<button onclick="wdeOpenSalesList()" style="margin-top:8px;border:none;background:none;color:#1d4ed8;font-weight:800;font-size:13px;cursor:pointer;">See all sales ›</button>' : '') + '</div>' +
        '</div>';
        try { await Promise.all([loadStock(), loadSales()]); } catch (e) { $('wde-recent') && ($('wde-recent').innerHTML = '<div class="wde-empty">Could not load: ' + esc(e.message) + '</div>'); return; }
        fillDash();
    };

    function fillDash() {
        if (!$('wde-dash')) return;
        var t = today(), n = 0, rev = 0, profit = 0, recv = 0, owed = 0;
        saleList().forEach(function (s) {
            if (!s.refunded && localDate(s.soldAt) === t) {
                n++; rev += num(s.net);
                (s.lines || []).forEach(function (l) { profit += num(l.total) - num(l.cost) * num(l.qty); });
                profit -= num(s.discount);
            }
            paysOf(s).forEach(function (p) { if (localDate(p.at) === t) recv += num(p.amount); });
            if (s.refunded && s.refunded.at && localDate(s.refunded.at) === t) recv -= num(s.refunded.amount);
            owed += bal(s);
        });
        var set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
        set('wde-rev', money(rev)); set('wde-n', String(n)); set('wde-recv', money(recv)); set('wde-profit', money(profit)); set('wde-owed', money(owed));

        var items = itemList(), units = 0, cap = 0, low = [];
        items.forEach(function (it) {
            var c = inStock(it); units += c; cap += c * num(it.cost);
            if (c <= alertAt(it)) low.push({ it: it, c: c });
        });
        set('wde-units', String(units)); set('wde-cap', money(cap)); set('wde-lowc', String(low.length));
        low.sort(function (a, b) { return a.c - b.c; });
        if ($('wde-low')) $('wde-low').innerHTML = low.length === 0 ? '<div class="wde-empty" style="color:#16a34a;font-weight:700;">✅ All stock is healthy.</div>'
            : low.slice(0, 8).map(function (x) {
                return '<div class="wde-row" onclick="wdeOpenItem(\'' + esc(x.it.id) + '\')"><span>' + esc(label(x.it)) + '</span><span class="wde-badge red">' + x.c + ' left</span></div>';
            }).join('');

        var rec = saleList().sort(function (a, b) { return String(b.soldAt).localeCompare(String(a.soldAt)); }).slice(0, 8);
        if ($('wde-recent')) $('wde-recent').innerHTML = rec.length === 0 ? '<div class="wde-empty">No sales yet. Tap New Sale to make the first one.</div>'
            : rec.map(function (s) { return saleRow(s); }).join('');
    }

    function saleRow(s) {
        var first = (s.lines && s.lines[0]) ? s.lines[0].name + ((s.lines.length > 1) ? ' +' + (s.lines.length - 1) + ' more' : '') : '';
        var tag = s.refunded ? '<span class="wde-badge gry">Refunded</span>' : (bal(s) > 0 ? '<span class="wde-badge amb">Owes ' + money(bal(s)) + '</span>' : '');
        return '<div class="wde-row" onclick="wdeOpenSale_detail(\'' + esc(s._id) + '\')"><div><strong>' + esc(s.customer || 'Walk-in') + '</strong>' +
            '<span class="wde-sub2">' + esc(s.saleId) + ' · ' + esc(first) + '</span></div><div style="text-align:right;"><strong>' + money(s.net) + '</strong><span class="wde-sub2">' + tag + ' ' + esc(fmtDate(s.soldAt)) + '</span></div></div>';
    }

    // =====================================================================
    // STOCK
    // =====================================================================
    var stockQuery = '', stockCat = '';
    window.wdeShowStock = async function () {
        if (!canManage()) return wdeShowDashboard();
        var ws = $('workspace-content'); if (!ws) return;
        addStyles();
        ws.innerHTML =
        '<div class="wde" id="wde-stock">' +
            '<h2>📦 Electronics Stock</h2><div class="wde-sub">TVs, fridges and more — by serial number or by quantity.</div>' +
            '<div class="wde-tiles"><div class="wde-tile"><small>Models</small><b id="wde-s-models">0</b></div><div class="wde-tile"><small>Units in stock</small><b id="wde-s-units">0</b></div></div>' +
            '<button class="wde-add" onclick="wdeOpenAddItem()">➕ Add Item</button>' +
            '<input id="wde-s-q" class="wde-search" placeholder="Search name, brand, model or serial…" oninput="wdeStockSearch(this.value)">' +
            '<select id="wde-s-cat" class="wde-search" onchange="wdeStockCat(this.value)"><option value="">All categories</option></select>' +
            '<div id="wde-s-list"><div class="wde-empty">Loading…</div></div>' +
        '</div>';
        $('wde-s-q').value = stockQuery;
        try { await loadStock(); } catch (e) { $('wde-s-list').innerHTML = '<div class="wde-empty">Could not load: ' + esc(e.message) + '</div>'; return; }
        renderStock();
    };
    window.wdeStockSearch = function (v) { stockQuery = String(v || ''); renderStock(); };
    window.wdeStockCat = function (v) { stockCat = String(v || ''); renderStock(); };

    function renderStock() {
        var box = $('wde-s-list'); if (!box) return;
        var items = itemList(), units = 0;
        items.forEach(function (it) { units += inStock(it); });
        if ($('wde-s-models')) $('wde-s-models').textContent = String(items.length);
        if ($('wde-s-units')) $('wde-s-units').textContent = String(units);
        var sel = $('wde-s-cat');
        if (sel) {
            var cats = {}; items.forEach(function (it) { if (it.category) cats[it.category] = true; });
            var html = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) { return '<option' + (c === stockCat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
            if (sel.innerHTML !== html) sel.innerHTML = html;
        }
        var q = stockQuery.toLowerCase().trim();
        var rows = items.filter(function (it) {
            if (stockCat && it.category !== stockCat) return false;
            if (!q) return true;
            var hay = (it.name + ' ' + (it.brand || '') + ' ' + (it.model || '') + ' ' + (it.spec || '') + ' ' + unitsOf(it).map(function (u) { return u.serial; }).join(' ')).toLowerCase();
            return hay.indexOf(q) !== -1;
        });
        if (rows.length === 0) { box.innerHTML = '<div class="wde-empty">' + (items.length === 0 ? 'No items yet. Tap “Add Item” to start.' : 'Nothing matches.') + '</div>'; return; }
        box.innerHTML = rows.map(function (it) {
            var c = inStock(it), low = c <= alertAt(it);
            return '<div class="wde-item' + (low ? ' low' : '') + '" onclick="wdeOpenItem(\'' + esc(it.id) + '\')">' +
                '<div><div style="font-weight:800;font-size:15px;">' + esc(it.name) + '</div>' +
                '<div class="wde-sub2">' + esc([it.brand, it.model, it.spec].filter(Boolean).join(' · ')) + '</div>' +
                '<div class="wde-sub2">' + esc(it.category || '') + ' · ' + (it.mode === 'serial' ? 'by serial' : 'by quantity') + '</div></div>' +
                '<div style="text-align:right;"><span class="wde-badge' + (low ? ' red' : '') + '">' + c + ' in stock</span>' +
                '<div style="font-weight:800;color:#16a34a;margin-top:6px;">' + money(it.price) + '</div></div></div>';
        }).join('');
    }

    async function refresh() {
        try { await Promise.all([loadStock(), loadSales()]); } catch (e) { return; }
        if ($('wde-s-list')) renderStock();
        if ($('wde-dash')) fillDash();
        refreshBadge();
    }

    // ---------- add / edit item ----------
    window.wdeOpenAddItem = function () {
        if (!canManage()) return;
        openModal(
            head('➕ Add Item') +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:6px;">' +
                '<label style="' + LBL + '">Item name *</label><input id="wde-f-name" style="' + INP + '" placeholder="e.g. Samsung Smart TV">' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                    '<div><label style="' + LBL + '">Brand</label><input id="wde-f-brand" style="' + INP + '" placeholder="Samsung"></div>' +
                    '<div><label style="' + LBL + '">Model</label><input id="wde-f-model" style="' + INP + '" placeholder="UA43T5300"></div>' +
                    '<div><label style="' + LBL + '">Size / spec</label><input id="wde-f-spec" style="' + INP + '" placeholder="43&quot; · 250L · 1.5HP"></div>' +
                    '<div><label style="' + LBL + '">Category</label><select id="wde-f-cat" style="' + INP + '">' + CATS.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
                '</div>' +
            '</div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;">' +
                '<label style="' + LBL + '">How do you count this item?</label>' +
                '<select id="wde-f-mode" style="' + INP + '" onchange="wdeModeChange()"><option value="serial">By serial number (TV, fridge, AC, generator…)</option><option value="qty">By quantity (remote, cable, bulb…)</option></select>' +
                '<div id="wde-f-serial-box"><label style="' + LBL + '">Serial numbers — one per line (optional now)</label><textarea id="wde-f-serials" rows="4" style="' + INP + 'font-family:monospace;font-size:14px;" placeholder="SN123456&#10;SN123457"></textarea></div>' +
                '<div id="wde-f-qty-box" style="display:none;"><label style="' + LBL + '">Opening quantity</label><input id="wde-f-qty" type="number" min="0" inputmode="numeric" style="' + INP + '" placeholder="0"></div>' +
            '</div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;">' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                    (isAdmin() ? '<div><label style="' + LBL + '">Cost price (₦)</label><input id="wde-f-cost" type="number" min="0" inputmode="decimal" style="' + INP + '"></div>' : '') +
                    '<div><label style="' + LBL + '">Selling price (₦) *</label><input id="wde-f-price" type="number" min="0" inputmode="decimal" style="' + INP + '"></div>' +
                    '<div><label style="' + LBL + '">Warranty (months)</label><select id="wde-f-war" style="' + INP + '">' + [0, 3, 6, 12, 24, 36].map(function (m) { return '<option value="' + m + '"' + (m === 12 ? ' selected' : '') + '>' + (m === 0 ? 'No warranty' : m + ' months') + '</option>'; }).join('') + '</select></div>' +
                    '<div><label style="' + LBL + '">Alert when below</label><input id="wde-f-alert" type="number" min="0" inputmode="numeric" style="' + INP + '" placeholder="2"></div>' +
                '</div>' +
            '</div>' +
            errBox() + btn('Save Item', 'wdeSaveItem()', PRIMARY)
        );
    };
    window.wdeModeChange = function () {
        var serial = $('wde-f-mode').value === 'serial';
        $('wde-f-serial-box').style.display = serial ? 'block' : 'none';
        $('wde-f-qty-box').style.display = serial ? 'none' : 'block';
    };
    function parseSerials(txt) {
        return String(txt || '').split(/\r?\n|,/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    function checkSerials(list) {
        var seen = {}, have = allSerials();
        for (var i = 0; i < list.length; i++) {
            var k = list[i].toLowerCase();
            if (seen[k]) return 'Serial "' + list[i] + '" is typed twice.';
            if (have[k]) return 'Serial "' + list[i] + '" is already in your stock.';
            seen[k] = true;
        }
        return '';
    }

    window.wdeSaveItem = async function () {
        var name = ($('wde-f-name').value || '').trim();
        var price = num($('wde-f-price').value);
        var mode = $('wde-f-mode').value;
        if (!name) return fail('Enter the item name.');
        if (price <= 0) return fail('Enter the selling price.');
        var serials = mode === 'serial' ? parseSerials($('wde-f-serials').value) : [];
        var msg = checkSerials(serials); if (msg) return fail(msg);
        var qty = mode === 'qty' ? Math.max(0, num($('wde-f-qty').value)) : 0;
        try {
            var node = R('elecStock').push();
            var now = new Date().toISOString();
            var rec = {
                name: name, brand: ($('wde-f-brand').value || '').trim(), model: ($('wde-f-model').value || '').trim(),
                spec: ($('wde-f-spec').value || '').trim(), category: $('wde-f-cat').value, mode: mode,
                cost: isAdmin() ? num($('wde-f-cost').value) : 0, price: price,
                warranty: num($('wde-f-war').value), alert: $('wde-f-alert').value === '' ? 2 : num($('wde-f-alert').value),
                qty: qty, createdAt: now, createdBy: who()
            };
            if (serials.length) {
                rec.units = {};
                serials.forEach(function (sn) { rec.units[node.child('units').push().key] = { serial: sn, status: 'in_stock', addedAt: now, addedBy: who() }; });
            }
            await node.set(rec);
            wdeClose(); await refresh();
        } catch (e) { fail('Could not save: ' + (e.message || e)); }
    };

    // ---------- item details ----------
    function unitChip(st) {
        var m = { in_stock: ['', 'In stock'], sold: ['gry', 'Sold'], missing: ['red', 'Missing'] }[st] || ['gry', st];
        return '<span class="wde-badge ' + m[0] + '">' + m[1] + '</span>';
    }
    window.wdeOpenItem = function (id) {
        var it = stock[id]; if (!it) return;
        var mg = canManage();
        var uHtml = '';
        if (it.mode === 'serial') {
            var us = unitsOf(it).sort(function (a, b) { return (a.status === 'in_stock' ? 0 : 1) - (b.status === 'in_stock' ? 0 : 1) || String(a.serial).localeCompare(String(b.serial)); });
            uHtml = '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:6px 14px;margin-top:10px;"><div style="font-weight:800;font-size:13px;padding:6px 0;">Units</div>' +
                (us.length === 0 ? '<div class="wde-empty">No serial numbers added yet.</div>' : us.map(function (u) {
                    var act = '';
                    if (mg && u.status === 'in_stock') act = '<button onclick="wdeUnitStatus(\'' + esc(id) + '\',\'' + esc(u.uid) + '\',\'missing\')" style="border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;">Mark missing</button>';
                    if (mg && u.status === 'missing') act = '<button onclick="wdeUnitStatus(\'' + esc(id) + '\',\'' + esc(u.uid) + '\',\'in_stock\')" style="border:1px solid #bbf7d0;background:#f0fdf4;color:#15803d;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;">Found</button>';
                    return '<div class="wde-row" style="cursor:default;"><div><span style="font-family:monospace;">' + esc(u.serial) + '</span>' + (u.saleId ? '<span class="wde-sub2">Sale ' + esc(u.saleId) + '</span>' : '') + '</div><div style="display:flex;gap:6px;align-items:center;">' + unitChip(u.status) + act + '</div></div>';
                }).join('')) + '</div>';
        }
        openModal(
            head(esc(it.name)) +
            '<div style="font-size:12px;color:#64748b;">' + esc([it.brand, it.model, it.spec, it.category].filter(Boolean).join(' · ')) + '</div>' +
            '<div class="wde-tiles" style="margin-top:10px;"><div class="wde-tile"><small>In stock</small><b>' + inStock(it) + '</b></div><div class="wde-tile"><small>Selling price</small><b>' + money(it.price) + '</b></div>' +
            (isAdmin() ? '<div class="wde-tile"><small>Cost</small><b>' + money(it.cost) + '</b></div>' : '') +
            '<div class="wde-tile"><small>Warranty</small><b>' + (num(it.warranty) ? it.warranty + ' months' : 'None') + '</b></div></div>' +
            uHtml +
            (mg ? btn(it.mode === 'serial' ? '➕ Add serial numbers' : '➕ Add stock', 'wdeOpenAddStock(\'' + esc(id) + '\')', PRIMARY) +
                  (it.mode === 'qty' ? btn('✏️ Correct the count', 'wdeOpenCorrect(\'' + esc(id) + '\')') : '') +
                  btn('✏️ Edit details & price', 'wdeOpenEdit(\'' + esc(id) + '\')') : '') +
            (isAdmin() ? btn('🗑 Delete this item', 'wdeDeleteItem(\'' + esc(id) + '\')', RED) : '') + errBox()
        );
    };

    window.wdeUnitStatus = async function (id, uid, st) {
        try { await R('elecStock/' + id + '/units/' + uid).update({ status: st, statusAt: new Date().toISOString(), statusBy: who() }); await refresh(); wdeOpenItem(id); }
        catch (e) { fail('Could not update: ' + (e.message || e)); }
    };

    window.wdeOpenAddStock = function (id) {
        var it = stock[id]; if (!it) return;
        openModal(head('➕ Add stock') + '<div style="font-size:13px;color:#64748b;">' + esc(label(it)) + '</div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;">' +
            (it.mode === 'serial'
                ? '<label style="' + LBL + '">Serial numbers — one per line</label><textarea id="wde-as-sn" rows="5" style="' + INP + 'font-family:monospace;font-size:14px;"></textarea>'
                : '<label style="' + LBL + '">How many to add?</label><input id="wde-as-q" type="number" min="1" inputmode="numeric" style="' + INP + '">') +
            '</div>' + errBox() + btn('Add to stock', 'wdeSaveAddStock(\'' + esc(id) + '\')', PRIMARY));
    };
    window.wdeSaveAddStock = async function (id) {
        var it = stock[id]; if (!it) return;
        try {
            if (it.mode === 'serial') {
                var list = parseSerials($('wde-as-sn').value);
                if (!list.length) return fail('Enter at least one serial number.');
                var msg = checkSerials(list); if (msg) return fail(msg);
                var now = new Date().toISOString(), upd = {};
                list.forEach(function (sn) { upd[R('elecStock/' + id + '/units').push().key] = { serial: sn, status: 'in_stock', addedAt: now, addedBy: who() }; });
                await R('elecStock/' + id + '/units').update(upd);
            } else {
                var q = Math.floor(num($('wde-as-q').value));
                if (q < 1) return fail('Enter how many to add.');
                await R('elecStock/' + id + '/qty').transaction(function (c) { return num(c) + q; });
            }
            wdeClose(); await refresh();
        } catch (e) { fail('Could not save: ' + (e.message || e)); }
    };
    window.wdeOpenCorrect = function (id) {
        var it = stock[id]; if (!it) return;
        openModal(head('✏️ Correct the count') + '<div style="font-size:13px;color:#64748b;">' + esc(label(it)) + ' — system says <b>' + inStock(it) + '</b></div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;">' +
            '<label style="' + LBL + '">Real count on the shelf</label><input id="wde-co-q" type="number" min="0" inputmode="numeric" style="' + INP + '">' +
            '<label style="' + LBL + '">Reason</label><input id="wde-co-r" style="' + INP + '" placeholder="e.g. stock count, damaged"></div>' +
            errBox() + btn('Save count', 'wdeSaveCorrect(\'' + esc(id) + '\')', PRIMARY));
    };
    window.wdeSaveCorrect = async function (id) {
        var q = $('wde-co-q').value; if (q === '' || num(q) < 0) return fail('Enter the real count.');
        try {
            await R('elecStock/' + id).update({ qty: Math.floor(num(q)), lastCountBy: who(), lastCountAt: new Date().toISOString(), lastCountReason: ($('wde-co-r').value || '').trim() });
            wdeClose(); await refresh();
        } catch (e) { fail('Could not save: ' + (e.message || e)); }
    };
    window.wdeOpenEdit = function (id) {
        var it = stock[id]; if (!it) return;
        openModal(head('✏️ Edit item') +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:6px;">' +
            '<label style="' + LBL + '">Name</label><input id="wde-e-name" style="' + INP + '" value="' + esc(it.name) + '">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                '<div><label style="' + LBL + '">Brand</label><input id="wde-e-brand" style="' + INP + '" value="' + esc(it.brand || '') + '"></div>' +
                '<div><label style="' + LBL + '">Model</label><input id="wde-e-model" style="' + INP + '" value="' + esc(it.model || '') + '"></div>' +
                '<div><label style="' + LBL + '">Size / spec</label><input id="wde-e-spec" style="' + INP + '" value="' + esc(it.spec || '') + '"></div>' +
                '<div><label style="' + LBL + '">Selling price</label><input id="wde-e-price" type="number" style="' + INP + '" value="' + num(it.price) + '"></div>' +
                (isAdmin() ? '<div><label style="' + LBL + '">Cost price</label><input id="wde-e-cost" type="number" style="' + INP + '" value="' + num(it.cost) + '"></div>' : '') +
                '<div><label style="' + LBL + '">Warranty (months)</label><input id="wde-e-war" type="number" min="0" style="' + INP + '" value="' + num(it.warranty) + '"></div>' +
                '<div><label style="' + LBL + '">Alert when below</label><input id="wde-e-alert" type="number" min="0" style="' + INP + '" value="' + alertAt(it) + '"></div>' +
            '</div></div>' + errBox() + btn('Save changes', 'wdeSaveEdit(\'' + esc(id) + '\')', PRIMARY));
    };
    window.wdeSaveEdit = async function (id) {
        var name = ($('wde-e-name').value || '').trim(), price = num($('wde-e-price').value);
        if (!name) return fail('Enter the name.'); if (price <= 0) return fail('Enter the selling price.');
        var upd = { name: name, brand: ($('wde-e-brand').value || '').trim(), model: ($('wde-e-model').value || '').trim(), spec: ($('wde-e-spec').value || '').trim(), price: price, warranty: num($('wde-e-war').value), alert: num($('wde-e-alert').value) };
        if (isAdmin() && $('wde-e-cost')) upd.cost = num($('wde-e-cost').value);
        try { await R('elecStock/' + id).update(upd); wdeClose(); await refresh(); } catch (e) { fail('Could not save: ' + (e.message || e)); }
    };
    window.wdeDeleteItem = async function (id) {
        if (!isAdmin()) return;
        var it = stock[id]; if (!it) return;
        if (!confirm('Delete "' + it.name + '" and all its units?\n\nPast sales keep their records. This cannot be undone.')) return;
        try { await R('elecStock/' + id).remove(); wdeClose(); await refresh(); } catch (e) { fail('Could not delete: ' + (e.message || e)); }
    };

    // =====================================================================
    // NEW SALE
    // =====================================================================
    var saleItems = {};   // label(lowercase) -> item
    window.wdeOpenSale = async function () {
        addStyles();
        try { await loadStock(); } catch (e) { alert('Could not load stock: ' + (e.message || e)); return; }
        saleItems = {};
        var opts = '';
        itemList().forEach(function (it) {
            if (inStock(it) > 0) { saleItems[label(it).toLowerCase()] = it; opts += '<option value="' + esc(label(it)) + '">'; }
        });
        openModal(
            head('🛒 New Sale') +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:6px;">' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                    '<div><label style="' + LBL + '">Customer name</label><input id="wde-c-name" style="' + INP + '" placeholder="Walk-in"></div>' +
                    '<div><label style="' + LBL + '">Phone</label><input id="wde-c-phone" type="tel" inputmode="tel" style="' + INP + '" placeholder="0801…"></div>' +
                '</div></div>' +
            '<div style="font-weight:800;font-size:13px;margin:14px 0 6px;">Items</div>' +
            '<datalist id="wde-items">' + opts + '</datalist><div id="wde-lines"></div>' +
            '<button onclick="wdeAddLine()" style="width:100%;padding:12px;border:1px dashed #3b82f6;border-radius:12px;background:#eff6ff;color:#1d4ed8;font-weight:800;font-size:14px;cursor:pointer;">➕ Add item</button>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:12px;">' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                    '<div><label style="' + LBL + '">Discount (₦)</label><input id="wde-disc" type="number" min="0" inputmode="decimal" oninput="wdeCalc()" style="' + INP + '" placeholder="0"></div>' +
                    '<div><label style="' + LBL + '">Delivery fee (₦)</label><input id="wde-del" type="number" min="0" inputmode="decimal" oninput="wdeCalc()" style="' + INP + '" placeholder="0"></div>' +
                '</div>' +
                '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;font-weight:600;"><input type="checkbox" id="wde-needdel" onchange="wdeCalc()" style="width:18px;height:18px;margin:0;"> Needs delivery / installation</label>' +
                '<div id="wde-delbox" style="display:none;"><label style="' + LBL + '">Delivery address</label><input id="wde-addr" style="' + INP + '" placeholder="Street, area, landmark">' +
                '<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;font-weight:600;"><input type="checkbox" id="wde-install" style="width:18px;height:18px;margin:0;"> Installation included</label></div>' +
            '</div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;">' +
                '<label style="' + LBL + '">Payment</label><select id="wde-method" style="' + INP + '" onchange="wdeCalc()"><option>Cash</option><option>Transfer</option><option>POS</option><option>Part Payment</option></select>' +
                '<div id="wde-partbox" style="display:none;"><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                    '<div><label style="' + LBL + '">Deposit paid (₦)</label><input id="wde-dep" type="number" min="0" inputmode="decimal" oninput="wdeCalc()" style="' + INP + '"></div>' +
                    '<div><label style="' + LBL + '">Deposit by</label><select id="wde-depm" style="' + INP + '"><option>Cash</option><option>Transfer</option><option>POS</option></select></div></div>' +
                    '<label style="' + LBL + '">Balance due date</label><input id="wde-due" type="date" style="' + INP + '"></div>' +
                '<div style="display:flex;justify-content:space-between;margin-top:14px;font-size:13px;color:#64748b;"><span>Subtotal</span><span id="wde-sub">₦0</span></div>' +
                '<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:19px;font-weight:800;color:#1d4ed8;"><span>Total</span><span id="wde-total">₦0</span></div>' +
                '<div id="wde-balline" style="display:none;margin-top:6px;font-size:13px;font-weight:800;color:#b91c1c;text-align:right;"></div>' +
            '</div>' + errBox() + btn('✅ Complete Sale', 'wdeSaveSale()', GREEN)
        );
        wdeAddLine();
    };

    window.wdeAddLine = function () {
        var box = $('wde-lines'); if (!box) return;
        var d = document.createElement('div');
        d.className = 'wde-line';
        d.innerHTML =
            '<input class="wde-it" list="wde-items" placeholder="Item name, or scan / type a serial" oninput="wdeItem(this)" onchange="wdeItem(this)">' +
            '<select class="wde-ser" style="display:none;" onchange="wdeCalc()"></select>' +
            '<div class="wde-lg"><input class="wde-qty" type="number" min="1" step="1" inputmode="numeric" value="1" oninput="wdeCalc()" style="display:none;">' +
            '<input class="wde-price" type="number" min="0" inputmode="decimal" placeholder="Price ₦" oninput="wdeCalc()" style="grid-column:2;"></div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:13px;"><span>Line: <b class="wde-lt">₦0</b></span>' +
            '<button onclick="this.closest(\'.wde-line\').remove();wdeCalc();" style="border:none;background:#fee2e2;color:#b91c1c;border-radius:8px;padding:6px 10px;font-weight:700;font-size:12px;cursor:pointer;">Remove</button></div>';
        box.appendChild(d);
    };

    function takenUnits(exceptRow) {
        var t = {};
        document.querySelectorAll('#wde-lines .wde-line').forEach(function (r) {
            if (r === exceptRow) return;
            var s = r.querySelector('.wde-ser'); if (s && s.value) t[s.value] = true;
        });
        return t;
    }
    window.wdeItem = function (el) {
        var row = el.closest('.wde-line');
        var v = (el.value || '').trim().toLowerCase();
        var it = saleItems[v], pickUid = '';
        if (!it && v.length >= 3) {   // scanned / typed serial
            Object.keys(saleItems).some(function (k) {
                var cand = saleItems[k];
                if (cand.mode !== 'serial') return false;
                var u = unitsOf(cand).filter(function (x) { return x.status === 'in_stock' && String(x.serial).toLowerCase() === v; })[0];
                if (u) { it = cand; pickUid = u.uid; return true; }
                return false;
            });
        }
        var ser = row.querySelector('.wde-ser'), qty = row.querySelector('.wde-qty'), price = row.querySelector('.wde-price');
        if (!it) { row.dataset.item = ''; ser.style.display = 'none'; qty.style.display = 'none'; wdeCalc(); return; }
        row.dataset.item = it.id;
        if (pickUid) el.value = label(it);
        if (it.mode === 'serial') {
            var taken = takenUnits(row);
            var us = unitsOf(it).filter(function (u) { return u.status === 'in_stock' && !taken[u.uid]; });
            ser.innerHTML = '<option value="">Choose serial number…</option>' + us.map(function (u) { return '<option value="' + esc(u.uid) + '">' + esc(u.serial) + '</option>'; }).join('');
            if (pickUid) ser.value = pickUid; else if (us.length === 1) ser.value = us[0].uid;
            ser.style.display = 'block'; qty.style.display = 'none'; qty.value = 1;
        } else {
            ser.style.display = 'none'; ser.innerHTML = '';
            qty.style.display = 'block'; qty.max = inStock(it); if (!num(qty.value)) qty.value = 1;
        }
        price.value = num(it.price);
        wdeCalc();
    };

    window.wdeCalc = function () {
        var sub = 0;
        document.querySelectorAll('#wde-lines .wde-line').forEach(function (r) {
            var q = num(r.querySelector('.wde-qty').value) || 1;
            var lt = (r.dataset.item ? q * num(r.querySelector('.wde-price').value) : 0);
            r.querySelector('.wde-lt').textContent = money(lt); sub += lt;
        });
        var total = Math.max(0, sub - num(($('wde-disc') || {}).value) + num(($('wde-del') || {}).value));
        if ($('wde-sub')) $('wde-sub').textContent = money(sub);
        if ($('wde-total')) $('wde-total').textContent = money(total);
        if ($('wde-delbox')) $('wde-delbox').style.display = $('wde-needdel').checked ? 'block' : 'none';
        var part = $('wde-method') && $('wde-method').value === 'Part Payment';
        if ($('wde-partbox')) $('wde-partbox').style.display = part ? 'block' : 'none';
        var bl = $('wde-balline');
        if (bl) { bl.style.display = part ? 'block' : 'none'; if (part) bl.textContent = 'Balance after deposit: ' + money(Math.max(0, total - num($('wde-dep').value))); }
    };

    window.wdeSaveSale = async function () {
        var lines = [], usedUnits = {}, problem = '';
        document.querySelectorAll('#wde-lines .wde-line').forEach(function (r) {
            if (problem || !r.dataset.item) return;
            var it = stock[r.dataset.item]; if (!it) return;
            var q = it.mode === 'serial' ? 1 : Math.floor(num(r.querySelector('.wde-qty').value));
            var price = num(r.querySelector('.wde-price').value);
            var uid = it.mode === 'serial' ? r.querySelector('.wde-ser').value : '';
            if (it.mode === 'serial' && !uid) { problem = 'Choose the serial number for ' + it.name + '.'; return; }
            if (it.mode === 'serial' && usedUnits[uid]) { problem = 'The same serial number is used twice.'; return; }
            if (q < 1) { problem = 'Quantity for ' + it.name + ' must be at least 1.'; return; }
            if (it.mode === 'qty' && q > inStock(it)) { problem = 'Only ' + inStock(it) + ' of ' + it.name + ' in stock.'; return; }
            if (price <= 0) { problem = 'Enter a price for ' + it.name + '.'; return; }
            if (uid) usedUnits[uid] = true;
            var serial = uid ? (it.units[uid] || {}).serial : '';
            lines.push({ itemId: it.id, uid: uid, name: it.name, brand: it.brand || '', model: it.model || '', spec: it.spec || '', mode: it.mode, serial: serial || '', qty: q, price: price, total: r2(q * price), cost: num(it.cost), warrantyMonths: num(it.warranty) });
        });
        if (problem) return fail(problem);
        if (lines.length === 0) return fail('Add at least one item.');

        var cust = ($('wde-c-name').value || '').trim(), phone = ($('wde-c-phone').value || '').trim();
        var needsInfo = lines.some(function (l) { return l.warrantyMonths > 0 || l.mode === 'serial'; });
        var method = $('wde-method').value;
        if ((needsInfo || method === 'Part Payment') && (!cust || !phone)) return fail('Customer name and phone are needed (for the warranty receipt and any balance).');
        var sub = r2(lines.reduce(function (s, l) { return s + l.total; }, 0));
        var disc = num($('wde-disc').value), deliv = num($('wde-del').value);
        if (disc > sub) return fail('Discount is bigger than the items total.');
        var net = r2(sub - disc + deliv);
        var paid = net, balance = 0, due = '', depMethod = method;
        if (method === 'Part Payment') {
            paid = num($('wde-dep').value);
            if (paid <= 0) return fail('Enter the deposit the customer is paying now.');
            if (paid >= net) return fail('The deposit must be less than the total (' + money(net) + '). For full payment pick Cash, Transfer or POS.');
            balance = r2(net - paid); due = $('wde-due').value || ''; depMethod = $('wde-depm').value;
        }
        var needDel = $('wde-needdel').checked, addr = ($('wde-addr').value || '').trim();
        if (needDel && !addr) return fail('Enter the delivery address.');

        var claimed = [];
        async function rollback() {
            for (var i = 0; i < claimed.length; i++) {
                var c = claimed[i];
                try {
                    if (c.uid) await R('elecStock/' + c.itemId + '/units/' + c.uid + '/status').set('in_stock');
                    else await R('elecStock/' + c.itemId + '/qty').transaction(function (v) { return num(v) + c.qty; });
                } catch (e) {}
            }
        }
        try {
            for (var i = 0; i < lines.length; i++) {
                var l = lines[i], ok;
                if (l.uid) {
                    var res = await R('elecStock/' + l.itemId + '/units/' + l.uid + '/status').transaction(function (cur) { return (cur === 'in_stock' || cur === null) ? 'sold' : undefined; });
                    ok = res.committed && res.snapshot.val() === 'sold';
                } else {
                    var cached = num(stock[l.itemId].qty);
                    var res2 = await R('elecStock/' + l.itemId + '/qty').transaction(function (cur) { var c = (cur === null) ? cached : num(cur); return c >= l.qty ? c - l.qty : undefined; });
                    ok = res2.committed;
                }
                if (!ok) { await rollback(); return fail('"' + l.name + '" was just sold or changed on another device. Close this window and try again.'); }
                claimed.push({ itemId: l.itemId, uid: l.uid, qty: l.qty });
            }

            var c2 = await R('elecCounter/lastSale').transaction(function (cur) { return num(cur) + 1; });
            var saleId = 'EL-' + String(c2.snapshot.val()).padStart(6, '0');
            var nowIso = new Date().toISOString(), soldDate = today();
            lines.forEach(function (l) { l.warrantyEnd = l.warrantyMonths > 0 ? addMonths(soldDate, l.warrantyMonths) : ''; });
            var sale = {
                saleId: saleId, customer: cust || 'Walk-in', phone: phone, lines: lines,
                subtotal: sub, discount: disc, delivery: deliv, net: net, amountPaid: paid, balance: balance, dueDate: due,
                method: method, needsDelivery: needDel, address: addr, install: !!$('wde-install').checked,
                soldBy: who(), soldAt: nowIso
            };
            if (paid > 0) sale.payments = { p0: { amount: paid, method: depMethod, at: nowIso, by: who(), note: method === 'Part Payment' ? 'Deposit' : 'Full payment' } };
            await R('elecSales/' + saleId).set(sale);
            for (var j = 0; j < lines.length; j++) {
                if (lines[j].uid) { try { await R('elecStock/' + lines[j].itemId + '/units/' + lines[j].uid).update({ saleId: saleId, soldAt: nowIso }); } catch (e) {} }
            }
            wdeClose();
            await refresh();
            wdeShowReceipt(saleId);
        } catch (e) {
            await rollback();
            fail('Could not complete the sale: ' + (e.message || e));
        }
    };

    // =====================================================================
    // RECEIPT
    // =====================================================================
    function receiptBody(s) {
        var rows = (s.lines || []).map(function (l) {
            return '<div style="margin-bottom:6px;"><b>' + esc(l.name) + '</b>' + (l.spec ? ' (' + esc(l.spec) + ')' : '') + '<br>' +
                (l.serial ? 'Serial: <span style="font-family:monospace;">' + esc(l.serial) + '</span><br>' : '') +
                esc(l.qty) + ' × ' + money(l.price) + ' = <b>' + money(l.total) + '</b>' +
                (l.warrantyEnd ? '<br><span style="font-size:11px;">Warranty: ' + esc(l.warrantyMonths) + ' months · until ' + esc(fmtDate(l.warrantyEnd)) + '</span>' : '') + '</div>';
        }).join('');
        return (s.refunded ? '<div style="text-align:center;font-weight:bold;color:#991b1b;border:2px solid #991b1b;padding:4px;margin-bottom:8px;">REFUNDED — WARRANTY VOID</div>' : '') +
            '<div><b>Receipt:</b> ' + esc(s.saleId) + ' &nbsp; <b>Date:</b> ' + esc(fmtDate(s.soldAt)) + '</div>' +
            '<div><b>Customer:</b> ' + esc(s.customer) + (s.phone ? ' · ' + esc(s.phone) : '') + '</div><hr style="border:dashed 1px #ccc;margin:8px 0;">' + rows +
            '<hr style="border:dashed 1px #ccc;margin:8px 0;"><div>Subtotal: ' + money(s.subtotal) + '</div>' +
            (num(s.discount) ? '<div>Discount: −' + money(s.discount) + '</div>' : '') + (num(s.delivery) ? '<div>Delivery: ' + money(s.delivery) + '</div>' : '') +
            '<div style="font-size:15px;"><b>Total: ' + money(s.net) + '</b></div><div>Paid: ' + money(s.amountPaid) + ' (' + esc(s.method) + ')</div>' +
            (bal(s) > 0 ? '<div style="margin-top:4px;padding:4px;border:1px solid #991b1b;color:#991b1b;font-weight:bold;">BALANCE DUE: ' + money(bal(s)) + (s.dueDate ? '<br><span style="font-size:11px;">Pay by ' + esc(fmtDate(s.dueDate)) + '</span>' : '') + '</div>' : '') +
            (s.needsDelivery ? '<div style="margin-top:6px;">🚚 Deliver to: ' + esc(s.address) + (s.install ? ' (with installation)' : '') + '</div>' : '') +
            '<div style="margin-top:6px;font-size:11px;">Served by: ' + esc(s.soldBy) + '</div>';
    }

    window.wdeShowReceipt = function (id) {
        var s = sales[id]; if (!s) return;
        openModal(head('🧾 Receipt') +
            '<div style="background:#fff;color:#000;border:1px solid #ccc;border-radius:8px;padding:14px;font-family:monospace;font-size:12px;line-height:1.55;"><div style="text-align:center;font-weight:bold;font-size:14px;">' + esc(storeName) + '</div><div style="text-align:center;font-size:11px;margin-bottom:6px;">WARRANTY RECEIPT</div>' + receiptBody(s) + '</div>' +
            btn('🖨 Print / Save PDF', 'wdePrint(\'' + esc(id) + '\')', PRIMARY) + btn('💬 Send on WhatsApp', 'wdeWaReceipt(\'' + esc(id) + '\')', 'border:1px solid #bbf7d0;background:#f0fdf4;color:#15803d;') + errBox());
    };
    window.wdePrint = function (id) {
        var s = sales[id]; if (!s) return;
        var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(s.saleId) + '</title>' +
            '<style>body{font-family:monospace;color:#000;margin:18px;max-width:380px;font-size:12px;line-height:1.55}@media print{button{display:none}}</style></head><body>' +
            '<div style="text-align:center;font-weight:bold;font-size:16px;">' + esc(storeName) + '</div><div style="text-align:center;margin-bottom:8px;">WARRANTY RECEIPT</div>' + receiptBody(s) +
            '<p style="font-size:11px;margin-top:14px;">Keep this receipt. It is your proof of purchase and warranty.</p><div style="margin-top:26px;border-top:1px solid #000;width:70%;font-size:11px;">Customer signature</div>' +
            '<button onclick="window.print()" style="margin-top:16px;padding:10px 18px;font-size:15px">Print / Save as PDF</button></body></html>';
        var w = window.open('', '_blank');
        if (!w) return fail('Your browser blocked the print window. Allow pop-ups for this site and try again.');
        w.document.open(); w.document.write(html); w.document.close();
        setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
    };
    window.wdeWaReceipt = function (id) {
        var s = sales[id]; if (!s) return;
        var t = '*' + storeName + '*\nReceipt ' + s.saleId + ' · ' + fmtDate(s.soldAt) + '\n\n';
        (s.lines || []).forEach(function (l, i) { t += (i + 1) + '. ' + l.name + (l.serial ? ' (SN ' + l.serial + ')' : '') + ' — ' + l.qty + ' × ' + money(l.price) + (l.warrantyEnd ? '\n   Warranty until ' + fmtDate(l.warrantyEnd) : '') + '\n'; });
        t += '\n*Total: ' + money(s.net) + '*\nPaid: ' + money(s.amountPaid);
        if (bal(s) > 0) t += '\nBalance due: ' + money(bal(s)) + (s.dueDate ? ' by ' + fmtDate(s.dueDate) : '');
        t += '\n\nThank you for shopping with us!';
        window.open('https://wa.me/' + waNum(s.phone) + '?text=' + encodeURIComponent(t), '_blank');
    };

    // =====================================================================
    // SALE DETAILS, PAYMENT, REFUND, LIST
    // =====================================================================
    window.wdeOpenSale_detail = function (id) {
        var s = sales[id]; if (!s) return;
        var b = bal(s), mg = canManage();
        openModal(head(esc(s.saleId)) +
            '<div style="font-size:15px;font-weight:800;">' + esc(s.customer) + (s.refunded ? ' <span class="wde-badge gry">Refunded</span>' : (b > 0 ? ' <span class="wde-badge amb">Owes ' + money(b) + '</span>' : ' <span class="wde-badge">Paid</span>')) + '</div>' +
            (s.phone ? '<div style="font-size:12px;color:#64748b;">📞 ' + esc(s.phone) + '</div>' : '') +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:6px 14px;margin-top:10px;">' +
            (s.lines || []).map(function (l) { return '<div class="wde-row" style="cursor:default;"><div><b>' + esc(l.name) + '</b><span class="wde-sub2">' + (l.serial ? 'SN ' + esc(l.serial) + ' · ' : '') + esc(l.qty) + ' × ' + money(l.price) + '</span></div><b>' + money(l.total) + '</b></div>'; }).join('') +
            '<div class="wde-row" style="cursor:default;"><span>Total</span><b>' + money(s.net) + '</b></div><div class="wde-row" style="cursor:default;"><span>Paid</span><b style="color:#16a34a;">' + money(s.amountPaid) + '</b></div></div>' +
            btn('🧾 Receipt', 'wdeShowReceipt(\'' + esc(id) + '\')', PRIMARY) +
            (b > 0 ? btn('💵 Record a payment', 'wdeOpenPay(\'' + esc(id) + '\')', GREEN) + btn('💬 WhatsApp reminder', 'wdeRemind(\'' + esc(id) + '\')', 'border:1px solid #bbf7d0;background:#f0fdf4;color:#15803d;') : '') +
            (mg && !s.refunded ? btn('↩️ Return / Refund', 'wdeOpenRefund(\'' + esc(id) + '\')', RED) : '') + errBox());
    };

    window.wdeOpenPay = function (id) {
        var s = sales[id]; if (!s) return;
        openModal(head('💵 Record a payment') + '<div style="font-size:13px;">' + esc(s.customer) + ' owes <b style="color:#b91c1c;">' + money(bal(s)) + '</b></div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;"><label style="' + LBL + '">Amount received (₦)</label><input id="wde-p-amt" type="number" min="0" inputmode="decimal" value="' + bal(s) + '" style="' + INP + '">' +
            '<label style="' + LBL + '">Paid by</label><select id="wde-p-m" style="' + INP + '"><option>Cash</option><option>Transfer</option><option>POS</option></select></div>' + errBox() + btn('Save payment', 'wdeSavePay(\'' + esc(id) + '\')', GREEN));
    };
    window.wdeSavePay = async function (id) {
        var amt = num($('wde-p-amt').value); if (amt <= 0) return fail('Enter the amount received.');
        var key = 'p' + Date.now(), nowIso = new Date().toISOString(), by = who(), m = $('wde-p-m').value;
        try {
            var res = await R('elecSales/' + id).transaction(function (cur) {
                if (!cur || cur.refunded) return;
                var b = num(cur.balance); if (amt > b + 0.001) return;
                var p = Object.assign({}, cur.payments || {}); p[key] = { amount: amt, method: m, at: nowIso, by: by, note: 'Balance payment' };
                cur.payments = p; cur.amountPaid = r2(num(cur.amountPaid) + amt); cur.balance = Math.max(0, r2(b - amt));
                if (cur.balance === 0) cur.clearedAt = nowIso;
                return cur;
            });
            var v = res.snapshot.val();
            if (!res.committed || !v || !v.payments || !v.payments[key]) return fail('Could not save. The amount is more than the balance, or the sale was refunded.');
            wdeClose(); await refresh();
            if (bal(sales[id]) <= 0) alert('✅ ' + sales[id].customer + ' has cleared the balance.');
        } catch (e) { fail('Could not save: ' + (e.message || e)); }
    };
    window.wdeRemind = function (id) {
        var s = sales[id]; if (!s) return;
        var t = 'Hello ' + s.customer + ', this is a friendly reminder from ' + storeName + ' about your balance of ' + money(bal(s)) + ' (receipt ' + s.saleId + ').' + (s.dueDate ? ' Kindly pay by ' + fmtDate(s.dueDate) + '.' : '') + ' Thank you.';
        window.open('https://wa.me/' + waNum(s.phone) + '?text=' + encodeURIComponent(t), '_blank');
    };

    window.wdeOpenRefund = function (id) {
        var s = sales[id]; if (!s || !canManage()) return;
        openModal(head('↩️ Return / Refund') + '<div style="font-size:13px;">' + esc(s.saleId) + ' · ' + esc(s.customer) + ' · paid <b>' + money(s.amountPaid) + '</b></div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;">' +
            '<label style="' + LBL + '">Refund amount (₦)</label><input id="wde-r-amt" type="number" min="0" inputmode="decimal" value="' + num(s.amountPaid) + '" style="' + INP + '">' +
            '<label style="' + LBL + '">Reason *</label><input id="wde-r-why" style="' + INP + '" placeholder="e.g. faulty, wrong model">' +
            '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;font-weight:600;"><input type="checkbox" id="wde-r-back" checked style="width:18px;height:18px;margin:0;"> Put the items back in stock</label></div>' +
            errBox() + btn('Confirm return', 'wdeConfirmRefund(\'' + esc(id) + '\')', RED));
    };
    window.wdeConfirmRefund = async function (id) {
        var s = sales[id]; if (!s) return;
        var amt = num($('wde-r-amt').value), why = ($('wde-r-why').value || '').trim(), back = $('wde-r-back').checked;
        if (amt < 0 || amt > num(s.amountPaid) + 0.001) return fail('Refund cannot be more than what was paid (' + money(s.amountPaid) + ').');
        if (!why) return fail('Write the reason.');
        try {
            var res = await R('elecSales/' + id).transaction(function (cur) {
                if (!cur || cur.refunded) return;
                cur.refunded = { at: new Date().toISOString(), by: who(), amount: amt, reason: why, restocked: back }; cur.balance = 0; return cur;
            });
            if (!res.committed) return fail('Could not process. It may already be refunded.');
            if (back) {
                for (var i = 0; i < (s.lines || []).length; i++) {
                    var l = s.lines[i];
                    try {
                        if (l.uid) await R('elecStock/' + l.itemId + '/units/' + l.uid).update({ status: 'in_stock', saleId: null, soldAt: null });
                        else await R('elecStock/' + l.itemId + '/qty').transaction(function (v) { return num(v) + num(l.qty); });
                    } catch (e) { /* the item may have been deleted */ }
                }
            }
            wdeClose(); await refresh(); alert('✅ Return recorded.' + (back ? ' Items are back in stock.' : ''));
        } catch (e) { fail('Could not process: ' + (e.message || e)); }
    };

    window.wdeOpenSalesList = async function () {
        if (!canManage()) return;
        try { await loadSales(); } catch (e) {}
        openModal(head('🧾 All sales') + '<input id="wde-sl-q" class="wde-search" placeholder="Search name, phone, receipt or serial…" oninput="wdeRenderSales()" style="margin-top:6px;"><div id="wde-sl-body" style="max-height:60vh;overflow-y:auto;"></div>');
        wdeRenderSales();
    };
    window.wdeRenderSales = function () {
        var box = $('wde-sl-body'); if (!box) return;
        var q = (($('wde-sl-q') || {}).value || '').toLowerCase().trim();
        var rows = saleList().filter(function (s) {
            if (!q) return true;
            return ((s.customer || '') + ' ' + (s.phone || '') + ' ' + (s.saleId || '') + ' ' + (s.lines || []).map(function (l) { return (l.serial || '') + ' ' + l.name; }).join(' ')).toLowerCase().indexOf(q) !== -1;
        }).sort(function (a, b) { return String(b.soldAt).localeCompare(String(a.soldAt)); });
        box.innerHTML = rows.length ? rows.slice(0, 60).map(saleRow).join('') : '<div class="wde-empty">No sales found.</div>';
    };

    // =====================================================================
    // WHO OWES ME
    // =====================================================================
    window.wdeOpenOwe = async function () {
        if (!canManage()) return;
        try { await loadSales(); } catch (e) {}
        var rows = saleList().filter(function (s) { return bal(s) > 0; }).sort(function (a, b) { return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')); });
        var total = rows.reduce(function (t, s) { return t + bal(s); }, 0);
        openModal(head('💵 Who Owes Me') + '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;margin:8px 0;font-size:13px;">Total owed: <b style="color:#b91c1c;font-size:16px;">' + money(total) + '</b> · ' + rows.length + ' customer' + (rows.length === 1 ? '' : 's') + '</div>' +
            '<div style="max-height:62vh;overflow-y:auto;">' + (rows.length ? rows.map(function (s) {
                var left = s.dueDate ? daysUntil(s.dueDate) : null;
                var due = s.dueDate ? (left < 0 ? '<span style="color:#b91c1c;font-weight:800;">' + Math.abs(left) + ' day' + (left === -1 ? '' : 's') + ' overdue</span>' : (left === 0 ? 'Due today' : 'Due in ' + left + ' day' + (left === 1 ? '' : 's'))) : 'No due date';
                return '<div class="wde-card" style="margin-bottom:8px;padding:12px;"><div style="display:flex;justify-content:space-between;gap:8px;"><div><b>' + esc(s.customer) + '</b><span class="wde-sub2">' + esc(s.phone) + ' · ' + esc(s.saleId) + '</span></div><div style="text-align:right;"><b style="color:#b91c1c;">' + money(bal(s)) + '</b><span class="wde-sub2">' + due + '</span></div></div>' +
                    '<div style="display:flex;gap:6px;margin-top:8px;"><button onclick="wdeOpenPay(\'' + esc(s._id) + '\')" style="flex:1;padding:9px;border:none;border-radius:10px;background:#16a34a;color:#fff;font-weight:700;font-size:12px;cursor:pointer;">💵 Payment</button><button onclick="wdeRemind(\'' + esc(s._id) + '\')" style="flex:1;padding:9px;border:1px solid #bbf7d0;border-radius:10px;background:#f0fdf4;color:#15803d;font-weight:700;font-size:12px;cursor:pointer;">💬 Remind</button><button onclick="wdeOpenSale_detail(\'' + esc(s._id) + '\')" style="flex:1;padding:9px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-weight:700;font-size:12px;cursor:pointer;">Details</button></div></div>';
            }).join('') : '<div class="wde-empty">Nobody owes you. All paid ✅</div>') + '</div>');
    };

    // =====================================================================
    // WARRANTY CHECK
    // =====================================================================
    window.wdeOpenWarranty = async function () {
        addStyles();
        try { await loadSales(); } catch (e) {}
        openModal(head('🛡 Warranty Check') + '<input id="wde-w-q" class="wde-search" placeholder="Serial number, customer name or phone…" oninput="wdeRenderWarranty()" style="margin-top:6px;"><div id="wde-w-body" style="max-height:62vh;overflow-y:auto;"><div class="wde-empty">Type at least 4 characters.</div></div>');
        setTimeout(function () { var i = $('wde-w-q'); if (i) i.focus(); }, 100);
    };
    window.wdeRenderWarranty = function () {
        var box = $('wde-w-body'); if (!box) return;
        var q = (($('wde-w-q') || {}).value || '').toLowerCase().trim();
        if (q.length < 4) { box.innerHTML = '<div class="wde-empty">Type at least 4 characters.</div>'; return; }
        var out = [];
        saleList().forEach(function (s) {
            (s.lines || []).forEach(function (l) {
                var hay = ((l.serial || '') + ' ' + (s.customer || '') + ' ' + (s.phone || '')).toLowerCase();
                if (hay.indexOf(q) !== -1) out.push({ s: s, l: l });
            });
        });
        if (!out.length) { box.innerHTML = '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px;font-size:13px;color:#991b1b;margin-top:8px;">No sale found. It was not sold through this shop.</div>'; return; }
        box.innerHTML = out.slice(0, 20).map(function (x) {
            var st;
            if (x.s.refunded) st = ['#fee2e2', '#991b1b', 'REFUNDED — warranty void'];
            else if (!x.l.warrantyEnd) st = ['#f1f5f9', '#475569', 'NO WARRANTY'];
            else { var left = daysUntil(x.l.warrantyEnd); st = left >= 0 ? ['#dcfce7', '#166534', 'ACTIVE — ' + left + ' day' + (left === 1 ? '' : 's') + ' left'] : ['#fee2e2', '#991b1b', 'EXPIRED ' + Math.abs(left) + ' day' + (left === -1 ? '' : 's') + ' ago']; }
            return '<div class="wde-card" style="margin-top:8px;"><div style="background:' + st[0] + ';color:' + st[1] + ';font-weight:800;font-size:13px;text-align:center;padding:6px;border-radius:8px;margin-bottom:8px;">' + st[2] + '</div>' +
                '<b>' + esc(x.l.name) + '</b>' + (x.l.serial ? '<span class="wde-sub2" style="font-family:monospace;">SN ' + esc(x.l.serial) + '</span>' : '') +
                '<span class="wde-sub2">👤 ' + esc(x.s.customer) + ' · ' + esc(x.s.phone) + '</span><span class="wde-sub2">Sold ' + esc(fmtDate(x.s.soldAt)) + (x.l.warrantyEnd ? ' · warranty ends ' + esc(fmtDate(x.l.warrantyEnd)) : '') + '</span>' +
                '<button onclick="wdeShowReceipt(\'' + esc(x.s._id) + '\')" style="margin-top:8px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;font-weight:700;font-size:12px;cursor:pointer;">🧾 View receipt</button></div>';
        }).join('');
    };

    // =====================================================================
    // REPORTS
    // =====================================================================
    window.wdeOpenReports = async function () {
        if (!canManage()) return;
        try { await Promise.all([loadSales(), loadStock()]); } catch (e) {}
        openModal(head('📈 Electronics Reports') + '<select id="wde-rp" class="wde-search" onchange="wdeRenderReport()" style="margin-top:6px;"><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">This month</option><option value="all">All time</option></select><div id="wde-rp-body"></div>');
        wdeRenderReport();
    };
    window.wdeRenderReport = function () {
        var box = $('wde-rp-body'); if (!box) return;
        var p = $('wde-rp').value, t = today(), from = '0000-00-00';
        if (p === 'today') from = t;
        else if (p === 'week') { var d = new Date(); d.setDate(d.getDate() - 6); from = dayKey(d); }
        else if (p === 'month') from = t.substring(0, 7) + '-01';
        var inP = function (iso) { var x = localDate(iso); return x && x >= from && x <= t; };
        var n = 0, value = 0, profit = 0, recv = 0, refunds = 0, owed = 0, byItem = {}, byStaff = {};
        saleList().forEach(function (s) {
            if (!s.refunded && inP(s.soldAt)) {
                n++; value += num(s.net);
                (s.lines || []).forEach(function (l) { profit += num(l.total) - num(l.cost) * num(l.qty); var o = byItem[l.name] = byItem[l.name] || { n: 0, v: 0 }; o.n += num(l.qty); o.v += num(l.total); });
                profit -= num(s.discount);
                var st = byStaff[s.soldBy || '—'] = byStaff[s.soldBy || '—'] || { n: 0, v: 0 }; st.n++; st.v += num(s.net);
            }
            paysOf(s).forEach(function (pm) { if (inP(pm.at)) recv += num(pm.amount); });
            if (s.refunded && inP(s.refunded.at)) refunds += num(s.refunded.amount);
            owed += bal(s);
        });
        var card = function (l, v, bg, fg) { return '<div style="background:' + bg + ';border-radius:12px;padding:10px;"><div style="font-size:10px;font-weight:800;text-transform:uppercase;color:' + fg + ';">' + l + '</div><div style="font-size:17px;font-weight:800;color:' + fg + ';margin-top:3px;">' + v + '</div></div>'; };
        var table = function (title, obj, lim) {
            var ks = Object.keys(obj).sort(function (a, b) { return obj[b].v - obj[a].v; }).slice(0, lim || 99);
            return ks.length ? '<div class="wde-card" style="margin-top:12px;"><h3>' + title + '</h3>' + ks.map(function (k) { return '<div class="wde-row" style="cursor:default;"><span>' + esc(k) + ' <span style="color:#94a3b8;">×' + obj[k].n + '</span></span><b>' + money(obj[k].v) + '</b></div>'; }).join('') + '</div>' : '';
        };
        box.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px;">' +
            card('Sales made', String(n), '#eff6ff', '#1d4ed8') + card('Sales value', money(value), '#ecfdf5', '#065f46') +
            card('Money received', money(recv), '#f0fdf4', '#166534') + (isAdmin() ? card('Profit', money(profit), '#fefce8', '#854d0e') : card('Refunds', money(refunds), '#fef2f2', '#991b1b')) +
            (isAdmin() ? card('Refunds', money(refunds), '#fef2f2', '#991b1b') : '') + card('Still owed (all time)', money(owed), '#fff7ed', '#9a3412') + '</div>' +
            table('Top items', byItem, 6) + table('By staff', byStaff);
    };

    // =====================================================================
    // SIDEBAR + ATTACH
    // =====================================================================
    var BTNS = [
        { id: 'wde-sb-sale',     html: '🛒 New Sale',                fn: 'wdeOpenSale',     manage: false },
        { id: 'wde-sb-stock',    html: '📦 Electronics Stock',       fn: 'wdeShowStock',    manage: true },
        { id: 'wde-sb-owe',      html: '💵 Who Owes Me<span id="wde-sb-dot" class="wde-dot"></span>', fn: 'wdeOpenOwe', manage: true },
        { id: 'wde-sb-warranty', html: '🛡 Warranty Check',          fn: 'wdeOpenWarranty', manage: false },
        { id: 'wde-sb-reports',  html: '📈 Electronics Reports',     fn: 'wdeOpenReports',  manage: true }
    ];
    function refreshBadge() {
        var d = $('wde-sb-dot'); if (!d) return;
        var n = saleList().filter(function (s) { return bal(s) > 0; }).length;
        var txt = n > 0 ? String(n) : '';
        if (d.textContent !== txt) d.textContent = txt;
        var disp = n > 0 ? 'inline-block' : 'none';
        if (d.style.display !== disp) d.style.display = disp;
    }
    function attachSidebar() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        var on = !!(side && isElec() && sid() && sid() !== 'SUPER_ADMIN');
        if (document.body && document.body.classList.contains('wde-elec') !== on) document.body.classList.toggle('wde-elec', on);
        var main = $('wde-sidebar-main-btn');
        if (!on) { if (main) main.remove(); BTNS.forEach(function (b) { var e = $(b.id); if (e) e.remove(); }); return; }
        addStyles();
        if (!main) {
            main = document.createElement('button');
            main.id = 'wde-sidebar-main-btn';
            main.className = 'menu-btn';
            main.onclick = function () { wdeShowDashboard(); };
            var first = side.querySelector('button');
            if (first) side.insertBefore(main, first); else side.appendChild(main);
        }
        var txt = canManage() ? '📺 Electronics Dashboard' : '📺 Electronics Sales';
        if (main.textContent !== txt) main.textContent = txt;
        var prev = main, mg = canManage();
        BTNS.forEach(function (b) {
            var el = $(b.id), show = b.manage ? mg : true;
            if (!show) { if (el) el.remove(); return; }
            if (!el) {
                el = document.createElement('button');
                el.id = b.id; el.className = 'menu-btn wde-sb'; el.innerHTML = b.html;
                el.onclick = function () { if (typeof window[b.fn] === 'function') window[b.fn](); };
            }
            if (prev.nextSibling !== el) prev.parentNode.insertBefore(el, prev.nextSibling);
            prev = el;
        });
        refreshBadge();
    }

    // the regular (grocery) inventory screen opens the electronics stock instead
    var origSwitch = window.switchView;
    if (typeof origSwitch === 'function') {
        window.switchView = function (id) {
            try {
                if (id === 'inventory-view' && isElec()) { canManage() ? wdeShowStock() : wdeShowDashboard(); return; }
            } catch (e) { console.warn('[electronics]', e); }
            return origSwitch.apply(this, arguments);
        };
    }

    function attach() {
        try { watchType(); cacheStoreName(); attachSidebar(); } catch (e) { console.warn('[electronics]', e); }
    }
    window.addEventListener('load', function () {
        setTimeout(attach, 1500);
        var busy = false;
        var obs = new MutationObserver(function () {
            if (busy) return; busy = true;
            setTimeout(function () { busy = false; attach(); }, 150);
        });
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    });
})();
