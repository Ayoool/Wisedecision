// ==================== WISE DECISION SUPER ADMIN TOOLS PATCH (v30) ====================
// Load AFTER superadmin-patch.js (v30) and activation-patch.js, with `defer`.
//
//   1. Safe delete  – 🗑 now downloads a backup file, then moves the store to a 30-day Bin
//                     (hidden, staff can't log in). Restore, re-download the backup, or delete
//                     forever from the Bin.
//   2. Usage        – "📊 Load usage" adds sales this month, products, staff and last-sale date to
//                     every store card, plus filters: never added products / never sold / no sale in 7+ days.
//   3. Announcements – send a message to all stores (or chosen ones); it pops up when their staff log
//                     in, with an expiry date, and you can see which stores have read it.

console.log("Wise Decision superadmin-tools-patch.js — v32 loaded");

var WDT_BIN_DAYS = 30;
var wdtUsage = {};              // storeId -> usage numbers (filled by "Load usage")
var wdtUsageBusy = false;
var wdtAnnSession = false;      // announcements already checked for this login?

// ---------- Helpers ----------
function wdtEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdtNum(n) { return Number(n) || 0; }
function wdtMoney(n) { return '₦' + (Math.round(wdtNum(n) * 100) / 100).toLocaleString(); }
function wdtPad(n) { return String(n).padStart(2, '0'); }
function wdtToday() { const d = new Date(); return `${d.getFullYear()}-${wdtPad(d.getMonth() + 1)}-${wdtPad(d.getDate())}`; }
function wdtAddDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${wdtPad(t.getUTCMonth() + 1)}-${wdtPad(t.getUTCDate())}`;
}
function wdtDaysSince(iso, nowMs) {
    const t = Date.parse(iso);
    return isNaN(t) ? null : Math.floor(((nowMs || Date.now()) - t) / 86400000);
}
function wdtAgo(iso) {
    const d = wdtDaysSince(iso);
    if (d === null) return 'never';
    return d <= 0 ? 'today' : (d === 1 ? 'yesterday' : `${d} days ago`);
}
function wdtPretty(iso) {
    const t = new Date(iso);
    return isNaN(t) ? '—' : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function wdtWithTimeout(promise, ms, msg) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(msg || 'Timed out — check the connection and try again.')), ms);
        promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
}
function wdtBusy(msg) { if (typeof wdShowLoader === 'function') wdShowLoader(msg); }
function wdtIdle() { if (typeof wdHideLoader === 'function') wdHideLoader(); }

function wdtModal(title, html) {
    let m = document.getElementById('wdt-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdt-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1400; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = `<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:520px; max-height:92vh; overflow-y:auto; padding:18px; box-sizing:border-box;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">
            <h3 style="margin:0; font-size:17px;">${wdtEsc(title)}</h3>
            <button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdtCloseModal()">✕</button>
        </div>${html}</div>`;
    m.style.display = 'flex';
}
function wdtCloseModal() { const m = document.getElementById('wdt-modal'); if (m) m.style.display = 'none'; }

function wdtDownloadFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/json' });
    const anchorDownload = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    };
    try {
        const file = (typeof File !== 'undefined') ? new File([blob], filename, { type: mime || 'application/json' }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: filename }).catch(err => { if (!err || err.name !== 'AbortError') anchorDownload(); });
            return;
        }
    } catch (e) { /* fall through */ }
    anchorDownload();
}

// =====================================================================
// 1. SAFE DELETE: backup -> Bin (30 days) -> restore or delete forever
// =====================================================================
function wdtBinDaysLeft(binnedAtIso, nowMs) {
    const passed = (((nowMs || Date.now()) - Date.parse(binnedAtIso)) / 86400000);
    return Math.max(0, Math.ceil(WDT_BIN_DAYS - passed));
}

async function wdtBuildBackup(id) {
    const db = firebase.database();
    const [storeSnap, billSnap] = await wdtWithTimeout(Promise.all([db.ref(`stores/${id}`).once('value'), db.ref(`billing/${id}`).once('value')]), 60000, 'Reading the store took too long.');
    if (!storeSnap.exists()) throw new Error('Store not found.');
    return { app: 'Wise Decision', kind: 'store-backup', version: 1, exportedAt: new Date().toISOString(), storeId: id, store: storeSnap.val(), billing: billSnap.val() || null };
}

async function wdtDownloadBackup(id) {
    try {
        wdtBusy('Preparing backup...');
        const backup = await wdtBuildBackup(id);
        wdtIdle();
        wdtDownloadFile(`backup_${id}_${wdtToday()}.json`, JSON.stringify(backup, null, 2), 'application/json');
        return true;
    } catch (e) {
        wdtIdle();
        alert("Backup failed: " + e.message);
        return false;
    }
}

function wdsSafeDelete(id) {
    if (currentUserRole !== 'SuperAdmin') return;
    const st = wdsFind(id);
    if (!st) return;
    wdtModal(`Delete ${st.name || st.id}?`, `
        <div style="font-size:13px; line-height:1.6;">
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:10px; margin-bottom:10px;">
                <strong>Nothing is lost by tapping this:</strong><br>
                1. A <strong>backup file</strong> of all this store's data downloads to your device.<br>
                2. The store moves to the <strong>Bin for ${WDT_BIN_DAYS} days</strong>. It disappears from your list and its staff can't log in.<br>
                3. Within ${WDT_BIN_DAYS} days you can <strong>restore</strong> it exactly as it was, or delete it forever from the Bin.
            </div>
        </div>
        <div style="display:flex; gap:8px;">
            <button data-id="${wdtEsc(id)}" onclick="wdtBackupAndBin(this.dataset.id)" class="menu-btn btn-action-primary" style="justify-content:center; margin:0; flex:1;">💾 Backup &amp; move to Bin</button>
            <button onclick="wdtCloseModal()" class="menu-btn" style="justify-content:center; margin:0; background:#f1f5f9; border:1px solid #cbd5e1;">Cancel</button>
        </div>`);
}

async function wdtBackupAndBin(id) {
    const st = wdsFind(id);
    if (!st) return;
    wdtCloseModal();
    const ok = await wdtDownloadBackup(id);
    if (!ok) return;
    if (!confirm(`The backup file for "${st.name || st.id}" should now be saving to your device.\n\nTap OK once you have it, to move the store to the Bin.`)) return;
    try {
        await firebase.database().ref(`stores/${id}`).update({
            binnedAt: new Date().toISOString(),
            binnedBy: 'Super Admin',
            statusBeforeBin: st.status || 'active',
            status: 'suspended'
        });
        await wdsReload();
        alert(`${st.name || st.id} is in the Bin. You can restore it for the next ${WDT_BIN_DAYS} days.`);
    } catch (e) { alert("Could not move the store to the Bin: " + e.message); }
}

async function wdtRestore(id) {
    const st = wdsBinned.find(s => s.id === id);
    if (!st) return;
    if (!confirm(`Restore "${st.name || st.id}"? It returns to your list exactly as it was.`)) return;
    try {
        await firebase.database().ref(`stores/${id}`).update({
            status: st.statusBeforeBin || 'active', binnedAt: null, binnedBy: null, statusBeforeBin: null
        });
        await wdsReload();
        wdtOpenBin();
    } catch (e) { alert("Could not restore: " + e.message); }
}

function wdtPurge(id) {
    if (!confirm("This deletes the store and ALL its data forever.\n\nMake sure you have its backup file first (use 💾 Backup in the Bin). Continue?")) return;
    wdtCloseModal();
    wdsRunAndRefresh(() => deleteBusinessAccount(id), id);   // asks you to type the Store ID, then removes it and its billing
}

function wdtOpenBin() {
    if (currentUserRole !== 'SuperAdmin') return;
    const list = (wdsBinned || []).slice().sort((a, b) => String(b.binnedAt).localeCompare(String(a.binnedAt)));
    if (list.length === 0) { wdtModal('🗑 Bin', '<div style="text-align:center; color:#64748b; padding:20px;">The Bin is empty.</div>'); return; }

    const rows = list.map(st => {
        const left = wdtBinDaysLeft(st.binnedAt);
        const id = wdtEsc(st.id);
        const btn = (fn, label, style) => `<button data-id="${id}" onclick="${fn}(this.dataset.id)" style="padding:6px 10px; font-size:11px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc; ${style || ''}">${label}</button>`;
        return `<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px;">
            <strong>${wdtEsc(st.name || 'Unnamed')}</strong> <small style="color:#64748b;">${id}</small>
            <div style="font-size:12px; margin:4px 0 8px; color:#475569;">Moved to Bin ${wdtAgo(st.binnedAt)} · ${left > 0 ? `<strong>${left} day${left === 1 ? '' : 's'} left</strong>` : '<strong style="color:#b45309;">ready to delete forever</strong>'}</div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                ${btn('wdtRestore', '↩ Restore', 'background:#dcfce7; border-color:#86efac; color:#166534;')}
                ${btn('wdtDownloadBackup', '💾 Backup')}
                ${btn('wdtPurge', '🗑 Delete forever', 'color:#991b1b;')}
            </div></div>`;
    }).join('');
    wdtModal(`🗑 Bin (${list.length})`, `<div style="font-size:12px; color:#64748b; margin-bottom:10px;">Stores here are hidden and locked. Restore one within ${WDT_BIN_DAYS} days, or delete it forever once you're sure.</div>${rows}`);
}

