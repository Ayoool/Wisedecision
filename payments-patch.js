// ==================== WISE DECISION SUBSCRIPTION PAYMENTS PATCH (v1) ====================
// Load LAST, after storeplans-patch.js and every other patch (defer).
//
// STORE SIDE
//   * "💳 Subscription" button in the Admin's sidebar, and a "Renew or pay subscription" link on the login
//     screen (so a LOCKED store can still pay and send its proof)
//   * Shows plan, due date, your bank details (and an optional online payment link)
//   * The store picks a plan + months, pays by transfer, then taps "I've Paid" with its reference
//   * A banner reminds the Admin when the subscription is due soon / overdue / the trial is ending
//
// SUPER ADMIN
//   * "💳 Pending payments" button (with a live count) in the Super Admin toolbar
//   * Review each request, change the amount/months if needed, then Approve (extends the due date, ends the
//     trial, applies the plan, unlocks the store, sends a WhatsApp receipt) or Reject (with a reason)
//   * Approving works exactly like "Record payment", and can only be done once per request
//
// ALSO FIXES: saving "Billing settings" used to wipe your Plans (it replaced the whole billingSettings node).
//
// Data: paymentRequests/{storeId}/{requestId}. Phase 2 (fully automatic via Paystack) only replaces the Approve tap.

console.log("Wise Decision payments-patch.js — v1 loaded");

var WDP_SUPPORT_WA = (typeof WDN_SUPPORT_WA !== 'undefined' && WDN_SUPPORT_WA) || '2349168140710';
var wdpAll = null;             // every payment request (Super Admin, kept live)
var wdpListening = false;
var wdpCtx = null;             // the store being shown on the renew screen
var wdpBusy = false;
var wdpBanner = { id: null, at: 0, loading: false, billing: null, soon: 7 };
var wdpBannerDismissed = false;

// ---------- Helpers (the pure ones are tested) ----------
function wdpNum(n) { return Number(n) || 0; }
function wdpEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
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
function wdpFlatten(all) {
    const out = [];
    Object.keys(all || {}).forEach(function (sid) {
        const recs = all[sid] || {};
        Object.keys(recs).forEach(function (k) {
            const r = recs[k];
            if (r && typeof r === 'object') out.push(Object.assign({}, r, { sid: sid, key: k }));
        });
    });
    return out.sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
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
    const t = function (p) { return wdpTimeout(p, 15000); };
    const res = await Promise.all([
        t(db.ref('stores/' + id + '/businessName').once('value')),
        t(db.ref('billing/' + id).once('value')),
        t(db.ref('billingSettings').once('value')),
        t(db.ref('paymentRequests/' + id).once('value'))
    ]);
    const settings = Object.assign(typeof wdsDefaults === 'function' ? wdsDefaults() : {}, res[2].val() || {});
    return { id: id, name: res[0].val() || '', billing: res[1].val() || null, settings: settings, plans: settings.plans || {}, requests: res[3].val() || {} };
}

