// ==================== WISE DECISION FEATURES PATCH (v25) ====================
// Load AFTER script.js (and the other patches), with `defer`.
//
// Adds:
//   1. Day Summary  – end-of-day report (sales, cash/transfer/credit, refunds, expenses,
//                     expected cash in drawer + cash-count check, per-cashier, top items)
//                     with Print and WhatsApp buttons
//   2. Reorder List – low / about-to-run-out items grouped by their last supplier, with
//                     suggested quantities and a WhatsApp order message per supplier
//   3. Debt reminders – "Remind" button for customers who owe (opens WhatsApp)
//   4. Exports      – Inventory, Sales, Customers and Expenses to CSV (opens in Excel)

console.log("Wise Decision features-patch.js — v25 loaded");

// ---------- Helpers ----------
function wdfNum(n) { return Number(n) || 0; }
function wdfRound2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function wdfMoney(n) { return '₦' + wdfRound2(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function wdfEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wdfWithTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('The connection is too slow or offline — try again when you have internet.')), ms);
        promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
}
function wdfTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function wdfDayBounds(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return { startMs: new Date(y, m - 1, d, 0, 0, 0, 0).getTime(), endMs: new Date(y, m - 1, d, 23, 59, 59, 999).getTime() };
}
function wdfInRange(iso, startMs, endMs) {
    const t = new Date(iso).getTime();
    return !isNaN(t) && t >= startMs && t <= endMs;
}
function wdfBusinessName() {
    const el = document.getElementById('dashboard-store-title');
    return (el && el.textContent.trim()) || 'Wise Decision';
}
function wdfBranchLabel(branchId) {
    if (branchId === 'all') return 'All Branches';
    return typeof branchNameOf === 'function' ? branchNameOf(branchId) : branchId;
}
function wdfUnitLabel(u) { return u === 'Piece' ? 'pc' : ((u === 'Kg' || u === 'g') ? u.toLowerCase() : 'pack'); }

