// ==================== WISE DECISION OFFLINE PATCH (v24) ====================
// Load AFTER script.js, perf-patch.js and bugfix-patch.js (all with `defer`).
//
// What it does:
//   * Detects a lost connection properly (Firebase connection state, not just the browser flag)
//   * POS keeps working offline: product list comes from a saved copy on the device
//   * Sales made offline get their own receipt numbers (WDO-XXX-001), are printed normally,
//     saved on the device, and sent to the cloud automatically when the internet returns
//     (stock deducted, customer balances updated — safely, never twice)
//   * A cashier's order sent while offline is queued and reaches the accountant later
//   * If the page is reloaded while offline, the session resumes (same browser tab only)
//   * A banner shows offline status / how many sales are waiting to sync
//   * A service worker (sw.js) lets the app itself load with no internet

console.log("Wise Decision offline-patch.js — v24 loaded");

// ---------- State (declared first so early callbacks never see an uninitialised variable) ----------
let wdSyncing = false;
let wdFlashUntil = 0;
let wdSessionWarmed = false;
const wdLocalOrders = {};   // txId -> order held on this device (not in the cloud queue)

// ---------- Small helpers (own names so this file stands alone) ----------
function wdoRound2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function wdoStockOf(p) { return Number(p.stock !== undefined ? p.stock : (p.stockQty || 0)) || 0; }
function wdoPiecesOf(it) { return wdoRound2(it.piecesNeeded !== undefined ? it.piecesNeeded : it.qty); }
function wdWithTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
}
function wdStripLocal(o) {
    const out = {};
    Object.keys(o).forEach(k => { if (k.charAt(0) !== '_') out[k] = o[k]; });
    return out;
}

// ---------- Connectivity ----------
let wdFbConnected = null;        // null = not known yet
let wdFbEverConnected = false;
const wdStartTs = Date.now();

function wdIsOffline() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (wdFbConnected === false) return wdFbEverConnected || (Date.now() - wdStartTs > 6000);
    return false;
}

(function watchConnection() {
    if (typeof firebase === 'undefined' || !firebase.database) return;
    firebase.database().ref('.info/connected').on('value', snap => {
        const nowConnected = snap.val() === true;
        const was = wdFbConnected;
        wdFbConnected = nowConnected;
        if (nowConnected) wdFbEverConnected = true;
        wdUpdateBanner();
        if (nowConnected && was === false) {
            setTimeout(() => { wdSyncOfflineQueues(); wdWarmCaches(); }, 1500);
        }
    });
    setInterval(() => {
        if (currentStoreId && !wdIsOffline() && wdPendingCount() > 0) wdSyncOfflineQueues();
        wdUpdateBanner();
    }, 30000);
})();

// ---------- Local storage: caches and queues ----------
function wdCacheKey(storeId, name) { return `wd_cache_${storeId}_${name}`; }
function wdWriteCache(storeId, name, data) {
    try { localStorage.setItem(wdCacheKey(storeId, name), JSON.stringify({ t: Date.now(), d: data })); } catch (e) { console.warn("Cache write failed:", e); }
}
function wdReadCache(storeId, name) {
    try { const o = JSON.parse(localStorage.getItem(wdCacheKey(storeId, name)) || 'null'); return o ? o.d : null; } catch (e) { return null; }
}
function wdClearCaches(storeId) {
    if (!storeId) return;
    try {
        Object.keys(localStorage).forEach(k => { if (k.indexOf(`wd_cache_${storeId}_`) === 0) localStorage.removeItem(k); });
    } catch (e) {}
}

