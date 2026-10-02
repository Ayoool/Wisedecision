// ==================== WISE DECISION MANAGER & PRE-ORDERS PATCH (v38) ====================
// Load LAST (after all the other patches), with `defer`.
//
//   * New "Manager" role, selectable when adding staff. Their sidebar shows only Pre-Orders
//     and Logout — nothing else.
//   * "🛒 Pre-Orders" button (Admin + Manager) opens a workflow with real states:
//       Draft (Manager or Admin can edit) -> Submitted (Admin can edit) -> Placed (locked)
//       -> Received (stock updated)
//   * A shared editable list — remove an item, or change its quantity — used at every stage.
//   * A new draft starts pre-filled from the same low-stock / running-out logic as the
//     existing Reorder List, grouped by supplier, with a numeric suggested quantity per item.
//   * Once placed, each supplier group gets a "Order on WhatsApp" button with the message
//     pre-filled from the FINAL quantities (not the original suggestions).
//
// v38 additions:
//   (#1)  Unread badge on the sidebar button
//   (#2)  Audit history array + return-with-note + ack button for Manager
//   (#3)  Admin can add items to a draft/submitted list
//   (#4)  Duplicate-draft guard ("open the existing one instead?")
//   (#5)  Draft builder subtracts outstanding items from other open pre-orders
//   (#6)  Admin repair utility for supplier totals drift
//   (#7)  Received-check uses scaled tolerance
//   (#8)  RTDB rules documented in a comment block
//   (#9)  Admin branch resolution hardened
//   (#11) "Copy as text" button on the detail view
//   (#13) Sanity check when editing a very large quantity
//   (#14) Relative timestamps in the list view
//   (#16) window.WDM export of the pure functions
//   (#17) wdmCurrentGroups moved to the top with the other wdmCurrent* vars
//   (#18) Version string unified
//   (#19) setInterval replaced with MutationObserver
//
// Data lives at stores/{storeId}/preOrders/{id} — outside inventory, so it doesn't touch
// anything the rest of the app reads.
//
// -----------------------------------------------------------------------------
// (#8) RTDB RULES — adjust the staff/role path to match your app before deploying:
//
//   "preOrders": {
//     ".read": "auth != null && (root.child('stores').child($storeId).child('staff').child(auth.uid).child('role').val() === 'Admin' || root.child('stores').child($storeId).child('staff').child(auth.uid).child('role').val() === 'Manager')",
//     "$orderId": {
//       ".write": "auth != null && (root.child('stores').child($storeId).child('staff').child(auth.uid).child('role').val() === 'Admin' || (root.child('stores').child($storeId).child('staff').child(auth.uid).child('role').val() === 'Manager' && (data.child('status').val() === 'draft' || data.child('status').val() === 'submitted' || !data.exists())))"
//     }
//   }
// -----------------------------------------------------------------------------

var WDM_VERSION = 'v38';
console.log("Wise Decision manager-preorder-patch.js — " + WDM_VERSION + " loaded");

// ---- added (#17): shared state declared at the top instead of mid-file ----
var wdmCurrentId = null;
var wdmCurrentRecord = null;
var wdmCurrentInventory = null;   // this branch's current products (null = couldn't load)
var wdmCurrentGroups = [];
var wdmOpenInFlight = null;       // (#4) dedupe guard for "New Draft"
var wdmUnread = { submitted: 0, returned: 0, placed: 0 };  // (#1)

// ---------- Helpers ----------
function wdmNum(n) { return Number(n) || 0; }
function wdmRound(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function wdmEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdmMoney(n) { return '₦' + wdmRound(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function wdmPretty(iso) { const t = new Date(iso); return isNaN(t) ? '—' : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
function wdmActorName() { const el = document.getElementById('user-role-label'); return (el && el.textContent.trim()) || currentUserRole || 'Staff'; }
function wdmBusinessName() { const el = document.getElementById('dashboard-store-title'); return (el && el.textContent.trim()) || 'Wise Decision'; }
function wdmBranchLabel(id) { return typeof branchNameOf === 'function' ? branchNameOf(id) : id; }
// Cost is stored per carton/pack for pack products (per Kg/g for weight products), but stock is
// counted in pieces — so the cost of ONE counted unit is the pack cost divided by pieces per pack.
function wdmUnitCost(item) { return wdmNum(item.costPrice) / (wdmNum(item.unitsPerPack) || 1); }
function wdmUnitLabel(item) {
    if (item.soldByWeight) return (item.weightUnit || 'Kg').toLowerCase();
    return wdmNum(item.unitsPerPack) > 1 ? 'pcs' : 'unit(s)';
}
function wdmWaNumber(phone) {
    let p = String(String(phone || '').split(/[,;/|]/)[0] || '').replace(/[^\d+]/g, '');
    if (!p) return '';
    if (p.charAt(0) === '+') p = p.slice(1);
    else if (p.indexOf('00') === 0) p = p.slice(2);
    else if (p.charAt(0) === '0') p = '234' + p.slice(1);
    else if (/^\d{10}$/.test(p)) p = '234' + p;
    return p;
}
function wdmWithTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
        const t = setTimeout(function () { reject(new Error('The connection is too slow or offline — please try again.')); }, ms);
        promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
}

// ---- added (#14): relative timestamps for the list view ----
function wdmRelative(iso) {
    if (!iso) return '—';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '—';
    const s = Math.floor((Date.now() - then) / 1000);
    if (s < 45) return 'just now';
    if (s < 90) return 'a minute ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
    const d = Math.floor(h / 24);
    if (d < 7) return d + ' day' + (d === 1 ? '' : 's') + ' ago';
    return wdmPretty(iso);
}

// ---- added (#13): sanity check for accidentally huge quantities ----
function wdmQtyLooksWrong(qty, suggested) {
    if (!(qty > 0)) return false;
    if (qty > 10000) return true;
    if (suggested > 0 && qty >= suggested * 10 && qty - suggested >= 50) return true;
    return false;
}

// ---- added (#11): plain-text export of the list, safe for email/SMS ----
function wdmListAsText(record, businessName) {
    const groups = wdmGroupBySupplier(record.items || []);
    const lines = ['Pre-Order for ' + (businessName || 'Wise Decision') + ' — ' + (WDM_STATUS_LABEL[record.status] ? WDM_STATUS_LABEL[record.status][2] : record.status), ''];
    groups.forEach(function (g) {
        lines.push(g.supplierName + ':');
        g.items.forEach(function (i) {
            lines.push('  • ' + i.name + ': ' + wdmRound(i.orderQty) + ' ' + wdmUnitLabel(i));
        });
        lines.push('');
    });
    return lines.join('\n').trim();
}

// ---- added (#2/#3): audit-trail appender used by every mutator ----
function wdmAppendHistory(record, actor, action, detail) {
    const h = (record.history || []).slice();
    h.push({ at: new Date().toISOString(), by: actor, action: action, detail: detail || '' });
    return Object.assign({}, record, { history: h });
}

// =====================================================================
// PURE LOGIC (no DOM, no Firebase — this is what gets tested)
// =====================================================================

// (#5) Builds the starting item list for a new draft from current stock, recent sales and supply
// history — same idea as the Reorder List, but with a plain numeric quantity to edit.
// `openItems` is { productId: outstandingPieces } from other open pre-orders.
function wdmBuildDraftItems(items, sales, supplies, coverDays, days, openItems) {
    coverDays = coverDays || 14; days = days || 30;
    openItems = openItems || {};
    const sold = {};
    (sales || []).forEach(function (tx) {
        (tx.items || []).forEach(function (it) {
            if (!it.id) return;
            const qty = wdmNum(it.qty);
            const pieces = wdmNum(it.piecesNeeded !== undefined ? it.piecesNeeded : it.qty);
            const refundedPieces = qty > 0 ? wdmNum(it.refundedQty) * (pieces / qty) : 0;
            sold[it.id] = (sold[it.id] || 0) + Math.max(0, pieces - refundedPieces);
        });
    });

    const byId = {}, byName = {};
    (supplies || []).slice().sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); }).forEach(function (s) {
        (s.items || []).forEach(function (line) {
            const sup = { id: s.supplierId || null, name: s.supplierName || 'Supplier' };
            if (line.productId && !byId[line.productId]) byId[line.productId] = sup;
            const n = (line.name || '').toLowerCase().trim();
            if (n && !byName[n]) byName[n] = sup;
        });
    });

    const out = [];
    Object.keys(items || {}).forEach(function (id) {
        const item = items[id];
        if (!item || typeof item !== 'object') return;
        const stock = wdmNum(item.stock !== undefined ? item.stock : item.stockQty);
        const threshold = (item.lowStockThreshold !== undefined && item.lowStockThreshold !== null) ? wdmNum(item.lowStockThreshold) : 5;
        const daily = (sold[id] || 0) / days;
        const incoming = wdmNum(openItems[id] || 0);
        const effective = stock + incoming;
        const daysLeft = daily > 0 ? effective / daily : null;
        const isLow = effective <= threshold;
        const runningOut = daysLeft !== null && daysLeft <= 7;
        if (!isLow && !runningOut) return;

        let suggestQty;
        if (daily > 0) suggestQty = Math.max(1, Math.ceil(daily * coverDays - effective));
        else suggestQty = Math.max(1, Math.ceil(threshold - effective) || 1);

        const sup = byId[id] || byName[(item.name || item.productName || '').toLowerCase().trim()] || null;
        out.push({
            id: id, name: item.name || item.productName || 'Unnamed Item',
            supplierId: sup ? sup.id : null, supplierName: sup ? sup.name : null,
            soldByWeight: !!item.soldByWeight, weightUnit: item.weightUnit || 'Kg', unitsPerPack: wdmNum(item.unitsPerPack) || 1,
            stockAtCreation: stock, threshold: threshold, incomingQty: incoming,
            daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
            costPrice: wdmNum(item.costPrice), suggestQty: suggestQty, orderQty: suggestQty
        });
    });

    out.sort(function (a, b) { return (a.daysLeft === null ? 9999 : a.daysLeft) - (b.daysLeft === null ? 9999 : b.daysLeft) || a.stockAtCreation - b.stockAtCreation; });
    return out;
}

