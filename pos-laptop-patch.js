// ==================== WISE DECISION LAPTOP POS LAYOUT PATCH (v1) ====================
// Load LAST in app.html (after payment-quick-patch.js). Laptops / desktops only (screen 821px and wider).
// Phones keep the current layout (mobile-patch.js is not touched).
//
// POS Sales screen:
//   - Two columns: products on the left, the cart on the right (always visible, never scrolls away)
//   - Big Grand Total and a big Pay button (F9)
//   - The product dropdown becomes a visible list: type to filter, arrow keys to choose, Enter adds to the cart
//   - Keyboard shortcuts: F2 = search, F9 = Pay, Esc = clear search / close the payment popup
// Payment popup:
//   - Wider, big total, bigger buttons
//   - Enter = accept payment, C = Cash, T = Transfer / POS, S = Split, Esc = cancel
//
// Uses the store's own theme colours when there are any (pharmacy / hardware themes), plain blue otherwise.
// Changes layout and keys only - sales, stock and receipts work exactly as before.

(function () {
    'use strict';
    if (window.__wdlLaptop) return;
    window.__wdlLaptop = true;
    console.log('Wise Decision pos-laptop-patch.js — v1 loaded');

    var MIN = 821;

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

    // ---------- CSS ----------
    var A = 'var(--wx-acc,#0284c7)', AI = 'var(--wx-acc-ink,#fff)', LINE = 'var(--wx-line,#e2e8f0)', MUT = 'var(--wx-mut,#64748b)';
    var css =
        '#wdl-hint, #wdl-pay-hint { display:none; }' +
        '@media (min-width:' + MIN + 'px){' +

        /* ---- POS layout ---- */
        ' body.wdl-pos #workspace-content h2{font-size:24px !important; margin-bottom:4px !important;}' +
        ' body.wdl-pos .pos-grid{display:grid !important; grid-template-columns:minmax(0,1.3fr) minmax(380px,0.8fr) !important; gap:18px !important; align-items:start !important; margin-top:12px !important;}' +
        ' body.wdl-pos .pos-grid > div:nth-child(2){position:sticky; top:12px; display:flex !important; flex-direction:column; max-height:calc(100vh - 30px); box-sizing:border-box;}' +
        ' body.wdl-pos .pos-grid > div:nth-child(2) > div:nth-child(2){flex:1 1 auto !important; min-height:150px; max-height:none !important; overflow-y:auto;}' +
        ' body.wdl-pos .pos-grid > div:nth-child(2) > div:nth-child(3){font-size:26px !important; font-weight:900 !important; padding:12px 0 !important; margin:0 0 12px 0 !important; border-top:2px solid ' + LINE + ';}' +
        ' body.wdl-pos #wdp-pay-btn{padding:17px !important; font-size:17px !important; border-radius:14px !important;}' +
        ' body.wdl-pos #wdp-pay-btn::after{content:"F9"; font-size:11px; font-weight:800; opacity:.85; border:1px solid rgba(255,255,255,.6); border-radius:6px; padding:1px 7px; margin-left:10px;}' +

        /* ---- product list (the dropdown shown as a list) ---- */
        ' body.wdl-pos #pos-search-input{font-size:16px !important; padding:13px 14px !important;}' +
        ' body.wdl-pos #pos-product-select{height:auto !important; min-height:320px !important; max-height:52vh !important; padding:6px !important; background-image:none !important; border-radius:12px !important; border:1px solid ' + LINE + ' !important;}' +
        ' body.wdl-pos #pos-product-select option{padding:10px 12px !important; margin-bottom:2px; border-radius:8px; font-size:14px;}' +
        ' body.wdl-pos #pos-product-select option[value=""]{display:none;}' +
        ' body.wdl-pos #pos-product-select option:checked{background:' + A + ' linear-gradient(0deg,' + A + ',' + A + ') !important; color:' + AI + ' !important;}' +
        ' body.wdl-pos #wdl-hint{display:flex; flex-wrap:wrap; gap:6px 14px; font-size:12px; color:' + MUT + '; margin:-2px 0 14px 0;}' +
        ' #wdl-hint kbd, #wdl-pay-hint kbd{background:#f1f5f9; border:1px solid #cbd5e1; border-bottom-width:2px; border-radius:5px; padding:0 6px; font:700 11px/1.6 inherit; color:#334155;}' +

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

    // ---------- keep the POS screen in laptop mode ----------
    var wasPos = false;
    function ensureHint(sel) {
        if (el('wdl-hint')) return;
        var grp = sel.closest ? sel.closest('.form-group') : sel.parentNode;
        if (!grp || !grp.parentNode) return;
        var h = document.createElement('div');
        h.id = 'wdl-hint';
        h.innerHTML = '<span><kbd>↑</kbd> <kbd>↓</kbd> choose</span><span><kbd>Enter</kbd> add to cart</span><span><kbd>F2</kbd> search</span><span><kbd>F9</kbd> pay</span>';
        grp.parentNode.insertBefore(h, grp.nextSibling);
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

            var sel = ws('#pos-product-select');
            document.body.classList.toggle('wdl-pos', !!sel);
            if (!sel) { wasPos = false; return; }

            if (laptop()) {
                if (sel.size !== 10) { sel.size = 10; sel.dataset.wdlSized = '1'; }
                var search = ws('#pos-search-input');
                if (search && !search.dataset.wdlPh) {
                    search.placeholder = 'Type a name or scan a barcode…  (Enter = add)';
                    search.setAttribute('autocomplete', 'off');
                    search.dataset.wdlPh = '1';
                }
                ensureHint(sel);
                if (!wasPos && search && !anyModalOpen()) setTimeout(function () { search.focus(); }, 300);
            } else if (sel.dataset.wdlSized) {
                sel.removeAttribute('size');
                delete sel.dataset.wdlSized;
            }
            wasPos = true;
        } catch (e) { console.warn('[pos-laptop]', e); }
    }

    // ---------- adding from the list ----------
    function validOptions(sel) {
        return Array.prototype.filter.call(sel.options, function (o) { return o.value; });
    }
    function focusSearch() {
        var s = ws('#pos-search-input');
        if (s) setTimeout(function () { s.focus(); s.select(); }, 60);
    }
    function addCurrent(sel) {
        if (!sel || !sel.value) return;
        if (typeof onPosProductChange === 'function') onPosProductChange();
        if (typeof addToCart === 'function') addToCart();
        focusSearch();
    }
    function focusList(sel) {
        var opts = validOptions(sel);
        if (!opts.length) return;
        if (!sel.value) {
            sel.value = opts[0].value;
            if (typeof onPosProductChange === 'function') onPosProductChange();
        }
        sel.focus();
    }

    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var t = e.target, tag = t && t.tagName;

        // ----- payment popup -----
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

        // ----- POS screen -----
        var sel = ws('#pos-product-select');
        if (!sel || !laptop() || anyModalOpen()) return;
        var search = ws('#pos-search-input');

        if (e.key === 'F2') { e.preventDefault(); if (search) { search.focus(); search.select(); } return; }

        if (e.key === 'F9') {
            e.preventDefault();
            var pay = ws('#wdp-pay-btn');
            if (visible(pay)) { pay.click(); return; }
            var send = ws('button[onclick="submitOrderForAccountant()"]');
            if (visible(send)) send.click();
            return;
        }

        if (t === search) {
            if (e.key === 'ArrowDown') { e.preventDefault(); focusList(sel); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                var opts = validOptions(sel);
                if (opts.length === 1) { sel.value = opts[0].value; addCurrent(sel); }   // exactly one match: add it
                else if (opts.length > 1) focusList(sel);                                  // several: pick one, then Enter
            } else if (e.key === 'Escape') {
                search.value = '';
                if (typeof filterPosInventory === 'function') filterPosInventory();
            }
        } else if (t === sel && e.key === 'Enter') {
            e.preventDefault();
            addCurrent(sel);
        }
    });

    document.addEventListener('dblclick', function (e) {
        var sel = ws('#pos-product-select');
        if (!sel || !laptop()) return;
        var t = e.target;
        if (t === sel || (t && t.parentNode === sel)) addCurrent(sel);
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
