// ==================== WISE DECISION SUBSCRIPTION PAYMENTS PATCH (v4.20) ====================
// Load LAST, after storeplans-patch.js and every other patch (defer).
//
// STORE SIDE
//   * "💳 Subscription" button in the Admin's sidebar, and a "Renew or pay subscription" link on the login
//     screen (so a LOCKED store can still pay and send its proof)
//   * Shows plan, due date.
//   * The store picks a plan + billing cycle (Monthly or Yearly) and pays strictly via Paystack.
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
// v4.20: FORCED PAYSTACK PAYMENT. Removed manual bank details and forced all payments to go through 
//   the Paystack popup. The user can still pay via Bank Transfer inside the Paystack modal.
//
// Data: paymentRequests/{storeId}/{requestId}. Phase 2 (fully automatic via Paystack) only replaces the Approve tap.

console.log("Wise Decision payments-patch.js — v4.20 loaded");

var WDP_SUPPORT_WA = (typeof WDN_SUPPORT_WA !== 'undefined' && WDN_SUPPORT_WA) || '2349168140710';

// Email alert to the owner when a store sends a payment request (Google Apps Script web app).
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

// v4.18: yearly helpers
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

    // REMOVED MANUAL BANK DETAILS
    const bank = ''; 

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

    // UPDATED FORM: Forced Paystack, removed manual reference & method fields
    const form = '<div id="wdp-form" style="' + (pending.length ? 'display:none;' : '') + '">' + planSelect + cycleSelect + monthSelect + yearlyNote +
        wdpField('wdp-amount', 'Amount to pay (₦)', 'number', '', 'min="0"') +
        '<div id="wdp-amount-hint" style="font-size:11px; color:#64748b; margin:-6px 0 10px;"></div>' +
        
        // Hidden inputs automatically force Paystack
        '<input type="hidden" id="wdp-method" value="Online link">' +
        '<input type="hidden" id="wdp-ref" value="Paystack Auto">' +
        
        wdpField('wdp-note', 'Note (optional)', 'text', '', '') +
        '<button id="wdp-submit" class="menu-btn btn-action-primary" style="justify-content:center; margin:0; background:#0284c7; color:white;" onclick="wdpSubmit()">💳 Pay with Paystack</button></div>';

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
        wdpFailNote(c) + pendingNote + form + histHtml +
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
    } else { hint.textContent = 'Enter exactly what you want to pay.'; }
}

async function wdpSubmit() {
    const c = wdpCtx;
    if (!c || wdpBusy) return;
    
    const amount = parseFloat(document.getElementById('wdp-amount').value);
    const cycleEl = document.getElementById('wdp-cycle');
    const cycle = cycleEl && cycleEl.value === 'yearly' ? 'yearly' : 'monthly';
    const months = cycle === 'yearly' ? 12 : (parseInt(document.getElementById('wdp-months').value) || 1);
    const method = 'Online link'; // Hardcoded
    const note = document.getElementById('wdp-note').value.trim();
    const sel = document.getElementById('wdp-plan');
    const planId = sel ? sel.value : '';

    if (!(amount > 0)) { alert('Enter the amount you want to pay.'); return; }

    // --- PAYSTACK POPUP LOGIC ---
    if (typeof PaystackPop === 'undefined') {
        alert("Paystack is still loading. Please wait a few seconds and try again.");
        return;
    }
    
    const email = prompt("Please enter your email address for the payment receipt:", "");
    if (!email || email.indexOf('@') === -1) {
        alert("A valid email is required to pay online.");
        return;
    }

    const paystack = new PaystackPop();
    paystack.newTransaction({
        key: 'pk_live_bb20f66f101c80dd0f566b79d8c0e3772476a91c', // Your Live Public Key
        email: email,
        amount: amount * 100, // Paystack uses Kobo (multiply by 100)
        onSuccess: (transaction) => {
            // Payment successful! Auto-fill the reference and save it.
            document.getElementById('wdp-ref').value = transaction.reference;
            alert("Payment successful! Saving your record now...");
            wdpSaveRecord(c, amount, cycle, months, method, transaction.reference, note, planId);
        },
        onCancel: () => {
            alert("Payment window closed.");
        }
    });
}