// ---- added (#5): sums outstanding pieces across other open (placed, not received) pre-orders ----
function wdmOutstandingFromOpenPreOrders(preOrders, branchId, excludeId) {
    const totals = {};
    Object.keys(preOrders || {}).forEach(function (id) {
        if (id === excludeId) return;
        const r = preOrders[id];
        if (!r || (r.branchId || 'main') !== branchId) return;
        if (r.status !== 'placed') return;
        const received = wdmReceivedTotals(r);
        (r.items || []).forEach(function (it) {
            const outstanding = Math.max(0, wdmNum(it.orderQty) - wdmNum(received[it.id] || 0));
            if (outstanding > 0) totals[it.id] = wdmRound((totals[it.id] || 0) + outstanding);
        });
    });
    return totals;
}

function wdmGroupBySupplier(items) {
    const groups = {};
    (items || []).forEach(function (it) {
        const key = it.supplierId || it.supplierName || '__none__';
        groups[key] = groups[key] || { supplierId: it.supplierId || null, supplierName: it.supplierName || 'No supplier on record', items: [] };
        groups[key].items.push(it);
    });
    const list = Object.keys(groups).map(function (k) { return groups[k]; });
    list.sort(function (a, b) { return (a.supplierId === null) - (b.supplierId === null) || String(a.supplierName).localeCompare(String(b.supplierName)); });
    return list;
}

// ---- added (#11): per-group subtotal, used on the WhatsApp button ----
function wdmGroupTotal(g) {
    return (g.items || []).reduce(function (s, i) { return s + wdmRound(i.orderQty * wdmUnitCost(i)); }, 0);
}

// ----- State transitions (pure — take a record, return a new one, or throw a clear reason) -----
function wdmCanEdit(record, role) {
    if (!record) return false;
    if (record.status === 'draft') return role === 'Manager' || role === 'Admin';
    if (record.status === 'submitted') return role === 'Admin';
    return false;
}
function wdmRemoveItemPure(record, index, actor) {
    if (!record.items || index < 0 || index >= record.items.length) throw new Error("That item is no longer on the list.");
    const items = record.items.slice();
    const gone = items[index];
    items.splice(index, 1);
    let next = Object.assign({}, record, { items: items });
    if (actor) next = wdmAppendHistory(next, actor, 'remove', gone.name);
    return next;
}
function wdmUpdateQtyPure(record, index, qty, actor) {
    if (!record.items || index < 0 || index >= record.items.length) throw new Error("That item is no longer on the list.");
    qty = wdmRound(qty);
    if (!(qty > 0)) throw new Error("Quantity must be greater than zero — remove the item instead if you don't want it.");
    const items = record.items.slice();
    const before = items[index].orderQty;
    items[index] = Object.assign({}, items[index], { orderQty: qty });
    let next = Object.assign({}, record, { items: items });
    if (actor && record.status === 'submitted') next = wdmAppendHistory(next, actor, 'qty', items[index].name + ': ' + wdmRound(before) + ' → ' + qty);
    return next;
}
// ---- added (#3): Admin can add missing items to a draft or submitted list ----
function wdmAddItemPure(record, item, actor) {
    if (record.status !== 'draft' && record.status !== 'submitted') throw new Error("Items can only be added while the list is a draft or submitted.");
    if (!item || !item.id) throw new Error("Pick a product first.");
    if ((record.items || []).some(function (i) { return i.id === item.id; })) throw new Error('"' + item.name + '" is already on the list.');
    const entry = {
        id: item.id, name: item.name,
        supplierId: item.supplierId || null, supplierName: item.supplierName || null,
        soldByWeight: !!item.soldByWeight, weightUnit: item.weightUnit || 'Kg',
        unitsPerPack: wdmNum(item.unitsPerPack) || 1,
        stockAtCreation: wdmNum(item.stock !== undefined ? item.stock : item.stockQty),
        threshold: (item.lowStockThreshold !== undefined && item.lowStockThreshold !== null) ? wdmNum(item.lowStockThreshold) : 5,
        daysLeft: null,
        costPrice: wdmNum(item.costPrice),
        suggestQty: Math.max(1, wdmNum(item.suggestQty) || 1),
        orderQty: Math.max(1, wdmNum(item.orderQty) || 1)
    };
    return wdmAppendHistory(Object.assign({}, record, { items: (record.items || []).concat([entry]) }), actor, 'add', entry.name);
}
function wdmSubmitPure(record, by) {
    if (record.status !== 'draft') throw new Error("Only a draft can be submitted.");
    if (!record.items || record.items.length === 0) throw new Error("Add at least one item before submitting.");
    return wdmAppendHistory(
        Object.assign({}, record, { status: 'submitted', submittedBy: by, submittedAt: new Date().toISOString() }),
        by, 'submit', record.items.length + ' items'
    );
}
function wdmReturnPure(record, by, note) {
    if (record.status !== 'submitted') throw new Error("Only a submitted list can be sent back for edits.");
    return wdmAppendHistory(
        Object.assign({}, record, { status: 'draft', reviewedBy: by, reviewedAt: new Date().toISOString(), reviewNote: note || '' }),
        by, 'return', note || '(no note)'
    );
}
function wdmPlacePure(record, by) {
    if (record.status !== 'submitted') throw new Error("Only a submitted list can be placed.");
    if (!record.items || record.items.length === 0) throw new Error("There are no items left to order.");
    return wdmAppendHistory(
        Object.assign({}, record, { status: 'placed', placedBy: by, placedAt: new Date().toISOString() }),
        by, 'place', record.items.length + ' items'
    );
}

function wdmOrderMessage(group, businessName) {
    const lines = group.items.map(function (i) { return '• ' + i.name + ': ' + wdmRound(i.orderQty) + ' ' + wdmUnitLabel(i); });
    return 'Hello ' + group.supplierName + ', please we need to restock the following for ' + businessName + ':\n\n' + lines.join('\n') + '\n\nKindly confirm availability and price. Thank you.';
}

