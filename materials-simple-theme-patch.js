// ==================== WISE DECISION MATERIALS: NAVY & ORANGE PRO THEME (v6) ====================
// Matches the high-end POS interface with White Sidebar, Navy Buttons, and Clean White background.

console.log("Wise Decision materials-simple-theme-patch.js — v6 (White Sidebar, Navy Buttons) loaded");

(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function num(n) { return Number(n) || 0; }
    function money(n) { n = Math.round(num(n)); return (window.formatMoney ? window.formatMoney(n) : '₦' + n.toLocaleString()); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }
    function role() { return (typeof currentUserRole !== 'undefined') ? String(currentUserRole) : ''; }
    function isAdmin() { return role().toLowerCase() === 'admin'; }
    function timeout(p, ms) {
        return new Promise(function (res, rej) {
            var t = setTimeout(function () { rej(new Error('The connection is slow. Please try again.')); }, ms);
            p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
        });
    }

    // =====================================================================
    // STYLES
    // =====================================================================
    var NAVY = '#0b1b3a';     // Dark Navy
    var ORANGE = '#ea580c';   // Bright Orange
    var BG = '#f0f4f8';       // Very light blue-grey background
    var WHITE = '#ffffff';

    function globalCss() {
        var P = 'body.wdd-mat ', WS = P + '#workspace-content', MD = P + '[id$="-modal"]';
        var both = function (rule) { return WS + ' ' + rule + ',' + MD + ' ' + rule; };
        var BTN = ['btn-action-primary', 'btn-dash', 'btn-pos', 'btn-inv', 'btn-acc', 'btn-rep', 'btn-exp', 'btn-staff', 'btn-cust', 'btn-supplier', 'btn-transfer', 'btn-branch', 'btn-sec', 'btn-subscription'];
        var blueSel = BTN.map(function (c) { return both('.menu-btn.' + c); }).join(',');
        var blueHov = BTN.map(function (c) { return both('.menu-btn.' + c + ':hover'); }).join(',');
        var TXT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([readonly]),select,textarea';
        var fld = TXT.split(',').map(function (t) { return both(t); }).join(',');
        var fldF = TXT.split(',').map(function (t) { return both(t + ':focus'); }).join(',');
        
        return '' +
        P + '{--accent:' + NAVY + ';--primary:' + NAVY + ';--brand:' + NAVY + ';}' +
        
        // Page background
        P + '.main-content-area,' + P + '.dashboard-layout{background:' + BG + ' !important;}' +
        
        // BOLD TYPOGRAPHY
        WS + ' h2, ' + WS + ' h3{color:' + NAVY + ' !important;font-weight:900 !important;letter-spacing:-.5px;}' +
        WS + ' td, ' + WS + ' p, ' + WS + ' label {font-weight:600; color:#334155;}' +
        
        // Tinted / gradient cards become clean white cards
        WS + ' [style*="linear-gradient"]{background:' + WHITE + ' !important;border:1px solid #e2e8f0 !important;box-shadow:0 4px 6px -1px rgba(0,0,0,.05) !important; border-radius:20px !important;}' +
        WS + ' [style*="linear-gradient"] *{color:' + NAVY + ' !important;}' +
        
        // Tables
        WS + ' table th{background:' + BG + ' !important;color:' + NAVY + ' !important;font-size:12px !important;text-transform:uppercase;letter-spacing:.5px;font-weight:900 !important;border-bottom:2px solid #e2e8f0 !important;padding:12px;}' +
        WS + ' table td{border-bottom:1px solid #f1f5f9 !important;font-weight:600 !important; padding:12px;}' +
        WS + ' table tbody tr:hover td{background:#f8fafc !important;}' +
        
        // Primary Buttons (Navy)
        blueSel + '{background:' + NAVY + ' !important;border:1px solid ' + NAVY + ' !important;color:' + WHITE + ' !important;box-shadow:none !important;filter:none !important;border-radius:10px !important;font-weight:800 !important;}' +
        blueHov + '{background:#1e3a8a !important;}' +
        both('.menu-btn.btn-logout') + '{background:' + WHITE + ' !important;border:1px solid #cbd5e1 !important;color:' + NAVY + ' !important;box-shadow:none !important;border-radius:10px !important;font-weight:800 !important;}' +
        
        // Orange Action Buttons (e.g., Pay, Print, Highlighted Tabs)
        WS + ' .btn-pay, ' + WS + ' .btn-orange, ' + WS + ' .btn-credit, ' +
        WS + ' [style*="background: rgb(249, 115, 22)"],' + WS + ' [style*="background:#f97316"],' +
        WS + ' [style*="background: rgb(234, 88, 12)"],' + WS + ' [style*="background:#ea580c"] { ' +
        'background: ' + ORANGE + ' !important; border-color: ' + ORANGE + ' !important; color: ' + WHITE + ' !important; font-weight: 800 !important; box-shadow: 0 4px 12px rgba(234,88,12,.3) !important; border-radius: 10px !important; }' +

        // POS Toggles (Retail/Piece etc) - Active state should be Navy
        WS + ' [style*="background: rgb(124, 58, 237)"],' + WS + ' [style*="background:#7c3aed"],' +
        WS + ' [style*="background: rgb(2, 132, 199)"],' + WS + ' [style*="background:#0284c7"] { ' +
        'background: ' + NAVY + ' !important; color: ' + WHITE + ' !important; border-radius: 10px !important; font-weight: 800 !important; }' +

        // Inputs
        fld + '{border:1px solid #cbd5e1 !important;border-radius:10px !important;background:' + WHITE + ' !important;color:' + NAVY + ' !important;font-weight:600 !important;padding:10px 14px !important;}' +
        fldF + '{border-color:' + ORANGE + ' !important;box-shadow:0 0 0 3px rgba(234,88,12,.15) !important;outline:none !important;}' +
        
        // Pop-ups
        MD + ' > div{border:none !important;border-radius:24px !important;box-shadow:0 24px 60px rgba(11,27,58,.3) !important;}' +
        WS + ' span[style*="var(--accent)"]{color:' + NAVY + ' !important;}';
    }

    function addCss() {
        if ($('wds-css')) return;
        var W = 'body.wdd-mat #dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper'; 
        var st = document.createElement('style');
        st.id = 'wds-css';
        st.textContent =
        
        // ---------- SIDEBAR: WHITE BACKGROUND, NAVY BUTTONS ----------
        W + ' .sidebar{background:#ffffff !important; border-right:1px solid #e2e8f0 !important; box-shadow:none !important;}' +
        W + ' .sidebar::-webkit-scrollbar-thumb{background:#cbd5e1 !important;}' +
        
        // Dark text for store name and user role
        W + ' .sidebar #dashboard-store-title{color:' + NAVY + ' !important;font-weight:900 !important;letter-spacing:.5px;}' +
        W + ' .sidebar #user-role-label{color:#475569 !important;font-weight:700 !important;}' +
        W + ' .sidebar #branch-badge-container span,' + W + ' .sidebar #branch-badge-container select,' + W + ' .sidebar #branch-badge-container label{background:#f1f5f9 !important;color:' + NAVY + ' !important;border:1px solid #cbd5e1 !important;border-radius:8px !important;font-weight:700 !important;}' +
        
        // Sidebar Menu Items (Uniform Navy Blue)
        W + ' .sidebar .menu-btn, ' + W + ' .sidebar .menu-btn.wds-on{background:' + NAVY + ' !important;color:' + WHITE + ' !important;border:1px solid ' + NAVY + ' !important;border-radius:12px !important;padding:12px 14px !important;margin:0 0 8px 0 !important;font-size:14px !important;font-weight:800 !important;text-align:left !important;box-shadow:0 4px 6px -1px rgba(0,0,0,.1) !important;transition:background .2s;transform:none !important;}' +
        
        // Hover state
        W + ' .sidebar .menu-btn:hover, ' + W + ' .sidebar .menu-btn.wds-on:hover{background:#1e3a8a !important;color:' + WHITE + ' !important;border-color:#1e3a8a !important;transform:none !important;}' +
        
        // Force active dashboard button to stay Navy (No Orange)
        W + ' .sidebar #wdm-sidebar-materials-btn, ' + W + ' .sidebar #wdm-sidebar-newsale-btn{background:' + NAVY + ' !important;color:' + WHITE + ' !important;border-color:' + NAVY + ' !important;box-shadow:0 4px 6px -1px rgba(0,0,0,.1) !important;}' +
        
        // White icons for navy buttons
        W + ' .sidebar .menu-btn .wds-ic{display:inline-block;margin-right:8px;filter:brightness(0) invert(1) !important;}' +
        
        // Logout button (White bg, red text)
        W + ' .sidebar .btn-logout{background:#ffffff !important;color:#b91c1c !important;border:1px solid #fecaca !important;box-shadow:none !important;}' +
        W + ' .sidebar .btn-logout:hover{background:#fef2f2 !important;border-color:#fca5a5 !important;}' +
        
        // ---------- DASHBOARD CONTENT ----------
        '.wds{max-width:1100px;margin:0 auto;color:' + NAVY + ';font-family:inherit;}' +
        '.wds *{box-sizing:border-box;}' +
        '.wds-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:24px;}' +
        '.wds-title{font-size:28px;font-weight:900;letter-spacing:-.5px;}' +
        '.wds-date{font-size:14px;color:#64748b;font-weight:600;margin-top:4px;}' +
        '.wds-btns{display:flex;gap:12px;align-items:center;flex-wrap:wrap;}' +
        '.wds-upd{font-size:12px;color:#64748b;font-weight:700;}' +
        
        // Dashboard Buttons
        '.wds-btn{border:1px solid #cbd5e1;background:' + WHITE + ';color:' + NAVY + ';border-radius:10px;padding:10px 18px;font-weight:800;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s;}' +
        '.wds-btn:hover{background:' + BG + ';}' +
        '.wds-btn.pri{background:' + NAVY + ';border-color:' + NAVY + ';color:' + WHITE + ';}' +
        '.wds-btn.pri:hover{background:#1e3a8a;box-shadow:0 4px 12px rgba(11,27,58,.3);}' +
        
        // Hero Banner (Navy with Orange Bars)
        '.wds-spin{display:inline-block;}' +
        '.wds-busy .wds-spin{animation:wds-rot .8s linear infinite;}' +
        '@keyframes wds-rot{to{transform:rotate(360deg);}}' +
        '.wds-hero{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;align-items:center;background:' + NAVY + ';color:' + WHITE + ';border-radius:24px;padding:36px;box-shadow:0 12px 30px -5px rgba(11,27,58,.3);margin-bottom:20px;position:relative;overflow:hidden;}' +
        '.wds-hero::after{content:"";position:absolute;right:-5%;top:-50%;width:300px;height:300px;background:rgba(234,88,12,.15);border-radius:50%;filter:blur(40px);}' +
        '.wds-hl{font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;}' +
        '.wds-ha{font-size:52px;font-weight:900;line-height:1.1;margin:8px 0 10px;letter-spacing:-1.5px;}' +
        '.wds-hs{font-size:15px;color:#cbd5e1;font-weight:600;}' +
        '.wds-bars{display:flex;align-items:flex-end;gap:8px;height:90px;min-width:220px;flex:0 1 300px;position:relative;z-index:2;}' +
        '.wds-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;}' +
        '.wds-bar i{display:block;width:100%;border-radius:6px 6px 0 0;background:rgba(255,255,255,.15);min-height:4px;}' +
        '.wds-bar.t i{background:' + ORANGE + ';box-shadow:0 0 15px rgba(234,88,12,.5);}' +
        '.wds-bar small{font-size:11px;color:#94a3b8;margin-top:8px;font-weight:800;}' +
        
        // Stat Tiles
        '.wds-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-bottom:24px;}' +
        '.wds-tile{background:' + WHITE + ';border:1px solid #e2e8f0;border-radius:20px;padding:24px;cursor:pointer;transition:all .2s;box-shadow:0 4px 6px -1px rgba(0,0,0,.03);}' +
        '.wds-tile:hover{border-color:' + NAVY + ';box-shadow:0 12px 25px -5px rgba(11,27,58,.1);transform:translateY(-3px);}' +
        '.wds-tl{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#64748b;}' +
        '.wds-tv{font-size:36px;font-weight:900;margin-top:10px;color:' + NAVY + ';letter-spacing:-1px;}' +
        '.wds-ts{font-size:13px;color:#64748b;margin-top:6px;font-weight:600;}' +
        
        // Recent Sales Card
        '.wds-card{background:' + WHITE + ';border:1px solid #e2e8f0;border-radius:24px;padding:10px 28px 20px;box-shadow:0 4px 6px -1px rgba(0,0,0,.03);}' +
        '.wds-ch{display:flex;justify-content:space-between;align-items:center;padding:20px 0 16px;}' +
        '.wds-ch h3{margin:0;font-size:20px;font-weight:900;color:' + NAVY + ';}' +
        '.wds-link{background:none;border:none;color:' + ORANGE + ';font-weight:800;font-size:14px;cursor:pointer;padding:0;}' +
        '.wds-row{display:flex;align-items:center;gap:16px;padding:16px 0;border-top:1px solid #f1f5f9;cursor:pointer;}' +
        '.wds-row:hover .wds-rt{color:' + ORANGE + ';}' +
        '.wds-ic2{width:48px;height:48px;border-radius:14px;background:#fff7ed;color:' + ORANGE + ';display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;flex-shrink:0;}' +
        '.wds-rm{flex:1;min-width:0;}' +
        '.wds-rt{font-weight:800;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' + NAVY + ';transition:color 0.2s;}' +
        '.wds-rs{font-size:13px;color:#64748b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;}' +
        '.wds-ra{text-align:right;flex-shrink:0;}' +
        '.wds-rv{font-weight:900;font-size:20px;color:' + NAVY + ';}' +
        '.wds-pill{display:inline-block;font-size:11px;font-weight:800;padding:4px 12px;border-radius:99px;background:#dcfce7;color:#166534;margin-top:6px;}' +
        '.wds-pill.off{background:#fee2e2;color:#991b1b;}' +
        '.wds-empty{text-align:center;color:#94a3b8;padding:40px 8px;font-size:15px;font-weight:600;border-top:1px solid #f1f5f9;}' +
        '@media (max-width:600px){.wds-ha{font-size:44px;}.wds-bars{flex:1 1 100%;}.wds-hero{padding:24px;}}' + globalCss();
        document.head.appendChild(st);
    }

    // =====================================================================
    // SIDEBAR: icons in one tone + which page is open
    // =====================================================================
    function wrapIcons() {
        if (!document.body.classList.contains('wdd-mat')) return;
        var re = /^(\s*)((?:\p{Extended_Pictographic}[\uFE0F\u200D]*)+)\s*/u;
        document.querySelectorAll('#dashboard-main-wrapper .sidebar .menu-btn').forEach(function (b) {
            if (b.querySelector('.wds-ic')) return;
            var n = b.firstChild;
            if (!n || n.nodeType !== 3) return;
            var m = re.exec(n.nodeValue);
            if (!m) return;
            var span = document.createElement('span');
            span.className = 'wds-ic';
            span.textContent = m[2];
            n.nodeValue = ' ' + n.nodeValue.slice(m[0].length);
            b.insertBefore(span, n);
        });
    }
    function setActive(btn) {
        document.querySelectorAll('#dashboard-main-wrapper .sidebar .menu-btn.wds-on').forEach(function (x) { x.classList.remove('wds-on'); });
        if (btn) btn.classList.add('wds-on');
    }
    document.addEventListener('click', function (e) {
        if (!isMat()) return;
        var b = e.target && e.target.closest ? e.target.closest('#dashboard-main-wrapper .sidebar .menu-btn') : null;
        if (!b || /logout\s*$/i.test((b.textContent || '').trim())) return;
        setActive(b);
    }, true);

    // =====================================================================
    // DASHBOARD
    // =====================================================================
    var timer = null, loading = false;

    window.wdmShowMaterialsDashboard = function () {
        if (typeof window.wdFullAccess === 'function' && !window.wdFullAccess()) return;
        var ws = $('workspace-content');
        if (!ws) return;
        addCss();
        var now = new Date();
        ws.innerHTML =
        '<div class="wds" id="wds">' +
            '<div class="wds-top"><div><div class="wds-title">Inventory Overview</div><div class="wds-date">' + esc(now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</div></div>' +
            '<div class="wds-btns"><span class="wds-upd" id="wds-upd"></span>' +
                '<button class="wds-btn" id="wds-refresh" onclick="wdsRefresh()"><span class="wds-spin">↻</span> Refresh</button>' +
                '<button class="wds-btn pri" onclick="switchView(\'pos-view\')">+ New Sale</button></div></div>' +
            
            '<div class="wds-hero"><div><div class="wds-hl">Total sales today</div><div class="wds-ha" id="wds-today">₦0</div><div class="wds-hs" id="wds-today-sub">Loading…</div></div>' +
                '<div class="wds-bars" id="wds-bars"></div></div>' +
            
            '<div class="wds-tiles">' +
                '<div class="wds-tile" onclick="switchView(\'reports-view\')"><div class="wds-tl">This month</div><div class="wds-tv" id="wds-month">₦0</div><div class="wds-ts">Sales so far this month</div></div>' +
                '<div class="wds-tile" onclick="wdsOpenOwed()"><div class="wds-tl">Owed to you</div><div class="wds-tv" id="wds-owed">₦0</div><div class="wds-ts" id="wds-owed-s">Credit book</div></div>' +
                '<div class="wds-tile" onclick="wdsOpenLow()"><div class="wds-tl">Low stock</div><div class="wds-tv" id="wds-low">0</div><div class="wds-ts">Items to reorder</div></div>' +
            '</div>' +
            
            '<div class="wds-card"><div class="wds-ch"><h3>Recent sales</h3><button class="wds-link" onclick="switchView(\'reports-view\')">View all ›</button></div><div id="wds-recent"><div class="wds-empty">Loading…</div></div></div>' +
        '</div>';
        setActive($('wdm-sidebar-materials-btn'));
        load();
        if (timer) clearInterval(timer);
        timer = setInterval(function () { if ($('wds') && !document.hidden) load(); else if (!$('wds')) { clearInterval(timer); timer = null; } }, 60000);
    };

    window.wdsRefresh = function () { load(); };
    window.wdsOpenOwed = function () { if (typeof wcrShowCreditBook === 'function') wcrShowCreditBook(); else switchView('customers-view'); };
    window.wdsOpenLow = function () { if (typeof wrqShowReorder === 'function') wrqShowReorder(); else switchView('inventory-view'); };
    window.wdsOpenSale = function (txId) { if (txId && typeof viewPastReceipt === 'function') viewPastReceipt(txId); };

    function busy(on) {
        var b = $('wds-refresh');
        if (b) { b.classList.toggle('wds-busy', !!on); b.disabled = !!on; }
    }

    async function load() {
        if (loading || !$('wds') || !sid()) return;
        loading = true; busy(true);
        try {
            var s = sid(), db = firebase.database(), base = 'stores/' + s, branch = (typeof currentBranch !== 'undefined' && currentBranch) ? currentBranch : 'main';
            var now = new Date();
            var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
            var from = new Date(Math.min(monthStart.getTime(), weekStart.getTime())); from.setHours(0, 0, 0, 0);

            var r = await timeout(Promise.all([
                db.ref(base + '/transactions').orderByChild('date').startAt(from.toISOString()).once('value'),
                db.ref(base + '/transactions').orderByChild('date').limitToLast(40).once('value'),
                db.ref(base + '/inventory/' + branch).once('value'),
                db.ref(base + '/matCredit').once('value').catch(function () { return null; })
            ]), 25000);

            var todayKey = now.toDateString();
            var days = [];
            for (var i = 6; i >= 0; i--) { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); days.push({ key: d.toDateString(), label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2), total: 0, today: i === 0 }); }

            var sToday = 0, nToday = 0, costToday = 0, haveCost = false, month = 0;
            r[0].forEach(function (c) {
                var tx = c.val();
                if (!tx || !tx.date || (tx.branchId || 'main') !== branch) return;
                var d = new Date(tx.date); if (isNaN(d)) return;
                var net = num(tx.totalAmount) - num(tx.refundedAmount);
                var dk = d.toDateString();
                if (dk === todayKey) {
                    sToday += net; nToday++;
                    (tx.items || []).forEach(function (it) { if (it && it.lineCost !== undefined && it.lineCost !== null) { haveCost = true; costToday += num(it.lineCost); } });
                }
                if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) month += net;
                days.forEach(function (x) { if (x.key === dk) x.total += net; });
            });

            var recent = [];
            r[1].forEach(function (c) { var tx = c.val(); if (tx && tx.date && (tx.branchId || 'main') === branch) recent.push(tx); });
            recent.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
            recent = recent.slice(0, 12);

            var low = 0;
            r[2].forEach(function (c) {
                var p = c.val(); if (!p || typeof p !== 'object') return;
                var stock = num(p.stock !== undefined ? p.stock : p.stockQty);
                var thr = (p.lowStockThreshold !== null && p.lowStockThreshold !== undefined) ? Number(p.lowStockThreshold) : 5;
                if (stock <= thr) low++;
            });

            var owed = 0, owedN = 0;
            if (r[3]) {
                r[3].forEach(function (c) {
                    var x = c.val(); if (!x) return;
                    var paid = 0; Object.keys(x.payments || {}).forEach(function (k) { paid += num(x.payments[k].amount); });
                    var bal = num(x.total) - paid; if (bal > 0) { owed += bal; owedN++; }
                });
            }

            // ---------- paint ----------
            if (!$('wds')) return;
            var set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
            set('wds-today', money(sToday));
            var sub = nToday + ' sale' + (nToday === 1 ? '' : 's') + (nToday ? ' · average ' + money(sToday / nToday) : '');
            if (isAdmin() && haveCost && nToday) sub += ' · profit ' + money(sToday - costToday);
            set('wds-today-sub', nToday ? sub : 'No sales yet today');
            set('wds-month', money(month));
            set('wds-owed', money(owed));
            set('wds-owed-s', owedN ? owedN + ' customer' + (owedN === 1 ? '' : 's') + ' owe you' : 'Nobody owes you');
            set('wds-low', String(low));

            var max = Math.max.apply(null, days.map(function (x) { return x.total; }).concat([1]));
            var bars = $('wds-bars');
            if (bars) bars.innerHTML = days.map(function (x) {
                return '<div class="wds-bar' + (x.today ? ' t' : '') + '" title="' + esc(money(x.total)) + '"><i style="height:' + Math.max(5, Math.round((x.total / max) * 100)) + '%"></i><small>' + esc(x.label) + '</small></div>';
            }).join('');

            var rec = $('wds-recent');
            if (rec) rec.innerHTML = recent.length === 0 ? '<div class="wds-empty">No sales yet. Tap “New Sale” to make the first one.</div>' :
                recent.map(function (tx) {
                    var net = num(tx.totalAmount);
                    var off = tx.refundStatus === 'Refunded' || tx.refundStatus === 'Partially Refunded';
                    var lab = tx.refundStatus === 'Refunded' ? 'Refunded' : (tx.refundStatus === 'Partially Refunded' ? 'Part refund' : 'Completed');
                    var d = new Date(tx.date);
                    var who = (tx.customerName && tx.customerName !== 'Walk-In Customer') ? tx.customerName : 'Walk-in customer';
                    var items = Array.isArray(tx.items) ? tx.items.filter(function (i) { return i && i.id !== '__delivery__'; }) : [];
                    var first = items[0] ? items[0].name + (items.length > 1 ? ' +' + (items.length - 1) + ' more' : '') : '';
                    return '<div class="wds-row" data-t="' + esc(tx.txId || '') + '" onclick="wdsOpenSale(this.dataset.t)">' +
                        '<div class="wds-ic2">₦</div>' +
                        '<div class="wds-rm"><div class="wds-rt">' + esc(first || tx.txId || 'Sale') + '</div><div class="wds-rs">' + esc(tx.txId || '') + ' · ' + esc(who) + ' · ' + esc(d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) + '</div></div>' +
                        '<div class="wds-ra"><div class="wds-rv">' + esc(money(net)) + '</div><span class="wds-pill' + (off ? ' off' : '') + '">' + lab + '</span></div></div>';
                }).join('');

            set('wds-upd', 'Updated ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
        } catch (e) {
            var rec2 = $('wds-recent');
            if (rec2) rec2.innerHTML = '<div class="wds-empty" style="color:#b91c1c;">Could not load: ' + esc(e.message || e) + '<br><button class="wds-btn" style="margin-top:10px;" onclick="wdsRefresh()">Try again</button></div>';
            var s2 = $('wds-today-sub'); if (s2) s2.textContent = 'Could not load';
        } finally {
            loading = false; busy(false);
        }
    }

    // =====================================================================
    // KEEP THE THEME APPLIED
    // =====================================================================
    function tick() { try { addCss(); wrapIcons(); } catch (e) { console.warn('[materials-theme]', e); } }
    window.addEventListener('load', function () { setTimeout(tick, 900); });
    var busyObs = false;
    var obs = new MutationObserver(function () { if (busyObs) return; busyObs = true; setTimeout(function () { busyObs = false; tick(); }, 150); });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function () { obs.observe(document.body, { childList: true, subtree: true }); });
    setInterval(tick, 3000);
})();