// Helper function to save the record to Firebase (used by Paystack)
async function wdpSaveRecord(c, amount, cycle, months, method, reference, note, planId) {
    wdpBusy = true;
    const btn = document.getElementById('wdp-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    const rec = { storeId: c.id, storeName: c.name, amount: amount, months: months, cycle: cycle, planId: planId || null, method: method, reference: reference, note: note, status: 'pending', createdAt: new Date().toISOString() };
    
    try {
        const ref = firebase.database().ref('paymentRequests/' + c.id).push();
        await ref.set(rec);
        wdpNotifyEmail(rec);
        c.requests[ref.key] = rec;
        wdpBusy = false;
        wdpRenderRenew();
        alert("Successfully submitted for approval!");
    } catch (e) {
        wdpBusy = false;
        if (btn) { btn.disabled = false; btn.textContent = '💳 Pay with Paystack'; }
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
    wdpStartListener();
    if (wdpAll === null) {
        wdpModal('💳 Pending payments', '<div style="text-align:center; color:#64748b; padding:24px;">Loading...</div>');
        const lm = document.getElementById('wdp-modal');
        if (lm) lm.dataset.view = 'pending';   
        return;
    }
    const all = wdpFlatten(wdpAll);
    const pending = all.filter(function (r) { return r.status === 'pending'; });
    const decided = all.filter(function (r) { return r.status !== 'pending'; }).slice(-10).reverse();

    const row = function (r, withButtons) {
        const e = wdpEsc(r.sid), k = wdpEsc(r.key);
        const cycleTag = r.cycle === 'yearly' ? ' <span style="background:#dbeafe; color:#1e40af; font-size:10px; font-weight:bold; padding:1px 6px; border-radius:8px;">YEARLY</span>' : '';
        return '<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start;"><div><strong>' + wdpEsc(r.storeName || r.sid) + '</strong><br><small style="color:#64748b;">' + e + '</small></div>' + wdpStatusChip(r.status) + '</div>' +
            '<div style="font-size:13px; margin:6px 0;"><strong>' + wdpMoney(r.amount) + '</strong> · ' + wdpNum(r.months) + ' month' + (wdpNum(r.months) === 1 ? '' : 's') + cycleTag + ' · ' + wdpEsc(r.method || '') +
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
    const expected = plan ? wdpAmountFor(plan, rec.cycle === 'yearly' ? 'yearly' : 'monthly', rec.months) : 0;
    const mismatch = expected > 0 && Math.abs(expected - wdpNum(rec.amount)) > 0.5;
    const e = wdpEsc(sid), k = wdpEsc(key);
    const cycleText = rec.cycle === 'yearly' ? 'Yearly (12 months upfront)' : 'Monthly';

    wdpModal('Review payment — ' + (rec.storeName || sid),
        (st ? '' : '<div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">This store is not in your list right now. Close this, tap "Refresh List", then try again.</div>') +
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; font-size:13px; margin-bottom:12px;">' +
        'Store: <strong>' + wdpEsc(rec.storeName || sid) + '</strong> (' + e + ')<br>' +
        'Says they paid: <strong>' + wdpMoney(rec.amount) + '</strong> for ' + wdpNum(rec.months) + ' month' + (wdpNum(rec.months) === 1 ? '' : 's') + ' by ' + wdpEsc(rec.method || '') + '<br>' +
        'Billing cycle: <strong>' + cycleText + '</strong><br>' +
        'Reference: <strong>' + wdpEsc(rec.reference || '—') + '</strong>' + (rec.note ? '<br>Note: ' + wdpEsc(rec.note) : '') + '<br>' +
        'Sent: ' + wdpPretty(rec.createdAt) + (plan ? '<br>Plan chosen: <strong>' + wdpEsc(plan.name) + '</strong> (' + wdpMoney(plan.monthlyFee) + '/month' + (rec.cycle === 'yearly' ? ' · ' + wdpMoney(wdpYearlyFee(plan)) + '/year' : '') + ')' : '') + '</div>' +
        '<div style="background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">⚠ First check your Paystack dashboard and confirm this money really arrived.' +
        (mismatch ? '<br>The expected amount is ' + wdpMoney(expected) + ', but they say they paid ' + wdpMoney(rec.amount) + '.' : '') + '</div>' +
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
        u['billing/' + sid + '/cycle'] = rec.cycle === 'yearly' ? 'yearly' : 'monthly';
        u['billing/' + sid + '/payments/' + pk] = { amount: amount, months: months, cycle: rec.cycle || 'monthly', method: rec.method || 'Transfer', note: 'Ref: ' + (rec.reference || '') + (rec.note ? ' — ' + rec.note : ''), paidDate: today, at: nowIso, dueBefore: dueBefore, dueAfter: dueAfter, recordedBy: 'Super Admin (approved request)' };

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
            const receipt = 'Hello ' + (st.name || sid) + ', we have confirmed your payment of ' + wdpMoney(amount) + ' (' + (rec.cycle === 'yearly' ? '1 year — 12 months' : months + ' month' + (months === 1 ? '' : 's')) + ').\n\nYour next due date is ' + wdpPretty(dueAfter) + '.' + (unlock && st.status === 'suspended' ? '\n\nYour store has been unlocked.' : '') + '\n\nThank you for being with Wise Decision!';
            const num = wdpWaNumber(st.phone);
            if (num) window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(receipt), '_blank');
            else prompt('No phone number saved. Copy this receipt:', receipt);
        } else { alert('Approved. Next due date: ' + wdpPretty(dueAfter) + '.'); }
        if (typeof wdsReload === 'function') { try { await wdsReload(); } catch (e) {} }
        wdpOpenPending();
    } catch (e) {
        wdpBusy = false;
        if (claimed) { try { await statusRef.set('pending'); } catch (_) {} }
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
// CHANGE PLAN (v4.17)
// =====================================================================
function wdcLimitText(p) {
    var u = function (n) { return wdpNum(n) > 0 ? String(wdpNum(n)) : 'unlimited'; };
    return u(p.maxBranches) + ' branch' + (wdpNum(p.maxBranches) === 1 ? '' : 'es') + ' · ' + u(p.maxStaff) + ' staff · ' + u(p.maxProducts) + ' products';
}

async function wdcUsage(sid) {
    if (typeof wdnShallow !== 'function' || typeof wdnCountProducts !== 'function') return null;
    try {
        var r = await Promise.all([wdnShallow('stores/' + sid + '/branches'), wdnShallow('stores/' + sid + '/staff'), wdnCountProducts(sid)]);
        return { branches: r[0].length, staff: r[1].length, products: r[2] };
    } catch (e) { return null; }
}

function wdcOver(u, p) {
    var out = [];
    if (!u) return out;
    [['branches', 'maxBranches'], ['staff members', 'maxStaff'], ['products', 'maxProducts']].forEach(function (x, i) {
        var have = [u.branches, u.staff, u.products][i], max = wdpNum(p[x[1]]);
        if (max > 0 && have > max) out.push(have + ' ' + x[0] + ' (this plan allows ' + max + ')');
    });
    return out;
}

function wdcUsageHtml(u) {
    return u ? '<div style="font-size:12px; color:#475569; margin-bottom:8px;">Now using: ' + u.branches + ' branch(es) · ' + u.staff + ' staff · ' + u.products + ' products</div>' : '';
}

(function () {
    var orig = window.wdpRenderRenew;
    window.wdpRenderRenew = function () {
        var r = orig.apply(this, arguments);
        try { wdcInject(); } catch (e) { console.warn(e); }
        return r;
    };
})();

async function wdcInject() {
    var c = wdpCtx, form = document.getElementById('wdp-form');
    if (!c || !form || document.getElementById('wdc-box')) return;
    if (wdpSortedPlanIds(c.plans).length < 2) return;
    var waiting = wdpFlatten({ x: c.requests }).filter(function (r) { return r.type === 'plan-change' && r.status === 'pending'; });
    var box = document.createElement('div');
    box.id = 'wdc-box';
    box.style.cssText = 'margin-bottom:12px;';
    box.innerHTML = waiting.length
        ? '<div style="background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; padding:10px; border-radius:8px; font-size:13px;">⏳ Your request to change to the <strong>' + wdpEsc((c.plans[waiting[waiting.length - 1].planId] || {}).name || 'new') + '</strong> plan is waiting for approval.</div>'
        : '<button onclick="wdcOpenPicker()" style="width:100%; padding:10px; font-size:13px; font-weight:bold; border-radius:8px; cursor:pointer; border:1px solid #bae6fd; background:#f0f9ff; color:#0369a1;">🔄 Change my plan</button>';
    form.parentNode.insertBefore(box, form);
    try {
        var np = (await firebase.database().ref('billing/' + c.id + '/nextPlan').once('value')).val();
        if (np && c.plans[np] && wdpCtx === c && document.getElementById('wdc-box') === box) {
            box.insertAdjacentHTML('afterbegin', '<div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; padding:10px; border-radius:8px; font-size:13px; margin-bottom:8px;">📅 Your plan changes to <strong>' + wdpEsc(c.plans[np].name) + '</strong> when you renew.</div>');
            var sel = document.getElementById('wdp-plan');
            if (sel && sel.value !== np && document.getElementById('wdp-months')) { sel.value = np; wdpRecalc(); }
        }
    } catch (e) { }
}

function wdcOpenPicker() {
    var c = wdpCtx;
    if (!c) return;
    var cur = c.billing && c.billing.plan;
    var curFee = cur && c.plans[cur] ? wdpNum(c.plans[cur].monthlyFee) : wdpNum(c.billing && c.billing.monthlyFee);
    var cards = wdpSortedPlanIds(c.plans).map(function (pid) {
        var p = c.plans[pid], isCur = pid === cur, up = wdpNum(p.monthlyFee) > curFee;
        var tag = isCur ? '<span style="background:#dcfce7; color:#166534; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">CURRENT</span>'
            : '<span style="background:' + (up ? '#dbeafe' : '#fef3c7') + '; color:' + (up ? '#1e40af' : '#92400e') + '; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">' + (up ? 'UPGRADE' : 'SWITCH DOWN') + '</span>';
        var yf = wdpNum(p.yearlyFee), save = wdpNum(p.monthlyFee) * 12 - yf;
        var yearlyHtml = yf > 0
            ? '<div style="font-size:12px; color:#475569;">or <strong>' + wdpMoney(yf) + '</strong>/year' + (save > 0 ? ' <span style="color:#16a34a;">(save ' + wdpMoney(save) + ')</span>' : '') + '</div>'
            : '';
        return '<div style="border:' + (isCur ? '2px solid #86efac' : '1px solid #e2e8f0') + '; border-radius:8px; padding:10px; margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; gap:8px;"><strong>' + wdpEsc(p.name) + '</strong>' + tag + '</div>' +
            '<div style="font-weight:bold; color:#166534; margin:2px 0;">' + wdpMoney(p.monthlyFee) + '/month</div>' + yearlyHtml +
            '<div style="font-size:12px; color:#475569;">' + wdcLimitText(p) + '</div>' +
            (isCur ? '' : '<button data-id="' + wdpEsc(pid) + '" data-up="' + (up ? 1 : 0) + '" onclick="wdcPick(this.dataset.id, this.dataset.up === \'1\')" style="margin-top:8px; padding:7px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:none; background:#0284c7; color:#fff;">' + (up ? 'Upgrade — pay now' : 'Request this plan') + '</button>') + '</div>';
    }).join('');
    wdpModal('🔄 Change plan', cards + '<button class="menu-btn" style="margin:0; justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdpRenderRenew()">Back</button>');
}

function wdcPick(pid, isUpgrade) {
    if (isUpgrade) {
        wdpRenderRenew();
        var sel = document.getElementById('wdp-plan'), form = document.getElementById('wdp-form');
        if (sel) sel.value = pid;
        if (form) { form.style.display = ''; wdpRecalc(); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    } else wdcOpenRequest(pid);
}

async function wdcOpenRequest(pid) {
    var c = wdpCtx, p = c && c.plans[pid];
    if (!p) return;
    wdpModal('🔄 Change plan', '<div style="text-align:center; color:#64748b; padding:24px;">Checking your usage...</div>');
    var u = await wdcUsage(c.id), over = wdcOver(u, p);
    var due = c.billing && c.billing.dueDate ? wdpPretty(c.billing.dueDate) : 'your next payment';
    var yf = wdpNum(p.yearlyFee);
    var html = '<div style="font-size:14px; margin-bottom:8px;">Switch to <strong>' + wdpEsc(p.name) + '</strong> — ' + wdpMoney(p.monthlyFee) + '/month' + (yf > 0 ? ' <span style="color:#64748b;">or ' + wdpMoney(yf) + '/year</span>' : '') + '</div>' +
        '<div style="font-size:12px; color:#475569; margin-bottom:8px;">' + wdcLimitText(p) + '</div>' + wdcUsageHtml(u) +
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">Nothing to pay now. You keep your current plan until <strong>' + wdpEsc(due) + '</strong>, then the new plan and price apply.</div>';
    if (over.length) {
        html += '<div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:10px; border-radius:6px; font-size:13px; margin-bottom:10px;">You are over this plan\'s limits:<br>• ' + over.map(wdpEsc).join('<br>• ') + '<br><br>Please remove the extra first, then ask again.</div>';
    } else {
        if (!u) html += '<div style="background:#f1f5f9; padding:8px; border-radius:6px; font-size:12px; color:#475569; margin-bottom:10px;">We will check your usage against the new limits when we review this.</div>';
        html += '<label style="font-size:12px; font-weight:bold;">Note (optional)</label><input id="wdc-note" type="text" style="' + WDP_INPUT + '">' +
            '<button id="wdc-send" data-id="' + wdpEsc(pid) + '" class="menu-btn btn-action-primary" style="justify-content:center; margin:0 0 8px; background:#16a34a;" onclick="wdcSend(this.dataset.id)">Send request</button>';
    }
    html += '<button class="menu-btn" style="margin:0; justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdcOpenPicker()">Back</button>';
    wdpModal('🔄 Change plan', html);
}

async function wdcSend(pid) {
    var c = wdpCtx;
    if (!c || wdpBusy) return;
    var p = c.plans[pid];
    if (!p) return;
    var rec = { storeId: c.id, storeName: c.name, type: 'plan-change', amount: 0, months: 0, planId: pid, method: 'Plan change', reference: 'Plan change to ' + p.name, note: ((document.getElementById('wdc-note') || {}).value || '').trim(), status: 'pending', createdAt: new Date().toISOString() };
    wdpBusy = true;
    var btn = document.getElementById('wdc-send');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
        var ref = firebase.database().ref('paymentRequests/' + c.id).push();
        await ref.set(rec);
        wdpNotifyEmail(rec);
        c.requests[ref.key] = rec;
        wdpBusy = false;
        wdpRenderRenew();
        alert('✅ Sent! We will confirm your plan change shortly.');
    } catch (e) {
        wdpBusy = false;
        alert('Could not send: ' + e.message + '\n\nPlease check your internet and try again.');
        wdcOpenRequest(pid);
    }
}

(function () {
    var origReview = window.wdpReview;
    window.wdpReview = function (sid, key) {
        var rec = wdpRec(sid, key);
        if (rec && rec.type === 'plan-change' && rec.status === 'pending') return wdcReview(sid, key);
        return origReview.apply(this, arguments);
    };
    var origApprove = window.wdpApprove;
    window.wdpApprove = async function (sid, key) {
        var r = await origApprove.apply(this, arguments);
        try { await wdcApplyNext(sid, key); } catch (e) { console.warn(e); }
        return r;
    };
})();

async function wdcReview(sid, key) {
    var rec = wdpRec(sid, key);
    if (!rec || rec.status !== 'pending') { alert('This request is no longer pending.'); wdpOpenPending(); return; }
    wdpModal('Plan change — ' + (rec.storeName || sid), '<div style="text-align:center; color:#64748b; padding:24px;">Checking usage...</div>');
    var plans = {};
    try { plans = (await firebase.database().ref('billingSettings/plans').once('value')).val() || {}; } catch (e) { }
    var p = plans[rec.planId];
    if (!p) { alert('That plan no longer exists. Please reject this request.'); wdpOpenPending(); return; }
    var st = typeof wdsFind === 'function' ? wdsFind(sid) : null;
    var curName = st && st.billing && plans[st.billing.plan] ? plans[st.billing.plan].name : 'none';
    var u = await wdcUsage(sid), over = wdcOver(u, p);
    var e = wdpEsc(sid), k = wdpEsc(key);
    var yf = wdpNum(p.yearlyFee);
    wdpModal('Plan change — ' + (rec.storeName || sid),
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; font-size:13px; margin-bottom:10px;">Store: <strong>' + wdpEsc(rec.storeName || sid) + '</strong> (' + e + ')<br>' +
        'From <strong>' + wdpEsc(curName) + '</strong> to <strong>' + wdpEsc(p.name) + '</strong> (' + wdpMoney(p.monthlyFee) + '/month' + (yf > 0 ? ' · ' + wdpMoney(yf) + '/year' : '') + ')<br>' +
        '<span style="color:#475569;">' + wdcLimitText(p) + '</span>' + (rec.note ? '<br>Note: ' + wdpEsc(rec.note) : '') + '</div>' + wdcUsageHtml(u) +
        (over.length ? '<div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">⚠ Over the new limits: ' + over.map(wdpEsc).join('; ') + '</div>' : '') +
        '<label style="display:flex; gap:8px; align-items:center; font-size:13px; margin-bottom:12px;"><input id="wdc-now" type="checkbox"> Switch now instead of at the next renewal</label>' +
        '<div style="display:flex; gap:8px;"><button data-sid="' + e + '" data-key="' + k + '" class="menu-btn btn-action-primary" style="justify-content:center; margin:0; background:#16a34a; flex:1;" onclick="wdcApprove(this.dataset.sid, this.dataset.key)">✔ Approve</button>' +
        '<button class="menu-btn" style="margin:0; width:auto; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdpOpenPending()">Back</button></div>');
    var m = document.getElementById('wdp-modal');
    if (m) m.dataset.view = 'review';
}

async function wdcApprove(sid, key) {
    if (wdpBusy) return;
    var rec = wdpRec(sid, key);
    if (!rec || rec.status !== 'pending') { alert('This request is no longer pending.'); wdpOpenPending(); return; }
    var now = !!(document.getElementById('wdc-now') || {}).checked;
    wdpBusy = true;
    var db = firebase.database(), statusRef = db.ref('paymentRequests/' + sid + '/' + key + '/status'), claimed = false;
    try {
        var plans = (await db.ref('billingSettings/plans').once('value')).val() || {};
        var p = plans[rec.planId];
        if (!p) throw new Error('Plan not found');
        var tx = await statusRef.transaction(function (cur) { return cur === 'pending' ? 'approved' : (cur === null ? cur : undefined); });
        if (!tx.committed || tx.snapshot.val() !== 'approved') { wdpBusy = false; alert('Someone has already handled this request.'); wdpOpenPending(); return; }
        claimed = true;
        var u = {}, nowIso = new Date().toISOString();
        if (now) {
            u['billing/' + sid + '/plan'] = rec.planId;
            if (wdpNum(p.monthlyFee) > 0) u['billing/' + sid + '/monthlyFee'] = wdpNum(p.monthlyFee);
            u['stores/' + sid + '/planLimits'] = wdpLimitsOf(rec.planId, p);
            u['billing/' + sid + '/nextPlan'] = null;
        } else u['billing/' + sid + '/nextPlan'] = rec.planId;
        u['paymentRequests/' + sid + '/' + key + '/decidedAt'] = nowIso;
        u['paymentRequests/' + sid + '/' + key + '/decidedBy'] = 'Super Admin';
        await db.ref().update(u);
        claimed = false; wdpBusy = false;
        try { await wdsLog(sid, { type: 'plan', text: 'Plan change to ' + p.name + (now ? ' applied now' : ' approved — applies at next renewal') }); } catch (e) { }
        if (typeof wdsReload === 'function') { try { await wdsReload(); } catch (e) { } }
        alert(now ? 'Plan switched now.' : 'Approved. The ' + p.name + ' plan will apply at the next renewal.');
        wdpOpenPending();
    } catch (e) {
        wdpBusy = false;
        if (claimed) { try { await statusRef.set('pending'); } catch (_) { } }
        alert('Could not approve: ' + e.message + '\n\nNothing was changed — you can try again.');
    }
}

async function wdcApplyNext(sid, key) {
    var db = firebase.database();
    var node = (await db.ref('paymentRequests/' + sid + '/' + key).once('value')).val();
    if (!node || node.status !== 'approved' || node.type === 'plan-change') return;
    if (!(Date.now() - Date.parse(node.decidedAt) < 120000)) return;
    var np = (await db.ref('billing/' + sid + '/nextPlan').once('value')).val();
    if (!np) return;
    var cur = (await db.ref('billing/' + sid + '/plan').once('value')).val();
    if (cur === np) { await db.ref('billing/' + sid + '/nextPlan').remove(); return; }
    var p = ((await db.ref('billingSettings/plans').once('value')).val() || {})[np];
    if (!p) { await db.ref('billing/' + sid + '/nextPlan').remove(); return; }
    if (!confirm('This store asked to switch to the ' + p.name + ' plan at renewal.\n\nSwitch it now?')) return;
    var u = {};
    u['billing/' + sid + '/plan'] = np;
    if (wdpNum(p.monthlyFee) > 0) u['billing/' + sid + '/monthlyFee'] = wdpNum(p.monthlyFee);
    u['stores/' + sid + '/planLimits'] = wdpLimitsOf(np, p);
    u['billing/' + sid + '/nextPlan'] = null;
    await db.ref().update(u);
    try { await wdsLog(sid, { type: 'plan', text: 'Switched to ' + p.name + ' plan at renewal' }); } catch (e) { }
    if (typeof wdsReload === 'function') { try { await wdsReload(); } catch (e) { } }
}

async function wdpEnsureBanner() {
    const old = document.getElementById('wdp-banner');
    const isAdmin = currentUserRole === 'Admin' && currentStoreId && currentStoreId !== 'SUPER_ADMIN';
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
        } catch (e) { wdpBanner.loading = false; wdpBanner.at = Date.now() - 4 * 60 * 1000; return; }
    }

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

    let el = old;
    if (!el) {
        el = document.createElement('div');
        el.id = 'wdp-banner';
        ws.insertBefore(el, ws.firstChild);
    } else if (el.parentElement !== ws) {
        ws.insertBefore(el, ws.firstChild);
    } else if (ws.firstChild !== el) {
        ws.insertBefore(el, ws.firstChild);
    }

    const newStyle = 'display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; background:' + bg + '; border:1px solid ' + bd + '; color:' + col + '; padding:10px 14px; border-radius:10px; margin-bottom:14px; font-size:13px; font-weight:bold;';

    if (el.dataset.sig !== text + '|' + bg) {
        el.dataset.sig = text + '|' + bg;
        el.style.cssText = newStyle;
        el.innerHTML = newHtml;
    } else if (el.style.cssText !== newStyle) {
        el.style.cssText = newStyle;
    }
}

function wdpIsShown(el) { return !!(el && el.getClientRects().length > 0); }
function wdpFindShownButton(root, test) {
    const btns = root.querySelectorAll('button');
    for (let i = 0; i < btns.length; i++) {
        const t = (btns[i].textContent || '').trim().toLowerCase();
        if (test(t) && wdpIsShown(btns[i])) return btns[i];
    }
    return null;
}

window.wdpAttachSidebar = function () {
    const wrap = document.getElementById('dashboard-main-wrapper');
    const isAdmin = currentUserRole === 'Admin' && currentStoreId && currentStoreId !== 'SUPER_ADMIN';
    const old = document.querySelectorAll('#wdp-sidebar-btn');
    if (old.length === 1 && old[0].dataset.static === '1') return;
    if (!wrap || !isAdmin) { old.forEach(function (b) { b.remove(); }); return; }

    const logout = wdpFindShownButton(wrap, function (t) { return /logout$/.test(t); });
    if (!logout) return;

    if (old.length === 1 && logout.previousElementSibling === old[0]) return;

    old.forEach(function (b) { b.remove(); });
    const sb = document.createElement('button');
    sb.id = 'wdp-sidebar-btn';
    sb.className = 'menu-btn btn-subscription';   
    sb.textContent = '💳 Subscription';
    sb.onclick = function () { wdpOpenRenew(currentStoreId); };
    logout.parentNode.insertBefore(sb, logout);
};

function wdpInsertLoginLink() {
    const regBtn = wdpFindShownButton(document, function (t) { return t.indexOf('register new business') !== -1; });
    const old = document.querySelectorAll('#wdp-login-wrap');
    if (regBtn && old.length === 1 && regBtn.nextElementSibling === old[0]) return;   
    old.forEach(function (w) { w.remove(); });
    if (!regBtn) return;
    const wrap = document.createElement('div');
    wrap.id = 'wdp-login-wrap';
    wrap.style.cssText = 'text-align:center; margin-top:14px;';
    wrap.innerHTML = '<a id="wdp-login-link" href="javascript:void(0)" style="font-size:13px; font-weight:700; color:#0d9488; text-decoration:none;">💳 Renew or pay subscription</a>';
    wrap.firstChild.onclick = function () { wdpOpenRenew(''); };
    regBtn.insertAdjacentElement('afterend', wrap);
}

function wdpHookLoginBuild() {
    const prev = window.wdaeBuildLoginScreen;
    if (typeof prev !== 'function' || prev.__wdp) return;
    const hooked = function () {
        const r = prev.apply(this, arguments);
        try { wdpInsertLoginLink(); } catch (e) { console.warn(e); }
        return r;
    };
    hooked.__wdp = true;
    window.wdaeBuildLoginScreen = hooked;
}

function wdpPendingAnchor(view) {
    const exit = wdpFindShownButton(view, function (t) { return t.indexOf('logout / exit') !== -1; });
    if (exit) return { el: exit, where: 'beforebegin' };
    const other = wdpFindShownButton(view, function (t) { return t.indexOf('billing settings') !== -1; }) ||
                  wdpFindShownButton(view, function (t) { return t.indexOf('load usage') !== -1; });
    return other ? { el: other, where: 'afterend' } : null;
}

function wdpAttachPendingButton() {
    const all = document.querySelectorAll('#wdp-btn-pending');
    let btn = all[0] || null;
    for (let i = 1; i < all.length; i++) all[i].remove();   

    const security = wdpFindShownButton(document, function (t) { return t.indexOf('security') !== -1; });
    const exit = wdpFindShownButton(document, function (t) { return t.indexOf('logout / exit') !== -1; });
    const anchor = security ? { el: security, where: 'afterend' } : (exit ? { el: exit, where: 'beforebegin' } : null);

    if (!anchor) {
        if (btn && btn.dataset.static !== '1') btn.remove();
        return;
    }

    wdpStartListener();

    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'wdp-btn-pending';
        btn.className = 'menu-btn';
        btn.style.cssText = 'width:auto; margin:0; padding:8px 12px; font-size:12px; font-weight:bold; border:1px solid #bbf7d0;';
        btn.onclick = wdpOpenPending;
    }
    btn.style.display = '';

    const inPlace = anchor.where === 'afterend' ? anchor.el.nextElementSibling === btn : btn.nextElementSibling === anchor.el;
    if (!inPlace) anchor.el.insertAdjacentElement(anchor.where, btn);   
    wdpUpdateBadge();
}

