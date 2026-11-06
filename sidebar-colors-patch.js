// ==================== WISE DECISION SIDEBAR COLORS PATCH (v1) ====================
// Gives the grey sidebar buttons a colour, on every store type:
//   * Customer Orders  -> rose
//   * Subscription     -> lime green
// Style only. It does not add, remove or move any button.
// Load anywhere after payments-patch.js (which creates the Subscription button).
// To colour another grey button later, add one line to WDC_RULES and one CSS rule below.

console.log("Wise Decision sidebar-colors-patch.js — v1 loaded");

(function () {
    // text to look for (lower case)  ->  colour key
    var WDC_RULES = [
        ['customer orders', 'orders'],
        ['subscription', 'sub']
    ];

    function addCss() {
        if (document.getElementById('wdc-css')) return;
        var S = 'html body #dashboard-main-wrapper .sidebar .menu-btn';
        var base = 'border-width:1px !important;border-style:solid !important;border-left-width:4px !important;font-weight:700 !important;';
        var st = document.createElement('style');
        st.id = 'wdc-css';
        st.textContent =
            S + '[data-wdc="orders"]{' + base + 'background:#fff1f2 !important;color:#be123c !important;border-color:#fecdd3 !important;border-left-color:#f43f5e !important;}' +
            S + '[data-wdc="sub"]{' + base + 'background:#f7fee7 !important;color:#4d7c0f !important;border-color:#d9f99d !important;border-left-color:#84cc16 !important;}' +
            S + '[data-wdc="sub"]:hover{background:#ecfccb !important;color:#3f6212 !important;}';
        document.head.appendChild(st);
    }

    function tag() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        if (!side) return;
        addCss();
        side.querySelectorAll('button').forEach(function (b) {
            if (b.getAttribute('data-wdc')) return;
            var t = (b.textContent || '').trim().toLowerCase();
            for (var i = 0; i < WDC_RULES.length; i++) {
                if (t.indexOf(WDC_RULES[i][0]) !== -1) { b.setAttribute('data-wdc', WDC_RULES[i][1]); return; }
            }
        });
    }

    function tick() { try { tag(); } catch (e) { console.warn('[sidebar-colors]', e); } }
    window.addEventListener('load', function () { setTimeout(tick, 800); });
    var busy = false;
    var obs = new MutationObserver(function () {
        if (busy) return; busy = true;
        setTimeout(function () { busy = false; tick(); }, 150);
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function () { obs.observe(document.body, { childList: true, subtree: true }); });
    setInterval(tick, 3000);
})();
