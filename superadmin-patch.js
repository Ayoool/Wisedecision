// ==================== WISE DECISION SUPER ADMIN PATCH (v31) ====================
// Load LAST (after script.js and the other patches), with `defer`.
//
// v31 adds: revenue analytics + chart, bin UI with restore/purge, per-store
// activity log, WhatsApp payment receipts, CSV export, trial-ending chip,
// bulk selection with batch lock/remind, and MRR/collection/churn/dormant cards.

console.log("Wise Decision superadmin-patch.js — v31 loaded");

function wdsDefaults() {
    return {
        bankName: 'MONIEPOINT',
        accountNumber: '9168140710',
        accountName: 'EMMANUEL AYOOLA FISUYI',
        defaultFee: 0,
        graceDays: 3,
        dueSoonDays: 7
    };
}

// ---------- State ----------
var wdsStores = [];
var wdsBinned = [];
var wdsSettings = wdsDefaults();
var wdsFilter = 'all';
var wdsSearch = '';
var wdsModalStoreId = null;
var wdsBulkSelected = new Set();

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
    let p = String(String(phone || '').split(/[,;/|]/)[0] || '').replace(/[^\d+]/g, '');
    if (!p) return '';
    if (p.charAt(0) === '+') p = p.slice(1);
    else if (p.indexOf('00') === 0) p = p.slice(2);
    else if (p.charAt(0) === '0') p = '234' + p.slice(1);
    else if (/^\d{10}$/.test(p)) p = '234' + p;
    return p;
}
function wdsValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim()); }

// ---------- Billing logic ----------
function wdsBillingState(billing, todayStr, settings) {
    if (!billing || !billing.dueDate) return { state: 'none' };
    const days = wdsDaysBetween(todayStr, billing.dueDate);
    if (days < 0) return { state: 'overdue', days, overdueBy: -days, pastGrace: -days > wdsNum(settings.graceDays) };
    if (days <= wdsNum(settings.dueSoonDays)) return { state: 'due-soon', days };
    return { state: 'ok', days };
}

function wdsNextDueDate(currentDue, todayStr, months) {
    const base = (currentDue && wdsDaysBetween(todayStr, currentDue) >= 0) ? currentDue : todayStr;
    return wdsAddMonths(base, months);
}

function wdsPaymentsOf(billing) {
    const p = (billing && billing.payments) || {};
    return Object.keys(p).map(k => Object.assign({ key: k }, p[k])).sort((a, b) => String(b.at || b.paidDate).localeCompare(String(a.at || a.paidDate)));
}