// ----- Receiving (pure) -----
function wdmReceivedTotals(record) {
    const totals = {};
    Object.keys((record && record.receipts) || {}).forEach(function (k) {
        (record.receipts[k].items || []).forEach(function (it) { totals[it.id] = wdmRound((totals[it.id] || 0) + wdmNum(it.receivedQty)); });
    });
    return totals;
}
// ---- changed (#7): tolerance scales with the ordered quantity ----
function wdmIsFullyReceived(record) {
    const totals = wdmReceivedTotals(record);
    const items = (record && record.items) || [];
    if (items.length === 0) return false;
    return items.every(function (it) {
        const tol = Math.max(1e-6, Math.abs(wdmNum(it.orderQty)) * 1e-6);
        return (totals[it.id] || 0) >= it.orderQty - tol;
    });
}
function wdmBuildReceiptGroups(items, entered) {
    const groups = {};
    (items || []).forEach(function (it) {
        const raw = (entered || {})[it.id];
        const e = (raw !== null && typeof raw === 'object') ? raw : { qty: raw };
        const qty = wdmNum(e.qty);
        if (!(qty > 0)) return;
        const entry = { id: it.id, name: it.name, receivedQty: wdmRound(qty), costPrice: wdmNum(it.costPrice), unitsPerPack: wdmNum(it.unitsPerPack) || 1 };

        const blank = function (v) { return v === '' || v === null || v === undefined || (typeof v === 'number' && isNaN(v)); };

        if (e.priceChanged) {
            const np = {};
            [['costPrice', e.cost], ['retailPrice', e.retail], ['wholesalePrice', e.wholesale]].forEach(function (pair) {
                if (blank(pair[1])) return;
                const n = Number(pair[1]);
                if (isNaN(n) || n < 0) throw new Error('New prices for "' + it.name + '" must be numbers, zero or more.');
                np[pair[0]] = wdmRound(n);
            });
            if (Object.keys(np).length === 0) throw new Error('For "' + it.name + '" you said the price changed — enter at least one new price, or change the answer to "No".');
            entry.newPrices = np;
        }
        if (!blank(e.unitsPerPack)) {
            const u = Number(e.unitsPerPack);
            if (isNaN(u) || u < 1 || Math.floor(u) !== u) throw new Error('Pieces per carton for "' + it.name + '" must be a whole number, 1 or more.');
            entry.newUnitsPerPack = u;
        }
        if (!blank(e.piecePrice)) {
            const pp = Number(e.piecePrice);
            if (isNaN(pp) || pp < 0) throw new Error('The price per piece for "' + it.name + '" must be a number, zero or more.');
            entry.newPiecePrice = wdmRound(pp);
        }

        const key = it.supplierId || it.supplierName || '__none__';
        groups[key] = groups[key] || { supplierId: it.supplierId || null, supplierName: it.supplierName || 'No supplier on record', items: [] };
        groups[key].items.push(entry);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
}

// =====================================================================
// FIREBASE
// =====================================================================
async function wdmTransact(id, mutator) {
    const ref = firebase.database().ref('stores/' + currentStoreId + '/preOrders/' + id);
    let errorMsg = null;
    const res = await ref.transaction(function (cur) {
        errorMsg = null;
        if (cur === null || cur === undefined) { errorMsg = "This pre-order no longer exists — it may have been deleted."; return cur; }
        try { return mutator(cur); } catch (e) { errorMsg = e.message; return; }
    });
    if (errorMsg) throw new Error(errorMsg);
    if (!res.committed) throw new Error("Could not save — please try again.");
    return res.snapshot.val();
}

// ---- changed (#5): also loads open pre-orders and subtracts their outstanding ----
async function wdmCreateDraft(branchId) {
    const root = firebase.database().ref('stores/' + currentStoreId);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const got = await wdmWithTimeout(Promise.all([
        root.child('inventory/' + branchId).once('value'),
        root.child('transactions').orderByChild('date').startAt(since).once('value'),
        root.child('supplies').orderByChild('date').limitToLast(500).once('value'),
        root.child('preOrders').once('value')
    ]), 20000);

    const sales = [], supplies = [];
    got[1].forEach(function (c) { const t = c.val(); if ((t.branchId || 'main') === branchId) sales.push(t); });
    got[2].forEach(function (c) { supplies.push(c.val()); });

    const openItems = wdmOutstandingFromOpenPreOrders(got[3].val() || {}, branchId, null);
    const items = wdmBuildDraftItems(got[0].val() || {}, sales, supplies, 14, 30, openItems);
    const record = {
        branchId: branchId, status: 'draft', items: items,
        createdBy: wdmActorName(), createdAt: new Date().toISOString(),
        history: [{ at: new Date().toISOString(), by: wdmActorName(), action: 'create', detail: items.length + ' suggested items' }]
    };
    const ref = firebase.database().ref('stores/' + currentStoreId + '/preOrders').push();
    await ref.set(record);
    return Object.assign({ id: ref.key }, record);
}

function wdmRemoveItem(id, index) { return wdmTransact(id, function (r) { return wdmRemoveItemPure(r, index, wdmActorName()); }); }
function wdmUpdateQty(id, index, qty) { return wdmTransact(id, function (r) { return wdmUpdateQtyPure(r, index, qty, wdmActorName()); }); }
function wdmAddItem(id, item) { return wdmTransact(id, function (r) { return wdmAddItemPure(r, item, wdmActorName()); }); }
function wdmAddNote(id, note) { return wdmTransact(id, function (r) { return wdmAppendHistory(Object.assign({}, r, { note: note }), wdmActorName(), 'note', note); }); }
function wdmSubmit(id) { return wdmTransact(id, function (r) { return wdmSubmitPure(r, wdmActorName()); }); }
function wdmReturnToManager(id, note) { return wdmTransact(id, function (r) { return wdmReturnPure(r, wdmActorName(), note); }); }
function wdmPlaceOrder(id) { return wdmTransact(id, function (r) { return wdmPlacePure(r, wdmActorName()); }); }
function wdmPriceSnapshot(p) {
    return { costPrice: wdmNum(p.costPrice), retailPrice: wdmNum(p.price !== undefined ? p.price : p.retailPrice), wholesalePrice: wdmNum(p.wholesalePrice), unitsPerPack: wdmNum(p.unitsPerPack) || 1, piecePrice: wdmNum(p.piecePrice) };
}

async function wdmRecordReceipt(preOrderId, branchId, groups, notes) {
    if (!groups || groups.length === 0) throw new Error("Enter at least one quantity received.");
    const by = wdmActorName();
    const nowIso = new Date().toISOString();
    const invRef = firebase.database().ref('stores/' + currentStoreId + '/inventory/' + branchId);
    const receiptEntries = [];

    for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const supplyItems = [];
        let totalCost = 0;
        for (let ii = 0; ii < g.items.length; ii++) {
            const it = g.items[ii];
            let found = true, stockBefore = 0, stockAfter = 0, before = null, after = null;
            let costPackNow = it.costPrice, uppNow = it.unitsPerPack;
            await invRef.child(it.id).transaction(function (p) {
                if (p === null || typeof p !== 'object') { found = false; return p; }
                found = true;
                stockBefore = wdmNum(p.stock !== undefined ? p.stock : p.stockQty);
                before = wdmPriceSnapshot(p);
                if (it.newPrices) {
                    if (it.newPrices.costPrice !== undefined) p.costPrice = it.newPrices.costPrice;
                    if (it.newPrices.retailPrice !== undefined) { p.price = it.newPrices.retailPrice; p.retailPrice = it.newPrices.retailPrice; }
                    if (it.newPrices.wholesalePrice !== undefined) p.wholesalePrice = it.newPrices.wholesalePrice;
                }
                if (it.newUnitsPerPack !== undefined) p.unitsPerPack = it.newUnitsPerPack;
                if (it.newPiecePrice !== undefined) p.piecePrice = it.newPiecePrice;
                stockAfter = wdmRound(stockBefore + it.receivedQty);
                p.stock = stockAfter; p.stockQty = stockAfter;
                after = wdmPriceSnapshot(p);
                costPackNow = wdmNum(p.costPrice); uppNow = wdmNum(p.unitsPerPack) || 1;
                return p;
            });

            const lineCost = wdmRound((costPackNow / uppNow) * it.receivedQty);
            totalCost = wdmRound(totalCost + lineCost);
            const packs = uppNow > 1 ? Math.floor(it.receivedQty / uppNow) : it.receivedQty;
            const loose = uppNow > 1 ? wdmRound(it.receivedQty - packs * uppNow) : 0;
            const changed = found && before && after && JSON.stringify(before) !== JSON.stringify(after);
            supplyItems.push({ name: it.name, productId: found ? it.id : null, qty: packs, loosePieces: loose, costPrice: costPackNow, unitsPerPackAtSupply: uppNow, piecesReceived: it.receivedQty, lineCost: lineCost, stockBefore: found ? stockBefore : null, stockAfter: found ? stockAfter : null, priceChange: changed ? { before: before, after: after } : null });
            receiptEntries.push({ id: it.id, name: it.name, receivedQty: it.receivedQty, priceChange: changed ? { before: before, after: after } : null });
        }

        const supplyId = 'SUP-' + firebase.database().ref('stores/' + currentStoreId + '/supplies').push().key;
        const supplyData = { supplyId: supplyId, supplierId: g.supplierId, supplierName: g.supplierName, branchId: branchId, items: supplyItems, totalCost: totalCost, notes: (notes ? notes + ' ' : '') + '(from Pre-Order ' + preOrderId + ')', date: nowIso, recordedBy: by };
        await firebase.database().ref('stores/' + currentStoreId + '/supplies/' + supplyId).set(supplyData);

        if (g.supplierId) {
            await firebase.database().ref('stores/' + currentStoreId + '/suppliers/' + g.supplierId).transaction(function (sup) {
                if (sup === null || typeof sup !== 'object') return sup;
                sup.totalSupplied = wdmRound(wdmNum(sup.totalSupplied) + totalCost);
                sup.supplyCount = wdmNum(sup.supplyCount) + 1;
                sup.lastSupplyDate = nowIso;
                return sup;
            });
        }
    }

    // (#2) Append the receipt to history as well, so the audit trail covers receiving.
    return wdmTransact(preOrderId, function (r) {
        const receipts = Object.assign({}, r.receipts || {});
        const key = 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1000);
        receipts[key] = { at: nowIso, by: by, items: receiptEntries };
        let next = Object.assign({}, r, { receipts: receipts });
        if (wdmIsFullyReceived(next)) next.status = 'received';
        const count = groups.reduce(function (a, g) { return a + g.items.length; }, 0);
        next = wdmAppendHistory(next, by, 'receive', count + ' items across ' + groups.length + ' supplier' + (groups.length === 1 ? '' : 's'));
        return next;
    });
}

