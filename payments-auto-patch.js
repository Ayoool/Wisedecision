// ==================== WISE DECISION PAYSTACK AUTO-VERIFY PATCH (v1) ====================
// Load AFTER payments-patch.js (v4.23), banner-fix-patch.js and auto-lock-patch.js (defer).
//
// What changes for the store:
//   * The amount is locked (the server works it out from the plan, cycle and months).
//   * "Pay with Paystack" opens Paystack's own page (no popup, so no mobile Safari problems).
//   * After paying, Paystack sends the store back to the app, which asks the server to verify the payment.
//     The server checks with Paystack, extends the due date, applies the plan and unlocks the store.
//   * No reference to paste, no waiting for the Super Admin.
// Needs Code.gs deployed (uses the same web-app URL as WDP_ALERT_URL).

console.log("Wise Decision payments-auto-patch.js v1 loaded");

var wdaConfirming = false, wdaOwn = false;

function wdaSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function wdaCall(body) {
    return wdpTimeout(fetch(WDP_ALERT_URL, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }), 40000);
}

// Our own modal calls get through; the auto-lock patch can't overwrite the "Confirming..." screen meanwhile.
(function () {
    var origModal = window.wdpModal;
    window.wdpModal = function (t, h) { if (wdaConfirming && !wdaOwn) return; return origModal.call(this, t, h); };
    window.wdaShow = function (t, h) { wdaOwn = true; try { origModal(t, h); } finally { wdaOwn = false; } };
})();

// Always use the "no payment link" form (the new flow replaces the link + paste-reference flow).
(function () {
    var origRender = window.wdpRenderRenew;
    window.wdpRenderRenew = function () {
        if (wdpCtx && wdpCtx.settings) wdpCtx.settings.paymentLink = '';
        return origRender.apply(this, arguments);
    };
    var origRecalc = window.wdpRecalc;
    window.wdpRecalc = function () {
        var r = origRecalc.apply(this, arguments);
        try {
            var a = document.getElementById('wdp-amount'), h = document.getElementById('wdp-amount-hint');
            if (a && Number(a.value) > 0) {
                a.readOnly = true; a.style.background = '#f1f5f9';
                if (h) h.textContent = h.textContent.replace(' Change it if you paid a different amount.', '') + ' (fixed)';
            } else if (a) { a.readOnly = false; a.style.background = ''; }
        } catch (e) { }
        return r;
    };
})();

// ---------- Start payment ----------
async function wdaPay() {
    var c = wdpCtx;
    if (!c || wdpBusy) return;
    var sel = document.getElementById('wdp-plan');
    var cycleEl = document.getElementById('wdp-cycle');
    var cycle = cycleEl && cycleEl.value === 'yearly' ? 'yearly' : 'monthly';
    var months = cycle === 'yearly' ? 12 : (parseInt((document.getElementById('wdp-months') || {}).value) || 1);
    var planId = sel ? sel.value : (c.billing && c.billing.plan) || '';
    var email = wdpGetEmail(c.id);
    if (!email) return;

    wdpBusy = true;
    var btn = document.getElementById('wdp-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Preparing secure payment...'; }
    try {
        var j = await wdaCall({ action: 'init', storeId: c.id, planId: planId, cycle: cycle, months: months, email: email });
        if (!j || !j.ok || !j.url) throw new Error((j && j.error) || 'Could not start the payment');
        try { localStorage.setItem('wda_pending', JSON.stringify({ ref: j.reference, sid: c.id, t: Date.now() })); } catch (e) { }
        window.location.href = j.url;   // Paystack's own page; it sends the store back here when done
    } catch (e) {
        wdpBusy = false;
        if (btn) { btn.disabled = false; btn.textContent = '💳 Pay with Paystack'; }
        alert('Could not start the payment: ' + ((e && e.message) || 'check your internet and try again.'));
    }
}
window.wdpSubmit = wdaPay;
window.wdpSubmitManual = wdaPay;