// Nigerian-friendly WhatsApp number: 0801… -> 234801…, +234… -> 234…
function wdfWaNumber(phone) {
    let p = String(phone || '').replace(/[^\d+]/g, '');
    if (!p) return '';
    if (p.charAt(0) === '+') p = p.slice(1);
    else if (p.indexOf('00') === 0) p = p.slice(2);
    else if (p.charAt(0) === '0') p = '234' + p.slice(1);
    else if (/^\d{10}$/.test(p)) p = '234' + p;
    return p;
}
function wdfOpenWhatsApp(phone, text) {
    const number = wdfWaNumber(phone);
    const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

// ---------- Simple pop-up used by the new screens ----------
function wdfShowModal(title, bodyHtml, footerHtml) {
    let m = document.getElementById('wdf-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdf-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.6); justify-content:center; align-items:center; z-index:1200; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = `
        <div style="background:#fff; border-radius:12px; width:100%; max-width:540px; max-height:92vh; overflow-y:auto; padding:18px; box-sizing:border-box; border:1px solid #e2e8f0; box-shadow:0 10px 25px rgba(0,0,0,0.25);">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;">
                <h3 style="margin:0; font-size:17px; color:var(--text);">${wdfEsc(title)}</h3>
                <button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdfCloseModal()">✕ Close</button>
            </div>
            <div id="wdf-modal-body">${bodyHtml}</div>
            ${footerHtml ? `<div id="wdf-modal-footer" style="display:flex; gap:8px; flex-wrap:wrap; margin-top:14px;">${footerHtml}</div>` : ''}
        </div>`;
    m.style.display = 'flex';
}
function wdfCloseModal() {
    const m = document.getElementById('wdf-modal');
    if (m) m.style.display = 'none';
}

// =====================================================================
// 1. DAY SUMMARY
// =====================================================================
function wdfComputeDaySummary(input) {
    const startMs = input.startMs, endMs = input.endMs, branchId = input.branchId;
    const inBranch = b => branchId === 'all' || (b || 'main') === branchId;

    const out = {
        count: 0, revenue: 0, cash: 0, transfer: 0, credit: 0,
        refunds: { count: 0, total: 0, cash: 0, transfer: 0, balance: 0 },
        expenses: { total: 0, byCategory: {} },
        debt: { included: false, total: 0, cash: 0, transfer: 0 },
        cashiers: [], topItems: []
    };
    const cashiers = {}, items = {};

    (input.transactions || []).forEach(tx => {
        if (!wdfInRange(tx.date, startMs, endMs) || !inBranch(tx.branchId)) return;
        const total = wdfNum(tx.totalAmount);
        const pb = tx.paymentBreakdown;
        const cash = pb ? wdfNum(pb.cash) : total;
        const transfer = pb ? wdfNum(pb.transfer) : 0;
        const credit = pb ? wdfNum(pb.credit) : 0;

        out.count++; out.revenue += total; out.cash += cash; out.transfer += transfer; out.credit += credit;

        const who = tx.staff || tx.soldBy || 'Staff';
        cashiers[who] = cashiers[who] || { name: who, count: 0, total: 0 };
        cashiers[who].count++; cashiers[who].total += total;

        (tx.items || []).forEach(it => {
            const unit = it.saleUnit || 'Pack';
            const key = (it.name || 'Item') + '|' + unit;
            const refunded = wdfNum(it.refundedQty);
            const qty = wdfNum(it.qty) - refunded;
            const amount = wdfNum(it.total) - refunded * wdfNum(it.price);
            items[key] = items[key] || { name: it.name || 'Item', unit, qty: 0, amount: 0 };
            items[key].qty += qty; items[key].amount += amount;
        });
    });

    (input.refunds || []).forEach(r => {
        if (!wdfInRange(r.date, startMs, endMs) || !inBranch(r.branchId)) return;
        const t = wdfNum(r.totalRefund);
        out.refunds.count++; out.refunds.total += t;
        if (r.method === 'Cash') out.refunds.cash += t;
        else if (r.method === 'Customer Balance') out.refunds.balance += t;
        else out.refunds.transfer += t;
    });

    (input.expenses || []).forEach(e => {
        if (!wdfInRange(e.date, startMs, endMs) || !inBranch(e.branchId)) return;
        const a = wdfNum(e.amount);
        out.expenses.total += a;
        const cat = e.category || 'Other';
        out.expenses.byCategory[cat] = (out.expenses.byCategory[cat] || 0) + a;
    });

    // Debt repayments live on each customer's ledger and aren't tied to a branch,
    // so they're only counted in the "All Branches" view.
    if (branchId === 'all' && input.customers) {
        out.debt.included = true;
        Object.keys(input.customers).forEach(cid => {
            const ledger = (input.customers[cid] || {}).ledger || {};
            Object.keys(ledger).forEach(k => {
                const l = ledger[k];
                if (!l || l.type !== 'payment' || !wdfInRange(l.date, startMs, endMs)) return;
                const a = wdfNum(l.amount);
                out.debt.total += a;
                if (l.method === 'Cash') out.debt.cash += a; else out.debt.transfer += a;
            });
        });
    }

    out.netSales = out.revenue - out.refunds.total;
    out.expectedCash = out.cash + out.debt.cash - out.refunds.cash - out.expenses.total;
    out.expectedTransfer = out.transfer + out.debt.transfer - out.refunds.transfer;

    out.cashiers = Object.keys(cashiers).map(k => cashiers[k]).sort((a, b) => b.total - a.total);
    out.topItems = Object.keys(items).map(k => items[k]).filter(i => i.qty > 0).sort((a, b) => b.amount - a.amount).slice(0, 10);

    ['revenue', 'cash', 'transfer', 'credit', 'netSales', 'expectedCash', 'expectedTransfer'].forEach(k => { out[k] = wdfRound2(out[k]); });
    ['total', 'cash', 'transfer', 'balance'].forEach(k => { out.refunds[k] = wdfRound2(out.refunds[k]); out.debt[k] = wdfRound2(out.debt[k]); });
    out.expenses.total = wdfRound2(out.expenses.total);
    return out;
}

let wdfSumCtx = { date: '', branch: 'all' };
let wdfSummary = null;

function wdfSummaryHtml(s, counted) {
    const row = (label, value, bold) => `<tr><td style="padding:3px 2px;${bold ? 'font-weight:bold;' : ''}">${label}</td><td style="padding:3px 2px; text-align:right;${bold ? 'font-weight:bold;' : ''}">${value}</td></tr>`;
    const head = t => `<tr><td colspan="2" style="padding:8px 2px 2px; font-weight:bold; border-bottom:1px dashed #000;">${t}</td></tr>`;

    let html = `<div style="text-align:center; font-weight:bold; font-size:14px;">${wdfEsc(wdfBusinessName())}</div>
        <div style="text-align:center; font-weight:bold;">DAY SUMMARY</div>
        <div style="text-align:center; font-size:11px; margin-bottom:6px;">${wdfEsc(wdfSumCtx.date)} · ${wdfEsc(wdfBranchLabel(wdfSumCtx.branch))}</div>
        <table style="width:100%; font-size:12px;">`;

    html += head('SALES');
    html += row('Receipts', s.count);
    html += row('Total sales', wdfMoney(s.revenue), true);
    html += row('&nbsp;&nbsp;Cash', wdfMoney(s.cash));
    html += row('&nbsp;&nbsp;Transfer / POS', wdfMoney(s.transfer));
    html += row('&nbsp;&nbsp;Credit (owed)', wdfMoney(s.credit));

    html += head('REFUNDS');
    html += row(`Refunds (${s.refunds.count})`, wdfMoney(s.refunds.total), true);
    if (s.refunds.total) {
        html += row('&nbsp;&nbsp;Paid in cash', wdfMoney(s.refunds.cash));
        html += row('&nbsp;&nbsp;Paid by transfer', wdfMoney(s.refunds.transfer));
        html += row('&nbsp;&nbsp;Off customer debt', wdfMoney(s.refunds.balance));
    }
    html += row('Net sales (after refunds)', wdfMoney(s.netSales), true);

    html += head('EXPENSES');
    html += row('Total expenses', wdfMoney(s.expenses.total), true);
    Object.keys(s.expenses.byCategory).forEach(c => { html += row('&nbsp;&nbsp;' + wdfEsc(c), wdfMoney(s.expenses.byCategory[c])); });

    if (s.debt.included) {
        html += head('DEBT PAYMENTS RECEIVED');
        html += row('Total received', wdfMoney(s.debt.total), true);
        html += row('&nbsp;&nbsp;Cash', wdfMoney(s.debt.cash));
        html += row('&nbsp;&nbsp;Transfer / POS', wdfMoney(s.debt.transfer));
    }

    html += head('MONEY SHOULD BE');
    html += row('Cash in drawer', wdfMoney(s.expectedCash), true);
    html += row('In bank / POS', wdfMoney(s.expectedTransfer), true);
    if (counted !== null && counted !== undefined && counted !== '') {
        const diff = wdfRound2(wdfNum(counted) - s.expectedCash);
        html += row('Cash counted', wdfMoney(counted));
        html += row(diff === 0 ? 'Cash balances' : (diff > 0 ? 'OVER by' : 'SHORT by'), wdfMoney(Math.abs(diff)), true);
    }

    if (s.cashiers.length) {
        html += head('SALES BY CASHIER');
        s.cashiers.forEach(c => { html += row(`${wdfEsc(c.name)} (${c.count})`, wdfMoney(c.total)); });
    }
    if (s.topItems.length) {
        html += head('TOP ITEMS');
        s.topItems.forEach(i => { html += row(`${wdfEsc(i.name)} × ${wdfRound2(i.qty)} ${wdfUnitLabel(i.unit)}`, wdfMoney(i.amount)); });
    }
    html += '</table>';
    return html;
}

function wdfSummaryText(s, counted) {
    const L = [];
    L.push(`*${wdfBusinessName()} — DAY SUMMARY*`);
    L.push(`${wdfSumCtx.date} · ${wdfBranchLabel(wdfSumCtx.branch)}`);
    L.push('');
    L.push(`Receipts: ${s.count}`);
    L.push(`Total sales: ${wdfMoney(s.revenue)}`);
    L.push(`  Cash: ${wdfMoney(s.cash)}`);
    L.push(`  Transfer/POS: ${wdfMoney(s.transfer)}`);
    L.push(`  Credit: ${wdfMoney(s.credit)}`);
    L.push(`Refunds: ${wdfMoney(s.refunds.total)}`);
    L.push(`Net sales: ${wdfMoney(s.netSales)}`);
    L.push(`Expenses: ${wdfMoney(s.expenses.total)}`);
    if (s.debt.included) L.push(`Debt payments received: ${wdfMoney(s.debt.total)}`);
    L.push('');
    L.push(`Cash should be: ${wdfMoney(s.expectedCash)}`);
    L.push(`Bank/POS should be: ${wdfMoney(s.expectedTransfer)}`);
    if (counted !== null && counted !== undefined && counted !== '') {
        const diff = wdfRound2(wdfNum(counted) - s.expectedCash);
        L.push(`Cash counted: ${wdfMoney(counted)} (${diff === 0 ? 'balances' : (diff > 0 ? 'OVER by ' : 'SHORT by ') + wdfMoney(Math.abs(diff))})`);
    }
    return L.join('\n');
}

function wdfCountedValue() {
    const el = document.getElementById('wdf-cash-counted');
    return el ? el.value : '';
}

function wdfUpdateCashDiff() {
    const box = document.getElementById('wdf-cash-diff');
    if (!box || !wdfSummary) return;
    const counted = wdfCountedValue();
    if (counted === '') { box.innerHTML = ''; return; }
    const diff = wdfRound2(wdfNum(counted) - wdfSummary.expectedCash);
    if (diff === 0) box.innerHTML = '<span style="color:#166534; font-weight:bold;">✔ Cash balances</span>';
    else if (diff > 0) box.innerHTML = `<span style="color:#b45309; font-weight:bold;">Over by ${wdfMoney(diff)}</span>`;
    else box.innerHTML = `<span style="color:#b91c1c; font-weight:bold;">Short by ${wdfMoney(-diff)}</span>`;
}

async function wdfLoadDaySummary() {
    const dateEl = document.getElementById('wdf-sum-date');
    const branchEl = document.getElementById('wdf-sum-branch');
    const content = document.getElementById('wdf-sum-content');
    if (!content) return;

    wdfSumCtx = { date: (dateEl && dateEl.value) || wdfTodayStr(), branch: (branchEl && branchEl.value) || 'all' };
    content.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px;">Loading...</div>';
    wdfSummary = null;

    try {
        const { startMs, endMs } = wdfDayBounds(wdfSumCtx.date);
        const root = firebase.database().ref(`stores/${currentStoreId}`);
        const q = node => root.child(node).orderByChild('date').startAt(new Date(startMs).toISOString()).endAt(new Date(endMs).toISOString()).once('value');
        const [txSnap, expSnap, refSnap] = await wdfWithTimeout(Promise.all([q('transactions'), q('expenses'), q('refunds')]), 12000);

        const toList = snap => { const a = []; snap.forEach(c => a.push(c.val())); return a; };
        wdfSummary = wdfComputeDaySummary({
            startMs, endMs, branchId: wdfSumCtx.branch,
            transactions: toList(txSnap), expenses: toList(expSnap), refunds: toList(refSnap),
            customers: typeof customersCache !== 'undefined' ? customersCache : null
        });

        content.innerHTML = `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">${wdfSummaryHtml(wdfSummary, null)}</div>
            <div style="margin-top:12px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px;">
                <label style="display:block; font-size:12px; font-weight:bold; color:#92400e; margin-bottom:4px;">💵 Cash counted in the drawer (₦)</label>
                <input type="number" id="wdf-cash-counted" placeholder="Type the cash you counted" oninput="wdfUpdateCashDiff()" style="width:100%; padding:9px; border:1px solid #fcd34d; border-radius:6px; box-sizing:border-box;">
                <div id="wdf-cash-diff" style="margin-top:6px; font-size:13px;"></div>
                <div style="font-size:10px; color:#92400e; margin-top:4px;">Expenses are treated as paid from cash. Debt payments are included only in the "All Branches" view.</div>
            </div>`;
    } catch (e) {
        content.innerHTML = `<div style="color:#b91c1c; padding:12px;">Could not load the summary: ${wdfEsc(e.message)}</div>`;
    }
}

function wdfOpenDaySummary() {
    if (!currentStoreId) return;
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Accountant') {
        alert("Access Restricted: only the Admin or Accountant can view the Day Summary.");
        return;
    }

    const dateInput = document.getElementById('sales-date-filter');
    const date = (dateInput && dateInput.value) || wdfTodayStr();
    let branch;
    let branchControl;
    if (currentUserRole === 'Admin') {
        branch = (typeof currentReportBranchFilter !== 'undefined' && document.getElementById('sales-branch-filter')) ? currentReportBranchFilter : currentBranch;
        const opts = ['<option value="all">🌐 All Branches</option>'].concat(Object.keys(branchesCache).map(id => `<option value="${wdfEsc(id)}">${wdfEsc(branchesCache[id].name)}</option>`)).join('');
        branchControl = `<select id="wdf-sum-branch" onchange="wdfLoadDaySummary()" style="padding:7px; border:1px solid #cbd5e1; border-radius:6px;">${opts}</select>`;
    } else {
        branch = currentBranch;
        branchControl = `<select id="wdf-sum-branch" disabled style="padding:7px; border:1px solid #cbd5e1; border-radius:6px;"><option value="${wdfEsc(branch)}">${wdfEsc(wdfBranchLabel(branch))}</option></select>`;
    }

    wdfShowModal('📋 Day Summary', `
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">
            <input type="date" id="wdf-sum-date" value="${wdfEsc(date)}" onchange="wdfLoadDaySummary()" style="padding:7px; border:1px solid #cbd5e1; border-radius:6px;">
            ${branchControl}
        </div>
        <div id="wdf-sum-content"></div>`,
        `<button class="menu-btn btn-action-primary" style="width:auto; margin:0;" onclick="wdfPrintSummary()">🖨 Print</button>
         <button class="menu-btn" style="width:auto; margin:0; background:#dcfce7; border:1px solid #86efac; color:#166534;" onclick="wdfWhatsappSummary()">📲 Send on WhatsApp</button>`);

    const bEl = document.getElementById('wdf-sum-branch');
    if (bEl) bEl.value = branch;
    wdfLoadDaySummary();
}

function wdfPrintSummary() {
    if (!wdfSummary) { alert("Nothing to print yet."); return; }
    triggerThermalPrint(wdfSummaryHtml(wdfSummary, wdfCountedValue()));
}
function wdfWhatsappSummary() {
    if (!wdfSummary) { alert("Nothing to send yet."); return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(wdfSummaryText(wdfSummary, wdfCountedValue())), '_blank');
}

// =====================================================================
// 2. REORDER LIST
// =====================================================================
function wdfStockLabel(item) {
    const stock = wdfNum(item.stock !== undefined ? item.stock : item.stockQty);
    if (item.soldByWeight) return `${wdfRound2(stock)} ${(item.weightUnit || 'Kg').toLowerCase()}`;
    const upp = wdfNum(item.unitsPerPack) || 1;
    if (upp > 1) return `${Math.floor(stock / upp)} Pks + ${wdfRound2(stock % upp)} Pcs`;
    return String(wdfRound2(stock));
}

function wdfComputeReorder(input) {
    const items = input.items || {};
    const cover = input.coverDays || 14;
    const days = input.days || 30;

    const sold = {};
    (input.sales || []).forEach(tx => {
        (tx.items || []).forEach(it => {
            if (!it.id) return;
            const qty = wdfNum(it.qty);
            const pieces = wdfNum(it.piecesNeeded !== undefined ? it.piecesNeeded : it.qty);
            const refundedPieces = qty > 0 ? wdfNum(it.refundedQty) * (pieces / qty) : 0;
            sold[it.id] = (sold[it.id] || 0) + Math.max(0, pieces - refundedPieces);
        });
    });

    const byId = {}, byName = {};
    (input.supplies || []).slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).forEach(s => {
        (s.items || []).forEach(line => {
            const sup = { id: s.supplierId, name: s.supplierName || 'Supplier' };
            if (line.productId && !byId[line.productId]) byId[line.productId] = sup;
            const n = (line.name || '').toLowerCase().trim();
            if (n && !byName[n]) byName[n] = sup;
        });
    });

    const groups = {};
    Object.keys(items).forEach(id => {
        const item = items[id];
        if (!item || typeof item !== 'object') return;
        const stock = wdfNum(item.stock !== undefined ? item.stock : item.stockQty);
        const threshold = (item.lowStockThreshold !== undefined && item.lowStockThreshold !== null) ? wdfNum(item.lowStockThreshold) : 5;
        const daily = (sold[id] || 0) / days;
        const daysLeft = daily > 0 ? stock / daily : null;

        const isLow = stock <= threshold;
        const runningOut = daysLeft !== null && daysLeft <= 7;
        if (!isLow && !runningOut) return;

        const upp = wdfNum(item.unitsPerPack) || 1;
        let suggestPieces = null;
        if (daily > 0) suggestPieces = Math.max(1, Math.ceil(daily * cover - stock));

        let suggestLabel = null;
        if (suggestPieces !== null) {
            if (item.soldByWeight) suggestLabel = `${Math.ceil(suggestPieces * 10) / 10} ${(item.weightUnit || 'Kg').toLowerCase()}`;
            else if (upp > 1) { const packs = Math.ceil(suggestPieces / upp); suggestLabel = `${packs} pack${packs === 1 ? '' : 's'} (${packs * upp} pcs)`; }
            else suggestLabel = `${suggestPieces}`;
        }

        const sup = byId[id] || byName[(item.name || item.productName || '').toLowerCase().trim()] || null;
        const gKey = sup ? (sup.id || sup.name) : '__none__';
        groups[gKey] = groups[gKey] || { supplierId: sup ? sup.id : null, supplierName: sup ? sup.name : 'No supplier on record', items: [] };
        groups[gKey].items.push({
            id, name: item.name || item.productName || 'Unnamed Item',
            stockLabel: wdfStockLabel(item), stock, threshold,
            daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
            suggestLabel, reason: stock <= 0 ? 'Out of stock' : (isLow ? 'Low stock' : 'Running out soon')
        });
    });

    const list = Object.keys(groups).map(k => groups[k]);
    list.forEach(g => g.items.sort((a, b) => (a.daysLeft === null ? 9999 : a.daysLeft) - (b.daysLeft === null ? 9999 : b.daysLeft) || a.stock - b.stock));
    list.sort((a, b) => (a.supplierId === null) - (b.supplierId === null) || a.supplierName.localeCompare(b.supplierName));
    return list;
}

let wdfReorderState = { groups: [], branchLabel: '' };

async function wdfOpenReorder() {
    if (!currentStoreId) return;
    if (currentUserRole !== 'Admin') { alert("Access Restricted: only the Admin can view the Reorder List."); return; }

    const branch = (typeof currentInventoryBranchFilter !== 'undefined' && currentInventoryBranchFilter && currentInventoryBranchFilter !== 'all') ? currentInventoryBranchFilter : currentBranch;
    wdfShowModal('🛒 Reorder List', '<div style="text-align:center; color:var(--text-muted); padding:20px;">Working out what to reorder...</div>', '');

    try {
        const root = firebase.database().ref(`stores/${currentStoreId}`);
        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const [invSnap, txSnap, supSnap] = await wdfWithTimeout(Promise.all([
            root.child(`inventory/${branch}`).once('value'),
            root.child('transactions').orderByChild('date').startAt(since).once('value'),
            root.child('supplies').orderByChild('date').limitToLast(500).once('value')
        ]), 15000);

        const sales = [], supplies = [];
        txSnap.forEach(c => { const t = c.val(); if ((t.branchId || 'main') === branch) sales.push(t); });
        supSnap.forEach(c => supplies.push(c.val()));

        const groups = wdfComputeReorder({ items: invSnap.val() || {}, sales, supplies });
        wdfReorderState = { groups, branchLabel: wdfBranchLabel(branch) };

        if (groups.length === 0) {
            wdfShowModal('🛒 Reorder List', `<div style="padding:16px; text-align:center; color:#166534;">✅ Nothing needs reordering at ${wdfEsc(wdfReorderState.branchLabel)} right now.</div>`, '');
            return;
        }

        let body = `<div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">${wdfEsc(wdfReorderState.branchLabel)} — items that are low, or will run out within about a week at the current selling speed. Suggested quantities cover roughly two weeks of sales.</div>`;
        groups.forEach((g, gi) => {
            const sup = g.supplierId && typeof suppliersCache !== 'undefined' ? suppliersCache[g.supplierId] : null;
            body += `<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
                    <strong>🚚 ${wdfEsc(g.supplierName)}${sup && sup.phone ? ` <small style="color:var(--text-muted);">${wdfEsc(sup.phone)}</small>` : ''}</strong>
                    ${sup && sup.phone ? `<button class="menu-btn" style="width:auto; margin:0; padding:4px 10px; font-size:11px; background:#dcfce7; border:1px solid #86efac; color:#166534;" onclick="wdfReorderWhatsapp(${gi})">📲 Order on WhatsApp</button>` : ''}
                </div>
                <table style="width:100%; font-size:12px;">
                    <thead><tr><th style="text-align:left;">Item</th><th style="text-align:left;">In stock</th><th style="text-align:left;">Order</th></tr></thead>
                    <tbody>${g.items.map(i => `<tr>
                        <td>${wdfEsc(i.name)}<br><small style="color:${i.reason === 'Running out soon' ? '#b45309' : '#b91c1c'};">${i.reason}${i.daysLeft !== null ? ` · ~${i.daysLeft} days left` : ''}</small></td>
                        <td>${wdfEsc(i.stockLabel)}</td>
                        <td>${i.suggestLabel ? wdfEsc(i.suggestLabel) : '<span style="color:var(--text-muted);">—</span>'}</td>
                    </tr>`).join('')}</tbody>
                </table></div>`;
        });

        wdfShowModal('🛒 Reorder List', body, `<button class="menu-btn btn-action-primary" style="width:auto; margin:0;" onclick="wdfPrintReorder()">🖨 Print list</button>`);
    } catch (e) {
        wdfShowModal('🛒 Reorder List', `<div style="color:#b91c1c; padding:12px;">Could not build the list: ${wdfEsc(e.message)}</div>`, '');
    }
}

function wdfReorderMessage(g) {
    const lines = g.items.map(i => `• ${i.name}: ${i.suggestLabel || '____'}`);
    return `Hello ${g.supplierName}, please we need to restock the following for ${wdfBusinessName()}:\n\n${lines.join('\n')}\n\nKindly confirm availability and price. Thank you.`;
}
function wdfReorderWhatsapp(gi) {
    const g = wdfReorderState.groups[gi];
    if (!g) return;
    const sup = g.supplierId && typeof suppliersCache !== 'undefined' ? suppliersCache[g.supplierId] : null;
    wdfOpenWhatsApp(sup ? sup.phone : '', wdfReorderMessage(g));
}
function wdfPrintReorder() {
    let html = `<div style="text-align:center; font-weight:bold;">${wdfEsc(wdfBusinessName())}</div>
        <div style="text-align:center; font-weight:bold;">REORDER LIST</div>
        <div style="text-align:center; font-size:11px; margin-bottom:6px;">${wdfEsc(wdfReorderState.branchLabel)} · ${wdfEsc(wdfTodayStr())}</div>`;
    wdfReorderState.groups.forEach(g => {
        html += `<div style="font-weight:bold; margin-top:8px; border-bottom:1px dashed #000;">${wdfEsc(g.supplierName)}</div><table style="width:100%; font-size:12px;">`;
        g.items.forEach(i => { html += `<tr><td>${wdfEsc(i.name)}</td><td style="text-align:right;">${wdfEsc(i.stockLabel)} → ${i.suggestLabel ? wdfEsc(i.suggestLabel) : '____'}</td></tr>`; });
        html += '</table>';
    });
    triggerThermalPrint(html);
}

// =====================================================================
// 3. DEBT REMINDERS
// =====================================================================
function wdfRemindCustomer(id) {
    const c = customersCache[id];
    if (!c) return;
    const bal = wdfNum(c.balance);
    if (bal <= 0) { alert(`${c.name} doesn't owe anything.`); return; }

    const msg = `Hello ${c.name}, this is ${wdfBusinessName()}. Our records show an outstanding balance of ${wdfMoney(bal)} as at ${new Date().toLocaleDateString()}. Kindly make the payment at your earliest convenience. Thank you for your patronage.`;
    if (!wdfWaNumber(c.phone)) {
        prompt(`${c.name} has no phone number saved. Copy this message:`, msg);
        return;
    }
    wdfOpenWhatsApp(c.phone, msg);
}

// Customers table: same as before, plus a Remind button for people who owe (and names are escaped)
function renderCustomersTable(dataset) {
    const tbody = document.getElementById('customers-body');
    if (!tbody) return;

    const ids = Object.keys(dataset || {});
    const rowsHtml = ids.map(id => {
        const c = dataset[id];
        const balance = Number(c.balance) || 0;
        const limit = Number(c.creditLimit) || 0;
        const spent = Number(c.totalSpent) || 0;
        const visits = Number(c.visitCount) || 0;
        const balanceColor = balance > 0 ? '#b91c1c' : '#166534';
        const remindBtn = balance > 0
            ? `<button class="menu-btn" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block; background:#dcfce7; border:1px solid #86efac; color:#166534;" onclick="wdfRemindCustomer('${id}')">📲 Remind</button>`
            : '';

        return `
            <tr>
                <td><strong>${wdfEsc(c.name || 'Unnamed')}</strong></td>
                <td>${wdfEsc(c.phone || 'N/A')}</td>
                <td style="color:${balanceColor}; font-weight:bold;">₦${balance.toLocaleString()}</td>
                <td>₦${limit.toLocaleString()}</td>
                <td>₦${spent.toLocaleString()}</td>
                <td>${visits}</td>
                <td>
                    <button class="menu-btn btn-dash" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="openCustomerProfile('${id}')">View</button>
                    ${remindBtn}
                    <button class="menu-btn" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="openAddCustomerModal('${id}')">Edit</button>
                    <button class="menu-btn btn-logout" style="padding: 4px 8px; font-size:11px; width:auto; display:inline-block;" onclick="deleteCustomer('${id}')">Delete</button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = ids.length === 0
        ? `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 20px;">No customers registered yet. Click "Add New Customer" to get started.</td></tr>`
        : rowsHtml.join('');
}

// Reminder button inside the customer profile window
(function wrapProfileSummary() {
    const prev = window.refreshCustomerProfileSummary;
    if (typeof prev !== 'function') return;
    window.refreshCustomerProfileSummary = function (id) {
        const r = prev.apply(this, arguments);
        try {
            const payBtn = document.getElementById('profile-record-payment-btn');
            if (payBtn && payBtn.parentElement) {
                let btn = document.getElementById('wdf-profile-remind-btn');
                if (!btn) {
                    btn = document.createElement('button');
                    btn.id = 'wdf-profile-remind-btn';
                    btn.className = 'menu-btn';
                    btn.style.cssText = 'width:auto; margin:0; background:#dcfce7; border:1px solid #86efac; color:#166534;';
                    btn.textContent = '📲 Remind on WhatsApp';
                    payBtn.parentElement.appendChild(btn);
                }
                btn.onclick = () => wdfRemindCustomer(id);
                const c = customersCache[id];
                btn.style.display = (c && wdfNum(c.balance) > 0) ? 'inline-flex' : 'none';
            }
        } catch (e) { console.warn(e); }
        return r;
    };
})();

// =====================================================================
// 4. CSV EXPORTS (open in Excel / Google Sheets)
// =====================================================================
function wdfCsvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // stops spreadsheet formula injection from names/notes
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
}
function wdfCsvText(rows) { return '\uFEFF' + rows.map(r => r.map(wdfCsvCell).join(',')).join('\r\n'); }

function wdfDownloadCsv(filename, rows) {
    const blob = new Blob([wdfCsvText(rows)], { type: 'text/csv;charset=utf-8' });
    const anchorDownload = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    };
    try {
        const file = (typeof File !== 'undefined') ? new File([blob], filename, { type: 'text/csv' }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: filename }).catch(err => { if (!err || err.name !== 'AbortError') anchorDownload(); });
            return;
        }
    } catch (e) { /* fall through */ }
    anchorDownload();
}

