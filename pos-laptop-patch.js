// ==================== WISE DECISION POS LAYOUT + ONE-BOX PRODUCT SEARCH PATCH (v3) ====================
// Load LAST in app.html (after payment-quick-patch.js).
//
// v2: "Search Product" and "Select Product" are now ONE box. You type, the matching products appear right
//     under the box, tap/click one to pick it. Nothing is listed until you type. (Works on phones AND laptops.) The old dropdown is hidden but
//     still used behind the scenes, so cart, stock, prices and the barcode scanner work exactly as before.
//
// Laptops / desktops (screen 821px and wider) also get:
//   - Tidy one-row toolbar (Retail/Wholesale and Pack/Piece toggles) and a slim one-line customer strip
//   - Two columns: products on the left, the cart on the right (always visible)
//   - Big Grand Total and a big Pay button
//   - Keyboard (no function keys): up/down = choose, Enter = add to cart, Esc = clear search / close popup
//   - Payment popup: wider, big total; Enter = accept, C = Cash, T = Transfer / POS, S = Split, Esc = cancel
//
// Also restyles: customer search list, Held Carts popup and the on-screen receipt to match the payment popup.
//
// Uses the store's own theme colours when there are any, plain blue otherwise.

(function () {
    'use strict';
    if (window.__wdlLaptop) return;
    window.__wdlLaptop = true;
    console.log('Wise Decision pos-laptop-patch.js — v3 loaded');

    var MIN = 821, MAXROWS = 60;

    function el(id) { return document.getElementById(id); }
    function ws(sel) { return document.querySelector('#workspace-content ' + sel); }
    function laptop() { return window.innerWidth >= MIN; }
    function isOpen(id) { var e = el(id); return !!e && e.style.display === 'flex'; }
    function anyModalOpen() {
        var m = document.querySelectorAll('[id$="-modal"]');
        for (var i = 0; i < m.length; i++) { if (m[i].style.display === 'flex') return true; }
        return !!el('wds-link') || !!el('wds-cam');
    }
    function visible(e) { return !!e && e.offsetParent !== null && e.style.display !== 'none'; }
    function mk(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    // ---------- CSS ----------
    var A = 'var(--wx-acc,#0284c7)', AI = 'var(--wx-acc-ink,#fff)', LINE = 'var(--wx-line,#cbd5e1)', MUT = 'var(--wx-mut,#64748b)';
    var css =
        '.wdl-hide{display:none !important;}' +
        '#wdl-hint, #wdl-pay-hint{display:none;}' +

        /* ---- one-box product search (all screen sizes) ---- */
        'body.wdl-pos #pos-search-input.wdl-open{border-radius:12px 12px 0 0 !important; margin-bottom:0 !important;}' +
        '#wdl-results{border:1px solid ' + LINE + '; border-top:none; border-radius:0 0 12px 12px; max-height:min(46vh,380px); overflow-y:auto; background:#fff; -webkit-overflow-scrolling:touch; margin-bottom:12px;}' +
        '.wdl-row{display:flex; justify-content:space-between; align-items:center; gap:12px; padding:12px 14px; cursor:pointer; border-top:1px solid #f1f5f9; color:#0f172a;}' +
        '.wdl-row:first-child{border-top:none;}' +
        '.wdl-row:hover{background:#f1f5f9;}' +
        '.wdl-row.on, .wdl-row.on:hover{background:' + A + '; color:' + AI + ';}' +
        '.wdl-n{font-weight:700; font-size:15px; min-width:0;}' +
        '.wdl-m{font-size:12px; color:' + MUT + '; margin-top:2px;}' +
        '.wdl-row.on .wdl-m{color:rgba(255,255,255,.88);}' +
        '.wdl-m.out{color:#b91c1c; font-weight:700;}' +
        '.wdl-row.on .wdl-m.out{color:#fecaca;}' +
        '.wdl-p{font-weight:800; white-space:nowrap;}' +
        '.wdl-empty{padding:18px; text-align:center; color:' + MUT + '; font-size:13px;}' +
        '.wdl-more{padding:10px; text-align:center; color:' + MUT + '; font-size:12px; border-top:1px solid #f1f5f9;}' +
        '#wdl-hint kbd, #wdl-pay-hint kbd{background:#f1f5f9; border:1px solid #cbd5e1; border-bottom-width:2px; border-radius:5px; padding:0 6px; font:700 11px/1.6 inherit; color:#334155;}' +

        /* ---- other POS screens: customer search list, Held Carts popup, receipt screen (all sizes) ---- */
        '.wdl-seg{display:contents;}' +
        '#pos-customer-results{border-radius:12px !important; box-shadow:0 14px 32px rgba(15,23,42,.14) !important; border-color:#e2e8f0 !important; overflow:hidden;}' +
        '#pos-customer-results > div{padding:11px 14px !important; font-size:14px !important;}' +
        '#pos-customer-results > div:hover{background:#f1f5f9;}' +
        '#held-carts-modal > div{max-width:600px !important; padding:24px !important; border-radius:18px !important;}' +
        '#held-carts-modal h3{font-size:20px !important;}' +
        '#held-carts-modal th{font-size:11px !important; text-transform:uppercase; letter-spacing:.6px; color:' + MUT + ' !important; background:transparent !important; border-bottom:1px solid ' + LINE + ' !important;}' +
        '#held-carts-modal td{padding:12px 10px !important;}' +
        '#held-carts-modal .menu-btn{border-radius:10px !important; font-weight:800 !important; padding:8px 14px !important;}' +
        'body.wdl-receipt #workspace-content div:has(> button[onclick="window.print()"]){gap:10px !important; margin-bottom:18px !important;}' +
        'body.wdl-receipt #workspace-content div:has(> button[onclick="window.print()"]) > button{padding:12px 18px !important; border-radius:12px !important; font-size:14px !important; font-weight:800 !important;}' +
        'body.wdl-receipt #printable-receipt-box, body.wdl-receipt #printable-refund-receipt-box, body.wdl-receipt #printable-debt-receipt-box{max-width:360px !important; padding:26px 24px !important; border:none !important; border-radius:12px !important; box-shadow:0 12px 32px rgba(15,23,42,.14);}' +

        /* ---- laptop layout ---- */
        '@media (min-width:' + MIN + 'px){' +
        ' body.wdl-pos .wdl-lbl{display:none !important;}' +
        ' body.wdl-pos .wdl-bar{display:flex !important; flex-wrap:wrap; align-items:center; gap:8px 10px !important; margin:10px 0 12px 0 !important;}' +
        ' body.wdl-pos .wdl-bar > *{margin:0 !important; font-size:13px !important;}' +
        ' body.wdl-pos .wdl-bar > :not(.wdl-seg):not(.wdl-lbl){padding:8px 12px !important; border-radius:10px !important; white-space:nowrap; width:auto !important;}' +
        ' body.wdl-pos .wdl-bar > .wdl-right{margin-left:auto !important;}' +
        ' body.wdl-pos .wdl-seg{display:inline-flex; background:#e2e8f0; border-radius:12px; padding:3px; gap:2px;}' +
        ' body.wdl-pos .wdl-seg > button{margin:0 !important; border:none !important; border-radius:9px !important; padding:8px 16px !important; font-size:13px !important; box-shadow:none !important; width:auto !important; white-space:nowrap;}' +
        ' body.wdl-pos .wdl-cust{display:flex !important; align-items:center; flex-wrap:wrap; gap:8px 16px; padding:10px 16px !important; margin-bottom:12px !important;}' +
        ' body.wdl-pos .wdl-cust > label{margin:0 !important; font-size:13px !important; white-space:nowrap;}' +
        ' body.wdl-pos .wdl-cust > div:nth-of-type(1){flex:0 1 360px; min-width:220px; margin:0 !important;}' +
        ' body.wdl-pos .wdl-cust #pos-customer-search{padding:9px 12px !important; font-size:14px !important; width:100% !important; max-width:none !important;}' +
        ' body.wdl-pos .wdl-cust #pos-selected-customer-badge{margin:0 0 0 auto !important; font-size:14px !important;}' +
        ' body.wdl-pos #workspace-content h2{font-size:24px !important; margin-bottom:4px !important;}' +
        ' body.wdl-pos .pos-grid{display:grid !important; grid-template-columns:minmax(0,1.3fr) minmax(380px,0.8fr) !important; gap:18px !important; align-items:start !important; margin-top:12px !important;}' +
        ' body.wdl-pos .pos-grid > div:nth-child(2){position:sticky; top:12px; display:flex !important; flex-direction:column; max-height:calc(100vh - 30px); box-sizing:border-box;}' +
        ' body.wdl-pos .pos-grid > div:nth-child(2) > div:nth-child(2){flex:1 1 auto !important; min-height:150px; max-height:none !important; overflow-y:auto;}' +
        ' body.wdl-pos .pos-grid > div:nth-child(2) > div:nth-child(3){font-size:26px !important; font-weight:900 !important; padding:12px 0 !important; margin:0 0 12px 0 !important; border-top:2px solid ' + LINE + ';}' +
        ' body.wdl-pos #wdp-pay-btn{padding:17px !important; font-size:17px !important; border-radius:14px !important;}' +
        ' body.wdl-pos #pos-search-input{font-size:16px !important; padding:13px 14px !important;}' +
        ' #wdl-results{max-height:min(52vh,460px);}' +
        ' body.wdl-pos #wdl-hint{display:flex; flex-wrap:wrap; gap:6px 14px; font-size:12px; color:' + MUT + '; margin:-2px 0 14px 0;}' +

        /* ---- payment popup ---- */
        ' #split-modal > div{max-width:480px !important; padding:26px !important; border-radius:18px !important;}' +
        ' #split-modal h3{font-size:20px !important;}' +
        ' #split-modal div:has(> #split-modal-total){font-size:32px !important; font-weight:900 !important; letter-spacing:-.5px; margin:6px 0 16px 0 !important;}' +
        ' #split-modal #wds-pay-bar button{padding:15px 8px !important; font-size:15px !important;}' +
        ' #split-modal #wds-pay-summary{font-size:19px !important; padding:16px !important;}' +
        ' #split-modal #dynamic-accept-print-btn{padding:16px !important; font-size:15px !important;}' +
        ' #wdl-pay-hint{display:block; text-align:center; font-size:12px; color:' + MUT + '; margin:0 0 12px 0;}' +
        '}';

    function addCss() {
        if (el('wdl-css')) return;
        var s = document.createElement('style');
        s.id = 'wdl-css';
        s.textContent = css;
        document.head.appendChild(s);
    }

    // ---------- the one-box product search ----------
    function posSel() { return ws('#pos-product-select'); }
    function options(sel) {
        return Array.prototype.filter.call(sel.options, function (o) { return o.value; });
    }
    function invItem(id) {
        try { return (inventoryCache[currentBranch] || {})[id] || null; } catch (e) { return null; }
    }
    function stockNum(it) { return Number(it.stock !== undefined ? it.stock : (it.stockQty || 0)) || 0; }
    function priceOf(it) {
        try {
            var type = (typeof currentCustomerType !== 'undefined') ? currentCustomerType : 'Retail';
            var unit = (typeof currentSaleUnit !== 'undefined') ? currentSaleUnit : 'Piece';
            if (!it.soldByWeight && unit === 'Piece' && typeof getPiecePrice === 'function') return getPiecePrice(it, type);
            var retail = Number(it.price || it.retailPrice) || 0;
            return type === 'Wholesale' ? (Number(it.wholesalePrice) || retail) : retail;
        } catch (e) { return 0; }
    }
    function stockText(it) {
        try { return typeof formatStockLabel === 'function' ? formatStockLabel(it) : String(stockNum(it)); } catch (e) { return String(stockNum(it)); }
    }

    var collapsed = false;   // after you pick a product the list shrinks to just that product

    function selectId(id, collapse) {
        var sel = posSel();
        if (!sel) return;
        sel.value = id;
        collapsed = !!collapse;
        if (typeof onPosProductChange === 'function') onPosProductChange();
        render(true);
        var on = el('wdl-results') && el('wdl-results').querySelector('.wdl-row.on');
        if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }

    function addCurrent() {
        var sel = posSel();
        if (!sel || !sel.value) return;
        if (typeof onPosProductChange === 'function') onPosProductChange();
        if (typeof addToCart === 'function') addToCart();
        if (laptop()) focusSearch();
    }

    function focusSearch() {
        var s = ws('#pos-search-input');
        if (s) setTimeout(function () { s.focus(); s.select(); }, 60);
    }

    var lastSig = '';
    function render(force) {
        var sel = posSel(), search = ws('#pos-search-input');
        if (!sel || !search) return;
        var list = el('wdl-results');
        if (!list) {
            list = document.createElement('div');
            list.id = 'wdl-results';
            list.addEventListener('click', function (e) {
                var row = e.target.closest ? e.target.closest('.wdl-row') : null;
                if (row) selectId(row.getAttribute('data-id'), true);
            });
            list.addEventListener('dblclick', function (e) {
                var row = e.target.closest ? e.target.closest('.wdl-row') : null;
                if (row) { selectId(row.getAttribute('data-id'), true); addCurrent(); }
            });
            search.insertAdjacentElement('afterend', list);
        }

        var q = search.value.trim();
        var chosen = sel.value;
        var opts = options(sel);
        var rows;
        if (!q || (collapsed && chosen)) {
            // nothing typed (or already picked): show only the picked product, never the whole inventory
            rows = chosen ? opts.filter(function (o) { return o.value === chosen; }) : [];
        } else {
            rows = opts.slice(0, MAXROWS);
        }

        var type = (typeof currentCustomerType !== 'undefined') ? currentCustomerType : '';
        var unit = (typeof currentSaleUnit !== 'undefined') ? currentSaleUnit : '';
        var sig = type + '|' + unit + '|' + chosen + '|' + q + '|' + collapsed + '|' + opts.length + '|' +
            rows.map(function (o) { var it = invItem(o.value); return o.value + ':' + (it ? stockNum(it) + ':' + priceOf(it) : o.textContent.length); }).join(',');
        if (!force && sig === lastSig && list.parentNode) return;
        lastSig = sig;

        list.innerHTML = '';
        if (!q && !rows.length) {            // nothing typed, nothing picked: no list at all
            list.style.display = 'none';
            search.classList.remove('wdl-open');
            return;
        }
        list.style.display = '';
        search.classList.add('wdl-open');

        if (!rows.length) {
            list.appendChild(mk('div', 'wdl-empty', opts.length ? '' : 'No product matches “' + search.value + '”'));
            return;
        }
        rows.forEach(function (o) {
            var it = invItem(o.value);
            var row = mk('div', 'wdl-row' + (chosen === o.value ? ' on' : ''));
            row.setAttribute('data-id', o.value);
            var left = mk('div');
            var name = it ? (it.name || it.productName || 'Unnamed Item') : o.textContent.split(' (Stock')[0];
            left.appendChild(mk('div', 'wdl-n', name));
            var out = it && stockNum(it) <= 0;
            left.appendChild(mk('div', 'wdl-m' + (out ? ' out' : ''), it ? (out ? 'Out of stock' : 'Stock: ' + stockText(it)) : ''));
            row.appendChild(left);
            row.appendChild(mk('div', 'wdl-p', it ? '₦' + Number(priceOf(it)).toLocaleString() : ''));
            list.appendChild(row);
        });
        if (q && !(collapsed && chosen) && opts.length > MAXROWS) {
            list.appendChild(mk('div', 'wdl-more', 'Showing the first ' + MAXROWS + ' — type more letters to narrow it down'));
        }

        // exactly one match and nothing chosen yet: choose it (so Enter / Add to Cart works straight away)
        if (q && opts.length === 1 && !chosen) {
            sel.value = opts[0].value;
            if (typeof onPosProductChange === 'function') onPosProductChange();
            lastSig = '';
            render(true);
        }
    }

    function move(dir) {
        var sel = posSel();
        if (!sel) return;
        var opts = options(sel).slice(0, MAXROWS);
        if (!opts.length) return;
        var idx = -1;
        for (var i = 0; i < opts.length; i++) { if (opts[i].value === sel.value) { idx = i; break; } }
        idx = idx === -1 ? (dir > 0 ? 0 : opts.length - 1) : Math.max(0, Math.min(opts.length - 1, idx + dir));
        selectId(opts[idx].value);
    }

    // ---------- keep the POS screen set up ----------
    var wasPos = false;
    function ensureHint(anchorGroup) {
        if (el('wdl-hint') || !anchorGroup || !anchorGroup.parentNode) return;
        var h = document.createElement('div');
        h.id = 'wdl-hint';
        h.innerHTML = '<span><kbd>↑</kbd> <kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> add to cart</span>';
        anchorGroup.parentNode.insertBefore(h, anchorGroup.nextSibling);
    }

    // toolbar: Retail/Wholesale and Pack/Piece become two neat toggles; customer card becomes one slim strip
    function layoutPos() {
        var retail = ws('#btn-type-retail'), wholesale = ws('#btn-type-wholesale'), pack = ws('#btn-unit-pack'), piece = ws('#btn-unit-piece');
        if (retail && wholesale && pack && piece && retail.parentNode && pack.parentNode && !retail.parentNode.classList.contains('wdl-seg')) {
            var bar = retail.parentNode;
            bar.classList.add('wdl-bar');
            [retail.previousElementSibling, pack.previousElementSibling].forEach(function (lb) {
                if (lb && lb.tagName === 'SPAN' && /tier|sell by/i.test(lb.textContent || '')) lb.classList.add('wdl-lbl');
            });
            var s1 = mk('div', 'wdl-seg'), s2 = mk('div', 'wdl-seg');
            retail.parentNode.insertBefore(s1, retail); s1.appendChild(retail); s1.appendChild(wholesale);
            pack.parentNode.insertBefore(s2, pack); s2.appendChild(pack); s2.appendChild(piece);
            retail.title = 'Retail prices'; wholesale.title = 'Wholesale prices';
            pack.title = 'Sell whole packs'; piece.title = 'Sell single pieces';
            var bl = ws('#pos-branch-label');
            if (bl && bl.parentElement && bl.parentElement.parentNode === bar) bl.parentElement.classList.add('wdl-right');
        }
        var cs = ws('#pos-customer-search');
        var card = cs && cs.parentNode && cs.parentNode.parentNode;
        if (card && !card.classList.contains('wdl-cust')) card.classList.add('wdl-cust');
    }

    function tick() {
        try {
            if (!document.body) return;
            addCss();

            // payment popup hint line (static popup, add once)
            var btns = el('split-modal-buttons-container');
            if (btns && !el('wdl-pay-hint')) {
                var ph = document.createElement('div');
                ph.id = 'wdl-pay-hint';
                ph.innerHTML = '<kbd>Enter</kbd> accept &nbsp; <kbd>C</kbd> cash &nbsp; <kbd>T</kbd> transfer &nbsp; <kbd>S</kbd> split &nbsp; <kbd>Esc</kbd> cancel';
                btns.parentNode.insertBefore(ph, btns);
            }

            var sel = posSel();
            document.body.classList.toggle('wdl-pos', !!sel);
            document.body.classList.toggle('wdl-receipt', !!(ws('#printable-receipt-box') || ws('#printable-refund-receipt-box') || ws('#printable-debt-receipt-box')));
            if (!sel) { wasPos = false; return; }
            layoutPos();

            var search = ws('#pos-search-input');
            if (!search) return;

            // hide the old "Select Product" dropdown; the search box + list replace it
            var selGroup = sel.closest ? sel.closest('.form-group') : null;
            if (selGroup) selGroup.classList.add('wdl-hide');
            var sGroup = search.closest ? search.closest('.form-group') : null;
            if (sGroup && !sGroup.dataset.wdlLabel) {
                var lab = sGroup.querySelector('label');
                if (lab) lab.textContent = 'Product / Drug';
                sGroup.dataset.wdlLabel = '1';
            }
            if (!search.dataset.wdlPh) {
                search.placeholder = 'Type a name or scan a barcode…';
                search.setAttribute('autocomplete', 'off');
                search.dataset.wdlPh = '1';
            }

            // re-draw the list whenever the app refills the hidden dropdown
            if (!sel.dataset.wdlObs) {
                sel.dataset.wdlObs = '1';
                new MutationObserver(function () { render(false); }).observe(sel, { childList: true });
            }
            render(false);
            if (laptop()) ensureHint(sGroup);

            if (!wasPos && laptop() && !anyModalOpen()) focusSearch();
            wasPos = true;
        } catch (e) { console.warn('[pos-laptop]', e); }
    }

    document.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'pos-search-input') { collapsed = false; render(false); }   // the app has already filtered the hidden dropdown
    });
    document.addEventListener('focusin', function (e) {
        if (e.target && e.target.id === 'pos-search-input' && collapsed) { collapsed = false; render(false); }
    });

    // ---------- keyboard ----------
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var t = e.target, tag = t && t.tagName;

        // payment popup
        if (isOpen('split-modal')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (typeof closeSplitModal === 'function') closeSplitModal();
                return;
            }
            if (e.key === 'Enter' && tag !== 'BUTTON' && !e.repeat) {
                var acc = el('dynamic-accept-print-btn');
                if (acc && !acc.disabled) { e.preventDefault(); acc.click(); }
                return;
            }
            if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
                var map = { c: 'cash', t: 'transfer', s: 'split' };
                var k = map[String(e.key).toLowerCase()];
                var b = k ? el('wds-pay-' + k) : null;
                if (b) { e.preventDefault(); b.click(); }
            }
            return;
        }

        // POS screen (laptops)
        var sel = posSel();
        if (!sel || !laptop() || anyModalOpen()) return;
        var search = ws('#pos-search-input');

        if (t === search) {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (e.repeat) return;
                if (sel.value) addCurrent();
                else if (options(sel).length) move(1);   // nothing chosen yet: choose the first, press Enter again to add
            } else if (e.key === 'Escape') {
                search.value = '';
                if (typeof filterPosInventory === 'function') filterPosInventory();
                render(true);
            }
        }
    });

    // ---------- start ----------
    var pending = false;
    function schedule() { if (pending) return; pending = true; setTimeout(function () { pending = false; tick(); }, 150); }
    function start() {
        tick();
        if (document.body) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        setInterval(tick, 1500);
    }
    if (document.readyState === 'complete') setTimeout(start, 500);
    else window.addEventListener('load', function () { setTimeout(start, 500); });
})();
