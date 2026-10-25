// ==================== WISE DECISION BANNER FIX (v2) ====================
// Load AFTER payments-patch.js. Replaces wdpEnsureBanner so the subscription reminder banner
// shows on every dashboard type (inline in the workspace, or as a fixed bar when the workspace is hidden).
//
// v2: * Each database read is separate. If "due soon days" cannot be read (blocked by the rules), the banner
//       uses 7 days instead of failing silently.
//     * Failures are logged and retried after a pause (no more silent retry every 2 seconds).
//     * Open the app with ?wdbanner=1 to get an on-screen report (phone has no console).
console.log("Wise Decision banner-fix-patch.js — v2 loaded");

var wdbDebugShown = {};

function wdbDebugReport(sid, extra) {
    if (!/[?&]wdbanner=1/.test(location.search) || wdbDebugShown[sid]) return;
    wdbDebugShown[sid] = true;
    var b = wdpBanner || {};
    var s = wdpSubState(b.billing, wdpToday(), b.soon);
    var wrap = document.getElementById('dashboard-main-wrapper');
    var ws = document.getElementById('workspace-content');
    alert('Banner check (v2)\n' +
        'role: ' + currentUserRole + '\nstore: ' + sid +
        '\ndueDate: ' + (b.billing ? b.billing.dueDate : 'not loaded') +
        '\ntrial: ' + (b.billing ? b.billing.trial : '-') +
        '\ndue-soon days: ' + b.soon +
        '\nstate: ' + s.state + (s.days !== undefined ? ' (' + s.days + ' days)' : '') +
        '\ndashboard shown: ' + wdpIsShown(wrap) + '\nworkspace shown: ' + wdpIsShown(ws) +
        '\ndueDate read error: ' + (b.error || 'none') +
        '\ndue-soon read error: ' + (b.soonErr || 'none') +
        (extra ? '\n' + extra : ''));
}

window.wdpEnsureBanner = async function () {
    const old = document.getElementById('wdp-banner');
    const isAdmin = currentUserRole === 'Admin' && currentStoreId && currentStoreId !== 'SUPER_ADMIN';
    const wrap = document.getElementById('dashboard-main-wrapper');
    const ws = document.getElementById('workspace-content');
    if (!isAdmin || wdpBannerDismissed || !wrap || !wdpIsShown(wrap)) { if (old) old.remove(); return; }

    if (wdpBanner.id !== currentStoreId || Date.now() - wdpBanner.at > 2 * 60 * 1000) {
        if (wdpBanner.loading) return;
        wdpBanner.loading = true;
        const sid = currentStoreId;
        const db = firebase.database();
        // Each read on its own: one blocked path must not stop the others.
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
        if (sid !== currentStoreId) { wdpBanner.loading = false; return; }   // store changed meanwhile

        const soon = (r[2].ok && r[2].val != null) ? wdpNum(r[2].val) : 7;
        if (!r[0].ok) {
            console.warn('Banner: cannot read billing/' + sid + '/dueDate —', r[0].err);
            // remember the failure for 2 minutes instead of retrying every 2 seconds
            wdpBanner = { id: sid, at: Date.now(), loading: false, billing: null, soon: soon, error: r[0].err, soonErr: r[2].ok ? null : r[2].err };
        } else {
            if (!r[2].ok) console.warn('Banner: cannot read billingSettings/dueSoonDays (using 7) —', r[2].err);
            wdpBanner = { id: sid, at: Date.now(), loading: false, billing: { dueDate: r[0].val, trial: !!(r[1].ok && r[1].val) }, soon: soon, error: null, soonErr: r[2].ok ? null : r[2].err };
        }
        wdbDebugReport(sid);
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

    const inline = !!(ws && wdpIsShown(ws));
    const parent = inline ? ws : document.body;
    const mode = inline ? 'inline' : 'fixed';

    let el = old;
    if (!el) { el = document.createElement('div'); el.id = 'wdp-banner'; }
    if (el.parentElement !== parent || (inline && parent.firstChild !== el)) {
        if (inline) parent.insertBefore(el, parent.firstChild); else parent.appendChild(el);
    }

    const base = 'display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; background:' + bg + '; border:1px solid ' + bd + '; color:' + col + '; padding:10px 14px; border-radius:10px; font-size:13px; font-weight:bold;';
    const newStyle = base + (inline ? 'margin-bottom:14px;' : 'position:fixed; top:8px; left:8px; right:8px; z-index:1200; box-shadow:0 6px 20px rgba(15,23,42,0.18);');

    if (el.dataset.sig !== text + '|' + bg + '|' + mode) {
        el.dataset.sig = text + '|' + bg + '|' + mode;
        el.style.cssText = newStyle;
        el.innerHTML = newHtml;
    } else if (el.style.cssText !== newStyle) {
        el.style.cssText = newStyle;
    }
};
