// ==================== WISE DECISION "MORE" MENU (v2) ====================
// Load LAST (after modern-motion-patch.js and materials-modern-patch.js). Works for EVERY store type.
//
// Adds a "More" button to the sidebar (above Logout). Click it and a panel pops out beside the sidebar
// (phones: slides up as a bottom sheet). Pick a tool and the panel closes. Esc, the X, clicking outside, or
// clicking More again also close it.
//
// Laptop-friendly: a search box (type to filter), Up/Down arrow keys to move, Enter to open, Esc to close,
// and a calculator you can type on with the keyboard.
//
// Tools (each shows only when it can work and only to people allowed to use it):
//   Calculator ................. everyone
//   Reprint last receipt ....... owner / manager (last sale of the branch you are in)
//   Find a receipt ............. owner / manager
//   Categories, Appearance ..... hardware + pharmacy stores with the new look (owner / manager)
//   Export stock (CSV) ......... owner / manager
//   Export sales, 30 days (CSV)  owner / manager
//   Chat with support .......... everyone, only if WM_SUPPORT_PHONE below is filled in
//
// It also tucks rarely-used sidebar buttons into More (owner / manager only; list = MOVE_TO_MORE below).
// A moved button works exactly as before: choosing it in More clicks the original button.
//
// v2 fixes:
//   - moved buttons no longer flash back into the sidebar (other patches / the modern theme re-showed them)
//   - buttons that the role patch hides (e.g. Branches for a Manager) no longer appear in More
//   - switching user / store / role starts from a clean list
//   - opening More quickly after closing no longer leaves a duplicate panel
//   - Reprint last receipt uses the branch you are in
//   - CSV exports are safe to open in Excel (no formula injection)
//
// Read-only: nothing here writes to Firebase. To add a tool, add one entry to ITEMS below.
// Building-materials STAFF still see only New Sale + Logout (no More button for them).

console.log("Wise Decision more-menu-patch.js — v2 loaded");