function wdfAskDateRange() {
    const d = new Date();
    const first = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const from = prompt("Start date (YYYY-MM-DD):", first);
    if (from === null) return null;
    const to = prompt("End date (YYYY-MM-DD):", wdfTodayStr());
    if (to === null) return null;
    const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
    if (!ok(from) || !ok(to)) { alert("Please enter dates like 2026-09-19."); return null; }
    return { from: from.trim(), to: to.trim() };
}

async function wdfExportInventory() {
    try {
        const snap = await wdfWithTimeout(firebase.database().ref(`stores/${currentStoreId}/inventory`).once('value'), 15000);
        const filter = (typeof currentInventoryBranchFilter !== 'undefined') ? currentInventoryBranchFilter : 'all';
        const rows = [['Branch', 'Product', 'Category', 'Cost Price', 'Retail Price', 'Wholesale Price', 'Pieces per Pack', 'Piece Price', 'Stock (raw units)', 'Stock (readable)', 'Sold by weight', 'Expiry', 'Low-stock alert at']];
        snap.forEach(b => {
            if (filter !== 'all' && b.key !== filter) return;
            b.forEach(p => {
                const it = p.val() || {};
                rows.push([wdfBranchLabel(b.key), it.name || it.productName || '', it.category || '', wdfNum(it.costPrice), wdfNum(it.price !== undefined ? it.price : it.retailPrice), wdfNum(it.wholesalePrice),
                    wdfNum(it.unitsPerPack) || 1, wdfNum(it.piecePrice), wdfNum(it.stock !== undefined ? it.stock : it.stockQty), wdfStockLabel(it), it.soldByWeight ? 'Yes' : 'No', it.expiry || it.expiryDate || '', it.lowStockThreshold === undefined || it.lowStockThreshold === null ? '' : it.lowStockThreshold]);
            });
        });
        wdfDownloadCsv(`inventory_${wdfTodayStr()}.csv`, rows);
    } catch (e) { alert("Export failed: " + e.message); }
}

