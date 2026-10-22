// ==================== WISE DECISION SUBSCRIPTION PAYMENTS PATCH (v4.19) ====================
// Load LAST, after storeplans-patch.js and every other patch (defer).
//
// v4.19 FIXES:
//   * wdpUpdateBadge: textContent and styles are only written when they actually change, so the
//     MutationObserver no longer loops (that loop was freezing the whole page and blocking the store list).
//   * wdpStartListener: no longer retries on PERMISSION_DENIED; wdpOpenPending shows the real reason
//     instead of showing "Loading..." forever.
//   * wdpAttachPendingButton: requires the visible "Logout / Exit" button (Super-Admin-only signal), so a
//     "Security" button on a store screen can no longer leak the listener onto a store session.
//   * wdpReject: uses a "claimed + revert" pattern like wdpApprove — a mid-flight failure can no longer
//     leave a request stuck as "rejected" with no reason.
//   * wdcInject: removes the plan-picker box when the plan count drops below 2 or the form is gone.
//   * wdpEsc also escapes single quotes; wdpFlatten stable-sorts missing createdAt; the 2-second
//     setInterval safety net is slowed to 10 seconds.
//
// STORE SIDE   * "💳 Subscription" button in the Admin's sidebar; "Renew or pay subscription" link on login
// SUPER ADMIN  * "💳 Pending payments" button (live count) in the toolbar; Approve/Reject each request
// Data: paymentRequests/{storeId}/{requestId}

console.log("Wise Decision payments-patch.js — v4.19 loaded");

var WDP_SUPPORT_WA = (typeof WDN_SUPPORT_WA !== 'undefined' && WDN_SUPPORT_WA) || '2349168140710';