// ---- added (#6): Admin-only repair that recomputes supplier counters from supply records ----
async function wdmRepairSupplierTotals() {
    if (currentUserRole !== 'Admin') return alert('Admin only.');
    if (!confirm('Recompute totalSupplied / supplyCount / lastSupplyDate for every supplier from the supply records?')) return;
    const root = firebase.database().ref('stores/' + currentStoreId);
    const supSnap = await root.child('suppliers').once('value');
    const suppliesSnap = await root.child('supplies').once('value');
    const acc = {};
    suppliesSnap.forEach(function (c) {
        const s = c.val();
        if (!s.supplierId) return;
        const a = acc[s.supplierId] = acc[s.supplierId] || { total: 0, count: 0, last: '' };
        a.total += wdmNum(s.totalCost);
        a.count += 1;
        if ((s.date || '') > a.last) a.last = s.date;
    });
    const updates = {};
    let n = 0;
    supSnap.forEach(function (c) {
        const id = c.key;
        const a = acc[id] || { total: 0, count: 0, last: '' };
        updates[id + '/totalSupplied'] = wdmRound(a.total);
        updates[id + '/supplyCount'] = a.count;
        updates[id + '/lastSupplyDate'] = a.last || null;
        n++;
    });
    await root.child('suppliers').update(updates);
    alert('Repaired ' + n + ' suppliers.');
}

async function wdmDeleteDraft(id) {
    const ref = firebase.database().ref('stores/' + currentStoreId + '/preOrders/' + id);
    const snap = await ref.once('value');
    const r = snap.val();
    if (!r || r.status !== 'draft') throw new Error("Only a draft (not yet submitted) can be deleted.");
    await ref.remove();
}

// =====================================================================
// UI
// =====================================================================
function wdmModal(title, html) {
    let m = document.getElementById('wdm-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdm-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1500; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:560px; max-height:94vh; overflow-y:auto; padding:18px; box-sizing:border-box;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">' +
        '<h3 style="margin:0; font-size:17px;">' + wdmEsc(title) + '</h3>' +
        '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdmCloseModal()">✕</button></div>' + html + '</div>';
    m.style.display = 'flex';
}
function wdmCloseModal() { const m = document.getElementById('wdm-modal'); if (m) m.style.display = 'none'; }

const WDM_STATUS_LABEL = { draft: ['#fffbeb', '#92400e', 'DRAFT'], submitted: ['#eff6ff', '#1d4ed8', 'SUBMITTED — waiting on Admin'], placed: ['#dcfce7', '#166534', 'PLACED'], received: ['#ecfdf5', '#047857', 'RECEIVED — stock updated'] };

// ---- changed (#9): Admin branch resolution is explicit, with a clear fallback ----
async function wdmOpenPreOrders() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return;
    let branchId;
    if (currentUserRole === 'Admin') {
        if (currentInventoryBranchFilter && currentInventoryBranchFilter !== 'all') branchId = currentInventoryBranchFilter;
        else if (currentBranch) branchId = currentBranch;
        else {
            const branches = typeof branchesCache !== 'undefined' ? Object.keys(branchesCache || {}) : [];
            if (branches.length === 0) { wdmModal('🛒 Pre-Orders', '<div style="padding:12px; color:#b91c1c;">Pick a specific branch first (Inventory → branch filter).</div>'); return; }
            branchId = branches[0];
        }
    } else {
        branchId = currentBranch;
    }
    if (!branchId) { wdmModal('🛒 Pre-Orders', '<div style="padding:12px; color:#b91c1c;">No branch available.</div>'); return; }

    wdmModal('🛒 Pre-Orders — ' + wdmBranchLabel(branchId), '<div style="text-align:center; color:#64748b; padding:20px;">Loading...</div>');
    try {
        const snap = await wdmWithTimeout(firebase.database().ref('stores/' + currentStoreId + '/preOrders').once('value'), 15000);
        const list = [];
        snap.forEach(function (c) { const r = c.val(); if ((r.branchId || 'main') === branchId) list.push(Object.assign({ id: c.key }, r)); });
        list.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
        wdmRenderList(branchId, list);
    } catch (e) {
        wdmModal('🛒 Pre-Orders', '<div style="color:#b91c1c; padding:12px;">Could not load: ' + wdmEsc(e.message) + '</div>');
    }
}

function wdmRenderList(branchId, list) {
    const newBtn = '<button data-branch="' + wdmEsc(branchId) + '" onclick="wdmStartNewDraft(this.dataset.branch)" class="menu-btn btn-action-primary" style="justify-content:center; margin-bottom:12px;">+ New Draft from Low Stock</button>';
    const rows = list.length === 0
        ? '<div style="text-align:center; color:#64748b; padding:16px;">No pre-orders yet for ' + wdmEsc(wdmBranchLabel(branchId)) + '.</div>'
        : list.map(function (r) {
            const s = WDM_STATUS_LABEL[r.status] || ['#f1f5f9', '#334155', r.status];
            const total = (r.items || []).reduce(function (sum, i) { return sum + wdmRound(i.orderQty * wdmUnitCost(i)); }, 0);
            return '<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px;">' +
                '<div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">' +
                '<span style="font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px; background:' + s[0] + '; color:' + s[1] + ';">' + s[2] + '</span>' +
                '<small style="color:#94a3b8;" title="' + wdmEsc(wdmPretty(r.createdAt)) + '">' + wdmEsc(wdmRelative(r.createdAt)) + '</small></div>' +
                '<div style="font-size:12px; margin:6px 0; color:#334155;">' + (r.items || []).length + ' item' + ((r.items || []).length === 1 ? '' : 's') + (total ? ' · est. ' + wdmMoney(total) : '') + '<br>Started by ' + wdmEsc(r.createdBy || '') + (r.submittedBy ? ' · submitted by ' + wdmEsc(r.submittedBy) : '') + (r.placedBy ? ' · placed by ' + wdmEsc(r.placedBy) : '') + '</div>' +
                '<button data-id="' + wdmEsc(r.id) + '" onclick="wdmOpenDetail(this.dataset.id)" style="padding:6px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc;">Open</button></div>';
        }).join('');
    wdmModal('🛒 Pre-Orders — ' + wdmBranchLabel(branchId), newBtn + rows);
}

// ---- changed (#4): refuse to create a second overlapping draft; offer the existing one ----
async function wdmStartNewDraft(branchId) {
    if (wdmOpenInFlight) return;
    wdmOpenInFlight = true;
    try {
        const snap = await firebase.database().ref('stores/' + currentStoreId + '/preOrders').once('value');
        let existing = null;
        snap.forEach(function (c) {
            const r = c.val();
            if ((r.branchId || 'main') !== branchId) return;
            if (r.status === 'draft' || r.status === 'submitted') existing = Object.assign({ id: c.key }, r);
        });
        if (existing) {
            const go = confirm("There's already an open " + existing.status + " list for this branch, started by " + (existing.createdBy || 'someone') + ". Open it instead?");
            if (go) return wdmOpenDetail(existing.id, existing);
            return;
        }

        wdmModal('🛒 Pre-Orders', '<div style="text-align:center; color:#64748b; padding:20px;">Working out what\'s low or running out...</div>');
        const record = await wdmCreateDraft(branchId);
        wdmOpenDetail(record.id, record);
    } catch (e) {
        wdmModal('🛒 Pre-Orders', '<div style="color:#b91c1c; padding:12px;">Could not create the draft: ' + wdmEsc(e.message) + '</div>');
    } finally {
        wdmOpenInFlight = false;
    }
}