var wdpDebugDone = false;
function wdpDebugReport() {
    if (wdpDebugDone || !/[?&]wdpdebug=1/.test(location.search)) return;
    const sv = document.getElementById('super-admin-view') || document;
    if (wdpFindShownButton(document, function (t) { return t.indexOf('logout / exit') !== -1; })) {
        wdpDebugDone = true;
        setTimeout(function () {
            const pb = document.getElementById('wdp-btn-pending');
            const an = wdpPendingAnchor(sv);
            alert('Pending payments button check (payments-patch v4.20)\n' +
                'role: ' + currentUserRole +
                '\nanchor found: ' + (an ? an.el.textContent.trim() : 'NO') +
                '\nbutton exists: ' + !!pb + '\nbutton shown: ' + wdpIsShown(pb) +
                (pb ? '\nlabel: ' + pb.textContent : ''));
        }, 3000);
        return;
    }
    const wrap = document.getElementById('dashboard-main-wrapper');
    if (!wrap || !wrap.classList.contains('active') || !currentStoreId) return;
    wdpDebugDone = true;
    setTimeout(function () {
        const b = document.getElementById('wdp-sidebar-btn');
        const logout = wdpFindShownButton(wrap, function (t) { return /logout$/.test(t); });
        alert('Subscription button check\n' +
            'role: ' + currentUserRole + '\nstore: ' + currentStoreId +
            '\nbutton exists: ' + !!b + '\nbutton shown: ' + wdpIsShown(b) +
            (b ? '\ndisplay: ' + getComputedStyle(b).display : '') +
            '\nlogout button found: ' + !!logout +
            '\nsidebars on page: ' + document.querySelectorAll('.sidebar').length +
            '\nbuttons in sidebar: ' + document.querySelectorAll('.sidebar button').length);
    }, 3000);
}

function wdpAttach() {
    try { wdpAttachPendingButton(); } catch (e) { console.warn(e); }
    try { wdpAttachSidebar(); } catch (e) { console.warn(e); }
    try { wdpDebugReport(); } catch (e) { console.warn(e); }
    try { wdpHookLoginBuild(); } catch (e) { console.warn(e); }
    try { wdpInsertLoginLink(); } catch (e) { console.warn(e); }
    wdpEnsureBanner().catch(function (e) { console.warn(e); });
}

(function () {
    window.addEventListener('load', function () {
        setTimeout(function () { try { wdpAttach(); } catch (e) { console.warn(e); } }, 300);
    });

    var wdpObserver = new MutationObserver(function () {
        try { wdpAttach(); } catch (e) { console.warn(e); }
    });
    if (document.body) {
        wdpObserver.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', function () {
            wdpObserver.observe(document.body, { childList: true, subtree: true });
        });
    }
})();

(function () {
    setInterval(function () { try { wdpAttach(); } catch (e) { console.warn(e); } }, 2000);
})();
