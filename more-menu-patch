// ==================== WISE DECISION "MORE" MENU (v1) ====================
// Load LAST (after modern-motion-patch.js). Works for EVERY store type.
//
// Adds a "More" button to the sidebar (above Logout). Tapping it pops out a panel of extra tools;
// choosing a tool (or tapping outside / the X / More again / Esc) closes it again.
//   * phones: slides up as a bottom sheet     * laptops: pops out beside the sidebar
//
// Starter tools (each one only shows when it can work, and only to the people allowed to use it):
//   Calculator ................. everyone
//   Reprint last receipt ....... owner / manager
//   Find a receipt ............. owner / manager (uses the existing receipt lookup)
//   Categories, Appearance ..... hardware + pharmacy stores with the new look (owner / manager)
//   Export stock (CSV) ......... owner / manager
//   Export sales, 30 days (CSV)  owner / manager
//   Chat with support .......... everyone, only if WM_SUPPORT_PHONE below is filled in
//
// It also tucks rarely-used sidebar buttons into More (owner / manager only; list = MOVE_TO_MORE below), so the
// sidebar is shorter. A moved button works exactly as before: choosing it in More clicks the original button.
//
// Read-only: nothing here writes to Firebase. To add a tool later, add one entry to ITEMS below.
// Building-materials STAFF still see only New Sale + Logout (their lock is respected: no More button).

console.log("Wise Decision more-menu-patch.js — v1 loaded");