// =====================================================================
// 2. USAGE: who is actually using the app?
// =====================================================================
async function wdtShallowKeys(path) {
    // Lists only the names under a path (cheap even for huge stores). Throws if it can't — we never
    // fall back to downloading the whole node, which is what made big stores time out.
    let url = `${firebase.app().options.databaseURL}/${path}.json?shallow=true`;
    try {
        const u = firebase.auth && firebase.auth().currentUser;
        if (u) url += '&auth=' + encodeURIComponent(await u.getIdToken());
    } catch (e) { /* not signed in with Firebase Auth */ }
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    return j && typeof j === 'object' ? Object.keys(j) : [];
}

var WDT_USAGE_SALES_CAP = 500;   // never download more than this many recent sales per store

async function wdtFetchUsage(id) {
    const root = firebase.database().ref(`stores/${id}`);
    const d = new Date();
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();

    const [txSnap, branchIds, staffIds] = await Promise.all([
        root.child('transactions').orderByChild('date').limitToLast(WDT_USAGE_SALES_CAP).once('value'),
        wdtShallowKeys(`stores/${id}/inventory`).catch(() => null),
        wdtShallowKeys(`stores/${id}/staff`).catch(() => null)
    ]);

    // Snapshot children come oldest -> newest
    let count = 0, salesMonth = 0, revenueMonth = 0, lastSaleAt = null, oldest = null;
    txSnap.forEach(c => {
        const t = c.val() || {};
        count++;
        if (!t.date) return;
        if (!oldest) oldest = t.date;
        lastSaleAt = t.date;
        if (t.date >= monthStart) { salesMonth++; revenueMonth += wdtNum(t.totalAmount); }
    });
    // If even the oldest sale we fetched is from this month, there may be more — show "500+", not a wrong total
    const capped = count >= WDT_USAGE_SALES_CAP && oldest !== null && oldest >= monthStart;

    // Checks every branch AT ONCE — a store with several branches doesn't add up its wait time branch by branch.
    let products = null;
    if (branchIds) {
        try {
            const counts = await Promise.all(branchIds.map(b => wdtShallowKeys(`stores/${id}/inventory/${b}`)));
            products = counts.reduce((sum, keys) => sum + keys.length, 0);
        } catch (e) { products = null; }
    }

    return { salesMonth, revenueMonth: Math.round(revenueMonth * 100) / 100, capped, products, staff: staffIds ? staffIds.length : null, lastSaleAt, loadedAt: new Date().toISOString() };
}

