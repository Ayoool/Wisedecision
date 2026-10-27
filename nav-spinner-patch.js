// ==================== WISE DECISION NAV SPINNER PATCH (v2) ====================
// Load with defer, after the other patches (loading it last is fine).
//
// 1. OPENING A SCREEN. When someone taps a sidebar option (Inventory, Reports, Staff, ...), a small
//    "Opening Inventory..." spinner appears AT ONCE. It disappears when the screen has finished loading:
//      - never before 0.35 seconds (so it does not just flash),
//      - then as soon as no "Loading..." text is left on the screen,
//      - and never later than 3 seconds.
//    Not shown for: Logout, Clock In / Out, Subscription (that one has its own loading screen).
//
// 2. SAVING A PRODUCT (v2). Tapping Save / Add in the product form shows "Saving product..." until the form
//    closes (never longer than 6 seconds). The bulk-add sheet uses the same spinner while it saves.
//
// The spinner always hides the moment the app shows an alert (an alert means the action finished or failed),
// so it can never sit on top of a message.
// It adds NO artificial waiting.

(function () {
    'use strict';
    console.log('Wise Decision nav-spinner-patch.js — v2 loaded');

    var MIN_MS = 350, CHECK_MS = 150;
    var NAV_MAX = 3000, SAVE_MAX = 6000;
    var timer = null, shownAt = 0, mode = 'nav', maxMs = NAV_MAX;
    var SKIP = /log\s*out|clock\s*(in|out)|subscription/i;
    var LOADING = /loading\s*(\.\.\.|…)/i;
    var SAVE_TEXT = /save|add|update|submit|create/i;
    var NOT_SAVE = /cancel|close|✕|back/i;

    function ensureStyle() {
        if (document.getElementById('wdnav-style')) return;
        var st = document.createElement('style');
        st.id = 'wdnav-style';
        st.textContent =
            '@keyframes wdnav-spin{to{transform:rotate(360deg)}}' +
            '#wdnav-spin{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(248,250,252,0.55);}' +
            '#wdnav-spin .wdnav-card{background:#fff;border-radius:14px;padding:16px 22px;box-shadow:0 10px 30px rgba(15,23,42,0.18);display:flex;align-items:center;gap:12px;font:600 14px system-ui,-apple-system,sans-serif;color:#0f172a;max-width:80vw;}' +
            '#wdnav-spin .wdnav-ring{width:22px;height:22px;border:3px solid #bae6fd;border-top-color:#0284c7;border-radius:50%;animation:wdnav-spin .7s linear infinite;flex:none;}';
        document.head.appendChild(st);
    }

    // text: what to say. opts.mode: 'nav' (hides when the screen has loaded), 'save' (hides when the product form
    // closes) or 'manual' (stays until wdnavHide() is called). opts.maxMs: the longest it may stay.
    function show(text, opts) {
        opts = opts || {};
        ensureStyle();
        mode = opts.mode || 'nav';
        maxMs = opts.maxMs || (mode === 'save' ? SAVE_MAX : NAV_MAX);
        var el = document.getElementById('wdnav-spin');
        if (!el) {
            el = document.createElement('div');
            el.id = 'wdnav-spin';
            el.innerHTML = '<div class="wdnav-card"><div class="wdnav-ring"></div><span id="wdnav-label"></span></div>';
            document.body.appendChild(el);
        }
        document.getElementById('wdnav-label').textContent = text || 'Loading...';
        shownAt = Date.now();
        clearTimeout(timer);
        timer = setTimeout(tick, MIN_MS);
    }

    function hide() {
        clearTimeout(timer);
        timer = null;
        var el = document.getElementById('wdnav-spin');
        if (el) el.remove();
    }

    window.wdnavShow = show;
    window.wdnavHide = hide;

    // True while the visible screen still shows a "Loading..." placeholder
    function stillLoading() {
        var nodes = [document.getElementById('workspace-content')];
        document.querySelectorAll('[id$="-view"]').forEach(function (v) { if (v.getClientRects().length) nodes.push(v); });
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i] && LOADING.test(nodes[i].textContent || '')) return true;
        }
        return false;
    }

    function productFormClosed() {
        var m = document.getElementById('product-form-modal');
        return !m || m.style.display === 'none' || m.getClientRects().length === 0;
    }

    function tick() {
        var age = Date.now() - shownAt;
        var done = mode === 'save' ? productFormClosed() : (mode === 'manual' ? false : !stillLoading());
        if (age >= maxMs || (age >= MIN_MS && done)) { hide(); return; }
        timer = setTimeout(tick, CHECK_MS);
    }

    // An alert means the action has finished (or failed): take the spinner away first so it never covers the message
    var origAlert = window.alert;
    window.alert = function () {
        hide();
        return origAlert.apply(this, arguments);
    };

    // Listen for taps (does not stop or change the tap itself)
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!b || b.disabled) return;
        var text = (b.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return;

        // Save / Add inside the product form
        if (b.closest('#product-form-modal')) {
            if (SAVE_TEXT.test(text) && !NOT_SAVE.test(text)) show('Saving product...', { mode: 'save' });
            return;
        }

        // Sidebar options
        if (!b.closest('.sidebar')) return;
        if (SKIP.test(text)) return;
        var label = text.replace(/^[^A-Za-z0-9]+/, '');   // drop the leading emoji
        show(label ? 'Opening ' + label + '...' : 'Loading...', { mode: 'nav' });
    }, true);
})();
