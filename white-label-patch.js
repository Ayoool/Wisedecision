// ==================== WISE DECISION WHITE-LABEL LOGIN (v2) ====================
// Gives ONE customer his own branded login screen. Nobody else is affected.
//
// The customer opens a link ending in  ?brand=<his-id>, for example
//     https://ayoool.github.io/Wisedecision/app.html?brand=yumyum
// His phone remembers it, so the home-screen icon and later visits stay branded. Everyone else opening the
// normal link sees the normal Wise Decision screen. To switch a phone back to normal open  ?brand=off
//
// On a branded phone the login screen shows HIS business name (and logo), hides Register New Business /
// Order goods / Renew or pay subscription, uses his colours, and the browser tab + "Add to Home Screen" name
// become his business name.
//
// WHERE THE CUSTOMER'S DETAILS COME FROM
//   1. Firebase  brands/<id>   <- you add customers from Super Admin (button "Brand a customer"); no code editing.
//   2. The CLIENTS list below  <- backup that always works, even offline or before the Firebase rule is added.
// A customer can also have a BACKGROUND PICTURE behind the login card (field  bg  = a picture link or file name).
// Details are kept on his phone after the first visit, so the next login screen is instant.
//
// HOME-SCREEN ICON: on a branded phone the page gets its own web-app manifest whose start address is
// his branded link, so the saved icon opens HIS login screen (a home-screen app keeps separate storage and
// otherwise would not know which customer it belongs to).
//
// LOAD THIS EARLY: in the <head> of app.html right after the style.css line, with NO "defer".

