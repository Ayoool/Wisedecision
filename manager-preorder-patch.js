// ==================== WISE DECISION MANAGER & PRE-ORDERS PATCH (v34) ====================
// Load LAST (after all the other patches), with `defer`.
//
//   * New "Manager" role, selectable when adding staff. Their sidebar shows only Pre-Orders
//     and Logout — nothing else.
//   * "🛒 Pre-Orders" button (Admin + Manager) opens a workflow with real states:
//       Draft (Manager or Admin can edit) -> Submitted (Admin can edit) -> Placed (locked)
//   * A shared editable list — remove an item, or change its quantity — used at every stage.
//   * A new draft starts pre-filled from the same low-stock / running-out logic as the
//     existing Reorder List, grouped by supplier, with a numeric suggested quantity per item.
//   * Once placed, each supplier group gets a "Order on WhatsApp" button with the message
//     pre-filled from the FINAL quantities (not the original suggestions).
//
// Data lives at stores/{storeId}/preOrders/{id} — outside inventory, so it doesn't touch
// anything the rest of the app reads.

console.log("Wise Decision manager-preorder-patch.js — v34 loaded");

// ---------- Helpers ----------
function wdmNum(n) { return Number(n) || 0; }
function wdmRound(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function wdmEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdmMoney(n) { return '₦' + wdmRound(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function wdmPretty(iso) { const t = new Date(iso); return isNaN(t) ? '—' : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
function wdmActorName() { const el = document.getElementById('user-role-label'); return (el && el.textContent.trim()) || currentUserRole || 'Staff'; }
function wdmBusinessName() { const el = document.getElementById('dashboard-store-title'); return (el && el.textContent.trim()) || 'Wise Decision'; }
function wdmBranchLabel(id) { return typeof branchNameOf === 'function' ? branchNameOf(id) : id; }
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

// =====================================================================
// PURE LOGIC (no DOM, no Firebase — this is what gets tested)
// =====================================================================

// Builds the starting item list for a new draft from current stock, recent sales and supply
// history — same idea as the Reorder List, but with a plain numeric quantity to edit.
function wdmBuildDraftItems(items, sales, supplies, coverDays, days) {
    coverDays = coverDays || 14; days = days || 30;
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
        const daysLeft = daily > 0 ? stock / daily : null;
        const isLow = stock <= threshold;
        const runningOut = daysLeft !== null && daysLeft <= 7;
        if (!isLow && !runningOut) return;

        let suggestQty;
        if (daily > 0) suggestQty = Math.max(1, Math.ceil(daily * coverDays - stock));
        else suggestQty = Math.max(1, Math.ceil(threshold - stock) || 1);

        const sup = byId[id] || byName[(item.name || item.productName || '').toLowerCase().trim()] || null;
        out.push({
            id: id, name: item.name || item.productName || 'Unnamed Item',
            supplierId: sup ? sup.id : null, supplierName: sup ? sup.name : null,
            soldByWeight: !!item.soldByWeight, weightUnit: item.weightUnit || 'Kg', unitsPerPack: wdmNum(item.unitsPerPack) || 1,
            stockAtCreation: stock, threshold: threshold,
            daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
            costPrice: wdmNum(item.costPrice), suggestQty: suggestQty, orderQty: suggestQty
        });
    });

    out.sort(function (a, b) { return (a.daysLeft === null ? 9999 : a.daysLeft) - (b.daysLeft === null ? 9999 : b.daysLeft) || a.stockAtCreation - b.stockAtCreation; });
    return out;
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

// ----- State transitions (pure — take a record, return a new one, or throw a clear reason) -----
function wdmCanEdit(record, role) {
    if (!record) return false;
    if (record.status === 'draft') return role === 'Manager' || role === 'Admin';
    if (record.status === 'submitted') return role === 'Admin';
    return false;
}
function wdmRemoveItemPure(record, index) {
    if (!record.items || index < 0 || index >= record.items.length) throw new Error("That item is no longer on the list.");
    const items = record.items.slice();
    items.splice(index, 1);
    return Object.assign({}, record, { items: items });
}
function wdmUpdateQtyPure(record, index, qty) {
    if (!record.items || index < 0 || index >= record.items.length) throw new Error("That item is no longer on the list.");
    qty = wdmRound(qty);
    if (!(qty > 0)) throw new Error("Quantity must be greater than zero — remove the item instead if you don't want it.");
    const items = record.items.slice();
    items[index] = Object.assign({}, items[index], { orderQty: qty });
    return Object.assign({}, record, { items: items });
}
function wdmSubmitPure(record, by) {
    if (record.status !== 'draft') throw new Error("Only a draft can be submitted.");
    if (!record.items || record.items.length === 0) throw new Error("Add at least one item before submitting.");
    return Object.assign({}, record, { status: 'submitted', submittedBy: by, submittedAt: new Date().toISOString() });
}
function wdmReturnPure(record, by, note) {
    if (record.status !== 'submitted') throw new Error("Only a submitted list can be sent back for edits.");
    return Object.assign({}, record, { status: 'draft', reviewedBy: by, reviewedAt: new Date().toISOString(), reviewNote: note || '' });
}
function wdmPlacePure(record, by) {
    if (record.status !== 'submitted') throw new Error("Only a submitted list can be placed.");
    if (!record.items || record.items.length === 0) throw new Error("There are no items left to order.");
    return Object.assign({}, record, { status: 'placed', placedBy: by, placedAt: new Date().toISOString() });
}

function wdmOrderMessage(group, businessName) {
    const lines = group.items.map(function (i) { return '• ' + i.name + ': ' + wdmRound(i.orderQty) + ' ' + wdmUnitLabel(i); });
    return 'Hello ' + group.supplierName + ', please we need to restock the following for ' + businessName + ':\n\n' + lines.join('\n') + '\n\nKindly confirm availability and price. Thank you.';
}

// =====================================================================
// FIREBASE — thin wrappers around the pure functions above (atomic, so two people
// editing the same pre-order at once can never lose one of their changes)
// =====================================================================
async function wdmTransact(id, mutator) {
    const ref = firebase.database().ref('stores/' + currentStoreId + '/preOrders/' + id);
    let errorMsg = null;
    const res = await ref.transaction(function (cur) {
        if (cur === null || cur === undefined) { errorMsg = "This pre-order no longer exists — it may have been deleted."; return cur; }
        try { return mutator(cur); } catch (e) { errorMsg = e.message; return; }
    });
    if (errorMsg) throw new Error(errorMsg);
    if (!res.committed) throw new Error("Could not save — please try again.");
    return res.snapshot.val();
}

async function wdmCreateDraft(branchId) {
    const root = firebase.database().ref('stores/' + currentStoreId);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const got = await wdmWithTimeout(Promise.all([
        root.child('inventory/' + branchId).once('value'),
        root.child('transactions').orderByChild('date').startAt(since).once('value'),
        root.child('supplies').orderByChild('date').limitToLast(500).once('value')
    ]), 20000);

    const sales = [], supplies = [];
    got[1].forEach(function (c) { const t = c.val(); if ((t.branchId || 'main') === branchId) sales.push(t); });
    got[2].forEach(function (c) { supplies.push(c.val()); });

    const items = wdmBuildDraftItems(got[0].val() || {}, sales, supplies);
    const record = { branchId: branchId, status: 'draft', items: items, createdBy: wdmActorName(), createdAt: new Date().toISOString() };
    const ref = firebase.database().ref('stores/' + currentStoreId + '/preOrders').push();
    await ref.set(record);
    return Object.assign({ id: ref.key }, record);
}

function wdmRemoveItem(id, index) { return wdmTransact(id, function (r) { return wdmRemoveItemPure(r, index); }); }
function wdmUpdateQty(id, index, qty) { return wdmTransact(id, function (r) { return wdmUpdateQtyPure(r, index, qty); }); }
function wdmAddNote(id, note) { return wdmTransact(id, function (r) { return Object.assign({}, r, { note: note }); }); }
function wdmSubmit(id) { return wdmTransact(id, function (r) { return wdmSubmitPure(r, wdmActorName()); }); }
function wdmReturnToManager(id, note) { return wdmTransact(id, function (r) { return wdmReturnPure(r, wdmActorName(), note); }); }
function wdmPlaceOrder(id) { return wdmTransact(id, function (r) { return wdmPlacePure(r, wdmActorName()); }); }
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

const WDM_STATUS_LABEL = { draft: ['#fffbeb', '#92400e', 'DRAFT'], submitted: ['#eff6ff', '#1d4ed8', 'SUBMITTED — waiting on Admin'], placed: ['#dcfce7', '#166534', 'PLACED'] };

async function wdmOpenPreOrders() {
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Manager') return;
    const branchId = currentUserRole === 'Admin' ? (currentInventoryBranchFilter && currentInventoryBranchFilter !== 'all' ? currentInventoryBranchFilter : currentBranch) : currentBranch;
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
            const total = (r.items || []).reduce(function (sum, i) { return sum + wdmRound(i.orderQty * i.costPrice); }, 0);
            return '<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px;">' +
                '<div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">' +
                '<span style="font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px; background:' + s[0] + '; color:' + s[1] + ';">' + s[2] + '</span>' +
                '<small style="color:#94a3b8;">' + wdmPretty(r.createdAt) + '</small></div>' +
                '<div style="font-size:12px; margin:6px 0; color:#334155;">' + (r.items || []).length + ' item' + ((r.items || []).length === 1 ? '' : 's') + (total ? ' · est. ' + wdmMoney(total) : '') + '<br>Started by ' + wdmEsc(r.createdBy || '') + (r.submittedBy ? ' · submitted by ' + wdmEsc(r.submittedBy) : '') + (r.placedBy ? ' · placed by ' + wdmEsc(r.placedBy) : '') + '</div>' +
                '<button data-id="' + wdmEsc(r.id) + '" onclick="wdmOpenDetail(this.dataset.id)" style="padding:6px 12px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc;">Open</button></div>';
        }).join('');
    wdmModal('🛒 Pre-Orders — ' + wdmBranchLabel(branchId), newBtn + rows);
}

async function wdmStartNewDraft(branchId) {
    wdmModal('🛒 Pre-Orders', '<div style="text-align:center; color:#64748b; padding:20px;">Working out what\'s low or running out...</div>');
    try {
        const record = await wdmCreateDraft(branchId);
        wdmOpenDetail(record.id, record);
    } catch (e) {
        wdmModal('🛒 Pre-Orders', '<div style="color:#b91c1c; padding:12px;">Could not create the draft: ' + wdmEsc(e.message) + '</div>');
    }
}

var wdmCurrentId = null;
var wdmCurrentRecord = null;

async function wdmOpenDetail(id, known) {
    wdmCurrentId = id;
    wdmModal('🛒 Pre-Order', '<div style="text-align:center; color:#64748b; padding:20px;">Loading...</div>');
    try {
        const record = known || (await wdmWithTimeout(firebase.database().ref('stores/' + currentStoreId + '/preOrders/' + id).once('value'), 12000)).val();
        if (!record) { wdmModal('🛒 Pre-Order', '<div style="color:#b91c1c; padding:12px;">This pre-order no longer exists.</div>'); return; }
        wdmCurrentRecord = Object.assign({ id: id }, record);
        wdmRenderDetail(wdmCurrentRecord);
    } catch (e) {
        wdmModal('🛒 Pre-Order', '<div style="color:#b91c1c; padding:12px;">Could not load: ' + wdmEsc(e.message) + '</div>');
    }
}

function wdmRenderDetail(r) {
    const s = WDM_STATUS_LABEL[r.status] || ['#f1f5f9', '#334155', r.status];
    const editable = wdmCanEdit(r, currentUserRole);
    const items = r.items || [];
    const total = items.reduce(function (sum, i) { return sum + wdmRound(i.orderQty * i.costPrice); }, 0);

    const rows = items.length === 0 ? '<div style="text-align:center; color:#64748b; padding:12px;">No items on this list.</div>' : items.map(function (it, idx) {
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
        actions = '<button onclick="wdmDoSubmit()" class="menu-btn btn-action-primary" style="justify-content:center; margin:0 0 8px 0;" ' + (items.length === 0 ? 'disabled' : '') + '>📤 Submit to Admin</button>' +
            (currentUserRole === 'Admin' ? '<button onclick="wdmDoDelete()" class="menu-btn btn-logout" style="justify-content:center; margin:0;">🗑 Delete Draft</button>' : '');
    } else if (r.status === 'submitted' && currentUserRole === 'Admin') {
        actions = '<button onclick="wdmDoPlace()" class="menu-btn btn-action-primary" style="justify-content:center; margin:0 0 8px 0; background:#16a34a;" ' + (items.length === 0 ? 'disabled' : '') + '>✅ Place Order</button>' +
            '<button onclick="wdmDoReturn()" class="menu-btn" style="justify-content:center; margin:0; background:#fffbeb; border:1px solid #fde68a; color:#92400e;">↩ Send Back to Manager</button>';
    } else if (r.status === 'placed') {
        const groups = wdmGroupBySupplier(items);
        actions = groups.map(function (g, gi) {
            const supHas = typeof suppliersCache !== 'undefined' && g.supplierId && suppliersCache[g.supplierId];
            const phone = supHas ? suppliersCache[g.supplierId].phone : '';
            return '<button data-gi="' + gi + '" onclick="wdmWhatsappGroup(this.dataset.gi)" style="display:block; width:100%; box-sizing:border-box; margin-bottom:6px; padding:8px; font-size:12px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #86efac; background:#dcfce7; color:#166534;">📲 Order from ' + wdmEsc(g.supplierName) + '</button>';
        }).join('');
        wdmCurrentGroups = groups;
    }

    const noteBox = r.note || r.reviewNote ? '<div style="font-size:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px; margin-bottom:10px;">' + (r.reviewNote ? '<strong>Admin\'s note:</strong> ' + wdmEsc(r.reviewNote) : wdmEsc(r.note || '')) + '</div>' : '';

    wdmModal('🛒 Pre-Order', '<div style="margin-bottom:8px;"><span style="font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px; background:' + s[0] + '; color:' + s[1] + ';">' + s[2] + '</span> <small style="color:#94a3b8;">started by ' + wdmEsc(r.createdBy || '') + ' · ' + wdmPretty(r.createdAt) + '</small></div>' +
        noteBox + rows +
        '<div style="text-align:right; font-weight:bold; padding:8px 0;">Estimated total: ' + wdmMoney(total) + '</div>' +
        '<div style="border-top:1px solid #e2e8f0; padding-top:10px;">' + actions + '</div>');
}

function wdmOnQtyChange(input) {
    const idx = parseInt(input.dataset.idx);
    const qty = parseFloat(input.value);
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
function wdmDoDelete() {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    wdmDeleteDraft(wdmCurrentId).then(function () { wdmOpenPreOrders(); }).catch(function (e) { alert(e.message); });
}
var wdmCurrentGroups = [];
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
}
setInterval(function () { try { wdmAttach(); } catch (e) { console.warn(e); } }, 1200);

// Managers can make sales and manage inventory for their branch, plus use Pre-Orders (a modal,
// not routed through here). Everything else (Staff, Branches, Reports, Suppliers, Business
// Settings, etc.) stays off-limits even if something bypasses the sidebar.
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
