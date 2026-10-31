// ==================== WISE DECISION MATERIALS QUOTATIONS (feature 2 of 6) ====================
// Load AFTER materials-credit-patch.js.
//
// Quotations / proforma invoices for building-materials stores:
//   * pick items from your inventory (price fills in automatically, per bundle/bag or per single unit)
//     or type any item that is not in stock
//   * discount, delivery charge, validity (days), notes
//   * print / save as PDF, or share on WhatsApp
//   * mark accepted / declined, expired quotes are flagged automatically
//   * "Convert to Credit Sale" puts an accepted quote straight into the Credit Book
//
// Saved at stores/{storeId}/matQuotes/{id} — nothing existing is touched.
// For the sidebar button to show, 'quotation' must be in the keep lists of vertical-first-patch.js
// (already added in the v3.14 copy of that file).

console.log("Wise Decision materials-quote-patch.js — v1 loaded");

(function () {
    // ---------- helpers ----------
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function num(n) { return Number(n) || 0; }
    function money(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + num(n).toLocaleString()); }
    function pad(n, w) { return String(n).padStart(w || 2, '0'); }
    function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function $(id) { return document.getElementById(id); }
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function qref(path) { return firebase.database().ref('stores/' + sid() + '/matQuotes' + (path ? '/' + path : '')); }
    function who() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
    function storeName() { return (typeof currentStoreName !== 'undefined' && currentStoreName) ? currentStoreName : (sid() || 'Our Store'); }
    function fmtDate(v) { var d = new Date(v); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(); }

    var cache = [];      // quotes
    var invItems = [];   // inventory for the item picker
    var tab = 'open';
    var query = '';

    // ---------- styles ----------
    function addStyles() {
        if ($('wcq-styles')) return;
        var st = document.createElement('style');
        st.id = 'wcq-styles';
        st.textContent =
        '.wcq{max-width:720px;margin:0 auto;color:#0f172a;}' +
        '.wcq *{box-sizing:border-box;}' +
        '.wcq h2{margin:0 0 2px 0;font-size:20px;}' +
        '.wcq-sub{font-size:12px;color:#64748b;margin-bottom:12px;}' +
        '.wcq-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;}' +
        '.wcq-tile{background:#fff;border:1px solid #e8eef5;border-radius:12px;padding:10px 12px;}' +
        '.wcq-tile small{display:block;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.3px;}' +
        '.wcq-tile b{display:block;font-size:15px;margin-top:3px;}' +
        '.wcq-add{width:100%;border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:800;color:#fff;background:linear-gradient(135deg,#f97316 0%,#c2410c 100%);box-shadow:0 8px 18px rgba(234,88,12,.28);cursor:pointer;margin-bottom:10px;}' +
        '.wcq-search{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;margin-bottom:8px;background:#fff;}' +
        '.wcq-tabs{display:flex;gap:6px;margin-bottom:10px;}' +
        '.wcq-tabs button{flex:1;padding:9px;border:1px solid #e2e8f0;background:#fff;border-radius:10px;font-size:13px;font-weight:700;color:#475569;cursor:pointer;}' +
        '.wcq-tabs button.on{background:#ea580c;border-color:#ea580c;color:#fff;}' +
        '.wcq-card{background:#fff;border:1px solid #e8eef5;border-left:4px solid #f97316;border-radius:14px;padding:12px 14px;margin-bottom:8px;cursor:pointer;}' +
        '.wcq-card.exp{border-left-color:#ef4444;}' +
        '.wcq-card.acc{border-left-color:#22c55e;}' +
        '.wcq-card.dec{border-left-color:#94a3b8;opacity:.8;}' +
        '.wcq-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;}' +
        '.wcq-name{font-weight:800;font-size:15px;}' +
        '.wcq-no{font-size:11px;color:#64748b;margin-top:2px;}' +
        '.wcq-amt{text-align:right;font-weight:800;font-size:16px;white-space:nowrap;}' +
        '.wcq-meta{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:11px;color:#64748b;}' +
        '.wcq-badge{font-size:10px;font-weight:800;padding:3px 8px;border-radius:99px;background:#fff7ed;color:#c2410c;}' +
        '.wcq-badge.exp{background:#fee2e2;color:#b91c1c;}' +
        '.wcq-badge.acc{background:#dcfce7;color:#166534;}' +
        '.wcq-badge.dec{background:#f1f5f9;color:#475569;}' +
        '.wcq-empty{text-align:center;color:#94a3b8;padding:30px 10px;font-size:13px;}' +
        '.wcq-row{background:#fff;border:1px solid #e8eef5;border-radius:12px;padding:10px;margin-bottom:8px;}' +
        '.wcq-row input,.wcq-row select{width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:9px;font-size:16px;background:#fff;}' +
        '.wcq-rg{display:grid;grid-template-columns:70px 1fr 1fr;gap:6px;margin-top:6px;}' +
        '.wcq-rl{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:13px;}' +
        '.wcq-rl button{border:none;background:#fee2e2;color:#b91c1c;border-radius:8px;padding:6px 10px;font-weight:700;font-size:12px;cursor:pointer;}';
        document.head.appendChild(st);
    }

    // ---------- data ----------
    async function loadQuotes() {
        var snap = await qref().once('value');
        var arr = [];
        snap.forEach(function (c) { var v = c.val(); if (v) { v.id = c.key; arr.push(v); } });
        arr.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
        return arr;
    }
    function status(q) {
        if (q.status === 'accepted') return 'acc';
        if (q.status === 'declined') return 'dec';
        if (q.validUntil && q.validUntil < dayKey(new Date())) return 'exp';
        return 'open';
    }
    function statusLabel(s) { return { open: 'Open', exp: 'Expired', acc: 'Accepted', dec: 'Declined' }[s]; }

    async function loadInventory() {
        var snap = await firebase.database().ref('stores/' + sid() + '/inventory').once('value');
        var inv = snap.val() || {};
        var seen = {}, out = [];
        Object.keys(inv).forEach(function (b) {
            Object.keys(inv[b] || {}).forEach(function (id) {
                var p = inv[b][id]; if (!p) return;
                var name = p.name || p.productName; if (!name) return;
                var k = name.toLowerCase().trim(); if (seen[k]) return; seen[k] = true;
                var per = Math.max(1, num(p.unitsPerPack) || 1);
                var retail = num(p.retailPrice || p.price);
                out.push({
                    name: name, per: per,
                    base: p.baseUnitName || 'piece', bulk: p.bulkUnitName || 'pack',
                    retail: retail,
                    pretail: per > 1 ? (num(p.piecePrice) || Math.round(retail / per)) : retail
                });
            });
        });
        out.sort(function (a, b) { return a.name.localeCompare(b.name); });
        return out;
    }

    // ---------- list page ----------
    window.wcqShowQuotes = async function () {
        var ws = $('workspace-content'); if (!ws) return;
        addStyles();
        ws.innerHTML =
        '<div class="wcq">' +
            '<h2>📄 Quotations</h2>' +
            '<div class="wcq-sub">Price quotes for customers — print, share, and turn into a sale when they say yes.</div>' +
            '<div class="wcq-tiles">' +
                '<div class="wcq-tile"><small>Open quotes</small><b id="wcq-t-open">0</b></div>' +
                '<div class="wcq-tile"><small>Open value</small><b id="wcq-t-val">₦0</b></div>' +
                '<div class="wcq-tile"><small>Accepted</small><b id="wcq-t-acc" style="color:#16a34a;">0</b></div>' +
            '</div>' +
            '<button class="wcq-add" onclick="wcqOpenEditor()">➕ New Quotation</button>' +
            '<input id="wcq-search" class="wcq-search" placeholder="Search customer or quote number…" oninput="wcqSearch(this.value)">' +
            '<div class="wcq-tabs" id="wcq-tabs"></div>' +
            '<div id="wcq-list"><div class="wcq-empty">Loading…</div></div>' +
        '</div>';
        $('wcq-search').value = query;
        try { cache = await loadQuotes(); } catch (e) { var l = $('wcq-list'); if (l) l.innerHTML = '<div class="wcq-empty">Could not load: ' + esc(e.message) + '</div>'; return; }
        renderList();
    };
    window.wcqSearch = function (v) { query = String(v || ''); renderList(); };
    window.wcqTab = function (t) { tab = t; renderList(); };

    function renderList() {
        var listEl = $('wcq-list'); if (!listEl) return;
        var open = cache.filter(function (q) { return status(q) === 'open'; });
        var set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
        set('wcq-t-open', String(open.length));
        set('wcq-t-val', money(open.reduce(function (s, q) { return s + num(q.total); }, 0)));
        set('wcq-t-acc', String(cache.filter(function (q) { return q.status === 'accepted'; }).length));

        var tabsEl = $('wcq-tabs');
        if (tabsEl) {
            tabsEl.innerHTML = [['open', 'Open'], ['done', 'Accepted'], ['all', 'All']].map(function (x) {
                return '<button class="' + (tab === x[0] ? 'on' : '') + '" onclick="wcqTab(\'' + x[0] + '\')">' + x[1] + '</button>';
            }).join('');
        }
        var q = query.toLowerCase().trim();
        var rows = cache.filter(function (x) {
            var s = status(x);
            if (tab === 'open' && s !== 'open' && s !== 'exp') return false;
            if (tab === 'done' && s !== 'acc') return false;
            if (!q) return true;
            return (String(x.customer || '') + ' ' + String(x.no || '')).toLowerCase().indexOf(q) !== -1;
        });
        if (rows.length === 0) {
            listEl.innerHTML = '<div class="wcq-empty">' + (cache.length === 0 ? 'No quotations yet. Tap “New Quotation” to make the first one.' : 'Nothing here.') + '</div>';
            return;
        }
        listEl.innerHTML = rows.map(function (x) {
            var s = status(x);
            return '<div class="wcq-card ' + s + '" onclick="wcqOpen(\'' + esc(x.id) + '\')">' +
                '<div class="wcq-top"><div><div class="wcq-name">' + esc(x.customer || 'Customer') + '</div><div class="wcq-no">' + esc(x.no) + ' · ' + (x.lines ? x.lines.length : 0) + ' item' + ((x.lines && x.lines.length === 1) ? '' : 's') + '</div></div>' +
                '<div class="wcq-amt">' + money(x.total) + '</div></div>' +
                '<div class="wcq-meta"><span>' + esc(fmtDate(x.createdAt)) + (x.validUntil ? ' · valid to ' + esc(fmtDate(x.validUntil)) : '') + '</span><span class="wcq-badge ' + s + '">' + statusLabel(s) + '</span></div>' +
            '</div>';
        }).join('');
    }

    // ---------- modal shell ----------
    var INP = 'width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;';
    var LBL = 'display:block;font-size:11px;font-weight:800;color:#334155;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.4px;';
    function openModal(inner) {
        var m = $('wcq-modal'); if (m) m.remove();
        m = document.createElement('div');
        m.id = 'wcq-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:1800;display:flex;justify-content:center;align-items:flex-end;';
        m.innerHTML = '<div style="background:#f8fafc;color:#0f172a;width:100%;max-width:560px;max-height:95vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;">' + inner + '</div>';
        document.body.appendChild(m);
    }
    window.wcqClose = function () { var m = $('wcq-modal'); if (m) m.remove(); };
    function head(title) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><h3 style="margin:0;font-size:18px;">' + title + '</h3>' +
               '<button onclick="wcqClose()" style="border:none;background:#e2e8f0;border-radius:99px;width:34px;height:34px;font-size:16px;cursor:pointer;">✕</button></div>';
    }
    function fail(m) { var e = $('wcq-err'); if (e) { e.textContent = m; e.style.display = 'block'; } }

    // ---------- editor ----------
    window.wcqOpenEditor = async function () {
        addStyles();
        try { invItems = await loadInventory(); } catch (e) { invItems = []; }
        var names = invItems.map(function (i) { return '<option value="' + esc(i.name) + '">'; }).join('');
        openModal(
            head('📄 New Quotation') +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:6px;">' +
                '<label style="' + LBL + '">Customer name</label><input id="wcq-cust" style="' + INP + '" placeholder="e.g. Mr. Okafor">' +
                '<div style="display:grid;grid-template-columns:1fr 110px;gap:10px;">' +
                    '<div><label style="' + LBL + '">Phone (for WhatsApp)</label><input id="wcq-phone" type="tel" inputmode="tel" style="' + INP + '" placeholder="0801…"></div>' +
                    '<div><label style="' + LBL + '">Valid (days)</label><input id="wcq-days" type="number" min="1" inputmode="numeric" value="7" style="' + INP + '"></div>' +
                '</div>' +
            '</div>' +
            '<div style="font-weight:800;font-size:13px;margin:14px 0 6px;">Items</div>' +
            '<datalist id="wcq-items">' + names + '</datalist>' +
            '<div id="wcq-rows"></div>' +
            '<button onclick="wcqAddRow()" style="width:100%;padding:12px;border:1px dashed #f97316;border-radius:12px;background:#fff7ed;color:#c2410c;font-weight:800;font-size:14px;cursor:pointer;">➕ Add item</button>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:12px;">' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                    '<div><label style="' + LBL + '">Discount (₦)</label><input id="wcq-disc" type="number" min="0" inputmode="decimal" style="' + INP + '" placeholder="0" oninput="wcqCalc()"></div>' +
                    '<div><label style="' + LBL + '">Delivery (₦)</label><input id="wcq-deliv" type="number" min="0" inputmode="decimal" style="' + INP + '" placeholder="0" oninput="wcqCalc()"></div>' +
                '</div>' +
                '<label style="' + LBL + '">Notes (optional)</label><input id="wcq-notes" style="' + INP + '" placeholder="e.g. Price valid while stock lasts">' +
                '<div style="display:flex;justify-content:space-between;margin-top:14px;font-size:13px;color:#64748b;"><span>Subtotal</span><span id="wcq-sub">₦0</span></div>' +
                '<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:18px;font-weight:800;color:#c2410c;"><span>Total</span><span id="wcq-total">₦0</span></div>' +
            '</div>' +
            '<div id="wcq-err" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px;border-radius:10px;font-size:13px;margin-top:12px;"></div>' +
            '<button onclick="wcqSave()" style="width:100%;margin-top:14px;padding:15px;border:none;border-radius:14px;font-size:16px;font-weight:800;color:#fff;background:linear-gradient(135deg,#f97316 0%,#c2410c 100%);cursor:pointer;">Save Quotation</button>'
        );
        wcqAddRow();
    };

    window.wcqAddRow = function () {
        var box = $('wcq-rows'); if (!box) return;
        var d = document.createElement('div');
        d.className = 'wcq-row';
        d.innerHTML =
            '<input class="wcq-name-in" list="wcq-items" placeholder="Item (pick from stock or type)" oninput="wcqName(this)" onchange="wcqName(this)">' +
            '<div class="wcq-rg">' +
                '<input class="wcq-qty" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Qty" oninput="wcqCalc()">' +
                '<select class="wcq-unit" onchange="wcqUnit(this)"><option value="unit" data-price="0">unit</option></select>' +
                '<input class="wcq-price" type="number" min="0" inputmode="decimal" placeholder="Price ₦" oninput="wcqCalc()">' +
            '</div>' +
            '<div class="wcq-rl"><span>Line: <b class="wcq-lt">₦0</b></span><button onclick="this.closest(\'.wcq-row\').remove();wcqCalc();">Remove</button></div>';
        box.appendChild(d);
    };

    // item typed / picked: if it matches stock, fill units and price
    window.wcqName = function (el) {
        var row = el.closest('.wcq-row');
        var v = (el.value || '').toLowerCase().trim();
        var it = invItems.filter(function (i) { return i.name.toLowerCase().trim() === v; })[0];
        if (!it) return;
        var sel = row.querySelector('.wcq-unit');
        var html = '';
        if (it.per > 1) {
            html += '<option value="' + esc(it.bulk) + '" data-price="' + it.retail + '">' + esc(it.bulk) + '</option>';
            html += '<option value="' + esc(it.base) + '" data-price="' + it.pretail + '">' + esc(it.base) + '</option>';
        } else {
            html += '<option value="' + esc(it.base) + '" data-price="' + it.retail + '">' + esc(it.base) + '</option>';
        }
        sel.innerHTML = html;
        row.querySelector('.wcq-price').value = sel.options[0].getAttribute('data-price');
        var q = row.querySelector('.wcq-qty'); if (!q.value) q.value = 1;
        wcqCalc();
    };
    window.wcqUnit = function (sel) {
        var row = sel.closest('.wcq-row');
        var p = num(sel.options[sel.selectedIndex].getAttribute('data-price'));
        if (p > 0) row.querySelector('.wcq-price').value = p;
        wcqCalc();
    };

    function collect() {
        var lines = [];
        document.querySelectorAll('#wcq-rows .wcq-row').forEach(function (r) {
            var name = (r.querySelector('.wcq-name-in').value || '').trim();
            var qty = num(r.querySelector('.wcq-qty').value);
            var price = num(r.querySelector('.wcq-price').value);
            var sel = r.querySelector('.wcq-unit');
            if (!name || qty <= 0) return;
            lines.push({ name: name, qty: qty, unit: sel.value || 'unit', price: price, total: Math.round(qty * price * 100) / 100 });
        });
        return lines;
    }
    window.wcqCalc = function () {
        var sub = 0;
        document.querySelectorAll('#wcq-rows .wcq-row').forEach(function (r) {
            var lt = num(r.querySelector('.wcq-qty').value) * num(r.querySelector('.wcq-price').value);
            r.querySelector('.wcq-lt').textContent = money(lt);
            sub += lt;
        });
        var total = Math.max(0, sub - num(($('wcq-disc') || {}).value) + num(($('wcq-deliv') || {}).value));
        if ($('wcq-sub')) $('wcq-sub').textContent = money(sub);
        if ($('wcq-total')) $('wcq-total').textContent = money(total);
    };

    window.wcqSave = async function () {
        var cust = ($('wcq-cust').value || '').trim();
        if (!cust) return fail('Enter the customer name.');
        var lines = collect();
        if (lines.length === 0) return fail('Add at least one item with a quantity.');
        if (lines.some(function (l) { return l.price <= 0; })) return fail('Every item needs a price.');
        var sub = lines.reduce(function (s, l) { return s + l.total; }, 0);
        var disc = num($('wcq-disc').value), deliv = num($('wcq-deliv').value);
        if (disc > sub) return fail('Discount is bigger than the items total.');
        var days = Math.max(1, Math.floor(num($('wcq-days').value) || 7));
        var vu = new Date(); vu.setDate(vu.getDate() + days);
        try {
            var node = qref().push();
            await node.set({
                no: 'QT-' + pad(cache.length + 1, 4),
                customer: cust,
                phone: ($('wcq-phone').value || '').trim(),
                notes: ($('wcq-notes').value || '').trim(),
                lines: lines,
                subtotal: sub, discount: disc, delivery: deliv, total: sub - disc + deliv,
                validUntil: dayKey(vu),
                status: 'open',
                createdAt: new Date().toISOString(),
                createdBy: who()
            });
            wcqClose();
            await refresh();
            var made = cache.filter(function (x) { return x.id === node.key; })[0];
            if (made) wcqOpen(made.id);
        } catch (e) { fail('Could not save: ' + (e.message || e)); }
    };

    async function refresh() {
        try { cache = await loadQuotes(); } catch (e) { return; }
        if ($('wcq-list')) renderList();
        var card = $('wcq-dash-card'); if (card) fillDashCard(card);
    }

    // ---------- details ----------
    function find(id) { return cache.filter(function (x) { return x.id === id; })[0]; }

    window.wcqOpen = function (id) {
        var q = find(id); if (!q) return;
        var s = status(q);
        var lines = (q.lines || []).map(function (l) {
            return '<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">' +
                '<div><strong>' + esc(l.name) + '</strong><span style="display:block;font-size:11px;color:#64748b;">' + esc(l.qty) + ' ' + esc(l.unit) + ' × ' + money(l.price) + '</span></div>' +
                '<strong>' + money(l.total) + '</strong></div>';
        }).join('');
        var canAct = (s === 'open' || s === 'exp');
        openModal(
            head(esc(q.no)) +
            '<div style="font-size:15px;font-weight:800;">' + esc(q.customer) + ' <span class="wcq-badge ' + s + '" style="margin-left:6px;">' + statusLabel(s) + '</span></div>' +
            (q.phone ? '<div style="font-size:13px;color:#475569;margin-top:2px;">📞 ' + esc(q.phone) + '</div>' : '') +
            '<div style="font-size:12px;color:#64748b;margin-top:2px;">Issued ' + esc(fmtDate(q.createdAt)) + (q.validUntil ? ' · valid to ' + esc(fmtDate(q.validUntil)) : '') + '</div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:6px 14px;margin-top:12px;">' + lines +
                '<div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-top:8px;"><span>Subtotal</span><span>' + money(q.subtotal) + '</span></div>' +
                (num(q.discount) ? '<div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;"><span>Discount</span><span>−' + money(q.discount) + '</span></div>' : '') +
                (num(q.delivery) ? '<div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;"><span>Delivery</span><span>' + money(q.delivery) + '</span></div>' : '') +
                '<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;color:#c2410c;margin:8px 0;"><span>Total</span><span>' + money(q.total) + '</span></div>' +
            '</div>' +
            (q.notes ? '<div style="font-size:12px;color:#64748b;margin-top:8px;">Note: ' + esc(q.notes) + '</div>' : '') +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">' +
                '<button onclick="wcqPrint(\'' + esc(id) + '\')" style="padding:13px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;font-weight:800;font-size:14px;cursor:pointer;">🖨️ Print / PDF</button>' +
                '<button onclick="wcqWhatsApp(\'' + esc(id) + '\')" style="padding:13px;border:1px solid #bbf7d0;border-radius:12px;background:#f0fdf4;color:#15803d;font-weight:800;font-size:14px;cursor:pointer;">💬 WhatsApp</button>' +
            '</div>' +
            (canAct
                ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;">' +
                    '<button onclick="wcqSetStatus(\'' + esc(id) + '\',\'accepted\')" style="padding:13px;border:none;border-radius:12px;background:#16a34a;color:#fff;font-weight:800;font-size:14px;cursor:pointer;">✅ Accepted</button>' +
                    '<button onclick="wcqSetStatus(\'' + esc(id) + '\',\'declined\')" style="padding:13px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;color:#475569;font-weight:800;font-size:14px;cursor:pointer;">Declined</button>' +
                  '</div>'
                : '') +
            ((q.status === 'accepted' && !q.convertedToCredit)
                ? '<button onclick="wcqToCredit(\'' + esc(id) + '\')" style="width:100%;margin-top:8px;padding:13px;border:1px solid #fed7aa;border-radius:12px;background:#fff7ed;color:#c2410c;font-weight:800;font-size:14px;cursor:pointer;">🧾 Convert to Credit Sale</button>'
                : '') +
            (q.convertedToCredit ? '<div style="text-align:center;margin-top:10px;font-size:12px;color:#16a34a;font-weight:700;">Added to the Credit Book</div>' : '') +
            '<div id="wcq-err" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px;border-radius:10px;font-size:13px;margin-top:12px;"></div>'
        );
    };

    window.wcqSetStatus = async function (id, st) {
        try { await qref(id + '/status').set(st); await refresh(); wcqOpen(id); }
        catch (e) { fail('Could not update: ' + (e.message || e)); }
    };

    // accepted quote → Credit Book (same ledger as materials-credit-patch.js)
    window.wcqToCredit = async function (id) {
        var q = find(id); if (!q) return;
        try {
            var items = (q.lines || []).map(function (l) { return l.qty + ' ' + l.name; }).join(', ');
            if (items.length > 140) items = items.slice(0, 137) + '…';
            await firebase.database().ref('stores/' + sid() + '/matCredit').push({
                customer: q.customer, phone: q.phone || '',
                note: q.no + ': ' + items,
                total: num(q.total), dueDate: '',
                createdAt: new Date().toISOString(), createdBy: who(), fromQuote: id
            });
            await qref(id + '/convertedToCredit').set(true);
            await refresh();
            alert('✅ Added to the Credit Book. Open it to record any deposit.');
            wcqOpen(id);
        } catch (e) { fail('Could not convert: ' + (e.message || e)); }
    };

    // ---------- share / print ----------
    function waNumber(p) {
        var d = String(p || '').replace(/\D/g, '');
        if (!d) return '';
        if (d.indexOf('234') === 0) return d;
        if (d.charAt(0) === '0') return '234' + d.slice(1);
        return d;
    }
    window.wcqWhatsApp = function (id) {
        var q = find(id); if (!q) return;
        var t = '*' + storeName() + '*\nQuotation ' + q.no + '\nFor: ' + q.customer + '\n\n';
        (q.lines || []).forEach(function (l, i) { t += (i + 1) + '. ' + l.name + ' — ' + l.qty + ' ' + l.unit + ' × ' + money(l.price) + ' = ' + money(l.total) + '\n'; });
        t += '\nSubtotal: ' + money(q.subtotal) + '\n';
        if (num(q.discount)) t += 'Discount: −' + money(q.discount) + '\n';
        if (num(q.delivery)) t += 'Delivery: ' + money(q.delivery) + '\n';
        t += '*Total: ' + money(q.total) + '*\n';
        if (q.validUntil) t += '\nValid until ' + fmtDate(q.validUntil) + '.';
        if (q.notes) t += '\n' + q.notes;
        window.open('https://wa.me/' + waNumber(q.phone) + '?text=' + encodeURIComponent(t), '_blank');
    };

    window.wcqPrint = function (id) {
        var q = find(id); if (!q) return;
        var rows = (q.lines || []).map(function (l, i) {
            return '<tr><td>' + (i + 1) + '</td><td>' + esc(l.name) + '</td><td style="text-align:right">' + esc(l.qty) + ' ' + esc(l.unit) + '</td><td style="text-align:right">' + money(l.price) + '</td><td style="text-align:right">' + money(l.total) + '</td></tr>';
        }).join('');
        var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(q.no) + '</title>' +
            '<style>body{font-family:system-ui,Arial,sans-serif;color:#111;margin:24px;max-width:760px}h1{margin:0;font-size:22px}h2{margin:18px 0 4px;font-size:15px;letter-spacing:2px;color:#c2410c}' +
            'table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}th{background:#fff7ed;text-align:left}th,td{padding:8px;border-bottom:1px solid #e5e7eb}' +
            '.r{display:flex;justify-content:space-between;font-size:13px;margin-top:6px}.t{font-size:18px;font-weight:800;color:#c2410c;border-top:2px solid #111;padding-top:8px;margin-top:10px}' +
            '.s{font-size:12px;color:#555;margin-top:2px}@media print{button{display:none}}</style></head><body>' +
            '<h1>' + esc(storeName()) + '</h1><h2>QUOTATION</h2>' +
            '<div class="s">No: <b>' + esc(q.no) + '</b> &nbsp;·&nbsp; Date: ' + esc(fmtDate(q.createdAt)) + (q.validUntil ? ' &nbsp;·&nbsp; Valid until: ' + esc(fmtDate(q.validUntil)) : '') + '</div>' +
            '<div class="s" style="margin-top:10px">Prepared for: <b>' + esc(q.customer) + '</b>' + (q.phone ? ' · ' + esc(q.phone) : '') + '</div>' +
            '<table><thead><tr><th>#</th><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
            '<div class="r"><span>Subtotal</span><span>' + money(q.subtotal) + '</span></div>' +
            (num(q.discount) ? '<div class="r"><span>Discount</span><span>−' + money(q.discount) + '</span></div>' : '') +
            (num(q.delivery) ? '<div class="r"><span>Delivery</span><span>' + money(q.delivery) + '</span></div>' : '') +
            '<div class="r t"><span>TOTAL</span><span>' + money(q.total) + '</span></div>' +
            (q.notes ? '<p class="s">Note: ' + esc(q.notes) + '</p>' : '') +
            '<p class="s" style="margin-top:18px">Prices may change after the validity date. Thank you for your business.</p>' +
            '<button onclick="window.print()" style="margin-top:14px;padding:10px 18px;font-size:15px">Print / Save as PDF</button></body></html>';
        var w = window.open('', '_blank');
        if (!w) { fail('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return; }
        w.document.open(); w.document.write(html); w.document.close();
        setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
    };

    // ---------- dashboard card + sidebar button ----------
    function fillDashCard(card) {
        var open = cache.filter(function (q) { return status(q) === 'open'; });
        var val = open.reduce(function (s, q) { return s + num(q.total); }, 0);
        card.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
                '<div><div style="font-size:11px;font-weight:800;color:#92400e;text-transform:uppercase;letter-spacing:.4px;">📄 Quotations</div>' +
                '<div style="font-size:18px;font-weight:800;color:#b45309;margin-top:2px;">' + open.length + ' open <span style="font-size:12px;font-weight:600;color:#92400e;">worth ' + money(val) + '</span></div></div>' +
                '<div style="font-size:22px;">›</div>' +
            '</div>';
    }
    function injectDashCard() {
        if (!isMat() || !sid()) return;
        var grid = document.querySelector('.wdd-actions');
        if (!grid || $('wcq-dash-card')) return;
        var card = document.createElement('div');
        card.id = 'wcq-dash-card';
        card.style.cssText = 'background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:14px;padding:12px 14px;margin-bottom:12px;cursor:pointer;';
        card.onclick = function () { wcqShowQuotes(); };
        card.innerHTML = '<div style="font-size:13px;color:#92400e;">Loading quotations…</div>';
        grid.parentNode.insertBefore(card, grid.nextSibling);
        loadQuotes().then(function (a) { cache = a; fillDashCard(card); }).catch(function () {
            card.innerHTML = '<div style="font-size:13px;font-weight:700;color:#92400e;">📄 Open Quotations ›</div>';
        });
    }
    function injectSidebarBtn() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar'); if (!side) return;
        var existing = $('wcq-sidebar-btn');
        var admin = (typeof currentUserRole !== 'undefined') && currentUserRole === 'Admin' && sid() && sid() !== 'SUPER_ADMIN';
        if (!isMat() || !admin) { if (existing) existing.remove(); return; }
        if (existing) return;
        var anchor = $('wcr-sidebar-btn') || $('wdm-sidebar-wastage-btn') || $('wdm-sidebar-newsale-btn') || $('wdm-sidebar-materials-btn');
        if (!anchor) return;
        var b = document.createElement('button');
        b.id = 'wcq-sidebar-btn';
        b.className = 'menu-btn';
        b.textContent = '📄 Quotations';
        b.onclick = function () { wcqShowQuotes(); };
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }
    function addSidebarCss() {
        if ($('wcq-sidebar-css')) return;
        var st = document.createElement('style');
        st.id = 'wcq-sidebar-css';
        st.textContent = 'body.wdd-mat #dashboard-main-wrapper .sidebar #wcq-sidebar-btn{background:#fffbeb !important;color:#92400e !important;border-color:#fde68a !important;border-left-color:#d97706 !important;}';
        document.head.appendChild(st);
    }
    function attach() {
        try { addSidebarCss(); injectSidebarBtn(); injectDashCard(); } catch (e) { console.warn('[quote-patch]', e); }
    }
    window.addEventListener('load', function () {
        setTimeout(attach, 1500);
        var obs = new MutationObserver(function () { attach(); });
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    });
})();