async function wdmLoadCurrentInventory(record) {
    wdmCurrentInventory = null;
    if (!record || record.status !== 'placed') return;
    try {
        const snap = await wdmWithTimeout(firebase.database().ref('stores/' + currentStoreId + '/inventory/' + record.branchId).once('value'), 8000);
        wdmCurrentInventory = snap.val() || {};
    } catch (e) { wdmCurrentInventory = null; }
}

async function wdmOpenDetail(id, known) {
    wdmCurrentId = id;
    wdmModal('🛒 Pre-Order', '<div style="text-align:center; color:#64748b; padding:20px;">Loading...</div>');
    try {
        const record = known || (await wdmWithTimeout(firebase.database().ref('stores/' + currentStoreId + '/preOrders/' + id).once('value'), 12000)).val();
        if (!record) { wdmModal('🛒 Pre-Order', '<div style="color:#b91c1c; padding:12px;">This pre-order no longer exists.</div>'); return; }
        wdmCurrentRecord = Object.assign({ id: id }, record);
        await wdmLoadCurrentInventory(wdmCurrentRecord);
        wdmRenderDetail(wdmCurrentRecord);
    } catch (e) {
        wdmModal('🛒 Pre-Order', '<div style="color:#b91c1c; padding:12px;">Could not load: ' + wdmEsc(e.message) + '</div>');
    }
}

function wdmReceivingRowHtml(it, idx, receivedSoFar, prod) {
    const outstanding = wdmRound(Math.max(0, it.orderQty - receivedSoFar));
    const doneNote = receivedSoFar > 0 ? '<br><small style="color:#166534;">' + receivedSoFar + ' ' + wdmUnitLabel(it) + ' already received</small>' : '';
    const id = wdmEsc(it.id);
    const isWeight = !!it.soldByWeight;
    const per = isWeight ? '/' + wdmUnitLabel(it) : '/carton';
    const curCost = prod ? wdmNum(prod.costPrice) : wdmNum(it.costPrice);
    const curRetail = prod ? wdmNum(prod.price !== undefined ? prod.price : prod.retailPrice) : 0;
    const curWhole = prod ? wdmNum(prod.wholesalePrice) : 0;
    const curPiece = prod ? wdmNum(prod.piecePrice) : 0;
    const upp = prod ? (wdmNum(prod.unitsPerPack) || 1) : (wdmNum(it.unitsPerPack) || 1);
    const box = 'padding:6px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;';
    const priceInput = function (cls, label, val) {
        return '<div style="flex:1; min-width:90px;"><label style="font-size:10px; font-weight:bold; color:#475569;">' + label + '</label><input type="number" min="0" step="any" class="' + cls + '" data-id="' + id + '" value="' + (val || '') + '" placeholder="₦" style="width:100%; ' + box + '"></div>';
    };

    const current = prod
        ? 'Current: cost ' + wdmMoney(curCost) + per + ' · retail ' + wdmMoney(curRetail) + per + ' · wholesale ' + wdmMoney(curWhole) + per + (!isWeight && curPiece ? ' · ' + wdmMoney(curPiece) + '/piece' : '')
        : 'Couldn\'t load the current prices — you can still enter new ones.';

    const panel =
        '<div id="wdm-panel-' + idx + '" style="display:none; width:100%; margin-top:8px; padding:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">' +
        '<div style="font-size:11px; color:#475569; margin-bottom:8px;">' + current + '</div>' +
        '<label style="font-size:12px; font-weight:bold;">Has the price changed from before?</label>' +
        '<select class="wdm-price-changed" data-id="' + id + '" data-idx="' + idx + '" onchange="wdmOnPriceChangedToggle(this)" style="width:100%; ' + box + ' margin:4px 0 8px;"><option value="no">No — keep the current prices</option><option value="yes">Yes — I\'ll enter the new prices</option></select>' +
        '<div id="wdm-price-fields-' + idx + '" style="display:none; margin-bottom:8px;">' +
        '<div style="display:flex; gap:6px; flex-wrap:wrap;">' + priceInput('wdm-new-cost', 'New cost ' + per, '') + priceInput('wdm-new-retail', 'New retail ' + per, '') + priceInput('wdm-new-wholesale', 'New wholesale ' + per, '') + '</div>' +
        '<div style="font-size:10px; color:#94a3b8; margin-top:4px;">Leave a box empty to keep that price as it is.</div></div>' +
        (isWeight ? '' :
            '<div style="border-top:1px dashed #cbd5e1; padding-top:8px;">' +
            '<div style="font-size:12px; font-weight:bold; margin-bottom:6px;">Carton size &amp; price per piece</div>' +
            '<div style="display:flex; gap:6px; flex-wrap:wrap;">' +
            '<div style="flex:1; min-width:90px;"><label style="font-size:10px; font-weight:bold; color:#475569;">Pieces per carton</label><input type="number" min="1" step="1" class="wdm-ppc" data-id="' + id + '" value="' + upp + '" style="width:100%; ' + box + '"></div>' +
            '<div style="flex:1; min-width:90px;"><label style="font-size:10px; font-weight:bold; color:#475569;">Retail price per piece</label><input type="number" min="0" step="any" class="wdm-piece" data-id="' + id + '" value="' + (curPiece || '') + '" placeholder="₦" oninput="this.dataset.touched=\'1\'" style="width:100%; ' + box + '"></div>' +
            '<div style="flex:1; min-width:90px;"><label style="font-size:10px; font-weight:bold; color:#475569;">Cartons received</label><input type="number" min="0" step="any" class="wdm-cartons" data-id="' + id + '" placeholder="e.g. 5" oninput="wdmOnCartons(this)" style="width:100%; ' + box + '"></div></div>' +
            '<div style="font-size:10px; color:#94a3b8; margin-top:4px;">Example: 1 carton = 6 pieces, 5 cartons received → 30 pieces are added to stock.</div></div>') +
        '</div>';

    return '<div style="padding:8px 0; border-bottom:1px dashed #e2e8f0;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
        '<div style="flex:1;"><strong>' + wdmEsc(it.name) + '</strong><br><small style="color:#64748b;">Ordered ' + wdmRound(it.orderQty) + ' ' + wdmUnitLabel(it) + '</small>' + doneNote + '</div>' +
        '<input type="number" min="0" step="any" placeholder="0" value="' + (outstanding > 0 ? outstanding : '') + '" data-id="' + id + '" class="wdm-receive-qty" style="width:70px; ' + box + ' text-align:right;">' +
        '<span style="font-size:11px; color:#64748b; width:34px;">' + wdmUnitLabel(it) + '</span></div>' +
        '<button type="button" data-idx="' + idx + '" onclick="wdmTogglePanel(this)" style="margin-top:6px; padding:4px 10px; font-size:11px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #bae6fd; background:#f0f9ff; color:#0369a1;">💲 Price / carton details</button>' +
        panel + '</div>';
}

