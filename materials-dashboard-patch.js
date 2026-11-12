// ==================== WISE DECISION MATERIALS DASHBOARD REDESIGN (v7 - UNIFORM NAVY BUTTONS) ====================
// Load AFTER materials-patch.js and materials-polish-patch.js.

console.log("Wise Decision materials-dashboard-patch.js — v7 (Uniform Navy Buttons) loaded");

// Who gets the full back-office tools?
var WD_FULL_ACCESS_ROLES = ['admin', 'manager'];
window.wdFullAccess = function () {
    var r = (typeof currentUserRole !== 'undefined' && currentUserRole) ? String(currentUserRole).toLowerCase().trim() : '';
    return WD_FULL_ACCESS_ROLES.indexOf(r) !== -1;
};

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

    // ---------- styles ----------
    function addStyles() {
        if (document.getElementById('wdd-styles')) return;
        var st = document.createElement('style');
        st.id = 'wdd-styles';
        st.textContent =
        '.wdd{max-width:720px;margin:0 auto;color:#0b1b3a;font-family:inherit;}' +
        '.wdd *{box-sizing:border-box;}' +
        '.wdd-head{margin:0 0 14px 0;}' +
        '.wdd-hi{font-size:22px;font-weight:900;letter-spacing:-.3px;}' +
        '.wdd-date{font-size:13px;color:#64748b;margin-top:2px;font-weight:600;}' +
        
        // Hero Banner
        '.wdd-hero{background:#0b1b3a;color:#fff;border-radius:20px;padding:24px;margin-bottom:16px;box-shadow:0 10px 24px rgba(11,27,58,.28);position:relative;overflow:hidden;}' +
        '.wdd-hero::after{content:"";position:absolute;right:-10%;top:-50%;width:200px;height:200px;background:rgba(234,88,12,.15);border-radius:50%;filter:blur(30px);}' +
        '.wdd-hero-label{font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;font-weight:800;}' +
        '.wdd-hero-amt{font-size:42px;font-weight:900;margin:8px 0 20px 0;line-height:1.1;letter-spacing:-1px;}' +
        '.wdd-hero-row{display:flex;gap:12px;position:relative;z-index:2;}' +
        '.wdd-hero-row>div{flex:1;background:rgba(255,255,255,.08);border-radius:12px;padding:12px 14px;border:1px solid rgba(255,255,255,.1);}' +
        '.wdd-hero-row b{display:block;font-size:18px;font-weight:900;}' +
        '.wdd-hero-row span{font-size:11px;color:#cbd5e1;font-weight:600;}' +
        
        // Primary Action Button
        '.wdd-cta{width:100%;border:none;border-radius:14px;padding:18px;font-size:16px;font-weight:900;color:#fff;background:#ea580c;box-shadow:0 8px 18px rgba(234,88,12,.3);cursor:pointer;margin-bottom:16px;transition:background .2s;}' +
        '.wdd-cta:hover{background:#c2410c;}' +
        
        // Tiles & Cards
        '.wdd-tiles{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}' +
        '.wdd-tile{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;box-shadow:0 2px 4px rgba(0,0,0,.02);}' +
        '.wdd-tile small{display:block;font-size:12px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.5px;}' +
        '.wdd-tile b{display:block;font-size:22px;margin-top:6px;font-weight:900;letter-spacing:-.5px;}' +
        '.wdd-tile em{font-style:normal;font-size:11px;color:#94a3b8;font-weight:600;}' +
        
        '.wdd-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;}' +
        '.wdd-act{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;font-size:14px;font-weight:800;color:#0b1b3a;cursor:pointer;text-align:left;transition:all .2s;box-shadow:0 2px 4px rgba(0,0,0,.02);}' +
        '.wdd-act:hover{border-color:#ea580c;box-shadow:0 4px 12px rgba(234,88,12,.1);transform:translateY(-1px);}' +
        '.wdd-act span{font-size:20px;}' +
        
        '.wdd-card{background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:20px;margin-bottom:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,.03);}' +
        '.wdd-card-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}' +
        '.wdd-card-h h3{margin:0;font-size:16px;font-weight:900;}' +
        '.wdd-badge{font-size:11px;font-weight:800;padding:4px 10px;border-radius:99px;background:#fee2e2;color:#b91c1c;}' +
        '.wdd-badge.ok{background:#dcfce7;color:#166534;}' +
        
        '.wdd-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:600;}' +
        '.wdd-row:last-child{border-bottom:none;}' +
        '.wdd-sub{display:block;font-size:12px;color:#64748b;margin-top:2px;font-weight:500;}' +
        '.wdd-empty{font-size:14px;color:#94a3b8;padding:10px 0;font-weight:600;text-align:center;}' +
        
        '.wdd-bars{display:flex;align-items:flex-end;gap:8px;height:100px;padding-top:10px;}' +
        '.wdd-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;}' +
        '.wdd-bar i{display:block;width:100%;background:#e2e8f0;border-radius:6px 6px 0 0;min-height:4px;}' +
        '.wdd-bar.today i{background:#ea580c;box-shadow:0 0 10px rgba(234,88,12,.4);}' +
        '.wdd-bar small{font-size:11px;color:#64748b;margin-top:6px;font-weight:800;}';
        document.head.appendChild(st);
    }

    // ---------- screen ----------
    window.wdmShowMaterialsDashboard = function () {
        if (!window.wdFullAccess()) {
            if (typeof switchView === 'function') switchView('pos-view');
            return;
        }
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

            var max = Math.max.apply(null, last7.map(function (x) { return x.total; }).concat([1]));
            setHtml('wdd-bars', last7.map(function (x) {
                var pct = Math.round((x.total / max) * 100);
                return '<div class="wdd-bar' + (x.isToday ? ' today' : '') + '" title="' + esc(money(x.total)) + '"><i style="height:' + pct + '%"></i><small>' + esc(x.label) + '</small></div>';
            }).join(''));

            recent.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
            setHtml('wdd-recent', recent.length === 0
                ? '<div class="wdd-empty">No sales yet.</div>'
                : recent.slice(0, 8).map(function (r) {
                    return '<div class="wdd-row"><div><strong>' + esc(r.customer) + '</strong><span class="wdd-sub">' + esc(r.id) + ' · ' + esc(r.staff) + '</span></div>' +
                           '<div style="text-align:right;"><strong>' + money(r.total) + '</strong><span class="wdd-sub">' + new Date(r.date).toLocaleDateString() + '</span></div></div>';
                }).join(''));

            var top = Object.keys(sellers).map(function (k) { return { name: k, qty: sellers[k].qty, rev: sellers[k].rev }; })
                .sort(function (a, b) { return b.rev - a.rev; }).slice(0, 5);
            setHtml('wdd-top', top.length === 0
                ? '<div class="wdd-empty">No sales this week yet.</div>'
                : top.map(function (t, i) {
                    return '<div class="wdd-row"><span>' + (i + 1) + '. ' + esc(t.name) + '</span><strong style="color:#ea580c;">' + money(t.rev) + ' <span style="color:#64748b;font-weight:normal;font-size:11px;">×' + t.qty + '</span></strong></div>';
                }).join(''));
        } catch (e) {
            console.warn('[materials-dashboard-patch] load error:', e);
        }
    }
})();

