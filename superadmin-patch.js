e// ==================== WISE DECISION SUPER ADMIN PATCH (v26) ====================
// Load LAST (after script.js and the other patches), with `defer`.
//
// Replaces the Super Admin store list with a subscription dashboard:
//   * Summary: stores, active, overdue, due soon, monthly income, collected this month
//   * One card per store with due date, days left/overdue, fee, last paid, last active
//   * Record payment (extends the due date, keeps a payment history, offers to unlock)
//   * WhatsApp reminders with your bank details filled in
//   * "Lock overdue stores" in one tap (after a grace period you choose)
//   * Loads only store names/status instead of downloading every store's whole database
//
// Billing data is stored under `billing/<storeId>` (NOT inside the store), so store
// staff have no reason to see it, and `billingSettings` holds your bank details.

console.log("Wise Decision superadmin-patch.js — v27 loaded");

const WDS_DEFAULT_SETTINGS = {
    bankName: 'MONIEPOINT',
    accountNumber: '9168140710',
    accountName: 'EMMANUEL AYOOOLA FISUYI',
    defaultFee: 0,
    graceDays: 3,
    dueSoonDays: 7
};

// ---------- State ----------
let wdsStores = [];
let wdsSettings = Object.assign({}, WDS_DEFAULT_SETTINGS);
let wdsFilter = 'all';
let wdsSearch = '';
let wdsModalStoreId = null;

// ---------- Helpers ----------
function wdsNum(n) { return Number(n) || 0; }
function wdsEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdsMoney(n) { return '₦' + (Math.round(wdsNum(n) * 100) / 100).toLocaleString(); }
function wdsPad(n) { return String(n).padStart(2, '0'); }
function wdsTodayStr(d) { d = d || new Date(); return `${d.getFullYear()}-${wdsPad(d.getMonth() + 1)}-${wdsPad(d.getDate())}`; }
function wdsParse(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function wdsDaysBetween(fromStr, toStr) { return Math.round((wdsParse(toStr) - wdsParse(fromStr)) / 86400000); }
function wdsAddMonths(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1 + n, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return `${first.getUTCFullYear()}-${wdsPad(first.getUTCMonth() + 1)}-${wdsPad(Math.min(d, lastDay))}`;
}
function wdsPrettyDate(s) {
    if (!s) return '—';
    const t = new Date(wdsParse(s));
    return t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function wdsAgo(iso) {
    if (!iso) return 'never';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (isNaN(days)) return 'never';
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
}
function wdsWaNumber(phone) {
    let p = String(phone || '').replace(/[^\d+]/g, '');
    if (!p) return '';
    if (p.charAt(0) === '+') p = p.slice(1);
    else if (p.indexOf('00') === 0) p = p.slice(2);
    else if (p.charAt(0) === '0') p = '234' + p.slice(1);
    else if (/^\d{10}$/.test(p)) p = '234' + p;
    return p;
}
function wdsValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim()); }

// ---------- Billing logic (pure, tested) ----------
function wdsBillingState(billing, todayStr, settings) {
    if (!billing || !billing.dueDate) return { state: 'none' };
    const days = wdsDaysBetween(todayStr, billing.dueDate);      // positive = still in the future
    if (days < 0) return { state: 'overdue', days, overdueBy: -days, pastGrace: -days > wdsNum(settings.graceDays) };
    if (days <= wdsNum(settings.dueSoonDays)) return { state: 'due-soon', days };
    return { state: 'ok', days };
}

// Paying early keeps the days already paid for; paying late starts counting from today.
function wdsNextDueDate(currentDue, todayStr, months) {
    const base = (currentDue && wdsDaysBetween(todayStr, currentDue) >= 0) ? currentDue : todayStr;
    return wdsAddMonths(base, months);
}

function wdsPaymentsOf(billing) {
    const p = (billing && billing.payments) || {};
    return Object.keys(p).map(k => Object.assign({ key: k }, p[k])).sort((a, b) => String(b.at || b.paidDate).localeCompare(String(a.at || a.paidDate)));
}

