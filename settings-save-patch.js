// ==================== WISE DECISION SETTINGS: ONE SAVE BUTTON (v1) ====================
// Load anywhere after the settings patches (store-logo-patch.js, pos-mode-patch.js, etc.).
//
// On the Business Settings page the separate save buttons are hidden:
//     "Save Profile Changes"  (business name, phone, address)
//     "Save"                  (How do you take payment?)
//     "Update PIN"            (only used if you typed a new PIN)
// and ONE button, "💾 Save all changes", floats at the bottom of the page. It presses those buttons for you,
// one after the other, so each card still saves exactly the way it always did (same rules, same checks).
// The little alert boxes are collected into ONE message at the end.
//
// Left alone on purpose (they are actions, not saves): Upload Logo, the "Show logo on printed receipts" tick box,
// Publish / refresh product list, Upgrade on WhatsApp.
//
// If a card changes the label of its save button, add the new wording to the matching pattern below.

console.log("Wise Decision settings-save-patch.js — v1 loaded");

(function () {
    var PROFILE_RE = /save\s+profile/i;
    var PIN_RE = /^\W*update\s+pin\W*$/i;
    var PAYMENT_CARD_TEXT = 'How do you take payment';
    var BAD_RE = /error|fail|could not|couldn't|cannot|can't|invalid|incorrect|wrong|must|required|enter |do not match|don't match|not match|too short|at least/i;

    function $(id) { return document.getElementById(id); }
    function ws() { return $('workspace-content'); }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function onSettingsPage() {
        var w = ws();
        if (!w) return false;
        var h = w.querySelector('h2');
        return !!(h && /business settings/i.test(h.textContent || '')) && !!w.querySelector('#settings-store-name');
    }

    // true if the element sits inside a card whose text contains `needle` (looks up a few levels only)
    function insideCardWith(el, needle, notNeedle) {
        var w = ws();
        for (var i = 0, p = el; p && p !== w && i < 8; i++, p = p.parentElement) {
            var t = p.textContent || '';
            if (t.indexOf(needle) !== -1 && (!notNeedle || t.indexOf(notNeedle) === -1)) return p;
        }
        return null;
    }

    function findSteps() {
        var w = ws(), steps = { profile: null, payment: null, pin: null, pinCard: null };
        w.querySelectorAll('button').forEach(function (b) {
            if (b.id === 'wdss-save') return;
            var t = (b.textContent || '').trim();
            if (!steps.profile && PROFILE_RE.test(t)) steps.profile = b;
            else if (!steps.pin && PIN_RE.test(t)) { steps.pin = b; steps.pinCard = insideCardWith(b, 'PIN'); }
            else if (!steps.payment && /^save$/i.test(t) && insideCardWith(b, PAYMENT_CARD_TEXT, 'Business Profile')) steps.payment = b;
        });
        return steps;
    }

    function pinTyped(steps) {
        if (!steps.pinCard) return false;
        var any = false;
        steps.pinCard.querySelectorAll('input').forEach(function (i) { if ((i.value || '').trim() !== '') any = true; });
        return any;
    }

    function hideButtons(steps) {
        [steps.profile, steps.payment, steps.pin].forEach(function (b) {
            if (b && b.style.display !== 'none') { b.style.display = 'none'; b.setAttribute('data-wdss-hidden', '1'); }
        });
    }

    function toast(msg) {
        var t = $('wdss-toast'); if (t) t.remove();
        t = document.createElement('div');
        t.id = 'wdss-toast';
        t.textContent = msg;
        t.style.cssText = 'position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:#166534;color:#fff;padding:12px 18px;border-radius:99px;font:700 14px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);z-index:2000;';
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.remove(); }, 2600);
    }

    var saving = false;
    async function saveAll() {
        if (saving) return;
        var steps = findSteps();
        var list = [];
        if (steps.profile) list.push({ name: 'Business profile', btn: steps.profile });
        if (steps.payment) list.push({ name: 'Payment mode', btn: steps.payment });
        if (steps.pin && pinTyped(steps)) list.push({ name: 'PIN', btn: steps.pin });
        if (!list.length) { alert('Nothing to save on this page.'); return; }

        saving = true;
        var main = $('wdss-save');
        if (main) { main.disabled = true; main.textContent = 'Saving…'; }

        var msgs = [], realAlert = window.alert, waiter = null;
        window.alert = function (m) {            // collect every alert instead of showing one per card
            msgs.push(String(m));
            if (waiter) { var w = waiter; waiter = null; w(); }
        };
        try {
            for (var i = 0; i < list.length; i++) {
                var before = msgs.length;
                await new Promise(function (resolve) {
                    waiter = resolve;
                    setTimeout(function () { if (waiter === resolve) { waiter = null; resolve(); } }, 4000);
                    try { list[i].btn.click(); } catch (e) { msgs.push(list[i].name + ': ' + (e.message || e)); waiter = null; resolve(); }
                });
                await sleep(300);
                if (msgs.length === before) { /* it saved quietly */ }
            }
        } finally {
            window.alert = realAlert;
            saving = false;
            var m2 = $('wdss-save');
            if (m2) { m2.disabled = false; m2.textContent = '💾 Save all changes'; }
        }

        var problem = msgs.filter(function (m) { return BAD_RE.test(m); });
        if (problem.length) realAlert(msgs.join('\n\n'));
        else toast('✅ Settings saved');
    }

    function ensureBar() {
        var w = ws();
        var bar = $('wdss-bar');
        if (!w) return;
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'wdss-bar';
            bar.style.cssText = 'position:sticky;bottom:76px;z-index:50;margin:16px 0 24px;';
            bar.innerHTML = '<button id="wdss-save" style="width:100%;padding:16px;border:none;border-radius:14px;font:800 16px system-ui,sans-serif;color:#fff;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);box-shadow:0 10px 24px rgba(22,163,74,.35);cursor:pointer;">💾 Save all changes</button>';
            bar.firstChild.onclick = saveAll;
        }
        // keep it as the last thing on the page (other patches add their cards after the page is drawn)
        if (w.lastElementChild !== bar) w.appendChild(bar);
    }

    function tick() {
        try {
            if (!onSettingsPage()) { var b = $('wdss-bar'); if (b) b.remove(); return; }
            hideButtons(findSteps());
            ensureBar();
        } catch (e) { console.warn('[settings-save]', e); }
    }

    window.addEventListener('load', function () { setTimeout(tick, 1000); });
    var busy = false;
    var obs = new MutationObserver(function () {
        if (busy) return; busy = true;
        setTimeout(function () { busy = false; tick(); }, 200);
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function () { obs.observe(document.body, { childList: true, subtree: true }); });
    setInterval(tick, 2000);
})();