function wdsLogOf(billing) {
    const l = (billing && billing.log) || {};
    return Object.keys(l).map(k => Object.assign({ key: k }, l[k]))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
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
        if (!suspended && st.billing && !st.billing.trial) s.monthlyIncome += wdsNum(st.billing.monthlyFee);
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

// ---------- Analytics ----------
function wdsMonthlySeries(stores, monthsBack) {
    const out = [];
    const today = new Date();
    for (let i = monthsBack - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
        out.push({
            month: `${d.getUTCFullYear()}-${wdsPad(d.getUTCMonth() + 1)}`,
            expected: 0, collected: 0, paidCount: 0, storeCount: 0, newStores: 0
        });
    }
    const idx = {};
    out.forEach((m, i) => { idx[m.month] = i; });

    stores.forEach(st => {
        const b = st.billing || {};
        const created = (st.createdAt || '').slice(0, 7);
        if (idx[created] !== undefined) out[idx[created]].newStores++;

        if (b.monthlyFee && !b.trial) {
            out.forEach(m => {
                if (created && created <= m.month) {
                    m.expected += wdsNum(b.monthlyFee);
                    m.storeCount++;
                }
            });
        }

        wdsPaymentsOf(b).forEach(p => {
            const key = String(p.paidDate || '').slice(0, 7);
            if (idx[key] !== undefined) {
                out[idx[key]].collected += wdsNum(p.amount);
                out[idx[key]].paidCount++;
            }
        });
    });
    return out;
}

function wdsComputeMetrics(stores, today, settings) {
    const s = wdsSummarize(stores, today, settings);
    const mrr = s.monthlyIncome;
    const collectionRate = mrr > 0 ? Math.min(1, s.collected / mrr) : 0;

    const churnRisk = stores.filter(st => {
        const b = wdsBillingState(st.billing, today, settings);
        return st.status === 'suspended' || b.state === 'overdue';
    }).length;

    const now = Date.now();
    const dormant = stores.filter(st => {
        if (!st.lastActiveAt) return false;
        return (now - new Date(st.lastActiveAt).getTime()) > 30 * 86400000;
    }).length;

    const ghosts = stores.filter(st => {
        if (st.lastActiveAt) return false;
        if (!st.createdAt) return false;
        return (now - new Date(st.createdAt).getTime()) > 7 * 86400000;
    }).length;

    return { mrr, collectionRate, churnRisk, dormant, ghosts };
}

// ---------- Activity log ----------
async function wdsLog(storeId, entry) {
    try {
        const key = firebase.database().ref(`billing/${storeId}/log`).push().key;
        await firebase.database().ref(`billing/${storeId}/log/${key}`).set(
            Object.assign({ at: new Date().toISOString(), by: 'Super Admin' }, entry)
        );
    } catch (e) { console.warn('Log failed', e); }
}

// ---------- Store list ----------
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

// ---------- Modal ----------
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

// ---------- Layout ----------
function wdsEnsureLayout() {
    if (document.getElementById('wds-root')) return;
    const tbody = document.getElementById('super-admin-stores-body');
    const table = tbody && tbody.closest('table');
    if (!table) return;
    const scroller = table.parentElement;
    scroller.style.display = 'none';
    const root = document.createElement('div');
    root.id = 'wds-root';
    scroller.parentElement.appendChild(root);
    root.innerHTML = `
        <div id="wds-summary"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:12px 0;">
            <input id="wds-search" type="text" placeholder="🔍 Search stores..." oninput="wdsSetSearch(this.value)" style="flex:1; min-width:140px; padding:9px; border:1px solid #cbd5e1; border-radius:8px;">
            <button class="menu-btn" style="width:auto; margin:0; padding:8px 12px; font-size:12px; background:#f0fdf4; border:1px solid #bbf7d0; color:#166534;" onclick="wdsExportCSV()">⬇ Export CSV</button>
            <button class="menu-btn" style="width:auto; margin:0; padding:8px 12px; font-size:12px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdsLockOverdue()">🔒 Lock overdue</button>
            <button class="menu-btn" style="width:auto; margin:0; padding:8px 12px; font-size:12px; background:#fffbeb; border:1px solid #fde68a; color:#92400e;" onclick="wdsOpenReminders()">📢 Reminders</button>
            <button class="menu-btn" style="width:auto; margin:0; padding:8px 12px; font-size:12px; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdsOpenSettings()">⚙ Billing settings</button>
        </div>
        <div id="wds-extra-toolbar" style="display:flex; gap:8px; flex-wrap:wrap; margin:0 0 12px 0;"></div>
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
        wdsSettings = Object.assign(wdsDefaults(), settingsSnap.val() || {});
        const billing = billingSnap.val() || {};

        const all = await Promise.all(ids.map(async id => {
            const ref = firebase.database().ref('stores/' + id);
            const [n, p, s, c, l, bAt, bBy, bPrev] = await Promise.all(['businessName', 'phone', 'status', 'createdAt', 'lastActiveAt', 'binnedAt', 'binnedBy', 'statusBeforeBin'].map(f => ref.child(f).once('value')));
            return { id, name: n.val() || '', phone: p.val() || '', status: s.val() || 'active', createdAt: c.val(), lastActiveAt: l.val(), binnedAt: bAt.val() || null, binnedBy: bBy.val() || null, statusBeforeBin: bPrev.val() || null, billing: billing[id] || null };
        }));
        wdsStores = all.filter(st => !st.binnedAt);
        wdsBinned = all.filter(st => st.binnedAt);
        wdsRender();
    } catch (e) {
        list.innerHTML = `<div style="color:#b91c1c; padding:16px;">Could not load stores: ${wdsEsc(e.message)}</div>`;
    }
}

function wdsSetSearch(v) { wdsSearch = String(v || '').toLowerCase().trim(); wdsRenderList(); }
function wdsSetFilter(f) { wdsFilter = f; wdsBulkClear(); wdsRender(); }

function wdsMatchesFilter(st, b) {
    if (typeof wdsExtraFilter === 'function') { const r = wdsExtraFilter(wdsFilter, st); if (r !== undefined) return r; }
    if (wdsFilter === 'all') return true;
    if (wdsFilter === 'suspended') return st.status === 'suspended';
    if (wdsFilter === 'overdue') return b.state === 'overdue';
    if (wdsFilter === 'due-soon') return b.state === 'due-soon';
    if (wdsFilter === 'none') return b.state === 'none';
    if (wdsFilter === 'trial') return !!(st.billing && st.billing.trial);
    if (wdsFilter === 'trialSoon') {
        if (!st.billing || !st.billing.trial) return false;
        const bb = wdsBillingState(st.billing, wdsTodayStr(), wdsSettings);
        return bb.state === 'due-soon' && bb.days <= 3;
    }
    return true;
}

function wdsRender() {
    if (!wdsSettings) wdsSettings = wdsDefaults();
    const today = wdsTodayStr();
    const sum = wdsSummarize(wdsStores, today, wdsSettings);
    const metrics = wdsComputeMetrics(wdsStores, today, wdsSettings);

    const card = (label, value, color, sub) => `<div style="background:#f8fafc; border:1px solid #e2e8f0; border-left:4px solid ${color}; border-radius:8px; padding:10px;">
        <div style="font-size:10px; font-weight:bold; text-transform:uppercase; color:#64748b;">${label}</div>
        <div style="font-size:19px; font-weight:800; color:#0f172a;">${value}</div>${sub ? `<div style="font-size:11px; color:#64748b;">${sub}</div>` : ''}</div>`;

    const series = wdsMonthlySeries(wdsStores, 6);
    const maxVal = Math.max(1, ...series.map(m => Math.max(m.expected, m.collected)));
    const chart = `<div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin:10px 0;">
        <div style="font-size:11px; font-weight:bold; text-transform:uppercase; color:#64748b; margin-bottom:8px;">Last 6 months — expected vs collected</div>
        <div style="display:flex; align-items:flex-end; gap:6px; height:80px;">
            ${series.map(m => {
                const eh = Math.round((m.expected / maxVal) * 70);
                const ch = Math.round((m.collected / maxVal) * 70);
                const label = m.month.slice(5);
                return `<div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:2px;">
                    <div style="width:100%; display:flex; align-items:flex-end; justify-content:center; gap:2px; height:70px;">
                        <div title="Expected ${wdsMoney(m.expected)}" style="width:40%; background:#cbd5e1; height:${eh}px; border-radius:2px 2px 0 0;"></div>
                        <div title="Collected ${wdsMoney(m.collected)}" style="width:40%; background:#16a34a; height:${ch}px; border-radius:2px 2px 0 0;"></div>
                    </div>
                    <div style="font-size:10px; color:#64748b;">${label}</div>
                </div>`;
            }).join('')}
        </div>
        <div style="font-size:10px; color:#94a3b8; margin-top:6px; display:flex; gap:12px;">
            <span><span style="display:inline-block; width:8px; height:8px; background:#cbd5e1; border-radius:1px;"></span> Expected</span>
            <span><span style="display:inline-block; width:8px; height:8px; background:#16a34a; border-radius:1px;"></span> Collected</span>
        </div>
    </div>`;

    const el = document.getElementById('wds-summary');
    if (el) el.innerHTML = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px;">
        ${card('Stores', sum.total, '#0284c7', `${sum.active} active · ${sum.suspended} locked · ${sum.trials} on trial`)}
        ${card('MRR', wdsMoney(metrics.mrr), '#0ea5e9', 'recurring per month')}
        ${card('Collected this month', wdsMoney(sum.collected), '#7c3aed', `collection ${Math.round(metrics.collectionRate * 100)}%`)}
        ${card('Overdue', sum.overdue, '#dc2626', sum.overdue ? `${wdsMoney(sum.overdueAmount)} owed` : 'All good')}
        ${card('Due in ' + wdsSettings.dueSoonDays + ' days', sum.dueSoon, '#d97706', '')}
        ${card('Churn risk', metrics.churnRisk, '#dc2626', 'overdue or locked')}
        ${card('Dormant 30d+', metrics.dormant, '#64748b', metrics.ghosts + ' never used')}
    </div>${chart}`;

    const trialsEndingSoonList = wdsStores.filter(st => {
        if (!st.billing || !st.billing.trial) return false;
        const b = wdsBillingState(st.billing, today, wdsSettings);
        return b.state === 'due-soon' && b.days <= 3;
    });

    const counts = { all: wdsStores.length, overdue: sum.overdue, 'due-soon': sum.dueSoon, trial: sum.trials, suspended: sum.suspended, none: sum.none };
    const labels = { all: 'All', overdue: 'Overdue', 'due-soon': 'Due soon', trial: 'On trial', suspended: 'Locked', none: 'No billing set' };
    if (trialsEndingSoonList.length > 0) {
        labels.trialSoon = `Trial ending (${trialsEndingSoonList.length})`;
        counts.trialSoon = trialsEndingSoonList.length;
    }
    if (wdsBinned.length > 0) {
        labels.bin = `Bin (${wdsBinned.length})`;
        counts.bin = wdsBinned.length;
    }
    if (typeof wdsExtraChips === 'function') { wdsExtraChips().forEach(c => { labels[c.key] = c.label; counts[c.key] = c.count; }); }
    const chips = document.getElementById('wds-chips');
    if (chips) chips.innerHTML = Object.keys(labels).map(k => {
        const isBin = k === 'bin';
        const isTrialSoon = k === 'trialSoon';
        const active = wdsFilter === k;
        let bg = active ? '#0284c7' : '#fff', col = active ? '#fff' : '#334155', bd = active ? '#0284c7' : '#cbd5e1';
        if (isBin && !active) { bg = '#fef2f2'; col = '#991b1b'; bd = '#fecaca'; }
        if (isTrialSoon && !active) { bg = '#ede9fe'; col = '#6d28d9'; bd = '#ddd6fe'; }
        return `<button onclick="wdsSetFilter('${k}')" style="padding:6px 12px; border-radius:16px; font-size:12px; font-weight:bold; cursor:pointer; border:1px solid ${bd}; background:${bg}; color:${col};">${labels[k]} (${counts[k]})</button>`;
    }).join('');

    wdsRenderList();
    if (typeof wdsAfterRender === 'function') { try { wdsAfterRender(); } catch (e) { console.warn(e); } }
}

function wdsRenderList() {
    if (!wdsSettings) wdsSettings = wdsDefaults();
    const list = document.getElementById('wds-list');
    if (!list) return;
    const today = wdsTodayStr();

    if (wdsFilter === 'bin') { wdsRenderBin(); return; }

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

        const onTrial = !!(st.billing && st.billing.trial);
        let dueLine;
        if (b.state === 'none') dueLine = '<span style="color:#64748b;">No billing set up yet</span>';
        else if (b.state === 'overdue') dueLine = `<strong style="color:#dc2626;">${onTrial ? 'Trial ended' : 'Overdue by'} ${b.overdueBy} day${b.overdueBy === 1 ? '' : 's'}${onTrial ? ' ago' : ''}</strong> · ${onTrial ? 'trial ended' : 'was due'} ${wdsPrettyDate(st.billing.dueDate)}`;
        else dueLine = `${onTrial ? 'Trial ends' : 'Due'} <strong>${wdsPrettyDate(st.billing.dueDate)}</strong> · ${b.days === 0 ? 'today' : `in ${b.days} day${b.days === 1 ? '' : 's'}`}`;

        const fee = st.billing ? `${wdsMoney(st.billing.monthlyFee)}/month` : '';
        const lastPaid = st.billing && st.billing.lastPaidDate ? ` · last paid ${wdsPrettyDate(st.billing.lastPaidDate)} (${wdsMoney(st.billing.lastPaidAmount)})` : '';
        const badge = (locked ? '<span style="background:#e2e8f0; color:#334155; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">LOCKED</span> ' : '') + (onTrial ? '<span style="background:#ede9fe; color:#6d28d9; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">FREE TRIAL</span>' : '');
        const id = wdsEsc(st.id);
        const btn = (act, label, style) => `<button data-id="${id}" onclick="wdsAct('${act}', this)" style="padding:6px 10px; font-size:11px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc; color:#334155; ${style || ''}">${label}</button>`;
        const checked = wdsBulkSelected.has(st.id) ? 'checked' : '';

        return `<div style="position:relative; border:1px solid #e2e8f0; border-left:5px solid ${color}; border-radius:8px; padding:12px 12px 12px 34px; margin-bottom:10px; background:#fff;">
            <input type="checkbox" data-bulk="${id}" onchange="wdsToggleBulk(this)" ${checked} style="position:absolute; top:14px; left:10px; cursor:pointer;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                <div><strong style="font-size:15px;">${wdsEsc(st.name || 'Unnamed')}</strong> ${badge}<br><small style="color:#64748b;">${id}${st.phone ? ' · ' + wdsEsc(st.phone) : ''}</small></div>
                <div style="text-align:right; font-size:12px; color:#334155;">${fee}</div>
            </div>
            <div style="font-size:12px; margin:6px 0; color:#334155;">${dueLine}${lastPaid}<br><span style="color:#94a3b8;">Last active: ${wdsAgo(st.lastActiveAt)}</span>${st.billing && st.billing.notes ? `<br><em style="color:#64748b;">📝 ${wdsEsc(st.billing.notes)}</em>` : ''}${typeof wdsExtraCardHtml === 'function' ? wdsExtraCardHtml(st) : ''}</div>
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

function wdsRenderBin() {
    const list = document.getElementById('wds-list');
    const rows = wdsBinned.filter(st => {
        if (!wdsSearch) return true;
        return (st.name + ' ' + st.id + ' ' + st.phone).toLowerCase().indexOf(wdsSearch) !== -1;
    });
    if (rows.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:#64748b; padding:24px;">Bin is empty.</div>';
        return;
    }
    list.innerHTML = rows.map(st => {
        const binnedAt = st.binnedAt ? new Date(st.binnedAt) : null;
        const daysLeft = binnedAt ? Math.max(0, 30 - Math.floor((Date.now() - binnedAt.getTime()) / 86400000)) : '?';
        const id = wdsEsc(st.id);
        return `<div style="border:1px solid #fecaca; border-left:5px solid #dc2626; border-radius:8px; padding:12px; margin-bottom:10px; background:#fef2f2;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; flex-wrap:wrap;">
                <div><strong style="font-size:15px;">${wdsEsc(st.name || 'Unnamed')}</strong><br>
                <small style="color:#64748b;">${id}${st.phone ? ' · ' + wdsEsc(st.phone) : ''}</small></div>
                <div style="font-size:11px; color:#991b1b; text-align:right;">Purges in ${daysLeft} day${daysLeft === 1 ? '' : 's'}<br>
                <span style="color:#64748b;">deleted by ${wdsEsc(st.binnedBy || 'unknown')}</span></div>
            </div>
            <div style="font-size:12px; color:#64748b; margin:6px 0;">Bin time: ${binnedAt ? binnedAt.toLocaleString() : '—'}${st.statusBeforeBin ? ' · was ' + wdsEsc(st.statusBeforeBin) : ''}</div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button data-id="${id}" onclick="wdsRestoreBin(this)" style="padding:6px 10px; font-size:11px; font-weight:bold; border-radius:6px; cursor:pointer; background:#dcfce7; border:1px solid #86efac; color:#166534;">↩ Restore</button>
                <button data-id="${id}" onclick="wdsPurgeBin(this)" style="padding:6px 10px; font-size:11px; font-weight:bold; border-radius:6px; cursor:pointer; background:#fee2e2; border:1px solid #fecaca; color:#991b1b;">🔥 Purge now</button>
            </div></div>`;
    }).join('');
}

async function wdsRestoreBin(el) {
    const id = el.dataset.id;
    const st = wdsBinned.find(s => s.id === id);
    if (!st) return;
    if (!confirm(`Restore ${st.name || id}?`)) return;
    try {
        const updates = {
            [`stores/${id}/binnedAt`]: null,
            [`stores/${id}/binnedBy`]: null,
            [`stores/${id}/statusBeforeBin`]: null
        };
        if (st.statusBeforeBin) updates[`stores/${id}/status`] = st.statusBeforeBin;
        await firebase.database().ref().update(updates);
        await wdsLog(id, { type: 'restore', text: 'Restored from Bin' });
        wdsFilter = 'all';
        await wdsReload();
    } catch (e) { alert('Failed: ' + e.message); }
}

async function wdsPurgeBin(el) {
    const id = el.dataset.id;
    const st = wdsBinned.find(s => s.id === id);
    if (!st) return;
    if (!confirm(`Permanently delete ${st.name || id}?\n\nThis cannot be undone. All store data will be removed.`)) return;
    try {
        await firebase.database().ref(`stores/${id}`).remove();
        await firebase.database().ref(`billing/${id}`).remove();
        await wdsReload();
    } catch (e) { alert('Failed: ' + e.message); }
}

// ---------- Bulk selection ----------
function wdsToggleBulk(el) {
    if (el.checked) wdsBulkSelected.add(el.dataset.bulk);
    else wdsBulkSelected.delete(el.dataset.bulk);
    wdsRenderBulkBar();
}
function wdsRenderBulkBar() {
    let bar = document.getElementById('wds-bulk-bar');
    if (wdsBulkSelected.size === 0) { if (bar) bar.remove(); return; }
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'wds-bulk-bar';
        bar.style.cssText = 'position:fixed; bottom:16px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff; padding:10px 16px; border-radius:10px; display:flex; gap:10px; align-items:center; z-index:1200; box-shadow:0 10px 30px rgba(0,0,0,0.3); font-size:13px;';
        document.body.appendChild(bar);
    }
    bar.innerHTML = `
        <strong>${wdsBulkSelected.size}</strong> selected
        <button onclick="wdsBulkRemind()" style="padding:6px 10px; border-radius:6px; background:#d97706; color:#fff; border:none; cursor:pointer; font-weight:bold;">📲 Remind</button>
        <button onclick="wdsBulkLock()" style="padding:6px 10px; border-radius:6px; background:#dc2626; color:#fff; border:none; cursor:pointer; font-weight:bold;">🔒 Lock</button>
        <button onclick="wdsBulkClear()" style="padding:6px 10px; border-radius:6px; background:#475569; color:#fff; border:none; cursor:pointer; font-weight:bold;">✕</button>`;
}
function wdsBulkClear() {
    wdsBulkSelected.clear();
    document.querySelectorAll('[data-bulk]').forEach(c => c.checked = false);
    wdsRenderBulkBar();
}
async function wdsBulkLock() {
    if (wdsBulkSelected.size === 0) return;
    if (!confirm(`Lock ${wdsBulkSelected.size} store${wdsBulkSelected.size === 1 ? '' : 's'}?`)) return;
    const ids = [...wdsBulkSelected];
    const updates = {};
    ids.forEach(id => { updates[`stores/${id}/status`] = 'suspended'; });
    try {
        await firebase.database().ref().update(updates);
        for (const id of ids) await wdsLog(id, { type: 'lock', text: 'Locked (bulk action)' });
        wdsBulkClear();
        await wdsReload();
    } catch (e) { alert('Failed: ' + e.message); }
}
function wdsBulkRemind() {
    const targets = [...wdsBulkSelected].map(id => wdsFind(id)).filter(Boolean);
    if (targets.length === 0) return;
    if (!confirm(`Open WhatsApp reminders for ${targets.length} store${targets.length === 1 ? '' : 's'}? You'll need to press send on each.`)) return;
    targets.forEach((st, i) => setTimeout(() => wdsSendReminder(st.id), i * 400));
    wdsBulkClear();
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
    else if (action === 'pin') {
        if (typeof promptChangeStorePassword !== 'function') return alert('PIN reset unavailable.');
        wdsRunAndRefresh(() => promptChangeStorePassword(id));
    }
    else if (action === 'delete') {
        if (typeof wdsSafeDelete === 'function') wdsSafeDelete(id);
        else wdsRunAndRefresh(() => deleteBusinessAccount(id), id);
    }
}

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
        await wdsLog(st.id, { type: 'lock', text: locking ? 'Store locked' : 'Store unlocked' });
        await wdsReload();
    } catch (e) { alert("Failed: " + e.message); }
}

