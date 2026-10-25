// ==================== WISE DECISION BANNER FIX (v4) ====================
// Load AFTER payments-patch.js. Replaces wdpEnsureBanner so the subscription reminder banner shows on every
// dashboard type, including the mobile layout.
//
// v3: * No longer depends on #dashboard-main-wrapper being visible (the mobile layout can hide/move it).
//       "In the app" now means: the login, register and Super Admin screens are all hidden.
//     * Banner goes at the top of the visible content area; if none is found it is a fixed bar at the BOTTOM
//       of the screen (so it never fights the mobile top bar).
//     * Each database read is separate; if "due soon days" cannot be read, 7 is used.
//     * ?wdbanner=1 shows an on-screen report (phone has no console).
console.log("Wise Decision banner-fix-patch.js — v4 loaded");

var wdbDebugShown = {};
var wdbDebug = /[?&]wdbanner=1/.test(location.search);
if (wdbDebug) window.addEventListener('load', function () { alert('banner-fix-patch.js v4 is loaded'); });

function wdbVisible(el) { return !!(el && el.getClientRects().length > 0); }

function wdbInApp() {
    var ids = ['login-view', 'register-view', 'super-admin-view'];
    for (var i = 0; i < ids.length; i++) if (wdbVisible(document.getElementById(ids[i]))) return false;
    return true;
}

// Where does the banner go? Top of the visible content area, else a fixed bar at the bottom.
function wdbFindHost() {
    var ws = document.getElementById('workspace-content');
    if (wdbVisible(ws)) return { el: ws, how: 'workspace' };
    var alt = document.querySelector('.main-content-area');
    if (wdbVisible(alt)) return { el: alt, how: 'main-content-area' };
    return { el: document.body, how: 'fixed-bottom' };
}

function wdbReport(sid, host) {
    if (!wdbDebug || wdbDebugShown[sid]) return;
    wdbDebugShown[sid] = true;
    var b = wdpBanner || {};
    var s = wdpSubState(b.billing, wdpToday(), b.soon);
    alert('Banner check (v3)\n' +
        'role: ' + currentUserRole + '\nstore: ' + sid +
        '\ndueDate: ' + (b.billing ? b.billing.dueDate : 'not loaded') +
        '\ndue-soon days: ' + b.soon +
        '\nstate: ' + s.state + (s.days !== undefined ? ' (' + s.days + ' days)' : '') +
        '\nin app: ' + wdbInApp() +
        '\nwrapper shown: ' + wdbVisible(document.getElementById('dashboard-main-wrapper')) +
        '\nworkspace shown: ' + wdbVisible(document.getElementById('workspace-content')) +
        '\nbanner goes in: ' + host.how +
        '\ndueDate read error: ' + (b.error || 'none') +
        '\ndue-soon read error: ' + (b.soonErr || 'none'));
}

