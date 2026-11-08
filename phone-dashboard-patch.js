// ==================== WISE DECISION PHONE DASHBOARD REDESIGN (v1) ====================
// Load AFTER phone-extras-patch.js (and before vertical-first-patch.js).
//
// Gives the Phone Vendor dashboard the same treatment as the Materials one:
//   * greeting + one big "Today's phone sales" card (units, money received, profit for Admin, money owed)
//   * a big "Sell a Phone" button that opens a searchable list of phones in stock
//   * colourful sidebar buttons for the phone tools (reports, who owes me, warranty, repairs, history, adjust stock)
//   * on phones: the phone list becomes easy-to-read cards instead of a 10-column table,
//     and the sidebar becomes one swipeable row
//   * no purple: the Phone Sales button and focus colours use the app's teal/blue
//
// Nothing existing is renamed or removed. It reads the same data the phone patches already load.
// Role rules: Admin and Manager see all tools. Anyone else sees only Phone Sales and Warranty Check.

console.log("Wise Decision phone-dashboard-patch.js — v1 loaded");

(function () {
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function num(n) { return Number(n) || 0; }
    function money(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + num(n).toLocaleString()); }

    function isPhoneStore() {
        return typeof currentStoreId !== 'undefined' && currentStoreId && currentStoreId !== 'SUPER_ADMIN' &&
               typeof wdvGetDashboardForStore === 'function' && wdvGetDashboardForStore() === 'phone_vendor';
    }
    function isAdmin() { return (typeof wdxIsAdmin === 'function') ? wdxIsAdmin() : (typeof currentUserRole !== 'undefined' && currentUserRole === 'Admin'); }
    function canManage() {
        if (typeof wdxCanManageStock === 'function') return wdxCanManageStock();
        return typeof currentUserRole !== 'undefined' && (currentUserRole === 'Admin' || currentUserRole === 'Manager');
    }

    // The phone sidebar hides every button whose text is not in this list (phone-extras-patch.js).
    // The labels used below are unique on purpose, so the normal grocery buttons stay hidden.
    if (typeof WDX_PHONE_KEEP !== 'undefined' && Array.isArray(WDX_PHONE_KEEP)) {
        ['phone reports', 'who owes me', 'warranty check', 'phone repairs', 'phone sales history', 'adjust phone stock', 'business settings'].forEach(function (k) {
            if (WDX_PHONE_KEEP.indexOf(k) === -1) WDX_PHONE_KEEP.push(k);
        });
    }

    // ---------- styles ----------
    function addStyles() {
        if ($('wdp-styles')) return;
        var S = '#dashboard-main-wrapper .sidebar ';
        var st = document.createElement('style');
        st.id = 'wdp-styles';
        st.textContent =
        // top block
        '.wdp{max-width:760px;margin:0 0 16px 0;color:#0f172a;}' +
        '.wdp *{box-sizing:border-box;}' +
        '.wdp-hi{font-size:20px;font-weight:800;}' +
        '.wdp-date{font-size:12px;color:#64748b;margin:2px 0 12px;}' +
        '.wdp-hero{background:linear-gradient(135deg,#14b8a6 0%,#0284c7 100%);color:#fff;border-radius:18px;padding:18px;box-shadow:0 10px 24px rgba(2,132,199,.25);}' +
        '.wdp-hero-label{font-size:12px;opacity:.9;text-transform:uppercase;letter-spacing:.6px;font-weight:700;}' +
        '.wdp-hero-amt{font-size:32px;font-weight:800;margin:4px 0 14px;line-height:1.1;}' +
        '.wdp-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}' +
        '.wdp-grid>div{background:rgba(255,255,255,.17);border-radius:12px;padding:10px 12px;}' +
        '.wdp-grid b{display:block;font-size:16px;}' +
        '.wdp-grid span{font-size:11px;opacity:.9;}' +
        '.wdp-cta{width:100%;margin-top:12px;border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:800;color:#fff;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);box-shadow:0 8px 18px rgba(22,163,74,.3);cursor:pointer;}' +
        // sell picker
        '.wdp-pick{display:flex;justify-content:space-between;gap:10px;align-items:center;border:1px solid #e8eef5;border-radius:12px;padding:11px 12px;margin-bottom:6px;cursor:pointer;background:#fff;}' +
        '.wdp-pick:hover{background:#f0fdfa;border-color:#99f6e4;}' +
        '.wdp-pick b{font-size:14px;}' +
        '.wdp-pick small{display:block;font-size:11px;color:#64748b;margin-top:2px;font-family:monospace;}' +
        '.wdp-pick .p{font-weight:800;color:#16a34a;white-space:nowrap;}' +
        // sidebar buttons
        S + '.wdp-sb{border-width:1px !important;border-style:solid !important;border-left-width:4px !important;border-radius:12px !important;font-weight:700 !important;box-shadow:none !important;}' +
        S + '#wdv-sidebar-phone-btn{background:linear-gradient(135deg,#14b8a6 0%,#0284c7 100%) !important;color:#fff !important;border:none !important;box-shadow:0 4px 12px rgba(2,132,199,.28) !important;}' +
        S + '#wdp-sb-reports{background:#eff6ff !important;color:#1d4ed8 !important;border-color:#bfdbfe !important;border-left-color:#3b82f6 !important;}' +
        S + '#wdp-sb-debtors{background:#fff1f2 !important;color:#be123c !important;border-color:#fecdd3 !important;border-left-color:#f43f5e !important;}' +
        S + '#wdp-sb-warranty{background:#f0fdf4 !important;color:#15803d !important;border-color:#bbf7d0 !important;border-left-color:#22c55e !important;}' +
        S + '#wdp-sb-repairs{background:#fff7ed !important;color:#c2410c !important;border-color:#fed7aa !important;border-left-color:#f97316 !important;}' +
        S + '#wdp-sb-history{background:#fffbeb !important;color:#92400e !important;border-color:#fde68a !important;border-left-color:#f59e0b !important;}' +
        S + '#wdp-sb-stock{background:#ecfeff !important;color:#0e7490 !important;border-color:#a5f3fc !important;border-left-color:#06b6d4 !important;}' +
        '.wdp-badge{display:none;background:#dc2626;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;margin-left:6px;}' +
        // no purple on the phone screen
        '#wdv-table-body tr:hover{background:#f0fdfa !important;}' +
        '#wdv-table-body td:first-child:hover{color:#0284c7 !important;}' +
        '#wdv-search:focus,#wdv-filter-brand:focus,#wdv-filter-status:focus,#wdv-modal input:focus,#wdv-modal select:focus,#wdv-modal textarea:focus{border-color:#14b8a6 !important;box-shadow:0 0 0 3px rgba(20,184,166,.18) !important;}' +
        // phones: list as cards, sidebar as one swipeable row
        '@media (max-width:767px){' +
            '#wdv-summary-cards{grid-template-columns:1fr 1fr !important;}' +
            '#wdv-search{min-width:100% !important;}' +
            'table:has(#wdv-table-body){display:block !important;}' +
            'table:has(#wdv-table-body) thead{display:none !important;}' +
            '#wdv-table-body{display:block;}' +
            '#wdv-table-body tr{display:grid;grid-template-columns:1fr auto;column-gap:10px;row-gap:3px;background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:12px;margin-bottom:8px;border-bottom:1px solid #e8eef5 !important;}' +
            '#wdv-table-body td{display:block;padding:0 !important;border:none !important;text-align:left !important;font-size:12px;}' +
            '#wdv-table-body td[colspan]{grid-column:1 / -1;text-align:center !important;padding:20px 0 !important;}' +
            '#wdv-table-body td:nth-child(1){grid-column:1;grid-row:3;font-family:monospace;color:#64748b;}' +
            '#wdv-table-body td:nth-child(2){grid-column:1;grid-row:1;font-size:14px;}' +
            '#wdv-table-body td:nth-child(3){grid-column:1;grid-row:2;color:#64748b;}' +
            '#wdv-table-body td:nth-child(4){grid-column:2;grid-row:3;text-align:right !important;color:#64748b;}' +
            '#wdv-table-body td:nth-child(5){grid-column:1;grid-row:4;margin-top:4px;}' +
            '#wdv-table-body td:nth-child(5)::before{content:"Cost ";color:#94a3b8;}' +
            '#wdv-table-body td:nth-child(6){grid-column:2;grid-row:2;text-align:right !important;font-weight:800;font-size:15px;color:#16a34a;}' +
            '#wdv-table-body td:nth-child(7){grid-column:2;grid-row:4;text-align:right !important;margin-top:4px;}' +
            '#wdv-table-body td:nth-child(8){grid-column:2;grid-row:1;text-align:right !important;}' +
            '#wdv-table-body td:nth-child(9){grid-column:1;grid-row:5;font-size:11px;}' +
            '#wdv-table-body td:nth-child(9)::after{content:" days in stock";font-weight:400;}' +
            '#wdv-table-body td:nth-child(10){grid-column:1 / -1;grid-row:6;margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;white-space:normal !important;}' +
            '#wdv-table-body td:nth-child(10) .menu-btn{width:auto;margin:0 !important;padding:9px 16px !important;font-size:13px !important;}' +
            'body.wdp-phone ' + S + '{flex-direction:row !important;flex-wrap:nowrap !important;align-items:center !important;gap:8px !important;overflow-x:auto !important;overflow-y:hidden !important;padding:10px 12px !important;border-right:none !important;border-bottom:1px solid #e2e8f0 !important;box-shadow:none !important;position:sticky;top:0;z-index:20;-webkit-overflow-scrolling:touch;}' +
            'body.wdp-phone ' + S + '> *{flex-shrink:0 !important;}' +
            'body.wdp-phone ' + S + '.menu-btn{width:auto !important;margin:0 !important;white-space:nowrap !important;padding:10px 14px !important;}' +
            'body.wdp-phone ' + S + '.menu-btn:hover{transform:none !important;}' +
        '}';
        document.head.appendChild(st);
    }

    // ---------- top block: greeting + hero + sell button ----------
    function decorate() {
        var ws = $('workspace-content');
        if (!ws || !$('wdv-summary-cards') || $('wdp-top')) return;
        addStyles();

        var h2 = ws.querySelector('h2');
        if (h2) {
            h2.style.display = 'none';
            var p = h2.nextElementSibling;
            if (p && p.tagName === 'P') p.style.display = 'none';
        }

        var now = new Date(), h = now.getHours();
        var hi = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
        var who = (typeof currentStaffName !== 'undefined' && currentStaffName) ? ', ' + esc(String(currentStaffName).split(' ')[0]) : '';
        var dateStr = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

        var box = document.createElement('div');
        box.id = 'wdp-top';
        box.className = 'wdp';
        box.innerHTML =
            '<div class="wdp-hi">' + hi + who + ' 👋</div>' +
            '<div class="wdp-date">' + esc(dateStr) + '</div>' +
            '<div class="wdp-hero" id="wdp-hero">' +
                '<div class="wdp-hero-label">Today\'s phone sales</div>' +
                '<div class="wdp-hero-amt" id="wdp-rev">₦0</div>' +
                '<div class="wdp-grid">' +
                    '<div><b id="wdp-units">0</b><span>Phones sold</span></div>' +
                    '<div><b id="wdp-recv">₦0</b><span>Money received</span></div>' +
                    (isAdmin() ? '<div><b id="wdp-profit">₦0</b><span>Profit</span></div>' : '') +
                    '<div><b id="wdp-owed">₦0</b><span>Customers owe you</span></div>' +
                '</div>' +
            '</div>' +
            '<button class="wdp-cta" onclick="wdpOpenSellPicker()">💰 Sell a Phone</button>';
        ws.insertBefore(box, $('wdv-summary-cards'));
        updateHero();
    }

    function updateHero() {
        updateBadge();
        if (!$('wdp-rev')) return;
        var sales = (typeof wdxSaleList === 'function') ? wdxSaleList() : [];
        var today = (typeof wdsToday === 'function') ? wdsToday() : '';
        var localDate = (typeof wdxLocalDate === 'function') ? wdxLocalDate : function (v) { return String(v || '').slice(0, 10); };

        var units = 0, value = 0, profit = 0, recv = 0, owed = 0;
        sales.forEach(function (s) {
            if (!s.refunded && localDate(s.soldAt) === today) { units++; value += num(s.price); profit += num(s.profit); }
            var pays = (typeof wdxPayments === 'function') ? wdxPayments(s) : [];
            pays.forEach(function (pm) { if (localDate(pm.at) === today) recv += num(pm.amount); });
            if (s.refunded && s.refunded.at && localDate(s.refunded.at) === today) recv -= num(s.refunded.amount);
            var bal = (typeof wdxSaleBalance === 'function') ? wdxSaleBalance(s) : num(s.balance);
            if (bal > 0) owed += bal;
        });
        var set = function (id, v) { var e = $(id); if (e && e.textContent !== v) e.textContent = v; };
        set('wdp-rev', money(value));
        set('wdp-units', String(units));
        set('wdp-recv', money(recv));
        set('wdp-profit', money(profit));
        set('wdp-owed', money(owed));
    }

    function updateBadge() {
        var b = $('wdp-sb-debt-badge');
        if (!b) return;
        var n = (typeof wdxSaleList === 'function' && typeof wdxSaleBalance === 'function')
            ? wdxSaleList().filter(function (s) { return wdxSaleBalance(s) > 0; }).length : 0;
        var txt = n > 0 ? String(n) : '';
        if (b.textContent !== txt) b.textContent = txt;
        var d = n > 0 ? 'inline-block' : 'none';
        if (b.style.display !== d) b.style.display = d;
    }

    // keep the hero fresh whenever the phone patches refresh their summary
    var origSummary = window.wdvRenderSummary;
    if (typeof origSummary === 'function') {
        window.wdvRenderSummary = function () {
            var r = origSummary.apply(this, arguments);
            try { updateHero(); } catch (e) {}
            return r;
        };
    }
    // build the top block each time the phone screen is opened
    var origShow = window.wdvShowInventory;
    if (typeof origShow === 'function') {
        window.wdvShowInventory = function () {
            var r = origShow.apply(this, arguments);
            try { decorate(); } catch (e) { console.warn('[phone-dashboard]', e); }
            return r;
        };
    }

    // ---------- Sell a Phone: searchable list of phones in stock ----------
    window.wdpOpenSellPicker = function () {
        if (typeof wdsModal !== 'function') { alert('Phone sales are not loaded yet.'); return; }
        wdsModal('💰 Sell a Phone',
            '<input id="wdp-pick-q" type="text" placeholder="🔍 Search model or IMEI…" oninput="wdpRenderPicker()" style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;">' +
            '<div id="wdp-pick-list" style="max-height:60vh;overflow-y:auto;margin-top:10px;"></div>', 520);
        wdpRenderPicker();
        setTimeout(function () { var i = $('wdp-pick-q'); if (i) i.focus(); }, 120);
    };

    window.wdpRenderPicker = function () {
        var box = $('wdp-pick-list'); if (!box) return;
        var q = (($('wdp-pick-q') || {}).value || '').toLowerCase().trim();
        var phones = (typeof wdvPhones !== 'undefined') ? wdvPhones : {};
        var rows = Object.keys(phones).map(function (id) { return Object.assign({ _id: id }, phones[id]); })
            .filter(function (p) {
                if (p.status !== 'in_stock') return false;
                if (!q) return true;
                return ((p.imei || '') + ' ' + (p.imei2 || '') + ' ' + (p.brand || '') + ' ' + (p.model || '') + ' ' + (p.storage || '') + ' ' + (p.color || '')).toLowerCase().indexOf(q) !== -1;
            })
            .sort(function (a, b) { return String(a.brand + a.model).localeCompare(String(b.brand + b.model)); });
        if (rows.length === 0) {
            box.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px;font-size:13px;">' + (q ? 'No phone in stock matches that.' : 'No phones in stock. Add a phone first.') + '</div>';
            return;
        }
        box.innerHTML = rows.slice(0, 40).map(function (p) {
            var spec = [p.storage, p.color, p.condition].filter(Boolean).join(' · ');
            return '<div class="wdp-pick" onclick="wdsOpenSellModal(\'' + esc(p._id) + '\')">' +
                '<div><b>' + esc(p.brand || '') + ' ' + esc(p.model || '') + '</b><small>' + esc(spec) + (spec ? ' · ' : '') + 'IMEI …' + esc(String(p.imei || '').slice(-6)) + '</small></div>' +
                '<div class="p">' + money(p.sellingPrice) + '</div></div>';
        }).join('') + (rows.length > 40 ? '<div style="text-align:center;color:#94a3b8;font-size:12px;padding:8px;">Showing 40 of ' + rows.length + '. Type to narrow it down.</div>' : '');
    };

    // ---------- sidebar buttons for the phone tools ----------
    var BTNS = [
        { id: 'wdp-sb-reports',  html: '📈 Phone Reports',  fn: 'wdxOpenReports',           manage: true },
        { id: 'wdp-sb-debtors',  html: '💵 Who Owes Me<span id="wdp-sb-debt-badge" class="wdp-badge"></span>', fn: 'wdxOpenDebtors', manage: true },
        { id: 'wdp-sb-warranty', html: '🛡 Warranty Check', fn: 'wdxOpenWarranty',          manage: false },
        { id: 'wdp-sb-repairs',  html: '🔧 Phone Repairs',        fn: 'wdxOpenRepairs',           manage: true },
        { id: 'wdp-sb-history',  html: '📜 Phone Sales History',  fn: 'wdsOpenSalesHistoryModal', manage: true },
        { id: 'wdp-sb-stock',    html: '🔄 Adjust Phone Stock',   fn: 'wdsOpenAdjustStockModal',  manage: true }
    ];

    function attachSidebar() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        var phoneBtn = $('wdv-sidebar-phone-btn');
        var on = !!(side && phoneBtn && isPhoneStore());

        if (document.body && document.body.classList.contains('wdp-phone') !== on) document.body.classList.toggle('wdp-phone', on);

        if (!on) {
            BTNS.forEach(function (b) { var e = $(b.id); if (e) e.remove(); });
            return;
        }
        addStyles();
        var manage = canManage();
        var prev = phoneBtn;
        BTNS.forEach(function (b) {
            var el = $(b.id);
            var show = b.manage ? manage : true;
            if (!show) { if (el) el.remove(); return; }
            if (!el) {
                el = document.createElement('button');
                el.id = b.id;
                el.className = 'menu-btn wdp-sb';
                el.innerHTML = b.html;
                el.onclick = function () { if (typeof window[b.fn] === 'function') window[b.fn](); };
            }
            if (prev.nextSibling !== el) prev.parentNode.insertBefore(el, prev.nextSibling);
            prev = el;
        });
        updateBadge();
    }


    // ---------- phone vendors never see the regular (grocery) inventory ----------
    // If anything tries to open the regular Inventory screen in a phone vendor store,
    // the phone inventory opens instead.
    var origSwitchView = window.switchView;
    if (typeof origSwitchView === 'function') {
        window.switchView = function (id) {
            try {
                if (id === 'inventory-view' && isPhoneStore() && typeof window.wdvShowInventory === 'function') {
                    window.wdvShowInventory();
                    return;
                }
            } catch (e) { console.warn('[phone-dashboard]', e); }
            return origSwitchView.apply(this, arguments);
        };
    }

    function tick() {
        try { attachSidebar(); decorate(); } catch (e) { console.warn('[phone-dashboard]', e); }
    }
    window.addEventListener('load', function () {
        setTimeout(tick, 1400);
        var busy = false;
        var obs = new MutationObserver(function () {
            if (busy) return; busy = true;
            setTimeout(function () { busy = false; tick(); }, 150);
        });
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    });
})();