async function wdtLoadUsage() {
    if (wdtUsageBusy || currentUserRole !== 'SuperAdmin') return;
    wdtUsageBusy = true;
    const queue = (wdsStores || []).slice();
    let done = 0;
    const setLabel = () => { const b = document.getElementById('wdt-btn-usage'); if (b) b.textContent = `📊 Loading ${done}/${queue.length}...`; };
    setLabel();
    const worker = async () => {
        while (queue.length) {
            const st = queue.shift();
            try { wdtUsage[st.id] = await wdtWithTimeout(wdtFetchUsage(st.id), 45000, 'timeout'); }
            catch (e) { console.warn(`Usage for ${st.id} failed:`, e.message); }
            done++; setLabel();
        }
    };
    const total = queue.length;
    await Promise.all([worker(), worker()]);
    wdtUsageBusy = false;
    wdsRender();
    if (total === 0) alert("There are no stores to check.");
}

function wdtUsageFlags(usage, store, nowMs) {
    if (!usage) return {};
    const now = nowMs || Date.now();
    const ageDays = store && store.createdAt ? (now - Date.parse(store.createdAt)) / 86400000 : 999;
    const lastSaleDays = usage.lastSaleAt ? wdtDaysSince(usage.lastSaleAt, now) : null;
    return {
        noProducts: usage.products === 0 && ageDays >= 2,
        neverSold: !usage.lastSaleAt && ageDays >= 3,
        inactive: lastSaleDays !== null && lastSaleDays >= 7,
        lastSaleDays
    };
}