async function wdfExportSales() {
    const range = wdfAskDateRange();
    if (!range) return;
    try {
        const start = wdfDayBounds(range.from).startMs, end = wdfDayBounds(range.to).endMs;
        const branchFilter = (currentUserRole === 'Admin' && typeof currentReportBranchFilter !== 'undefined') ? currentReportBranchFilter : currentBranch;
        const snap = await wdfWithTimeout(firebase.database().ref(`stores/${currentStoreId}/transactions`).orderByChild('date').startAt(new Date(start).toISOString()).endAt(new Date(end).toISOString()).once('value'), 20000);

        const rows = [['Receipt ID', 'Date', 'Time', 'Branch', 'Cashier', 'Customer', 'Items', 'Total', 'Cash', 'Transfer/POS', 'Credit', 'Refunded', 'Status']];
        const list = [];
        snap.forEach(c => list.push(c.val()));
        list.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)).forEach(tx => {
            if (branchFilter !== 'all' && (tx.branchId || 'main') !== branchFilter) return;
            const d = new Date(tx.date);
            const pb = tx.paymentBreakdown;
            const total = wdfNum(tx.totalAmount);
            rows.push([tx.txId || '', d.toLocaleDateString(), d.toLocaleTimeString(), wdfBranchLabel(tx.branchId || 'main'), tx.staff || tx.soldBy || '', tx.customerName || 'Walk-In Customer',
                (tx.items || []).map(i => `${i.name} x${i.qty} ${wdfUnitLabel(i.saleUnit)}`).join('; '), total,
                pb ? wdfNum(pb.cash) : total, pb ? wdfNum(pb.transfer) : 0, pb ? wdfNum(pb.credit) : 0, wdfNum(tx.refundedAmount), tx.refundStatus || tx.status || 'Completed']);
        });
        wdfDownloadCsv(`sales_${range.from}_to_${range.to}.csv`, rows);
    } catch (e) { alert("Export failed: " + e.message); }
}