// ---------- Plan ----------
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
        await wdsLog(id, { type: 'plan', text: `Plan set: ${wdsMoney(fee)}/mo, due ${due}${trial ? ' (trial)' : ''}` });
        wdsCloseModal();
        await wdsReload();
    } catch (e) { alert("Failed to save: " + e.message); }
}

// ---------- Payment ----------
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
        [`billing/${id}/trial`]: null,
        [`billing/${id}/payments/${key}`]: { amount, months, method, note, paidDate: today, at: new Date().toISOString(), dueBefore, dueAfter, recordedBy: 'Super Admin' }
    };
    if (!(st.billing && st.billing.monthlyFee)) updates[`billing/${id}/monthlyFee`] = Math.round((amount / months) * 100) / 100;

    try {
        await firebase.database().ref().update(updates);
        await wdsLog(id, { type: 'payment', text: `Payment ${wdsMoney(amount)} (${method}) — ${months}mo → due ${dueAfter}`, amount });
        wdsCloseModal();

        let unlocked = false;
        if (st.status === 'suspended' && confirm(`Payment saved. ${st.name || st.id} is locked — unlock it now?`)) {
            await firebase.database().ref(`stores/${id}`).update({ status: 'active' });
            await wdsLog(id, { type: 'lock', text: 'Unlocked after payment' });
            unlocked = true;
        }

        const receipt = `Hello ${st.name || st.id}, we received your payment of ${wdsMoney(amount)} (${months} month${months === 1 ? '' : 's'}).\n\nYour next due date is ${wdsPrettyDate(dueAfter)}.\n\nThank you for being with Wise Decision!`;
        if (confirm(`Payment saved.${unlocked ? ' Store unlocked.' : ''}\n\nNext due date: ${wdsPrettyDate(dueAfter)}.\n\nSend a WhatsApp receipt now?`)) {
            if (wdsWaNumber(st.phone)) {
                window.open(`https://wa.me/${wdsWaNumber(st.phone)}?text=${encodeURIComponent(receipt)}`, '_blank');
                await wdsLog(id, { type: 'receipt', text: 'WhatsApp receipt sent' });
            } else {
                prompt('No phone number saved. Copy this receipt:', receipt);
            }
        }

        await wdsReload();
    } catch (e) { alert("Failed to save payment: " + e.message); }
}