function wdQueueRead(name) {
    try { const a = JSON.parse(localStorage.getItem('wd_q_' + name) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function wdQueueWrite(name, arr) { localStorage.setItem('wd_q_' + name, JSON.stringify(arr)); }
function wdQueuePush(name, item) {
    try {
        const q = wdQueueRead(name);
        q.push(item);
        wdQueueWrite(name, q);
        return true;
    } catch (e) {
        alert("This device's storage is full, so the record could not be saved offline. Free up space (clear old browser data) and try again.");
        return false;
    }
}
function wdQueueUpdate(name, txId, patch) {
    const q = wdQueueRead(name);
    const item = q.find(x => x.txId === txId);
    if (!item) return;
    Object.assign(item, patch);
    try { wdQueueWrite(name, q); } catch (e) { console.warn("Queue update failed:", e); }
}
function wdQueueRemove(name, txId) {
    try { wdQueueWrite(name, wdQueueRead(name).filter(x => x.txId !== txId)); } catch (e) {}
}
function wdPendingCount() {
    const mine = x => !currentStoreId || x._storeId === currentStoreId;
    return wdQueueRead('sales').filter(mine).length + wdQueueRead('pending').filter(mine).length;
}

// ---------- Offline receipt numbers ----------
function wdDeviceCode() {
    let c = null;
    try { c = localStorage.getItem('wd_dev_code'); } catch (e) {}
    if (!c) {
        c = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
        try { localStorage.setItem('wd_dev_code', c); } catch (e) {}
    }
    return c;
}
function wdNextOfflineTxId() {
    let n = 0;
    try { n = (parseInt(localStorage.getItem('wd_off_seq')) || 0) + 1; localStorage.setItem('wd_off_seq', String(n)); } catch (e) { n = Date.now() % 100000; }
    return `WDO-${wdDeviceCode()}-${String(n).padStart(3, '0')}`;
}

const wdOrigGenerateTx = window.generateNextTransactionId;
window.generateNextTransactionId = function () {
    if (wdIsOffline() || typeof wdOrigGenerateTx !== 'function') return Promise.resolve(wdNextOfflineTxId());
    return wdWithTimeout(wdOrigGenerateTx.apply(this, arguments), 4000).catch(() => wdNextOfflineTxId());
};

// ---------- Store profile (receipt header) with offline fallback ----------
function getStoreProfile() {
    const sid = currentStoreId;
    const cached = wdReadCache(sid, 'profile') || { businessName: '', address: '', phone: '' };
    if (wdIsOffline()) return Promise.resolve(cached);
    const base = firebase.database().ref(`stores/${sid}`);
    return wdWithTimeout(Promise.all([
        base.child('businessName').once('value'),
        base.child('address').once('value'),
        base.child('phone').once('value')
    ]), 5000).then(([n, a, p]) => {
        const prof = { businessName: n.val(), address: a.val(), phone: p.val() };
        wdWriteCache(sid, 'profile', prof);
        return prof;
    }).catch(() => cached);
}

// ---------- Keep local copies fresh while online ----------
async function wdWarmCaches() {
    if (!currentStoreId || currentStoreId === 'SUPER_ADMIN' || wdIsOffline()) return;
    const sid = currentStoreId;
    try {
        await getStoreProfile();
        wdWriteCache(sid, 'branches', branchesCache);
        const ids = currentUserRole === 'Admin' && Object.keys(branchesCache).length ? Object.keys(branchesCache) : [currentBranch];
        for (const id of ids) {
            const snap = await wdWithTimeout(firebase.database().ref(`stores/${sid}/inventory/${id}`).once('value'), 8000);
            const items = snap.val() || {};
            wdApplyQueuedSalesToStock(items, sid, id);
            wdWriteCache(sid, 'inv_' + id, items);
        }
    } catch (e) { console.warn("Cache warm-up skipped:", e.message); }
}

// Sales still waiting to sync haven't reduced the cloud stock yet — subtract them so the
// POS never offers stock that was already sold offline.
function wdApplyQueuedSalesToStock(items, sid, branchId) {
    wdQueueRead('sales').forEach(sale => {
        if (sale._storeId !== sid || (sale.branchId || 'main') !== branchId) return;
        const done = (sale._steps && sale._steps.items) || {};
        (sale.items || []).forEach((it, idx) => {
            if (done[idx]) return;
            const p = it.id ? items[it.id] : null;
            if (!p) return;
            const next = Math.max(0, wdoRound2(wdoStockOf(p) - wdoPiecesOf(it)));
            p.stock = next; p.stockQty = next;
        });
    });
}

(function cacheCustomersAndBranches() {
    const prevSubCust = window.subscribeCustomersCache;
    window.subscribeCustomersCache = function () {
        const r = prevSubCust.apply(this, arguments);
        if (currentStoreId && currentStoreId !== 'SUPER_ADMIN') {
            const sid = currentStoreId;
            firebase.database().ref(`stores/${sid}/customers`).on('value', snap => {
                const out = {};
                snap.forEach(ch => { const v = Object.assign({}, ch.val()); delete v.ledger; out[ch.key] = v; });
                wdWriteCache(sid, 'customers', out);
            }, () => {});
        }
        return r;
    };

    const prevFinishBranchLoad = window.finishBranchLoad;
    if (typeof prevFinishBranchLoad === 'function') {
        window.finishBranchLoad = function () {
            if (currentStoreId) wdWriteCache(currentStoreId, 'branches', branchesCache);
            return prevFinishBranchLoad.apply(this, arguments);
        };
    }
})();

// ---------- POS product list: from the cloud when online, from the device when offline ----------
function wdRenderPosOptions(items) {
    inventoryCache[currentBranch] = items || {};
    const select = document.getElementById('pos-product-select');
    if (!select) return;

    const searchEl = document.getElementById('pos-search-input');
    if (searchEl && searchEl.value.trim()) { filterPosInventory(); return; }

    let html = '<option value="">-- Choose Inventory Item --</option>';
    Object.keys(inventoryCache[currentBranch]).forEach(id => {
        const item = inventoryCache[currentBranch][id];
        if (!item || typeof item !== 'object') return;
        const pName = item.name || item.productName || 'Unnamed Item';
        const rPrice = item.price || item.retailPrice || 0;
        const wPrice = item.wholesalePrice || 0;
        const unitsPerPack = Number(item.unitsPerPack) || 1;
        const pieceNote = item.soldByWeight ? '' : (unitsPerPack > 1 ? ` [1 pack = ${unitsPerPack} pcs]` : '');
        html += `<option value="${id}">${pName} (Stock: ${formatStockLabel(item)})${pieceNote} - Retail: ₦${rPrice} | Wholesale: ₦${wPrice}</option>`;
    });
    select.innerHTML = html;
}

function loadPosInventoryDropdown() {
    if (!currentStoreId) return;
    const sid = currentStoreId, branch = currentBranch;
    const stillHere = () => sid === currentStoreId && branch === currentBranch;
    const useCache = () => { if (stillHere()) wdRenderPosOptions(wdReadCache(sid, 'inv_' + branch) || {}); };

    if (wdIsOffline()) { useCache(); return; }

    wdWithTimeout(firebase.database().ref(`stores/${sid}/inventory/${branch}`).once('value'), 6000).then(snap => {
        const items = snap.val() || {};
        wdApplyQueuedSalesToStock(items, sid, branch);
        wdWriteCache(sid, 'inv_' + branch, items);
        if (stillHere()) wdRenderPosOptions(items);
    }).catch(useCache);
}

// ---------- Orders / sales built while offline ----------
function wdBuildOrder(txId) {
    const activeStaffName = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;
    return {
        txId,
        items: currentCart.map(i => Object.assign({}, i)),
        totalAmount: wdoRound2(currentCart.reduce((sum, i) => sum + i.total, 0)),
        staff: activeStaffName,
        soldBy: activeStaffName,
        date: new Date().toISOString(),
        status: 'Pending Verification',
        branchId: currentBranch,
        customerId: currentSelectedCustomer ? currentSelectedCustomer.id : null,
        customerName: currentSelectedCustomer ? currentSelectedCustomer.name : 'Walk-In Customer'
    };
}

function submitOrderForAccountant() {
    if (currentUserRole === 'Accountant') { processDirectPosPayment(); return; }

    if (currentCart.length === 0) {
        alert("Cart is empty. Add items before submitting.");
        return;
    }

    // An Admin who is offline can't reach the accountant queue — take payment directly instead.
    if (wdIsOffline() && currentUserRole === 'Admin') { processDirectPosPayment(); return; }

    generateNextTransactionId().then(txId => {
        const orderData = wdBuildOrder(txId);

        const finish = (queuedLocally) => {
            alert(queuedLocally
                ? `No internet — order ${txId} is saved on this device and will reach the Accountant automatically when you're back online.`
                : `Order sent to Accountant queue! Receipt ID: ${txId}`);
            currentCart = [];
            renderCart();
            loadPosInventoryDropdown();
            clearPosCustomer();
        };

        const queueLocally = () => {
            if (wdQueuePush('pending', Object.assign({}, orderData, { _storeId: currentStoreId }))) {
                finish(true);
                wdUpdateBanner();
            }
        };

        if (wdIsOffline()) { queueLocally(); return; }

        wdWithTimeout(firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).set(orderData), 6000)
            .then(() => finish(false))
            .catch(err => {
                // Slow connection: the app keeps trying to send it in the background; only
                // save our own copy if the write outright failed.
                if (err && err.message === 'timeout') { finish(false); }
                else queueLocally();
            });
    }).catch(err => {
        alert("Failed to generate transaction ID: " + err.message);
    });
}

function processDirectPosPayment() {
    if (currentCart.length === 0) {
        alert("Cart is empty. Add items before checking out.");
        return;
    }

    generateNextTransactionId().then(txId => {
        const orderData = wdBuildOrder(txId);
        const total = orderData.totalAmount;

        const openModal = () => {
            currentCart = [];
            renderCart();
            loadPosInventoryDropdown();
            openSplitModal(txId, total);
            clearPosCustomer();
        };
        const goLocal = () => { wdLocalOrders[txId] = orderData; openModal(); };

        if (wdIsOffline()) { goLocal(); return; }

        const ref = firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`);
        wdWithTimeout(ref.set(orderData), 6000).then(openModal).catch(() => {
            ref.remove().catch(() => {}); // cancel the slow write so the order can't appear twice
            goLocal();
        });
    }).catch(err => {
        alert("Failed to generate transaction ID: " + err.message);
    });
}

// Payment modal for an order that lives on this device
const wdPrevOpenSplitModal = window.openSplitModal;
window.openSplitModal = function (txId, totalAmount) {
    const local = wdLocalOrders[txId];
    if (!local) return wdPrevOpenSplitModal.apply(this, arguments);

    const numericTotal = wdoRound2(totalAmount);
    currentActiveOrder = {
        txId, totalAmount: numericTotal,
        customerId: local.customerId || null,
        customerName: local.customerName || 'Walk-In Customer',
        branchId: local.branchId || currentBranch
    };

    document.getElementById('modal-tx-id-label').textContent = txId;
    document.getElementById('split-modal-total').textContent = numericTotal.toLocaleString(undefined, { maximumFractionDigits: 2 });
    document.getElementById('split-cash').value = numericTotal;
    document.getElementById('split-transfer').value = 0;
    const creditInput = document.getElementById('split-credit');
    if (creditInput) creditInput.value = 0;

    const creditContainer = document.getElementById('split-credit-container');
    const custInfo = document.getElementById('split-modal-customer-info');
    const cid = currentActiveOrder.customerId;

    if (cid && customersCache[cid]) {
        const c = customersCache[cid];
        const available = Math.max(0, (Number(c.creditLimit) || 0) - (Number(c.balance) || 0));
        if (custInfo) custInfo.innerHTML = `Customer: <strong>${c.name}</strong> &nbsp;|&nbsp; Current Balance: ₦${(Number(c.balance) || 0).toLocaleString()} &nbsp;|&nbsp; Credit Available: ₦${available.toLocaleString()} <br><small>(offline — figures from this device)</small>`;
        if (creditContainer) creditContainer.style.display = 'block';
    } else {
        if (custInfo) custInfo.innerHTML = `Customer: <strong>${currentActiveOrder.customerName}</strong> &nbsp;|&nbsp; Branch: <strong>${branchNameOf(currentActiveOrder.branchId)}</strong>`;
        if (creditContainer) creditContainer.style.display = 'none';
    }

    document.getElementById('split-modal').style.display = 'flex';
    calcSplit();
};

// If the payment window for an on-device order is cancelled, keep the order as a pending
// order (so it isn't lost) instead of throwing the cart away.
const wdPrevCloseSplitModal = window.closeSplitModal;
window.closeSplitModal = function () {
    const local = currentActiveOrder && wdLocalOrders[currentActiveOrder.txId];
    if (local) {
        delete wdLocalOrders[local.txId];
        if (wdQueuePush('pending', Object.assign({}, local, { _storeId: currentStoreId }))) {
            alert(`Order ${local.txId} was saved as a pending order. The Accountant can process it from the queue.`);
            wdUpdateBanner();
            if (!wdIsOffline()) wdSyncOfflineQueues();
        }
    }
    return wdPrevCloseSplitModal.apply(this, arguments);
};

const wdPrevCompleteSplitCheckout = window.completeSplitCheckout;
window.completeSplitCheckout = function () {
    if (currentActiveOrder && wdLocalOrders[currentActiveOrder.txId]) return wdCheckoutLocalOrder();
    return wdPrevCompleteSplitCheckout.apply(this, arguments);
};

function wdCheckoutLocalOrder() {
    const active = currentActiveOrder;
    const txId = active.txId;
    const order = wdLocalOrders[txId];

    const cash = wdoRound2(parseFloat(document.getElementById('split-cash').value) || 0);
    const transfer = wdoRound2(parseFloat(document.getElementById('split-transfer').value) || 0);
    const creditContainer = document.getElementById('split-credit-container');
    const creditVisible = creditContainer && creditContainer.style.display !== 'none';
    const credit = creditVisible ? wdoRound2(parseFloat(document.getElementById('split-credit').value) || 0) : 0;

    if (Math.abs(wdoRound2(cash + transfer + credit) - wdoRound2(active.totalAmount)) > 0.005) {
        alert("The payment amounts don't add up to the total due.");
        return;
    }

    const branchId = order.branchId || currentBranch;
    const branchItems = inventoryCache[branchId] || {};
    const items = [];

    for (const it of (order.items || [])) {
        const copy = Object.assign({}, it);
        const sold = wdoPiecesOf(it);
        const prod = it.id ? branchItems[it.id] : null;
        if (prod) {
            if (wdoStockOf(prod) + 1e-9 < sold) {
                alert(`Not enough stock of "${it.name}" on this device (${wdoStockOf(prod)} left, ${sold} needed).`);
                return;
            }
            const cost = (Number(prod.costPrice) || 0) / (Number(prod.unitsPerPack) || 1);
            copy.costPerPiece = Math.round(cost * 10000) / 10000;
            copy.lineCost = wdoRound2(cost * sold);
        }
        items.push(copy);
    }

    const orderData = Object.assign({}, order, {
        items,
        status: 'Completed',
        paymentBreakdown: { cash, transfer, credit },
        date: new Date().toISOString(),
        branchId,
        totalAmount: wdoRound2(order.totalAmount),
        recordedOffline: true
    });

    if (!wdQueuePush('sales', Object.assign({}, orderData, { _storeId: currentStoreId, _steps: {} }))) return;

    delete wdLocalOrders[txId];
    closeSplitModal();

    // Update this device's own view of stock and customer balance straight away
    items.forEach(it => {
        const p = it.id ? branchItems[it.id] : null;
        if (!p) return;
        const next = Math.max(0, wdoRound2(wdoStockOf(p) - wdoPiecesOf(it)));
        p.stock = next; p.stockQty = next;
    });
    if (inventoryCache[branchId]) wdWriteCache(currentStoreId, 'inv_' + branchId, inventoryCache[branchId]);

    const cid = orderData.customerId;
    if (cid && customersCache[cid]) {
        const c = customersCache[cid];
        c.balance = wdoRound2((Number(c.balance) || 0) + credit);
        c.totalSpent = wdoRound2((Number(c.totalSpent) || 0) + orderData.totalAmount);
        c.visitCount = (Number(c.visitCount) || 0) + 1;
    }

    renderReceiptView(orderData, false);
    wdUpdateBanner();
    if (!wdIsOffline()) wdSyncOfflineQueues();
}

// ---------- Sync: send everything saved on the device to the cloud ----------
async function wdSyncPendingOrders() {
    const sid = currentStoreId;
    const queue = wdQueueRead('pending').filter(o => o._storeId === sid);
    for (const o of queue) {
        try {
            const base = firebase.database().ref(`stores/${sid}`);
            const already = await base.child(`transactions/${o.txId}`).once('value');
            if (!already.exists()) await base.child(`pendingOrders/${o.txId}`).set(wdStripLocal(o));
            wdQueueRemove('pending', o.txId);
        } catch (e) { console.warn(`Pending order ${o.txId} not synced yet:`, e.message); }
    }
}

async function wdSyncSales() {
    const sid = currentStoreId;
    const queue = wdQueueRead('sales').filter(s => s._storeId === sid)
        .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

    for (const sale of queue) {
        try {
            const txId = sale.txId;
            const steps = sale._steps || {};
            steps.items = steps.items || {};
            const record = wdStripLocal(sale);
            const base = firebase.database().ref(`stores/${sid}`);
            const persist = () => wdQueueUpdate('sales', txId, { _steps: steps });

            // 1. Create the sale record (only if it doesn't exist yet — never overwrites)
            if (!steps.tx) {
                await base.child(`transactions/${txId}`).transaction(cur => (cur === null ? record : undefined));
                steps.tx = true; persist();
            }

            // 2. Take the goods out of stock (each line at most once); never below zero
            const branchId = record.branchId || 'main';
            const shortfalls = steps.shortfalls || [];
            const lines = record.items || [];
            for (let i = 0; i < lines.length; i++) {
                if (steps.items[i]) continue;
                const it = lines[i];
                const sold = wdoPiecesOf(it);
                if (it.id && sold > 0) {
                    let short = false;
                    await base.child(`inventory/${branchId}/${it.id}`).transaction(p => {
                        if (p === null || typeof p !== 'object') return p;
                        const cur = wdoStockOf(p);
                        short = cur + 1e-9 < sold;
                        const next = Math.max(0, wdoRound2(cur - sold));
                        p.stock = next; p.stockQty = next;
                        return p;
                    });
                    if (short) shortfalls.push(it.name);
                }
                steps.items[i] = true; steps.shortfalls = shortfalls; persist();
            }
            if (shortfalls.length && !steps.shortMarked) {
                await base.child(`transactions/${txId}`).update({ stockShortfall: shortfalls });
                steps.shortMarked = true; persist();
            }

            // 3. Customer balance / lifetime value / ledger
            if (record.customerId && !steps.cust) {
                const custRef = base.child(`customers/${record.customerId}`);
                const exists = (await custRef.child('name').once('value')).exists();
                if (exists) {
                    const credit = wdoRound2((record.paymentBreakdown || {}).credit);
                    if (!steps.cb) {
                        let before = 0, after = 0;
                        if (credit > 0) {
                            await custRef.child('balance').transaction(b => { before = Number(b) || 0; after = wdoRound2(before + credit); return after; });
                        }
                        steps.cbBefore = before; steps.cbAfter = after; steps.cb = true; persist();
                    }
                    if (!steps.cs) {
                        await custRef.child('totalSpent').transaction(v => wdoRound2((Number(v) || 0) + (Number(record.totalAmount) || 0)));
                        steps.cs = true; persist();
                    }
                    if (!steps.cv) {
                        await custRef.child('visitCount').transaction(v => (Number(v) || 0) + 1);
                        await custRef.child('lastVisit').set(record.date);
                        steps.cv = true; persist();
                    }
                    if (credit > 0 && !steps.cl) {
                        await custRef.child(`ledger/off_${txId}`).set({
                            type: 'credit_sale',
                            amount: credit,
                            balanceBefore: steps.cbBefore,
                            balanceAfter: steps.cbAfter,
                            date: record.date,
                            txId,
                            recordedBy: record.staff || record.soldBy || 'Staff',
                            note: `Credit portion of sale ${txId} (recorded offline)`
                        });
                        steps.cl = true; persist();
                    }
                }
                steps.cust = true; persist();
            }

            wdQueueRemove('sales', txId);
        } catch (e) { console.warn(`Sale ${sale.txId} not fully synced yet:`, e.message); }
    }
}

async function wdSyncOfflineQueues() {
    if (wdSyncing || !currentStoreId || currentStoreId === 'SUPER_ADMIN' || wdIsOffline()) return;
    const before = wdPendingCount();
    if (before === 0) return;

    wdSyncing = true;
    wdUpdateBanner();
    try { await wdSyncPendingOrders(); } catch (e) { console.warn(e); }
    try { await wdSyncSales(); } catch (e) { console.warn(e); }
    wdSyncing = false;

    if (wdPendingCount() === 0) {
        wdFlashUntil = Date.now() + 4000;
        setTimeout(wdUpdateBanner, 4100);
        wdWarmCaches();
        if (document.getElementById('pos-product-select')) loadPosInventoryDropdown();
    }
    wdUpdateBanner();
}

// ---------- Banner ----------
function wdUpdateBanner() {
    if (typeof document === 'undefined' || !document.body) return;
    let el = document.getElementById('offline-status-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'offline-status-banner';
        el.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; color: #fff; text-align: center; font-size: 12px; font-weight: bold; padding: 6px; z-index: 9999; display: none; cursor: pointer;";
        el.onclick = () => wdSyncOfflineQueues();
        document.body.prepend(el);
    }

    const pending = wdPendingCount();
    const offline = wdIsOffline();

    if (offline) {
        el.style.background = '#dc2626';
        el.textContent = "⚠ You're offline — sales are being saved on this device" + (pending ? ` (${pending} waiting to sync)` : '') + ". Keep this page open.";
        el.style.display = 'block';
    } else if (wdSyncing) {
        el.style.background = '#d97706';
        el.textContent = `⟳ Syncing ${pending} offline record${pending === 1 ? '' : 's'}...`;
        el.style.display = 'block';
    } else if (pending > 0) {
        el.style.background = '#d97706';
        el.textContent = `${pending} offline record${pending === 1 ? '' : 's'} waiting to sync — tap to retry`;
        el.style.display = 'block';
    } else if (Date.now() < wdFlashUntil) {
        el.style.background = '#16a34a';
        el.textContent = "✔ All offline sales have been synced";
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}
window.showOfflineBanner = function () { wdUpdateBanner(); };   // original online/offline listeners call this

// ---------- Session resume (offline reload, same tab only) ----------
function wdSaveSession() {
    if (!currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
    try {
        sessionStorage.setItem('wd_session', JSON.stringify({
            storeId: currentStoreId,
            role: currentUserRole,
            branchId: currentBranch,
            label: (document.getElementById('user-role-label') || {}).textContent || '',
            title: (document.getElementById('dashboard-store-title') || {}).textContent || ''
        }));
    } catch (e) {}
}

const wdPrevSwitchView = window.switchView;
window.switchView = function (viewId) {
    const result = wdPrevSwitchView.apply(this, arguments);
    if (viewId === 'login-view') {
        try { sessionStorage.removeItem('wd_session'); } catch (e) {}
        wdSessionWarmed = false;
    } else if (viewId !== 'register-view' && currentStoreId && currentStoreId !== 'SUPER_ADMIN') {
        wdSaveSession();
        if (!wdSessionWarmed) {
            wdSessionWarmed = true;
            wdWarmCaches();
            wdSyncOfflineQueues();
        }
    }
    return result;
};

function wdResumeSession(s) {
    currentStoreId = s.storeId;
    currentUserRole = s.role;
    currentBranch = s.branchId || 'main';
    currentInventoryBranchFilter = currentBranch;
    const t = document.getElementById('dashboard-store-title'); if (t) t.textContent = s.title || '';
    const l = document.getElementById('user-role-label'); if (l) l.textContent = s.label || '';

    branchesCache = wdReadCache(s.storeId, 'branches') || { main: { name: 'Main', isMain: true } };
    customersCache = wdReadCache(s.storeId, 'customers') || {};

    adjustSidebarForRole(s.role);
    finishBranchLoad();               // shows the branch badge and reconnects live updates
    subscribeCustomersCache();
    subscribeSuppliersCache();
    wdSessionWarmed = true;
    switchView('pos-view');
    resetIdleTimer();
    wdUpdateBanner();
}

(function maybeResumeAfterReload() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('wd_session') || 'null'); } catch (e) {}
    if (!saved || !saved.storeId) return;

    setTimeout(() => {
        if (currentStoreId) return;                                   // already logged in
        const connected = wdFbConnected === true && navigator.onLine !== false;
        if (connected) return;                                        // online: normal login
        wdResumeSession(saved);
    }, 3500);
})();

// ---------- Logging out / idle while offline ----------
const wdPrevLogout = window.logout;
window.logout = function () {
    if (wdIsOffline() && currentStoreId) {
        if (!confirm("You're offline. If you log out you won't be able to log back in until the internet returns. Log out anyway?")) return;
    }
    if (currentStoreId) wdClearCaches(currentStoreId);   // don't leave customer/stock data behind on a shared device
    try { sessionStorage.removeItem('wd_session'); } catch (e) {}
    return wdPrevLogout.apply(this, arguments);
};

// While offline the app can't log you back in, so don't kick you out for being idle.
const wdPrevShowIdleWarning = window.showIdleWarningModal;
window.showIdleWarningModal = function () {
    if (wdIsOffline()) { resetIdleTimer(); return; }
    return wdPrevShowIdleWarning.apply(this, arguments);
};

// ---------- Service worker: lets the app itself open with no internet ----------
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn("Service worker not registered:", e));
    });
}

window.addEventListener('online', () => { wdUpdateBanner(); });
window.addEventListener('offline', () => { wdUpdateBanner(); });
wdUpdateBanner();