function wdsSummarize(stores, todayStr, settings) {
    const monthPrefix = todayStr.slice(0, 7);
    const s = { total: stores.length, active: 0, suspended: 0, overdue: 0, overdueAmount: 0, dueSoon: 0, none: 0, trials: 0, monthlyIncome: 0, collected: 0 };
    stores.forEach(st => {
        const suspended = st.status === 'suspended';
        if (suspended) s.suspended++; else s.active++;
        const b = wdsBillingState(st.billing, todayStr, settings);
        if (b.state === 'none') s.none++;
        if (b.state === 'overdue') { s.overdue++; s.overdueAmount += wdsNum(st.billing.monthlyFee); }
        if (b.state === 'due-soon') s.dueSoon++;
        if (st.billing && st.billing.trial) s.trials++;
        if (!suspended && st.billing && !st.billing.trial) s.monthlyIncome += wdsNum(st.billing.monthlyFee);   // trials don't pay yet
        wdsPaymentsOf(st.billing).forEach(p => { if (String(p.paidDate || '').slice(0, 7) === monthPrefix) s.collected += wdsNum(p.amount); });
    });
    return s;
}

function wdsSortStores(stores, todayStr, settings) {
    const rank = { overdue: 0, 'due-soon': 1, ok: 2, none: 3 };
    return stores.slice().sort((a, b) => {
        const A = wdsBillingState(a.billing, todayStr, settings), B = wdsBillingState(b.billing, todayStr, settings);
        if (rank[A.state] !== rank[B.state]) return rank[A.state] - rank[B.state];
        if (A.days !== undefined && B.days !== undefined && A.days !== B.days) return A.days - B.days;
        return String(a.name || a.id).localeCompare(String(b.name || b.id));
    });
}

function wdsReminderMessage(store, st, settings) {
    const fee = wdsNum(store.billing && store.billing.monthlyFee);
    const feeText = fee ? ` of ${wdsMoney(fee)}` : '';
    const bank = `Bank: ${settings.bankName}\nAccount Number: ${settings.accountNumber}\nAccount Name: ${settings.accountName}`;
    const name = store.name || store.id;
    const onTrial = !!(store.billing && store.billing.trial);
    let intro;
    if (onTrial && store.status !== 'suspended' && st.state !== 'overdue') {
        intro = `Your free trial of Wise Decision ends on ${wdsPrettyDate(store.billing.dueDate)}${st.state === 'due-soon' ? (st.days === 0 ? ' (today)' : ` (${st.days} day${st.days === 1 ? '' : 's'} left)`) : ''}. To keep using your store after the trial, the monthly subscription${feeText} applies. Please pay before then so nothing is interrupted.`;
    } else if (onTrial && st.state === 'overdue') {
        intro = `Your free trial of Wise Decision ended on ${wdsPrettyDate(store.billing.dueDate)}. To continue using your store, please pay the monthly subscription${feeText}.`;
    } else if (store.status === 'suspended') {
        intro = `Your Wise Decision account is currently locked because the monthly subscription${feeText} has not been paid. Pay to restore access immediately.`;
    } else if (st.state === 'overdue') {
        intro = `Your Wise Decision monthly subscription${feeText} was due on ${wdsPrettyDate(store.billing.dueDate)} and is now ${st.overdueBy} day${st.overdueBy === 1 ? '' : 's'} overdue. To avoid your account being locked, please pay as soon as possible.`;
    } else if (st.state === 'due-soon') {
        intro = `Your Wise Decision monthly subscription${feeText} is due on ${wdsPrettyDate(store.billing.dueDate)}${st.days === 0 ? ' (today)' : ` (${st.days} day${st.days === 1 ? '' : 's'} left)`}. To keep your store running without interruption, please pay before then.`;
    } else {
        intro = `This is a reminder about your Wise Decision monthly subscription${feeText}. Kindly keep your payment up to date so your store stays active.`;
    }
    return `Hello ${name}, this is Wise Decision support.\n\n${intro}\n\n${bank}\n\nStore ID: ${store.id}\nPlease send proof of payment after paying. Thank you!`;
}

// ---------- Store list: names/status only (not every store's whole database) ----------
async function wdsListStoreIds() {
    try {
        let url = `${firebase.app().options.databaseURL}/stores.json?shallow=true`;
        try {
            const u = firebase.auth && firebase.auth().currentUser;
            if (u) url += '&auth=' + encodeURIComponent(await u.getIdToken());
        } catch (e) { /* not signed in with Firebase Auth */ }
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json();
        return j ? Object.keys(j) : [];
    } catch (e) {
        console.warn("Shallow store list failed, using the full read instead:", e.message);
        const snap = await firebase.database().ref('stores').once('value');
        const ids = [];
        snap.forEach(c => ids.push(c.key));
        return ids;
    }
}

