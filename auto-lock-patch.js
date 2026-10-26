// ==================== WISE DECISION AUTO-LOCK PATCH (v3) ====================
// Load LAST, after payments-patch.js and banner-fix-patch.js (defer).
//
// - Reads billing/<storeId>/dueDate (the same field the subscription banner uses).
// - Locks the store ON its due date (GRACE_DAYS = 0). Set GRACE_DAYS = 1 to lock the day after.
// - A locked store sees ONLY the Subscription screen from payments-patch.js
//   (pay-to account, "I've Paid — send for approval", payment requests). It cannot be closed.
// - Unlocks by itself the moment you approve a payment and the due date moves forward.
// - No database writes, so no rules changes are needed for locking.
//
// NOTE: this is a front-end lock. It stops normal users; a technical user could bypass it.

(function () {
    'use strict';
    console.log('Wise Decision auto-lock-patch.js — v3 loaded');

    var GRACE_DAYS = 0;
    var TICK_MS = 1000;
    var st = { sid: null, due: null, ref: null, offset: 0, locked: false, lastOpen: 0 };

    function pad(n) { return String(n).padStart(2, '0'); }
    function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function today() { return fmt(new Date(Date.now() + st.offset)); }   // server-corrected, so a wrong phone clock can't cheat
    function addDays(ymd, n) { var p = ymd.split('-'); return fmt(new Date(+p[0], +p[1] - 1, +p[2] + n)); }
    function isDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }

    // CSS: put the Subscription modal above everything and remove its close button while locked
    var css = document.createElement('style');
    css.textContent =
        'body.wdal-locked #wdp-modal{z-index:2147483000 !important;padding-top:64px !important;}' +
        'body.wdal-locked #wdp-modal button[onclick="wdpCloseModal()"]{display:none !important;}';
    document.head.appendChild(css);

    // The modal's own close function does nothing while locked
    var origClose = window.wdpCloseModal;
    if (typeof origClose === 'function') {
        window.wdpCloseModal = function () { if (st.locked) return; return origClose.apply(this, arguments); };
    }

    // Which store is signed in (only when the dashboard is on screen; never for Super Admin)
    function activeStoreId() {
        try {
            var wrap = document.getElementById('dashboard-main-wrapper');
            if (!wrap || !wrap.classList.contains('active')) return null;
            if (typeof currentStoreId === 'undefined' || !currentStoreId || currentStoreId === 'SUPER_ADMIN') return null;
            return currentStoreId;
        } catch (e) { return null; }
    }

    function attach(sid) {
        detach();
        st.sid = sid;
        if (!sid || !window.firebase || !firebase.database) return;
        try {
            var db = firebase.database();
            db.ref('.info/serverTimeOffset').once('value').then(function (s) { st.offset = s.val() || 0; });
            st.ref = db.ref('billing/' + sid + '/dueDate');
            st.ref.on('value', function (s) { st.due = s.val(); evaluate(); }, function () { /* offline/denied: keep last state */ });
        } catch (e) { }
    }
    function detach() {
        try { if (st.ref) st.ref.off(); } catch (e) { }
        st.ref = null; st.sid = null; st.due = null;
        setLocked(false);
    }

    function evaluate() {
        setLocked(isDay(st.due) && today() >= addDays(st.due, GRACE_DAYS));
    }

    function setLocked(on) {
        st.locked = on;
        document.body.classList.toggle('wdal-locked', on);
        if (!on) {
            var o = document.getElementById('wdal-overlay');
            if (o) o.remove();
            document.body.style.overflow = '';
        }
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
        // click the app's own Logout button so it runs the normal sign-out
        var els = document.querySelectorAll('button, a, li');
        for (var i = 0; i < els.length; i++) {
            var e = els[i];
            if (e.closest('#wdal-overlay')) continue;
            if (/^\W*log\s*out\W*$/i.test((e.textContent || '').trim())) { e.click(); return; }
        }
        ['logout', 'handleLogout', 'doLogout'].forEach(function (n) { if (typeof window[n] === 'function') { try { window[n](); } catch (e) { } } });
        try { firebase.auth().signOut(); } catch (e) { }
        setTimeout(function () { location.reload(); }, 500);
    }

    // Keep the Subscription screen open
    function ensureModal() {
        var m = document.getElementById('wdp-modal');
        var shown = m && m.style.display !== 'none' && m.getClientRects().length > 0;
        if (shown) return;
        if (Date.now() - st.lastOpen < 2500) return;
        st.lastOpen = Date.now();
        if (typeof wdpOpenRenew === 'function') wdpOpenRenew(st.sid);
    }

    setInterval(function () {
        try {
            var sid = activeStoreId();
            if (sid !== st.sid) attach(sid);
            if (st.sid) evaluate();              // re-check so it locks at midnight with the app open
            if (st.locked) { ensureOverlay(); ensureModal(); }
        } catch (e) { /* never break the app */ }
    }, TICK_MS);
})();