function wdsExtraFilter(filter, st) {
    if (filter !== 'noprod' && filter !== 'neversold' && filter !== 'inactive') return undefined;
    const f = wdtUsageFlags(wdtUsage[st.id], st);
    return filter === 'noprod' ? !!f.noProducts : (filter === 'neversold' ? !!f.neverSold : !!f.inactive);
}

function wdsExtraChips() {
    const loaded = (wdsStores || []).filter(st => wdtUsage[st.id]);
    if (loaded.length === 0) return [];
    let np = 0, ns = 0, ia = 0;
    loaded.forEach(st => { const f = wdtUsageFlags(wdtUsage[st.id], st); if (f.noProducts) np++; if (f.neverSold) ns++; if (f.inactive) ia++; });
    return [
        { key: 'noprod', label: 'No products yet', count: np },
        { key: 'neversold', label: 'Never sold', count: ns },
        { key: 'inactive', label: 'No sale in 7+ days', count: ia }
    ];
}

function wdsExtraCardHtml(st) {
    const u = wdtUsage[st.id];
    if (!u) return '';
    const f = wdtUsageFlags(u, st);
    const tags = [];
    if (f.noProducts) tags.push('⚠ hasn\'t added any products');
    if (f.neverSold) tags.push('⚠ never made a sale');
    else if (f.inactive) tags.push(`⚠ no sale for ${f.lastSaleDays} days`);
    const sales = u.capped ? `${u.salesMonth}+` : `${u.salesMonth}`;
    const money = (u.capped ? 'at least ' : '') + wdtMoney(u.revenueMonth);
    const products = u.products === null || u.products === undefined ? '?' : u.products;
    const staff = u.staff === null || u.staff === undefined ? '?' : u.staff;
    return `<br><span style="color:#334155;">📊 This month: <strong>${sales}</strong> sale${u.salesMonth === 1 && !u.capped ? '' : 's'} · ${money} · ${products} product${products === 1 ? '' : 's'} · ${staff} staff · last sale ${wdtAgo(u.lastSaleAt)}</span>` +
        (tags.length ? `<br><span style="color:#b45309; font-weight:bold;">${tags.join(' · ')}</span>` : '');
}

// =====================================================================
// 3. ANNOUNCEMENTS
// =====================================================================
function wdtAnnouncementApplies(a, storeId, nowMs) {
    if (!a || a.active === false) return false;
    if (a.expiresAt && Date.parse(a.expiresAt) < (nowMs || Date.now())) return false;
    if (a.target === 'some') return !!(a.storeIds && a.storeIds[storeId]);
    return true;
}
function wdtAnnouncementStatus(a, nowMs) {
    if (a.active === false) return 'stopped';
    if (a.expiresAt && Date.parse(a.expiresAt) < (nowMs || Date.now())) return 'expired';
    return 'live';
}
function wdtAnnouncementAudience(a, storeIds) {
    const audience = a.target === 'some' ? storeIds.filter(id => a.storeIds && a.storeIds[id]) : storeIds;
    const seen = audience.filter(id => a.seenBy && a.seenBy[id]).length;
    return { total: audience.length, seen };
}