window.wdpEnsureBanner = async function () {
    const old = document.getElementById('wdp-banner');
    const role = String(currentUserRole || '').toLowerCase();
    const isAdmin = role === 'admin' && currentStoreId && currentStoreId !== 'SUPER_ADMIN';
    const inApp = wdbInApp();

    if (!isAdmin || wdpBannerDismissed || !inApp) {
        if (old) old.remove();
        // debug: logged in to a store but not counted as Admin -> say why, once
        if (wdbDebug && inApp && currentStoreId && currentStoreId !== 'SUPER_ADMIN' && !wdbDebugShown['guard:' + currentStoreId]) {
            wdbDebugShown['guard:' + currentStoreId] = true;
            alert('Banner stopped early (v3)\nrole: ' + currentUserRole + '\nstore: ' + currentStoreId + '\nadmin: ' + !!isAdmin + '\ndismissed: ' + wdpBannerDismissed);
        }
        return;
    }

    if (wdpBanner.id !== currentStoreId || Date.now() - wdpBanner.at > 2 * 60 * 1000) {
        if (wdpBanner.loading) return;
        wdpBanner.loading = true;
        const sid = currentStoreId;
        const db = firebase.database();
        const get = function (path) {
            return wdpTimeout(db.ref(path).once('value'), 10000).then(
                function (snap) { return { ok: true, val: snap.val() }; },
                function (e) { return { ok: false, err: String((e && (e.code || e.message)) || 'error') }; });
        };
        const r = await Promise.all([
            get('billing/' + sid + '/dueDate'),
            get('billing/' + sid + '/trial'),
            get('billingSettings/dueSoonDays')
        ]);
        if (sid !== currentStoreId) { wdpBanner.loading = false; return; }

        const soon = (r[2].ok && r[2].val != null) ? wdpNum(r[2].val) : 7;
        if (!r[0].ok) {
            console.warn('Banner: cannot read billing/' + sid + '/dueDate —', r[0].err);
            wdpBanner = { id: sid, at: Date.now(), loading: false, billing: null, soon: soon, error: r[0].err, soonErr: r[2].ok ? null : r[2].err };
        } else {
            if (!r[2].ok) console.warn('Banner: cannot read billingSettings/dueSoonDays (using 7) —', r[2].err);
            wdpBanner = { id: sid, at: Date.now(), loading: false, billing: { dueDate: r[0].val, trial: !!(r[1].ok && r[1].val) }, soon: soon, error: null, soonErr: r[2].ok ? null : r[2].err };
        }
        wdbReport(sid, wdbFindHost());
    }
    if (wdpBanner.id !== currentStoreId || !wdpBanner.billing) { if (old) old.remove(); return; }

    const s = wdpSubState(wdpBanner.billing, wdpToday(), wdpBanner.soon);
    if (s.state !== 'overdue' && s.state !== 'due-soon') { if (old) old.remove(); return; }

    let text, bg, bd, col;
    if (s.state === 'overdue') {
        text = s.trial ? 'Your free trial ended ' + s.overdueBy + ' day' + (s.overdueBy === 1 ? '' : 's') + ' ago.' : 'Your subscription is overdue by ' + s.overdueBy + ' day' + (s.overdueBy === 1 ? '' : 's') + '.';
        bg = '#fef2f2'; bd = '#fecaca'; col = '#991b1b';
    } else {
        text = (s.trial ? 'Your free trial ends ' : 'Your subscription is due ') + (s.days === 0 ? 'today' : 'in ' + s.days + ' day' + (s.days === 1 ? '' : 's')) + ' (' + wdpPretty(wdpBanner.billing.dueDate) + ').';
        bg = '#fffbeb'; bd = '#fde68a'; col = '#92400e';
    }

    const newHtml = '<span>⏰ ' + wdpEsc(text) + '</span><span style="display:flex; gap:6px;"><button onclick="wdpOpenRenew(currentStoreId)" style="padding:6px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:none; background:#0284c7; color:#fff;">💳 Renew now</button>' +
        '<button onclick="wdpBannerDismissed=true; this.closest(\'#wdp-banner\').remove();" style="padding:6px 10px; font-size:12px; border-radius:6px; cursor:pointer; border:1px solid ' + bd + '; background:#fff; color:' + col + ';">✕</button></span>';

    const host = wdbFindHost();
    const inline = host.how !== 'fixed-bottom';

    let el = old;
    if (!el) { el = document.createElement('div'); el.id = 'wdp-banner'; }
    if (el.parentElement !== host.el || (inline && host.el.firstChild !== el)) {
        if (inline) host.el.insertBefore(el, host.el.firstChild); else host.el.appendChild(el);
    }

    const base = 'display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; background:' + bg + '; border:1px solid ' + bd + '; color:' + col + '; padding:10px 14px; border-radius:10px; font-size:13px; font-weight:bold;';
    const newStyle = base + (inline
        ? 'margin-bottom:14px;'
        : 'position:fixed; left:10px; right:10px; bottom:calc(env(safe-area-inset-bottom, 0px) + 16px); z-index:1200; box-shadow:0 6px 20px rgba(15,23,42,0.22);');

    if (el.dataset.sig !== text + '|' + bg + '|' + host.how) {
        el.dataset.sig = text + '|' + bg + '|' + host.how;
        el.style.cssText = newStyle;
        el.innerHTML = newHtml;
    } else if (el.style.cssText !== newStyle) {
        el.style.cssText = newStyle;
    }
};

// ---------- v4 probe (only with ?wdbanner=1) ----------
// 8 seconds after you are inside a store it runs the banner itself, then reports what it finds:
// is our function still the active one, did it crash, does the banner exist, and is something hiding it.
var wdbOurFn = window.wdpEnsureBanner;
if (wdbDebug) {
    var wdbProbeDone = false, wdbSince = 0;
    setInterval(async function () {
        if (wdbProbeDone) return;
        if (!currentStoreId || currentStoreId === 'SUPER_ADMIN' || !wdbInApp()) { wdbSince = 0; return; }
        if (!wdbSince) wdbSince = Date.now();
        if (Date.now() - wdbSince < 8000) return;
        wdbProbeDone = true;

        var err = 'none';
        try { await wdbOurFn(); } catch (e) { err = String((e && e.message) || e); }

        var el = document.getElementById('wdp-banner');
        var info = 'no banner element in the page';
        if (el) {
            var cs = getComputedStyle(el), r = el.getBoundingClientRect();
            info = 'banner element EXISTS' +
                '\nparent: ' + (el.parentElement ? (el.parentElement.id || el.parentElement.className || el.parentElement.tagName) : 'none') +
                '\nshown on screen: ' + (el.getClientRects().length > 0) +
                '\ndisplay: ' + cs.display + ' / visibility: ' + cs.visibility + ' / opacity: ' + cs.opacity +
                '\nsize: ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' at top ' + Math.round(r.top);
        }
        var b = wdpBanner || {};
        var s = wdpSubState(b.billing, wdpToday(), b.soon);
        var same = (window.wdpEnsureBanner === wdbOurFn);
        alert('Banner probe (v4)' +
            '\nour function still active: ' + same +
            (same ? '' : '\nREPLACED BY: ' + String(window.wdpEnsureBanner).replace(/\s+/g, ' ').slice(0, 70)) +
            '\nwdpAttach: ' + (typeof wdpAttach) +
            '\nrun error: ' + err +
            '\nrole: ' + currentUserRole + ' / store: ' + currentStoreId +
            '\ndueDate: ' + (b.billing ? b.billing.dueDate : 'not loaded') + ' / soon: ' + b.soon +
            '\nstate: ' + s.state + (s.days !== undefined ? ' (' + s.days + 'd)' : '') +
            '\nread errors: ' + (b.error || 'none') + ' / ' + (b.soonErr || 'none') +
            '\n' + info);
    }, 2000);
}
