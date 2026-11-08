// ==================== WISE DECISION DAILY SUMMARY PATCH (v1) ====================
// Load AFTER the store-type patches (phone / materials / electronics) and before vertical-first-patch.js (v3.21+).
//
// A "📲 Daily Summary" button for the Admin and the Manager on every store type (the Manager does not see the profit line). One tap builds today's (or yesterday's)
// summary and opens WhatsApp with the message ready to send:
//
//     📊 Daily Summary — Medstar Pharmacy
//     Friday, 6 November 2026
//     💰 Sales: ₦184,500 (9 sales)   ▲ 12% vs yesterday
//     💵 Profit (est.): ₦41,200
//     🏆 Top sellers: ...
//     💳 Owed to you: ...   ⚠️ Low stock: ...
//
// What it reads (read-only, nothing is changed):
//   * general / pharmacy / fashion / other stores and Building Materials: stores/<id>/transactions (last 500), inventory
//     (+ the Credit Book for materials stores)
//   * Phone vendors: phoneSales/<id>, phoneInventory/<id>
//   * Electronics: stores/<id>/elecSales, elecStock
// The WhatsApp number is remembered on this phone (it starts as the store's phone number).
// An optional evening reminder card ("Today's summary is ready") appears after the hour you choose (default 8 pm).
//
// NOTE: WhatsApp cannot be sent automatically without a paid WhatsApp API, so the owner taps Send. This is by design.
// Profit is an estimate from cost prices; it shows only when cost prices are available.

console.log("Wise Decision daily-summary-patch.js — v1 loaded");