function wdfExportCustomers() {
    const rows = [['Name', 'Phone', 'Email', 'Address', 'Balance Owed', 'Credit Limit', 'Lifetime Spend', 'Visits']];
    Object.keys(customersCache || {}).forEach(id => {
        const c = customersCache[id];
        rows.push([c.name || '', c.phone || '', c.email || '', c.address || '', wdfNum(c.balance), wdfNum(c.creditLimit), wdfNum(c.totalSpent), wdfNum(c.visitCount)]);
    });
    wdfDownloadCsv(`customers_${wdfTodayStr()}.csv`, rows);
}

async function wdfExportExpenses() {
    const range = wdfAskDateRange();
    if (!range) return;
    try {
        const start = wdfDayBounds(range.from).startMs, end = wdfDayBounds(range.to).endMs;
        const snap = await wdfWithTimeout(firebase.database().ref(`stores/${currentStoreId}/expenses`).orderByChild('date').startAt(new Date(start).toISOString()).endAt(new Date(end).toISOString()).once('value'), 15000);
        const rows = [['Date', 'Branch', 'Category', 'Description', 'Amount', 'Recorded By']];
        const list = [];
        snap.forEach(c => list.push(c.val()));
        list.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)).forEach(e => {
            rows.push([e.date ? new Date(e.date).toLocaleDateString() : '', wdfBranchLabel(e.branchId || 'main'), e.category || '', e.description || '', wdfNum(e.amount), e.recordedBy || '']);
        });
        wdfDownloadCsv(`expenses_${range.from}_to_${range.to}.csv`, rows);
    } catch (e) { alert("Export failed: " + e.message); }
}