// ---------- Screen ----------
function wdsModal(title, html) {
    let m = document.getElementById('wds-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wds-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1300; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = `<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:480px; max-height:92vh; overflow-y:auto; padding:18px; box-sizing:border-box;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">
            <h3 style="margin:0; font-size:17px;">${wdsEsc(title)}</h3>
            <button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdsCloseModal()">✕</button>
        </div>${html}</div>`;
    m.style.display = 'flex';
}
function wdsCloseModal() { const m = document.getElementById('wds-modal'); if (m) m.style.display = 'none'; }

function wdsEnsureLayout() {
    if (document.getElementById('wds-root')) return;
    const tbody = document.getElementById('super-admin-stores-body');
    const table = tbody && tbody.closest('table');
    if (!table) return;
    const scroller = table.parentElement;          // the scrolling box around the old table
    scroller.style.display = 'none';
    const root = document.createElement('div');
    root.id = 'wds-root';
    scroller.parentElement.appendChild(root);
    root.innerHTML = `
        <div id="wds-summary"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:12px 0;">
            <input id="wds-search" type="text" placeholder="🔍 Search stores..." oninput="wdsSetSearch(this.value)" style="flex:1; min-width:140px; padding:9px; border:1px solid #cbd5e1; border-radius:8px;">
            <button class="menu-btn" style="width:auto; margin:0; padding:8px 12px; font-size:12px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdsLockOverdue()">🔒 Lock overdue</button>
            <button class="menu-btn" style="width:auto; margin:0; padding:8px 12px; font-size:12px; background:#fffbeb; border:1px solid #fde68a; color:#92400e;" onclick="wdsOpenReminders()">📢 Reminders</button>
            <button class="menu-btn" style="width:auto; margin:0; padding:8px 12px; font-size:12px; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdsOpenSettings()">⚙ Billing settings</button>
        </div>
        <div id="wds-chips" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;"></div>
        <div id="wds-list"></div>`;
}

function loadSuperAdminDashboard() {
    wdsEnsureLayout();
    wdsReload();
}

async function wdsReload() {
    const list = document.getElementById('wds-list');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center; color:#64748b; padding:30px;">Loading stores...</div>';

    try {
        const [ids, billingSnap, settingsSnap] = await Promise.all([
            wdsListStoreIds(),
            firebase.database().ref('billing').once('value'),
            firebase.database().ref('billingSettings').once('value')
        ]);
        wdsSettings = Object.assign({}, WDS_DEFAULT_SETTINGS, settingsSnap.val() || {});
        const billing = billingSnap.val() || {};

        wdsStores = await Promise.all(ids.map(async id => {
            const ref = firebase.database().ref('stores/' + id);
            const [n, p, s, c, l] = await Promise.all(['businessName', 'phone', 'status', 'createdAt', 'lastActiveAt'].map(f => ref.child(f).once('value')));
            return { id, name: n.val() || '', phone: p.val() || '', status: s.val() || 'active', createdAt: c.val(), lastActiveAt: l.val(), billing: billing[id] || null };
        }));
        wdsRender();
    } catch (e) {
        list.innerHTML = `<div style="color:#b91c1c; padding:16px;">Could not load stores: ${wdsEsc(e.message)}</div>`;
    }
}

function wdsSetSearch(v) { wdsSearch = String(v || '').toLowerCase().trim(); wdsRenderList(); }
function wdsSetFilter(f) { wdsFilter = f; wdsRender(); }

function wdsMatchesFilter(st, b) {
    if (wdsFilter === 'all') return true;
    if (wdsFilter === 'suspended') return st.status === 'suspended';
    if (wdsFilter === 'overdue') return b.state === 'overdue';
    if (wdsFilter === 'due-soon') return b.state === 'due-soon';
    if (wdsFilter === 'none') return b.state === 'none';
    if (wdsFilter === 'trial') return !!(st.billing && st.billing.trial);
    return true;
}

function wdsRender() {
    const today = wdsTodayStr();
    const sum = wdsSummarize(wdsStores, today, wdsSettings);

    const card = (label, value, color, sub) => `<div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid ${color}; border-radius:8px; padding:10px;">
        <div style="font-size:10px; font-weight:bold; text-transform:uppercase; color:#64748b;">${label}</div>
        <div style="font-size:19px; font-weight:800; color:#0f172a;">${value}</div>${sub ? `<div style="font-size:11px; color:#64748b;">${sub}</div>` : ''}</div>`;
    const el = document.getElementById('wds-summary');
    if (el) el.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px;">
        ${card('Stores', sum.total, '#0284c7', `${sum.active} active · ${sum.suspended} locked · ${sum.trials} on trial`)}
        ${card('Overdue', sum.overdue, '#dc2626', sum.overdue ? `${wdsMoney(sum.overdueAmount)} owed` : 'All good')}
        ${card('Due in ' + wdsSettings.dueSoonDays + ' days', sum.dueSoon, '#d97706', '')}
        ${card('Monthly income', wdsMoney(sum.monthlyIncome), '#16a34a', 'from active stores')}
        ${card('Collected this month', wdsMoney(sum.collected), '#7c3aed', '')}
    </div>`;

    const counts = { all: wdsStores.length, overdue: sum.overdue, 'due-soon': sum.dueSoon, trial: sum.trials, suspended: sum.suspended, none: sum.none };
    const labels = { all: 'All', overdue: 'Overdue', 'due-soon': 'Due soon', trial: 'On trial', suspended: 'Locked', none: 'No billing set' };
    const chips = document.getElementById('wds-chips');
    if (chips) chips.innerHTML = Object.keys(labels).map(k => `<button onclick="wdsSetFilter('${k}')" style="padding:6px 12px; border-radius:16px; font-size:12px; font-weight:bold; cursor:pointer; border:1px solid ${wdsFilter === k ? '#0284c7' : '#cbd5e1'}; background:${wdsFilter === k ? '#0284c7' : '#fff'}; color:${wdsFilter === k ? '#fff' : '#334155'};">${labels[k]} (${counts[k]})</button>`).join('');

    wdsRenderList();
}

function wdsRenderList() {
    const list = document.getElementById('wds-list');
    if (!list) return;
    const today = wdsTodayStr();

    const rows = wdsSortStores(wdsStores, today, wdsSettings).filter(st => {
        const b = wdsBillingState(st.billing, today, wdsSettings);
        if (!wdsMatchesFilter(st, b)) return false;
        if (!wdsSearch) return true;
        return (st.name + ' ' + st.id + ' ' + st.phone).toLowerCase().indexOf(wdsSearch) !== -1;
    });

    if (rows.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:#64748b; padding:24px;">No stores match.</div>';
        return;
    }

    list.innerHTML = rows.map(st => {
        const b = wdsBillingState(st.billing, today, wdsSettings);
        const locked = st.status === 'suspended';
        const color = locked ? '#475569' : ({ overdue: '#dc2626', 'due-soon': '#d97706', ok: '#16a34a', none: '#94a3b8' })[b.state];

        let dueLine;
        if (b.state === 'none') dueLine = '<span style="color:#64748b;">No billing set up yet</span>';
        else if (b.state === 'overdue') dueLine = `<strong style="color:#dc2626;">${onTrial ? 'Trial ended' : 'Overdue by'} ${b.overdueBy} day${b.overdueBy === 1 ? '' : 's'}${onTrial ? ' ago' : ''}</strong> · ${onTrial ? 'trial ended' : 'was due'} ${wdsPrettyDate(st.billing.dueDate)}`;
        else dueLine = `${onTrial ? 'Trial ends' : 'Due'} <strong>${wdsPrettyDate(st.billing.dueDate)}</strong> · ${b.days === 0 ? 'today' : `in ${b.days} day${b.days === 1 ? '' : 's'}`}`;

        const fee = st.billing ? `${wdsMoney(st.billing.monthlyFee)}/month` : '';
        const lastPaid = st.billing && st.billing.lastPaidDate ? ` · last paid ${wdsPrettyDate(st.billing.lastPaidDate)} (${wdsMoney(st.billing.lastPaidAmount)})` : '';
        const onTrial = !!(st.billing && st.billing.trial);
        const badge = (locked ? '<span style="background:#e2e8f0; color:#334155; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">LOCKED</span> ' : '') + (onTrial ? '<span style="background:#ede9fe; color:#6d28d9; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">FREE TRIAL</span>' : '');
        const id = wdsEsc(st.id);
        const btn = (act, label, style) => `<button data-id="${id}" onclick="wdsAct('${act}', this)" style="padding:6px 10px; font-size:11px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc; color:#334155; ${style || ''}">${label}</button>`;

        return `<div style="border:1px solid #e2e8f0; border-left:5px solid ${color}; border-radius:8px; padding:12px; margin-bottom:10px; background:#fff;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                <div><strong style="font-size:15px;">${wdsEsc(st.name || 'Unnamed')}</strong> ${badge}<br><small style="color:#64748b;">${id}${st.phone ? ' · ' + wdsEsc(st.phone) : ''}</small></div>
                <div style="text-align:right; font-size:12px; color:#334155;">${fee}</div>
            </div>
            <div style="font-size:12px; margin:6px 0; color:#334155;">${dueLine}${lastPaid}<br><span style="color:#94a3b8;">Last active: ${wdsAgo(st.lastActiveAt)}</span>${st.billing && st.billing.notes ? `<br><em style="color:#64748b;">📝 ${wdsEsc(st.billing.notes)}</em>` : ''}</div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${btn('pay', '✔ Record payment', 'background:#dcfce7; border-color:#86efac; color:#166534;')}
                ${btn('remind', '📲 Remind', 'background:#fffbeb; border-color:#fde68a; color:#92400e;')}
                ${btn('plan', st.billing ? '✏ Edit plan' : '➕ Set up billing')}
                ${btn('history', '🧾 History')}
                ${btn('lock', locked ? '🔓 Unlock' : '🔒 Lock', locked ? '' : 'color:#991b1b;')}
                ${btn('pin', '🔑 PIN')}
                ${btn('delete', '🗑', 'color:#991b1b;')}
            </div></div>`;
    }).join('');
}

// ---------- Actions ----------
function wdsFind(id) { return wdsStores.find(s => s.id === id); }

function wdsAct(action, el) {
    const id = el.dataset.id;
    const st = wdsFind(id);
    if (!st) return;
    wdsModalStoreId = id;
    if (action === 'pay') wdsOpenPayment(st);
    else if (action === 'plan') wdsOpenPlan(st);
    else if (action === 'history') wdsOpenHistory(st);
    else if (action === 'remind') wdsSendReminder(id);
    else if (action === 'lock') wdsToggleLock(st);
    else if (action === 'pin') wdsRunAndRefresh(() => promptChangeStorePassword(id));
    else if (action === 'delete') wdsRunAndRefresh(() => deleteBusinessAccount(id), id);
}

// The older buttons (PIN reset, delete) live in script.js / the auth patch and finish on their own;
// reload the list afterwards, and tidy up billing data if the store is gone.
function wdsRunAndRefresh(fn, deletedId) {
    Promise.resolve().then(fn).catch(e => console.warn(e)).then(() => {
        setTimeout(wdsReload, 1200);
        setTimeout(async () => {
            if (deletedId) {
                try {
                    const gone = !(await firebase.database().ref(`stores/${deletedId}/businessName`).once('value')).exists();
                    if (gone) await firebase.database().ref(`billing/${deletedId}`).remove();
                } catch (e) { console.warn(e); }
            }
            wdsReload();
        }, 4000);
    });
}

async function wdsToggleLock(st) {
    const locking = st.status !== 'suspended';
    if (!confirm(`${locking ? 'Lock' : 'Unlock'} ${st.name || st.id}?${locking ? '\n\nTheir staff will not be able to log in until you unlock it.' : ''}`)) return;
    try {
        await firebase.database().ref(`stores/${st.id}`).update({ status: locking ? 'suspended' : 'active' });
        await wdsReload();
    } catch (e) { alert("Failed: " + e.message); }
}

// ----- Plan -----
function wdsOpenPlan(st) {
    const b = st.billing || {};
    const suggestedDue = b.dueDate || wdsAddMonths(wdsTodayStr(), 1);
    wdsModal(`${st.billing ? 'Edit' : 'Set up'} billing — ${st.name || st.id}`, `
        <label style="font-size:12px; font-weight:bold;">Monthly fee (₦)</label>
        <input id="wds-plan-fee" type="number" min="0" value="${wdsNum(b.monthlyFee) || wdsNum(wdsSettings.defaultFee) || ''}" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px; box-sizing:border-box;">
        <label style="font-size:12px; font-weight:bold;">Next payment due date</label>
        <input id="wds-plan-due" type="date" value="${wdsEsc(suggestedDue)}" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px; box-sizing:border-box;">
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; margin:0 0 10px;"><input id="wds-plan-trial" type="checkbox" ${b.trial ? 'checked' : ''}> This store is on a free trial (the due date is when the trial ends)</label>
        <label style="font-size:12px; font-weight:bold;">Note (optional)</label>
        <textarea id="wds-plan-notes" rows="2" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 12px; box-sizing:border-box;">${wdsEsc(b.notes || '')}</textarea>
        <button class="menu-btn btn-action-primary" style="justify-content:center;" onclick="wdsSavePlan()">Save</button>`);
}

async function wdsSavePlan() {
    const id = wdsModalStoreId;
    const fee = parseFloat(document.getElementById('wds-plan-fee').value);
    const due = document.getElementById('wds-plan-due').value;
    const notes = document.getElementById('wds-plan-notes').value.trim();
    if (isNaN(fee) || fee < 0) { alert("Enter the monthly fee (0 or more)."); return; }
    if (!wdsValidDate(due)) { alert("Pick a valid due date."); return; }
    try {
        const trial = document.getElementById('wds-plan-trial').checked;
        await firebase.database().ref(`billing/${id}`).update({ monthlyFee: fee, dueDate: due, notes, trial: trial ? true : null });
        wdsCloseModal();
        await wdsReload();
    } catch (e) { alert("Failed to save: " + e.message); }
}

// ----- Payment -----
function wdsOpenPayment(st) {
    const b = st.billing || {};
    wdsModal(`Record payment — ${st.name || st.id}`, `
        ${st.billing && st.billing.trial ? '<div style="background:#ede9fe; border:1px solid #ddd6fe; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">This store is on a free trial — recording a payment ends the trial and starts paid billing.</div>' : ''}
        ${st.billing ? '' : '<div style="background:#fffbeb; border:1px solid #fde68a; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">No billing set up yet — this payment will start it.</div>'}
        <label style="font-size:12px; font-weight:bold;">Amount received (₦)</label>
        <input id="wds-pay-amount" type="number" min="0" value="${wdsNum(b.monthlyFee) || wdsNum(wdsSettings.defaultFee) || ''}" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px; box-sizing:border-box;">
        <label style="font-size:12px; font-weight:bold;">Months paid for</label>
        <select id="wds-pay-months" onchange="wdsUpdatePayPreview()" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px;">
            ${[1, 2, 3, 6, 12].map(m => `<option value="${m}">${m} month${m === 1 ? '' : 's'}</option>`).join('')}
        </select>
        <label style="font-size:12px; font-weight:bold;">Paid by</label>
        <select id="wds-pay-method" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px;"><option>Transfer</option><option>Cash</option><option>POS</option></select>
        <label style="font-size:12px; font-weight:bold;">Note (optional)</label>
        <input id="wds-pay-note" type="text" placeholder="e.g. reference / sender name" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px; box-sizing:border-box;">
        <div id="wds-pay-preview" style="background:#f0fdf4; border:1px solid #bbf7d0; padding:8px; border-radius:6px; font-size:13px; margin-bottom:12px;"></div>
        <button class="menu-btn btn-action-primary" style="justify-content:center; background:#16a34a;" onclick="wdsSavePayment()">Save payment</button>`);
    wdsUpdatePayPreview();
}

function wdsUpdatePayPreview() {
    const st = wdsFind(wdsModalStoreId);
    const el = document.getElementById('wds-pay-preview');
    if (!st || !el) return;
    const months = parseInt(document.getElementById('wds-pay-months').value) || 1;
    const next = wdsNextDueDate(st.billing && st.billing.dueDate, wdsTodayStr(), months);
    el.innerHTML = `New due date will be <strong>${wdsPrettyDate(next)}</strong>`;
}

async function wdsSavePayment() {
    const id = wdsModalStoreId;
    const st = wdsFind(id);
    if (!st) return;
    const amount = parseFloat(document.getElementById('wds-pay-amount').value);
    const months = parseInt(document.getElementById('wds-pay-months').value) || 1;
    const method = document.getElementById('wds-pay-method').value;
    const note = document.getElementById('wds-pay-note').value.trim();
    if (isNaN(amount) || amount <= 0) { alert("Enter the amount received."); return; }

    const today = wdsTodayStr();
    const dueBefore = st.billing && st.billing.dueDate ? st.billing.dueDate : null;
    const dueAfter = wdsNextDueDate(dueBefore, today, months);
    const key = firebase.database().ref(`billing/${id}/payments`).push().key;

    const updates = {
        [`billing/${id}/dueDate`]: dueAfter,
        [`billing/${id}/lastPaidDate`]: today,
        [`billing/${id}/lastPaidAmount`]: amount,
        [`billing/${id}/trial`]: null,          // first payment ends any free trial
        [`billing/${id}/payments/${key}`]: { amount, months, method, note, paidDate: today, at: new Date().toISOString(), dueBefore, dueAfter, recordedBy: 'Super Admin' }
    };
    if (!(st.billing && st.billing.monthlyFee)) updates[`billing/${id}/monthlyFee`] = Math.round((amount / months) * 100) / 100;

    try {
        await firebase.database().ref().update(updates);
        wdsCloseModal();
        if (st.status === 'suspended' && confirm(`Payment saved. ${st.name || st.id} is locked — unlock it now?`)) {
            await firebase.database().ref(`stores/${id}`).update({ status: 'active' });
        }
        await wdsReload();
        alert(`Payment saved. Next due date: ${wdsPrettyDate(dueAfter)}.`);
    } catch (e) { alert("Failed to save payment: " + e.message); }
}

// ----- History -----
function wdsOpenHistory(st) {
    const pays = wdsPaymentsOf(st.billing);
    const total = pays.reduce((s, p) => s + wdsNum(p.amount), 0);
    const rows = pays.length === 0
        ? '<div style="text-align:center; color:#64748b; padding:16px;">No payments recorded yet.</div>'
        : `<table style="width:100%; font-size:12px; border-collapse:collapse;">
            <thead><tr style="text-align:left; color:#64748b;"><th style="padding:4px;">Date</th><th>Amount</th><th>Covers</th><th>By</th></tr></thead>
            <tbody>${pays.map(p => `<tr style="border-top:1px solid #e2e8f0;"><td style="padding:6px 4px;">${wdsPrettyDate(p.paidDate)}</td><td>${wdsMoney(p.amount)}</td><td>${wdsNum(p.months)} mo → ${wdsPrettyDate(p.dueAfter)}</td><td>${wdsEsc(p.method || '')}${p.note ? '<br><small style="color:#64748b;">' + wdsEsc(p.note) + '</small>' : ''}</td></tr>`).join('')}</tbody></table>
            <div style="margin-top:10px; font-weight:bold;">Total paid: ${wdsMoney(total)}</div>`;
    wdsModal(`Payments — ${st.name || st.id}`, rows);
}

// ----- Reminders -----
async function wdsSendReminder(id) {
    const st = wdsFind(id);
    if (!st) return;
    const b = wdsBillingState(st.billing, wdsTodayStr(), wdsSettings);
    const msg = wdsReminderMessage(st, b, wdsSettings);
    if (!wdsWaNumber(st.phone)) {
        prompt(`${st.name || st.id} has no phone number saved. Copy this message:`, msg);
    } else {
        window.open(`https://wa.me/${wdsWaNumber(st.phone)}?text=${encodeURIComponent(msg)}`, '_blank');
    }
    try { await firebase.database().ref(`billing/${id}/lastReminderAt`).set(new Date().toISOString()); st.billing = Object.assign({}, st.billing, { lastReminderAt: new Date().toISOString() }); } catch (e) {}
}

function wdsOpenReminders() {
    const today = wdsTodayStr();
    const targets = wdsSortStores(wdsStores, today, wdsSettings).filter(st => {
        const b = wdsBillingState(st.billing, today, wdsSettings);
        return b.state === 'overdue' || b.state === 'due-soon';
    });
    if (targets.length === 0) { wdsModal('Reminders', '<div style="text-align:center; color:#166534; padding:16px;">✅ Nobody is overdue or due soon.</div>'); return; }

    wdsModal(`Reminders (${targets.length})`, `
        <div style="font-size:12px; color:#64748b; margin-bottom:10px;">Tap each one — WhatsApp opens with the message ready. You press send.</div>
        ${targets.map(st => {
            const b = wdsBillingState(st.billing, today, wdsSettings);
            const status = b.state === 'overdue' ? `<span style="color:#dc2626;">${b.overdueBy} day${b.overdueBy === 1 ? '' : 's'} overdue</span>` : `<span style="color:#d97706;">due in ${b.days} day${b.days === 1 ? '' : 's'}</span>`;
            return `<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 0; border-top:1px solid #e2e8f0;">
                <div style="font-size:13px;"><strong>${wdsEsc(st.name || st.id)}</strong><br>${status}${st.billing.lastReminderAt ? `<br><small style="color:#94a3b8;">reminded ${wdsAgo(st.billing.lastReminderAt)}</small>` : ''}</div>
                <button data-id="${wdsEsc(st.id)}" onclick="wdsAct('remind', this)" style="padding:7px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; background:#dcfce7; border:1px solid #86efac; color:#166534;">📲 Remind</button></div>`;
        }).join('')}`);
}

// ----- Lock overdue -----
async function wdsLockOverdue() {
    const today = wdsTodayStr();
    const targets = wdsStores.filter(st => {
        const b = wdsBillingState(st.billing, today, wdsSettings);
        return b.state === 'overdue' && b.pastGrace && st.status !== 'suspended';
    });
    if (targets.length === 0) { alert(`No store is more than ${wdsSettings.graceDays} days overdue (and still active).`); return; }

    if (!confirm(`Lock ${targets.length} store${targets.length === 1 ? '' : 's'} that are more than ${wdsSettings.graceDays} days overdue?\n\n${targets.map(t => '• ' + (t.name || t.id)).join('\n')}`)) return;
    try {
        const updates = {};
        targets.forEach(t => { updates[`stores/${t.id}/status`] = 'suspended'; });
        await firebase.database().ref().update(updates);
        await wdsReload();
        alert(`${targets.length} store${targets.length === 1 ? '' : 's'} locked.`);
    } catch (e) { alert("Failed: " + e.message); }
}

// ----- Settings -----
function wdsOpenSettings() {
    const s = wdsSettings;
    const field = (id, label, value, type) => `<label style="font-size:12px; font-weight:bold;">${label}</label>
        <input id="${id}" type="${type || 'text'}" value="${wdsEsc(value)}" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px; box-sizing:border-box;">`;
    wdsModal('Billing settings', `
        ${field('wds-set-bank', 'Bank name', s.bankName)}
        ${field('wds-set-acct', 'Account number', s.accountNumber)}
        ${field('wds-set-name', 'Account name', s.accountName)}
        ${field('wds-set-fee', 'Usual monthly fee (₦) — pre-fills new plans', s.defaultFee, 'number')}
        ${field('wds-set-grace', 'Grace days before "Lock overdue" applies', s.graceDays, 'number')}
        ${field('wds-set-soon', 'Show "due soon" this many days ahead', s.dueSoonDays, 'number')}
        <button class="menu-btn btn-action-primary" style="justify-content:center; margin-bottom:14px;" onclick="wdsSaveSettings()">Save settings</button>
        <div style="border-top:1px solid #e2e8f0; padding-top:12px;">
            <div style="font-weight:bold; font-size:13px; margin-bottom:6px;">Set up billing for every store that has none</div>
            <div style="font-size:12px; color:#64748b; margin-bottom:6px;">Uses the usual monthly fee above. Stores can be adjusted one by one afterwards.</div>
            <input id="wds-bulk-due" type="date" value="${wdsEsc(wdsAddMonths(wdsTodayStr(), 1))}" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:8px; box-sizing:border-box;">
            <button class="menu-btn" style="justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdsBulkSetup()">Apply to stores without billing</button>
        </div>`);
}

async function wdsSaveSettings() {
    const v = id => document.getElementById(id).value.trim();
    const settings = {
        bankName: v('wds-set-bank'), accountNumber: v('wds-set-acct'), accountName: v('wds-set-name'),
        defaultFee: Math.max(0, parseFloat(v('wds-set-fee')) || 0),
        graceDays: Math.max(0, parseInt(v('wds-set-grace')) || 0),
        dueSoonDays: Math.max(0, parseInt(v('wds-set-soon')) || 0)
    };
    if (!settings.bankName || !settings.accountNumber || !settings.accountName) { alert("Bank name, account number and account name are needed for the reminder messages."); return; }
    try {
        await firebase.database().ref('billingSettings').set(settings);
        wdsSettings = Object.assign({}, WDS_DEFAULT_SETTINGS, settings);
        wdsCloseModal();
        wdsRender();
    } catch (e) { alert("Failed to save: " + e.message); }
}

async function wdsBulkSetup() {
    const due = document.getElementById('wds-bulk-due').value;
    if (!wdsValidDate(due)) { alert("Pick the first due date."); return; }
    const targets = wdsStores.filter(st => !st.billing || !st.billing.dueDate);
    if (targets.length === 0) { alert("Every store already has billing set up."); return; }
    if (!confirm(`Set the first due date to ${wdsPrettyDate(due)} and the fee to ${wdsMoney(wdsSettings.defaultFee)} for ${targets.length} store${targets.length === 1 ? '' : 's'}?`)) return;
    try {
        const updates = {};
        targets.forEach(t => {
            updates[`billing/${t.id}/monthlyFee`] = wdsNum(wdsSettings.defaultFee);
            updates[`billing/${t.id}/dueDate`] = due;
        });
        await firebase.database().ref().update(updates);
        wdsCloseModal();
        await wdsReload();
    } catch (e) { alert("Failed: " + e.message); }
}

// ---------- Track when a store was last used (shown as "Last active") ----------
(function trackLastActive() {
    const prev = window.switchView;
    let marked = false;
    window.switchView = function (viewId) {
        const r = prev.apply(this, arguments);
        try {
            if (viewId === 'login-view') marked = false;
            else if (!marked && viewId !== 'register-view' && currentStoreId && currentStoreId !== 'SUPER_ADMIN' && navigator.onLine !== false) {
                marked = true;
                firebase.database().ref(`stores/${currentStoreId}/lastActiveAt`).set(new Date().toISOString()).catch(() => {});
            }
        } catch (e) { /* never block navigation */ }
        return r;
    };
})();