// ---------- History ----------
function wdsOpenHistory(st) {
    const pays = wdsPaymentsOf(st.billing);
    const logs = wdsLogOf(st.billing);
    const total = pays.reduce((s, p) => s + wdsNum(p.amount), 0);

    const paymentRows = pays.length === 0
        ? '<div style="text-align:center; color:#64748b; padding:16px;">No payments recorded yet.</div>'
        : `<table style="width:100%; font-size:12px; border-collapse:collapse;">
            <thead><tr style="text-align:left; color:#64748b;"><th style="padding:4px;">Date</th><th>Amount</th><th>Covers</th><th>By</th></tr></thead>
            <tbody>${pays.map(p => `<tr style="border-top:1px solid #e2e8f0;"><td style="padding:6px 4px;">${wdsPrettyDate(p.paidDate)}</td><td>${wdsMoney(p.amount)}</td><td>${wdsNum(p.months)} mo → ${wdsPrettyDate(p.dueAfter)}</td><td>${wdsEsc(p.method || '')}${p.note ? '<br><small style="color:#64748b;">' + wdsEsc(p.note) + '</small>' : ''}</td></tr>`).join('')}</tbody></table>
            <div style="margin-top:10px; font-weight:bold;">Total paid: ${wdsMoney(total)}</div>`;

    const logRows = logs.length === 0
        ? '<div style="text-align:center; color:#64748b; padding:12px; font-size:12px;">No activity recorded yet.</div>'
        : logs.map(l => `<div style="padding:6px 0; border-bottom:1px solid #f1f5f9; font-size:12px;">
            <div style="color:#64748b; font-size:10px;">${new Date(l.at).toLocaleString()}${l.by ? ' · ' + wdsEsc(l.by) : ''}</div>
            <div>${wdsEsc(l.text || l.type || '')}</div></div>`).join('');

    wdsModal(`History — ${st.name || st.id}`, `
        <div style="font-size:11px; font-weight:bold; text-transform:uppercase; color:#64748b; margin-bottom:6px;">Payments</div>
        ${paymentRows}
        <div style="font-size:11px; font-weight:bold; text-transform:uppercase; color:#64748b; margin:16px 0 6px;">Activity log</div>
        ${logRows}`);
}

