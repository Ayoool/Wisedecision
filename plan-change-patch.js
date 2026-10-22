// ==================== WISE DECISION PLAN CHANGE PATCH (v1) ====================
// Load AFTER payments-patch.js and storeplans-patch.js, with defer.
console.log("Wise Decision plan-change-patch.js — v1 loaded");

function wdcLimitText(p) {
    var u = function (n) { return wdpNum(n) > 0 ? String(wdpNum(n)) : 'unlimited'; };
    return u(p.maxBranches) + ' branch' + (wdpNum(p.maxBranches) === 1 ? '' : 'es') + ' · ' + u(p.maxStaff) + ' staff · ' + u(p.maxProducts) + ' products';
}

async function wdcUsage(sid) {
    if (typeof wdnShallow !== 'function' || typeof wdnCountProducts !== 'function') return null;
    try {
        var r = await Promise.all([wdnShallow('stores/' + sid + '/branches'), wdnShallow('stores/' + sid + '/staff'), wdnCountProducts(sid)]);
        return { branches: r[0].length, staff: r[1].length, products: r[2] };
    } catch (e) { return null; }   // not signed in as this store: Super Admin checks it at review
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

// ---------------- STORE SIDE ----------------
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
        return '<div style="border:' + (isCur ? '2px solid #86efac' : '1px solid #e2e8f0') + '; border-radius:8px; padding:10px; margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; gap:8px;"><strong>' + wdpEsc(p.name) + '</strong>' + tag + '</div>' +
            '<div style="font-weight:bold; color:#166534; margin:2px 0;">' + wdpMoney(p.monthlyFee) + '/month</div>' +
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
    var html = '<div style="font-size:14px; margin-bottom:8px;">Switch to <strong>' + wdpEsc(p.name) + '</strong> — ' + wdpMoney(p.monthlyFee) + '/month</div>' +
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

// ---------------- SUPER ADMIN ----------------
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
    wdpModal('Plan change — ' + (rec.storeName || sid),
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; font-size:13px; margin-bottom:10px;">Store: <strong>' + wdpEsc(rec.storeName || sid) + '</strong> (' + e + ')<br>' +
        'From <strong>' + wdpEsc(curName) + '</strong> to <strong>' + wdpEsc(p.name) + '</strong> (' + wdpMoney(p.monthlyFee) + '/month)<br>' +
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

// After a normal payment is approved, offer to apply a saved nextPlan
async function wdcApplyNext(sid, key) {
    var db = firebase.database();
    var node = (await db.ref('paymentRequests/' + sid + '/' + key).once('value')).val();
    if (!node || node.status !== 'approved' || node.type === 'plan-change') return;
    if (!(Date.now() - Date.parse(node.decidedAt) < 120000)) return;   // only for the approval just made
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