var WDP_ALERT_URL = 'https://script.google.com/macros/s/AKfycbz5bacSu21DjL82yXSt5zr9KsD7CcjL44nIrWh0kpPRvSNIwp4dLfvMrkGNJhq4yNLt/exec';
function wdpNotifyEmail(rec) {
    if (!/^https:\/\/script\.google\.com\//.test(WDP_ALERT_URL)) return;
    try {
        fetch(WDP_ALERT_URL, {
            method: 'POST', mode: 'no-cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ kind: 'wd-payment', storeId: rec.storeId, storeName: rec.storeName, amount: rec.amount, months: rec.months, cycle: rec.cycle || 'monthly', method: rec.method, reference: rec.reference, note: rec.note })
        }).catch(function () {});
    } catch (e) { /* the alert must never get in the way of the payment itself */ }
}
var wdpAll = null;
var wdpListening = false;
var wdpListenerBlocked = false;   // v4.19: stop retrying once the listener hits PERMISSION_DENIED
var wdpCtx = null;
var wdpBusy = false;
var wdpBanner = { id: null, at: 0, loading: false, billing: null, soon: 7 };
var wdpBannerDismissed = false;

function wdpNum(n) { return Number(n) || 0; }
function wdpEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function wdpMoney(n) { return '₦' + (Math.round(wdpNum(n) * 100) / 100).toLocaleString(); }
function wdpPad(n) { return String(n).padStart(2, '0'); }
function wdpToday() { const d = new Date(); return d.getFullYear() + '-' + wdpPad(d.getMonth() + 1) + '-' + wdpPad(d.getDate()); }
function wdpIsDay(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function wdpParseDay(s) { const p = String(s).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function wdpDaysUntil(dueStr, todayStr) { return Math.round((wdpParseDay(dueStr) - wdpParseDay(todayStr)) / 86400000); }
function wdpPretty(s) {
    if (!s) return '—';
    const day = wdpIsDay(s);
    const d = day ? new Date(s + 'T00:00:00Z') : new Date(s);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, day ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
function wdpAgo(iso) {
    const t = Date.parse(iso);
    if (isNaN(t)) return '';
    const d = Math.floor((Date.now() - t) / 86400000);
    return d <= 0 ? 'today' : (d === 1 ? 'yesterday' : d + ' days ago');
}
function wdpTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
        const t = setTimeout(function () { reject(new Error('timeout')); }, ms);
        promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
}
function wdpWaNumber(phone) {
    let p = String(String(phone || '').split(/[,;/|]/)[0] || '').replace(/[^\d+]/g, '');
    if (!p) return '';
    if (p.charAt(0) === '+') p = p.slice(1);
    else if (p.indexOf('00') === 0) p = p.slice(2);
    else if (p.charAt(0) === '0') p = '234' + p.slice(1);
    else if (/^\d{10}$/.test(p)) p = '234' + p;
    return p;
}
function wdpSubState(billing, todayStr, soonDays) {
    if (!billing || !wdpIsDay(billing.dueDate)) return { state: 'none' };
    const days = wdpDaysUntil(billing.dueDate, todayStr);
    const trial = !!billing.trial;
    if (days < 0) return { state: 'overdue', days: days, overdueBy: -days, trial: trial };
    if (days <= wdpNum(soonDays)) return { state: 'due-soon', days: days, trial: trial };
    return { state: 'ok', days: days, trial: trial };
}
function wdpSuggestAmount(fee, months) { return Math.round(wdpNum(fee) * Math.max(1, parseInt(months) || 1) * 100) / 100; }
function wdpYearlyFee(plan) {
    if (!plan) return 0;
    const y = wdpNum(plan.yearlyFee);
    return y > 0 ? y : wdpNum(plan.monthlyFee) * 12;
}
function wdpCycleLabel(cycle) { return cycle === 'yearly' ? 'Yearly (12 months)' : 'Monthly'; }
function wdpAmountFor(plan, cycle, months) {
    if (!plan) return 0;
    if (cycle === 'yearly') return wdpYearlyFee(plan);
    return wdpNum(plan.monthlyFee) * Math.max(1, parseInt(months) || 1);
}

function wdpFlatten(all) {
    const out = [];
    Object.keys(all || {}).forEach(function (sid) {
        const recs = all[sid] || {};
        Object.keys(recs).forEach(function (k) {
            const r = recs[k];
            if (r && typeof r === 'object') out.push(Object.assign({}, r, { sid: sid, key: k }));
        });
    });
    return out.sort(function (a, b) {
        const ca = String(a.createdAt || '');
        const cb = String(b.createdAt || '');
        return ca.localeCompare(cb) || String(a.key).localeCompare(String(b.key));
    });
}
function wdpSortedPlanIds(plans) {
    return Object.keys(plans || {}).sort(function (a, b) { return wdpNum(plans[a].monthlyFee) - wdpNum(plans[b].monthlyFee); });
}
function wdpLimitsOf(planId, plan) {
    return { planId: planId, name: plan.name, maxBranches: wdpNum(plan.maxBranches), maxStaff: wdpNum(plan.maxStaff), maxProducts: wdpNum(plan.maxProducts) };
}
function wdpStatusChip(st) {
    const m = { pending: ['#fef3c7', '#92400e', 'AWAITING APPROVAL'], approved: ['#dcfce7', '#166534', 'APPROVED'], rejected: ['#fee2e2', '#991b1b', 'REJECTED'] }[st] || ['#e2e8f0', '#334155', String(st || '').toUpperCase()];
    return '<span style="background:' + m[0] + '; color:' + m[1] + '; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">' + m[2] + '</span>';
}
function wdpSafeLink(url) { url = String(url || '').trim(); return /^https:\/\//i.test(url) ? url : ''; }

function wdpModal(title, html) {
    let m = document.getElementById('wdp-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdp-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1500; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:520px; max-height:94vh; overflow-y:auto; padding:18px; box-sizing:border-box;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">' +
        '<h3 style="margin:0; font-size:17px;">' + wdpEsc(title) + '</h3>' +
        '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdpCloseModal()">✕</button></div>' + html + '</div>';
    m.style.display = 'flex';
}
function wdpCloseModal() { const m = document.getElementById('wdp-modal'); if (m) m.style.display = 'none'; }

var WDP_INPUT = 'width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px; box-sizing:border-box; font-size:14px;';
function wdpField(id, label, type, value, extra) {
    return '<label style="font-size:12px; font-weight:bold;">' + label + '</label><input id="' + id + '" type="' + type + '" value="' + wdpEsc(value) + '" style="' + WDP_INPUT + '" ' + (extra || '') + '>';
}

// =====================================================================
// STORE SIDE — renew / pay screen
// =====================================================================
function wdpAskStoreId(message) {
    wdpModal('💳 Renew or pay subscription',
        (message ? '<div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">' + wdpEsc(message) + '</div>' : '') +
        wdpField('wdp-sid', 'Your Store ID', 'text', '', 'placeholder="e.g. oreoloyun" autocapitalize="none"') +
        '<button class="menu-btn btn-action-primary" style="justify-content:center; margin:0;" onclick="wdpOpenRenew(document.getElementById(\'wdp-sid\').value)">Continue</button>');
}

async function wdpLoadStore(id) {
    const db = firebase.database();
    const read = function (path) { return db.ref(path).once('value').then(function (snap) { return snap.val(); }); };
    const safe = function (label, promise) {
        return wdpTimeout(promise, 15000).then(
            function (val) { return { ok: true, val: val }; },
            function (e) { return { ok: false, label: label, err: String((e && (e.code || e.message)) || 'error') }; });
    };
    const billingFields = ['dueDate', 'trial', 'plan', 'monthlyFee', 'cycle'];
    const r = await Promise.all([
        safe('store name', read('stores/' + id + '/businessName')),
        safe('billing', Promise.all(billingFields.map(function (k) { return read('billing/' + id + '/' + k); })).then(function (v) {
            if (v.every(function (x) { return x == null; })) return null;
            const b = {};
            billingFields.forEach(function (k, i) { if (v[i] != null) b[k] = v[i]; });
            return b;
        })),
        safe('settings', read('billingSettings')),
        safe('payment history', read('paymentRequests/' + id))
    ]);
    const failed = r.filter(function (x) { return !x.ok; });
    if (failed.length === r.length) {
        const err = new Error('all reads failed');
        err.details = failed.map(function (f) { return f.label + ': ' + f.err; }).join('; ');
        throw err;
    }
    const settings = Object.assign(typeof wdsDefaults === 'function' ? wdsDefaults() : {}, (r[2].ok && r[2].val) || {});
    const name = r[0].ok ? (r[0].val || '') : id;
    return {
        id: id, name: name,
        billing: (r[1].ok && r[1].val) || null,
        settings: settings, plans: settings.plans || {},
        requests: (r[3].ok && r[3].val) || {},
        failed: failed.map(function (f) { return f.label; })
    };
}

var wdpLastId = '';
function wdpFailNote(c) {
    if (!c || !c.failed || !c.failed.length) return '';
    return '<div style="background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">Some details could not be loaded (' + wdpEsc(c.failed.join(', ')) + '). You can still pay and send your proof.</div>';
}

async function wdpOpenRenew(presetId) {
    const id = String(presetId || '').trim().toLowerCase();
    if (!id) { wdpAskStoreId(''); return; }
    wdpLastId = id;
    wdpBanner.at = 0;
    wdpModal('💳 Subscription', '<div style="text-align:center; color:#64748b; padding:24px;">Loading...</div>');
    let data;
    try { data = await wdpLoadStore(id); }
    catch (e) {
        const why = e && e.details ? e.details : (e && e.message) || 'unknown';
        wdpModal('💳 Subscription', '<div style="color:#b91c1c; padding:12px;">Could not load. Please check your internet connection and try again.<div style="font-size:11px; color:#64748b; margin-top:8px;">Details: ' + wdpEsc(why) + '</div></div>' +
            '<button class="menu-btn btn-action-primary" style="justify-content:center; margin:0;" onclick="wdpOpenRenew(wdpLastId)">Try again</button>');
        return;
    }
    if (!data.name) { wdpAskStoreId('We could not find a store with the ID "' + id + '". Please check the spelling.'); return; }
    wdpCtx = data;
    wdpRenderRenew();
}

function wdpRenderRenew() {
    const c = wdpCtx;
    if (!c) return;
    const b = c.billing || {};
    const s = wdpSubState(b, wdpToday(), wdpNum(c.settings.dueSoonDays) || 7);
    const planIds = wdpSortedPlanIds(c.plans);
    const currentPlan = b.plan && c.plans[b.plan] ? c.plans[b.plan] : null;

    let statusText = 'No payment date has been set for this store yet.', statusColor = '#64748b';
    if (s.state === 'overdue') { statusColor = '#dc2626'; statusText = s.trial ? 'Free trial ended ' + s.overdueBy + ' day' + (s.overdueBy === 1 ? '' : 's') + ' ago' : 'Overdue by ' + s.overdueBy + ' day' + (s.overdueBy === 1 ? '' : 's'); }
    else if (s.state === 'due-soon' || s.state === 'ok') { statusColor = s.state === 'due-soon' ? '#d97706' : '#16a34a'; statusText = (s.trial ? 'Free trial ends ' : 'Next payment due ') + wdpPretty(b.dueDate) + ' (' + (s.days === 0 ? 'today' : 'in ' + s.days + ' day' + (s.days === 1 ? '' : 's')) + ')'; }

    const link = wdpSafeLink(c.settings.paymentLink);
    const req = wdpFlatten({ x: c.requests });
    const pending = req.filter(function (r) { return r.status === 'pending' && r.type !== 'plan-change'; });

    const bank = '<div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:12px; margin-bottom:12px;">' +
        '<div style="font-size:11px; font-weight:bold; color:#0369a1; text-transform:uppercase; margin-bottom:6px;">Pay to</div>' +
        '<div style="font-size:13px;"><strong>' + wdpEsc(c.settings.bankName) + '</strong></div>' +
        '<div style="font-size:20px; font-weight:800; letter-spacing:1px; user-select:all;">' + wdpEsc(c.settings.accountNumber) + '</div>' +
        '<div style="font-size:12px; color:#475569;">' + wdpEsc(c.settings.accountName) + '</div>' +
        '<div style="font-size:11px; color:#0369a1; margin-top:6px;">Use <strong>' + wdpEsc(c.id) + '</strong> as the transfer narration/reference.</div>' +
        '<div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">' +
        '<button onclick="wdpCopyAccount()" style="padding:6px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #bae6fd; background:#fff;">📋 Copy account number</button>' +
        (link ? '<a href="' + wdpEsc(link) + '" target="_blank" rel="noopener" style="padding:6px 12px; font-size:12px; font-weight:bold; border-radius:6px; background:#0284c7; color:#fff; text-decoration:none;">🔗 Pay online</a>' : '') +
        '</div></div>';

    const planSelect = planIds.length === 0 ? '' :
        '<label style="font-size:12px; font-weight:bold;">Plan</label><select id="wdp-plan" onchange="wdpRecalc()" style="' + WDP_INPUT + '">' +
        (currentPlan ? '' : '<option value="">Keep my current arrangement</option>') +
        planIds.map(function (pid) {
            const p = c.plans[pid];
            const yf = wdpNum(p.yearlyFee);
            return '<option value="' + wdpEsc(pid) + '"' + (pid === b.plan ? ' selected' : '') + '>' + wdpEsc(p.name) + ' — ' + wdpMoney(p.monthlyFee) + '/month' + (yf > 0 ? ' (or ' + wdpMoney(yf) + '/year)' : '') + (pid === b.plan ? ' (current)' : '') + '</option>';
        }).join('') + '</select>';

    const cycleSelect = '<label style="font-size:12px; font-weight:bold;">Billing cycle</label><select id="wdp-cycle" onchange="wdpRecalc()" style="' + WDP_INPUT + '">' +
        '<option value="monthly">Monthly</option>' +
        '<option value="yearly">Yearly — 12 months upfront</option>' +
        '</select>';

    const monthSelect = '<div id="wdp-monthly-wrap"><label style="font-size:12px; font-weight:bold;">Months paying for</label><select id="wdp-months" onchange="wdpRecalc()" style="' + WDP_INPUT + '">' +
        [1, 2, 3, 6].map(function (m) { return '<option value="' + m + '">' + m + ' month' + (m === 1 ? '' : 's') + '</option>'; }).join('') + '</select></div>';

    const yearlyNote = '<div id="wdp-yearly-note" style="display:none; font-size:12px; color:#166534; background:#f0fdf4; border:1px solid #bbf7d0; padding:8px; border-radius:6px; margin:4px 0 10px;">You are paying for 12 months upfront at the yearly rate.</div>';

    const form = '<div id="wdp-form" style="' + (pending.length ? 'display:none;' : '') + '">' + planSelect + cycleSelect + monthSelect + yearlyNote +
        wdpField('wdp-amount', 'Amount you paid (₦)', 'number', '', 'min="0"') +
        '<div id="wdp-amount-hint" style="font-size:11px; color:#64748b; margin:-6px 0 10px;"></div>' +
        '<label style="font-size:12px; font-weight:bold;">How did you pay?</label><select id="wdp-method" style="' + WDP_INPUT + '"><option>Transfer</option><option>POS</option><option>Cash deposit</option><option>Online link</option></select>' +
        wdpField('wdp-ref', 'Sender name or transfer reference', 'text', '', 'placeholder="So we can find your payment"') +
        wdpField('wdp-note', 'Note (optional)', 'text', '', '') +
        '<button id="wdp-submit" class="menu-btn btn-action-primary" style="justify-content:center; margin:0; background:#16a34a;" onclick="wdpSubmit()">✔ I\'ve Paid — send for approval</button></div>';

    const pendingNote = pending.length
        ? '<div style="background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:10px; border-radius:8px; font-size:13px; margin-bottom:10px;">⏳ Your payment of <strong>' + wdpMoney(pending[pending.length - 1].amount) + '</strong> is waiting for approval. We usually confirm within a few hours.' +
          '<br><button onclick="document.getElementById(\'wdp-form\').style.display=\'\'; this.parentElement.style.display=\'none\';" style="margin-top:6px; padding:5px 10px; font-size:11px; border-radius:6px; cursor:pointer; border:1px solid #fde68a; background:#fff;">Send another payment</button></div>'
        : '';

    const hist = req.slice().reverse().slice(0, 8);
    const histHtml = hist.length === 0 ? '' :
        '<div style="border-top:1px solid #e2e8f0; margin-top:14px; padding-top:10px;"><div style="font-weight:bold; font-size:13px; margin-bottom:6px;">Your payment requests</div>' +
        hist.map(function (r) {
            return '<div style="padding:6px 0; border-bottom:1px dashed #e2e8f0; font-size:12px;"><div style="display:flex; justify-content:space-between; gap:8px;"><strong>' + (r.type === 'plan-change' ? 'Plan change → ' + wdpEsc(r.planId || '') : wdpMoney(r.amount) + ' · ' + wdpNum(r.months) + ' mo' + (r.cycle === 'yearly' ? ' (yearly)' : '')) + '</strong>' + wdpStatusChip(r.status) + '</div>' +
                '<div style="color:#64748b;">' + wdpPretty(r.createdAt) + ' · ' + wdpEsc(r.method || '') + ' · ref ' + wdpEsc(r.reference || '') + '</div>' +
                (r.status === 'approved' && r.dueAfter ? '<div style="color:#166534;">Next payment due ' + wdpPretty(r.dueAfter) + '</div>' : '') +
                (r.status === 'rejected' ? '<div style="color:#991b1b;">' + wdpEsc(r.rejectReason || 'Not confirmed. Please contact support.') + '</div>' : '') + '</div>';
        }).join('') + '</div>';

    wdpModal('💳 Subscription — ' + c.name,
        '<div style="margin-bottom:12px;"><div style="font-size:12px; color:#64748b;">Store ID: ' + wdpEsc(c.id) + (currentPlan ? ' · Plan: <strong>' + wdpEsc(currentPlan.name) + '</strong>' : '') + '</div>' +
        '<div style="font-size:15px; font-weight:bold; color:' + statusColor + ';">' + statusText + '</div></div>' +
        wdpFailNote(c) + bank + pendingNote + form + histHtml +
        '<div style="text-align:center; margin-top:12px;"><a href="https://wa.me/' + WDP_SUPPORT_WA + '?text=' + encodeURIComponent('Hello, I need help with my Wise Decision subscription. Store ID: ' + c.id) + '" target="_blank" rel="noopener" style="font-size:12px; color:#166534; font-weight:bold;">💬 Need help? Chat with support</a></div>');

    const cy = document.getElementById('wdp-cycle');
    if (cy && b.cycle === 'yearly') cy.value = 'yearly';
    wdpRecalc();
}

function wdpCopyAccount() {
    const c = wdpCtx;
    if (!c) return;
    const n = String(c.settings.accountNumber || '');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(n).then(function () { alert('Account number copied: ' + n); }, function () { prompt('Copy the account number:', n); });
    else prompt('Copy the account number:', n);
}

function wdpRecalc() {
    const c = wdpCtx;
    if (!c) return;
    const sel = document.getElementById('wdp-plan');
    const planId = sel ? sel.value : (c.billing && c.billing.plan) || '';
    const plan = planId && c.plans[planId] ? c.plans[planId] : null;

    const cycleEl = document.getElementById('wdp-cycle');
    const cycle = cycleEl && cycleEl.value === 'yearly' ? 'yearly' : 'monthly';

    const monthWrap = document.getElementById('wdp-monthly-wrap');
    const yearNote = document.getElementById('wdp-yearly-note');
    if (monthWrap) monthWrap.style.display = cycle === 'yearly' ? 'none' : '';
    if (yearNote) yearNote.style.display = cycle === 'yearly' ? '' : 'none';

    const months = cycle === 'yearly' ? 12 : (parseInt((document.getElementById('wdp-months') || {}).value) || 1);
    const monthlyFee = plan ? wdpNum(plan.monthlyFee) : wdpNum(c.billing && c.billing.monthlyFee);
    const yearlyFee = plan ? wdpYearlyFee(plan) : monthlyFee * 12;
    const fee = cycle === 'yearly' ? yearlyFee : monthlyFee;

    const amountEl = document.getElementById('wdp-amount'), hint = document.getElementById('wdp-amount-hint');
    if (fee > 0) {
        const amt = cycle === 'yearly' ? fee : fee * months;
        amountEl.value = amt;
        if (cycle === 'yearly') {
            const save = monthlyFee * 12 - fee;
            hint.textContent = wdpMoney(fee) + ' for 12 months' + (save > 0 ? ' — you save ' + wdpMoney(save) + ' vs paying monthly.' : '.') + ' Change it if you paid a different amount.';
        } else {
            hint.textContent = wdpMoney(fee) + ' × ' + months + ' month' + (months === 1 ? '' : 's') + ' = ' + wdpMoney(fee * months) + '. Change it if you paid a different amount.';
        }
    } else { hint.textContent = 'Enter exactly what you paid.'; }
}

async function wdpSubmit() {
    const c = wdpCtx;
    if (!c || wdpBusy) return;
    const amount = parseFloat(document.getElementById('wdp-amount').value);
    const cycleEl = document.getElementById('wdp-cycle');
    const cycle = cycleEl && cycleEl.value === 'yearly' ? 'yearly' : 'monthly';
    const months = cycle === 'yearly' ? 12 : (parseInt(document.getElementById('wdp-months').value) || 1);
    const method = document.getElementById('wdp-method').value;
    const reference = document.getElementById('wdp-ref').value.trim();
    const note = document.getElementById('wdp-note').value.trim();
    const sel = document.getElementById('wdp-plan');
    const planId = sel ? sel.value : '';
    if (!(amount > 0)) { alert('Enter the amount you paid.'); return; }
    if (reference.length < 3) { alert('Please enter the sender name or transfer reference, so we can find your payment.'); return; }

    const rec = { storeId: c.id, storeName: c.name, amount: amount, months: months, cycle: cycle, planId: planId || null, method: method, reference: reference, note: note, status: 'pending', createdAt: new Date().toISOString() };
    wdpBusy = true;
    const btn = document.getElementById('wdp-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
        const ref = firebase.database().ref('paymentRequests/' + c.id).push();
        await ref.set(rec);
        wdpNotifyEmail(rec);
        c.requests[ref.key] = rec;
        wdpBusy = false;
        wdpRenderRenew();
        if (confirm('✅ Sent! We will confirm your payment shortly.\n\nTap OK to also message Wise Decision on WhatsApp so it is confirmed faster.')) {
            const msg = 'Hello, I have paid my Wise Decision subscription.\n\nStore ID: ' + c.id + '\nAmount: ' + wdpMoney(amount) + ' (' + (cycle === 'yearly' ? '1 year — 12 months' : months + ' month' + (months === 1 ? '' : 's')) + ')\nPaid by: ' + method + '\nReference: ' + reference + '\n\nPlease approve it. Thank you!';
            window.open('https://wa.me/' + WDP_SUPPORT_WA + '?text=' + encodeURIComponent(msg), '_blank');
        }
    } catch (e) {
        wdpBusy = false;
        if (btn) { btn.disabled = false; btn.textContent = '✔ I\'ve Paid — send for approval'; }
        alert('Could not send: ' + e.message + '\n\nPlease check your internet and try again.');
    }
}

// =====================================================================
// SUPER ADMIN — pending payments
// =====================================================================
function wdpStartListener() {
    if (wdpListening || wdpListenerBlocked || typeof firebase === 'undefined') return;
    wdpListening = true;
    try {
        firebase.database().ref('paymentRequests').on('value', function (snap) {
            wdpAll = snap.val() || {};
            wdpUpdateBadge();
            const m = document.getElementById('wdp-modal');
            if (m && m.style.display === 'flex' && m.dataset.view === 'pending') wdpOpenPending();
        }, function (err) {
            wdpListening = false;
            if (err && (err.code ===