(function () {
    'use strict';

    var CLIENTS = {
        'yumyum': {
            name: 'YUM YUM NIG ENTERPRISES',
            tagline: 'Staff & Admin Login',
            logo: '',
            color: '#ea580c',
            color2: '#9a3412'
        }
    };
    var DEFAULT_HIDE = ['register new business', 'order goods', 'renew or pay subscription'];
    var DB = 'https://wisedecision-24c4e-default-rtdb.firebaseio.com';
    var KEY = 'wd-brand';

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
    function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }
    function clean(id) { return String(id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30); }
    function color(c) { return /^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? String(c) : null; }
    function bgUrl(v) {                         // a data:image..., https://... or a file in this site; anything else is dropped
        v = String(v || '').replace(/[^A-Za-z0-9\-._~:\/?#@!$&+,=%;]/g, '');   // keeps only characters a web address needs
        return /^(data:image\/|https:\/\/|[a-z0-9_\-\/.]+$)/i.test(v) ? v : '';
    }
    function list(v) { return Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).map(function (k) { return v[k]; }) : []); }
    function full(c) {
        var hide = list(c.hide).map(norm).filter(Boolean);
        return {
            name: String(c.name || '').trim() || 'My Business',
            tagline: String(c.tagline || '').trim() || 'Staff & Admin Login',
            logo: String(c.logo || ''),
            bg: bgUrl(c.bg),
            color: color(c.color) || '#0f766e',
            color2: color(c.color2) || '#134e4a',
            hide: hide.length ? hide : DEFAULT_HIDE
        };
    }

    // ---------- which customer? ----------
    var param = null;
    try { param = new URLSearchParams(location.search).get('brand'); } catch (e) { /* ignore */ }
    param = param ? norm(param) : null;
    if (param === 'off') { lsDel(KEY); return; }
    var id = clean(param || lsGet(KEY));
    if (!id) return;                           // not a branded phone: do nothing at all

    var root = document.documentElement;
    var C = null, booted = false, version = 0, st = null;
    try { var cached = JSON.parse(lsGet('wd-brand-cfg-' + id) || 'null'); if (cached) C = full(cached); } catch (e) { /* ignore */ }
    if (!C && CLIENTS[id]) C = full(CLIENTS[id]);

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

    // ---------- look ----------
    function buildCss() {
        if (!st) { st = document.createElement('style'); st.id = 'wl-css'; (document.head || root).appendChild(st); }
        var bgRule = C.bg
            ? 'background:linear-gradient(rgba(0,0,0,.38),rgba(0,0,0,.38)),var(--wl-bg) center/cover no-repeat ' + C.color2 + ' !important;'
            : 'background:linear-gradient(135deg,' + C.color2 + ' 0%,' + C.color + ' 100%) !important;background-image:linear-gradient(135deg,' + C.color2 + ' 0%,' + C.color + ' 100%) !important;';
        st.textContent =
            (C.bg ? 'html.wl-on{--wl-bg:url("' + C.bg + '");}' : '') +
            'html.wl-on.wl-login body,html.wl-on.wl-login .app-container,html.wl-on #login-view,html.wl-on #login-view .auth-wrapper{' + bgRule + '}' +
            'html.wl-on #login-view .auth-card{border-top-color:' + C.color + ' !important;}' +
            'html.wl-on #login-view .auth-card .brand-title{font-size:26px !important;font-weight:900 !important;height:auto !important;line-height:1.15 !important;background-image:none !important;margin:6px 0 4px !important;text-align:center !important;color:' + C.color2 + ' !important;}' +
            'html.wl-on #login-view .auth-card .brand-title *{display:inline !important;}' +
            'html.wl-on #login-view .auth-card .brand-title img{display:block !important;margin:0 auto 8px;max-width:220px;max-height:110px;object-fit:contain;}' +
            'html.wl-on #login-view .auth-card .brand-title .wl-name{display:block !important;}' +
            'html.wl-on #login-view .auth-card .subtitle{margin-top:0 !important;}' +
            'html.wl-on #login-view button.btn-action-primary,html.wl-on #login-view .menu-btn.btn-action-primary{background:linear-gradient(135deg,' + C.color + ' 0%,' + C.color2 + ' 100%) !important;border-color:' + C.color + ' !important;}' +
            'html.wl-on #login-view a{color:' + C.color + ' !important;}';
    }

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
            var inner = Array.prototype.slice.call(el.children).some(function (ch) { return hit(norm(ch.textContent)); });
            if (inner) return;                                     // only the smallest element that holds the words
            var box = el.closest ? (el.closest('button, a, [onclick]') || el) : el;
            if (norm(box.textContent).length > 80) box = el;
            hideEl(box);
        });
        all.forEach(function (el) {                               // the little "— or —" line
            if (el.getAttribute('data-wl-h') === '1' || norm(el.textContent) !== 'or') return;
            var top = el;
            while (top.parentElement && top.parentElement !== lv && norm(top.parentElement.textContent) === 'or' && !/auth-card/.test(top.parentElement.className || '')) top = top.parentElement;
            hideEl(top);
        });
    }

    // ---------- name / logo / tagline ----------
    function brandTitle(lv) {
        var mark = id + '|' + version;
        var bt = lv.querySelector('.brand-title');
        if (bt && bt.getAttribute('data-wl') !== mark) {
            bt.setAttribute('data-wl', mark);
            bt.textContent = '';
            if (C.logo) { var img = document.createElement('img'); img.setAttribute('src', C.logo); img.setAttribute('alt', C.name); bt.appendChild(img); }
            var n = document.createElement('span'); n.className = 'wl-name'; n.textContent = C.name; bt.appendChild(n);
        }
        var sub = lv.querySelector('.subtitle');
        if (sub && sub.textContent !== C.tagline) sub.textContent = C.tagline;
    }

    var busy = false, queued = false;
    function apply() {
        if (busy || !booted) return;
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

    // ---------- home-screen app: start at his branded link ----------
    var manVer = -1, manUrl = null;
    function brandManifest() {
        if (manVer === version) return;
        manVer = version;
        try {
            var link = document.querySelector('link[rel="manifest"]');
            var here = location.origin + location.pathname.replace(/[^/]*$/, '');
            var orig = (link && link.getAttribute('data-wl-orig')) || (link && link.href) || (here + 'manifest.json');
            if (link && !link.getAttribute('data-wl-orig')) link.setAttribute('data-wl-orig', orig);
            var go = function (m) {
                var start = here + 'app.html?brand=' + id;
                m = m && typeof m === 'object' ? m : {};
                var out = {};
                Object.keys(m).forEach(function (k) { out[k] = m[k]; });
                out.name = C.name; out.short_name = C.name.slice(0, 12);
                out.start_url = start; out.id = start; out.scope = here;
                out.display = out.display || 'standalone';
                out.background_color = C.color2; out.theme_color = C.color2;
                if (Array.isArray(out.icons)) out.icons = out.icons.map(function (ic) {          // a blob manifest cannot use relative paths
                    var c2 = {}; Object.keys(ic).forEach(function (k) { c2[k] = ic[k]; });
                    try { c2.src = new URL(ic.src, orig).href; } catch (e) { /* ignore */ }
                    return c2;
                });
                if (/^https:\/\//i.test(C.logo)) out.icons = [{ src: C.logo, sizes: '512x512', type: 'image/png', purpose: 'any' }];
                var blob = new Blob([JSON.stringify(out)], { type: 'application/manifest+json' });
                if (manUrl) { try { URL.revokeObjectURL(manUrl); } catch (e) { /* ignore */ } }
                manUrl = URL.createObjectURL(blob);
                var l = document.querySelector('link[rel="manifest"]');
                if (!l) { l = document.createElement('link'); l.setAttribute('rel', 'manifest'); document.head.appendChild(l); }
                l.setAttribute('href', manUrl);
            };
            window.fetch(orig).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(go);
        } catch (e) { /* ignore */ }
    }

    function boot() {
        if (booted) return;
        booted = true;
        root.classList.add('wl-on');
        buildCss(); setMeta(); brandManifest();
        new MutationObserver(schedule).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        if (document.readyState !== 'loading') apply();
        document.addEventListener('DOMContentLoaded', function () { setMeta(); apply(); });
        window.addEventListener('load', function () { apply(); setTimeout(apply, 800); setTimeout(apply, 2500); });
    }
    function refresh(cfg) {                      // newer details arrived from Firebase
        C = full(cfg); version++;
        if (!booted) return;
        buildCss(); setMeta(); brandManifest(); apply();
    }

    // ---------- details from Firebase (public read of brands/<id>) ----------
    function fetchCfg(cb, wait) {                // cb(ok, data)
        if (!window.fetch) { cb(false, null); return; }
        var done = false;
        var t = setTimeout(function () { if (!done) { done = true; cb(false, null); } }, wait || 4000);
        window.fetch(DB + '/brands/' + encodeURIComponent(id) + '.json')
            .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
            .then(function (j) { if (!done) { done = true; clearTimeout(t); cb(true, (j && typeof j === 'object') ? j : null); } })
            .catch(function () { if (!done) { done = true; clearTimeout(t); cb(false, null); } });
    }
    function remember(cfg) { lsSet('wd-brand-cfg-' + id, JSON.stringify(cfg)); lsSet(KEY, id); }

    if (C) {
        if (param) lsSet(KEY, id);                // remember this phone straight away (also works with no signal)
        boot();                                   // known on this phone: brand instantly, then quietly check for updates
        fetchCfg(function (ok, data) {
            if (data) { remember(data); refresh(data); }
            else if (ok && !CLIENTS[id]) {        // the customer was removed in Super Admin: go back to the normal screen
                lsDel(KEY); lsDel('wd-brand-cfg-' + id);
                if (booted) location.replace(location.pathname);
            }
        });
    } else {
        // first time with this link: hide the login card for a moment so Wise Decision never flashes up
        var pend = document.createElement('style');
        pend.textContent = 'html.wl-pending #login-view .auth-card{visibility:hidden !important;}';
        (document.head || root).appendChild(pend);
        root.classList.add('wl-pending');
        fetchCfg(function (ok, data) {
            root.classList.remove('wl-pending');
            if (data) { remember(data); C = full(data); boot(); apply(); }
            else lsDel(KEY);                      // unknown link: stay completely normal
        }, 9000);                                 // first visit: allow a slow connection time to fetch the picture
    }
})();