async function wdpOpenRenew(presetId) {
    const id = String(presetId || '').trim().toLowerCase();
    if (!id) { wdpAskStoreId(''); return; }
    wdpBanner.at = 0;   // refresh the reminder banner after this
    wdpModal('💳 Subscription', '<div style="text-align:center; color:#64748b; padding:24px;">Loading...</div>');
    let data;
    try { data = await wdpLoadStore(id); }
    catch (e) { wdpModal('💳 Subscription', '<div style="color:#b91c1c; padding:12px;">Could not load. Please check your internet connection and try again.</div>'); return; }
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
    const pending = req.filter(function (r) { return r.status === 'pending'; });

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
            return '<option value="' + wdpEsc(pid) + '"' + (pid === b.plan ? ' selected' : '') + '>' + wdpEsc(p.name) + ' — ' + wdpMoney(p.monthlyFee) + '/month' + (pid === b.plan ? ' (current)' : '') + '</option>';
        }).join('') + '</select>';

    const form = '<div id="wdp-form" style="' + (pending.length ? 'display:none;' : '') + '">' + planSelect +
        '<label style="font-size:12px; font-weight:bold;">Months paying for</label><select id="wdp-months" onchange="wdpRecalc()" style="' + WDP_INPUT + '">' +
        [1, 2, 3, 6, 12].map(function (m) { return '<option value="' + m + '">' + m + ' month' + (m === 1 ? '' : 's') + '</option>'; }).join('') + '</select>' +
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
            return '<div style="padding:6px 0; border-bottom:1px dashed #e2e8f0; font-size:12px;"><div style="display:flex; justify-content:space-between; gap:8px;"><strong>' + wdpMoney(r.amount) + ' · ' + wdpNum(r.months) + ' mo</strong>' + wdpStatusChip(r.status) + '</div>' +
                '<div style="color:#64748b;">' + wdpPretty(r.createdAt) + ' · ' + wdpEsc(r.method || '') + ' · ref ' + wdpEsc(r.reference || '') + '</div>' +
                (r.status === 'approved' && r.dueAfter ? '<div style="color:#166534;">Next payment due ' + wdpPretty(r.dueAfter) + '</div>' : '') +
                (r.status === 'rejected' ? '<div style="color:#991b1b;">' + wdpEsc(r.rejectReason || 'Not confirmed. Please contact support.') + '</div>' : '') + '</div>';
        }).join('') + '</div>';

    wdpModal('💳 Subscription — ' + c.name,
        '<div style="margin-bottom:12px;"><div style="font-size:12px; color:#64748b;">Store ID: ' + wdpEsc(c.id) + (currentPlan ? ' · Plan: <strong>' + wdpEsc(currentPlan.name) + '</strong>' : '') + '</div>' +
        '<div style="font-size:15px; font-weight:bold; color:' + statusColor + ';">' + statusText + '</div></div>' +
        bank + pendingNote + form + histHtml +
        '<div style="text-align:center; margin-top:12px;"><a href="https://wa.me/' + WDP_SUPPORT_WA + '?text=' + encodeURIComponent('Hello, I need help with my Wise Decision subscription. Store ID: ' + c.id) + '" target="_blank" rel="noopener" style="font-size:12px; color:#166534; font-weight:bold;">💬 Need help? Chat with support</a></div>');
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
    const fee = plan ? wdpNum(plan.monthlyFee) : wdpNum(c.billing && c.billing.monthlyFee);
    const months = parseInt(document.getElementById('wdp-months').value) || 1;
    const amountEl = document.getElementById('wdp-amount'), hint = document.getElementById('wdp-amount-hint');
    if (fee > 0) {
        amountEl.value = wdpSuggestAmount(fee, months);
        hint.textContent = wdpMoney(fee) + ' × ' + months + ' month' + (months === 1 ? '' : 's') + ' = ' + wdpMoney(wdpSuggestAmount(fee, months)) + '. Change it if you paid a different amount.';
    } else { hint.textContent = 'Enter exactly what you paid.'; }
}

