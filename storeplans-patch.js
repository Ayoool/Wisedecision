// ==================== WISE DECISION STORE DETAIL & PLANS PATCH (v32) ====================
// Load AFTER superadmin-patch.js, activation-patch.js and superadmin-tools-patch.js (defer).
//
// SUPER ADMIN
//   6. Store detail page – tap "👁 Details" on any store card: contact info, plan & billing, usage vs
//      limits, staff (with PIN reset), branches, payments, internal notes, and quick actions.
//   8. Plans & limits   – make plans (e.g. Basic / Pro) with a monthly fee and limits on branches,
//      staff and products. Assign a plan to a store from its detail page.
// STORE SIDE
//      A store on a plan can't go past its limits (adding a branch, staff member or product asks
//      them to upgrade on WhatsApp). Admins see "Your plan" in Business Settings.
//
// A limit of 0 means "unlimited". Stores with no plan behave exactly as before.

console.log("Wise Decision storeplans-patch.js — v33 loaded");

var wdnPlans = {};        // planId -> { name, monthlyFee, maxBranches, maxStaff, maxProducts }
var wdnLimits = null;     // limits of the store that is logged in (null = none)
var wdnLoadedFor = null;
var WDN_SUPPORT_WA = '2349168140710';   // your support WhatsApp (same number as on your landing page)

// ---------- Helpers ----------
function wdnEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdnNum(n) { return Number(n) || 0; }
function wdnMoney(n) { return '₦' + (Math.round(wdnNum(n) * 100) / 100).toLocaleString(); }
function wdnUnl(n) { return wdnNum(n) > 0 ? String(wdnNum(n)) : 'unlimited'; }
function wdnPretty(iso) { const t = new Date(iso); return isNaN(t) ? '—' : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
function wdnAgo(iso) {
    const t = Date.parse(iso);
    if (isNaN(t)) return 'never';
    const d = Math.floor((Date.now() - t) / 86400000);
    return d <= 0 ? 'today' : (d === 1 ? 'yesterday' : d + ' days ago');
}
function wdnWithTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
        const t = setTimeout(function () { reject(new Error('timeout')); }, ms);
        promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
}
function wdnLimitReached(count, max) { max = wdnNum(max); return max > 0 && count >= max; }
function wdnSlug(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'plan'; }
function wdnPlanText(p) {
    return wdnUnl(p.maxBranches) + ' branch' + (wdnNum(p.maxBranches) === 1 ? '' : 'es') + ' · ' + wdnUnl(p.maxStaff) + ' staff · ' + wdnUnl(p.maxProducts) + ' products';
}
function wdnLimitsOf(planId, plan) {
    return { planId: planId, name: plan.name, maxBranches: wdnNum(plan.maxBranches), maxStaff: wdnNum(plan.maxStaff), maxProducts: wdnNum(plan.maxProducts) };
}
function wdnLimitMessage(what, count, max, limits) {
    return 'Your plan' + (limits && limits.name ? ' (' + limits.name + ')' : '') + ' allows up to ' + max + ' ' + what + ', and you already have ' + count + '.\n\nTo add more, please upgrade your plan.';
}

