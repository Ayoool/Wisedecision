// ==================== WISE DECISION MATERIALS REORDER LIST ====================
// Load AFTER materials-quote-patch.js.
//
// Turns your low-stock items into a shopping list you can send to a supplier:
//   * every item at or below its low-stock alert is listed with a suggested order quantity
//   * tick / untick items, change the quantity, see the estimated cost (qty x cost price)
//   * items are grouped by supplier IF the product has a supplier saved on it (otherwise "No supplier")
//   * share the list on WhatsApp or print it
//
// Read-only: it only reads your inventory. Nothing is saved or changed.
// Sidebar button: needs 'reorder' in the keep lists of vertical-first-patch.js (included in v3.17).
//
// Assumes stock is counted in bulk units (bundle / bag / carton), the same as the dashboard.

console.log("Wise Decision materials-reorder-patch.js — v1 loaded");

(function () {
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function num(n) { return Number(n) || 0; }
    function money(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + num(n).toLocaleString()); }
    function $(id) { return document.getElementById(id); }
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function storeName() { return (typeof currentStoreName !== 'undefined' && currentStoreName) ? currentStoreName : (sid() || 'Our Store'); }

    var rows = [];          // { name, unit, stock, alert, qty, cost, supplier, branch, on }
    var multiBranch = false;
    var suppliers = [];     // { name, phone } read from your Suppliers list (if it can be found)

    function addStyles() {
        if ($('wrq-styles')) return;
        var st = document.createElement('style');
        st.id = 'wrq-styles';
        st.textContent =
        '.wrq{max-width:720px;margin:0 auto;color:#0f172a;}' +
        '.wrq *{box-sizing:border-box;}' +
        '.wrq h2{margin:0 0 2px 0;font-size:20px;}' +
        '.wrq-sub{font-size:12px;color:#64748b;margin-bottom:12px;}' +
        '.wrq-tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}' +
        '.wrq-tile{background:#fff;border:1px solid #e8eef5;border-radius:12px;padding:10px 12px;}' +
        '.wrq-tile small{display:block;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.3px;}' +
        '.wrq-tile b{display:block;font-size:17px;margin-top:3px;}' +
        '.wrq-acts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}' +
        '.wrq-acts button{padding:13px 6px;border-radius:12px;font-weight:800;font-size:14px;cursor:pointer;}' +
        '.wrq-grp{font-size:11px;font-weight:800;color:#854d0e;text-transform:uppercase;letter-spacing:.4px;background:#fefce8;border-radius:8px;padding:6px 10px;margin:12px 0 6px;}' +
        '.wrq-card{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #e8eef5;border-left:4px solid #eab308;border-radius:14px;padding:10px 12px;margin-bottom:6px;}' +
        '.wrq-card.off{opacity:.5;}' +
        '.wrq-card input[type=checkbox]{width:20px;height:20px;margin:0;flex-shrink:0;}' +
        '.wrq-info{flex:1;min-width:0;}' +
        '.wrq-name{font-weight:800;font-size:14px;}' +
        '.wrq-note{font-size:11px;color:#64748b;margin-top:2px;}' +
        '.wrq-qty{width:78px;padding:10px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;text-align:center;}' +
        '.wrq-cost{font-size:11px;color:#854d0e;font-weight:700;text-align:right;margin-top:3px;}' +
        '.wrq-empty{text-align:center;color:#16a34a;padding:30px 10px;font-size:14px;font-weight:700;}';
        document.head.appendChild(st);
    }

    async function loadRows() {
        var snap = await firebase.database().ref('stores/' + sid() + '/inventory').once('value');
        var inv = snap.val() || {};
        var out = [];
        var branches = Object.keys(inv);
        multiBranch = branches.length > 1;
        branches.forEach(function (b) {
            Object.keys(inv[b] || {}).forEach(function (id) {
                var p = inv[b][id]; if (!p) return;
                var stock = num(p.stock !== undefined ? p.stock : p.stockQty);
                var alert = (p.lowStockThreshold != null) ? num(p.lowStockThreshold) : 5;
                if (stock > alert) return;
                var target = Math.max(alert * 3, 10);
                out.push({
                    name: p.name || p.productName || 'Unnamed',
                    unit: p.bulkUnitName || 'pack',
                    stock: stock, alert: alert,
                    qty: Math.max(1, Math.ceil(target - stock)),
                    cost: num(p.costPrice),
                    supplier: (p.supplier || p.supplierName || '').toString().trim(),
                    branch: b, on: true
                });
            });
        });
        out.sort(function (a, b) {
            return (a.supplier || '~').localeCompare(b.supplier || '~') || a.stock - b.stock || a.name.localeCompare(b.name);
        });
        return out;
    }

    // Read the Suppliers list. The shape is not known for sure, so this looks for objects that have a name
    // (name / supplierName / companyName / businessName) and a phone (phone / phoneNumber / mobile / contact / tel).
    async function loadSuppliers() {
        var out = [];
        try {
            var snap = await firebase.database().ref('stores/' + sid() + '/suppliers').once('value');
            var val = snap.val();
            (function walk(o, depth) {
                if (!o || typeof o !== 'object' || depth > 2) return;
                Object.keys(o).forEach(function (k) {
                    var v = o[k];
                    if (!v || typeof v !== 'object') return;
                    var name = v.name || v.supplierName || v.companyName || v.businessName;
                    if (name) out.push({ name: String(name), phone: String(v.phone || v.phoneNumber || v.mobile || v.contact || v.tel || '') });
                    else walk(v, depth + 1);
                });
            })(val, 0);
        } catch (e) { /* no suppliers list: typing a supplier still works */ }
        out.sort(function (a, b) { return a.name.localeCompare(b.name); });
        return out;
    }

    function fillSupplierSelect() {
        var sel = $('wrq-sup'); if (!sel) return;
        sel.innerHTML = '<option value="">Choose a supplier…</option>' +
            suppliers.map(function (x, i) { return '<option value="' + i + '">' + esc(x.name) + '</option>'; }).join('') +
            '<option value="__other">Someone else (type below)…</option>';
    }
    window.wrqSupChange = function () {
        var sel = $('wrq-sup'), nm = $('wrq-sup-name'), ph = $('wrq-sup-phone');
        if (!sel) return;
        if (sel.value === '__other') { nm.style.display = 'block'; nm.focus(); ph.value = ''; return; }
        nm.style.display = 'none';
        ph.value = (sel.value !== '' && suppliers[+sel.value]) ? suppliers[+sel.value].phone : '';
    };
    function chosenSupplier() {
        var sel = $('wrq-sup'); if (!sel) return { name: '', phone: '' };
        var name = '';
        if (sel.value === '__other') name = ($('wrq-sup-name').value || '').trim();
        else if (sel.value !== '' && suppliers[+sel.value]) name = suppliers[+sel.value].name;
        return { name: name, phone: ($('wrq-sup-phone').value || '').trim() };
    }
    function waNumber(p) {
        var d = String(p || '').replace(/\D/g, '');
        if (!d) return '';
        if (d.indexOf('234') === 0) return d;
        if (d.charAt(0) === '0') return '234' + d.slice(1);
        return d;
    }

    window.wrqShowReorder = async function () {
        var ws = $('workspace-content'); if (!ws) return;
        addStyles();
        ws.innerHTML =
        '<div class="wrq">' +
            '<h2>📋 Reorder List</h2>' +
            '<div class="wrq-sub">Everything that is running low, ready to send to your supplier. Change quantities as you like.</div>' +
            '<div class="wrq-tiles">' +
                '<div class="wrq-tile"><small>Items selected</small><b id="wrq-t-n">0</b></div>' +
                '<div class="wrq-tile"><small>Estimated cost</small><b id="wrq-t-cost">₦0</b></div>' +
            '</div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:10px 12px;margin-bottom:10px;">' +
                '<div style="font-size:11px;font-weight:800;color:#334155;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Send this order to</div>' +
                '<select id="wrq-sup" onchange="wrqSupChange()" style="width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;background:#fff;"><option value="">Choose a supplier…</option></select>' +
                '<input id="wrq-sup-name" placeholder="Supplier name" style="display:none;width:100%;margin-top:8px;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;">' +
                '<input id="wrq-sup-phone" type="tel" inputmode="tel" placeholder="Supplier WhatsApp number (optional)" style="width:100%;margin-top:8px;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;">' +
            '</div>' +
            '<div class="wrq-acts">' +
                '<button onclick="wrqWhatsApp()" style="border:1px solid #bbf7d0;background:#f0fdf4;color:#15803d;">💬 WhatsApp</button>' +
                '<button onclick="wrqPrint()" style="border:1px solid #cbd5e1;background:#fff;color:#334155;">🖨️ Print list</button>' +
            '</div>' +
            '<div id="wrq-list"><div style="text-align:center;color:#94a3b8;padding:30px;">Checking stock…</div></div>' +
        '</div>';
        try { var res = await Promise.all([loadRows(), loadSuppliers()]); rows = res[0]; suppliers = res[1]; fillSupplierSelect(); } catch (e) { $('wrq-list').innerHTML = '<div style="text-align:center;color:#991b1b;padding:30px;">Could not load: ' + esc(e.message) + '</div>'; return; }
        renderList();
    };

    function renderList() {
        var el = $('wrq-list'); if (!el) return;
        if (rows.length === 0) { el.innerHTML = '<div class="wrq-empty">✅ Nothing to reorder. All stock is above its alert level.</div>'; totals(); return; }
        var html = '', last = null;
        rows.forEach(function (r, i) {
            var g = r.supplier || 'No supplier';
            if (g !== last) { html += '<div class="wrq-grp">' + esc(g) + '</div>'; last = g; }
            html += '<div class="wrq-card' + (r.on ? '' : ' off') + '" id="wrq-r' + i + '">' +
                '<input type="checkbox"' + (r.on ? ' checked' : '') + ' onchange="wrqToggle(' + i + ',this.checked)">' +
                '<div class="wrq-info"><div class="wrq-name">' + esc(r.name) + '</div>' +
                '<div class="wrq-note">Have ' + r.stock + ' ' + esc(r.unit) + ' · alert at ' + r.alert + (multiBranch ? ' · ' + esc(r.branch) : '') + '</div></div>' +
                '<div><input class="wrq-qty" type="number" min="0" step="1" inputmode="numeric" value="' + r.qty + '" oninput="wrqQty(' + i + ',this.value)">' +
                '<div class="wrq-cost" id="wrq-c' + i + '">' + (r.cost ? money(r.qty * r.cost) : esc(r.unit)) + '</div></div>' +
            '</div>';
        });
        el.innerHTML = html;
        totals();
    }

    function totals() {
        var n = 0, cost = 0;
        rows.forEach(function (r) { if (r.on && r.qty > 0) { n++; cost += r.qty * r.cost; } });
        if ($('wrq-t-n')) $('wrq-t-n').textContent = String(n);
        if ($('wrq-t-cost')) $('wrq-t-cost').textContent = money(cost);
    }
    window.wrqToggle = function (i, on) {
        rows[i].on = !!on;
        var c = $('wrq-r' + i); if (c) c.classList.toggle('off', !on);
        totals();
    };
    window.wrqQty = function (i, v) {
        rows[i].qty = Math.max(0, num(v));
        var c = $('wrq-c' + i); if (c) c.textContent = rows[i].cost ? money(rows[i].qty * rows[i].cost) : rows[i].unit;
        totals();
    };

    function picked() { return rows.filter(function (r) { return r.on && r.qty > 0; }); }

    window.wrqWhatsApp = function () {
        var p = picked();
        if (p.length === 0) { alert('Tick at least one item first.'); return; }
        var sup = chosenSupplier();
        var t = sup.name ? 'Hello ' + sup.name + ',\n\n' : '';
        t += '*Order request — ' + storeName() + '*\n' + new Date().toLocaleDateString() + '\n\n';
        var cost = 0;
        p.forEach(function (r, i) {
            t += (i + 1) + '. ' + r.name + ' — ' + r.qty + ' ' + r.unit + '\n';
            cost += r.qty * r.cost;
        });
        if (cost > 0) t += '\nEstimated cost: ' + money(cost);
        t += '\n\nPlease confirm availability and price. Thank you.';
        window.open('https://wa.me/' + waNumber(sup.phone) + '?text=' + encodeURIComponent(t), '_blank');
    };

    window.wrqPrint = function () {
        var p = picked();
        if (p.length === 0) { alert('Tick at least one item first.'); return; }
        var cost = 0;
        var body = p.map(function (r, i) {
            cost += r.qty * r.cost;
            return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.supplier || '—') + '</td>' +
                '<td style="text-align:right">' + r.stock + ' ' + esc(r.unit) + '</td>' +
                '<td style="text-align:right"><b>' + r.qty + ' ' + esc(r.unit) + '</b></td>' +
                '<td style="text-align:right">' + (r.cost ? money(r.qty * r.cost) : '—') + '</td></tr>';
        }).join('');
        var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reorder list</title>' +
            '<style>body{font-family:system-ui,Arial,sans-serif;color:#111;margin:24px;max-width:780px}h1{margin:0;font-size:22px}h2{margin:14px 0 4px;font-size:15px;letter-spacing:2px;color:#a16207}' +
            'table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}th{background:#fefce8;text-align:left}th,td{padding:8px;border-bottom:1px solid #e5e7eb}' +
            '.t{text-align:right;font-weight:800;margin-top:12px;font-size:16px}@media print{button{display:none}}</style></head><body>' +
            '<h1>' + esc(storeName()) + '</h1><h2>REORDER LIST</h2><div style="font-size:12px;color:#555">' + esc(new Date().toLocaleDateString()) + (chosenSupplier().name ? ' &nbsp;·&nbsp; To: <b>' + esc(chosenSupplier().name) + '</b>' : '') + '</div>' +
            '<table><thead><tr><th>#</th><th>Item</th><th>Supplier</th><th style="text-align:right">In stock</th><th style="text-align:right">Order</th><th style="text-align:right">Est. cost</th></tr></thead><tbody>' + body + '</tbody></table>' +
            (cost > 0 ? '<div class="t">Estimated total: ' + money(cost) + '</div>' : '') +
            '<button onclick="window.print()" style="margin-top:18px;padding:10px 18px;font-size:15px">Print / Save as PDF</button></body></html>';
        var w = window.open('', '_blank');
        if (!w) { alert('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return; }
        w.document.open(); w.document.write(html); w.document.close();
        setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
    };

    // ---------- dashboard card + sidebar button ----------
    function fillDashCard(card, n) {
        card.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
                '<div><div style="font-size:11px;font-weight:800;color:#854d0e;text-transform:uppercase;letter-spacing:.4px;">📋 Reorder List</div>' +
                '<div style="font-size:18px;font-weight:800;color:#a16207;margin-top:2px;">' + (n === 0 ? 'Stock looks healthy' : n + ' item' + (n === 1 ? '' : 's') + ' to restock') + '</div></div>' +
                '<div style="font-size:22px;">›</div>' +
            '</div>';
    }
    function injectDashCard() {
        if (!isMat() || !sid()) return;
        var grid = document.querySelector('.wdd-actions');
        if (!grid || $('wrq-dash-card')) return;
        var card = document.createElement('div');
        card.id = 'wrq-dash-card';
        card.style.cssText = 'background:#fefce8;border:1px solid #fde047;border-left:4px solid #eab308;border-radius:14px;padding:12px 14px;margin-bottom:12px;cursor:pointer;';
        card.onclick = function () { wrqShowReorder(); };
        card.innerHTML = '<div style="font-size:13px;color:#854d0e;">Checking stock…</div>';
        grid.parentNode.insertBefore(card, grid.nextSibling);
        loadRows().then(function (r) { fillDashCard(card, r.length); }).catch(function () {
            card.innerHTML = '<div style="font-size:13px;font-weight:700;color:#854d0e;">📋 Open Reorder List ›</div>';
        });
    }
    function injectSidebarBtn() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar'); if (!side) return;
        var existing = $('wrq-sidebar-btn');
        var admin = (typeof currentUserRole !== 'undefined') && currentUserRole === 'Admin' && sid() && sid() !== 'SUPER_ADMIN';
        if (!isMat() || !admin) { if (existing) existing.remove(); return; }
        if (existing) return;
        var anchor = $('wcq-sidebar-btn') || $('wcr-sidebar-btn') || $('wdm-sidebar-wastage-btn') || $('wdm-sidebar-newsale-btn') || $('wdm-sidebar-materials-btn');
        if (!anchor) return;
        var b = document.createElement('button');
        b.id = 'wrq-sidebar-btn';
        b.className = 'menu-btn';
        b.textContent = '📋 Reorder List';
        b.onclick = function () { wrqShowReorder(); };
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }
    function addSidebarCss() {
        if ($('wrq-sidebar-css')) return;
        var st = document.createElement('style');
        st.id = 'wrq-sidebar-css';
        st.textContent = 'body.wdd-mat #dashboard-main-wrapper .sidebar #wrq-sidebar-btn{background:#fefce8 !important;color:#854d0e !important;border-color:#fde047 !important;border-left-color:#eab308 !important;}';
        document.head.appendChild(st);
    }
    function attach() {
        try { addSidebarCss(); injectSidebarBtn(); injectDashCard(); } catch (e) { console.warn('[reorder-patch]', e); }
    }
    window.addEventListener('load', function () {
        setTimeout(attach, 1600);
        var obs = new MutationObserver(function () { attach(); });
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    });
})();