// ---------- Reminders ----------
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
    try {
        const at = new Date().toISOString();
        await firebase.database().ref(`billing/${id}/lastReminderAt`).set(at);
        st.billing = Object.assign({}, st.billing, { lastReminderAt: at });
        await wdsLog(id, { type: 'reminder', text: 'WhatsApp reminder sent' });
    } catch (e) {}
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

// ---------- Lock overdue ----------
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
        for (const t of targets) await wdsLog(t.id, { type: 'lock', text: 'Auto-locked (bulk overdue)' });
        await wdsReload();
        alert(`${targets.length} store${targets.length === 1 ? '' : 's'} locked.`);
    } catch (e) { alert("Failed: " + e.message); }
}

// ---------- Settings ----------
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
        wdsSettings = Object.assign(wdsDefaults(), settings);
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
        for (const t of targets) await wdsLog(t.id, { type: 'plan', text: `Bulk setup: ${wdsMoney(wdsSettings.defaultFee)}/mo, due ${due}` });
        wdsCloseModal();
        await wdsReload();
    } catch (e) { alert("Failed: " + e.message); }
}

// ---------- CSV export ----------
function wdsExportCSV() {
    const today = wdsTodayStr();
    const rows = [['Store ID','Name','Phone','Status','Monthly Fee','Due Date','State','Days','Last Paid','Last Paid Amount','Last Active','Trial']];
    wdsSortStores(wdsStores, today, wdsSettings).forEach(st => {
        const b = wdsBillingState(st.billing, today, wdsSettings);
        rows.push([
            st.id,
            st.name || '',
            st.phone || '',
            st.status,
            wdsNum(st.billing && st.billing.monthlyFee),
            (st.billing && st.billing.dueDate) || '',
            b.state,
            b.days !== undefined ? b.days : '',
            (st.billing && st.billing.lastPaidDate) || '',
            wdsNum(st.billing && st.billing.lastPaidAmount),
            st.lastActiveAt || '',
            st.billing && st.billing.trial ? 'yes' : ''
        ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wise-decision-stores-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

// ---------- Track last active ----------
(function trackLastActive() {
    const prev = window.switchView;
    if (typeof prev !== 'function') return;
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
