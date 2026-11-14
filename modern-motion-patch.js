// ==================== WISE DECISION MODERN MOTION (v1) ====================
// Load LAST (after pharmacy-modern-patch.js). Works for hardware stores (body.wmx) and pharmacy
// stores (body.wmp) only. Every other store type is untouched.
//
//   1. Loading placeholders: "Loading..." rows become soft shimmering bars.
//   2. Screens fade and slide in (about 0.2 seconds) when you open them.
//   3. Sales / month / owed numbers count up; a small dot pulses beside Low stock.
//   4. Messages that used to pop up as grey browser alerts appear as a small bar at the bottom.
//      (confirm and prompt questions are NOT changed.)
//   5. Buttons shrink slightly when tapped.
//
// Light on purpose: no libraries, only CSS animations + a few lines of JavaScript.
// Everything switches off for people whose phone is set to "Reduce motion".
// Nothing is written to Firebase and no data is changed.

console.log("Wise Decision modern-motion-patch.js — v1 loaded");

(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function modern() { return !!document.body && (document.body.classList.contains('wmx') || document.body.classList.contains('wmp')); }
    var reduce = false;
    try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }

    // ---------- CSS ----------
    function addCss() {
        if ($('wm-css')) return;
        var P = 'body.wmx,body.wmp';
        var both = function (r) { return 'body.wmx ' + r + ',body.wmp ' + r; };
        var css =
        // placeholders
        '.wm-sk{height:14px;border-radius:8px;margin:10px 0;background:linear-gradient(90deg,var(--wx-line,#e5e7eb) 25%,var(--wx-bg,#f5f5f5) 50%,var(--wx-line,#e5e7eb) 75%);background-size:200% 100%;animation:wm-sh 1.2s linear infinite;}' +
        '.wm-skc{height:60px;border-radius:16px;margin:0 0 8px;background:linear-gradient(90deg,var(--wx-line,#e5e7eb) 25%,var(--wx-bg,#f5f5f5) 50%,var(--wx-line,#e5e7eb) 75%);background-size:200% 100%;animation:wm-sh 1.2s linear infinite;}' +
        '@keyframes wm-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}' +

        // screen enter
        '@keyframes wm-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
        both('#workspace-content.wm-enter > *') + '{animation:wm-in .22s ease-out both;}' +
        both('#workspace-content.wm-enter > .wmx-wrap') + ',' + both('#workspace-content.wm-enter > .wmp-wrap') + '{animation:none;}' +
        both('#workspace-content.wm-enter > .wmx-wrap > *') + ',' + both('#workspace-content.wm-enter > .wmp-wrap > *') + '{animation:wm-in .3s ease-out both;}' +
        both('#workspace-content.wm-enter > :nth-child(2)') + ',' + both('#workspace-content.wm-enter > .wmx-wrap > :nth-child(2)') + '{animation-delay:.05s;}' +
        both('#workspace-content.wm-enter > :nth-child(3)') + ',' + both('#workspace-content.wm-enter > .wmx-wrap > :nth-child(3)') + '{animation-delay:.1s;}' +
        both('#workspace-content.wm-enter > :nth-child(4)') + ',' + both('#workspace-content.wm-enter > .wmx-wrap > :nth-child(4)') + '{animation-delay:.15s;}' +
        both('#workspace-content.wm-enter > :nth-child(n+5)') + ',' + both('#workspace-content.wm-enter > .wmx-wrap > :nth-child(n+5)') + '{animation-delay:.2s;}' +

        // low stock dot
        '@keyframes wm-pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.55)}70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}' +
        '.wm-pulse::after{content:"";display:inline-block;width:9px;height:9px;margin-left:8px;border-radius:50%;background:#ef4444;vertical-align:middle;animation:wm-pulse 1.6s ease-out infinite;}' +

        // button press
        both('#workspace-content button') + ',' + both('[id$="-modal"] button') + '{transition:transform .08s ease;}' +
        both('#workspace-content button:active') + ',' + both('[id$="-modal"] button:active') + '{transform:scale(.97) !important;}' +

        // toasts
        '#wm-toasts{position:fixed;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 18px);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:3000;pointer-events:none;padding:0 12px;}' +
        '@keyframes wm-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}' +
        '.wm-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:10px;max-width:min(92vw,420px);background:var(--wx-ink,#14161a);color:#fff;border-radius:16px;padding:12px 16px;font-size:14px;font-weight:700;line-height:1.35;white-space:pre-line;box-shadow:0 14px 34px rgba(10,12,16,.35);animation:wm-up .26s ease-out both;transition:opacity .25s,transform .25s;}' +
        '.wm-toast.wm-out{opacity:0;transform:translateY(10px);}' +
        '.wm-ti{flex-shrink:0;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;background:#22c55e;color:#fff;}' +
        '.wm-toast.warn .wm-ti{background:#f59e0b;}' +
        '.wm-toast.bad .wm-ti{background:#ef4444;}' +

        // reduce motion
        '@media (prefers-reduced-motion:reduce){.wm-sk,.wm-skc,.wm-pulse::after,.wm-toast{animation:none !important;}' +
            both('#workspace-content.wm-enter > *') + ',' + both('#workspace-content.wm-enter > .wmx-wrap > *') + ',' + both('#workspace-content.wm-enter > .wmp-wrap > *') + '{animation:none !important;}}';
        var st = document.createElement('style');
        st.id = 'wm-css';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // ---------- 4. toasts instead of grey alerts ----------
    var BAD = /could not|couldn't|failed|error|denied|blocked|invalid/i;
    var WARN = /cannot|can't|only the|must|enter |select |tick |more than|already|not enough|no products|nothing/i;
    function toast(msg) {
        var text = String(msg == null ? '' : msg).replace(/^\s*(✅|✔️|✓|⚠️|❌)\s*/, '').trim();
        if (!text) return;
        addCss();
        var box = $('wm-toasts');
        if (!box) { box = document.createElement('div'); box.id = 'wm-toasts'; document.body.appendChild(box); }
        while (box.children.length >= 3) box.removeChild(box.firstChild);
        var kind = BAD.test(text) ? 'bad' : (WARN.test(text) ? 'warn' : '');
        var t = document.createElement('div');
        t.className = 'wm-toast' + (kind ? ' ' + kind : '');
        t.innerHTML = '<span class="wm-ti">' + (kind === 'bad' ? '×' : (kind === 'warn' ? '!' : '✓')) + '</span><span></span>';
        t.lastChild.textContent = text;
        var gone = false;
        function close() { if (gone) return; gone = true; t.classList.add('wm-out'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260); }
        t.addEventListener('click', close);
        box.appendChild(t);
        setTimeout(close, Math.min(8000, 2400 + text.length * 35 + (kind === 'bad' ? 1500 : 0)));
    }
    var origAlert = window.alert;
    window.alert = function (msg) {
        if (modern()) { toast(msg); return; }
        return origAlert.apply(window, arguments);
    };

    // ---------- 3. count-up numbers ----------
    var COUNT = ['wmx-today', 'wmx-month', 'wmx-owed', 'wmx-low', 'dash-today-sales'];
    function parse(t) {
        var m = /^(\D*?)([\d,]*\.?\d+)(.*)$/.exec(String(t == null ? '' : t).trim());
        if (!m) return null;
        var raw = m[2];
        return { pre: m[1], val: parseFloat(raw.replace(/,/g, '')), dec: (raw.split('.')[1] || '').length, suf: m[3] };
    }
    function fmt(v, dec) { return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
    function run(el) {
        var text = el.textContent;
        var p = parse(text);
        if (el._wmRaf) { cancelAnimationFrame(el._wmRaf); el._wmRaf = 0; }
        if (!p) { el._wmLast = text; return; }
        if (el.id === 'wmx-low') el.classList.toggle('wm-pulse', p.val > 0);
        var from = (el._wmPrev == null) ? 0 : el._wmPrev, to = p.val;
        if (reduce || from === to || !isFinite(from) || !isFinite(to)) { el._wmPrev = to; el._wmLast = text; return; }
        var start = null, dur = 700;
        function step(now) {
            if (start === null) start = now;
            var k = Math.min(1, (now - start) / dur);
            var v = from + (to - from) * (1 - Math.pow(1 - k, 3));
            var s = p.pre + fmt(v, p.dec) + p.suf;
            if (k < 1) { el._wmLast = s; el.textContent = s; el._wmRaf = requestAnimationFrame(step); }
            else { el._wmLast = text; el.textContent = text; el._wmPrev = to; el._wmRaf = 0; }
        }
        el._wmRaf = requestAnimationFrame(step);
    }
    function watch(el) {
        if (el._wmW) return;
        el._wmW = true;
        el._wmLast = el.textContent;
        var p0 = parse(el.textContent);
        el._wmPrev = p0 ? p0.val : null;
        new MutationObserver(function () {
            if (el.textContent === el._wmLast) return;
            if (!modern()) { el._wmLast = el.textContent; return; }
            run(el);
        }).observe(el, { childList: true, characterData: true, subtree: true });
    }

    // ---------- 1. loading placeholders ----------
    var LOADING = /^\s*(loading|checking|fetching)/i;
    function skeletons() {
        if (!modern()) return;
        addCss();
        document.querySelectorAll('#workspace-content tbody > tr:only-child > td[colspan]').forEach(function (td) {
            if (td.getAttribute('data-wm-sk') || !LOADING.test(td.textContent)) return;
            td.setAttribute('data-wm-sk', '1');
            td.innerHTML = '<div class="wm-sk" style="width:82%"></div><div class="wm-sk" style="width:60%"></div><div class="wm-sk" style="width:72%"></div>';
        });
        document.querySelectorAll('.wmx-empty,.wmp-empty').forEach(function (d) {
            if (d.getAttribute('data-wm-sk') || !LOADING.test(d.textContent)) return;
            d.setAttribute('data-wm-sk', '1');
            d.style.padding = '0';
            d.innerHTML = '<div class="wm-skc"></div><div class="wm-skc"></div><div class="wm-skc"></div>';
        });
    }

    // ---------- 2. screen enter ----------
    var lastEnter = 0, wsWatched = null;
    function ours(n) { return n.nodeType === 1 && /^wm[px]-/.test(n.id || ''); }
    function watchWorkspace() {
        var ws = $('workspace-content');
        if (!ws || wsWatched === ws) return;
        wsWatched = ws;
        new MutationObserver(function (list) {
            if (!modern() || reduce) return;
            var real = false;
            list.forEach(function (m) {
                Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1 && !ours(n)) real = true; });
            });
            if (!real) return;
            var now = Date.now();
            if (now - lastEnter < 400) return;
            lastEnter = now;
            ws.classList.remove('wm-enter');
            void ws.offsetWidth;
            ws.classList.add('wm-enter');
            setTimeout(function () { ws.classList.remove('wm-enter'); }, 700);
        }).observe(ws, { childList: true });
    }

    // ---------- keep it applied ----------
    function scan() {
        try {
            watchWorkspace();
            skeletons();
            COUNT.forEach(function (id) { var el = $(id); if (el) watch(el); });
        } catch (e) { console.warn('[modern-motion]', e); }
    }
    var pending = false;
    function schedule() { if (pending) return; pending = true; setTimeout(function () { pending = false; scan(); }, 120); }

    function start() {
        scan();
        if (document.body) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
        setInterval(scan, 4000);
    }
    if (document.readyState === 'complete') setTimeout(start, 1500);
    else window.addEventListener('load', function () { setTimeout(start, 1500); });
})();
