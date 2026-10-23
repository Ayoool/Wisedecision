// ==================== WISE DECISION MOBILE LAYOUT PATCH (v2) ====================
// Phones and small tablets only (screen width 820px or less). Desktop layouts are NOT changed.
// NEW in v2: Added a loading spinner overlay for menu navigation.

console.log("Wise Decision mobile-patch.js v2 loaded");

(function () {
    var MAX = 820;

    var css = [
        '#wd-mobile-bar, #wd-drawer-backdrop, #wd-loading-overlay { display: none; }',
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

        /* Loading Spinner Overlay */
        '  #wd-loading-overlay { display: flex; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); z-index: 9999; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: opacity 0.15s ease; }',
        '  #wd-loading-overlay.wd-active { opacity: 1; pointer-events: auto; }',
        '  .wd-spinner { width: 45px; height: 45px; border: 4px solid #e2e8f0; border-top: 4px solid #14b8a6; border-radius: 50%; animation: wd-spin 0.8s linear infinite; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }',
        '  @keyframes wd-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }',
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

    // --- Spinner Functions ---
    function showSpinner() {
        var loader = document.getElementById('wd-loading-overlay');
        if (loader && isMobile()) loader.classList.add('wd-active');
    }
    function hideSpinner() {
        var loader = document.getElementById('wd-loading-overlay');
        if (loader) loader.classList.remove('wd-active');
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
        // Inject spinner if it doesn't exist
        if (!document.getElementById('wd-loading-overlay')) {
            var loader = document.createElement('div');
            loader.id = 'wd-loading-overlay';
            loader.innerHTML = '<div class="wd-spinner"></div>';
            document.body.appendChild(loader);
        }
        sync();
    }

    // Intercept menu clicks for drawer close + spinner
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('.sidebar .menu-btn') : null;
        if (b && isMobile()) {
            showSpinner();
            setTimeout(closeDrawer, 60);
            // Hide spinner shortly after the DOM swaps views
            setTimeout(hideSpinner, 450); 
        }
    });
    
    window.addEventListener('resize', function () { if (!isMobile()) closeDrawer(); });

    function start() { try { ensure(); } catch (e) { console.warn(e); } }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    window.addEventListener('load', start);
    setInterval(start, 1500);   
})();
