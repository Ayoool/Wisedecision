// ==================== WISE DECISION MATERIALS: SIMPLE PROFESSIONAL THEME (v2) ====================
// Load LAST (after materials-dashboard-patch.js, sidebar-colors-patch.js, daily-summary-patch.js and the other patches).
// Updated to match the clean, professional Indigo/Purple UI with bold typography.

console.log("Wise Decision materials-simple-theme-patch.js — v2 loaded");

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
    var NAVY = '#0f172a'; // Dark Slate for text
    var BLUE = '#4f46e5'; // Indigo (Matching the image)
    var PURPLE = '#7c3aed'; // Violet gradient end
    var BG = '#f8fafc'; // Light background


    function globalCss() {
        var P = 'body.wdd-mat ', WS = P + '#workspace-content', MD = P + '[id$="-modal"]';
        var both = function (rule) { return WS + ' ' + rule + ',' + MD + ' ' + rule; };
        var BTN = ['btn-action-primary', 'btn-dash', 'btn-pos', 'btn-inv', 'btn-acc', 'btn-rep', 'btn-exp', 'btn-staff', 'btn-cust', 'btn-supplier', 'btn-transfer', 'btn-branch', 'btn-sec', 'btn-subscription'];
        var blueSel = BTN.map(function (c) { return both('.menu-btn.' + c); }).join(',');
        var blueHov = BTN.map(function (c) { return both('.menu-btn.' + c + ':hover'); }).join(',');
        var TXT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([readonly]),select,textarea';
        var fld = TXT.split(',').map(function (t) { return both(t); }).join(',');
        var fldF = TXT.split(',').map(function (t) { return both(t.replace(/^select$|^textarea$/, function (m) { return m; }) + ':focus'); }).join(',');
        
        return '' +
        P + '{--accent:' + BLUE + ';--primary:' + BLUE + ';--brand:' + BLUE + ';}' +
        // Page background
        P + '.main-content-area,' + P + '.dashboard-layout{background:' + BG + ' !important;}' +
        
        // BOLD TYPOGRAPHY
        WS + ' h2, ' + WS + ' h3{color:' + NAVY + ' !important;font-weight:800 !important;letter-spacing:-.5px;}' +
        WS + ' td, ' + WS + ' p {font-weight:500; color:#334155;}' +
        
        // Tinted / gradient cards become clean white cards
        WS + ' [style*="linear-gradient"]{background:#fff !important;border:1px solid #e2e8f0 !important;box-shadow:0 4px 6px -1px rgba(0,0,0,.05) !important; border-radius:16px !important;}' +
        WS + ' [style*="linear-gradient"] *{color:' + NAVY + ' !important;}' +
        
        // Tables
        WS + ' table th{background:#f8fafc !important;color:#475569 !important;font-size:12px !important;text-transform:uppercase;letter-spacing:.5px;font-weight:800 !important;border-bottom:2px solid #e2e8f0 !important;padding:12px;}' +
        WS + ' table td{border-bottom:1px solid #f1f5f9 !important;font-weight:600 !important; padding:12px;}' +
        WS + ' table tbody tr:hover td{background:#f8fafc !important;}' +
        
        // Buttons (Pill shaped, matching the image)
        blueSel + '{background:' + BLUE + ' !important;border:1px solid ' + BLUE + ' !important;color:#fff !important;box-shadow:none !important;filter:none !important;border-radius:8px !important;font-weight:700 !important;}' +
        blueHov + '{background:#4338ca !important;}' +
        both('.menu-btn.btn-logout') + '{background:#fff !important;border:1px solid #cbd5e1 !important;color:#334155 !important;box-shadow:none !important;border-radius:8px !important;font-weight:700 !important;}' +
        both('.menu-btn.btn-logout:hover') + '{background:#f1f5f9 !important;}' +
        
        // POS toggles
        WS + ' [style*="background: rgb(124, 58, 237)"],' + WS + ' [style*="background:#7c3aed"],' + WS + ' [style*="background: #7c3aed"],' +
        WS + ' [style*="background: rgb(2, 132, 199)"],' + WS + ' [style*="background:#0284c7"],' + WS + ' [style*="background: #0284c7"]{background:' + BLUE + ' !important;color:#fff !important;}' +
        
        // Inputs
        fld + '{border:1px solid #cbd5e1 !important;border-radius:8px !important;background:#fff !important;color:' + NAVY + ' !important;font-weight:600 !important;}' +
        fldF + '{border-color:' + BLUE + ' !important;box-shadow:0 0 0 3px rgba(79,70,229,.15) !important;outline:none !important;}' +
        
        // Pop-ups
        MD + ' > div{border:none !important;border-radius:20px !important;box-shadow:0 20px 40px rgba(15,23,42,.2) !important;}' +
        WS + ' span[style*="var(--accent)"]{color:' + BLUE + ' !important;}';
    }

    function addCss() {
        if ($('wds-css')) return;
        var W = 'body.wdd-mat #dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper'; 
        var st = document.createElement('style');
        st.id = 'wds-css';
        st.textContent =
        // ---------- Sidebar: WHITE & CLEAN (Matching Top Nav in image) ----------
        W + ' .sidebar{background:#ffffff !important;border-right:1px solid #e2e8f0 !important;border-bottom-color:transparent !important;box-shadow:0 4px 6px -1px rgba(0,0,0,.02) !important;}' +
        W + ' .sidebar::-webkit-scrollbar-thumb{background:#cbd5e1 !important;}' +
        W + ' .sidebar #dashboard-store-title{color:' + NAVY + ' !important;font-weight:900 !important;letter-spacing:-.3px;}' +
        W + ' .sidebar #user-role-label{color:#64748b !important;font-weight:600 !important;}' +
        W + ' .sidebar #branch-badge-container span,' + W + ' .sidebar #branch-badge-container select,' + W + ' .sidebar #branch-badge-container label{background:#f1f5f9 !important;color:#334155 !important;border:1px solid #e2e8f0 !important;border-radius:8px !important;font-weight:700 !important;}' +
        
        // Sidebar Buttons (Menu items)
        W + ' .sidebar .menu-btn{background:transparent !important;color:#475569 !important;border:none !important;border-radius:10px !important;font-weight:700 !important;margin-bottom:2px;box-shadow:none !important;filter:none !important;transform:none !important;transition:all .2s;}' +
        W + ' .sidebar .menu-btn:hover{background:#f8fafc !important;color:' + NAVY + ' !important;transform:none !important;}' +
        W + ' .sidebar .menu-btn.wds-on{background:#eef2ff !important;color:' + BLUE + ' !important;}' +
        W + ' .sidebar .menu-btn .wds-ic{display:inline-block;margin-right:4px;filter:grayscale(1) opacity(0.7);}' +
        W + ' .sidebar .menu-btn.wds-on .wds-ic{filter:none;}' +
        
        // ---------- DASHBOARD ----------
        '.wds{max-width:1000px;margin:0 auto;color:' + NAVY + ';font-family:inherit;}' +
        '.wds *{box-sizing:border-box;}' +
        '.wds-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px;}' +
        '.wds-title{font-size:26px;font-weight:900;letter-spacing:-.5px;}' +
        '.wds-date{font-size:13px;color:#64748b;font-weight:600;margin-top:2px;}' +
        '.wds-btns{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
        '.wds-upd{font-size:12px;color:#64748b;font-weight:600;}' +
        
        // Buttons
        '.wds-btn{border:1px solid #cbd5e1;background:#fff;color:' + NAVY + ';border-radius:10px;padding:10px 16px;font-weight:800;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all 0.2s;}' +
        '.wds-btn:hover{background:#f8fafc;}' +
        '.wds-btn.pri{background:' + BLUE + ';border-color:' + BLUE + ';color:#fff;}' +
        '.wds-btn.pri:hover{background:#4338ca;box-shadow:0 4px 12px rgba(79,70,229,.3);}' +
        
        // Hero Banner (Matches Estimated Net Worth)
        '.wds-spin{display:inline-block;}' +
        '.wds-busy .wds-spin{animation:wds-rot .8s linear infinite;}' +
        '@keyframes wds-rot{to{transform:rotate(360deg);}}' +
        '.wds-hero{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;align-items:center;background:linear-gradient(135deg,' + BLUE + ' 0%,' + PURPLE + ' 100%);color:#fff;border-radius:20px;padding:30px 36px;box-shadow:0 10px 25px -5px rgba(79,70,229,.4);margin-bottom:16px;}' +
        '.wds-hl{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.8);}' +
        '.wds-ha{font-size:48px;font-weight:900;line-height:1.1;margin:6px 0 8px;letter-spacing:-1.5px;}' +
        '.wds-hs{font-size:14px;color:rgba(255,255,255,0.9);font-weight:600;}' +
        '.wds-bars{display:flex;align-items:flex-end;gap:8px;height:80px;min-width:200px;flex:0 1 280px;}' +
        '.wds-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;}' +
        '.wds-bar i{display:block;width:100%;border-radius:6px 6px 0 0;background:rgba(255,255,255,.2);min-height:4px;}' +
        '.wds-bar.t i{background:#fff;}' +
        '.wds-bar small{font-size:11px;color:rgba(255,255,255,0.8);margin-top:6px;font-weight:700;}' +
        
        // Stat Tiles (Matches the 4 white cards in image)
        '.wds-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px;}' +
        '.wds-tile{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;cursor:pointer;transition:all .2s;box-shadow:0 2px 4px rgba(15,23,42,.02);}' +
        '.wds-tile:hover{border-color:#a5b4fc;box-shadow:0 10px 20px -5px rgba(79,70,229,.1);transform:translateY(-2px);}' +
        '.wds-tl{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#64748b;}' +
        '.wds-tv{font-size:32px;font-weight:900;margin-top:8px;color:' + NAVY + ';letter-spacing:-.5px;}' +
        '.wds-ts{font-size:12px;color:#64748b;margin-top:4px;font-weight:600;}' +
        
        // Recent Sales Card
        '.wds-card{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:8px 24px 16px;box-shadow:0 4px 6px -1px rgba(0,0,0,.02);}' +
        '.wds-ch{display:flex;justify-content:space-between;align-items:center;padding:16px 0 12px;}' +
        '.wds-ch h3{margin:0;font-size:18px;font-weight:900;color:' + NAVY + ';}' +
        '.wds-link{background:none;border:none;color:' + BLUE + ';font-weight:800;font-size:13px;cursor:pointer;padding:0;}' +
        '.wds-row{display:flex;align-items:center;gap:16px;padding:14px 0;border-top:1px solid #f1f5f9;cursor:pointer;}' +
        '.wds-row:hover .wds-rt{color:' + BLUE + ';}' +
        '.wds-ic2{width:44px;height:44px;border-radius:12px;background:#eef2ff;color:' + BLUE + ';display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;flex-shrink:0;}' +
        '.wds-rm{flex:1;min-width:0;}' +
        '.wds-rt{font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:' + NAVY + ';transition:color 0.2s;}' +
        '.wds-rs{font-size:13px;color:#64748b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;}' +
        '.wds-ra{text-align:right;flex-shrink:0;}' +
        '.wds-rv{font-weight:900;font-size:18px;color:' + NAVY + ';}' +
        '.wds-pill{display:inline-block;font-size:11px;font-weight:800;padding:4px 10px;border-radius:99px;background:#dcfce7;color:#166534;margin-top:4px;}' +
        '.wds-pill.off{background:#fee2e2;color:#991b1b;}' +
        '.wds-empty{text-align:center;color:#94a3b8;padding:32px 8px;font-size:14px;font-weight:600;border-top:1px solid #f1f5f9;}' +
        '@media (max-width:600px){.wds-ha{font-size:40px;}.wds-bars{flex:1 1 100%;}.wds-hero{padding:24px;}}' + globalCss();
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
            
            // HERO BANNER (Matches the big purple box)
            '<div class="wds-hero"><div><div class="wds-hl">Total sales today</div><div class="wds-ha" id="wds-today">₦0</div><div class="wds-hs" id="wds-today-sub">Loading…</div></div>' +
                '<div class="wds-bars" id="wds-bars"></div></div>' +
            
            // WHITE STAT CARDS
            '<div class="wds-tiles">' +
                '<div class="wds-tile" onclick="switchView(\'reports-view\')"><div class="wds-tl">This month</div><div class="wds-tv" id="wds-month">₦0</div><div class="wds-ts">Sales so far this month</div></div>' +
                '<div class="wds-tile" onclick="wdsOpenOwed()"><div class="wds-tl">Owed to you</div><div class="wds-tv" id="wds-owed">₦0</div><div class="wds-ts" id="wds-owed-s">Credit book</div></div>' +
                '<div class="wds-tile" onclick="wdsOpenLow()"><div class="wds-tl">Low stock</div><div class="wds-tv" id="wds-low">0</div><div class="wds-ts">Items to reorder</div></div>' +
            '</div>' +
            
            // RECENT SALES LIST
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
