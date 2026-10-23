// ==================== WISE DECISION MOBILE LAYOUT PATCH (v1) ====================
// Phones and small tablets only (screen width 820px or less). Desktop and laptop layouts are NOT changed.
//
//   * Top bar with a ☰ button and the store name; the long sidebar becomes a slide-in menu.
//   * More room for the page: tighter padding, smaller headings, POS columns stacked.
//   * Tables: smaller text and padding so more fits; they still scroll sideways.
//   * Inputs at 16px so iPhone Safari does not zoom in when you tap a field.
//   * Faster taps (no double-tap delay).
// To undo: remove the <script src="mobile-patch.js"> line from app.html.

console.log("Wise Decision mobile-patch.js v1 loaded");

(function () {
    var MAX = 820;

    var css = [
        '#wd-mobile-bar, #wd-drawer-backdrop { display: none; }',
        '@media (max-width: ' + MAX + 'px) {',
        '  html, body { overflow-x: hidden; -webkit-text-size-adjust: 100%; }',
        '  button, .menu-btn, a { -webkit-tap-highlight-color: transparent; touch-action: manipulation; }',
        '  input, select, textarea { font-size: 16px !important; }',

        /* top bar */
        '  #wd-mobile-bar { display: flex; position: fixed; top: 0; left: 0; right: 0; z-index: 900; align-items: center; gap: 12px;',
        '    padding: calc(env(safe-area-inset-top, 0px) + 8px) 14px 8px; background: linear-gradient(135deg, #14b8a6 0%, #0284c7 100%); color: #fff; box-shadow: 0 2px 10px rgba(15,23,42,0.25); box-sizing: border-box; }',
        '  #wd-mobile-bar button { width: 42px; height: 42px; flex: 0 0 42px; border-radius: 10px; border: none; background: rgba(255,255,255,0.22); color: #fff; font-size: 22px; line-height: 1; cursor: pointer; padding: 0; margin: 0; }',
        '  .wd-mb-title { min-width: 0; }',
        '  #wd-mb-name { font-weight: 800; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
        '  #wd-mb-role { font-size: 11px; opacity: 0.92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',

        /* sidebar becomes a drawer */
        '  #dashboard-main-wrapper .dashboard-layout { display: block !important; }',
        '  .sidebar { position: fixed !important; top: 0 !important; bottom: 0 !important; left: 0 !important; width: 84% !important; max-width: 320px !important; height: auto !important; max-height: none !important;',
        '    margin: 0 !important; padding: calc(env(safe-area-inset-top, 0px) + 14px) 12px 28px !important; overflow-y: auto !important; -webkit-overflow-scrolling: touch;',
        '    transform: translateX(-105%); transition: transform 0.25s ease; z-index: 950 !important; box-sizing: border-box !important; }',
        '  .sidebar.wd-open { transform: none; box-shadow: 6px 0 30px rgba(0,0,0,0.35); }',
        '  .sidebar .menu-btn { padding: 12px 14px !important; font-size: 14px !important; margin-bottom: 6px !important; min-height: 44px; }',
        '  #wd-drawer-backdrop { display: block; position: fixed; inset: 0; background: rgba(15,23,42,0.5); z-index: 940; opacity: 0; pointer-events: none; transition: opacity 0.2s; }',
        '  #wd-drawer-backdrop.wd-show { opacity: 1; pointer-events: auto; }',
        '  body.wd-no-scroll { overflow: hidden; }',

        /* page area */
        '  #workspace-content, .main-content-area { width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important;',
        '    padding: calc(env(safe-area-inset-top, 0px) + 68px) 12px 28px !important; }',
        '  .main-content-area h2 { font-size: 20px !important; }',
        '  .main-content-area h3 { font-size: 15px !important; }',
        '  .pos-grid { grid-template-columns: 1fr !important; }',

        /* tables */
        '  .main-content-area table { font-size: 12px !important; }',
        '  .main-content-area th, .main-content-area td { padding: 8px 6px !important; }',
        '  .main-content-area th { white-space: nowrap; }',

        /* login, super admin, modals */
        '  .auth-card { width: 92% !important; max-width: 420px !important; box-sizing: border-box !important; }',
        '  #super-admin-view > div { padding: 14px !important; }',
        '  [id$="-modal"] { padding: 10px !important; }',
        '}'
    ].join('\n');

    var st = document.createElement('style');
    st.id = 'wd-mobile-css';
    st.textContent = css;
    document.head.appendChild(st);

    function isMobile() { return window.innerWidth <= MAX; }
    function sidebar() { return document.querySelector('#dashboard-main-wrapper .sidebar') || document.querySelector('.sidebar'); }

    function closeDrawer() {
        var sb = sidebar(); if (sb) sb.classList.remove('wd-open');
        var bd = document.getElementById('wd-drawer-backdrop'); if (bd) bd.classList.remove('wd-show');
        document.body.classList.remove('wd-no-scroll');
    }
    function openDrawer() {
        var sb = sidebar(); if (!sb) return;
        sb.classList.add('wd-open');
        var bd = document.getElementById('wd-drawer-backdrop'); if (bd) bd.classList.add('wd-show');
        document.body.classList.add('wd-no-scroll');
    }
    function toggleDrawer() {
        var sb = sidebar();
        if (sb && sb.classList.contains('wd-open')) closeDrawer(); else openDrawer();
    }

    function sync() {
        var n = document.getElementById('wd-mb-name'), r = document.getElementById('wd-mb-role');
        var t = document.getElementById('dashboard-store-title'), l = document.getElementById('user-role-label');
        if (n) n.textContent = ((t && t.textContent) || '').trim() || 'WISE DECISION';
        if (r) r.textContent = ((l && l.textContent) || '').trim();
    }

    function ensure() {
        var wrap = document.getElementById('dashboard-main-wrapper');
        if (!wrap) return;
        var bar = document.getElementById('wd-mobile-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'wd-mobile-bar';
            bar.innerHTML = '<button id="wd-mobile-menu" type="button" aria-label="Menu">☰</button><div class="wd-mb-title"><div id="wd-mb-name"></div><div id="wd-mb-role"></div></div>';
            wrap.insertBefore(bar, wrap.firstChild);
            bar.querySelector('#wd-mobile-menu').onclick = toggleDrawer;
        }
        if (!document.getElementById('wd-drawer-backdrop')) {
            var bd = document.createElement('div');
            bd.id = 'wd-drawer-backdrop';
            bd.onclick = closeDrawer;
            wrap.appendChild(bd);
        }
        sync();
    }

    // Close the menu after any menu button is tapped (the page switch itself is handled by the app).
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.sidebar .menu-btn') : null;
        if (b && isMobile()) setTimeout(closeDrawer, 60);
    });
    window.addEventListener('resize', function () { if (!isMobile()) closeDrawer(); });

    function start() { try { ensure(); } catch (e) { console.warn(e); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.addEventListener('load', start);
    setInterval(start, 1500);   // keeps the store name / role in the bar current after login or a sidebar rebuild
})();