// ---------- Come back from Paystack, verify, unlock ----------
function wdaRefFromUrl() {
    var m = /[?&](?:reference|trxref)=(WD-[A-Za-z0-9]+)/.exec(location.search);
    return m ? m[1] : '';
}
function wdaCleanUrl() {
    try {
        var q = location.search.replace(/[?&](?:reference|trxref)=[^&]*/g, '').replace(/^&/, '?');
        history.replaceState(null, '', location.pathname + (q === '?' ? '' : q) + location.hash);
    } catch (e) { }
}
function wdaClearPending() { try { localStorage.removeItem('wda_pending'); } catch (e) { } }

function wdaFinish(title, color, html, btnText) {
    wdaConfirming = false;
    wdaShow(title, '<div style="padding:8px 0; color:' + color + '; font-size:14px;">' + html + '</div>' +
        '<button class="menu-btn btn-action-primary" style="justify-content:center; margin:0;" onclick="location.href=location.pathname">' + btnText + '</button>');
}

async function wdaConfirm(ref, silent) {
    wdaConfirming = true;
    if (!silent) wdaShow('💳 Confirming payment', '<div style="text-align:center; color:#64748b; padding:24px;">Confirming your payment with Paystack...<br><small>Please do not close this page.</small></div>');
    var j = null;
    for (var i = 0; i < (silent ? 1 : 8); i++) {
        try { j = await wdaCall({ action: 'verify', reference: ref }); } catch (e) { j = { ok: false, state: 'pending' }; }
        if (j && j.ok) break;
        if (j && (j.state === 'abandoned' || j.state === 'failed' || j.state === 'review' || j.state === 'unknown')) break;
        if (i < 7 && !silent) await wdaSleep(4000);
    }
    wdaCleanUrl();

    if (j && j.ok) {
        wdaClearPending();
        wdaFinish('✅ Payment confirmed', '#166534',
            'Thank you! Your payment of <strong>' + wdpMoney(j.amount) + '</strong> is confirmed.' +
            (j.dueAfter ? '<br>Next payment due: <strong>' + wdpPretty(j.dueAfter) + '</strong>.' : '') +
            '<br>Your store is active.', 'Continue');
        return;
    }
    if (silent) { wdaConfirming = false; if (j && (j.state === 'abandoned' || j.state === 'failed' || j.state === 'unknown')) wdaClearPending(); return; }
    var s = j && j.state;
    if (s === 'abandoned' || s === 'failed') {
        wdaClearPending();
        wdaFinish('Payment not completed', '#991b1b', 'The payment was not completed, so no money was taken. You can try again.', 'Back');
    } else if (s === 'review') {
        wdaClearPending();
        wdaFinish('Payment received — checking', '#92400e', 'We received your payment but need to check it by hand (the amount did not match). Support has been notified and will confirm soon.', 'OK');
    } else if (s === 'unknown') {
        wdaFinish('Could not confirm', '#991b1b', ((j && j.error) || 'We could not match this payment.') + '<br>If money left your account, please contact support with your Paystack receipt.', 'OK');
    } else {
        wdaFinish('Still processing', '#92400e', 'Paystack has not confirmed your payment yet (bank transfers can take a few minutes). It will unlock automatically once confirmed. You can close this page.', 'OK');
    }
}

function wdaCheckReturn() {
    var ref = wdaRefFromUrl();
    if (ref) { wdaConfirm(ref, false); return; }
    // Came back some other way (e.g. closed the tab after paying): check quietly once.
    try {
        var p = JSON.parse(localStorage.getItem('wda_pending') || 'null');
        if (!p || !p.ref) return;
        if (Date.now() - p.t > 24 * 3600 * 1000) { wdaClearPending(); return; }
        wdaConfirm(p.ref, true);
    } catch (e) { }
}
window.addEventListener('load', function () { setTimeout(wdaCheckReturn, 800); });
