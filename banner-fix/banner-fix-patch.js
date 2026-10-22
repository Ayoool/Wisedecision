// ==================== WISE DECISION BANNER FIX (v1) ====================
// Load AFTER payments-patch.js (v4.18). Replaces wdpEnsureBanner so the subscription reminder banner
// shows on every dashboard type (inline in the workspace, or as a fixed bar when the workspace is hidden).
console.log("Wise Decision banner-fix-patch.js — v1 loaded");

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
        try {
            const db = firebase.database();
            const r = await Promise.all([
                wdpTimeout(db.ref('billing/' + sid + '/dueDate').once('value'), 10000),
                wdpTimeout(db.ref('billing/' + sid + '/trial').once('value'), 10000),
                wdpTimeout(db.ref('billingSettings/dueSoonDays').once('value'), 10000)
            ]);
            wdpBanner = { id: sid, at: Date.now(), loading: false, billing: { dueDate: r[0].val(), trial: !!r[1].val() }, soon: r[2].val() == null ? 7 : wdpNum(r[2].val()) };
        } catch (e) { wdpBanner.loading = false; wdpBanner.at = Date.now() - 100 * 1000; return; }
    }
    if (wdpBanner.id !== currentStoreId) return;

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