function wdnModal(title, html) {
    let m = document.getElementById('wdn-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdn-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1450; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:560px; max-height:94vh; overflow-y:auto; padding:18px; box-sizing:border-box;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">' +
        '<h3 style="margin:0; font-size:17px;">' + wdnEsc(title) + '</h3>' +
        '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdnCloseModal()">✕</button></div>' + html + '</div>';
    m.style.display = 'flex';
}
function wdnCloseModal() { const m = document.getElementById('wdn-modal'); if (m) m.style.display = 'none'; }

// Shallow key listing (names only, not the data) — used to count things cheaply.
// Throws if it can't; we never fall back to downloading the whole node.
async function wdnShallow(path) {
    let url = firebase.app().options.databaseURL + '/' + path + '.json?shallow=true';
    try {
        const u = firebase.auth && firebase.auth().currentUser;
        if (u) url += '&auth=' + encodeURIComponent(await u.getIdToken());
    } catch (e) { /* not signed in with Firebase Auth */ }
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    return j && typeof j === 'object' ? Object.keys(j) : [];
}
async function wdnCountProducts(storeId) {
    try {
        const branches = await wdnShallow('stores/' + storeId + '/inventory');
        let n = 0;
        for (let i = 0; i < branches.length; i++) n += (await wdnShallow('stores/' + storeId + '/inventory/' + branches[i])).length;
        return n;
    } catch (e) { return null; }
}

// =====================================================================
// SUPER ADMIN — PLANS
// =====================================================================
async function wdnLoadPlans() {
    const snap = await firebase.database().ref('billingSettings/plans').once('value');
    wdnPlans = snap.val() || {};
    return wdnPlans;
}

function wdnStoresOnPlan(planId) {
    return (typeof wdsStores !== 'undefined' ? wdsStores : []).filter(function (s) { return s.billing && s.billing.plan === planId; });
}

async function wdnOpenPlans() {
    if (currentUserRole !== 'SuperAdmin') return;
    wdnModal('📋 Plans', '<div style="text-align:center; color:#64748b; padding:20px;">Loading...</div>');
    try { await wdnLoadPlans(); } catch (e) { wdnModal('📋 Plans', '<div style="color:#b91c1c;">Could not load: ' + wdnEsc(e.message) + '</div>'); return; }

    const ids = Object.keys(wdnPlans).sort(function (a, b) { return wdnNum(wdnPlans[a].monthlyFee) - wdnNum(wdnPlans[b].monthlyFee); });
    const rows = ids.length === 0
        ? '<div style="text-align:center; color:#64748b; padding:12px;">No plans yet. Make your first one below.</div>'
        : ids.map(function (id) {
            const p = wdnPlans[id], n = wdnStoresOnPlan(id).length, e = wdnEsc(id);
            return '<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px;">' +
                '<div style="display:flex; justify-content:space-between; gap:8px;"><strong>' + wdnEsc(p.name) + '</strong><span style="color:#166534; font-weight:bold;">' + wdnMoney(p.monthlyFee) + '/month</span></div>' +
                '<div style="font-size:12px; color:#475569; margin:4px 0;">' + wdnPlanText(p) + '</div>' +
                '<div style="font-size:11px; color:#64748b; margin-bottom:6px;">' + n + ' store' + (n === 1 ? '' : 's') + ' on this plan</div>' +
                '<div style="display:flex; gap:6px;">' +
                '<button data-id="' + e + '" onclick="wdnEditPlan(this.dataset.id)" style="padding:5px 10px; font-size:11px; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc;">✏ Edit</button>' +
                '<button data-id="' + e + '" onclick="wdnDeletePlan(this.dataset.id)" style="padding:5px 10px; font-size:11px; border-radius:6px; cursor:pointer; border:1px solid #fecaca; background:#fef2f2; color:#991b1b;">Delete</button></div></div>';
        }).join('');

    wdnModal('📋 Plans', wdnPlanForm(null, null) + '<div style="font-weight:bold; font-size:13px; margin:14px 0 6px;">Your plans</div>' + rows);
}

function wdnPlanForm(id, p) {
    p = p || {};
    const field = function (fid, label, value, type, hint) {
        return '<div><label style="font-size:11px; font-weight:bold;">' + label + '</label>' +
            '<input id="' + fid + '" type="' + (type || 'text') + '" value="' + wdnEsc(value) + '" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;">' +
            (hint ? '<div style="font-size:10px; color:#94a3b8;">' + hint + '</div>' : '') + '</div>';
    };
    return '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px;">' +
        '<div style="font-weight:bold; font-size:13px; margin-bottom:8px;">' + (id ? 'Edit plan' : 'New plan') + '</div>' +
        '<input id="wdn-plan-id" type="hidden" value="' + wdnEsc(id || '') + '">' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">' +
        field('wdn-plan-name', 'Plan name', p.name || '', 'text') + field('wdn-plan-fee', 'Monthly fee (₦)', p.monthlyFee || '', 'number') +
        field('wdn-plan-branches', 'Max branches', p.maxBranches === undefined ? '' : p.maxBranches, 'number', '0 = unlimited') +
        field('wdn-plan-staff', 'Max staff', p.maxStaff === undefined ? '' : p.maxStaff, 'number', '0 = unlimited') +
        field('wdn-plan-products', 'Max products', p.maxProducts === undefined ? '' : p.maxProducts, 'number', '0 = unlimited') + '</div>' +
        '<button class="menu-btn btn-action-primary" style="justify-content:center; margin:0;" onclick="wdnSavePlan()">' + (id ? 'Save changes' : 'Create plan') + '</button></div>';
}

function wdnEditPlan(id) {
    const p = wdnPlans[id];
    if (!p) return;
    wdnModal('📋 Plans', wdnPlanForm(id, p));
}

async function wdnSavePlan() {
    const v = function (id) { return document.getElementById(id).value.trim(); };
    const existingId = v('wdn-plan-id');
    const name = v('wdn-plan-name');
    const fee = parseFloat(v('wdn-plan-fee')), mb = parseInt(v('wdn-plan-branches')), ms = parseInt(v('wdn-plan-staff')), mp = parseInt(v('wdn-plan-products'));
    if (!name) { alert("Give the plan a name."); return; }
    if (isNaN(fee) || fee < 0) { alert("Enter the monthly fee (0 or more)."); return; }
    if ([mb, ms, mp].some(function (x) { return isNaN(x) || x < 0; })) { alert("Enter the limits as whole numbers. Use 0 for unlimited."); return; }

    let id = existingId;
    if (!id) {
        id = wdnSlug(name);
        let base = id, i = 2;
        while (wdnPlans[id]) { id = base + '-' + i++; }
    }
    const plan = { name: name, monthlyFee: fee, maxBranches: mb, maxStaff: ms, maxProducts: mp };
    try {
        const updates = {};
        updates['billingSettings/plans/' + id] = plan;
        // Stores already on this plan follow the new limits (their fees are left alone)
        wdnStoresOnPlan(id).forEach(function (s) { updates['stores/' + s.id + '/planLimits'] = wdnLimitsOf(id, plan); });
        await firebase.database().ref().update(updates);
        const n = wdnStoresOnPlan(id).length;
        alert(existingId ? ('Plan saved.' + (n ? ' The ' + n + ' store' + (n === 1 ? '' : 's') + ' on it now have the new limits. Their monthly fees were not changed.' : '')) : 'Plan created. Assign it to a store from the store\'s 👁 Details page.');
        wdnOpenPlans();
    } catch (e) { alert("Could not save: " + e.message); }
}

async function wdnDeletePlan(id) {
    const n = wdnStoresOnPlan(id).length;
    if (n > 0) { alert(n + ' store' + (n === 1 ? ' is' : 's are') + ' still on this plan. Move them to another plan (or no plan) first.'); return; }
    if (!confirm('Delete the plan "' + (wdnPlans[id] ? wdnPlans[id].name : id) + '"?')) return;
    try { await firebase.database().ref('billingSettings/plans/' + id).remove(); wdnOpenPlans(); } catch (e) { alert("Failed: " + e.message); }
}

async function wdnApplyPlan(storeId) {
    const sel = document.getElementById('wdn-detail-plan');
    const planId = sel ? sel.value : '';
    const plan = planId ? wdnPlans[planId] : null;
    const alsoFee = !!(plan && wdnNum(plan.monthlyFee) > 0 && confirm('Also set this store\'s monthly fee to ' + wdnMoney(plan.monthlyFee) + '?\n\nOK = yes, change the fee\nCancel = keep the current fee'));
    const updates = {};
    updates['billing/' + storeId + '/plan'] = planId || null;
    if (alsoFee) updates['billing/' + storeId + '/monthlyFee'] = wdnNum(plan.monthlyFee);
    updates['stores/' + storeId + '/planLimits'] = plan ? wdnLimitsOf(planId, plan) : null;
    try {
        await firebase.database().ref().update(updates);
        if (typeof wdsReload === 'function') await wdsReload();
        alert(plan ? 'Plan "' + plan.name + '" applied. Its limits now apply to this store.' : 'Plan removed — this store has no limits.');
        wdnOpenDetail(storeId);
    } catch (e) { alert("Failed: " + e.message); }
}

// =====================================================================
// SUPER ADMIN — STORE DETAIL PAGE
// =====================================================================
var wdnDetailId = null;

function wdnRow(label, value) {
    return '<div style="display:flex; justify-content:space-between; gap:10px; font-size:12px; padding:2px 0;"><span style="color:#64748b;">' + label + '</span><span style="text-align:right;">' + value + '</span></div>';
}
function wdnMeterValue(count, max) {
    const over = count !== null && wdnLimitReached(count, max);
    return '<strong style="color:' + (over ? '#b91c1c' : '#0f172a') + ';">' + (count === null || count === undefined ? '?' : count) + '</strong> of ' + wdnUnl(max) + (over ? ' ⚠ at limit' : '');
}
function wdnUsageHtml(u) {
    return wdnRow('Sales this month', (u.capped ? u.salesMonth + '+' : u.salesMonth) + ' · ' + (u.capped ? 'at least ' : '') + wdnMoney(u.revenueMonth)) + wdnRow('Last sale', wdnAgo(u.lastSaleAt));
}

// The page opens as soon as the small, quick facts arrive. The slower numbers (product and customer
// counts, this month's sales) fill in afterwards, each on its own — a big store can never block the page.
async function wdnOpenDetail(id) {
    if (currentUserRole !== 'SuperAdmin') return;
    const st = typeof wdsFind === 'function' ? wdsFind(id) : null;
    if (!st) return;
    wdnDetailId = id;
    wdnModal(st.name || st.id, '<div style="text-align:center; color:#64748b; padding:24px;">Loading store details...</div>');

    const quick = function (p) { return wdnWithTimeout(p, 20000).catch(function () { return null; }); };
    const root = firebase.database().ref('stores/' + id);
    const got = await Promise.all([quick(root.child('staff').once('value')), quick(root.child('branches').once('value')), quick(root.child('address').once('value')), quick(wdnLoadPlans())]);
    if (wdnDetailId !== id) return;                                   // they moved on to something else

    const staffSnap = got[0], branchSnap = got[1], addrSnap = got[2];
    const branches = {}; if (branchSnap) branchSnap.forEach(function (c) { branches[c.key] = c.val() || {}; });
    const staff = []; if (staffSnap) staffSnap.forEach(function (c) { staff.push(Object.assign({ key: c.key }, c.val())); });
    const b = st.billing || {};
    const plan = b.plan && wdnPlans[b.plan] ? wdnPlans[b.plan] : null;
    const lim = plan || {};
    const state = typeof wdsBillingState === 'function' ? wdsBillingState(st.billing, wdsTodayStr(), wdsSettings) : { state: 'none' };
    const eid = wdnEsc(id);
    const retry = function (what) { return '<div style="font-size:12px; color:#b45309;">Couldn\'t load ' + what + '. <button data-id="' + eid + '" onclick="wdnOpenDetail(this.dataset.id)" style="padding:3px 8px; font-size:11px; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc;">Retry</button></div>'; };

    const sec = function (title, body) { return '<div style="border-top:1px solid #e2e8f0; padding:12px 0;"><div style="font-weight:bold; font-size:13px; margin-bottom:6px;">' + title + '</div>' + body + '</div>'; };

    let dueText = 'No billing set up';
    if (state.state === 'overdue') dueText = '<span style="color:#dc2626;">' + (b.trial ? 'Trial ended ' : 'Overdue by ') + state.overdueBy + ' day' + (state.overdueBy === 1 ? '' : 's') + (b.trial ? ' ago' : '') + '</span>';
    else if (state.state === 'due-soon' || state.state === 'ok') dueText = (b.trial ? 'Trial ends ' : 'Due ') + wdnPretty(b.dueDate) + ' (' + (state.days === 0 ? 'today' : 'in ' + state.days + ' days') + ')';

    const planOptions = '<option value="">No plan (no limits)</option>' + Object.keys(wdnPlans).map(function (pid) {
        return '<option value="' + wdnEsc(pid) + '"' + (pid === b.plan ? ' selected' : '') + '>' + wdnEsc(wdnPlans[pid].name) + ' — ' + wdnMoney(wdnPlans[pid].monthlyFee) + '</option>';
    }).join('');

    const staffRows = !staffSnap ? retry('the staff list') : (staff.length === 0 ? '<div style="font-size:12px; color:#64748b;">No staff added yet.</div>' : staff.map(function (s) {
        const branchName = branches[s.branchId] ? branches[s.branchId].name : (s.branchId || 'Main');
        const reset = s.authUid
            ? '<span style="font-size:10px; color:#94a3b8;">protected login</span>'
            : '<button data-store="' + eid + '" data-key="' + wdnEsc(s.key) + '" data-name="' + wdnEsc(s.name || '') + '" onclick="wdnResetStaffPin(this)" style="padding:4px 8px; font-size:10px; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc;">🔑 Reset PIN</button>';
        return '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:12px; padding:5px 0; border-bottom:1px dashed #e2e8f0;"><div><strong>' + wdnEsc(s.name || 'Unnamed') + '</strong><br><span style="color:#64748b;">' + wdnEsc(s.role || '') + ' · ' + wdnEsc(branchName) + '</span></div>' + reset + '</div>';
    }).join(''));

    const branchKeys = Object.keys(branches);
    const branchRows = !branchSnap ? retry('the branches') : (branchKeys.map(function (k) { return '<div style="font-size:12px;">🏢 ' + wdnEsc(branches[k].name || k) + (branches[k].isMain ? ' <small style="color:#64748b;">(main)</small>' : '') + '</div>'; }).join('') || '<div style="font-size:12px; color:#64748b;">None</div>');

    const pays = typeof wdsPaymentsOf === 'function' ? wdsPaymentsOf(st.billing).slice(0, 5) : [];
    const payRows = pays.length === 0 ? '<div style="font-size:12px; color:#64748b;">No payments recorded yet.</div>' : pays.map(function (p) {
        return wdnRow(wdnPretty(p.paidDate) + ' · ' + wdnEsc(p.method || ''), wdnMoney(p.amount) + ' → due ' + wdnPretty(p.dueAfter));
    }).join('');

    const act = function (a, label, style) { return '<button data-id="' + eid + '" onclick="wdnAct(\'' + a + '\', this.dataset.id)" style="padding:7px 11px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc; ' + (style || '') + '">' + label + '</button>'; };

    const html =
        '<div style="margin-bottom:8px;"><small style="color:#64748b;">' + eid + '</small> ' +
        (st.status === 'suspended' ? '<span style="background:#e2e8f0; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">LOCKED</span> ' : '') +
        (b.trial ? '<span style="background:#ede9fe; color:#6d28d9; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">FREE TRIAL</span>' : '') + '</div>' +
        sec('Contact', wdnRow('Phone', wdnEsc(st.phone || '—')) + wdnRow('Address', wdnEsc((addrSnap && addrSnap.val()) || '—')) + wdnRow('Registered', wdnPretty(st.createdAt)) + wdnRow('Last active', wdnAgo(st.lastActiveAt))) +
        sec('Plan &amp; billing',
            wdnRow('Plan', plan ? '<strong>' + wdnEsc(plan.name) + '</strong>' : 'none') + wdnRow('Monthly fee', b.monthlyFee ? wdnMoney(b.monthlyFee) : '—') + wdnRow('Payment', dueText) +
            (b.lastPaidDate ? wdnRow('Last paid', wdnPretty(b.lastPaidDate) + ' (' + wdnMoney(b.lastPaidAmount) + ')') : '') +
            '<div style="display:flex; gap:6px; margin-top:8px;"><select id="wdn-detail-plan" style="flex:1; padding:7px; border:1px solid #cbd5e1; border-radius:6px;">' + planOptions + '</select>' +
            '<button data-id="' + eid + '" onclick="wdnApplyPlan(this.dataset.id)" style="padding:7px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; background:#0284c7; color:#fff; border:none;">Apply plan</button></div>') +
        sec('Usage' + (plan ? ' vs plan limits' : ''),
            wdnRow('Branches', staffSnap || branchSnap ? wdnMeterValue(branchSnap ? branchKeys.length : null, lim.maxBranches) : '?') +
            wdnRow('Staff', wdnMeterValue(staffSnap ? staff.length : null, lim.maxStaff)) +
            wdnRow('Products', '<span id="wdn-slow-products" style="color:#94a3b8;">counting…</span>') +
            wdnRow('Customers', '<span id="wdn-slow-customers" style="color:#94a3b8;">counting…</span>') +
            '<div id="wdn-slow-usage" style="font-size:12px; color:#94a3b8; padding:2px 0;">Loading this month\'s sales…</div>') +
        sec('Staff (' + staff.length + ')', staffRows) +
        sec('Branches (' + branchKeys.length + ')', branchRows) +
        sec('Recent payments', payRows) +
        sec('Private notes', '<textarea id="wdn-detail-notes" rows="3" placeholder="Only you can see this — e.g. owner\'s name, agreement, reminders" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;">' + wdnEsc(b.notes || '') + '</textarea>' +
            '<button data-id="' + eid + '" onclick="wdnSaveNotes(this.dataset.id)" style="margin-top:6px; padding:6px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc;">Save note</button>') +
        '<div style="border-top:1px solid #e2e8f0; padding-top:12px; display:flex; gap:6px; flex-wrap:wrap;">' +
        act('pay', '✔ Record payment', 'background:#dcfce7; border-color:#86efac; color:#166534;') + act('remind', '📲 Remind', 'background:#fffbeb; border-color:#fde68a; color:#92400e;') +
        act('plan', '✏ Billing') + act('history', '🧾 History') + act('lock', st.status === 'suspended' ? '🔓 Unlock' : '🔒 Lock', st.status === 'suspended' ? '' : 'color:#991b1b;') + act('delete', '🗑 Delete', 'color:#991b1b;') + '</div>';

    wdnModal(st.name || st.id, html);
    wdnFillSlowParts(id, lim);
}

// Slow parts fill in one by one; a failure in one never affects the others
function wdnFillSlowParts(id, lim) {
    const put = function (elId, html) {
        if (wdnDetailId !== id) return;
        const el = document.getElementById(elId);
        if (el) { el.innerHTML = html; el.style.color = ''; }
    };
    const retryBtn = '<button data-id="' + wdnEsc(id) + '" onclick="wdnOpenDetail(this.dataset.id)" style="padding:3px 8px; font-size:11px; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc;">Retry</button>';

    wdnWithTimeout(wdnCountProducts(id), 25000)
        .then(function (n) { put('wdn-slow-products', wdnMeterValue(n, lim.maxProducts)); })
        .catch(function () { put('wdn-slow-products', '? ' + retryBtn); });

    wdnWithTimeout(wdnShallow('stores/' + id + '/customers'), 25000)
        .then(function (keys) { put('wdn-slow-customers', String(keys.length)); })
        .catch(function () { put('wdn-slow-customers', '?'); });

    const cached = typeof wdtUsage !== 'undefined' ? wdtUsage[id] : null;
    if (cached) { put('wdn-slow-usage', wdnUsageHtml(cached)); return; }
    if (typeof wdtFetchUsage !== 'function') { put('wdn-slow-usage', ''); return; }
    wdnWithTimeout(wdtFetchUsage(id), 40000)
        .then(function (u) { if (typeof wdtUsage !== 'undefined') wdtUsage[id] = u; put('wdn-slow-usage', wdnUsageHtml(u)); })
        .catch(function () { put('wdn-slow-usage', 'Couldn\'t load this month\'s sales (the store has a lot of data or the connection is slow). ' + retryBtn); });
}

function wdnAct(action, id) {
    wdnCloseModal();
    if (typeof wdsAct === 'function') wdsAct(action, { dataset: { id: id } });
}

async function wdnSaveNotes(id) {
    const notes = document.getElementById('wdn-detail-notes').value.trim();
    try {
        await firebase.database().ref('billing/' + id + '/notes').set(notes || null);
        if (typeof wdsReload === 'function') await wdsReload();
        alert("Note saved.");
    } catch (e) { alert("Failed: " + e.message); }
}

// Reset a staff member's login PIN (stores that haven't moved to protected logins yet).
// Existing PINs are never shown — you can only set a new one.
async function wdnResetStaffPin(btn) {
    const storeId = btn.dataset.store, key = btn.dataset.key, name = btn.dataset.name;
    const entered = prompt('Set a new PIN for ' + (name || 'this staff member') + ' (at least 4 characters):');
    if (entered === null) return;
    const pin = entered.trim();
    if (pin.length < 4) { alert("PIN must be at least 4 characters. Nothing was changed."); return; }
    try {
        await firebase.database().ref('stores/' + storeId + '/staff/' + key).update({ pin: pin });
        alert('New PIN saved for ' + (name || 'this staff member') + '. Tell them their new PIN.');
    } catch (e) { alert("Failed: " + e.message); }
}

// =====================================================================
// STORE SIDE — enforce the plan's limits
// =====================================================================
function wdnSupportLink(what) {
    return 'https://wa.me/' + WDN_SUPPORT_WA + '?text=' + encodeURIComponent('Hello, I want to upgrade my Wise Decision plan so I can add more ' + what + '. Store ID: ' + (currentStoreId || '') + (wdnLimits && wdnLimits.name ? ' (current plan: ' + wdnLimits.name + ')' : ''));
}
function wdnBlock(what, count, max) {
    if (confirm(wdnLimitMessage(what, count, max, wdnLimits) + '\n\nTap OK to message Wise Decision on WhatsApp about upgrading.')) window.open(wdnSupportLink(what), '_blank');
}

function wdnWrap(name, factory) {
    const cur = window[name];
    if (typeof cur !== 'function' || cur.__wdn) return;
    const wrapped = factory(cur);
    wrapped.__wdn = true;
    window[name] = wrapped;
}

function wdnInstallEnforcement() {
    wdnWrap('saveBranch', function (prev) {
        return function () {
            if (wdnLimits && wdnNum(wdnLimits.maxBranches) > 0 && currentUserRole === 'Admin' && !document.getElementById('edit-branch-id').value) {
                const n = Object.keys(branchesCache).length;
                if (wdnLimitReached(n, wdnLimits.maxBranches)) { wdnBlock('branches', n, wdnLimits.maxBranches); return; }
            }
            return prev.apply(this, arguments);
        };
    });

    wdnWrap('addStaffMember', function (prev) {
        return async function () {
            const self = this, args = arguments;
            if (wdnLimits && wdnNum(wdnLimits.maxStaff) > 0 && currentUserRole === 'Admin') {
                let n = null;
                try {
                    const snap = await wdnWithTimeout(firebase.database().ref('stores/' + currentStoreId + '/staff').once('value'), 6000);
                    n = 0; snap.forEach(function () { n++; });
                } catch (e) { n = null; }              // can't check right now — don't get in the way of work
                if (n !== null && wdnLimitReached(n, wdnLimits.maxStaff)) { wdnBlock('staff members', n, wdnLimits.maxStaff); return; }
            }
            return prev.apply(self, args);
        };
    });

    wdnWrap('saveProduct', function (prev) {
        return async function () {
            const self = this, args = arguments;
            const editing = document.getElementById('edit-product-id') && document.getElementById('edit-product-id').value;
            if (!editing && wdnLimits && wdnNum(wdnLimits.maxProducts) > 0) {
                let n = null;
                try { n = await wdnWithTimeout(wdnCountProducts(currentStoreId), 6000); } catch (e) { n = null; }
                if (n !== null && wdnLimitReached(n, wdnLimits.maxProducts)) { wdnBlock('products', n, wdnLimits.maxProducts); return; }
            }
            return prev.apply(self, args);
        };
    });
}

function wdnLoadLimits() {
    if (!currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
    const sid = currentStoreId;
    try { const c = JSON.parse(localStorage.getItem('wd_limits_' + sid) || 'null'); if (c && typeof c === 'object') wdnLimits = c; } catch (e) {}
    try {
        firebase.database().ref('stores/' + sid + '/planLimits').on('value', function (snap) {
            if (sid !== currentStoreId) return;
            wdnLimits = snap.val() || null;
            try { if (wdnLimits) localStorage.setItem('wd_limits_' + sid, JSON.stringify(wdnLimits)); else localStorage.removeItem('wd_limits_' + sid); } catch (e) {}
            wdnShowPlanCard();
        }, function () { /* offline: keep the remembered limits */ });
    } catch (e) { /* no limits */ }
}

// "Your plan" card in Business Settings (Admin)
async function wdnShowPlanCard() {
    if (currentUserRole !== 'Admin') return;
    const ws = document.getElementById('workspace-content');
    if (!ws || !document.getElementById('settings-store-name')) return;
    let card = document.getElementById('wdn-plan-card');
    if (!wdnLimits) { if (card) card.style.display = 'none'; return; }
    if (!card) {
        card = document.createElement('div');
        card.id = 'wdn-plan-card';
        card.style.cssText = 'max-width:600px; margin:20px 0; padding:25px; background:#ffffff; border-radius:8px; border:1px solid #e2e8f0; box-shadow:0 4px 6px rgba(0,0,0,0.02);';
        ws.appendChild(card);
    }
    card.style.display = '';
    const sid = currentStoreId, L = wdnLimits;
    const draw = function (branches, staff, products) {
        const line = function (label, n, max) {
            const over = wdnLimitReached(n, max);
            return '<div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px dashed #e2e8f0;"><span>' + label + '</span><span><strong style="color:' + (over ? '#b91c1c' : '#0f172a') + ';">' + (n === null ? '…' : n) + '</strong> of ' + wdnUnl(max) + (over ? ' ⚠' : '') + '</span></div>';
        };
        card.innerHTML = '<h3 style="margin-top:0; margin-bottom:14px; color:#1e293b; border-bottom:2px solid #f1f5f9; padding-bottom:10px; font-size:16px;">📋 Your plan: ' + wdnEsc(L.name || '') + '</h3>' +
            line('Branches', branches, L.maxBranches) + line('Staff', staff, L.maxStaff) + line('Products', products, L.maxProducts) +
            '<a href="' + wdnSupportLink('branches, staff or products') + '" target="_blank" style="display:block; text-align:center; margin-top:14px; padding:10px; border-radius:6px; background:#dcfce7; border:1px solid #86efac; color:#166534; font-weight:bold; text-decoration:none;">💬 Upgrade on WhatsApp</a>';
    };
    draw(Object.keys(branchesCache || {}).length, null, null);
    let staffN = null, prodN = null;
    try { const snap = await wdnWithTimeout(firebase.database().ref('stores/' + sid + '/staff').once('value'), 6000); staffN = 0; snap.forEach(function () { staffN++; }); } catch (e) {}
    draw(Object.keys(branchesCache || {}).length, staffN, null);
    try { prodN = await wdnWithTimeout(wdnCountProducts(sid), 8000); } catch (e) {}
    if (sid === currentStoreId && wdnLimits === L) draw(Object.keys(branchesCache || {}).length, staffN, prodN);
}

(function hookNavigation() {
    const prev = window.switchView;
    if (typeof prev !== 'function') return;
    window.switchView = function (viewId) {
        const r = prev.apply(this, arguments);
        try {
            if (viewId === 'login-view') { wdnLoadedFor = null; wdnLimits = null; }
            else if (currentStoreId && currentStoreId !== 'SUPER_ADMIN' && viewId !== 'register-view') {
                if (wdnLoadedFor !== currentStoreId) { wdnLoadedFor = currentStoreId; wdnLoadLimits(); }
                if (viewId === 'settings-view') wdnShowPlanCard();
            }
        } catch (e) { /* never block navigation */ }
        return r;
    };
})();

// =====================================================================
// Hooks into the Super Admin screen (added by a timer so load order doesn't matter)
// =====================================================================
function wdnAttach() {
    wdnInstallEnforcement();
    if (currentUserRole !== 'SuperAdmin') return;

    // Plans button in the toolbar
    const bar = document.getElementById('wds-extra-toolbar');
    if (bar && !document.getElementById('wdn-btn-plans')) {
        const b = document.createElement('button');
        b.id = 'wdn-btn-plans';
        b.className = 'menu-btn';
        b.style.cssText = 'width:auto; margin:0; padding:8px 12px; font-size:12px; background:#ecfeff; border:1px solid #a5f3fc; color:#0e7490;';
        b.textContent = '📋 Plans';
        b.onclick = wdnOpenPlans;
        bar.appendChild(b);
    }

    // Extra line + "Details" button on every store card (chained onto the existing card hook)
    const cur = window.wdsExtraCardHtml;
    if (typeof cur === 'function' ? !cur.__wdn : true) {
        const prev = typeof cur === 'function' ? cur : function () { return ''; };
        const wrapped = function (st) {
            const base = prev(st) || '';
            const planId = st.billing && st.billing.plan;
            const plan = planId && wdnPlans[planId] ? wdnPlans[planId] : null;
            const planLine = plan ? '<br><span style="color:#0e7490;">📋 ' + wdnEsc(plan.name) + ' plan · ' + wdnPlanText(plan) + '</span>' : (planId ? '<br><span style="color:#0e7490;">📋 ' + wdnEsc(planId) + ' plan</span>' : '');
            return base + planLine + '<br><button data-id="' + wdnEsc(st.id) + '" onclick="wdnOpenDetail(this.dataset.id)" style="margin-top:6px; padding:5px 12px; font-size:11px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #bae6fd; background:#f0f9ff; color:#0369a1;">👁 Details</button>';
        };
        wrapped.__wdn = true;
        window.wdsExtraCardHtml = wrapped;
    }
    if (!wdnAttach.loadedPlans) { wdnAttach.loadedPlans = true; wdnLoadPlans().then(function () { if (typeof wdsRender === 'function') wdsRender(); }).catch(function () { wdnAttach.loadedPlans = false; }); }
}
setInterval(function () { try { wdnAttach(); } catch (e) { console.warn(e); } }, 1200);