// =====================================================================
// Buttons: added to the existing screens each time they open
// =====================================================================
function wdfMakeBtn(id, label, onclick, extraStyle) {
    if (document.getElementById(id)) return null;
    const b = document.createElement('button');
    b.id = id;
    b.className = 'menu-btn btn-dash';
    b.style.cssText = 'width:auto; margin:0; padding:8px 14px; font-size:12px;' + (extraStyle || '');
    b.textContent = label;
    b.onclick = onclick;
    return b;
}

function wdfInjectButtons(viewId) {
    const isAdmin = currentUserRole === 'Admin';

    if (viewId === 'reports-view') {
        const bar = document.getElementById('sales-branch-filter') && document.getElementById('sales-branch-filter').parentElement;
        if (!bar) return;
        const a = wdfMakeBtn('wdf-btn-daysummary', '📋 Day Summary', wdfOpenDaySummary, 'background:#eff6ff;');
        const b = isAdmin ? wdfMakeBtn('wdf-btn-export-sales', '⬇ Export Sales', wdfExportSales) : null;
        if (a) bar.appendChild(a);
        if (b) bar.appendChild(b);
    } else if (viewId === 'accountant-view') {
        const anchor = document.querySelector('#workspace-content button[onclick="openManualLookupModal()"]');
        const a = anchor && wdfMakeBtn('wdf-btn-daysummary-acc', '📋 Day Summary', wdfOpenDaySummary, 'margin-bottom:0;');
        if (a) anchor.parentElement.appendChild(a);
    } else if (viewId === 'inventory-view' && isAdmin) {
        const add = document.getElementById('add-product-trigger-btn');
        if (!add) return;
        const r = wdfMakeBtn('wdf-btn-reorder', '🛒 Reorder List', wdfOpenReorder, 'background:#fffbeb;');
        const e = wdfMakeBtn('wdf-btn-export-inv', '⬇ Export', wdfExportInventory);
        if (r) add.parentElement.insertBefore(r, add);
        if (e) add.parentElement.insertBefore(e, add);
    } else if (viewId === 'main-dashboard-view' && isAdmin) {
        const anchor = document.getElementById('dash-alert-type-expiring_soon');
        const r = anchor && wdfMakeBtn('wdf-btn-reorder-dash', '🛒 Reorder List', wdfOpenReorder, 'background:#fffbeb;');
        if (r) anchor.parentElement.appendChild(r);
    } else if (viewId === 'customers-view' && isAdmin) {
        const add = document.querySelector('#workspace-content button[onclick="openAddCustomerModal()"]');
        const e = add && wdfMakeBtn('wdf-btn-export-cust', '⬇ Export', wdfExportCustomers);
        if (e) add.parentElement.insertBefore(e, add);
    } else if (viewId === 'expenses-view' && isAdmin) {
        const label = document.getElementById('total-expenses-label');
        const header = label && label.parentElement && label.parentElement.parentElement;
        const e = header && wdfMakeBtn('wdf-btn-export-exp', '⬇ Export', wdfExportExpenses);
        if (e) header.appendChild(e);
    }
}

(function wrapSwitchViewForButtons() {
    const prev = window.switchView;
    window.switchView = function (viewId) {
        const r = prev.apply(this, arguments);
        try { wdfInjectButtons(viewId); } catch (e) { console.warn("Could not add extra buttons:", e); }
        return r;
    };
})();