// ==================== MATERIALS SIDEBAR RESTYLE (v7 - Uniform Navy Buttons) ====================
(function () {
    function addSidebarStyles() {
        if (document.getElementById('wdd-sidebar-styles')) return;
        var st = document.createElement('style');
        st.id = 'wdd-sidebar-styles';
        var S = 'body.wdd-mat #dashboard-main-wrapper .sidebar ';
        
        st.textContent =
        // 1. Sidebar Background: White
        S + '{background:#ffffff !important; border-right:1px solid #e2e8f0 !important;}' +
        
        // 2. Text Inside: Dark Navy
        S + '#dashboard-store-title {color:#0b1b3a !important;font-weight:900 !important;}' +
        S + '#user-role-label {color:#475569 !important;font-weight:700 !important;}' +
        S + '#branch-badge-container span, ' + S + '#branch-badge-container select, ' + S + '#branch-badge-container label {background:#f1f5f9 !important;color:#0b1b3a !important;border:1px solid #cbd5e1 !important;font-weight:700 !important;}' +
        
        // 3. Menu Buttons: Navy Blue Background, White Text (Uniform for ALL buttons)
        S + '.menu-btn, ' + S + '.menu-btn.wds-on {background:#0b1b3a !important;color:#ffffff !important;border:1px solid #0b1b3a !important;border-radius:12px !important;padding:12px 14px !important;margin:0 0 8px 0 !important;font-size:14px !important;font-weight:800 !important;text-align:left !important;box-shadow:0 4px 6px -1px rgba(0,0,0,.1) !important;transition:background .2s;}' +
        
        // Hover State
        S + '.menu-btn:hover {background:#1e3a8a !important;color:#ffffff !important;border-color:#1e3a8a !important;transform:translateY(-1px);}' +
        
        // 4. Force active buttons to stay Navy instead of Orange
        S + '#wdm-sidebar-materials-btn, ' + S + '#wdm-sidebar-newsale-btn {background:#0b1b3a !important;color:#ffffff !important;border-color:#0b1b3a !important;box-shadow:0 4px 6px -1px rgba(0,0,0,.1) !important;}' +
        S + '#wdm-sidebar-materials-btn:hover, ' + S + '#wdm-sidebar-newsale-btn:hover {background:#1e3a8a !important;color:#ffffff !important;}' +
        
        // 5. Icons: White inside the Navy buttons
        S + '.menu-btn .wds-ic {filter: brightness(0) invert(1) !important;}' +
        
        // 6. Logout Button: White background with Red text
        S + '.btn-logout {background:#ffffff !important;color:#b91c1c !important;border:1px solid #fecaca !important;box-shadow:none !important;}' +
        S + '.btn-logout:hover {background:#fef2f2 !important;border-color:#fca5a5 !important;}' +
        
        // Phones: swipeable row
        '@media (max-width:767px){' +
            'body.wdd-mat #dashboard-main-wrapper .sidebar{flex-direction:row !important;flex-wrap:nowrap !important;align-items:center !important;gap:8px !important;overflow-x:auto !important;overflow-y:hidden !important;padding:10px 12px !important;border-right:none !important;border-bottom:1px solid #e2e8f0 !important;box-shadow:none !important;position:sticky;top:0;z-index:20;-webkit-overflow-scrolling:touch;}' +
            'body.wdd-mat #dashboard-main-wrapper .sidebar > *{flex-shrink:0 !important;}' +
            S + '.menu-btn{width:auto !important;margin:0 !important;white-space:nowrap !important;padding:10px 14px !important;}' +
            S + '.menu-btn:hover{transform:none !important;}' +
        '}';
        document.head.appendChild(st);
    }

    var TAGS = [['report','reports'],['staff','staff'],['transfer','transfer'],['branch','branch'],['supplier','supplier'],['customer','customer'],['expense','expense'],['accountant','accountant']];
    function tagSidebarButtons() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        if (!side) return;
        side.querySelectorAll('button').forEach(function (b) {
            if (b.getAttribute('data-wdd')) return;
            var t = (b.textContent || '').toLowerCase();
            for (var i = 0; i < TAGS.length; i++) {
                if (t.indexOf(TAGS[i][0]) !== -1) { b.setAttribute('data-wdd', TAGS[i][1]); return; }
            }
        });
    }

    function syncSidebarClass() {
        if (!document.body) return;
        tagSidebarButtons();
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

// ==================== EXTRA SIDEBAR BUTTONS ====================
(function () {
    function $(id) { return document.getElementById(id); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }

    function addCss() {
        if ($('wdd-extra-side-css')) return;
        var S = 'body.wdd-mat #dashboard-main-wrapper .sidebar ';
        var st = document.createElement('style');
        st.id = 'wdd-extra-side-css';
        st.textContent =
            // Match the new Navy Button style
            S + '#wdd-sb-stock, ' + S + '#wdd-sb-common {background:#0b1b3a !important;color:#ffffff !important;border:1px solid #0b1b3a !important;box-shadow:0 4px 6px -1px rgba(0,0,0,.1) !important;}' +
            S + '#wdd-sb-stock:hover, ' + S + '#wdd-sb-common:hover {background:#1e3a8a !important;color:#ffffff !important;border-color:#1e3a8a !important;}';
        document.head.appendChild(st);
    }

    function make(id, text, fn, after) {
        if ($(id) || !after) return after;
        var b = document.createElement('button');
        b.id = id; b.className = 'menu-btn'; b.textContent = text; b.onclick = fn;
        after.parentNode.insertBefore(b, after.nextSibling);
        return b;
    }

    function attach() {
        try {
            var side = document.querySelector('#dashboard-main-wrapper .sidebar');
            if (!side) return;
            var admin = window.wdFullAccess() && sid() && sid() !== 'SUPER_ADMIN';
            if (!isMat() || !admin) {
                ['wdd-sb-stock', 'wdd-sb-common'].forEach(function (i) { var e = $(i); if (e) e.remove(); });
                return;
            }
            addCss();
            var anchor = $('wdm-sidebar-newsale-btn') || $('wdm-sidebar-materials-btn');
            if (!anchor) return;
            var a = make('wdd-sb-stock', '📦 Manage Stock', function () { switchView('inventory-view'); }, $('wdd-sb-stock') || anchor);
            if (!$('wdd-sb-common')) make('wdd-sb-common', '📚 Common Materials', function () { if (typeof wdpOpenQuickAddModal === 'function') wdpOpenQuickAddModal(); }, $('wdd-sb-stock') || a);
        } catch (e) { console.warn('[dashboard-patch sidebar]', e); }
    }

    window.addEventListener('load', function () {
        setTimeout(attach, 1300);
        var obs = new MutationObserver(function () { attach(); });
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    });
})();

// ==================== MANAGER LIMITS & STAFF RESTRICTIONS ====================
(function () {
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }
    function isStaff() { return isMat() && !window.wdFullAccess(); }
    function isManager() {
        var r = (typeof currentUserRole !== 'undefined' && currentUserRole) ? String(currentUserRole).toLowerCase().trim() : '';
        return r === 'manager';
    }
    function limited() { return isManager() && isMat(); }

    function info(b) { return ((b.textContent || '') + ' ' + (b.getAttribute('onclick') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase(); }
    function kind(b) {
        if (!b || b.closest('#wcq-modal, #wcr-modal, #wdd-add-modal, #wdp-quick-modal')) return null;
        var t = info(b);
        if (/(add|new|create)[^a-z]{0,6}(a\s+|another\s+)?(new\s+)?branch|branch[^a-z]{0,6}(add|new|create)|addbranch|createbranch|newbranch|savebranch/.test(t)) return 'branch';
        if (b.closest('#inventory-view') && (/delete|remove|🗑|trash/.test(t) || (b.textContent || '').trim().toLowerCase() === 'del')) return 'delete';
        return null;
    }

    // Restrict Sidebar for standard workers
    function restrictSidebar() {
        if (!isStaff()) return;
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        if (!side) return;
        side.querySelectorAll('.menu-btn').forEach(function (b) {
            var t = (b.textContent || '').toLowerCase();
            if (t.includes('new sale') || t.includes('pos') || b.classList.contains('btn-logout') || t.includes('logout')) {
                b.style.setProperty('display', '', 'important'); // Show
            } else {
                b.style.setProperty('display', 'none', 'important'); // Hide
            }
        });
    }

    // Hide button logic for managers
    function sweep() {
        if (!limited()) return;
        document.querySelectorAll('button, .menu-btn').forEach(function (b) {
            if (kind(b)) b.style.setProperty('display', 'none', 'important');
        });
    }

    // Redirect staff away from dashboard
    var originalShowDash = window.wdmShowMaterialsDashboard;
    window.wdmShowMaterialsDashboard = function () {
        if (isStaff()) {
            if (typeof switchView === 'function') switchView('pos-view');
            return;
        }
        if (originalShowDash) originalShowDash.apply(this, arguments);
    };

    // Filter POS sales to show only the staff member's own sales
    function filterSalesRows() {
        if (!isStaff()) return;
        var staffName = (typeof currentStaffName !== 'undefined' && currentStaffName) ? String(currentStaffName).toLowerCase().trim() : '';
        if (!staffName) return;
        var posView = document.getElementById('pos-view');
        if (!posView) return;
        posView.querySelectorAll('table tr, .history-item, .receipt-row').forEach(function (row) {
            if (row.querySelector('th')) return;
            var txt = (row.textContent || '').toLowerCase();
            if (txt.includes('staff:') || txt.includes('sold by:')) {
                if (!txt.includes(staffName)) row.style.setProperty('display', 'none', 'important');
                else row.style.setProperty('display', '', 'important');
            }
        });
    }

    document.addEventListener('click', function (ev) {
        if (!limited()) return;
        var b = ev.target && ev.target.closest ? ev.target.closest('button, .menu-btn') : null;
        var k = kind(b);
        if (!k) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        alert(k === 'branch' ? 'Only the owner can add a branch.' : 'Only the owner can delete inventory items.');
    }, true);

    window.addEventListener('load', function () {
        if (isStaff()) {
            setTimeout(function () { if (typeof switchView === 'function') switchView('pos-view'); }, 800);
        }
        setTimeout(sweep, 1200);

        var busy = false;
        var obs = new MutationObserver(function () {
            if (busy) return; busy = true;
            setTimeout(function () {
                busy = false;
                try { restrictSidebar(); filterSalesRows(); sweep(); } catch (e) {}
            }, 150);
        });
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });

        restrictSidebar();
        filterSalesRows();
    });
})();