// ----- What store staff see -----
function wdtSeenList(storeId) {
    try { const a = JSON.parse(localStorage.getItem('wd_ann_seen_' + storeId) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function wdtMarkSeenLocal(storeId, id) {
    try { const a = wdtSeenList(storeId); if (a.indexOf(id) === -1) a.push(id); localStorage.setItem('wd_ann_seen_' + storeId, JSON.stringify(a.slice(-100))); } catch (e) {}
}

function wdtShowAnnouncement(a, storeId, next) {
    let m = document.getElementById('wdt-ann-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdt-ann-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); justify-content:center; align-items:center; z-index:2500; padding:20px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    const important = a.level === 'important';
    m.innerHTML = `<div style="background:#fff; color:#0f172a; border-radius:14px; width:100%; max-width:420px; padding:22px; box-sizing:border-box; border-top:6px solid ${important ? '#f59e0b' : '#0284c7'}; box-shadow:0 10px 25px rgba(0,0,0,0.3);">
        <div style="font-size:12px; font-weight:bold; color:${important ? '#b45309' : '#0369a1'}; margin-bottom:6px;">${important ? '⚠ IMPORTANT NOTICE' : '📣 MESSAGE FROM WISE DECISION'}</div>
        ${a.title ? `<h3 style="margin:0 0 8px 0; font-size:18px;">${wdtEsc(a.title)}</h3>` : ''}
        <div style="font-size:14px; line-height:1.6; white-space:pre-wrap; margin-bottom:16px;">${wdtEsc(a.message)}</div>
        <button id="wdt-ann-ok" class="menu-btn btn-action-primary" style="justify-content:center; margin:0;">Got it</button></div>`;
    m.style.display = 'flex';
    document.getElementById('wdt-ann-ok').onclick = () => {
        m.style.display = 'none';
        wdtMarkSeenLocal(storeId, a.id);
        try { firebase.database().ref(`announcements/${a.id}/seenBy/${storeId}`).set(new Date().toISOString()).catch(() => {}); } catch (e) {}
        if (next) next();
    };
}

async function wdtCheckAnnouncements() {
    if (!currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
    if (typeof wdIsOffline === 'function' && wdIsOffline()) return;
    const storeId = currentStoreId;
    try {
        const snap = await wdtWithTimeout(firebase.database().ref('announcements').once('value'), 6000);
        const seen = wdtSeenList(storeId);
        const list = [];
        snap.forEach(c => { const a = Object.assign({ id: c.key }, c.val()); if (wdtAnnouncementApplies(a, storeId) && seen.indexOf(a.id) === -1) list.push(a); });
        list.sort((a, b) => (b.level === 'important') - (a.level === 'important') || String(b.createdAt).localeCompare(String(a.createdAt)));
        const showNext = () => { const a = list.shift(); if (a && currentStoreId === storeId) wdtShowAnnouncement(a, storeId, showNext); };
        showNext();
    } catch (e) { /* announcements are optional — never get in the way of work */ }
}

(function hookAnnouncementCheck() {
    const prev = window.switchView;
    if (typeof prev !== 'function') return;
    window.switchView = function (viewId) {
        const r = prev.apply(this, arguments);
        try {
            if (viewId === 'login-view') wdtAnnSession = false;
            else if (!wdtAnnSession && viewId !== 'register-view' && currentStoreId && currentStoreId !== 'SUPER_ADMIN') {
                wdtAnnSession = true;
                setTimeout(wdtCheckAnnouncements, 1500);
            }
        } catch (e) { /* never block navigation */ }
        return r;
    };
})();

// ----- Super Admin: write and manage announcements -----
async function wdtOpenAnnouncements() {
    if (currentUserRole !== 'SuperAdmin') return;
    wdtModal('📣 Announcements', '<div style="text-align:center; color:#64748b; padding:20px;">Loading...</div>');
    let items = [];
    try {
        const snap = await wdtWithTimeout(firebase.database().ref('announcements').once('value'), 15000);
        snap.forEach(c => items.push(Object.assign({ id: c.key }, c.val())));
    } catch (e) {
        wdtModal('📣 Announcements', `<div style="color:#b91c1c; padding:12px;">Could not load: ${wdtEsc(e.message)}</div>`);
        return;
    }
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const storeIds = (wdsStores || []).map(s => s.id);
    const now = Date.now();
    const list = items.length === 0 ? '<div style="text-align:center; color:#64748b; padding:10px;">No announcements yet.</div>' : items.map(a => {
        const status = wdtAnnouncementStatus(a, now);
        const aud = wdtAnnouncementAudience(a, storeIds);
        const badge = ({ live: ['#dcfce7', '#166534', 'LIVE'], expired: ['#fef3c7', '#92400e', 'EXPIRED'], stopped: ['#e2e8f0', '#334155', 'STOPPED'] })[status];
        const id = wdtEsc(a.id);
        return `<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                <strong style="font-size:13px;">${a.level === 'important' ? '⚠ ' : ''}${wdtEsc(a.title || (a.message || '').slice(0, 40))}</strong>
                <span style="font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px; background:${badge[0]}; color:${badge[1]};">${badge[2]}</span>
            </div>
            <div style="font-size:12px; color:#475569; margin:4px 0; white-space:pre-wrap;">${wdtEsc((a.message || '').slice(0, 160))}${(a.message || '').length > 160 ? '…' : ''}</div>
            <div style="font-size:11px; color:#64748b;">To ${a.target === 'some' ? aud.total + ' chosen store' + (aud.total === 1 ? '' : 's') : 'all stores'} · shown until ${wdtPretty(a.expiresAt)} · <strong>read by ${aud.seen} of ${aud.total}</strong></div>
            <div style="display:flex; gap:6px; margin-top:6px;">
                ${status === 'live' ? `<button data-id="${id}" onclick="wdtStopAnnouncement(this.dataset.id)" style="padding:5px 10px; font-size:11px; border-radius:6px; cursor:pointer; border:1px solid #fde68a; background:#fffbeb; color:#92400e;">Stop showing</button>` : ''}
                <button data-id="${id}" onclick="wdtDeleteAnnouncement(this.dataset.id)" style="padding:5px 10px; font-size:11px; border-radius:6px; cursor:pointer; border:1px solid #fecaca; background:#fef2f2; color:#991b1b;">Delete</button>
            </div></div>`;
    }).join('');

    const storeChecks = (wdsStores || []).map(s => `<label style="display:flex; align-items:center; gap:6px; font-size:12px; padding:3px 0;"><input type="checkbox" class="wdt-ann-store" value="${wdtEsc(s.id)}"> ${wdtEsc(s.name || s.id)}</label>`).join('');

    wdtModal('📣 Announcements', `
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:14px;">
            <div style="font-weight:bold; font-size:13px; margin-bottom:8px;">New announcement</div>
            <input id="wdt-ann-title" type="text" placeholder="Title (optional)" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:8px; box-sizing:border-box;">
            <textarea id="wdt-ann-message" rows="4" placeholder="Your message to the stores..." style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:8px; box-sizing:border-box;"></textarea>
            <div style="display:flex; gap:8px; margin-bottom:8px;">
                <select id="wdt-ann-level" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px;"><option value="info">📣 Normal</option><option value="important">⚠ Important</option></select>
                <input id="wdt-ann-until" type="date" value="${wdtAddDays(wdtToday(), 7)}" title="Show until" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">
            </div>
            <div style="font-size:12px; font-weight:bold; margin-bottom:4px;">Send to</div>
            <label style="display:flex; align-items:center; gap:6px; font-size:13px;"><input type="radio" name="wdt-ann-target" value="all" checked onchange="document.getElementById('wdt-ann-stores').style.display='none'"> All stores</label>
            <label style="display:flex; align-items:center; gap:6px; font-size:13px;"><input type="radio" name="wdt-ann-target" value="some" onchange="document.getElementById('wdt-ann-stores').style.display='block'"> Only some stores</label>
            <div id="wdt-ann-stores" style="display:none; max-height:130px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px; padding:6px 10px; margin:6px 0;">${storeChecks || '<em style="font-size:12px;">No stores</em>'}</div>
            <button class="menu-btn btn-action-primary" style="justify-content:center; margin:10px 0 0 0;" onclick="wdtPublishAnnouncement()">Publish</button>
        </div>
        <div style="font-weight:bold; font-size:13px; margin-bottom:6px;">Announcements</div>${list}`);
}

async function wdtPublishAnnouncement() {
    const message = document.getElementById('wdt-ann-message').value.trim();
    const title = document.getElementById('wdt-ann-title').value.trim();
    const level = document.getElementById('wdt-ann-level').value === 'important' ? 'important' : 'info';
    const until = document.getElementById('wdt-ann-until').value;
    const radios = document.getElementsByName('wdt-ann-target');
    let target = 'all';
    for (let i = 0; i < radios.length; i++) if (radios[i].checked) target = radios[i].value;

    if (!message) { alert("Write the message first."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until < wdtToday()) { alert("Pick a 'show until' date that is today or later."); return; }

    const storeIds = {};
    if (target === 'some') {
        document.querySelectorAll('.wdt-ann-store').forEach(c => { if (c.checked) storeIds[c.value] = true; });
        if (Object.keys(storeIds).length === 0) { alert("Choose at least one store, or send to all stores."); return; }
    }
    const [y, m, d] = until.split('-').map(Number);
    const rec = { title, message, level, target, createdAt: new Date().toISOString(), expiresAt: new Date(y, m - 1, d, 23, 59, 59).toISOString(), active: true };
    if (target === 'some') rec.storeIds = storeIds;

    try {
        await firebase.database().ref('announcements').push().set(rec);
        alert("Published. Each store sees it once, the next time their staff log in.");
        wdtOpenAnnouncements();
    } catch (e) { alert("Could not publish: " + e.message); }
}

async function wdtStopAnnouncement(id) {
    try { await firebase.database().ref(`announcements/${id}/active`).set(false); wdtOpenAnnouncements(); } catch (e) { alert("Failed: " + e.message); }
}
async function wdtDeleteAnnouncement(id) {
    if (!confirm("Delete this announcement?")) return;
    try { await firebase.database().ref(`announcements/${id}`).remove(); wdtOpenAnnouncements(); } catch (e) { alert("Failed: " + e.message); }
}

// =====================================================================
// Buttons on the Super Admin screen
// =====================================================================
function wdsAfterRender() { wdtUpdateToolbar(); }

function wdtUpdateToolbar() {
    const bar = document.getElementById('wds-extra-toolbar');
    if (!bar || currentUserRole !== 'SuperAdmin') return;
    const mk = (id, label, fn, style) => {
        let b = document.getElementById(id);
        if (!b) {
            b = document.createElement('button');
            b.id = id;
            b.className = 'menu-btn';
            b.style.cssText = 'width:auto; margin:0; padding:8px 12px; font-size:12px; background:#f1f5f9; border:1px solid #cbd5e1;' + (style || '');
            b.onclick = fn;
            bar.appendChild(b);
        }
        return b;
    };
    mk('wdt-btn-ann', '📣 Announcements', wdtOpenAnnouncements, 'background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8;');
    const u = mk('wdt-btn-usage', '📊 Load usage', wdtLoadUsage, 'background:#f5f3ff; border-color:#ddd6fe; color:#6d28d9;');
    if (!wdtUsageBusy) u.textContent = Object.keys(wdtUsage).length ? '📊 Refresh usage' : '📊 Load usage';
    const n = (wdsBinned || []).length;
    const ready = (wdsBinned || []).filter(s => wdtBinDaysLeft(s.binnedAt) <= 0).length;
    mk('wdt-btn-bin', '', wdtOpenBin, 'color:#475569;').textContent = `🗑 Bin (${n})${ready ? ` · ${ready} ready to delete` : ''}`;
}
setInterval(function () { try { wdtUpdateToolbar(); } catch (e) {} }, 1500);
