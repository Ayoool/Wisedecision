// ==================== WISE DECISION POLISH FOR EVERY STORE (v2) ====================
// Load LAST (after more-menu-patch.js). Works for EVERY store type (retail, pharmacy, phone, fashion,
// electronics, hardware, restaurant ...).
//
//   1. SALE DONE moment: when a payment is accepted, a green tick draws itself with the amount, the phone gives
//      a short buzz, then the receipt opens. It only fires when the receipt really opens, so a failed payment
//      never shows a tick.
//   2. GET-STARTED CHECKLIST for NEW stores (created in the last 45 days): logo, first product,
//      [a category: only stores that have the Categories page], a staff member, first sale.
//      Shown at the top of the dashboard until done or hidden with the X. Owner / manager only.
//
// Reads only (logo, inventory, matCategories, staff, sales, createdAt). Writes nothing to Firebase.
// The "hidden" choice is remembered in this browser. Respects "Reduce motion".

console.log("Wise Decision modern-polish-patch.js — v2 loaded");

(function () {
    'use strict';

    // ---------- helpers ----------
    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function db() { return firebase.database(); }
    function branch() { return (typeof currentBranch !== 'undefined' && currentBranch) ? currentBranch : 'main'; }
    function active() { var s = sid(); return !!document.body && !!s && s !== 'SUPER_ADMIN'; }
    function modern() { return !!document.body && (document.body.classList.contains('wmx') || document.body.classList.contains('wmp')); }
    function full() {
        if (typeof window.wdFullAccess === 'function') return window.wdFullAccess();
        var r = (typeof currentUserRole !== 'undefined' && currentUserRole) ? String(currentUserRole).toLowerCase() : '';
        return r === 'admin' || r === 'manager';
    }
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    var reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }

    // click a sidebar button by its words (every store type words its buttons differently)
    function clickSide(patterns) {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        if (!side) return false;
        var items = Array.prototype.slice.call(side.querySelectorAll('button, .menu-btn')).filter(function (b) {
            return b.id !== 'wm-more-btn' && window.getComputedStyle(b).display !== 'none';
        });
        for (var i = 0; i < patterns.length; i++) {
            var hit = items.filter(function (b) { return patterns[i].test((b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()); })[0];
            if (hit) { hit.click(); return true; }
        }
        return false;
    }

    // =====================================================================
    // 1. SALE DONE MOMENT
    // =====================================================================
    var lastDone = 0;
    function celebrate(amountText) {
        if (!active() || Date.now() - lastDone < 3000) return;
        lastDone = Date.now();
        try { if (navigator.vibrate) navigator.vibrate(25); } catch (e) { /* ignore */ }
        var old = $('wm-done'); if (old) old.remove();
        var d = document.createElement('div');
        d.id = 'wm-done';
        d.innerHTML = '<div class="wm-done-card"><svg viewBox="0 0 52 52" width="76" height="76" aria-hidden="true"><circle class="wm-c" cx="26" cy="26" r="24"/><path class="wm-k" d="M14 27l8 8 16-17"/></svg>' +
            '<div class="wm-done-t">Payment received</div>' + (amountText ? '<div class="wm-done-a">' + esc(amountText) + '</div>' : '') + '</div>';
        document.body.appendChild(d);
        setTimeout(function () { d.classList.add('out'); setTimeout(function () { if (d.parentNode) d.remove(); }, 260); }, reduce ? 900 : 1300);
    }
    function receiptShowing() {
        var ws = $('workspace-content');
        return !!(ws && ws.querySelector('#printable-receipt-box'));   // the hidden template copy is outside the workspace
    }
    function receiptAmount() {
        var ws = $('workspace-content'), el = ws && ws.querySelector('#receipt-grand-total');
        return el && el.textContent ? '₦' + String(el.textContent).replace(/^₦/, '') : '';
    }
    // (a) the shared "Accept Payment & Print Receipt" action
    function wrapCheckout() {
        var f = window.completeSplitCheckout;
        if (typeof f !== 'function' || f.__wmDone) return;
        var wrapped = function () {
            var amt = ($('split-modal-total') || {}).textContent;
            var amountText = amt ? ('₦' + String(amt).replace(/^₦/, '')) : '';
            var already = receiptShowing();
            var out = f.apply(this, arguments);
            var started = Date.now();
            (function poll() {
                if (!already && receiptShowing()) { celebrate(amountText); return; }
                if (Date.now() - started < 4500) setTimeout(poll, 150);
            })();
            return out;
        };
        wrapped.__wmDone = true;
        window.completeSplitCheckout = wrapped;
    }
    // (b) any other sale screen (phone, fashion, electronics ...): a payment-style button was just tapped and a new
    //     receipt opens within 8 seconds. Viewing an old receipt from Reports does not count.
    var PAY = /(accept|confirm|complete|process|finish|record|take)\b.*\b(payment|sale|order)|pay now|charge|mark (as )?paid|checkout/;
    var NOT_PAY = /refund|debt|repay|\bhold|held|cancel|lookup|look up|send to accountant|history/;
    var payClick = 0, wasReceipt = false;
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button, .menu-btn') : null;
        if (!b) return;
        var t = (b.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (PAY.test(t) && !NOT_PAY.test(t)) payClick = Date.now();
    }, true);
    function watchReceipt() {
        var now = receiptShowing();
        if (now && !wasReceipt && Date.now() - payClick < 8000) celebrate(receiptAmount());
        wasReceipt = now;
    }

    // =====================================================================
    // 2. GET-STARTED CHECKLIST (new stores only)
    // =====================================================================
    var chk = { at: 0, busy: false, done: null, created: null };
    function steps() {
        var a = [
            { k: 'logo', t: 'Add your logo', d: 'Shows on your dashboard and receipts', go: function () { switchView('settings-view'); } },
            { k: 'product', t: 'Add your first product', d: 'Stock, prices and units', go: function () { if (!clickSide([/^\W*inventory/, /manage stock/, /electronics stock/, /phone stock/])) switchView('inventory-view'); } }
        ];
        if (modern()) a.push({ k: 'category', t: 'Create a category', d: 'Group your products', go: function () {
            if (typeof window.wmxShowCategories === 'function') window.wmxShowCategories(); else if (typeof window.wmpShowCategories === 'function') window.wmpShowCategories();
        } });
        a.push({ k: 'staff', t: 'Add a staff member', d: 'So every sale has a name on it', go: function () { switchView('staff-view'); } });
        a.push({ k: 'sale', t: 'Make your first sale', d: 'Try the sale screen', go: function () {
            if (!clickSide([/new sale/, /pos sales/, /^\W*(phone|fashion|water|electronics) sales\W*$/])) switchView('pos-view');
        } });
        return a;
    }
    function checklistOff() { var s = sid(); return !s || lsGet('wm-check-off-' + s) === '1'; }
    function loadChecklist(force) {
        var s = sid();
        if (!s || chk.busy || !active() || !full() || checklistOff()) return;
        var now = Date.now();
        if (!force && now - chk.at < 300000) return;     // look again every 5 minutes at most
        chk.busy = true;
        var one = function (path) {
            return db().ref('stores/' + s + '/' + path).orderByKey().limitToFirst(1).once('value').then(function (x) { return x.exists(); }).catch(function () { return null; });
        };
        // "not done" only when EVERY place we look is confirmed empty (stores keep their products and sales in different places)
        var any = function (paths) { return Promise.all(paths.map(one)).then(function (r) { return r.some(function (v) { return v !== false; }); }); };
        Promise.all([
            db().ref('stores/' + s + '/logo').once('value').then(function (x) { var v = x.val(); return typeof v === 'string' && v.length > 0; }).catch(function () { return true; }),
            any(['inventory', 'phoneInventory', 'phone', 'elecStock']),
            modern() ? any(['matCategories']) : Promise.resolve(true),
            any(['staff']),
            any(['transactions', 'sales', 'phoneSales', 'elecSales', 'phone']),
            db().ref('stores/' + s + '/createdAt').once('value').then(function (x) { return x.val(); }).catch(function () { return null; })
        ]).then(function (r) {
            chk = { at: Date.now(), busy: false, created: r[5], done: { logo: r[0], product: r[1], category: r[2], staff: r[3], sale: r[4] } };
            paintChecklist();
        }).catch(function () { chk.busy = false; });
    }
    function checklistWanted() {
        if (!chk.done || checklistOff() || !full()) return false;
        if (!steps().filter(function (st) { return !chk.done[st.k]; }).length) return false;
        var t = Date.parse(chk.created);
        return !isNaN(t) && (Date.now() - t) / 86400000 <= 45;   // only stores created in the last 45 days
    }
    window.wmCheckGo = function (k) { var st = steps().filter(function (x) { return x.k === k; })[0]; if (st) st.go(); };
    window.wmCheckOff = function () { lsSet('wm-check-off-' + sid(), '1'); var c = $('wm-check'); if (c) c.remove(); };
    // where the card goes: above the sales card (hardware), under the brand header (pharmacy), or above the
    // "... Overview / ... Dashboard" title on any other store's home screen
    function anchor() {
        var hero = document.querySelector('.wmx-hero');
        if (hero) return { node: hero, before: true };
        var br = $('wmp-brand');
        if (br) return { node: br, before: false };
        var ws = $('workspace-content'), h2 = ws && ws.querySelector('h2');
        if (h2 && /overview|dashboard/i.test(h2.textContent || '')) return { node: h2, before: true };
        return null;
    }
    function paintChecklist() {
        var card = $('wm-check');
        var at = anchor();
        if (!active() || !checklistWanted() || !at) { if (card) card.remove(); return; }
        var list = steps();
        var total = list.length, doneN = list.filter(function (st) { return chk.done[st.k]; }).length;
        var sig = list.map(function (st) { return st.k + (chk.done[st.k] ? 1 : 0); }).join('');
        if (card && card.getAttribute('data-sig') === sig) return;
        var firstRun = !card;
        if (!card) { card = document.createElement('div'); card.id = 'wm-check'; }
        card.setAttribute('data-sig', sig);
        card.innerHTML =
            '<div class="wm-ck-h"><b>Get started</b><small>' + doneN + ' of ' + total + ' done</small><button class="wm-ck-x" title="Hide" onclick="wmCheckOff()">✕</button></div>' +
            '<div class="wm-ck-bar"><i style="width:' + (firstRun && !reduce ? 0 : Math.round(doneN / total * 100)) + '%"></i></div>' +
            list.map(function (st) {
                var d = chk.done[st.k];
                return '<div class="wm-ck-row' + (d ? ' done' : '') + '"><span class="wm-ck-dot">' + (d ? '✓' : '') + '</span><span class="wm-ck-t"><b>' + esc(st.t) + '</b><small>' + esc(st.d) + '</small></span>' +
                    (d ? '' : '<button class="wm-ck-go" onclick="wmCheckGo(\'' + st.k + '\')">Start ›</button>') + '</div>';
            }).join('');
        if (!card.parentNode) {
            if (at.before) at.node.parentNode.insertBefore(card, at.node);
            else at.node.parentNode.insertBefore(card, at.node.nextSibling);
        }
        if (firstRun && !reduce) {                       // let the bar fill in
            var bar = card.querySelector('.wm-ck-bar i');
            setTimeout(function () { if (bar) bar.style.width = Math.round(doneN / total * 100) + '%'; }, 60);
        }
    }

    // =====================================================================
    // CSS (uses the store's own colours when it has them, plain blue otherwise)
    // =====================================================================
    function addCss() {
        if ($('wm-polish-css')) return;
        var css =
        '#wm-done{position:fixed;inset:0;z-index:3200;display:flex;align-items:center;justify-content:center;background:rgba(10,14,20,.42);animation:wm-fade .18s ease-out both;pointer-events:none;}' +
        '#wm-done.out{opacity:0;transition:opacity .25s;}' +
        '.wm-done-card{background:#fff;color:#0f172a;border-radius:28px;padding:26px 38px 24px;text-align:center;box-shadow:0 30px 70px rgba(0,0,0,.35);animation:wm-pop .34s cubic-bezier(.2,1.3,.4,1) both;}' +
        '.wm-done-card svg{display:block;margin:0 auto 8px;}' +
        '.wm-c{fill:#22c55e;stroke:none;}' +
        '.wm-k{fill:none;stroke:#fff;stroke-width:4.5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:36;stroke-dashoffset:36;animation:wm-draw .42s .18s ease-out forwards;}' +
        '.wm-done-t{font-size:18px;font-weight:900;letter-spacing:-.3px;}.wm-done-a{font-size:28px;font-weight:900;letter-spacing:-1px;color:#16a34a;margin-top:2px;}' +
        '@keyframes wm-fade{from{opacity:0}to{opacity:1}}' +
        '@keyframes wm-pop{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:none}}' +
        '@keyframes wm-draw{to{stroke-dashoffset:0}}' +
        '#wm-check{background:var(--wx-surf,#fff);border:1px solid var(--wx-line,#e2e8f0);border-radius:22px;padding:14px 16px 6px;margin:0 0 14px;color:var(--wx-ink,#0f172a);box-sizing:border-box;}' +
        '#wm-check *{box-sizing:border-box;}' +
        '.wm-ck-h{display:flex;align-items:center;gap:10px;}.wm-ck-h b{font-size:16px;font-weight:900;letter-spacing:-.3px;}.wm-ck-h small{font-size:12px;font-weight:700;color:var(--wx-mut,#64748b);}' +
        '.wm-ck-x{margin-left:auto;width:28px;height:28px;border:none;background:var(--wx-bg,#f1f5f9);color:inherit;border-radius:99px;font-size:12px;cursor:pointer;padding:0;}' +
        '.wm-ck-bar{height:6px;border-radius:99px;background:var(--wx-line,#e2e8f0);margin:10px 0 6px;overflow:hidden;}' +
        '.wm-ck-bar i{display:block;height:100%;background:var(--wx-acc,#0284c7);border-radius:99px;transition:width .6s ease;}' +
        '.wm-ck-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--wx-line,#e2e8f0);}' +
        '.wm-ck-dot{width:22px;height:22px;border-radius:50%;border:2px solid var(--wx-line,#cbd5e1);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:#fff;}' +
        '.wm-ck-row.done .wm-ck-dot{background:#22c55e;border-color:#22c55e;}' +
        '.wm-ck-row.done .wm-ck-t{text-decoration:line-through;opacity:.55;}' +
        '.wm-ck-t{min-width:0;}.wm-ck-t b{display:block;font-size:14px;font-weight:800;}.wm-ck-t small{display:block;font-size:12px;font-weight:600;color:var(--wx-mut,#64748b);}' +
        '.wm-ck-go{margin-left:auto;flex-shrink:0;width:auto;margin-bottom:0;border:none;background:var(--wx-acc,#0284c7);color:var(--wx-acc-ink,#fff);border-radius:10px;padding:8px 14px;font-weight:800;font-size:12px;cursor:pointer;}' +
        '@media (prefers-reduced-motion:reduce){#wm-done,.wm-done-card,.wm-k{animation:none !important;}.wm-k{stroke-dashoffset:0 !important;}.wm-ck-bar i{transition:none !important;}}';
        var st = document.createElement('style');
        st.id = 'wm-polish-css';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // =====================================================================
    // keep it applied
    // =====================================================================
    function tick() {
        try {
            if (!document.body) return;
            addCss();
            if (!active()) { var c = $('wm-check'); if (c) c.remove(); wasReceipt = false; return; }
            wrapCheckout();
            watchReceipt();
            loadChecklist(false);
            paintChecklist();
        } catch (e) { console.warn('[modern-polish]', e); }
    }
    window.__wmTest = { tick: tick };
    var pending = false;
    function schedule() { if (pending) return; pending = true; setTimeout(function () { pending = false; tick(); }, 200); }

    function start() {
        tick();
        if (document.body) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        setInterval(tick, 4000);
    }
    if (document.readyState === 'complete') setTimeout(start, 1700);
    else window.addEventListener('load', function () { setTimeout(start, 1700); });
})();