(function () {
    'use strict';

    // Put your support WhatsApp number here, e.g. '2348012345678' (country code, no + or spaces). Empty = hidden.
    var WM_SUPPORT_PHONE = '2349168140710';

    // Sidebar buttons that are tucked away into More (owner / manager only). Matching is by the words on the button,
    // lower case. Add or remove words to change what moves. A moved button still works exactly as before.
    // Staff accounts are never changed. Leave the list empty ( [] ) to keep every button in the sidebar.
    var MOVE_TO_MORE = ['stock transfers', 'branches', 'shift log', 'customer orders', 'subscription', 'daily summary', 'staff board'];
    var MOVED_DESC = {
        'stock transfers': 'Move stock between branches', 'branches': 'Add and manage your branches', 'shift log': 'Who clocked in and out',
        'customer orders': 'Orders from your shop link', 'subscription': 'Your plan and renewal', 'daily summary': 'Send today’s summary',
        'staff board': 'See your top staff', 'business settings': 'Store profile and PIN', 'clock in': 'Start your shift'
    };

    // ---------- helpers ----------
    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function db() { return firebase.database(); }
    function fnOk(n) { return typeof window[n] === 'function'; }
    function full() {
        if (typeof window.wdFullAccess === 'function') return window.wdFullAccess();
        var r = (typeof currentUserRole !== 'undefined' && currentUserRole) ? String(currentUserRole).toLowerCase() : '';
        return r === 'admin' || r === 'manager';
    }
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }
    function phone() { return window.innerWidth <= 767; }
    var reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }

    // ---------- tiny message bar ----------
    function note(msg, bad) {
        var t = $('wm-more-toast');
        if (!t) { t = document.createElement('div'); t.id = 'wm-more-toast'; document.body.appendChild(t); }
        t.textContent = msg;
        t.className = 'show' + (bad ? ' bad' : '');
        clearTimeout(note._t);
        note._t = setTimeout(function () { t.className = ''; }, bad ? 4500 : 2600);
    }

    // ---------- CSV download ----------
    function download(name, rows) {
        var csv = '\ufeff' + rows.map(function (r) {
            return r.map(function (c) {
                var s = String(c == null ? '' : c);
                return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }).join('\r\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
    function stamp() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

    function exportStock() {
        note('Preparing your stock list…');
        db().ref('stores/' + sid() + '/inventory').once('value').then(function (snap) {
            var inv = snap.val() || {}, rows = [['Branch', 'Product', 'Category', 'Cost price', 'Retail price', 'Wholesale price', 'Stock', 'Small unit', 'Bulk unit', 'Units per bulk', 'Expiry']];
            Object.keys(inv).forEach(function (b) {
                Object.keys(inv[b] || {}).forEach(function (id) {
                    var p = inv[b][id]; if (!p || typeof p !== 'object') return;
                    rows.push([b, p.name || p.productName || '', p.category || '', p.costPrice || 0, p.retailPrice || p.price || 0, p.wholesalePrice || 0,
                        p.stock !== undefined ? p.stock : (p.stockQty || 0), p.baseUnitName || '', p.bulkUnitName || '', p.unitsPerPack || '', p.expiry || p.expiryDate || '']);
                });
            });
            if (rows.length === 1) { note('No products to export yet.', true); return; }
            download('stock-' + sid() + '-' + stamp() + '.csv', rows);
            note('Saved ' + (rows.length - 1) + ' products');
        }).catch(function (e) { note('Could not export: ' + (e.message || e), true); });
    }
    function exportSales() {
        note('Preparing 30 days of sales…');
        var from = new Date(); from.setDate(from.getDate() - 30); from.setHours(0, 0, 0, 0);
        db().ref('stores/' + sid() + '/transactions').orderByChild('date').startAt(from.toISOString()).once('value').then(function (snap) {
            var rows = [['Receipt', 'Date', 'Branch', 'Staff', 'Customer', 'Total', 'Refunded', 'Status']];
            snap.forEach(function (c) {
                var t = c.val(); if (!t || !t.date) return;
                rows.push([t.txId || c.key, t.date, t.branchId || 'main', t.staff || t.soldBy || '', t.customerName || 'Walk-In', t.totalAmount || 0, t.refundedAmount || 0, t.refundStatus || 'Completed']);
            });
            if (rows.length === 1) { note('No sales in the last 30 days.', true); return; }
            rows = [rows[0]].concat(rows.slice(1).reverse());
            download('sales-' + sid() + '-' + stamp() + '.csv', rows);
            note('Saved ' + (rows.length - 1) + ' sales');
        }).catch(function (e) { note('Could not export: ' + (e.message || e), true); });
    }
    function reprintLast() {
        note('Finding the last receipt…');
        db().ref('stores/' + sid() + '/transactions').orderByChild('date').limitToLast(1).once('value').then(function (snap) {
            var id = null;
            snap.forEach(function (c) { var t = c.val(); if (t) id = t.txId || c.key; });
            if (!id) { note('No sales yet.', true); return; }
            if (typeof window.viewPastReceipt === 'function') window.viewPastReceipt(id);
            else { note('Open Reports to reprint receipts.', true); if (typeof switchView === 'function') switchView('reports-view'); }
        }).catch(function (e) { note('Could not load: ' + (e.message || e), true); });
    }

    // ---------- calculator ----------
    var cs = { cur: '0', prev: null, op: null, fresh: false };
    function calc(a, b, op) {
        var r = op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : (b === 0 ? NaN : a / b);
        return isFinite(r) ? parseFloat(r.toFixed(10)) : NaN;
    }
    function show(n) {
        if (n === 'Error') return n;
        var neg = n.charAt(0) === '-', s = neg ? n.slice(1) : n, parts = s.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-' : '') + parts.join('.');
    }
    function calcPaint() {
        var d = $('wm-calc-d'), e = $('wm-calc-e');
        if (d) d.textContent = show(cs.cur);
        if (e) e.textContent = (cs.prev !== null && cs.op) ? show(String(cs.prev)) + ' ' + cs.op : '';
    }
    window.wmCalcKey = function (k) {
        if (cs.cur === 'Error' && k !== 'C') return;
        if (/^\d$/.test(k)) { cs.cur = (cs.fresh || cs.cur === '0') ? k : (cs.cur.length < 14 ? cs.cur + k : cs.cur); cs.fresh = false; }
        else if (k === '.') { if (cs.fresh) { cs.cur = '0.'; cs.fresh = false; } else if (cs.cur.indexOf('.') === -1) cs.cur += '.'; }
        else if (k === 'C') { cs = { cur: '0', prev: null, op: null, fresh: false }; }
        else if (k === '⌫') { cs.cur = cs.cur.length > 1 && !cs.fresh ? cs.cur.slice(0, -1) : '0'; if (cs.cur === '-') cs.cur = '0'; }
        else if (k === '%') { cs.cur = String(parseFloat((parseFloat(cs.cur) / 100).toFixed(10))); cs.fresh = true; }
        else if (k === '=') {
            if (cs.prev !== null && cs.op) {
                var r = calc(cs.prev, parseFloat(cs.cur), cs.op);
                cs.cur = isNaN(r) ? 'Error' : String(r); cs.prev = null; cs.op = null; cs.fresh = true;
            }
        } else {
            if (cs.prev !== null && cs.op && !cs.fresh) {
                var r2 = calc(cs.prev, parseFloat(cs.cur), cs.op);
                if (isNaN(r2)) { cs.cur = 'Error'; cs.prev = null; cs.op = null; calcPaint(); return; }
                cs.cur = String(r2);
            }
            cs.prev = parseFloat(cs.cur); cs.op = k; cs.fresh = true;
        }
        calcPaint();
    };
    function openCalc() {
        var m = $('wm-calc'); if (m) m.remove();
        cs = { cur: '0', prev: null, op: null, fresh: false };
        var keys = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='];
        m = document.createElement('div');
        m.id = 'wm-calc';
        m.innerHTML = '<div class="wm-calc-box"><div class="wm-calc-top"><b>Calculator</b><button class="wm-mx" onclick="document.getElementById(\'wm-calc\').remove()">✕</button></div>' +
            '<div class="wm-calc-e" id="wm-calc-e"></div><div class="wm-calc-d" id="wm-calc-d">0</div><div class="wm-calc-g">' +
            keys.map(function (k) {
                var cls = /^[÷×−+]$/.test(k) ? ' op' : (k === '=' ? ' eq' : (/^(C|⌫|%)$/.test(k) ? ' fn' : ''));
                return '<button class="wm-ck' + cls + (k === '0' ? ' z' : '') + '" onclick="wmCalcKey(\'' + k + '\')">' + k + '</button>';
            }).join('') + '</div></div>';
        m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
        document.body.appendChild(m);
    }

    // ---------- the tools (add more here) ----------
    var ITEMS = [
        { group: 'Tools', icon: '🧮', title: 'Calculator', desc: 'Quick sums at the till', run: openCalc },
        { group: 'Receipts', icon: '🖨️', title: 'Reprint last receipt', desc: 'Open the most recent sale', full: true, run: reprintLast },
        { group: 'Receipts', icon: '🔎', title: 'Find a receipt', desc: 'Look one up by its number', full: true, show: function () { return fnOk('openManualLookupModal'); }, run: function () { window.openManualLookupModal(); } },
        { group: 'Store', icon: '🏷️', title: 'Categories', desc: 'Add or remove product groups', full: true,
            show: function () { return fnOk('wmxShowCategories') || fnOk('wmpShowCategories'); },
            run: function () { (fnOk('wmxShowCategories') ? window.wmxShowCategories : window.wmpShowCategories)(); } },
        { group: 'Store', icon: '🎨', title: 'Appearance', desc: 'Change your store colours', full: true,
            show: function () { return fnOk('wmxOpenTheme') || fnOk('wmpOpenTheme'); },
            run: function () { (fnOk('wmxOpenTheme') ? window.wmxOpenTheme : window.wmpOpenTheme)(); } },
        { group: 'Your data', icon: '📦', title: 'Export stock (CSV)', desc: 'Every product, price and quantity', full: true, run: exportStock },
        { group: 'Your data', icon: '📈', title: 'Export sales (CSV)', desc: 'The last 30 days of receipts', full: true, run: exportSales },
        { group: 'Help', icon: '💬', title: 'Chat with support', desc: 'Message us on WhatsApp',
            show: function () { return !!WM_SUPPORT_PHONE; },
            run: function () { window.open('https://wa.me/' + String(WM_SUPPORT_PHONE).replace(/\D/g, '') + '?text=' + encodeURIComponent('Hello, I need help with Wise Decision (' + sid() + ')'), '_blank'); } }
    ];
    // ---------- sidebar buttons tucked into More ----------
    var moved = {};     // label (lower case) -> { el, icon, label, desc }
    var listNow = [];   // what the open panel is showing
    var EMOJI = /^((?:\p{Extended_Pictographic}[\uFE0F\u200D]*)+)\s*(.*)$/u;

    function holder() {
        var h = $('wm-moved');
        if (!h) { h = document.createElement('div'); h.id = 'wm-moved'; h.style.display = 'none'; document.body.appendChild(h); }
        return h;
    }
    function descFor(label) {
        var k = Object.keys(MOVED_DESC).filter(function (d) { return label.indexOf(d) !== -1; })[0];
        return k ? MOVED_DESC[k] : 'Open';
    }
    function sweepMoved() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        if (!side || !MOVE_TO_MORE.length) return;
        Array.prototype.slice.call(side.querySelectorAll('button')).forEach(function (b) {
            if (b.id === 'wm-more-btn' || b.classList.contains('btn-logout')) return;
            var text = (b.textContent || '').replace(/\s+/g, ' ').trim();
            var low = text.toLowerCase();
            if (!MOVE_TO_MORE.some(function (k) { return low.indexOf(k) !== -1; })) return;
            var m = EMOJI.exec(text);
            var label = m ? m[2] : text, icon = m ? m[1] : '📌';
            var key = label.toLowerCase();
            var old = moved[key];
            // a patch that re-creates its button: keep only the newest copy
            if (old && old.el && old.el !== b && old.el.parentNode) old.el.parentNode.removeChild(old.el);
            moved[key] = { el: b, icon: icon, label: label, desc: descFor(key) };
            holder().appendChild(b);
        });
    }
    function restoreMoved() {
        var keys = Object.keys(moved);
        if (!keys.length) return;
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        var anchor = $('wm-more-btn') || (side && side.querySelector('.btn-logout'));
        keys.forEach(function (k) {
            var m = moved[k];
            if (m.el && side) side.insertBefore(m.el, (anchor && anchor.parentNode === side) ? anchor : null);
        });
        moved = {};
    }
    function movedItems() {
        var out = [];
        Object.keys(moved).forEach(function (k) {
            var m = moved[k];
            if (!m.el || !document.body.contains(m.el)) return;
            out.push({ group: 'From your menu', icon: m.icon, title: m.label, desc: m.desc, run: function () { m.el.click(); } });
        });
        return out;
    }
    function visible() {
        var base = ITEMS.filter(function (it) { return (!it.full || full()) && (!it.show || it.show()); });
        return (full() ? movedItems() : []).concat(base);
    }

    // ---------- the pop-out panel ----------
    var open = false;
    function rows() {
        listNow = visible();
        var list = listNow, last = null, html = '';
        list.forEach(function (it) {
            if (it.group !== last) { html += '<div class="wm-mg">' + esc(it.group) + '</div>'; last = it.group; }
            html += '<button class="wm-mi" data-i="' + list.indexOf(it) + '"><span class="wm-ic">' + it.icon + '</span><span class="wm-tx"><b>' + esc(it.title) + '</b><small>' + esc(it.desc) + '</small></span><span class="wm-ch">›</span></button>';
        });
        return html;
    }
    function openMore() {
        if (open) return;
        open = true;
        var b = $('wm-more-btn'); if (b) b.setAttribute('aria-expanded', 'true');
        var back = document.createElement('div'); back.id = 'wm-more-back';
        var p = document.createElement('div'); p.id = 'wm-more-panel';
        p.className = phone() ? 'sheet' : 'fly';
        p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'More');
        p.innerHTML = '<div class="wm-mh"><b>More</b><button class="wm-mx" aria-label="Close">✕</button></div><div class="wm-ms">Extra tools for your store</div><div class="wm-ml">' + rows() + '</div>';
        back.addEventListener('click', closeMore);
        p.querySelector('.wm-mx').addEventListener('click', closeMore);
        p.addEventListener('click', function (e) {
            var t = e.target.closest ? e.target.closest('.wm-mi') : null;
            if (!t) return;
            var it = listNow[+t.getAttribute('data-i')];
            closeMore();
            if (it) setTimeout(function () { try { it.run(); } catch (err) { note('Something went wrong: ' + (err.message || err), true); } }, reduce ? 0 : 120);
        });
        document.body.appendChild(back);
        document.body.appendChild(p);
        if (!phone()) {
            var side = document.querySelector('#dashboard-main-wrapper .sidebar');
            var sr = side ? side.getBoundingClientRect() : { right: 260 };
            var br = b ? b.getBoundingClientRect() : { top: 80 };
            p.style.left = (sr.right + 12) + 'px';
            p.style.top = Math.max(12, Math.min(br.top - 24, window.innerHeight - p.offsetHeight - 12)) + 'px';
        }
    }
    function closeMore() {
        if (!open) return;
        open = false;
        var b = $('wm-more-btn'); if (b) b.setAttribute('aria-expanded', 'false');
        var back = $('wm-more-back'), p = $('wm-more-panel');
        if (p) p.classList.add('closing');
        if (back) back.classList.add('closing');
        setTimeout(function () { if (p) p.remove(); if (back) back.remove(); }, reduce ? 0 : 180);
    }
    window.wmToggleMore = function () { if (open) closeMore(); else openMore(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMore(); var c = $('wm-calc'); if (c) c.remove(); } });

    // ---------- sidebar button ----------
    function inject() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        var btn = $('wm-more-btn');
        var s = sid();
        var base = !!side && !!s && s !== 'SUPER_ADMIN' && !(isMat() && !full());
        if (base && full()) sweepMoved(); else restoreMoved();   // owner / manager: tuck rarely-used buttons into More
        var allowed = base && visible().length > 0;
        if (!allowed) { restoreMoved(); if (btn) btn.remove(); if (open) closeMore(); return; }
        if (btn) return;
        btn = document.createElement('button');
        btn.id = 'wm-more-btn';
        btn.className = 'menu-btn btn-sec';
        btn.setAttribute('aria-expanded', 'false');
        btn.textContent = '🧰 More';
        btn.onclick = function () { window.wmToggleMore(); };
        var logout = side.querySelector('.btn-logout');
        if (logout) logout.parentNode.insertBefore(btn, logout); else side.appendChild(btn);
    }

    // ---------- CSS ----------
    function addCss() {
        if ($('wm-more-css')) return;
        var css =
        // beats the "hide everything except these buttons" rules some store types use
        'body #dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper .sidebar #wm-more-btn{display:block !important;}' +
        '#wm-more-back{position:fixed;inset:0;z-index:1940;background:rgba(15,23,42,.28);animation:wmm-f .18s ease-out both;}' +
        '#wm-more-back.closing{opacity:0;transition:opacity .18s;}' +
        '#wm-more-panel{position:fixed;z-index:1950;background:var(--wx-surf,#fff);color:var(--wx-ink,#0f172a);border:1px solid var(--wx-line,#e2e8f0);box-shadow:0 24px 60px rgba(15,23,42,.3);overflow-y:auto;box-sizing:border-box;}' +
        '#wm-more-panel *{box-sizing:border-box;}' +
        '#wm-more-panel.fly{width:340px;max-height:80vh;border-radius:22px;padding:16px;animation:wmm-p .2s ease-out both;transform-origin:left top;}' +
        '#wm-more-panel.sheet{left:0;right:0;bottom:0;max-height:82vh;border-radius:24px 24px 0 0;padding:18px 16px calc(env(safe-area-inset-bottom,0px) + 18px);animation:wmm-s .24s ease-out both;}' +
        '#wm-more-panel.closing{opacity:0;transform:translateY(8px);transition:opacity .18s,transform .18s;}' +
        '@keyframes wmm-f{from{opacity:0}to{opacity:1}}' +
        '@keyframes wmm-p{from{opacity:0;transform:translateX(-8px) scale(.97)}to{opacity:1;transform:none}}' +
        '@keyframes wmm-s{from{transform:translateY(40px);opacity:.6}to{transform:none;opacity:1}}' +
        '.wm-mh{display:flex;justify-content:space-between;align-items:center;font-size:19px;}' +
        '.wm-mx{border:none;background:var(--wx-bg,#f1f5f9);color:inherit;border-radius:99px;width:34px;height:34px;font-size:15px;cursor:pointer;}' +
        '.wm-ms{font-size:12px;color:var(--wx-mut,#64748b);margin:2px 0 8px;font-weight:600;}' +
        '.wm-mg{font-size:10px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--wx-mut,#64748b);margin:14px 0 6px 2px;}' +
        '.wm-mi{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid var(--wx-line,#e2e8f0);background:var(--wx-surf,#fff);color:inherit;border-radius:16px;padding:11px 12px;margin-bottom:6px;cursor:pointer;transition:transform .08s,border-color .15s;}' +
        '.wm-mi:hover{border-color:var(--wx-acc,#0284c7);}.wm-mi:active{transform:scale(.98);}' +
        '.wm-ic{flex-shrink:0;width:40px;height:40px;border-radius:12px;background:var(--wx-soft,#e0f2fe);display:flex;align-items:center;justify-content:center;font-size:19px;}' +
        '.wm-tx{flex:1;min-width:0;}.wm-tx b{display:block;font-size:14px;font-weight:800;}.wm-tx small{display:block;font-size:12px;color:var(--wx-mut,#64748b);font-weight:600;margin-top:1px;}' +
        '.wm-ch{color:var(--wx-mut,#94a3b8);font-size:20px;}' +
        // calculator
        '#wm-calc{position:fixed;inset:0;z-index:2100;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;}' +
        '.wm-calc-box{width:100%;max-width:320px;background:var(--wx-surf,#fff);color:var(--wx-ink,#0f172a);border-radius:24px;padding:16px;box-shadow:0 24px 60px rgba(15,23,42,.4);}' +
        '.wm-calc-top{display:flex;justify-content:space-between;align-items:center;font-size:16px;margin-bottom:6px;}' +
        '.wm-calc-e{min-height:18px;text-align:right;font-size:13px;color:var(--wx-mut,#64748b);font-weight:700;}' +
        '.wm-calc-d{text-align:right;font-size:38px;font-weight:900;letter-spacing:-1px;margin:2px 0 12px;overflow:hidden;white-space:nowrap;}' +
        '.wm-calc-g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}' +
        '.wm-ck{height:54px;border:none;border-radius:16px;background:var(--wx-bg,#f1f5f9);color:inherit;font-size:20px;font-weight:800;cursor:pointer;transition:transform .08s;}' +
        '.wm-ck:active{transform:scale(.94);}.wm-ck.z{grid-column:span 2;}' +
        '.wm-ck.op{background:var(--wx-soft,#e0f2fe);}.wm-ck.fn{color:var(--wx-mut,#64748b);}' +
        '.wm-ck.eq{background:var(--wx-acc,#0284c7);color:var(--wx-acc-ink,#fff);}' +
        // message bar
        '#wm-more-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 22px);transform:translate(-50%,14px);max-width:min(92vw,420px);background:#14161a;color:#fff;border-radius:14px;padding:12px 16px;font-size:14px;font-weight:700;opacity:0;pointer-events:none;transition:opacity .22s,transform .22s;z-index:3100;}' +
        '#wm-more-toast.show{opacity:1;transform:translate(-50%,0);}#wm-more-toast.bad{background:#b91c1c;}' +
        '@media (prefers-reduced-motion:reduce){#wm-more-back,#wm-more-panel{animation:none !important;}#wm-more-toast,.wm-mi,.wm-ck{transition:none !important;}}';
        var st = document.createElement('style');
        st.id = 'wm-more-css';
        st.textContent = css;
        document.head.appendChild(st);
    }

    function tick() { try { if (!document.body) return; addCss(); inject(); } catch (e) { console.warn('[more-menu]', e); } }
    var pending = false;
    function schedule() { if (pending) return; pending = true; setTimeout(function () { pending = false; tick(); }, 150); }

    function start() {
        tick();
        if (document.body) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        setInterval(tick, 4000);
    }
    if (document.readyState === 'complete') setTimeout(start, 1600);
    else window.addEventListener('load', function () { setTimeout(start, 1600); });
})();