function wdmTogglePanel(btn) {
    const el = document.getElementById('wdm-panel-' + btn.dataset.idx);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
function wdmOnPriceChangedToggle(sel) {
    const el = document.getElementById('wdm-price-fields-' + sel.dataset.idx);
    if (el) el.style.display = sel.value === 'yes' ? 'block' : 'none';
}
function wdmFieldFor(cls, id) {
    const list = document.querySelectorAll('.' + cls);
    for (let i = 0; i < list.length; i++) if (list[i].dataset.id === id) return list[i];
    return null;
}
function wdmOnCartons(input) {
    const id = input.dataset.id;
    const ppc = wdmFieldFor('wdm-ppc', id), qty = wdmFieldFor('wdm-receive-qty', id);
    const cartons = parseFloat(input.value), per = parseFloat(ppc && ppc.value);
    if (qty && cartons > 0 && per >= 1) qty.value = wdmRound(cartons * per);
}

function wdmReceivedRowHtml(it, receivedSoFar) {
    const complete = receivedSoFar >= it.orderQty - 1e-9;
    return '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 0; border-bottom:1px dashed #e2e8f0;">' +
        '<div style="flex:1;"><strong>' + wdmEsc(it.name) + '</strong><br><small style="color:#64748b;">Ordered ' + wdmRound(it.orderQty) + ' ' + wdmUnitLabel(it) + '</small></div>' +
        '<span style="font-weight:bold; color:' + (complete ? '#166534' : '#b45309') + ';">' + wdmRound(receivedSoFar) + ' ' + wdmUnitLabel(it) + '</span></div>';
}

function wdmReceiptHistoryHtml(r) {
    const keys = Object.keys(r.receipts || {}).sort(function (a, b) { return String(r.receipts[a].at).localeCompare(String(r.receipts[b].at)); });
    if (keys.length === 0) return '';
    const rows = keys.map(function (k) {
        const rec = r.receipts[k];
        const lines = (rec.items || []).map(function (i) {
            let t = wdmEsc(i.name) + ' × ' + wdmRound(i.receivedQty);
            if (i.priceChange && i.priceChange.before && i.priceChange.after) {
                const b = i.priceChange.before, a = i.priceChange.after, bits = [];
                if (b.costPrice !== a.costPrice) bits.push('cost ' + wdmMoney(b.costPrice) + ' → ' + wdmMoney(a.costPrice));
                if (b.retailPrice !== a.retailPrice) bits.push('retail ' + wdmMoney(b.retailPrice) + ' → ' + wdmMoney(a.retailPrice));
                if (b.wholesalePrice !== a.wholesalePrice) bits.push('wholesale ' + wdmMoney(b.wholesalePrice) + ' → ' + wdmMoney(a.wholesalePrice));
                if (b.unitsPerPack !== a.unitsPerPack) bits.push('carton ' + b.unitsPerPack + ' → ' + a.unitsPerPack + ' pcs');
                if (b.piecePrice !== a.piecePrice) bits.push('per piece ' + wdmMoney(b.piecePrice) + ' → ' + wdmMoney(a.piecePrice));
                if (bits.length) t += ' <span style="color:#b45309;">(' + bits.join('; ') + ')</span>';
            }
            return t;
        }).join('<br>');
        return '<div style="font-size:12px; padding:4px 0;">📥 ' + wdmPretty(rec.at) + ' by ' + wdmEsc(rec.by || '') + '<br><span style="color:#64748b;">' + lines + '</span></div>';
    }).join('<hr style="border:none; border-top:1px dashed #e2e8f0; margin:4px 0;">');
    return '<div style="border-top:1px solid #e2e8f0; padding:10px 0; margin-top:6px;"><div style="font-weight:bold; font-size:13px; margin-bottom:4px;">📜 Receiving history</div>' + rows + '</div>';
}

function wdmRenderDetail(r) {
    const s = WDM_STATUS_LABEL[r.status] || ['#f1f5f9', '#334155', r.status];
    const editable = wdmCanEdit(r, currentUserRole);
    const items = r.items || [];
    const total = items.reduce(function (sum, i) { return sum + wdmRound(i.orderQty * wdmUnitCost(i)); }, 0);
    const canReceive = (currentUserRole === 'Admin' || currentUserRole === 'Manager') && r.status === 'placed';
    const receivedTotals = wdmReceivedTotals(r);

    const rows = items.length === 0 ? '<div style="text-align:center; color:#64748b; padding:12px;">No items on this list.</div>' : items.map(function (it, idx) {
        if (r.status === 'placed' && canReceive) return wdmReceivingRowHtml(it, idx, receivedTotals[it.id] || 0, wdmCurrentInventory && wdmCurrentInventory[it.id] ? wdmCurrentInventory[it.id] : null);
        if (r.status === 'received') return wdmReceivedRowHtml(it, receivedTotals[it.id] || 0);
        return '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 0; border-bottom:1px dashed #e2e8f0;">' +
            '<div style="flex:1;"><strong>' + wdmEsc(it.name) + '</strong><br><small style="color:#64748b;">' + wdmEsc(it.supplierName || 'No supplier on record') + (it.daysLeft !== null && it.daysLeft !== undefined ? ' · ~' + it.daysLeft + ' days of stock left' : '') + '</small></div>' +
            (editable
                ? '<input type="number" min="0.01" step="any" value="' + it.orderQty + '" data-idx="' + idx + '" onchange="wdmOnQtyChange(this)" style="width:70px; padding:6px; border:1px solid #cbd5e1; border-radius:6px; text-align:right;">' +
                  '<span style="font-size:11px; color:#64748b; width:34px;">' + wdmUnitLabel(it) + '</span>' +
                  '<button data-idx="' + idx + '" onclick="wdmOnRemove(this)" style="padding:4px 8px; font-size:11px; border-radius:6px; cursor:pointer; border:1px solid #fecaca; background:#fef2f2; color:#991b1b;">✕</button>'
                : '<span style="font-weight:bold;">' + wdmRound(it.orderQty) + ' ' + wdmUnitLabel(it) + '</span>') + '</div>';
    }).join('');

    let actions = '';
    if (r.status === 'draft' && editable) {
        actions = (currentUserRole === 'Admin' ? '<button onclick="wdmOpenAddItem()" class="menu-btn" style="justify-content:center; margin:0 0 8px 0; background:#f0f9ff; border:1px solid #bae6fd; color:#0369a1;">➕ Add item</button>' : '') +
            '<button onclick="wdmCopyList()" class="menu-btn" style="justify-content:center; margin:0 0 8px 0; background:#f8fafc; border:1px solid #cbd5e1;">📋 Copy as text</button>' +
            '<button onclick="wdmDoSubmit()" class="menu-btn btn-action-primary" style="justify-content:center; margin:0 0 8px 0;" ' + (items.length === 0 ? 'disabled' : '') + '>📤 Submit to Admin</button>' +
            (currentUserRole === 'Admin' ? '<button onclick="wdmDoDelete()" class="menu-btn btn-logout" style="justify-content:center; margin:0;">🗑 Delete Draft</button>' : '');
    } else if (r.status === 'submitted' && currentUserRole === 'Admin') {
        actions = '<button onclick="wdmOpenAddItem()" class="menu-btn" style="justify-content:center; margin:0 0 8px 0; background:#f0f9ff; border:1px solid #bae6fd; color:#0369a1;">➕ Add item</button>' +
            '<button onclick="wdmCopyList()" class="menu-btn" style="justify-content:center; margin:0 0 8px 0; background:#f8fafc; border:1px solid #cbd5e1;">📋 Copy as text</button>' +
            '<button onclick="wdmDoPlace()" class="menu-btn btn-action-primary" style="justify-content:center; margin:0 0 8px 0; background:#16a34a;" ' + (items.length === 0 ? 'disabled' : '') + '>✅ Place Order</button>' +
            '<button onclick="wdmDoReturn()" class="menu-btn" style="justify-content:center; margin:0; background:#fffbeb; border:1px solid #fde68a; color:#92400e;">↩ Send Back to Manager</button>';
    } else if (r.status === 'submitted') {
        actions = '<button onclick="wdmCopyList()" class="menu-btn" style="justify-content:center; margin:0; background:#f8fafc; border:1px solid #cbd5e1;">📋 Copy as text</button>';
    } else if (r.status === 'placed') {
        const groups = wdmGroupBySupplier(items);
        actions = groups.map(function (g, gi) {
            return '<button data-gi="' + gi + '" onclick="wdmWhatsappGroup(this.dataset.gi)" style="display:block; width:100%; box-sizing:border-box; margin-bottom:6px; padding:8px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #86efac; background:#dcfce7; color:#166534;">📲 Order from ' + wdmEsc(g.supplierName) + (wdmGroupTotal(g) ? ' — ' + wdmMoney(wdmGroupTotal(g)) : '') + '</button>';
        }).join('');
        wdmCurrentGroups = groups;
        actions += '<button onclick="wdmCopyList()" class="menu-btn" style="justify-content:center; margin:8px 0 0 0; background:#f8fafc; border:1px solid #cbd5e1;">📋 Copy as text</button>';
        if (canReceive) {
            actions += '<div style="border-top:1px solid #e2e8f0; margin-top:8px; padding-top:10px;">' +
                '<div style="font-weight:bold; font-size:13px; margin-bottom:6px;">📥 Record what you received</div>' +
                '<input type="text" id="wdm-receive-notes" placeholder="Note (e.g. invoice number) — optional" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:8px; box-sizing:border-box;">' +
                '<button onclick="wdmDoRecordReceipt()" class="menu-btn btn-action-primary" style="justify-content:center; margin:0; background:#0284c7;">💾 Save &amp; Update Stock</button></div>';
        }
    } else if (r.status === 'received') {
        actions = '<button onclick="wdmCopyList()" class="menu-btn" style="justify-content:center; margin:0; background:#f8fafc; border:1px solid #cbd5e1;">📋 Copy as text</button>';
    }

    // ---- changed (#2): the return banner + Ack button for the Manager ----
    let noteBox = '';
    if (r.reviewNote) {
        const isManager = currentUserRole === 'Manager';
        noteBox = '<div style="font-size:12px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:8px; margin-bottom:10px;">' +
            '<strong>↩ Sent back by Admin:</strong> ' + wdmEsc(r.reviewNote) +
            (isManager ? '<br><button onclick="wdmAckReturn()" style="margin-top:6px; padding:3px 8px; font-size:11px; border-radius:6px; cursor:pointer; border:1px solid #fde68a; background:#fff; color:#92400e;">Got it — I\'ll fix it</button>' : '') +
            '</div>';
    } else if (r.note) {
        noteBox = '<div style="font-size:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px; margin-bottom:10px;">' + wdmEsc(r.note) + '</div>';
    }

    wdmModal('🛒 Pre-Order', '<div style="margin-bottom:8px;"><span style="font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px; background:' + s[0] + '; color:' + s[1] + ';">' + s[2] + '</span> <small style="color:#94a3b8;">started by ' + wdmEsc(r.createdBy || '') + ' · ' + wdmPretty(r.createdAt) + '</small></div>' +
        noteBox + rows +
        '<div style="text-align:right; font-weight:bold; padding:8px 0;">Estimated total: ' + wdmMoney(total) + '</div>' +
        wdmReceiptHistoryHtml(r) +
        '<div style="position:sticky; bottom:0; background:#fff; border-top:1px solid #e2e8f0; padding-top:10px;">' + actions + '</div>');
}

// ---- added (#13): sanity check on quantity edits ----
function wdmOnQtyChange(input) {
    const idx = parseInt(input.dataset.idx);
    const qty = parseFloat(input.value);
    const it = wdmCurrentRecord.items[idx];
    if (wdmQtyLooksWrong(qty, it && it.suggestQty)) {
        if (!confirm('That looks unusually large (' + qty + '). Save it anyway?')) { wdmRenderDetail(wdmCurrentRecord); return; }
    }
    wdmUpdateQty(wdmCurrentId, idx, qty).then(function (r) { wdmCurrentRecord = Object.assign({ id: wdmCurrentId }, r); wdmRenderDetail(wdmCurrentRecord); })
        .catch(function (e) { alert(e.message); wdmOpenDetail(wdmCurrentId); });
}
function wdmOnRemove(btn) {
    const idx = parseInt(btn.dataset.idx);
    if (!confirm('Remove this item from the list?')) return;
    wdmRemoveItem(wdmCurrentId, idx).then(function (r) { wdmCurrentRecord = Object.assign({ id: wdmCurrentId }, r); wdmRenderDetail(wdmCurrentRecord); })
        .catch(function (e) { alert(e.message); wdmOpenDetail(wdmCurrentId); });
}
function wdmDoSubmit() {
    wdmSubmit(wdmCurrentId).then(function () { alert("Sent to the Admin for review."); wdmOpenPreOrders(); }).catch(function (e) { alert(e.message); });
}
function wdmDoReturn() {
    const note = prompt("Optional note for the Manager (what needs changing?):") || '';
    wdmReturnToManager(wdmCurrentId, note).then(function () { alert("Sent back to the Manager."); wdmOpenPreOrders(); }).catch(function (e) { alert(e.message); });
}
function wdmDoPlace() {
    if (!confirm("Place this order? The list will be locked.")) return;
    wdmPlaceOrder(wdmCurrentId).then(function (r) { wdmCurrentRecord = Object.assign({ id: wdmCurrentId }, r); wdmRenderDetail(wdmCurrentRecord); }).catch(function (e) { alert(e.message); });
}
function wdmDoRecordReceipt() {
    const entered = {};
    const ensure = function (id) { return entered[id] = entered[id] || {}; };
    const each = function (cls, fn) { const list = document.querySelectorAll('.' + cls); for (let i = 0; i < list.length; i++) fn(list[i], list[i].dataset.id); };

    each('wdm-receive-qty', function (el, id) { ensure(id).qty = parseFloat(el.value) || 0; });
    each('wdm-price-changed', function (el, id) { ensure(id).priceChanged = el.value === 'yes'; });
    each('wdm-new-cost', function (el, id) { ensure(id).cost = el.value; });
    each('wdm-new-retail', function (el, id) { ensure(id).retail = el.value; });
    each('wdm-new-wholesale', function (el, id) { ensure(id).wholesale = el.value; });
    each('wdm-ppc', function (el, id) { ensure(id).unitsPerPack = el.value; });
    each('wdm-piece', function (el, id) { ensure(id).piecePrice = el.value; });

    let groups;
    try { groups = wdmBuildReceiptGroups(wdmCurrentRecord.items || [], entered); }
    catch (e) { alert(e.message); return; }
    if (groups.length === 0) { alert("Enter at least one quantity received."); return; }

    const relabelled = [];
    groups.forEach(function (g) {
        g.items.forEach(function (it) {
            const prod = wdmCurrentInventory && wdmCurrentInventory[it.id];
            if (!prod || it.newUnitsPerPack === undefined) return;
            const oldUpp = wdmNum(prod.unitsPerPack) || 1;
            const stock = wdmNum(prod.stock !== undefined ? prod.stock : prod.stockQty);
            if (it.newUnitsPerPack !== oldUpp && stock > 0) relabelled.push(it.name + ' (now ' + stock + ' in stock)');
        });
    });
    if (relabelled.length && !confirm('You changed the number of pieces per carton for: ' + relabelled.join(', ') + '.\n\nStock is counted in pieces, so what you already have stays the same number of pieces. Continue?')) return;

    const notesEl = document.getElementById('wdm-receive-notes');
    const notes = notesEl ? notesEl.value.trim() : '';
    wdmRecordReceipt(wdmCurrentId, wdmCurrentRecord.branchId, groups, notes).then(async function (r) {
        wdmCurrentRecord = Object.assign({ id: wdmCurrentId }, r);
        await wdmLoadCurrentInventory(wdmCurrentRecord);
        wdmRenderDetail(wdmCurrentRecord);
        alert(r.status === 'received' ? "Recorded — every item has now been received in full. Stock and prices have been updated." : "Recorded. Stock and prices have been updated. Some items are still outstanding.");
    }).catch(function (e) { alert("Could not save: " + e.message); });
}

function wdmDoDelete() {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    wdmDeleteDraft(wdmCurrentId).then(function () { wdmOpenPreOrders(); }).catch(function (e) { alert(e.message); });
}
function wdmWhatsappGroup(gi) {
    const g = wdmCurrentGroups[parseInt(gi)];
    if (!g) return;
    const supHas = typeof suppliersCache !== 'undefined' && g.supplierId && suppliersCache[g.supplierId];
    const phone = supHas ? suppliersCache[g.supplierId].phone : '';
    const msg = wdmOrderMessage(g, wdmBusinessName());
    const number = wdmWaNumber(phone);
    if (!number) { prompt('No phone number on record for this supplier. Copy the message:', msg); return; }
    window.open('https://wa.me/' + number + '?text=' + encodeURIComponent(msg), '_blank');
}

// ---- added (#11): copy the current list to the clipboard ----
function wdmCopyList() {
    const txt = wdmListAsText(wdmCurrentRecord, wdmBusinessName());
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { alert('List copied. Paste it into email or SMS.'); })
            .catch(function () { prompt('Copy the list:', txt); });
    } else {
        prompt('Copy the list:', txt);
    }
}

