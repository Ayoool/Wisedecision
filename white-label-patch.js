// ==================== WISE DECISION WHITE-LABEL LOGIN (v1) ====================
// Gives ONE client his own branded login screen. Nobody else is affected.
//
// How it works: the client opens a link that ends in  ?brand=<his-id>  e.g.
//     https://ayoool.github.io/Wisedecision/app.html?brand=client1
// The first time, his phone remembers it, so the saved home-screen icon / later visits stay branded.
// Everyone who opens the normal link sees the normal Wise Decision screen.
// To switch it off on a phone, open the link with  ?brand=off
//
// For a branded phone, the login screen:
//   * shows HIS business name (and his logo if you give one) in place of the WD logo
//   * hides: Register New Business, Order goods (customers), Renew or pay subscription (and the "or" line)
//   * uses his colours, and replaces the Wise Decision photo background
//   * sets the browser tab title and the "Add to Home Screen" name to his business name
//
// Add a client: copy the 'client1' block below, give it a new id, fill in his details.
// LOAD THIS EARLY: put it in the <head> of app.html right after the style.css line (no "defer"),
// so his screen never flashes the Wise Decision logo first.

(function () {
    'use strict';

    var CLIENTS = {
        'client1': {
            name: 'Your Client Business Name',
            tagline: 'Staff & Admin Login',
            logo: '',                 // optional: a picture file next to app.html, e.g. 'clients/client1.png'. '' = name only
            color: '#0f766e',         // buttons, links, top edge of the login card
            color2: '#134e4a',        // darker shade for the background
            hide: ['register new business', 'order goods', 'renew or pay subscription']   // lower case; add more words to hide more
        }
    };

    var KEY = 'wd-brand';
    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
    function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

    function pick() {
        var q = null;
        try { q = new URLSearchParams(location.search).get('brand'); } catch (e) { /* ignore */ }
        if (q) {
            q = norm(q);
            if (q === 'off') { lsDel(KEY); return null; }
            if (CLIENTS[q]) { lsSet(KEY, q); return q; }
        }
        var saved = lsGet(KEY);
        return (saved && CLIENTS[saved]) ? saved : null;
    }

    var id = pick();
    if (!id) return;                       // not a branded phone: do nothing at all
    var C = CLIENTS[id];
    var root = document.documentElement;
    root.classList.add('wl-on');

    // ---------- tab title, home-screen name and icon ----------
    function setMeta() {
        try {
            document.title = C.name;
            [['apple-mobile-web-app-title', C.name], ['application-name', C.name]].forEach(function (m) {
                var el = document.querySelector('meta[name="' + m[0] + '"]');
                if (el) el.setAttribute('content', m[1]);
            });
            if (C.logo) document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach(function (l) { l.setAttribute('href', C.logo); });
            var tc = document.querySelector('meta[name="theme-color"]');
            if (!tc) { tc = document.createElement('meta'); tc.setAttribute('name', 'theme-color'); document.head.appendChild(tc); }
            tc.setAttribute('content', C.color2);
        } catch (e) { /* ignore */ }
    }
    setMeta();
    document.addEventListener('DOMContentLoaded', setMeta);

    // ---------- look ----------
    var st = document.createElement('style');
    st.id = 'wl-css';
    st.textContent =
        'html.wl-on.wl-login body,html.wl-on.wl-login .app-container,html.wl-on #login-view,html.wl-on #login-view .auth-wrapper{background:linear-gradient(135deg,' + C.color2 + ' 0%,' + C.color + ' 100%) !important;background-image:linear-gradient(135deg,' + C.color2 + ' 0%,' + C.color + ' 100%) !important;}' +
        'html.wl-on #login-view .auth-card{border-top-color:' + C.color + ' !important;}' +
        'html.wl-on #login-view .auth-card .brand-title{font-size:26px !important;font-weight:900 !important;height:auto !important;line-height:1.15 !important;background-image:none !important;margin:6px 0 4px !important;text-align:center !important;color:' + C.color2 + ' !important;}' +
        'html.wl-on #login-view .auth-card .brand-title *{display:inline !important;}' +
        'html.wl-on #login-view .auth-card .brand-title img{display:block !important;margin:0 auto 8px;max-width:220px;max-height:110px;object-fit:contain;}' +
        'html.wl-on #login-view .auth-card .brand-title .wl-name{display:block !important;}' +
        'html.wl-on #login-view .auth-card .subtitle{margin-top:0 !important;}' +
        'html.wl-on #login-view button.btn-action-primary,html.wl-on #login-view .menu-btn.btn-action-primary{background:linear-gradient(135deg,' + C.color + ' 0%,' + C.color2 + ' 100%) !important;border-color:' + C.color + ' !important;}' +
        'html.wl-on #login-view a{color:' + C.color + ' !important;}';
    (document.head || root).appendChild(st);

    // ---------- what to hide ----------
    function hit(text) { return C.hide.some(function (p) { return text.indexOf(p) !== -1; }); }
    function hideEl(el) {
        if (el.getAttribute('data-wl-h') === '1') return;
        el.setAttribute('data-wl-h', '1');
        el.style.setProperty('display', 'none', 'important');
    }
    function hideMatches(lv) {
        var all = Array.prototype.slice.call(lv.querySelectorAll('button, a, [onclick], div, span, p, label'));
        all.forEach(function (el) {
            if (el.getAttribute('data-wl-h') === '1') return;
            var t = norm(el.textContent);
            if (!t || !hit(t)) return;
            // only the smallest element that holds the words (never a container that also holds Sign in)
            var inner = Array.prototype.slice.call(el.children).some(function (ch) { return hit(norm(ch.textContent)); });
            if (inner) return;
            var box = el.closest ? (el.closest('button, a, [onclick]') || el) : el;
            if (norm(box.textContent).length > 80) box = el;
            hideEl(box);
        });
        // the little "— or —" line between the buttons
        all.forEach(function (el) {
            if (el.getAttribute('data-wl-h') === '1' || norm(el.textContent) !== 'or') return;
            var top = el;
            while (top.parentElement && top.parentElement !== lv && norm(top.parentElement.textContent) === 'or' && !/auth-card/.test(top.parentElement.className || '')) top = top.parentElement;
            hideEl(top);
        });
    }

    // ---------- name / logo / tagline ----------
    function brandTitle(lv) {
        var bt = lv.querySelector('.brand-title');
        if (bt && bt.getAttribute('data-wl') !== id) {
            bt.setAttribute('data-wl', id);
            bt.textContent = '';              // clears the old logo text completely
            if (C.logo) { var img = document.createElement('img'); img.setAttribute('src', C.logo); img.setAttribute('alt', C.name); bt.appendChild(img); }
            var n = document.createElement('span'); n.className = 'wl-name'; n.textContent = C.name; bt.appendChild(n);
        }
        var sub = lv.querySelector('.subtitle');
        if (sub && sub.textContent !== C.tagline) sub.textContent = C.tagline;
    }

    var busy = false, queued = false;
    function apply() {
        if (busy) return;
        busy = true;
        try {
            var lv = document.getElementById('login-view');
            var on = !!(lv && lv.classList.contains('active'));
            if (root.classList.contains('wl-login') !== on) root.classList.toggle('wl-login', on);
            if (lv) { brandTitle(lv); hideMatches(lv); }
        } catch (e) { /* never break the app */ }
        busy = false;
    }
    function schedule() {
        if (queued) return;
        queued = true;
        (window.requestAnimationFrame || setTimeout)(function () { queued = false; apply(); });
    }
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    // if the page is already built when this file runs (e.g. loaded late), apply straight away; otherwise the observer
    // and DOMContentLoaded below apply it as soon as the login screen exists
    if (document.readyState !== 'loading') apply();
    document.addEventListener('DOMContentLoaded', apply);
    window.addEventListener('load', function () { apply(); setTimeout(apply, 800); setTimeout(apply, 2500); });
})();