(function () {
    // The phone sidebar hides every button not on this list (phone-extras-patch.js)
    if (typeof WDX_PHONE_KEEP !== 'undefined' && Array.isArray(WDX_PHONE_KEEP) && WDX_PHONE_KEEP.indexOf('daily summary') === -1) WDX_PHONE_KEEP.push('daily summary');

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function num(n) { return Number(n) || 0; }
    function money(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + (Math.round(num(n))).toLocaleString()); }
    function pad(n) { return String(n).padStart(2, '0'); }
    function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function localDay(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : dayKey(d); }
    function prevDay(key) { var p = key.split('-').map(Number); return dayKey(new Date(p[0], p[1] - 1, p[2] - 1)); }
    function nice(key) { var p = key.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function role() { return (typeof currentUserRole !== 'undefined' && currentUserRole) ? String(currentUserRole).toLowerCase().trim() : ''; }
    // Admin and Manager can use the Daily Summary. Only the Admin sees the PROFIT line, because it comes from cost prices
    // (managers do not see cost prices anywhere else). Change this to true to let managers see profit too.
    var WDSUM_MANAGER_SEES_PROFIT = false;
    function isOwner() { return (role() === 'admin' || role() === 'manager') && !!sid() && sid() !== 'SUPER_ADMIN'; }
    function showProfit() { return role() === 'admin' || WDSUM_MANAGER_SEES_PROFIT; }
    function read(path) { return firebase.database().ref(path).once('value').then(function (s) { return s.val(); }); }
    function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { } return null; }
    function waNum(p) {
        var d = String(p || '').split(/[,;/|]/)[0].replace(/\D/g, '');
        if (!d) return '';
        if (d.indexOf('234') === 0) return d;
        if (d.charAt(0) === '0') return '234' + d.slice(1);
        return d;
    }

    // =====================================================================
    // GATHER THE NUMBERS
    // =====================================================================
    async function gather(day) {
        var s = sid(), yday = prevDay(day);
        var type = '', name = s;
        try { type = String((await read('stores/' + s + '/storeType')) || '').toLowerCase(); } catch (e) { }
        try { name = (await read('stores/' + s + '/businessName')) || s; } catch (e) { }
        var out = { name: name, day: day, type: type, count: 0, total: 0, profit: null, prevTotal: 0, top: [], owed: null, low: null, stockNote: '' };
        var topMap = {};
        var addTop = function (n, v) { n = n || 'Item'; topMap[n] = (topMap[n] || 0) + num(v); };

        if (type.indexOf('phone') === 0) {
            var ps = (await read('phoneSales/' + s)) || {}, owedP = 0, owedPn = 0, prof = 0;
            Object.keys(ps).forEach(function (k) {
                var x = ps[k]; if (!x || x.refunded) return;
                var d = localDay(x.soldAt);
                if (d === day) { out.count++; out.total += num(x.price); prof += num(x.profit); addTop(((x.brand || '') + ' ' + (x.model || '')).trim(), x.price); }
                if (d === yday) out.prevTotal += num(x.price);
                var bal = num(x.balance); if (bal > 0) { owedP += bal; owedPn++; }
            });
            out.profit = prof; out.owed = { amount: owedP, n: owedPn };
            try {
                var inv = (await read('phoneInventory/' + s)) || {}, n = 0;
                Object.keys(inv).forEach(function (k) { if (inv[k] && inv[k].status === 'in_stock') n++; });
                out.stockNote = n + ' phone' + (n === 1 ? '' : 's') + ' in stock';
            } catch (e) { }

        } else if (type.indexOf('electronics') === 0) {
            var es = (await read('stores/' + s + '/elecSales')) || {}, owedE = 0, owedEn = 0, profE = 0;
            Object.keys(es).forEach(function (k) {
                var x = es[k]; if (!x || x.refunded) return;
                var d = localDay(x.soldAt);
                if (d === day) {
                    out.count++; out.total += num(x.net);
                    (x.lines || []).forEach(function (l) { profE += num(l.total) - num(l.cost) * num(l.qty); addTop(l.name, l.total); });
                    profE -= num(x.discount);
                }
                if (d === yday) out.prevTotal += num(x.net);
                var bal = num(x.balance); if (bal > 0) { owedE += bal; owedEn++; }
            });
            out.profit = profE; out.owed = { amount: owedE, n: owedEn };
            try {
                var st = (await read('stores/' + s + '/elecStock')) || {}, low = 0;
                Object.keys(st).forEach(function (k) {
                    var it = st[k]; if (!it) return;
                    var c = it.mode === 'serial' ? Object.keys(it.units || {}).filter(function (u) { return it.units[u].status === 'in_stock'; }).length : num(it.qty);
                    if (c <= (it.alert != null && it.alert !== '' ? num(it.alert) : 2)) low++;
                });
                out.low = low;
            } catch (e) { }

        } else {
            // general stores and building materials: stores/<id>/transactions
            var snap = await firebase.database().ref('stores/' + s + '/transactions').limitToLast(500).once('value');
            var costMap = {}, haveCost = false, inventory = {};
            try {
                inventory = (await read('stores/' + s + '/inventory')) || {};
                Object.keys(inventory).forEach(function (b) {
                    Object.keys(inventory[b] || {}).forEach(function (id) {
                        var p = inventory[b][id]; if (!p) return;
                        var nm = String(p.name || p.productName || '').toLowerCase().trim();
                        if (nm && num(p.costPrice) > 0) costMap[nm] = num(p.costPrice);
                    });
                });
            } catch (e) { }
            var profG = 0;
            snap.forEach(function (c) {
                var tx = c.val(); if (!tx || !tx.date || tx.refunded) return;
                var d = localDay(tx.date), t = num(tx.totalAmount);
                if (d === yday) out.prevTotal += t;
                if (d !== day) return;
                out.count++; out.total += t;
                var cost = 0;
                (tx.items || []).forEach(function (it) {
                    if (!it || it.id === '__delivery__') return;
                    addTop(it.name, it.total);
                    var ic = num(it.costPrice) || costMap[String(it.name || '').toLowerCase().trim()] || 0;
                    if (ic > 0) haveCost = true;
                    cost += ic * num(it.piecesNeeded !== undefined ? it.piecesNeeded : it.qty);
                });
                profG += t - cost;
            });
            if (haveCost) out.profit = profG;
            // low stock
            try {
                var low2 = 0;
                Object.keys(inventory).forEach(function (b) {
                    Object.keys(inventory[b] || {}).forEach(function (id) {
                        var p = inventory[b][id]; if (!p) return;
                        var stock = num(p.stock !== undefined ? p.stock : p.stockQty);
                        var thr = p.lowStockThreshold != null ? num(p.lowStockThreshold) : 5;
                        if (stock <= thr && stock >= 0) low2++;
                    });
                });
                out.low = low2;
            } catch (e) { }
            // Building Materials: the Credit Book
            if (type.indexOf('hardware') === 0 || type.indexOf('materials') === 0) {
                try {
                    var cr = (await read('stores/' + s + '/matCredit')) || {}, amt = 0, n2 = 0;
                    Object.keys(cr).forEach(function (k) {
                        var r = cr[k]; if (!r) return;
                        var paid = 0; Object.keys(r.payments || {}).forEach(function (pk) { paid += num(r.payments[pk].amount); });
                        var bal = num(r.total) - paid; if (bal > 0) { amt += bal; n2++; }
                    });
                    out.owed = { amount: amt, n: n2 };
                } catch (e) { }
            }
        }
        out.top = Object.keys(topMap).map(function (k) { return { name: k, v: topMap[k] }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 3);
        return out;
    }

    function buildText(o) {
        var L = [];
        L.push('📊 *Daily Summary — ' + o.name + '*');
        L.push(nice(o.day));
        L.push('');
        if (o.count === 0) {
            L.push('No sales recorded for this day.');
        } else {
            var line = '💰 Sales: *' + money(o.total) + '* (' + o.count + ' sale' + (o.count === 1 ? '' : 's') + ')';
            if (o.prevTotal > 0) {
                var pct = Math.round(((o.total - o.prevTotal) / o.prevTotal) * 100);
                line += '\n' + (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct) + '% vs the day before';
            }
            L.push(line);
            if (o.profit !== null && showProfit()) L.push('💵 Profit (est.): *' + money(o.profit) + '*');
            if (o.top.length) {
                L.push('');
                L.push('🏆 *Top sellers*');
                o.top.forEach(function (t, i) { L.push((i + 1) + '. ' + t.name + ' — ' + money(t.v)); });
            }
        }
        var extra = [];
        if (o.owed) extra.push('💳 Owed to you: *' + money(o.owed.amount) + '*' + (o.owed.n ? ' (' + o.owed.n + ' customer' + (o.owed.n === 1 ? '' : 's') + ')' : ''));
        if (o.low !== null && o.low > 0) extra.push('⚠️ Low stock: ' + o.low + ' item' + (o.low === 1 ? '' : 's'));
        if (o.stockNote) extra.push('📦 ' + o.stockNote);
        if (extra.length) { L.push(''); extra.forEach(function (x) { L.push(x); }); }
        L.push('');
        L.push('_Sent from Wise Decision_');
        return L.join('\n');
    }

    // =====================================================================
    // THE SCREEN
    // =====================================================================
    var cur = { which: 'today', text: '', obj: null };

    function openModal(inner) {
        var m = $('wdsum-modal'); if (m) m.remove();
        m = document.createElement('div');
        m.id = 'wdsum-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:1800;display:flex;justify-content:center;align-items:flex-end;';
        m.innerHTML = '<div style="background:#f8fafc;color:#0f172a;width:100%;max-width:520px;max-height:95vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;">' + inner + '</div>';
        document.body.appendChild(m);
    }
    window.wdsumClose = function () { var m = $('wdsum-modal'); if (m) m.remove(); };

    var INP = 'width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;';

    window.wdsumOpen = async function (which) {
        if (!isOwner()) return;
        cur.which = which === 'yesterday' ? 'yesterday' : 'today';
        var s = sid();
        var saved = ls('wdsum_num_' + s);
        if (saved === null) { try { saved = (await read('stores/' + s + '/phone')) || ''; } catch (e) { saved = ''; } }
        var hour = ls('wdsum_hour_' + s); if (hour === null) hour = '20';
        var hours = [['off', 'Off'], ['18', '6 pm'], ['19', '7 pm'], ['20', '8 pm'], ['21', '9 pm'], ['22', '10 pm']];
        openModal(
            '<div style="display:flex;justify-content:space-between;align-items:center;"><h3 style="margin:0;font-size:18px;">📲 Daily Summary</h3>' +
            '<button onclick="wdsumClose()" style="border:none;background:#e2e8f0;border-radius:99px;width:34px;height:34px;font-size:16px;cursor:pointer;">✕</button></div>' +
            '<div style="display:flex;gap:6px;margin:12px 0 8px;">' +
                '<button id="wdsum-t-today" onclick="wdsumSwitch(\'today\')" style="flex:1;padding:10px;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;">Today</button>' +
                '<button id="wdsum-t-yday" onclick="wdsumSwitch(\'yesterday\')" style="flex:1;padding:10px;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer;">Yesterday</button></div>' +
            '<pre id="wdsum-text" style="white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:12px;font-family:inherit;font-size:13px;line-height:1.5;min-height:120px;">Building your summary…</pre>' +
            '<label style="display:block;font-size:11px;font-weight:800;color:#334155;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.4px;">Send to this WhatsApp number</label>' +
            '<input id="wdsum-num" type="tel" inputmode="tel" value="' + esc(saved) + '" placeholder="0801… (leave empty to choose a contact)" style="' + INP + '">' +
            '<button id="wdsum-send" onclick="wdsumSend()" style="width:100%;margin-top:12px;padding:14px;border:none;border-radius:12px;font-size:15px;font-weight:800;color:#fff;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);cursor:pointer;">💬 Send on WhatsApp</button>' +
            '<button onclick="wdsumPrint()" style="width:100%;margin-top:8px;padding:13px;border:1px solid #bfdbfe;border-radius:12px;font-size:14px;font-weight:800;background:#eff6ff;color:#1d4ed8;cursor:pointer;">🖨 Print (thermal printer)</button>' +
            '<button onclick="wdsumCopy()" style="width:100%;margin-top:8px;padding:12px;border:1px solid #cbd5e1;border-radius:12px;font-size:14px;font-weight:700;background:#fff;cursor:pointer;">📋 Copy text</button>' +
            '<label style="display:block;font-size:11px;font-weight:800;color:#334155;margin:14px 0 5px;text-transform:uppercase;letter-spacing:.4px;">Remind me each evening at</label>' +
            '<select id="wdsum-hour" onchange="wdsumHour(this.value)" style="' + INP + '">' + hours.map(function (h) { return '<option value="' + h[0] + '"' + (h[0] === hour ? ' selected' : '') + '>' + h[1] + '</option>'; }).join('') + '</select>'
        );
        wdsumSwitch(cur.which);
    };

    window.wdsumSwitch = async function (which) {
        cur.which = which;
        var a = $('wdsum-t-today'), b = $('wdsum-t-yday');
        var on = 'border:none;background:#0284c7;color:#fff;', off = 'border:1px solid #cbd5e1;background:#fff;color:#334155;';
        if (a) a.style.cssText += ';' + (which === 'today' ? on : off);
        if (b) b.style.cssText += ';' + (which === 'yesterday' ? on : off);
        cur.obj = null;
        var pre = $('wdsum-text'); if (pre) pre.textContent = 'Building your summary…';
        var day = dayKey(new Date()); if (which === 'yesterday') day = prevDay(day);
        try {
            var o = await gather(day);
            cur.obj = o;
            cur.text = buildText(o);
        } catch (e) {
            cur.text = 'Could not build the summary: ' + (e.message || e);
        }
        pre = $('wdsum-text'); if (pre && cur.which === which) pre.textContent = cur.text;
    };

    window.wdsumHour = function (v) { ls('wdsum_hour_' + sid(), v); };

    window.wdsumSend = function () {
        if (!cur.text || /^Could not build|^Building/.test(cur.text)) { alert('The summary is not ready yet.'); return; }
        var raw = ($('wdsum-num') || {}).value || '';
        ls('wdsum_num_' + sid(), raw.trim());
        ls('wdsum_sent_' + sid(), dayKey(new Date()));
        removeToast();
        window.open('https://wa.me/' + waNum(raw) + '?text=' + encodeURIComponent(cur.text), '_blank');
    };
    window.wdsumCopy = function () {
        if (!cur.text) return;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(cur.text).then(function () { alert('Copied.'); }, function () { prompt('Copy this:', cur.text); });
        else prompt('Copy this:', cur.text);
    };

    // =====================================================================
    // PRINT (thermal receipt printer, 58/80 mm)
    // Plain text only (no emoji: thermal printers cannot draw them). Uses the app's own thermal print path
    // (triggerThermalPrint) when it exists, otherwise opens a small print page sized for an 80 mm roll.
    // =====================================================================
    function printHtml(o) {
        var dash = '<div style="border-top:1px dashed #000;margin:6px 0;"></div>';
        var row = function (l, r) { return '<div style="display:flex;justify-content:space-between;gap:8px;"><span>' + esc(l) + '</span><span style="font-weight:bold;text-align:right;">' + esc(r) + '</span></div>'; };
        var h = '<div style="font-family:monospace;font-size:12px;line-height:1.45;color:#000;width:100%;">' +
            '<div style="text-align:center;font-weight:bold;font-size:14px;">' + esc(String(o.name).toUpperCase()) + '</div>' +
            '<div style="text-align:center;font-weight:bold;">DAILY SUMMARY</div>' +
            '<div style="text-align:center;font-size:11px;">' + esc(nice(o.day)) + '</div>' + dash;
        if (o.count === 0) {
            h += '<div style="text-align:center;">No sales recorded.</div>';
        } else {
            h += row('Sales', money(o.total)) + row('No. of sales', String(o.count));
            if (o.prevTotal > 0) {
                var pct = Math.round(((o.total - o.prevTotal) / o.prevTotal) * 100);
                h += row('vs day before', (pct >= 0 ? '+' : '-') + Math.abs(pct) + '%');
            }
            if (o.profit !== null && showProfit()) h += row('Profit (est.)', money(o.profit));
            if (o.top.length) {
                h += dash + '<div style="font-weight:bold;">TOP SELLERS</div>';
                o.top.forEach(function (t, i) { h += row((i + 1) + '. ' + t.name, money(t.v)); });
            }
        }
        var extra = '';
        if (o.owed) extra += row('Owed to you', money(o.owed.amount)) + (o.owed.n ? '<div style="font-size:11px;text-align:right;">' + o.owed.n + ' customer' + (o.owed.n === 1 ? '' : 's') + '</div>' : '');
        if (o.low !== null && o.low > 0) extra += row('Low stock', o.low + ' item' + (o.low === 1 ? '' : 's'));
        if (o.stockNote) extra += '<div>' + esc(o.stockNote) + '</div>';
        if (extra) h += dash + extra;
        var by = (typeof currentStaffName !== 'undefined' && currentStaffName) ? currentStaffName : '';
        h += dash + '<div style="font-size:10px;text-align:center;">Printed ' + esc(new Date().toLocaleString()) + (by ? '<br>By ' + esc(by) : '') + '</div></div>';
        return h;
    }

    window.wdsumPrint = function () {
        if (!cur.obj) { alert('The summary is not ready yet.'); return; }
        var html = printHtml(cur.obj);
        if (typeof triggerThermalPrint === 'function') {
            try { triggerThermalPrint(html); return; } catch (e) { console.warn('[daily-summary] app print failed, using own page', e); }
        }
        var w = window.open('', '_blank');
        if (!w) { alert('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return; }
        w.document.open();
        w.document.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Daily Summary</title>' +
            '<style>@page{size:80mm auto;margin:0}html,body{margin:0;padding:0;background:#fff}body{width:76mm;padding:2mm;box-sizing:border-box}' +
            '@media screen{body{margin:10px auto;border:1px solid #ddd}}</style></head><body>' + html + '</body></html>');
        w.document.close();
        setTimeout(function () { try { w.focus(); w.print(); } catch (e) { } }, 400);
    };

    // =====================================================================
    // EVENING REMINDER CARD
    // =====================================================================
    function removeToast() { var t = $('wdsum-toast'); if (t) t.remove(); }
    window.wdsumLater = function () { try { sessionStorage.setItem('wdsum_later', '1'); } catch (e) { } removeToast(); };
    window.wdsumSkipToday = function () { ls('wdsum_skip_' + sid(), dayKey(new Date())); removeToast(); };

    function toastTick() {
        if (!isOwner()) { removeToast(); return; }
        var wrap = $('dashboard-main-wrapper');
        if (!wrap || !wrap.classList.contains('active')) { removeToast(); return; }
        var s = sid(), today = dayKey(new Date());
        var hour = ls('wdsum_hour_' + s); if (hour === null) hour = '20';
        var show = hour !== 'off' && new Date().getHours() >= parseInt(hour, 10) &&
            ls('wdsum_sent_' + s) !== today && ls('wdsum_skip_' + s) !== today;
        try { if (sessionStorage.getItem('wdsum_later') === '1') show = false; } catch (e) { }
        var t = $('wdsum-toast');
        if (!show) { if (t) t.remove(); return; }
        if (t) return;
        t = document.createElement('div');
        t.id = 'wdsum-toast';
        t.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:1200;max-width:440px;margin:0 auto;background:#fff;border:1px solid #bbf7d0;border-left:5px solid #22c55e;border-radius:14px;padding:12px 14px;box-shadow:0 10px 30px rgba(15,23,42,.25);font-family:system-ui,sans-serif;';
        t.innerHTML = '<div style="font-weight:800;font-size:14px;color:#0f172a;">📊 Today\'s summary is ready</div>' +
            '<div style="font-size:12px;color:#64748b;margin:3px 0 10px;">Send today\'s sales, profit and debts to your WhatsApp.</div>' +
            '<div style="display:flex;gap:8px;"><button onclick="wdsumOpen(\'today\')" style="flex:1;padding:10px;border:none;border-radius:10px;background:#16a34a;color:#fff;font-weight:800;font-size:13px;cursor:pointer;">Send now</button>' +
            '<button onclick="wdsumLater()" style="padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-weight:700;font-size:13px;cursor:pointer;">Later</button>' +
            '<button onclick="wdsumSkipToday()" title="Not today" style="padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;font-weight:700;font-size:13px;cursor:pointer;">✕</button></div>';
        document.body.appendChild(t);
    }

    // =====================================================================
    // SIDEBAR BUTTON (owner only), just above Logout
    // =====================================================================
    function addCss() {
        if ($('wdsum-css')) return;
        var st = document.createElement('style');
        st.id = 'wdsum-css';
        st.textContent = '#dashboard-main-wrapper .sidebar #wdsum-btn{background:#f0fdf4 !important;color:#15803d !important;border:1px solid #bbf7d0 !important;border-left:4px solid #22c55e !important;border-radius:12px !important;font-weight:700 !important;box-shadow:none !important;}';
        document.head.appendChild(st);
    }
    function findLogout(wrap) {
        var btns = wrap.querySelectorAll('.sidebar button');
        for (var i = 0; i < btns.length; i++) {
            if (/logout$/i.test((btns[i].textContent || '').trim())) return btns[i];
        }
        return null;
    }
    function attachButton() {
        var wrap = $('dashboard-main-wrapper');
        var btn = $('wdsum-btn');
        if (!wrap || !wrap.classList.contains('active') || !isOwner()) { if (btn) btn.remove(); return; }
        var logout = findLogout(wrap);
        if (!logout) return;
        addCss();
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'wdsum-btn';
            btn.className = 'menu-btn';
            btn.textContent = '📲 Daily Summary';
            btn.onclick = function () { wdsumOpen('today'); };
        }
        // only move it if it is missing or has ended up AFTER Logout (so other buttons may sit between)
        if (!btn.parentNode || btn.parentNode !== logout.parentNode || (btn.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) logout.parentNode.insertBefore(btn, logout);
    }

    function tick() { try { attachButton(); toastTick(); } catch (e) { console.warn('[daily-summary]', e); } }
    window.addEventListener('load', function () { setTimeout(tick, 1500); });
    setInterval(tick, 2500);
})();