// ---- added (#2): Manager acknowledges a returned draft ----
function wdmAckReturn() {
    wdmTransact(wdmCurrentId, function (r) {
        return wdmAppendHistory(Object.assign({}, r, { reviewNote: '' }), wdmActorName(), 'ack', 'Manager saw the return note');
    }).then(function (rec) {
        wdmCurrentRecord = Object.assign({ id: wdmCurrentId }, rec);
        wdmRenderDetail(wdmCurrentRecord);
    }).catch(function (e) { alert(e.message); });
}

// ---- added (#3): Admin add-item picker ----
async function wdmOpenAddItem() {
    const onList = {};
    (wdmCurrentRecord.items || []).forEach(function (i) { onList[i.id] = true; });
    const snap = await firebase.database().ref('stores/' + currentStoreId + '/inventory/' + wdmCurrentRecord.branchId).once('value');
    const rows = [];
    snap.forEach(function (c) {
        const it = c.val();
        if (!it || onList[c.key]) return;
        rows.push({ id: c.key, name: it.name || it.productName || 'Unnamed', soldByWeight: !!it.soldByWeight, weightUnit: it.weightUnit || 'Kg', unitsPerPack: wdmNum(it.unitsPerPack) || 1, stock: wdmNum(it.stock !== undefined ? it.stock : it.stockQty), costPrice: wdmNum(it.costPrice), lowStockThreshold: it.lowStockThreshold });
    });
    rows.sort(function (a, b) { return a.name.localeCompare(b.name); });

    const html = rows.length === 0
        ? '<div style="padding:12px; color:#64748b;">Every product is already on the list.</div>'
        : '<input id="wdm-add-search" placeholder="Search products..." oninput="wdmFilterAddList(this.value)" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box; margin-bottom:8px;">' +
          '<div id="wdm-add-list" style="max-height:50vh; overflow-y:auto;">' + rows.map(function (r) {
              return '<div class="wdm-add-row" data-name="' + wdmEsc(r.name.toLowerCase()) + '" onclick="wdmPickAddItem(this)" data-id="' + wdmEsc(r.id) + '" style="padding:8px; border-bottom:1px dashed #e2e8f0; cursor:pointer;">' +
                  '<strong>' + wdmEsc(r.name) + '</strong><br>' +
                  '<small style="color:#64748b;">Stock: ' + r.stock + ' ' + (r.soldByWeight ? (r.weightUnit || 'Kg').toLowerCase() : 'pcs') + '</small></div>';
          }).join('') + '</div>';
    wdmModal('➕ Add item', html);
    window.__wdmAddRows = {}; rows.forEach(function (r) { window.__wdmAddRows[r.id] = r; });
}
function wdmFilterAddList(q) {
    q = (q || '').toLowerCase();
    const nodes = document.querySelectorAll('.wdm-add-row');
    for (let i = 0; i < nodes.length; i++) nodes[i].style.display = nodes[i].dataset.name.indexOf(q) === -1 ? 'none' : 'block';
}
function wdmPickAddItem(el) {
    const r = window.__wdmAddRows[el.dataset.id];
    if (!r) return;
    const qty = parseFloat(prompt('Quantity to order for "' + r.name + '":', 1));
    if (!(qty > 0)) return;
    wdmAddItem(wdmCurrentId, Object.assign({}, r, { orderQty: qty, suggestQty: 1 }))
        .then(function (rec) { wdmCurrentRecord = Object.assign({ id: wdmCurrentId }, rec); wdmRenderDetail(wdmCurrentRecord); })
        .catch(function (e) { alert(e.message); });
}

