// ==================== WISE DECISION QUICK PAYMENT PATCH (v2) ====================
// Load LAST in app.html (after barcode-patch.js / pos-mode-patch.js).
//
// Changes the "Process Payment" popup (the one that opens after Pay & Print Receipt,
// and when an accountant processes a pending order):
//   - It assumes CASH straight away: one tap on "Accept Payment & Print Receipt" is enough
//   - "Transfer / POS" switches the whole payment to transfer
//   - v2: "Sell on credit" appears for saved (registered) customers - the whole amount goes on their balance
//     (it checks their credit limit; if the amount is over the limit, it tells you and you can use Split)
//   - "Split payment" brings back the old Cash / Transfer / Credit fields (to pay part now, rest on credit)
//
// It does not change how payments are saved: it only fills in the same fields the old popup used.

(function () {
    'use strict';
    if (window.__wdsQuickPay) return;
    window.__wdsQuickPay = true;
    console.log('Wise Decision payment-quick-patch.js — v2 loaded');

    function el(id) { return document.getElementById(id); }
    function fmt(n) { return '₦' + Number(n).toLocaleString(); }
    function groupOf(input) { return input ? (input.closest ? input.closest('.form-group') : input.parentNode) : null; }
    function totalDue() {
        var t = el('split-modal-total');
        return t ? (parseFloat(String(t.textContent).replace(/,/g, '')) || 0) : 0;
    }
    function recalc() { if (typeof calcSplit === 'function') calcSplit(); }

    // true when the old popup would have shown the Credit field (a saved customer is on this order)
    function creditAllowed() {
        var c = el('split-credit-container');
        return !!c && (c.dataset.wdsDisplay || 'none') !== 'none';
    }
    function customerOnOrder() {
        try {
            if (typeof currentActiveOrder !== 'undefined' && currentActiveOrder && currentActiveOrder.customerId && customersCache[currentActiveOrder.customerId]) {
                return customersCache[currentActiveOrder.customerId];
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    var BTN = 'margin:0; padding:12px 8px; border-radius:10px; font-size:14px; font-weight:bold; cursor:pointer; width:100%; border:1px solid transparent;';
    var STYLES = {
        cash:     { on: 'background:#16a34a; color:#fff; border-color:#16a34a;', off: 'background:#e2e8f0; color:#1e293b; border-color:#cbd5e1;' },
        transfer: { on: 'background:#0284c7; color:#fff; border-color:#0284c7;', off: 'background:#e2e8f0; color:#1e293b; border-color:#cbd5e1;' },
        credit:   { on: 'background:#d97706; color:#fff; border-color:#d97706;', off: 'background:#fffbeb; color:#92400e; border-color:#fde68a;' },
        split:    { on: 'background:#7c3aed; color:#fff; border-color:#7c3aed;', off: 'background:#f5f3ff; color:#6d28d9; border-color:#ddd6fe;' }
    };
    var SUM_OK = 'font-size:17px; font-weight:800; text-align:center; padding:12px; border-radius:10px; background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; margin-bottom:12px;';
    var SUM_CREDIT = 'font-size:17px; font-weight:800; text-align:center; padding:12px; border-radius:10px; background:#fffbeb; color:#92400e; border:1px solid #fde68a; margin-bottom:12px;';
    var SUM_BAD = 'font-size:15px; font-weight:800; text-align:center; padding:12px; border-radius:10px; background:#fef2f2; color:#991b1b; border:1px solid #fecaca; margin-bottom:12px;';

    function ensureBar() {
        if (el('wds-pay-bar')) return true;
        var cashInput = el('split-cash');
        var cashGroup = groupOf(cashInput);
        if (!cashGroup || !cashGroup.parentNode) return false;

        var bar = document.createElement('div');
        bar.id = 'wds-pay-bar';
        bar.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:0 0 12px 0;';

        function mkBtn(key, label) {
            var b = document.createElement('button');
            b.type = 'button';
            b.id = 'wds-pay-' + key;
            b.textContent = label;
            b.style.cssText = BTN;
            b.onclick = function () { setMode(key); };
            return b;
        }
        bar.appendChild(mkBtn('cash', '💵 Cash'));
        bar.appendChild(mkBtn('transfer', '🏦 Transfer / POS'));
        bar.appendChild(mkBtn('credit', '🧾 Sell on credit'));
        bar.appendChild(mkBtn('split', '➗ Split payment'));

        var sum = document.createElement('div');
        sum.id = 'wds-pay-summary';
        sum.style.cssText = SUM_OK;

        cashGroup.parentNode.insertBefore(bar, cashGroup);
        cashGroup.parentNode.insertBefore(sum, cashGroup);
        return true;
    }

    function paintButtons(mode) {
        var canCredit = creditAllowed();
        ['cash', 'transfer', 'credit', 'split'].forEach(function (k) {
            var b = el('wds-pay-' + k);
            if (!b) return;
            var extra = '';
            if (k === 'credit' && !canCredit) extra = 'display:none;';
            if (k === 'split' && !canCredit) extra = 'grid-column:1 / -1;';   // no credit button: Split takes the whole row
            b.style.cssText = BTN + extra + (k === mode ? STYLES[k].on : STYLES[k].off);
        });
    }

    // the Credit field must stay "not hidden" in the app's eyes whenever credit is being used, otherwise it is ignored
    function setCreditBox(box, how) {
        if (!box) return;
        box.style.visibility = ''; box.style.height = ''; box.style.margin = ''; box.style.overflow = '';
        if (how === 'show') {
            box.style.display = box.dataset.wdsDisplay || 'none';
        } else if (how === 'active-hidden') {
            box.style.display = box.dataset.wdsDisplay || 'block';
            box.style.visibility = 'hidden'; box.style.height = '0'; box.style.margin = '0'; box.style.overflow = 'hidden';
        } else {
            box.style.display = 'none';
        }
    }

    function setMode(mode) {
        if (mode === 'credit' && !creditAllowed()) mode = 'cash';
        var total = totalDue();
        var cash = el('split-cash'), tr = el('split-transfer'), cr = el('split-credit');
        var cashGroup = groupOf(cash), trGroup = groupOf(tr);
        var creditBox = el('split-credit-container');
        var statusEl = el('split-status');
        var statusWrap = statusEl ? statusEl.parentNode : null;
        var sum = el('wds-pay-summary');
        if (!cash || !tr) return;

        if (sum) sum.style.cssText = SUM_OK;

        if (mode === 'split') {
            // the old format: Cash + Transfer (+ Credit for saved customers)
            cash.value = total;
            tr.value = 0;
            if (cr) cr.value = 0;
            if (cashGroup) cashGroup.style.display = '';
            if (trGroup) trGroup.style.display = '';
            setCreditBox(creditBox, 'show');
            if (statusWrap) statusWrap.style.display = '';
            if (sum) sum.style.display = 'none';
        } else {
            if (cashGroup) cashGroup.style.display = 'none';
            if (trGroup) trGroup.style.display = 'none';
            if (statusWrap) statusWrap.style.display = 'none';
            if (sum) sum.style.display = 'block';

            if (mode === 'credit') {
                cash.value = 0;
                tr.value = 0;
                if (cr) cr.value = total;
                setCreditBox(creditBox, 'active-hidden');
                var c = customerOnOrder();
                var name = c ? (c.name || 'the customer') : 'the customer';
                var available = c ? Math.max(0, (Number(c.creditLimit) || 0) - (Number(c.balance) || 0)) : 0;
                if (sum) {
                    if (total > available + 0.009) {
                        sum.style.cssText = SUM_BAD;
                        sum.textContent = 'Over the credit limit — only ' + fmt(available) + ' available for ' + name + '. Use Split payment to pay part now.';
                    } else {
                        sum.style.cssText = SUM_CREDIT;
                        sum.textContent = '🧾 On credit — ' + fmt(total) + ' added to ' + name + '’s balance';
                    }
                }
            } else {
                cash.value = mode === 'cash' ? total : 0;
                tr.value = mode === 'transfer' ? total : 0;
                if (cr) cr.value = 0;
                setCreditBox(creditBox, 'hide');
                if (sum) sum.textContent = (mode === 'cash' ? '💵 Paying by Cash — ' : '🏦 Paying by Transfer / POS — ') + fmt(total);
            }
        }
        paintButtons(mode);
        recalc();
    }

    // runs every time the popup opens
    function onOpen() {
        var creditBox = el('split-credit-container');
        // remember whether the old popup wanted the Credit field shown (saved customer) before we change it
        if (creditBox) {
            // clear anything left from the last time, then read what the old popup just decided for this customer
            creditBox.style.visibility = ''; creditBox.style.height = ''; creditBox.style.margin = ''; creditBox.style.overflow = '';
            creditBox.dataset.wdsDisplay = creditBox.style.display || 'none';
        }
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
