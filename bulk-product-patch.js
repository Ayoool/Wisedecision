// ==================== WISE DECISION BULK PRODUCT PATCH (v2) ====================
// Load with defer, anywhere after script.js (loading it last is fine).
//
// When someone taps "Add New Product" in Inventory, they are first asked:
//     📦 Single product   |   📚 Bulk products
//   * Single  -> the normal Add Product form opens, exactly as before.
//   * Bulk    -> a sheet of rows opens (Name, Cost, Price, Stock + optional Category, Wholesale price,
//                Expiry). They can also paste a list and the rows fill themselves.
//
// Each product row asks: "Sold in small units (pieces)?"  No / Yes
//   * No  -> the product is one whole unit (pack size 1), with one price.
//   * Yes -> they enter pieces per pack, pack and piece names, the retail and wholesale price per piece, and the stock as
//            packs + loose pieces. Stock is saved in pieces (packs x pieces per pack + loose pieces).
//
// Bulk adds go into the branch currently selected in Inventory, skip names that already exist there,
// respect the store's plan product limit, and save in ONE database write.

(function () {
    'use strict';
    console.log('Wise Decision bulk-product-patch.js — v2 loaded');

    var START_ROWS = 5, MAX_ROWS = 300;
    var passNext = false;   // lets the very next "Add New Product" click through to the original form
    var defaultSmall = false;   // new rows start as "sold in small units" when true

    function el(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; }

    // ---------------------------------------------------------------
    // 1. Intercept "Add New Product"
    // ---------------------------------------------------------------
    function isAddProductButton(b) {
        if (!b) return false;
        if (b.closest('#wdbp-choose') || b.closest('#wdbp-modal')) return false;
        var t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        return t.length < 40 && /\badd (a )?(new )?product\b/.test(t);
    }

    document.addEventListener('click', function (e) {
        if (passNext) { passNext = false; return; }
        var b = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!isAddProductButton(b)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        openChooser(b);
    }, true);

    function clickOriginal(btn) {
        var target = btn;
        if (!target || !document.body.contains(target)) {
            target = null;
            document.querySelectorAll('button').forEach(function (b) { if (!target && isAddProductButton(b)) target = b; });
        }
        if (!target) return;
        passNext = true;
        setTimeout(function () { passNext = false; }, 800);
        target.click();
    }

    function openChooser(btn) {
        var old = el('wdbp-choose');
        if (old) old.remove();
        var m = document.createElement('div');
        m.id = 'wdbp-choose';
        m.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.65); display:flex; justify-content:center; align-items:center; z-index:1800; padding:16px; box-sizing:border-box;';
        var tile = 'width:100%; text-align:left; padding:14px; margin-bottom:10px; border-radius:12px; cursor:pointer; font-family:inherit; display:block;';
        m.innerHTML =
            '<div style="background:#fff; color:#0f172a; border-radius:14px; width:100%; max-width:380px; padding:20px; box-sizing:border-box;">' +
                '<h3 style="margin:0 0 4px; font-size:17px;">Add products</h3>' +
                '<p style="margin:0 0 14px; font-size:13px; color:#64748b;">Do you want to add a single product or bulk?</p>' +
                '<button id="wdbp-pick-single" style="' + tile + ' background:#f0f9ff; border:1px solid #bae6fd;">' +
                    '<span style="display:block; font-weight:bold; font-size:15px; color:#0369a1;">📦 Single product</span>' +
                    '<span style="display:block; font-size:12px; color:#475569; margin-top:2px;">One product with all its details</span></button>' +
                '<button id="wdbp-pick-bulk" style="' + tile + ' background:#f0fdf4; border:1px solid #bbf7d0;">' +
                    '<span style="display:block; font-weight:bold; font-size:15px; color:#166534;">📚 Bulk products</span>' +
                    '<span style="display:block; font-size:12px; color:#475569; margin-top:2px;">Add many products at once</span></button>' +
                '<button id="wdbp-pick-cancel" style="width:100%; padding:10px; border-radius:10px; border:1px solid #cbd5e1; background:#f1f5f9; cursor:pointer; font-family:inherit;">Cancel</button>' +
            '</div>';
        document.body.appendChild(m);
        el('wdbp-pick-single').onclick = function () { m.remove(); clickOriginal(btn); };
        el('wdbp-pick-bulk').onclick = function () { m.remove(); openBulk(); };
        el('wdbp-pick-cancel').onclick = function () { m.remove(); };
    }

    // ---------------------------------------------------------------
    // 2. The bulk sheet
    // ---------------------------------------------------------------
    var IN = 'width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:16px; box-sizing:border-box; font-family:inherit; min-width:0;';

    function rowHtml() {
        return '<div class="wdbp-row" data-small="0" style="border:1px solid #e2e8f0; border-radius:10px; padding:10px; margin-bottom:8px; background:#fff;">' +
            '<div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">' +
                '<span class="wdbp-n" style="font-size:11px; font-weight:bold; color:#64748b; min-width:20px;">1</span>' +
                '<input class="wdbp-name" type="text" placeholder="Product name" autocapitalize="characters" style="' + IN + ' flex:1;">' +
                '<button type="button" onclick="wdbpRemoveRow(this)" style="padding:6px 10px; border:1px solid #fecaca; background:#fef2f2; color:#991b1b; border-radius:8px; cursor:pointer;">✕</button>' +
            '</div>' +
            '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px;">' +
                '<input class="wdbp-cost" type="number" inputmode="decimal" min="0" step="any" placeholder="Cost ₦" style="' + IN + '">' +
                '<input class="wdbp-price" type="number" inputmode="decimal" min="0" step="any" placeholder="Retail ₦" style="' + IN + '">' +
                '<input class="wdbp-stock" type="number" inputmode="decimal" min="0" step="any" placeholder="Stock" style="' + IN + '">' +
            '</div>' +
            '<input class="wdbp-wh" type="number" inputmode="decimal" min="0" step="any" placeholder="Wholesale ₦ (blank = same as retail)" style="' + IN + ' margin-top:6px;">' +
            '<div style="display:flex; align-items:center; gap:6px; margin-top:8px; flex-wrap:wrap;">' +
                '<span style="font-size:12px; font-weight:bold; color:#334155;">Sold in small units (pieces)?</span>' +
                '<button type="button" class="wdbp-no" onclick="wdbpSetSmall(this, false)" style="padding:6px 14px; border-radius:8px; cursor:pointer; font-weight:bold;">No</button>' +
                '<button type="button" class="wdbp-yes" onclick="wdbpSetSmall(this, true)" style="padding:6px 14px; border-radius:8px; cursor:pointer; font-weight:bold;">Yes</button>' +
            '</div>' +
            '<div class="wdbp-small-box" style="display:none; margin-top:8px; padding:10px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px;">' +
                '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">' +
                    '<div><label style="display:block; font-size:11px; color:#0369a1; margin-bottom:2px;">Pieces in 1 pack</label>' +
                        '<input class="wdbp-upp" type="number" inputmode="numeric" min="2" step="1" placeholder="e.g. 10" style="' + IN + '"></div>' +
                    '<div><label style="display:block; font-size:11px; color:#0369a1; margin-bottom:2px;">Retail price per piece ₦</label>' +
                        '<input class="wdbp-pp" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 150" style="' + IN + '"></div>' +
                    '<div><label style="display:block; font-size:11px; color:#0369a1; margin-bottom:2px;">Pack name</label>' +
                        '<input class="wdbp-packname" type="text" value="Pack" style="' + IN + '"></div>' +
                    '<div><label style="display:block; font-size:11px; color:#0369a1; margin-bottom:2px;">Piece name</label>' +
                        '<input class="wdbp-piecename" type="text" value="Piece" style="' + IN + '"></div>' +
                    '<div><label style="display:block; font-size:11px; color:#0369a1; margin-bottom:2px;">Wholesale price per piece ₦</label>' +
                        '<input class="wdbp-pwh" type="number" inputmode="decimal" min="0" step="any" placeholder="blank = same as retail" style="' + IN + '"></div>' +
                    '<div><label style="display:block; font-size:11px; color:#0369a1; margin-bottom:2px;">Extra loose pieces in stock</label>' +
                        '<input class="wdbp-extra" type="number" inputmode="numeric" min="0" step="1" placeholder="0" style="' + IN + '"></div>' +
                '</div>' +
                '<div style="font-size:11px; color:#475569; margin-top:6px;">Cost, Retail, Wholesale and Stock above are then <strong>per pack</strong> (Stock = number of packs). The two piece prices are per single piece.</div>' +
            '</div>' +
            '<details style="margin-top:6px;"><summary style="font-size:12px; color:#0369a1; cursor:pointer;">More options</summary>' +
                '<input class="wdbp-cat" type="text" placeholder="Category" style="' + IN + ' margin-top:6px;">' +
                '<label style="display:block; font-size:11px; color:#64748b; margin:6px 0 2px;">Expiry date (optional)</label>' +
                '<input class="wdbp-exp" type="date" style="' + IN + '">' +
            '</details>' +
        '</div>';
    }

    // Show / hide the small-unit fields of one row and restyle its Yes / No buttons
    function applySmall(row, yes) {
        row.dataset.small = yes ? '1' : '0';
        row.querySelector('.wdbp-small-box').style.display = yes ? 'block' : 'none';
        var on = 'background:#16a34a; color:#fff; border:1px solid #16a34a;';
        var offStyle = 'background:#fff; color:#475569; border:1px solid #cbd5e1;';
        var noB = row.querySelector('.wdbp-no'), yesB = row.querySelector('.wdbp-yes');
        var base = 'padding:6px 14px; border-radius:8px; cursor:pointer; font-weight:bold; ';
        noB.style.cssText = base + (yes ? offStyle : 'background:#475569; color:#fff; border:1px solid #475569;');
        yesB.style.cssText = base + (yes ? on : offStyle);
        row.querySelector('.wdbp-cost').placeholder = yes ? 'Pack cost ₦' : 'Cost ₦';
        row.querySelector('.wdbp-price').placeholder = yes ? 'Pack retail ₦' : 'Retail ₦';
        row.querySelector('.wdbp-stock').placeholder = yes ? 'Packs' : 'Stock';
        row.querySelector('.wdbp-wh').placeholder = yes ? 'Pack wholesale ₦ (blank = same as retail)' : 'Wholesale ₦ (blank = same as retail)';
    }

    window.wdbpSetSmall = function (btn, yes) {
        var row = btn.closest('.wdbp-row');
        if (row) applySmall(row, yes);
    };

    // "All rows" shortcut, also used for rows added afterwards
    window.wdbpSetAll = function (yes) {
        defaultSmall = !!yes;
        allRows().forEach(function (r) { applySmall(r, defaultSmall); });
        var a = el('wdbp-all-no'), b = el('wdbp-all-yes');
        if (a && b) {
            a.style.background = defaultSmall ? '#fff' : '#475569'; a.style.color = defaultSmall ? '#475569' : '#fff';
            b.style.background = defaultSmall ? '#16a34a' : '#fff'; b.style.color = defaultSmall ? '#fff' : '#475569';
        }
    };

    function rowsEl() { return el('wdbp-rows'); }
    function allRows() { return rowsEl() ? Array.prototype.slice.call(rowsEl().querySelectorAll('.wdbp-row')) : []; }
    function renumber() { allRows().forEach(function (r, i) { r.querySelector('.wdbp-n').textContent = i + 1; }); updateCount(); }
    function updateCount() {
        var n = allRows().filter(function (r) { return r.querySelector('.wdbp-name').value.trim(); }).length;
        var c = el('wdbp-count');
        if (c) c.textContent = n + ' product' + (n === 1 ? '' : 's') + ' ready to add';
    }

    window.wdbpAddRows = function (n) {
        var box = rowsEl();
        if (!box) return;
        var room = MAX_ROWS - allRows().length;
        n = Math.min(n, room);
        if (n <= 0) { alert('You can add up to ' + MAX_ROWS + ' products at a time.'); return; }
        var html = '';
        for (var i = 0; i < n; i++) html += rowHtml();
        box.insertAdjacentHTML('beforeend', html);
        allRows().slice(-n).forEach(function (r) { applySmall(r, defaultSmall); });
        renumber();
    };

    window.wdbpRemoveRow = function (btn) {
        var row = btn.closest('.wdbp-row');
        if (row) row.remove();
        if (allRows().length === 0) wdbpAddRows(1);
        renumber();
    };

    window.wdbpClose = function () {
        var m = el('wdbp-modal');
        if (m) m.remove();
    };

    // Paste a list: one product per line   Name, Cost, Price, Stock   (comma, tab, ; or | between)
    window.wdbpApplyPaste = function () {
        var ta = el('wdbp-paste');
        var lines = (ta ? ta.value : '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
        if (!lines.length) { alert('Paste or type your list first.'); return; }
        // drop empty starter rows
        allRows().forEach(function (r) {
            if (!r.querySelector('.wdbp-name').value.trim() && !r.querySelector('.wdbp-cost').value && !r.querySelector('.wdbp-price').value && !r.querySelector('.wdbp-stock').value) r.remove();
        });
        var room = MAX_ROWS - allRows().length;
        if (lines.length > room) { alert('Only the first ' + room + ' lines were used (limit ' + MAX_ROWS + ' per save).'); lines = lines.slice(0, room); }
        var html = '';
        lines.forEach(function () { html += rowHtml(); });
        rowsEl().insertAdjacentHTML('beforeend', html);
        var rows = allRows().slice(-lines.length);
        rows.forEach(function (r) { applySmall(r, defaultSmall); });
        lines.forEach(function (line, i) {
            var p = line.split(/[\t,;|]+/).map(function (x) { return x.trim(); });
            var r = rows[i];
            r.querySelector('.wdbp-name').value = p[0] || '';
            if (p[1]) r.querySelector('.wdbp-cost').value = num(p[1]);
            if (p[2]) r.querySelector('.wdbp-price').value = num(p[2]);
            if (p[3]) r.querySelector('.wdbp-stock').value = num(p[3]);
            if (num(p[4]) > 1) {                       // optional: pieces per pack + price per piece
                applySmall(r, true);
                r.querySelector('.wdbp-upp').value = Math.round(num(p[4]));
                if (p[5]) r.querySelector('.wdbp-pp').value = num(p[5]);
                if (p[6]) r.querySelector('.wdbp-pwh').value = num(p[6]);
            }
        });
        if (ta) ta.value = '';
        renumber();
        alert('Filled ' + lines.length + ' row' + (lines.length === 1 ? '' : 's') + '. Check them below, then tap "Add products".');
    };

    function openBulk() {
        var old = el('wdbp-modal');
        if (old) old.remove();
        var m = document.createElement('div');
        m.id = 'wdbp-modal';
        m.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; justify-content:center; align-items:center; z-index:1800; padding:12px; box-sizing:border-box;';
        m.innerHTML =
            '<div style="background:#f8fafc; color:#0f172a; border-radius:14px; width:100%; max-width:560px; max-height:94vh; display:flex; flex-direction:column; box-sizing:border-box;">' +
                '<div style="padding:16px 16px 8px; display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">' +
                    '<div><h3 style="margin:0; font-size:17px;">📚 Add products in bulk</h3>' +
                    '<p style="margin:4px 0 0; font-size:12px; color:#64748b;">Name and retail price are needed. Cost and stock are optional. Tap Yes on a row if it is also sold in pieces.</p></div>' +
                    '<button type="button" onclick="wdbpClose()" style="padding:6px 12px; border:none; background:#e2e8f0; border-radius:8px; cursor:pointer;">✕</button>' +
                '</div>' +
                '<div style="padding:0 16px; overflow-y:auto; flex:1;">' +
                    '<details style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:10px; margin-bottom:10px;">' +
                        '<summary style="font-size:13px; font-weight:bold; color:#0369a1; cursor:pointer;">📋 Paste a list instead</summary>' +
                        '<p style="font-size:11px; color:#64748b; margin:8px 0 6px;">One product per line: <strong>Name, Cost, Retail price, Stock</strong><br>Example: <em>Peak Milk 400g, 1200, 1500, 24</em><br>Sold in pieces too? Add <strong>pieces per pack, retail per piece, wholesale per piece</strong> at the end:<br><em>Paracetamol, 800, 1200, 10, 10, 150, 130</em><br>Do not use commas inside numbers.</p>' +
                        '<textarea id="wdbp-paste" rows="5" style="' + IN + ' font-family:monospace;" placeholder="Peak Milk 400g, 1200, 1500, 24"></textarea>' +
                        '<button type="button" onclick="wdbpApplyPaste()" style="margin-top:8px; padding:9px 14px; border-radius:8px; border:none; background:#0284c7; color:#fff; font-weight:bold; cursor:pointer;">Fill rows from list</button>' +
                    '</details>' +
                    '<div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:10px;">' +
                        '<span style="font-size:12px; color:#334155; font-weight:bold;">Set all rows:</span>' +
                        '<button id="wdbp-all-no" type="button" onclick="wdbpSetAll(false)" style="padding:6px 12px; border-radius:8px; border:1px solid #475569; background:#475569; color:#fff; font-weight:bold; cursor:pointer;">Whole units only</button>' +
                        '<button id="wdbp-all-yes" type="button" onclick="wdbpSetAll(true)" style="padding:6px 12px; border-radius:8px; border:1px solid #16a34a; background:#fff; color:#475569; font-weight:bold; cursor:pointer;">Packs + pieces</button>' +
                    '</div>' +
                    '<div id="wdbp-rows"></div>' +
                    '<button type="button" onclick="wdbpAddRows(5)" style="width:100%; padding:10px; margin-bottom:10px; border-radius:10px; border:1px dashed #94a3b8; background:#fff; color:#334155; font-weight:bold; cursor:pointer;">➕ Add 5 more rows</button>' +
                '</div>' +
                '<div style="padding:10px 16px 16px; border-top:1px solid #e2e8f0; background:#fff; border-radius:0 0 14px 14px;">' +
                    '<div id="wdbp-error" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-bottom:8px; white-space:pre-line;"></div>' +
                    '<div id="wdbp-count" style="font-size:12px; color:#64748b; margin-bottom:8px;">0 products ready to add</div>' +
                    '<div style="display:flex; gap:8px;">' +
                        '<button id="wdbp-save" type="button" onclick="wdbpSave()" style="flex:1; padding:12px; border-radius:10px; border:none; background:#16a34a; color:#fff; font-weight:bold; font-size:14px; cursor:pointer;">✔ Add products</button>' +
                        '<button type="button" onclick="wdbpClose()" style="padding:12px 16px; border-radius:10px; border:1px solid #cbd5e1; background:#f1f5f9; cursor:pointer;">Cancel</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(m);
        m.addEventListener('input', updateCount);
        defaultSmall = false;
        wdbpAddRows(START_ROWS);
    }

    // ---------------------------------------------------------------
    // 3. Save
    // ---------------------------------------------------------------
    window.wdbpSave = async function () {
        var err = el('wdbp-error');
        err.style.display = 'none';
        var fail = function (msg) { err.textContent = msg; err.style.display = 'block'; };

        var sid = (typeof currentStoreId !== 'undefined') ? currentStoreId : null;
        if (!sid || sid === 'SUPER_ADMIN') return fail('No store is open.');

        // Read the rows
        var items = [], seen = {}, dupInList = [];
        var problems = [];
        allRows().forEach(function (r, idx) {
            var name = r.querySelector('.wdbp-name').value.trim();
            var costRaw = r.querySelector('.wdbp-cost').value;
            var priceRaw = r.querySelector('.wdbp-price').value;
            var stockRaw = r.querySelector('.wdbp-stock').value;
            var cat = r.querySelector('.wdbp-cat').value.trim();
            var whRaw = r.querySelector('.wdbp-wh').value;
            var exp = r.querySelector('.wdbp-exp').value;
            var small = r.dataset.small === '1';
            var uppRaw = r.querySelector('.wdbp-upp').value;
            var ppRaw = r.querySelector('.wdbp-pp').value;
            var pwhRaw = r.querySelector('.wdbp-pwh').value;
            var extraRaw = r.querySelector('.wdbp-extra').value;
            var anything = name || costRaw || priceRaw || stockRaw || cat || whRaw || exp || (small && (uppRaw || ppRaw || pwhRaw || extraRaw));
            if (!anything) return;                       // empty row, ignore
            var n = idx + 1;
            if (!name) { problems.push('Row ' + n + ': type the product name.'); return; }
            var cost = num(costRaw), price = num(priceRaw), stock = num(stockRaw), wh = num(whRaw);
            if (!(price > 0)) { problems.push('Row ' + n + ' (' + name + '): enter the ' + (small ? 'pack ' : '') + 'retail price.'); return; }
            if (cost < 0 || stock < 0 || wh < 0) { problems.push('Row ' + n + ' (' + name + '): numbers cannot be negative.'); return; }

            var upp = 1, piecePrice = price, pieceWh = 0, packName = 'Pack', pieceName = 'Piece', totalStock = stock;
            if (small) {
                upp = Math.round(num(uppRaw));
                piecePrice = num(ppRaw); pieceWh = num(pwhRaw);
                var extra = Math.max(0, Math.round(num(extraRaw)));
                if (upp < 2) { problems.push('Row ' + n + ' (' + name + '): enter how many pieces are in one pack (2 or more).'); return; }
                if (!(piecePrice > 0)) { problems.push('Row ' + n + ' (' + name + '): enter the retail price per piece.'); return; }
                if (pieceWh < 0) { problems.push('Row ' + n + ' (' + name + '): numbers cannot be negative.'); return; }
                packName = r.querySelector('.wdbp-packname').value.trim() || 'Pack';
                pieceName = r.querySelector('.wdbp-piecename').value.trim() || 'Piece';
                totalStock = Math.round((stock * upp + extra) * 1000) / 1000;   // stock is kept in pieces
            }
            var key = name.toLowerCase();
            if (seen[key]) { dupInList.push(name); return; }
            seen[key] = true;
            items.push({ name: name, cost: cost, price: price, stock: totalStock, cat: cat, wh: wh, exp: exp,
                         upp: upp, piecePrice: piecePrice, pieceWh: pieceWh, packName: packName, pieceName: pieceName, small: small });
        });
        if (problems.length) return fail(problems.slice(0, 6).join('\n') + (problems.length > 6 ? '\n...and ' + (problems.length - 6) + ' more.' : ''));
        if (!items.length) return fail('Add at least one product (name and retail price).');

        var branchId = (typeof currentInventoryBranchFilter !== 'undefined' && currentInventoryBranchFilter && currentInventoryBranchFilter !== 'all')
            ? currentInventoryBranchFilter
            : ((typeof currentBranch !== 'undefined' && currentBranch) ? currentBranch : 'main');

        var btn = el('wdbp-save');
        btn.disabled = true; btn.textContent = 'Saving...';
        try {
            var db = firebase.database();
            var ref = db.ref('stores/' + sid + '/inventory/' + branchId);

            // Names already in this branch
            var snap = await ref.once('value');
            var existing = snap.val() || {};
            var existingNames = {};
            var branchCount = 0;
            Object.keys(existing).forEach(function (id) {
                branchCount++;
                var n = String((existing[id] && (existing[id].name || existing[id].productName)) || '').toLowerCase().trim();
                if (n) existingNames[n] = true;
            });
            var skipped = dupInList.slice();
            var fresh = items.filter(function (it) {
                if (existingNames[it.name.toLowerCase()]) { skipped.push(it.name); return false; }
                return true;
            });
            if (!fresh.length) {
                btn.disabled = false; btn.textContent = '✔ Add products';
                return fail('All of these products already exist in this branch. Nothing was added.');
            }

            // Plan limit
            var max = 0;
            try { max = Number((await db.ref('stores/' + sid + '/planLimits/maxProducts').once('value')).val()) || 0; } catch (e) { /* no limit info */ }
            if (max > 0) {
                var have = branchCount;
                if (typeof wdnCountProducts === 'function') { try { have = await wdnCountProducts(sid); } catch (e) { /* fall back to this branch */ } }
                if (have + fresh.length > max) {
                    btn.disabled = false; btn.textContent = '✔ Add products';
                    return fail('Your plan allows ' + max + ' products. You have ' + have + ' and are adding ' + fresh.length + '.\nRemove some rows, or upgrade your plan from the Subscription screen.');
                }
            }

            // One write
            var nowIso = new Date().toISOString();
            var createdBy = (typeof currentStaffName !== 'undefined' && currentStaffName) ? currentStaffName : 'Admin';
            var batch = {};
            fresh.forEach(function (it) {
                var k = ref.push().key;
                var wh = it.wh > 0 ? it.wh : it.price;                                   // wholesale per pack
                var pwh = it.small ? (it.pieceWh > 0 ? it.pieceWh : it.piecePrice) : wh; // wholesale per piece
                batch[k] = {
                    name: it.name, productName: it.name, category: it.cat || '',
                    baseUnitName: it.pieceName, bulkUnitName: it.packName, unitsPerPack: it.upp,
                    costPrice: it.cost, price: it.price, retailPrice: it.price, wholesalePrice: wh,
                    piecePrice: it.piecePrice, pieceWholesalePrice: pwh,
                    stock: it.stock, stockQty: it.stock,
                    expiry: it.exp || '', expiryDate: it.exp || '',
                    branchId: branchId, createdAt: nowIso, createdBy: createdBy
                };
            });
            await ref.update(batch);

            wdbpClose();
            alert('✅ Added ' + fresh.length + ' product' + (fresh.length === 1 ? '' : 's') + '.' +
                (skipped.length ? '\n\nSkipped (already exist or repeated): ' + skipped.slice(0, 15).join(', ') + (skipped.length > 15 ? '...' : '') : ''));
            try { if (typeof loadInventoryTable === 'function') loadInventoryTable(); } catch (e) { /* ignore */ }
        } catch (e) {
            btn.disabled = false; btn.textContent = '✔ Add products';
            fail('Could not save: ' + (e && e.message ? e.message : e));
        }
    };
})();