// =====================================================================
// (#1) Unread badge + listener
// =====================================================================
var wdmUnreadRef = null;
function wdmStartPreOrdersListener() {
    if (wdmUnreadRef) return;
    if (!currentStoreId || !currentBranch) return;
    wdmUnreadRef = firebase.database().ref('stores/' + currentStoreId + '/preOrders');
    wdmUnreadRef.on('value', function (snap) {
        const counts = { submitted: 0, returned: 0, placed: 0 };
        snap.forEach(function (c) {
            const r = c.val();
            if (currentUserRole === 'Admin' && r.status === 'submitted') counts.submitted++;
            if (currentUserRole === 'Manager') {
                if ((r.branchId || 'main') !== currentBranch) return;
                if (r.status === 'draft' && r.reviewNote) counts.returned++;
                if (r.status === 'placed') counts.placed++;
            }
        });
        wdmUnread = counts;
        wdmRenderBadge();
    });
}
function wdmStopPreOrdersListener() {
    if (wdmUnreadRef) { wdmUnreadRef.off(); wdmUnreadRef = null; }
    const btn = document.getElementById('wdm-preorders-btn');
    if (btn) { const b = btn.querySelector('.wdm-badge'); if (b) b.remove(); }
}
function wdmRenderBadge() {
    const btn = document.getElementById('wdm-preorders-btn');
    if (!btn) return;
    const total = wdmUnread.submitted + wdmUnread.returned + wdmUnread.placed;
    let badge = btn.querySelector('.wdm-badge');
    if (total === 0) { if (badge) badge.remove(); return; }
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wdm-badge';
        badge.style.cssText = 'margin-left:auto; background:#dc2626; color:#fff; font-size:10px; font-weight:bold; border-radius:10px; padding:1px 6px;';
        btn.appendChild(badge);
    }
    badge.textContent = total;
}

// =====================================================================
// Manager role: sidebar, staff dropdown, auto-open on login
// =====================================================================
function wdmApplySidebarButton(role) {
    const btn = document.getElementById('wdm-preorders-btn');
    if (btn) btn.style.display = (role === 'Admin' || role === 'Manager') ? 'block' : 'none';
}

(function wrapAdjustSidebarForRole() {
    const prev = window.adjustSidebarForRole;
    if (typeof prev !== 'function' || prev.__wdm) return;
    const wrapped = function (role) {
        if (role === 'Manager') {
            const buttons = document.querySelectorAll('.sidebar button');
            buttons.forEach(function (btn) {
                const action = btn.getAttribute('onclick') || '';
                const allowed = action.indexOf('logout') !== -1 || action.indexOf('pos-view') !== -1 || action.indexOf('inventory-view') !== -1 || btn.id === 'wdm-preorders-btn';
                btn.style.display = allowed ? 'block' : 'none';
            });
        } else {
            prev(role);
        }
        wdmApplySidebarButton(role);
        wdmStartPreOrdersListener();
    };
    wrapped.__wdm = true;
    window.adjustSidebarForRole = wrapped;
})();

function wdmEnsureSidebarButton() {
    if (document.getElementById('wdm-preorders-btn')) { wdmApplySidebarButton(currentUserRole); return; }
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const logoutBtn = sidebar.querySelector('button[onclick="logout()"]');
    const btn = document.createElement('button');
    btn.id = 'wdm-preorders-btn';
    btn.className = 'menu-btn btn-supplier';
    btn.textContent = '🛒 Pre-Orders';
    btn.onclick = wdmOpenPreOrders;
    if (logoutBtn && logoutBtn.parentElement) logoutBtn.parentElement.insertBefore(btn, logoutBtn);
    else sidebar.appendChild(btn);
    wdmApplySidebarButton(currentUserRole);
}

function wdmEnsureStaffRoleOption() {
    const sel = document.getElementById('staff-role-input');
    if (!sel) return;
    let has = false;
    for (let i = 0; i < sel.options.length; i++) if (sel.options[i].value === 'Manager') has = true;
    if (!has) {
        const opt = document.createElement('option');
        opt.value = 'Manager';
        opt.textContent = 'Manager';
        sel.appendChild(opt);
    }
}

function wdmAttach() {
    try { wdmEnsureSidebarButton(); } catch (e) {}
    try { wdmEnsureStaffRoleOption(); } catch (e) {}
    try { if (currentStoreId && currentBranch) wdmStartPreOrdersListener(); } catch (e) {}
}

// (#19) Replaced the polling setInterval with a MutationObserver + one initial run.
(function wdmWatchDom() {
    let pending = false;
    const fire = function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; try { wdmAttach(); } catch (e) { console.warn(e); } });
    };
    if (document.body) {
        fire();
        const mo = new MutationObserver(fire);
        mo.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', fire);
    }
})();

// Managers can make sales and manage inventory for their branch, plus use Pre-Orders (a modal,
// not routed through here). Everything else stays off-limits even if something bypasses the sidebar.
var WDM_MANAGER_ALLOWED_VIEWS = ['pos-view', 'pos-view-template', 'inventory-view', 'inventory-view-template', 'receipt-view', 'receipt-view-template', 'login-view', 'register-view'];

(function hookRoutingGuard() {
    const prev = window.switchView;
    if (typeof prev !== 'function') return;
    window.switchView = function (viewId) {
        if (currentUserRole === 'Manager' && WDM_MANAGER_ALLOWED_VIEWS.indexOf(viewId) === -1) {
            alert("Access Restricted: Managers are permitted to make sales and manage inventory for their assigned branch, and to review Pre-Orders.");
            return;
        }
        return prev.apply(this, arguments);
    };
})();

// =====================================================================
// (#16) Exports for testing — pure functions only, no DOM/Firebase
// =====================================================================
window.WDM = {
    version: WDM_VERSION,
    buildDraftItems: wdmBuildDraftItems,
    groupBySupplier: wdmGroupBySupplier,
    groupTotal: wdmGroupTotal,
    outstandingFromOpenPreOrders: wdmOutstandingFromOpenPreOrders,
    canEdit: wdmCanEdit,
    removeItemPure: wdmRemoveItemPure,
    updateQtyPure: wdmUpdateQtyPure,
    addItemPure: wdmAddItemPure,
    submitPure: wdmSubmitPure,
    returnPure: wdmReturnPure,
    placePure: wdmPlacePure,
    orderMessage: wdmOrderMessage,
    receivedTotals: wdmReceivedTotals,
    isFullyReceived: wdmIsFullyReceived,
    buildReceiptGroups: wdmBuildReceiptGroups,
    qtyLooksWrong: wdmQtyLooksWrong,
    listAsText: wdmListAsText,
    appendHistory: wdmAppendHistory
};

// Optional: expose the supplier repair utility for Admin use from the console:
//   WDM_repairSupplierTotals()
window.WDM_repairSupplierTotals = wdmRepairSupplierTotals;