async function wdpSubmit() {
    const c = wdpCtx;
    if (!c || wdpBusy) return;
    const amount = parseFloat(document.getElementById('wdp-amount').value);
    const months = parseInt(document.getElementById('wdp-months').value) || 1;
    const method = document.getElementById('wdp-method').value;
    const reference = document.getElementById('wdp-ref').value.trim();
    const note = document.getElementById('wdp-note').value.trim();
    const sel = document.getElementById('wdp-plan');
    const planId = sel ? sel.value : '';
    if (!(amount > 0)) { alert('Enter the amount you paid.'); return; }
    if (reference.length < 3) { alert('Please enter the sender name or transfer reference, so we can find your payment.'); return; }

    const rec = { storeId: c.id, storeName: c.name, amount: amount, months: months, planId: planId || null, method: method, reference: reference, note: note, status: 'pending', createdAt: new Date().toISOString() };
    wdpBusy = true;
    const btn = document.getElementById('wdp-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
        const ref = firebase.database().ref('paymentRequests/' + c.id).push();
        await ref.set(rec);
        c.requests[ref.key] = rec;
        wdpBusy = false;
        wdpRenderRenew();
        if (confirm('✅ Sent! We will confirm your payment shortly.\n\nTap OK to also message Wise Decision on WhatsApp so it is confirmed faster.')) {
            const msg = 'Hello, I have paid my Wise Decision subscription.\n\nStore ID: ' + c.id + '\nAmount: ' + wdpMoney(amount) + ' (' + months + ' month' + (months === 1 ? '' : 's') + ')\nPaid by: ' + method + '\nReference: ' + reference + '\n\nPlease approve it. Thank you!';
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
    if (wdpListening || typeof firebase === 'undefined') return;
    wdpListening = true;
    try {
        firebase.database().ref('paymentRequests').on('value', function (snap) {
            wdpAll = snap.val() || {};
            wdpUpdateBadge();
            const m = document.getElementById('wdp-modal');
            if (m && m.style.display === 'flex' && m.dataset.view === 'pending') wdpOpenPending();
        }, function () { wdpListening = false; });
    } catch (e) { wdpListening = false; }
}

function wdpPendingCount() { return wdpFlatten(wdpAll).filter(function (r) { return r.status === 'pending'; }).length; }
function wdpUpdateBadge() {
    const b = document.getElementById('wdp-btn-pending');
    if (!b) return;
    const n = wdpPendingCount();
    b.textContent = '💳 Pending payments' + (n ? ' (' + n + ')' : '');
    b.style.background = n ? '#fef3c7' : '#f0fdf4';
    b.style.borderColor = n ? '#fcd34d' : '#bbf7d0';
    b.style.color = n ? '#92400e' : '#166534';
}

function wdpOpenPending() {
    if (currentUserRole !== 'SuperAdmin') return;
    const all = wdpFlatten(wdpAll);
    const pending = all.filter(function (r) { return r.status === 'pending'; });
    const decided = all.filter(function (r) { return r.status !== 'pending'; }).slice(-10).reverse();

    const row = function (r, withButtons) {
        const e = wdpEsc(r.sid), k = wdpEsc(r.key);
        return '<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;"><div><strong>' + wdpEsc(r.storeName || r.sid) + '</strong><br><small style="color:#64748b;">' + e + '</small></div>' + wdpStatusChip(r.status) + '</div>' +
            '<div style="font-size:13px; margin:6px 0;"><strong>' + wdpMoney(r.amount) + '</strong> · ' + wdpNum(r.months) + ' month' + (wdpNum(r.months) === 1 ? '' : 's') + ' · ' + wdpEsc(r.method || '') +
            '<br><span style="color:#475569;">Ref: ' + wdpEsc(r.reference || '—') + '</span>' + (r.note ? '<br><span style="color:#64748b;">' + wdpEsc(r.note) + '</span>' : '') +
            '<br><span style="color:#94a3b8; font-size:11px;">Sent ' + wdpPretty(r.createdAt) + ' (' + wdpAgo(r.createdAt) + ')</span></div>' +
            (withButtons ? '<div style="display:flex; gap:6px;"><button data-sid="' + e + '" data-key="' + k + '" onclick="wdpReview(this.dataset.sid, this.dataset.key)" style="padding:7px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; background:#dcfce7; border:1px solid #86efac; color:#166534;">Review &amp; approve</button>' +
                '<button data-sid="' + e + '" data-key="' + k + '" onclick="wdpReject(this.dataset.sid, this.dataset.key)" style="padding:7px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;">Reject</button></div>' : '') + '</div>';
    };

    wdpModal('💳 Pending payments',
        (pending.length ? pending.map(function (r) { return row(r, true); }).join('') : '<div style="text-align:center; color:#166534; padding:16px;">✅ No payments waiting for approval.</div>') +
        (decided.length ? '<div style="font-weight:bold; font-size:13px; margin:14px 0 6px;">Recently handled</div>' + decided.map(function (r) { return row(r, false); }).join('') : '') +
        '<div style="border-top:1px solid #e2e8f0; margin-top:12px; padding-top:10px;"><button onclick="wdpSetLink()" style="padding:7px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc;">🔗 Set online payment link (Paystack)</button></div>');
    const m = document.getElementById('wdp-modal');
    if (m) m.dataset.view = 'pending';
}

async function wdpSetLink() {
    let current = '';
    try { current = (await firebase.database().ref('billingSettings/paymentLink').once('value')).val() || ''; } catch (e) {}
    const entered = prompt('Paste your Paystack payment page link (must start with https://). Leave empty to remove it.', current);
    if (entered === null) return;
    const link = entered.trim();
    if (link && !wdpSafeLink(link)) { alert('The link must start with https://'); return; }
    try {
        await firebase.database().ref('billingSettings/paymentLink').set(link || null);
        alert(link ? 'Payment link saved. Stores will see a "Pay online" button.' : 'Payment link removed.');
    } catch (e) { alert('Failed: ' + e.message); }
}

function wdpRec(sid, key) { return wdpAll && wdpAll[sid] ? wdpAll[sid][key] : null; }

async function wdpReview(sid, key) {
    const rec = wdpRec(sid, key);
    if (!rec || rec.status !== 'pending') { alert('This request is no longer pending.'); wdpOpenPending(); return; }
    let plans = {};
    try { plans = (await firebase.database().ref('billingSettings/plans').once('value')).val() || {}; } catch (e) {}
    const st = typeof wdsFind === 'function' ? wdsFind(sid) : null;
    const plan = rec.planId && plans[rec.planId] ? plans[rec.planId] : null;
    const currentPlanId = st && st.billing && st.billing.plan;
    const expected = plan ? wdpSuggestAmount(plan.monthlyFee, rec.months) : 0;
    const mismatch = expected > 0 && Math.abs(expected - wdpNum(rec.amount)) > 0.5;
    const e = wdpEsc(sid), k = wdpEsc(key);

    wdpModal('Review payment — ' + (rec.storeName || sid),
        (st ? '' : '<div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">This store is not in your list right now. Close this, tap "Refresh List", then try again.</div>') +
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; font-size:13px; margin-bottom:12px;">' +
        'Store: <strong>' + wdpEsc(rec.storeName || sid) + '</strong> (' + e + ')<br>' +
        'Says they paid: <strong>' + wdpMoney(rec.amount) + '</strong> for ' + wdpNum(rec.months) + ' month' + (wdpNum(rec.months) === 1 ? '' : 's') + ' by ' + wdpEsc(rec.method || '') + '<br>' +
        'Reference: <strong>' + wdpEsc(rec.reference || '—') + '</strong>' + (rec.note ? '<br>Note: ' + wdpEsc(rec.note) : '') + '<br>' +
        'Sent: ' + wdpPretty(rec.createdAt) + (plan ? '<br>Plan chosen: <strong>' + wdpEsc(plan.name) + '</strong> (' + wdpMoney(plan.monthlyFee) + '/month)' : '') + '</div>' +
        '<div style="background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">⚠ First check your bank/Moniepoint app and confirm this money really arrived.' +
        (mismatch ? '<br>The plan price for ' + wdpNum(rec.months) + ' month(s) is ' + wdpMoney(expected) + ', but they say they paid ' + wdpMoney(rec.amount) + '.' : '') + '</div>' +
        wdpField('wdp-ra-amount', 'Amount received (₦)', 'number', rec.amount, 'min="0"') +
        '<label style="font-size:12px; font-weight:bold;">Months to extend</label><select id="wdp-ra-months" style="' + WDP_INPUT + '">' +
        [1, 2, 3, 6, 12].map(function (m) { return '<option value="' + m + '"' + (m === wdpNum(rec.months) ? ' selected' : '') + '>' + m + ' month' + (m === 1 ? '' : 's') + '</option>'; }).join('') + '</select>' +
        (plan && rec.planId !== currentPlanId ? '<label style="display:flex; gap:8px; align-items:center; font-size:13px; margin-bottom:8px;"><input id="wdp-ra-plan" type="checkbox" checked> Switch this store to the <strong>' + wdpEsc(plan.name) + '</strong> plan (updates fee and limits)</label>' : '') +
        (st && st.status === 'suspended' ? '<label style="display:flex; gap:8px; align-items:center; font-size:13px; margin-bottom:8px;"><input id="wdp-ra-unlock" type="checkbox" checked> Unlock this store (it is locked)</label>' : '') +
        '<label style="display:flex; gap:8px; align-items:center; font-size:13px; margin-bottom:12px;"><input id="wdp-ra-receipt" type="checkbox" checked> Send a WhatsApp receipt</label>' +
        '<div style="display:flex; gap:8px;"><button id="wdp-ra-btn" data-sid="' + e + '" data-key="' + k + '" class="menu-btn btn-action-primary" style="justify-content:center; margin:0; background:#16a34a; flex:1;" onclick="wdpApprove(this.dataset.sid, this.dataset.key)">✔ Approve &amp; record payment</button>' +
        '<button class="menu-btn" style="margin:0; width:auto; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdpOpenPending()">Back</button></div>');
    const m = document.getElementById('wdp-modal');
    if (m) m.dataset.view = 'review';
}

async function wdpApprove(sid, key) {
    if (wdpBusy) return;
    const rec = wdpRec(sid, key);
    if (!rec || rec.status !== 'pending') { alert('This request is no longer pending.'); wdpOpenPending(); return; }
    const st = typeof wdsFind === 'function' ? wdsFind(sid) : null;
    if (!st) { alert('This store is not in your list right now. Tap "Refresh List" on the dashboard and try again (it may be in the Bin).'); return; }
    const amount = parseFloat(document.getElementById('wdp-ra-amount').value);
    const months = parseInt(document.getElementById('wdp-ra-months').value) || 1;
    if (!(amount > 0)) { alert('Enter the amount you received.'); return; }
    const planBox = document.getElementById('wdp-ra-plan'), unlockBox = document.getElementById('wdp-ra-unlock'), receiptBox = document.getElementById('wdp-ra-receipt');
    const applyPlan = !!(planBox && planBox.checked), unlock = !!(unlockBox && unlockBox.checked), sendReceipt = !!(receiptBox && receiptBox.checked);

    wdpBusy = true;
    const btn = document.getElementById('wdp-ra-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    const db = firebase.database();
    const statusRef = db.ref('paymentRequests/' + sid + '/' + key + '/status');
    let claimed = false;
    try {
        // Claim the request so it can never be approved twice (even from two phones at once)
        const tx = await statusRef.transaction(function (cur) { return cur === 'pending' ? 'approved' : (cur === null ? cur : undefined); });
        if (!tx.committed || tx.snapshot.val() !== 'approved') { wdpBusy = false; alert('Someone has already handled this request.'); wdpOpenPending(); return; }
        claimed = true;

        const today = wdsTodayStr();
        const nowIso = new Date().toISOString();
        const dueBefore = st.billing && st.billing.dueDate ? st.billing.dueDate : null;
        const dueAfter = wdsNextDueDate(dueBefore, today, months);
        const pk = db.ref('billing/' + sid + '/payments').push().key;
        const u = {};
        u['billing/' + sid + '/dueDate'] = dueAfter;
        u['billing/' + sid + '/lastPaidDate'] = today;
        u['billing/' + sid + '/lastPaidAmount'] = amount;
        u['billing/' + sid + '/trial'] = null;
        u['billing/' + sid + '/payments/' + pk] = { amount: amount, months: months, method: rec.method || 'Transfer', note: 'Ref: ' + (rec.reference || '') + (rec.note ? ' — ' + rec.note : ''), paidDate: today, at: nowIso, dueBefore: dueBefore, dueAfter: dueAfter, recordedBy: 'Super Admin (approved request)' };

        let appliedPlanName = '';
        if (applyPlan && rec.planId) {
            const plans = (await db.ref('billingSettings/plans').once('value')).val() || {};
            const p = plans[rec.planId];
            if (p) {
                u['billing/' + sid + '/plan'] = rec.planId;
                if (wdpNum(p.monthlyFee) > 0) u['billing/' + sid + '/monthlyFee'] = wdpNum(p.monthlyFee);
                u['stores/' + sid + '/planLimits'] = wdpLimitsOf(rec.planId, p);
                appliedPlanName = p.name;
            }
        }
        if (!appliedPlanName && !(st.billing && st.billing.monthlyFee)) u['billing/' + sid + '/monthlyFee'] = Math.round((amount / months) * 100) / 100;
        if (unlock && st.status === 'suspended') u['stores/' + sid + '/status'] = 'active';
        u['paymentRequests/' + sid + '/' + key + '/decidedAt'] = nowIso;
        u['paymentRequests/' + sid + '/' + key + '/decidedBy'] = 'Super Admin';
        u['paymentRequests/' + sid + '/' + key + '/approvedAmount'] = amount;
        u['paymentRequests/' + sid + '/' + key + '/approvedMonths'] = months;
        u['paymentRequests/' + sid + '/' + key + '/dueAfter'] = dueAfter;

        await db.ref().update(u);
        claimed = false;
        wdpBusy = false;
        try { await wdsLog(sid, { type: 'payment', text: 'Payment ' + wdpMoney(amount) + ' (' + (rec.method || 'Transfer') + ') approved from store request — ' + months + 'mo → due ' + dueAfter + (appliedPlanName ? ' · plan ' + appliedPlanName : ''), amount: amount }); } catch (e) {}

        if (sendReceipt) {
            const receipt = 'Hello ' + (st.name || sid) + ', we have confirmed your payment of ' + wdpMoney(amount) + ' (' + months + ' month' + (months === 1 ? '' : 's') + ').\n\nYour next due date is ' + wdpPretty(dueAfter) + '.' + (unlock && st.status === 'suspended' ? '\n\nYour store has been unlocked.' : '') + '\n\nThank you for being with Wise Decision!';
            const num = wdpWaNumber(st.phone);
            if (num) window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(receipt), '_blank');
            else prompt('No phone number saved. Copy this receipt:', receipt);
        } else { alert('Approved. Next due date: ' + wdpPretty(dueAfter) + '.'); }
        if (typeof wdsReload === 'function') { try { await wdsReload(); } catch (e) {} }
        wdpOpenPending();
    } catch (e) {
        wdpBusy = false;
        if (claimed) { try { await statusRef.set('pending'); } catch const (_) {} }
        alert('Could not approve: ' + e.message + '\n\nNothing was changed — you can try again.');
        if (btn) { btn.disabled = false; btn.textContent = '✔ Approve & record payment'; }
    }
}

async function wdpReject(sid, key) {
    const rec = wdpRec(sid, key);
    if (!rec || rec.status !== 'pending') { alert('This request is no longer pending.'); wdpOpenPending(); return; }
    const reason = prompt('Why are you rejecting this payment? The store will see this.\n(e.g. "We did not receive the transfer yet")', '');
    if (reason === null) return;
    try {
        const db = firebase.database();
        const tx = await db.ref('paymentRequests/' + sid + '/' + key + '/status').transaction(function (cur) { return cur === 'pending' ? 'rejected' : (cur === null ? cur : undefined); });
        if (!tx.committed || tx.snapshot.val() !== 'rejected') { alert('Someone has already handled this request.'); wdpOpenPending(); return; }
        await db.ref('paymentRequests/' + sid + '/' + key).update({ rejectReason: reason.trim() || 'Payment not confirmed. Please contact support.', decidedAt: new Date().toISOString(), decidedBy: 'Super Admin' });
        try { await wdsLog(sid, { type: 'payment', text: 'Payment request of ' + wdpMoney(rec.amount) + ' rejected' + (reason.trim() ? ': ' + reason.trim() : '') }); } catch (e) {}
        wdpOpenPending();
    } catch (e) { alert('Failed: ' + e.message); }
}

// =====================================================================
// FIX: saving "Billing settings" must not wipe the plans (it used set() on the whole node)
// =====================================================================
window.wdsSaveSettings = async function () {
    const v = function (id) { return document.getElementById(id).value.trim(); };
    const settings = {
        bankName: v('wds-set-bank'), accountNumber: v('wds-set-acct'), accountName: v('wds-set-name'),
        defaultFee: Math.max(0, parseFloat(v('wds-set-fee')) || 0),
        graceDays: Math.max(0, parseInt(v('wds-set-grace')) || 0),
        dueSoonDays: Math.max(0, parseInt(v('wds-set-soon')) || 0)
    };
    if (!settings.bankName || !settings.accountNumber || !settings.accountName) { alert("Bank name, account number and account name are needed for the reminder messages."); return; }
    try {
        await firebase.database().ref('billingSettings').update(settings);   // update, so plans and the payment link are kept
        wdsSettings = Object.assign(wdsDefaults(), wdsSettings || {}, settings);
        wdsCloseModal();
        wdsRender();
    } catch (e) { alert("Failed to save: " + e.message); }
};

// =====================================================================
// STORE SIDE — reminder banner, sidebar button, login link
// =====================================================================
async function wdpEnsureBanner() {
    const old = document.getElementById('wdp-banner');
    isAdmin = currentUserRole === 'Admin' && currentStoreId && currentStoreId !== 'SUPER_ADMIN';
    const wrap = document.getElementById('dashboard-main-wrapper');
    const ws = document.getElementById('workspace-content');
    if (!isAdmin || wdpBannerDismissed || !wrap || !wrap.classList.contains('active') || !ws) { if (old) old.remove(); return; }

    if (wdpBanner.id !== currentStoreId || Date.now() - wdpBanner.at > 5 * 60 * 1000) {
        if (wdpBanner.loading) return;
        wdpBanner.loading = true;
        const sid = currentStoreId;
        try {
            const db = firebase.database();
            const r = await Promise.all([wdpTimeout(db.ref('billing/' + sid + '/dueDate').once('value'), 10000), wdpTimeout(db.ref('billing/' + sid + '/trial').once('value'), 10000), wdpTimeout(db.ref('billingSettings/dueSoonDays').once('value'), 10000)]);
            wdpBanner = { id: sid, at: Date.now(), loading: false, billing: { dueDate: r[0].val(), trial: !!r[1].val() }, soon: r[2].val() == null ? 7 : wdpNum(r[2].val()) };
        } catch (e) { wdpBanner.loading = false; wdpBanner.at = Date.now() - 4 * 60 * 1000; return; }   // try again in a minute
    }

    const s = wdpSubState(wdpBanner.billing, wdpToday(), wdpBanner.soon);

    // --- NEW: skip re-rendering if nothing changed (stops the shaking/flickering) ---
    const stateKey = s.state + '|' + (s.days || 0) + '|' + (s.overdueBy || 0) + '|' + (s.trial ? '1' : '0') + '|' + (wdpBanner.billing && wdpBanner.billing.dueDate || '');
    if (old && old.dataset.stateKey === stateKey) return;
    // --- END NEW ---

    if (s.state !== 'overdue' && s.state !== 'due-soon') { if (old) old.remove(); return; }
    let text, bg, bd, col;
    if (s.state === 'overdue') {
        text = s.trial ? 'Your free trial ended ' + s.overdueBy + ' day' + (s.overdueBy === 1 ? '' : 's') + ' ago.' : 'Your subscription is overdue by ' + s.overdueBy + ' day' + (s.overdueBy === 1 ? '' : 's') + '.';
        bg = '#fef2f2'; bd = '#fecaca'; col = '#991b1b';
    } else {
        text = (s.trial ? 'Your free trial ends ' : 'Your subscription is due ') + (s.days === 0 ? 'today' : 'in ' + s.days + ' day' + (s.days === 1 ? '' : 's')) + ' (' + wdpPretty(wdpBanner.billing.dueDate) + ').';
        bg = '#fffbeb'; bd = '#fde68a'; col = '#92400e';
    }
    let el = old;
    if (!el) {
        el = document.createElement('div');
        el.id = 'wdp-banner';
        el.dataset.stateKey = stateKey;
        ws.insertBefore(el, ws.firstChild);
    } else if (el.parentElement !== ws) {
        ws.insertBefore(el, ws.firstChild);
        el.dataset.stateKey = stateKey;
    } else {
        el.dataset.stateKey = stateKey;
    }
    el.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; background:' + bg + '; border:1px solid ' + bd + '; color:' + col + '; padding:10px 14px; border-radius:10px; margin-bottom:14px; font-size:13px; font-weight:bold;';
    el.innerHTML = '<span>⏰ ' + wdpEsc(text) + '</span><span style="display:flex; gap:6px;"><button onclick="wdpOpenRenew(currentStoreId)" style="padding:6px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:none; background:#0284c7; color:#fff;">💳 Renew now</button>' +
        '<button onclick="wdpBannerDismissed=true; this.closest(\'#wdp-banner\').remove();" style="padding:6px 10px; font-size:12px; border-radius:6px; cursor:pointer; border:1px solid ' + bd + '; background:#fff; color:' + col + ';">✕</button></span>';
}

function wdpAttach() {
    // Super Admin: toolbar button + live listener
    if (currentUserRole === 'SuperAdmin') {
        wdpStartListener();
        const bar = document.getElementById('wds-extra-toolbar');
        if (bar && !document.getElementById('wdp-btn-pending')) {
            const b = document.createElement('button');
            b.id = 'wdp-btn-pending';
            b.className = 'menu-btn';
            b.style.cssText = 'width:auto; margin:0; padding:8px 12px; font-size:12px; font-weight:bold; border:1px solid #bbf7d0;';
            b.onclick = wdpOpenPending;
            bar.appendChild(b);
            wdpUpdateBadge();
        }
    }

    // Store Admin: sidebar button
    const side = document.querySelector('#dashboard-main-wrapper .sidebar');
    const isAdmin = currentUserRole === 'Admin' && currentStoreId && currentStoreId !== 'SUPER_ADMIN';
    if (side) {
        let sb = document.getElementById('wdp-sidebar-btn');
        if (!sb) {
            sb = document.createElement('button');
            sb.id = 'wdp-sidebar-btn';
            sb.className = 'menu-btn btn-sec';
            sb.textContent = '💳 Subscription';
            sb.onclick = function () { wdpOpenRenew(currentStoreId); };
            const logout = side.querySelector('.btn-logout');
            if (logout) side.insertBefore(sb, logout); else side.appendChild(sb);
        }
        sb.style.display = isAdmin ? '' : 'none';
    }

    // Login screen link (so a locked store can still pay)
    if (!document.getElementById('wdp-login-link')) {
        // Try several likely containers, in order of preference
        var loginCard = document.querySelector('#login-view .auth-card') ||
                        document.querySelector('.auth-card') ||
                        document.querySelector('#login-view .login-card') ||
                        document.querySelector('.login-card') ||
                        document.querySelector('#login-view .card') ||
                        document.querySelector('#login-view form');

        // Fallback: find the "Login to Store" button and walk up to its card
        if (!loginCard) {
            var btns = document.querySelectorAll('button, input[type="submit"]');
            for (var i = 0; i < btns.length; i++) {
                var t = (btns[i].textContent || btns[i].value || '').trim().toLowerCase();
                if (t.indexOf('login to store') !== -1) {
                    loginCard = btns[i].closest('.auth-card, .login-card, .card, form, div');
                    if (loginCard) break;
                }
            }
        }

        if (loginCard) {
            var wrapDiv = document.createElement('div');
            wrapDiv.style.cssText = 'text-align:center; margin-top:10px;';
            wrapDiv.innerHTML = '<a id="wdp-login-link" href="javascript:void(0)" style="font-size:13px; font-weight:700; color:#0d9488; text-decoration:none;">💳 Renew or pay subscription</a>';
            wrapDiv.firstChild.onclick = function () { wdpOpenRenew(''); };
            loginCard.appendChild(wrapDiv);
        }
    }

    wdpEnsureBanner().catch(function (e) { console.warn(e); });
}

// =====================================================================
// Event-driven attach (replaces the old 1.2-second polling loop)
// =====================================================================
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { wdpAttach(); } catch (e) { console.warn(e); } });
} else {
    try { wdpAttach(); } catch (e) { console.warn(e); }
}

// Re-attach when the view changes (login, logout, dashboard switch)
window.addEventListener('hashchange', function () { try { wdpAttach(); } catch (e) { console.warn(e); } });
document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { try { wdpAttach(); } catch (e) { console.warn(e); } }
});

// Slow safety net — every 15 seconds instead of every 1.2 seconds
setInterval(function () { try { wdpAttach(); } catch (e) { console.warn(e); } }, 15000);
