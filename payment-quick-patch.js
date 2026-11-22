// ==================== WISE DECISION QUICK PAYMENT PATCH (v1) ====================
// Load LAST in app.html (after barcode-patch.js / pos-mode-patch.js).
//
// Changes the "Process Payment" popup (the one that opens after Pay & Print Receipt,
// and when an accountant processes a pending order):
//   - It now assumes CASH straight away: one tap on "Accept Payment & Print Receipt" is enough
//   - A "Transfer / POS" button switches the whole payment to transfer
//   - A "Split payment" button brings back the old Cash / Transfer / Credit fields
//
// It does not change how payments are saved: it only fills in the same fields the old popup used.

(function () {
    'use strict';
    if (window.__wdsQuickPay) return;
    window.__wdsQuickPay = true;
    console.log('Wise Decision payment-quick-patch.js — v1 loaded');

    function el(id) { return document.getElementById(id); }
    function fmt(n) { return '₦' + Number(n).toLocaleString(); }
    function groupOf(input) { return input ? (input.closest ? input.closest('.form-group') : input.parentNode) : null; }
    function totalDue() {
        var t = el('split-modal-total');
        return t ? (parseFloat(String(t.textContent).replace(/,/g, '')) || 0) : 0;
    }
    function recalc() { if (typeof calcSplit === 'function') calcSplit(); }

    var BTN = 'margin:0; padding:12px 8px; border-radius:10px; font-size:14px; font-weight:bold; cursor:pointer; width:100%; border:1px solid transparent;';
    var STYLES = {
        cash:     { on: 'background:#16a34a; color:#fff; border-color:#16a34a;', off: 'background:#e2e8f0; color:#1e293b; border-color:#cbd5e1;' },
        transfer: { on: 'background:#0284c7; color:#fff; border-color:#0284c7;', off: 'background:#e2e8f0; color:#1e293b; border-color:#cbd5e1;' },
        split:    { on: 'background:#7c3aed; color:#fff; border-color:#7c3aed;', off: 'background:#f5f3ff; color:#6d28d9; border-color:#ddd6fe;' }
    };

    function ensureBar() {
        if (el('wds-pay-bar')) return true;
        var cashInput = el('split-cash');
        var cashGroup = groupOf(cashInput);
        if (!cashGroup || !cashGroup.parentNode) return false;

        var bar = document.createElement('div');
        bar.id = 'wds-pay-bar';
        bar.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:0 0 12px 0;';

        function mkBtn(key, label, span) {
            var b = document.createElement('button');
            b.type = 'button';
            b.id = 'wds-pay-' + key;
            b.textContent = label;
            b.style.cssText = BTN + (span ? 'grid-column:1 / -1;' : '');
            b.onclick = function () { setMode(key); };
            return b;
        }
        bar.appendChild(mkBtn('cash', '💵 Cash'));
        bar.appendChild(mkBtn('transfer', '🏦 Transfer / POS'));
        bar.appendChild(mkBtn('split', '➗ Split payment', true));

        var sum = document.createElement('div');
        sum.id = 'wds-pay-summary';
        sum.style.cssText = 'font-size:17px; font-weight:800; text-align:center; padding:12px; border-radius:10px; background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; margin-bottom:12px;';

        cashGroup.parentNode.insertBefore(bar, cashGroup);
        cashGroup.parentNode.insertBefore(sum, cashGroup);
        return true;
    }

    function paintButtons(mode) {
        ['cash', 'transfer', 'split'].forEach(function (k) {
            var b = el('wds-pay-' + k);
            if (b) b.style.cssText = BTN + (k === 'split' ? 'grid-column:1 / -1;' : '') + (k === mode ? STYLES[k].on : STYLES[k].off);
        });
    }

    function setMode(mode) {
        var total = totalDue();
        var cash = el('split-cash'), tr = el('split-transfer'), cr = el('split-credit');
        var cashGroup = groupOf(cash), trGroup = groupOf(tr);
        var creditBox = el('split-credit-container');
        var statusEl = el('split-status');
        var statusWrap = statusEl ? statusEl.parentNode : null;
        var sum = el('wds-pay-summary');
        if (!cash || !tr) return;

        if (mode === 'split') {
            // the old format: Cash + Transfer (+ Credit for registered customers)
            cash.value = total;
            tr.value = 0;
            if (cr) cr.value = 0;
            if (cashGroup) cashGroup.style.display = '';
            if (trGroup) trGroup.style.display = '';
            if (creditBox) creditBox.style.display = creditBox.dataset.wdsDisplay || 'none';
            if (statusWrap) statusWrap.style.display = '';
            if (sum) sum.style.display = 'none';
        } else {
            cash.value = mode === 'cash' ? total : 0;
            tr.value = mode === 'transfer' ? total : 0;
            if (cr) cr.value = 0;
            if (cashGroup) cashGroup.style.display = 'none';
            if (trGroup) trGroup.style.display = 'none';
            if (creditBox) creditBox.style.display = 'none';
            if (statusWrap) statusWrap.style.display = 'none';
            if (sum) {
                sum.style.display = 'block';
                sum.textContent = (mode === 'cash' ? '💵 Paying by Cash — ' : '🏦 Paying by Transfer / POS — ') + fmt(total);
            }
        }
        paintButtons(mode);
        recalc();
    }

    // runs every time the popup opens
    function onOpen() {
        var creditBox = el('split-credit-container');
        // remember whether the old popup wanted the Credit field shown (registered customer) before we hide it
        if (creditBox) creditBox.dataset.wdsDisplay = creditBox.style.display || 'none';
        if (!ensureBar()) return;
        setMode('cash');
    }

    function watch() {
        var modal = el('split-modal');
        if (!modal) { setTimeout(watch, 500); return; }
        var wasOpen = modal.style.display === 'flex';
        new MutationObserver(function () {
            var open = modal.style.display === 'flex';
            if (open && !wasOpen) {
                wasOpen = true;
                try { onOpen(); } catch (e) { console.warn('payment-quick-patch error:', e); }
            } else if (!open) {
                wasOpen = false;
            }
        }).observe(modal, { attributes: true, attributeFilter: ['style'] });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
    else watch();
})();
