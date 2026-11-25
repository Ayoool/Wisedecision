// ==================== WISE DECISION RECEIPT + CART COLUMNS (v1) ====================
// Load LAST (after every other patch, including more-menu-patch.js). Works for EVERY store type.
//
// Makes the item table show   Item | Qty | Price | Amount   in two places:
//   1. the printed / reprinted RECEIPT   (was: Item | Qty | Price, where "Price" was really the line total)
//   2. the POS "Current Order Cart"      (was: Item | Qty | Total)
//
//   Price  = price of ONE unit (as sold: piece, pack, sachet, metre ...)  = amount / qty
//   Amount = the line total (what used to be shown as "Price" / "Total")
//
// How it works: it reads the table the app already drew and adds the Price column between Qty and the last column.
// Nothing is changed in the saved sale, stock or totals; it is only how the table is shown.
// Rows that are not item rows (delivery, discount, totals, "Cart is empty") are stretched to fit, not changed.

console.log("Wise Decision receipt-columns-patch.js — v1 loaded");

(function () {
    'use strict';

    // Only tables inside these places are touched.
    var SCOPE = '#pos-view table, [id^="printable-"] table, [id*="receipt" i] table, [class*="receipt" i] table';

    function txt(el) { return (el && el.textContent || '').replace(/\s+/g, ' ').trim(); }
    function numIn(s) {
        var m = String(s == null ? '' : s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
    }
    function symOf(s) { var m = String(s).match(/^[^\d\-]*/); return m ? m[0].trim() : ''; }
    function fmt(sym, n) {
        var whole = Math.abs(n - Math.round(n)) < 0.005;
        var v = whole ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (sym || '₦') + v;
    }
    function qtyOf(td) {
        var inp = td.querySelector('input');
        if (inp && inp.value !== '') { var v = numIn(inp.value); if (!isNaN(v)) return v; }
        return numIn(txt(td));
    }
    function span(td) { return parseInt(td.getAttribute('colspan') || '1', 10) || 1; }

    function headerRow(table) {
        var r = table.querySelector('thead tr');
        if (r) return r;
        var first = table.querySelector('tr');
        return (first && first.querySelector('th')) ? first : null;
    }
    function headerKind(th) {
        // 'item' | 'qty' | 'price' | 'amount' | 'total' | ''
        var t = txt(th).toLowerCase();
        if (/^(item|items|product|description)/.test(t)) return 'item';
        if (/^(qty|quantity)/.test(t)) return 'qty';
        if (/^price/.test(t)) return 'price';
        if (/^amount/.test(t)) return 'amount';
        if (/^total/.test(t)) return 'total';
        return '';
    }

    function fixTable(table) {
        var hr = headerRow(table); if (!hr) return;
        var ths = Array.prototype.slice.call(hr.children).filter(function (c) { return c.tagName === 'TH' || c.tagName === 'TD'; });

        // 1) the header: Item | Qty | (Price|Total)  ->  Item | Qty | Price | Amount
        if (ths.length === 3 && headerKind(ths[0]) === 'item' && headerKind(ths[1]) === 'qty' && /^(price|total|amount)$/.test(headerKind(ths[2]))) {
            var last = ths[2];
            var pth = last.cloneNode(false);
            pth.textContent = 'Price';
            pth.className = (last.className ? last.className + ' ' : '') + 'wdc-price';
            hr.insertBefore(pth, last);
            last.textContent = 'Amount';
            last.classList.add('wdc-amt');
            ths = [ths[0], ths[1], pth, last];
        }
        // not (or no longer) a 4-column Item | Qty | Price | Amount table: leave it alone
        if (ths.length !== 4 || headerKind(ths[0]) !== 'item' || headerKind(ths[1]) !== 'qty' || !ths[2].classList.contains('wdc-price')) return;

        // 2) the rows (the app redraws them often, so this runs again and again and only fixes what is not fixed yet)
        Array.prototype.forEach.call(table.querySelectorAll('tr'), function (tr) {
            if (tr === hr || tr.parentNode === hr.parentNode && tr.querySelector('th') && tr !== hr) return;
            var cells = Array.prototype.slice.call(tr.children).filter(function (c) { return c.tagName === 'TD' || c.tagName === 'TH'; });
            if (!cells.length) return;
            var priced = tr.querySelector(':scope > td.wdc-price');

            if (priced) {   // already done: keep the unit price in step if the app changed qty / amount in place
                var cs = cells.filter(function (c) { return c !== priced; });
                if (cs.length === 3) {
                    var q0 = qtyOf(cs[1]), a0 = numIn(txt(cs[2]));
                    var want = (!isNaN(q0) && q0 > 0 && !isNaN(a0)) ? fmt(symOf(txt(cs[2])), a0 / q0) : '';
                    if (priced.textContent !== want) priced.textContent = want;   // only write when it changed (no observer loop)
                }
                return;
            }
            var total = cells.reduce(function (n, c) { return n + span(c); }, 0);
            if (total !== 3) return;                       // already 4 wide, or not a row we understand

            if (cells.length === 3 && cells.every(function (c) { return span(c) === 1; })) {
                var amt = cells[2], qty = qtyOf(cells[1]), a = numIn(txt(amt));
                var td = document.createElement('td');
                td.className = (amt.className ? amt.className + ' ' : '') + 'wdc-price';
                if (amt.getAttribute('style')) td.setAttribute('style', amt.getAttribute('style'));
                td.textContent = (!isNaN(qty) && qty > 0 && !isNaN(a)) ? fmt(symOf(txt(amt)), a / qty) : '';
                tr.insertBefore(td, amt);
                amt.classList.add('wdc-amt');
            } else {
                // delivery / discount / total / "Cart is empty": stretch the wide cell so the columns still line up
                var wide = cells.filter(function (c) { return span(c) > 1; })[0];
                if (wide) wide.setAttribute('colspan', String(span(wide) + 1));
            }
        });
    }

    function run() {
        try {
            Array.prototype.forEach.call(document.querySelectorAll(SCOPE), fixTable);
        } catch (e) { console.warn('[receipt-columns]', e); }
    }

    function addCss() {
        if (document.getElementById('wdc-css')) return;
        var st = document.createElement('style');
        st.id = 'wdc-css';
        st.textContent =
            'td.wdc-price,th.wdc-price,td.wdc-amt,th.wdc-amt{text-align:right !important;white-space:nowrap;}' +
            'td.wdc-price{opacity:.85;}';
        document.head.appendChild(st);
    }

    var pending = false;
    function schedule() { if (pending) return; pending = true; setTimeout(function () { pending = false; run(); }, 60); }

    function start() {
        addCss();
        run();
        if (document.body) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
        setInterval(run, 1500);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(start, 800);
    else window.addEventListener('DOMContentLoaded', function () { setTimeout(start, 800); });
})();
