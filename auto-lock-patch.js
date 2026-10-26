// ==================== WISE DECISION AUTO-LOCK PATCH (v2) ====================
// Load LAST (after payments-patch.js and banner-fix-patch.js).
//
// - Locks a store ON its due date (set WDAL_GRACE_DAYS above 0 to allow extra days).
// - A locked store sees ONLY the Subscription / payment screen (cannot close it).
// - Computed live from the store's due date, so it unlocks by itself the moment
//   Super Admin approves a payment and the due date moves forward.
// - No database writes, so no rules changes are needed.
// - Super Admin can still lock a store by hand (stores/<id>/locked = true with a
//   reason other than "auto"), and can opt a store out with autoLockDisabled = true.
//
// IMPORTANT: this is a front-end lock (fine for honest customers). A determined
// user could bypass it with browser tools; real enforcement belongs in Firebase rules.

(function () {
    'use strict';
    console.log('Wise Decision auto-lock-patch.js — v2 loaded');

    var WDAL_GRACE_DAYS = 0;     // 0 = lock on the due date itself
    var TICK_MS = 1500;

    var st = { sid: null, ref: null, store: null, offset: 0, locked: false, lastOpen: 0, opener: null };

    // ---------- helpers ----------
    function pad(n) { return String(n).padStart(2, '0'); }
    function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function today() { return fmt(new Date(Date.now() + st.offset)); }
    function addDays(ymd, n) {
        var p = ymd.split('-');
        return fmt(new Date(+p[0], +p[1] - 1, +p[2] + n));
    }
    function toYmd(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return v > 1e11 ? fmt(new Date(v)) : null;
        if (typeof v === 'string') {
            if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.substring(0, 10);
            var t = Date.parse(v);
            return isNaN(t) ? null : fmt(new Date(t));
        }
        return null;
    }

    // Find the due date anywhere in the store record (field name is auto-detected).
    var PRIORITY = ['billingDueDate', 'nextDueDate', 'dueDate', 'planDueDate', 'subscriptionDue', 'subscriptionDueDate', 'nextPaymentDue', 'paidUntil', 'expiresAt'];
    var SKIP = /^(payments?|paymentRequests?|requests?|history|members|products|transactions|sales|log|logs|staff|customers)$/i;
    function collect(obj, depth, out) {
        if (!obj || typeof obj !== 'object' || depth > 3) return;
        Object.keys(obj).forEach(function (k) {
            var v = obj[k];
            if (v && typeof v === 'object') { if (!SKIP.test(k)) collect(v, depth + 1, out); return; }
            if ((/due/i.test(k) && !/(paid|last|prev|created)/i.test(k)) || PRIORITY.indexOf(k) !== -1) {
                var y = toYmd(v);
                if (y) out.push({ key: k, ymd: y });
            }
        });
    }
    function getDue(store) {
        var out = [];
        collect(store, 0, out);
        if (!out.length) return '';
        for (var i = 0; i < PRIORITY.length; i++) {
            for (var j = 0; j < out.length; j++) if (out[j].key === PRIORITY[i]) return out[j].ymd;
        }
        return out[0].ymd;
    }

    // ---------- which store is logged in? ----------
    function getStoreId() {
        var sa = document.getElementById('super-admin-view');
        if (sa && sa.style.display !== 'none' && sa.offsetParent !== null) return null;
        var names = ['currentStoreId', 'storeId', 'currentStore', 'activeStoreId', 'wdStoreId', 'STORE_ID'];
        for (var i = 0; i < names.length; i++) {
            var v;
            try { v = window[names[i]]; } catch (e) { v = null; }
            if (typeof v === 'string' && v) return v;
            if (v && typeof v === 'object' && (v.id || v.storeId)) return v.id || v.storeId;
        }
        return null;
    }

    // ---------- listen to the store record ----------
    function attach(sid) {
        detach();
        st.sid = sid;
        if (!sid || !window.firebase || !firebase.database) return;
        try {
            firebase.database().ref('.info/serverTimeOffset').once('value').then(function (s) { st.offset = s.val() || 0; });
            st.ref = firebase.database().ref('stores/' + sid);
            st.ref.on('value', function (snap) { st.store = snap.val() || {}; evaluate(); }, function () { /* offline / denied: keep last state */ });
        } catch (e) { }
    }
    function detach() {
        try { if (st.ref) st.ref.off(); } catch (e) { }
        st.ref = null; st.store = null; st.sid = null;
        setLocked(false);
    }

    function evaluate() {
        var s = st.store;
        if (!s) return setLocked(false);
        if (s.autoLockDisabled) return setLocked(!!(s.locked && s.lockedReason !== 'auto'));
        var manual = !!(s.locked && s.lockedReason !== 'auto');
        var due = getDue(s);
        var overdue = due ? today() >= addDays(due, WDAL_GRACE_DAYS) : false;
        setLocked(manual || overdue);
    }

    // ---------- lock screen ----------
    function setLocked(on) {
        st.locked = on;
        if (!on) removeOverlay();
    }

    function removeOverlay() {
        var o = document.getElementById('wdal-overlay');
        if (o) o.remove();
        document.body.style.overflow = '';
        // let the subscription modal be closed again
        document.querySelectorAll('[data-wdal-modal]').forEach(function (m) {
            m.removeAttribute('data-wdal-modal');
            m.querySelectorAll('[data-wdal-hidden]').forEach(function (b) { b.style.display = ''; b.removeAttribute('data-wdal-hidden'); });
        });
    }

    function ensureOverlay() {
        if (document.getElementById('wdal-overlay')) return;
        var o = document.createElement('div');
        o.id = 'wdal-overlay';
        o.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.97);z-index:2147482000;';
        o.innerHTML =
            '<div style="position:fixed;top:0;left:0;right:0;z-index:2147483100;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;background:#b91c1c;color:#fff;font:600 14px system-ui,sans-serif;">' +
                '<span>🔒 Account locked — subscription payment is due</span>' +
                '<button id="wdal-logout" style="background:rgba(255,255,255,.2);color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:8px;padding:6px 12px;font-weight:600;">Log out</button>' +
            '</div>';
        document.body.appendChild(o);
        document.body.style.overflow = 'hidden';
        document.getElementById('wdal-logout').onclick = doLogout;
    }

    function doLogout() {
        var els = document.querySelectorAll('button, a, li, div, span');
        for (var i = 0; i < els.length; i++) {
            var e = els[i];
            if (e.closest('#wdal-overlay')) continue;
            if (e.children.length <= 2 && /^\W*log\s*out\W*$/i.test((e.textContent || '').trim())) { e.click(); return; }
        }
        ['logout', 'handleLogout', 'doLogout', 'signOut'].forEach(function (n) { if (typeof window[n] === 'function') { try { window[n](); } catch (e) { } } });
        try { firebase.auth().signOut(); } catch (e) { }
        setTimeout(function () { location.reload(); }, 400);
    }

    // The existing Subscription modal (the "I've Paid — send for approval" screen)
    function findModal() {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            if (/send for approval/i.test(btns[i].textContent || '')) {
                var el = btns[i];
                for (var d = 0; d < 10 && el; d++, el = el.parentElement) {
                    if (getComputedStyle(el).position === 'fixed') return el;
                }
            }
        }
        return null;
    }

    function findOpener() {
        if (st.opener) return st.opener;
        var best = null;
        Object.keys(window).forEach(function (k) {
            var f;
            try { f = window[k]; } catch (e) { return; }
            if (typeof f !== 'function' || f.length > 0) return;
            if (/^wdp/i.test(k) && /(open|show)/i.test(k) && /(sub|renew|pay)/i.test(k)) {
                if (!best || /sub/i.test(k)) best = f;
            }
        });
        st.opener = best;
        return best;
    }

    function openSubscription() {
        if (Date.now() - st.lastOpen < 3000) return;
        st.lastOpen = Date.now();
        var f = findOpener();
        if (f) { try { f(); return; } catch (e) { } }
        // fallback: press the "Renew now" / "Subscription" button that already exists
        var els = document.querySelectorAll('button, a');
        for (var i = 0; i < els.length; i++) {
            if (els[i].closest('#wdal-overlay')) continue;
            if (/renew now|subscription/i.test(els[i].textContent || '')) { els[i].click(); return; }
        }
    }

    function ensureModal() {
        var m = findModal();
        if (!m) { openSubscription(); return; }
        m.setAttribute('data-wdal-modal', '1');
        m.style.setProperty('z-index', '2147483000', 'important');
        // remove the close (×) so the store cannot dismiss it
        m.querySelectorAll('button, span, div').forEach(function (b) {
            var t = (b.textContent || '').trim();
            if (/^[×✕✖xX]$/.test(t)) { b.style.display = 'none'; b.setAttribute('data-wdal-hidden', '1'); }
        });
        // keep the top banner from covering the modal
        if (m.firstElementChild && !m.dataset.wdalPad) {
            m.dataset.wdalPad = '1';
            m.style.setProperty('padding-top', '56px', 'important');
        }
    }

    // ---------- main loop ----------
    setInterval(function () {
        try {
            var sid = getStoreId();
            if (sid !== st.sid) attach(sid);
            if (st.store) evaluate();          // re-check so it locks at midnight with the app open
            if (st.locked) { ensureOverlay(); ensureModal(); }
        } catch (e) { /* never break the app */ }
    }, TICK_MS);
})();