(function () {
    'use strict';

    // Support WhatsApp number (country code, no + or spaces). Empty = hidden.
    var WM_SUPPORT_PHONE = '2349168140710';

    // Sidebar buttons tucked into More (owner / manager only). Matched by the words on the button, lower case.
    // Leave the list empty ( [] ) to keep every button in the sidebar.
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
    function role() { return (typeof currentUserRole !== 'undefined' && currentUserRole) ? String(currentUserRole).toLowerCase() : ''; }
    function full() {
        if (typeof window.wdFullAccess === 'function') return window.wdFullAccess();
        return role() === 'admin' || role() === 'manager';
    }
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }
    function phone() { return window.innerWidth <= 767; }
    function branchId() { return (typeof currentBranch !== 'undefined' && currentBranch) ? currentBranch : 'main'; }
    function ctxKey() { return [sid(), role(), (typeof currentStaffName !== 'undefined' ? currentStaffName : '')].join('|'); }
    function isLogout(b) {
        var t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return t.length < 24 && /log\s?out|sign\s?out/.test(t);
    }
    var ITEM_SEL = 'button, .menu-btn';   // some patches build sidebar items as <div>/<a class="menu-btn">
    function sideEl() { return document.querySelector('#dashboard-main-wrapper .sidebar'); }
    function sideItems(side) {
        return Array.prototype.slice.call(side.querySelectorAll(ITEM_SEL)).filter(function (b) {
            var p = b.parentElement && b.parentElement.closest ? b.parentElement.closest(ITEM_SEL) : null;
            return !(p && side.contains(p));   // skip buttons nested inside another menu item
        });
    }
    var reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }

    // ---------- message bar ----------
    function note(msg, bad) {
        var t = $('wm-more-toast');
        if (!t) { t = document.createElement('div'); t.id = 'wm-more-toast'; document.body.appendChild(t); }
        t.textContent = msg;
        t.className = 'show' + (bad ? ' bad' : '');
        clearTimeout(note._t);
        note._t = setTimeout(function () { t.className = ''; }, bad ? 4500 : 2600);
    }

    // ---------- CSV download ----------
    function cell(c) {
        var s = String(c == null ? '' : c);
        if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s;   // stop Excel treating text as a formula
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function download(name, rows) {
        var csv = '\ufeff' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n');
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
        var br = branchId();
        db().ref('stores/' + sid() + '/transactions').orderByChild('date').limitToLast(30).once('value').then(function (snap) {
            var best = null;
            snap.forEach(function (c) {
                var t = c.val(); if (!t || !t.date || (t.branchId || 'main') !== br) return;
                if (!best || String(t.date) > String(best.date)) best = { date: t.date, id: t.txId || c.key };
            });
            if (!best) { note('No recent sales in this branch.', true); return; }
            if (typeof window.viewPastReceipt === 'function') window.viewPastReceipt(best.id);
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
        if (d) { d.textContent = show(cs.cur); d.style.fontSize = cs.cur.length > 11 ? '28px' : (cs.cur.length > 8 ? '34px' : ''); }
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
    var CALC_KEYMAP = { '*': '×', 'x': '×', '/': '÷', '-': '−', '+': '+', 'Enter': '=', '=': '=', 'Backspace': '⌫', 'Delete': 'C', 'c': 'C', 'C': 'C', '%': '%', '.': '.', ',': '.' };
    function calcKeyboard(e) {
        if (!$('wm-calc') || e.ctrlKey || e.metaKey || e.altKey) return;
        var k = e.key;
        if (/^\d$/.test(k)) { e.preventDefault(); window.wmCalcKey(k); }
        else if (CALC_KEYMAP[k]) { e.preventDefault(); window.wmCalcKey(CALC_KEYMAP[k]); }
    }
    function closeCalc() {
        var m = $('wm-calc'); if (m) m.remove();
        document.removeEventListener('keydown', calcKeyboard, true);
    }
    function openCalc() {
        closeCalc();
        cs = { cur: '0', prev: null, op: null, fresh: false };
        var keys = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='];
        var m = document.createElement('div');
        m.id = 'wm-calc';
        m.innerHTML = '<div class="wm-calc-box" role="dialog" aria-label="Calculator">' +
            '<div class="wm-calc-top"><b>Calculator</b><button class="wm-mx" data-close="1" aria-label="Close">✕</button></div>' +
            '<div class="wm-calc-screen"><div class="wm-calc-e" id="wm-calc-e"></div><div class="wm-calc-d" id="wm-calc-d">0</div></div>' +
            '<div class="wm-calc-g">' + keys.map(function (k) {
                var cls = /^[÷×−+]$/.test(k) ? ' op' : (k === '=' ? ' eq' : (/^(C|⌫|%)$/.test(k) ? ' fn' : ''));
                return '<button class="wm-ck' + cls + (k === '0' ? ' z' : '') + '" data-k="' + k + '">' + k + '</button>';
            }).join('') + '</div><div class="wm-calc-hint">You can also type on your keyboard</div></div>';
        m.addEventListener('click', function (e) {
            if (e.target === m || (e.target.closest && e.target.closest('[data-close]'))) { closeCalc(); return; }
            var kb = e.target.closest ? e.target.closest('.wm-ck') : null;
            if (kb) window.wmCalcKey(kb.getAttribute('data-k'));
        });
        document.body.appendChild(m);
        document.addEventListener('keydown', calcKeyboard, true);
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
    var moved = {};      // label (lower case) -> { el, icon, label, desc }
    var lastCtx = null;
    var EMOJI = /^((?:\p{Extended_Pictographic}[\uFE0F\u200D]*)+)\s*(.*)$/u;

    // Buttons are hidden IN PLACE (never moved out of the sidebar): other patches look for their own button and add a
    // copy when it is gone. The hide is an inline !important (beats every stylesheet) plus a class rule as a backup.
    function hideEl(b) {
        if (!b.classList.contains('wm-moved')) b.classList.add('wm-moved');
        if (b.style.getPropertyValue('display') !== 'none' || b.style.getPropertyPriority('display') !== 'important') b.style.setProperty('display', 'none', 'important');
    }
    function showEl(b) {
        b.classList.remove('wm-moved');
        if (b.style.getPropertyPriority('display') === 'important') b.style.removeProperty('display');   // only undo OUR hide
    }
    function descFor(label) {
        var k = Object.keys(MOVED_DESC).filter(function (d) { return label.indexOf(d) !== -1; })[0];
        return k ? MOVED_DESC[k] : 'Open';
    }
    function sweepMoved(side) {
        if (!MOVE_TO_MORE.length) { restoreMoved(); return; }
        sideItems(side).forEach(function (b) {
            if (b.id === 'wm-more-btn' || isLogout(b)) return;
            var ours = b.classList.contains('wm-moved');
            // another patch (role rules) hid it on purpose: it is not ours to show, so keep it out of More too
            if (b.style.getPropertyValue('display') === 'none' && b.style.getPropertyPriority('display') !== 'important') { if (ours) b.classList.remove('wm-moved'); return; }
            if (!ours && window.getComputedStyle(b).display === 'none') return;
            var text = (b.textContent || '').replace(/\s+/g, ' ').trim();
            var low = text.toLowerCase();
            if (!MOVE_TO_MORE.some(function (k) { return low.indexOf(k) !== -1; })) { if (ours) showEl(b); return; }
            var m = EMOJI.exec(text);
            var label = m ? m[2] : text, icon = m ? m[1] : '📌';
            moved[label.toLowerCase()] = { el: b, icon: icon, label: label, desc: descFor(label.toLowerCase()) };
            hideEl(b);
        });
    }
    function restoreMoved() {
        var side = sideEl();
        if (side) Array.prototype.forEach.call(side.querySelectorAll('.wm-moved'), showEl);
        moved = {};
    }
    function movedItems() {
        var out = [];
        Object.keys(moved).forEach(function (k) {
            var m = moved[k];
            if (!m.el || !document.body.contains(m.el) || !m.el.classList.contains('wm-moved')) return;
            out.push({ group: 'From your menu', icon: m.icon, title: m.label, desc: m.desc, run: function () { m.el.click(); } });
        });
        return out;
    }
    function visible() {
        var base = ITEMS.filter(function (it) { return (!it.full || full()) && (!it.show || it.show()); });
        return (full() ? movedItems() : []).concat(base);
    }

    // ---------- the pop-out panel ----------
    var open = false, panel = null, backdrop = null, listNow = [];

    function rowsHtml(q) {
        q = (q || '').trim().toLowerCase();
        listNow = visible().filter(function (it) { return !q || (it.title + ' ' + it.desc + ' ' + it.group).toLowerCase().indexOf(q) !== -1; });
        if (!listNow.length) return '<div class="wm-empty">Nothing matches “' + esc(q) + '”.</div>';
        var last = null, html = '';
        listNow.forEach(function (it, i) {
            if (it.group !== last) { html += '<div class="wm-mg">' + esc(it.group) + '</div>'; last = it.group; }
            html += '<button class="wm-mi" data-i="' + i + '"><span class="wm-ic">' + it.icon + '</span><span class="wm-tx"><b>' + esc(it.title) + '</b><small>' + esc(it.desc) + '</small></span><span class="wm-ch">›</span></button>';
        });
        return html;
    }
    function place() {
        if (!panel || phone()) return;
        var side = sideEl(), b = $('wm-more-btn');
        var sr = side ? side.getBoundingClientRect() : { right: 260 };
        var br = b ? b.getBoundingClientRect() : { bottom: window.innerHeight - 20 };
        panel.style.left = (sr.right + 12) + 'px';
        var top = br.bottom - panel.offsetHeight;
        panel.style.top = Math.max(12, Math.min(top, window.innerHeight - panel.offsetHeight - 12)) + 'px';
    }
    function openMore() {
        if (open) return;
        open = true;
        var b = $('wm-more-btn'); if (b) b.setAttribute('aria-expanded', 'true');
        var isPhone = phone();
        backdrop = document.createElement('div'); backdrop.id = 'wm-more-back';
        panel = document.createElement('div'); panel.id = 'wm-more-panel';
        panel.className = isPhone ? 'sheet' : 'fly';
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'More');
        panel.innerHTML =
            (isPhone ? '<div class="wm-grab"></div>' : '') +
            '<div class="wm-mh"><div><b>More</b><div class="wm-ms">Extra tools for your store</div></div><button class="wm-mx" aria-label="Close">✕</button></div>' +
            '<div class="wm-search"><span>🔍</span><input type="text" placeholder="Search tools…" aria-label="Search tools" autocomplete="off"></div>' +
            '<div class="wm-ml">' + rowsHtml('') + '</div>' +
            (isPhone ? '' : '<div class="wm-foot"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> open <kbd>Esc</kbd> close</div>');
        var pa = panel, ba = backdrop;
        ba.addEventListener('click', function () { closeMore(); });
        pa.querySelector('.wm-mx').addEventListener('click', function () { closeMore(); });
        var input = pa.querySelector('.wm-search input'), listEl = pa.querySelector('.wm-ml');
        input.addEventListener('input', function () { listEl.innerHTML = rowsHtml(input.value); place(); });
        pa.addEventListener('keydown', function (e) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            var items = Array.prototype.slice.call(pa.querySelectorAll('.wm-mi'));
            if (!items.length) return;
            e.preventDefault();
            var i = items.indexOf(document.activeElement);
            if (e.key === 'ArrowDown') i = i < items.length - 1 ? i + 1 : 0;
            else i = i > 0 ? i - 1 : items.length - 1;
            items[i].focus();
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { var f = pa.querySelector('.wm-mi'); if (f) f.click(); }
        });
        pa.addEventListener('click', function (e) {
            var t = e.target.closest ? e.target.closest('.wm-mi') : null;
            if (!t) return;
            var it = listNow[+t.getAttribute('data-i')];
            closeMore(true);
            if (it) setTimeout(function () { try { it.run(); } catch (err) { note('Something went wrong: ' + (err.message || err), true); } }, reduce ? 0 : 120);
        });
        document.body.appendChild(ba);
        document.body.appendChild(pa);
        place();
        if (!isPhone) input.focus();
    }
    function closeMore(noFocus) {
        if (!open) return;
        open = false;
        var b = $('wm-more-btn');
        if (b) { b.setAttribute('aria-expanded', 'false'); if (noFocus !== true && !phone()) b.focus(); }
        var p = panel, back = backdrop;
        panel = null; backdrop = null;
        if (p) p.classList.add('closing');
        if (back) back.classList.add('closing');
        setTimeout(function () { if (p) p.remove(); if (back) back.remove(); }, reduce ? 0 : 180);
    }
    window.wmToggleMore = function () { if (open) closeMore(); else openMore(); };
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if ($('wm-calc')) closeCalc(); else closeMore();
    });
    window.addEventListener('resize', function () { if (open) place(); });

    // ---------- sidebar button ----------
    function inject() {
        var side = sideEl();
        var btn = $('wm-more-btn');
        var s = sid();
        var base = !!side && !!s && s !== 'SUPER_ADMIN' && !(isMat() && !full());
        var key = ctxKey();
        if (key !== lastCtx) { lastCtx = key; restoreMoved(); if (open) closeMore(true); }   // new user / store / role: start clean
        if (base && full()) sweepMoved(side); else restoreMoved();
        var allowed = base && visible().length > 0;
        if (!allowed) { restoreMoved(); if (btn) btn.remove(); if (open) closeMore(true); return; }
        if (btn) { keepLast(side, btn); return; }
        btn = document.createElement('button');
        btn.id = 'wm-more-btn';
        btn.className = 'menu-btn btn-sec';
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.textContent = '🧰 More';
        btn.onclick = function () { window.wmToggleMore(); };
        var logout = sideItems(side).filter(isLogout)[0];
        if (logout) logout.parentNode.insertBefore(btn, logout); else side.appendChild(btn);
        keepLast(side, btn);
    }
    // More and Logout stay at the very bottom whatever order other patches add buttons in.
    function keepLast(side, more) {
        var logout = sideItems(side).filter(isLogout)[0];
        if (more.style.order !== '9998') more.style.order = '9998';
        if (logout && logout.style.order !== '9999') logout.style.order = '9999';
        var d = window.getComputedStyle(side).display;
        if (d !== 'flex' && d !== 'inline-flex' && d !== 'none' && logout && more.nextElementSibling !== logout && logout.parentNode) {
            logout.parentNode.insertBefore(more, logout);
        }
    }

    // ---------- CSS ----------
    function addCss() {
        if ($('wm-more-css')) return;
        var SBX = 'body #dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper .sidebar';
        var css =
        // moved buttons stay hidden even against the "show every button" rules of other patches
        SBX + ' .wm-moved{display:none !important;}' +
        SBX + ' #wm-more-btn{display:flex !important;align-items:center;}' +

        // palette: follows the store's theme (--wx-*) when the modern look is on, sensible defaults otherwise
        '#wm-more-panel,#wm-calc,#wm-more-toast{--m-surf:var(--wx-surf,#ffffff);--m-ink:var(--wx-ink,#0f172a);--m-mut:var(--wx-mut,#64748b);--m-line:var(--wx-line,#e2e8f0);--m-acc:var(--wx-acc,#0284c7);--m-acc-ink:var(--wx-acc-ink,#ffffff);--m-soft:var(--wx-soft,#e0f2fe);--m-bg:var(--wx-bg,#f1f5f9);--m-dark:var(--wx-side,#15171c);--m-dark-acc:var(--wx-side-acc,#f5b301);}' +

        '#wm-more-back{position:fixed;inset:0;z-index:2390;background:rgba(10,12,16,.38);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);animation:wmm-f .18s ease-out both;}' +
        '#wm-more-back.closing{opacity:0;transition:opacity .18s;}' +
        '#wm-more-panel{position:fixed;z-index:2400;background:var(--m-surf);color:var(--m-ink);box-shadow:0 28px 70px rgba(10,12,16,.35);overflow:hidden;display:flex;flex-direction:column;box-sizing:border-box;}' +
        '#wm-more-panel *{box-sizing:border-box;}' +
        '#wm-more-panel.fly{width:380px;max-height:min(640px,calc(100vh - 24px));border-radius:22px;border:1px solid var(--m-line);animation:wmm-p .2s ease-out both;transform-origin:left bottom;}' +
        '#wm-more-panel.sheet{left:0;right:0;bottom:0;max-height:86vh;border-radius:26px 26px 0 0;padding-bottom:env(safe-area-inset-bottom,0px);animation:wmm-s .24s ease-out both;}' +
        '#wm-more-panel.closing{opacity:0;transform:translateY(8px);transition:opacity .18s,transform .18s;}' +
        '@keyframes wmm-f{from{opacity:0}to{opacity:1}}' +
        '@keyframes wmm-p{from{opacity:0;transform:translateX(-10px) scale(.97)}to{opacity:1;transform:none}}' +
        '@keyframes wmm-s{from{transform:translateY(40px);opacity:.6}to{transform:none;opacity:1}}' +
        '.wm-grab{width:42px;height:5px;border-radius:99px;background:var(--m-line);margin:10px auto 0;}' +
        '.wm-mh{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 18px 6px;}' +
        '.wm-mh b{font-size:21px;font-weight:900;letter-spacing:-.5px;}' +
        '.wm-ms{font-size:12px;color:var(--m-mut);font-weight:600;margin-top:2px;}' +
        '.wm-mx{border:none;background:var(--m-bg);color:inherit;border-radius:99px;width:34px;height:34px;font-size:14px;cursor:pointer;flex-shrink:0;transition:background .15s;}' +
        '.wm-mx:hover{background:var(--m-line);}' +
        '.wm-search{display:flex;align-items:center;gap:8px;margin:10px 18px 4px;padding:0 14px;height:44px;background:var(--m-bg);border:1px solid transparent;border-radius:14px;transition:border-color .15s,box-shadow .15s;}' +
        '.wm-search:focus-within{border-color:var(--m-acc);box-shadow:0 0 0 3px var(--m-soft);background:var(--m-surf);}' +
        '.wm-search span{font-size:14px;opacity:.6;}' +
        '.wm-search input{flex:1;min-width:0;border:none !important;background:transparent !important;outline:none !important;box-shadow:none !important;font-size:15px;font-weight:600;color:var(--m-ink) !important;padding:0 !important;height:100%;}' +
        '.wm-ml{overflow-y:auto;padding:4px 12px 14px;flex:1;min-height:0;}' +
        '.wm-mg{font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--m-mut);margin:14px 6px 6px;}' +
        '.wm-mi{display:flex;align-items:center;gap:13px;width:100%;text-align:left;border:1px solid transparent;background:transparent;color:inherit;border-radius:16px;padding:9px 10px;margin:0 0 2px;cursor:pointer;font-family:inherit;transition:background .12s,border-color .12s,transform .08s;}' +
        '.wm-mi:hover,.wm-mi:focus-visible{background:var(--m-soft);outline:none;}' +
        '.wm-mi:focus-visible{border-color:var(--m-acc);}' +
        '.wm-mi:active{transform:scale(.985);}' +
        '.wm-ic{flex-shrink:0;width:42px;height:42px;border-radius:13px;background:var(--m-bg);display:flex;align-items:center;justify-content:center;font-size:20px;transition:background .12s;}' +
        '.wm-mi:hover .wm-ic,.wm-mi:focus-visible .wm-ic{background:var(--m-surf);}' +
        '.wm-tx{flex:1;min-width:0;}' +
        '.wm-tx b{display:block;font-size:14px;font-weight:800;}' +
        '.wm-tx small{display:block;font-size:12px;color:var(--m-mut);font-weight:600;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.wm-ch{color:var(--m-mut);font-size:20px;opacity:.5;}' +
        '.wm-mi:hover .wm-ch{opacity:1;}' +
        '.wm-empty{text-align:center;color:var(--m-mut);padding:30px 10px;font-size:14px;font-weight:600;}' +
        '.wm-foot{padding:10px 18px;border-top:1px solid var(--m-line);font-size:11px;color:var(--m-mut);font-weight:600;background:var(--m-bg);}' +
        '.wm-foot kbd{display:inline-block;min-width:20px;text-align:center;padding:1px 6px;margin:0 3px 0 6px;border:1px solid var(--m-line);border-bottom-width:2px;border-radius:6px;background:var(--m-surf);font:700 11px inherit;color:var(--m-ink);}' +
        '.wm-foot kbd:first-child{margin-left:0;}' +

        // calculator
        '#wm-calc{position:fixed;inset:0;z-index:2500;background:rgba(10,12,16,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;animation:wmm-f .18s ease-out both;}' +
        '.wm-calc-box{width:100%;max-width:330px;background:var(--m-surf);color:var(--m-ink);border-radius:26px;padding:16px;box-shadow:0 28px 70px rgba(10,12,16,.45);}' +
        '.wm-calc-top{display:flex;justify-content:space-between;align-items:center;font-size:16px;margin-bottom:10px;}' +
        '.wm-calc-screen{background:var(--m-dark);border-radius:18px;padding:14px 16px 12px;margin-bottom:12px;}' +
        '.wm-calc-e{min-height:18px;text-align:right;font-size:13px;color:#9aa3b0;font-weight:700;}' +
        '.wm-calc-d{text-align:right;font-size:40px;font-weight:900;letter-spacing:-1px;color:#fff;overflow:hidden;white-space:nowrap;line-height:1.2;}' +
        '.wm-calc-g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}' +
        '.wm-ck{height:54px;border:none;border-radius:16px;background:var(--m-bg);color:inherit;font-size:20px;font-weight:800;cursor:pointer;font-family:inherit;transition:transform .08s,filter .12s;}' +
        '.wm-ck:hover{filter:brightness(.96);}.wm-ck:active{transform:scale(.94);}.wm-ck.z{grid-column:span 2;}' +
        '.wm-ck.op{background:var(--m-soft);}.wm-ck.fn{color:var(--m-mut);}' +
        '.wm-ck.eq{background:var(--m-acc);color:var(--m-acc-ink);}' +
        '.wm-calc-hint{text-align:center;font-size:11px;color:var(--m-mut);font-weight:600;margin-top:10px;}' +

        // message bar
        '#wm-more-toast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 22px);transform:translate(-50%,14px);max-width:min(92vw,420px);background:#14161a;color:#fff;border-radius:14px;padding:12px 16px;font-size:14px;font-weight:700;opacity:0;pointer-events:none;transition:opacity .22s,transform .22s;z-index:3100;}' +
        '#wm-more-toast.show{opacity:1;transform:translate(-50%,0);}#wm-more-toast.bad{background:#b91c1c;}' +
        '@media (prefers-reduced-motion:reduce){#wm-more-back,#wm-more-panel,#wm-calc{animation:none !important;}#wm-more-toast,.wm-mi,.wm-ck,.wm-mx{transition:none !important;}}';
        var st = document.createElement('style');
        st.id = 'wm-more-css';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // ---------- keep everything applied ----------
    var watched = null, sideObs = null;
    function watchSide() {
        var side = sideEl();
        if (!side || side === watched) return;
        watched = side;
        if (sideObs) sideObs.disconnect();
        // other patches re-style the sidebar buttons every second: react straight away instead of at the next tick
        sideObs = new MutationObserver(schedule);
        sideObs.observe(side, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    }
    function tick() { try { if (!document.body) return; addCss(); inject(); watchSide(); } catch (e) { console.warn('[more-menu]', e); } }
    var pending = false;
    function schedule() { if (pending) return; pending = true; setTimeout(function () { pending = false; tick(); }, 120); }

    function start() {
        tick();
        if (document.body) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        setInterval(tick, 4000);
    }
    if (document.readyState === 'complete') setTimeout(start, 1600);
    else window.addEventListener('load', function () { setTimeout(start, 1600); });
})();
