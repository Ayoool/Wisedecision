// ==================== WISE DECISION STORE ORDERS PATCH (v2) ====================
// Load AFTER script.js, bugfix-patch.js, payments-patch.js and customer-order-patch.js (defer).
//
// Adds a "📦 Customer Orders" button to the store sidebar (any signed-in store user, not the Super Admin).
//   * Type a tracking ID (e.g. WD-4K7P2X) or pick from the pending list.
//   * Shows the customer and goods with YOUR prices from inventory (this branch).
//   * "Take payment" turns the order into a normal pending sale (stores/{id}/pendingOrders/WD-xxxxxx) and opens
//     the normal split-payment screen. Accepting it deducts stock, records the sale and prints the normal receipt.
//   * Print slip uses the same thermal printer function as your receipts.
//
// Each item is charged in the unit the customer chose: Piece (sachet, capsule...) or Pack (carton, box...); Kg/g for items sold by weight.
// Customers whose phone number matches a SAVED customer (Customers list) get WHOLESALE prices; everyone else pays retail.

console.log("Wise Decision store-orders-patch.js v4 loaded");

var wdso = { orders: {}, inv: null, invSid: '', invBranch: '', invAt: 0, loading: false, recon: {}, current: null, busy: false };

function wdsoEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdsoTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
        p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
}
function wdsoWhen(iso) { var d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
function wdsoWa(phone) {
    var p = String(phone || '').replace(/[^\d+]/g, '');
    if (p.charAt(0) === '+') p = p.slice(1);
    else if (p.indexOf('00') === 0) p = p.slice(2);
    else if (p.charAt(0) === '0') p = '234' + p.slice(1);
    return p;
}
function wdsoMoney(n) { return '₦' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(); }
function wdsoRound2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function wdsoNorm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function wdsoChip(st) {
    var m = { pending: ['#fef3c7', '#92400e', 'PENDING'], processing: ['#dbeafe', '#1e40af', 'AWAITING PAYMENT'], completed: ['#dcfce7', '#166534', 'COMPLETED'], cancelled: ['#fee2e2', '#991b1b', 'CANCELLED'] }[st] || ['#e2e8f0', '#334155', String(st || '').toUpperCase()];
    return '<span style="background:' + m[0] + '; color:' + m[1] + '; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">' + m[2] + '</span>';
}
function wdsoSid() { try { return currentStoreId; } catch (e) { return ''; } }
function wdsoBranch() { try { return currentBranch || 'main'; } catch (e) { return 'main'; } }
function wdsoRole() { try { return currentUserRole; } catch (e) { return ''; } }
function wdsoStoreUser() {
    try { return !!(currentStoreId && currentStoreId !== 'SUPER_ADMIN' && currentUserRole && currentUserRole !== 'SuperAdmin'); } catch (e) { return false; }
}
function wdsoCanTakePayment() { var r = wdsoRole(); return r === 'Admin' || r === 'Accountant' || r === 'Cashier'; }

function wdsoModal(title, html) {
    var m = document.getElementById('wdso-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdso-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1550; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:520px; max-height:94vh; overflow-y:auto; padding:18px; box-sizing:border-box;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">' +
        '<h3 style="margin:0; font-size:17px;">' + wdsoEsc(title) + '</h3>' +
        '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdsoClose()">✕</button></div>' + html + '</div>';
    m.style.display = 'flex';
}
function wdsoClose() { wdso.current = null; var m = document.getElementById('wdso-modal'); if (m) m.style.display = 'none'; }

// ---------- Inventory (this branch): your prices and stock ----------
async function wdsoInventory(force) {
    var sid = wdsoSid(), br = wdsoBranch();
    if (!force && wdso.inv && !wdso.inv.failed && wdso.invSid === sid && wdso.invBranch === br && Date.now() - wdso.invAt < 120000) return wdso.inv;
    var snap = await wdsoTimeout(firebase.database().ref('stores/' + sid + '/inventory/' + br).once('value'), 20000);
    var byId = {}, byName = {};
    snap.forEach(function (pc) {
        var p = pc.val();
        if (!p || typeof p !== 'object') return;
        byId[pc.key] = p;
        var nm = wdsoNorm(p.name || p.productName);
        if (nm && !byName[nm]) byName[nm] = pc.key;
    });
    wdso.inv = { byId: byId, byName: byName };
    wdso.invSid = sid; wdso.invBranch = br; wdso.invAt = Date.now();
    return wdso.inv;
}
function wdsoInvReady() { return wdso.inv && wdso.invSid === wdsoSid() && wdso.invBranch === wdsoBranch() ? wdso.inv : null; }
function wdsoUnitPrice(item, tier, pack) {
    var wh = tier === 'Wholesale';
    var rp = Number(item.price != null ? item.price : item.retailPrice) || 0, wp = Number(item.wholesalePrice) || 0;
    if (item.soldByWeight) return wh && wp > 0 ? wp : rp;
    if (pack) return wh ? (wp > 0 ? wp : rp) : rp;      // price per whole pack
    if (typeof getPiecePrice === 'function') return Number(getPiecePrice(item, wh ? 'Wholesale' : 'Retail')) || 0;
    return wh && wp > 0 ? wp : rp;
}
function wdsoLabel(prod, pack, qty) {
    if (!prod) return '';
    if (prod.soldByWeight) return String(prod.weightUnit || 'Kg').toLowerCase();
    var base = (prod.baseUnitName && String(prod.baseUnitName).trim()) || 'Piece';
    var bulk = (prod.bulkUnitName && String(prod.bulkUnitName).trim()) || 'Pack';
    var n = pack ? bulk : base;
    return typeof pluralizeUnit === 'function' ? pluralizeUnit(n, qty) : (Number(qty) === 1 ? n : n + 's');
}
// Saved customer = same phone number as someone in the Customers list (last 10 digits).
function wdsoPhoneKey(p) { var d = String(p || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function wdsoFindCustomer(phone) {
    var k = wdsoPhoneKey(phone);
    if (k.length < 7) return null;
    var cc;
    try { cc = customersCache; } catch (e) { return null; }
    var ids = Object.keys(cc || {});
    for (var i = 0; i < ids.length; i++) { if (wdsoPhoneKey(cc[ids[i]].phone) === k) return { id: ids[i], c: cc[ids[i]] }; }
    return null;
}
function wdsoTier(o) { var c = wdsoFindCustomer(o && o.phone); return { tier: c ? 'Wholesale' : 'Retail', customer: c }; }
function wdsoStockOf(item) { return Number(item.stock !== undefined ? item.stock : item.stockQty) || 0; }

// Work out each line of a customer order against this branch's inventory.
function wdsoBuild(o, inv, tier) {
    var items = o.items || {}, lines = [], total = 0, missing = [], short = [];
    Object.keys(items).forEach(function (k) {
        var it = items[k], qty = Number(it.qty) || 0;
        var id = inv.byId[k] ? k : inv.byName[wdsoNorm(it.name)];
        var prod = id ? inv.byId[id] : null;
        var line = { key: k, name: it.name, qty: qty, id: id || null, item: prod, pack: false, pieces: qty, label: '', unitPrice: 0, total: 0, stock: 0 };
        if (!prod) { missing.push(it.name); }
        else {
            var upp = prod.soldByWeight ? 1 : (Number(prod.unitsPerPack) || 1);
            line.pack = String(it.unit) === 'Pack' && upp > 1;
            line.pieces = wdsoRound2(line.pack ? qty * upp : qty);
            line.label = wdsoLabel(prod, line.pack, qty);
            line.unitPrice = wdsoUnitPrice(prod, tier, line.pack);
            line.total = wdsoRound2(line.unitPrice * qty);
            line.stock = wdsoStockOf(prod);
            total += line.total;
            if (line.unitPrice <= 0) missing.push(it.name + ' (no price set)');
            if (line.pieces > line.stock + 1e-9) short.push(it.name + ' (need ' + line.pieces + ' pcs, have ' + line.stock + ')');
        }
        lines.push(line);
    });
    return { lines: lines, total: wdsoRound2(total), missing: missing, short: short };
}

// ---------- Main screen: find by ID + open orders ----------
function wdsoOpen() {
    wdso.current = null;
    wdsoModal('📦 Customer Orders',
        '<label style="font-size:12px; font-weight:bold;">Tracking ID</label>' +
        '<div style="display:flex; gap:6px; margin:4px 0 12px;"><input id="wdso-tid" type="text" placeholder="e.g. WD-4K7P2X" autocapitalize="characters" autocomplete="off" style="flex:1; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:15px; box-sizing:border-box; text-transform:uppercase;">' +
        '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:10px 16px;" onclick="wdsoFind()">Find</button></div>' +
        '<div style="font-weight:bold; font-size:13px; margin-bottom:6px;">Open orders</div><div id="wdso-list"><div style="color:#64748b; font-size:12px; padding:10px 0;">Loading...</div></div>');
    var el = document.getElementById('wdso-tid');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') wdsoFind(); });
    wdsoLoadList();
}

async function wdsoReconcile(tid) {
    var o = wdso.orders[tid];
    if (!o || o.status !== 'processing' || !o.txId) return;
    var sid = wdsoSid(), db = firebase.database(), path = 'customerOrders/' + sid + '/' + tid;
    try {
        var r = await wdsoTimeout(Promise.all([
            db.ref('stores/' + sid + '/transactions/' + o.txId + '/txId').once('value'),
            db.ref('stores/' + sid + '/pendingOrders/' + o.txId + '/txId').once('value')
        ]), 10000);
        if (r[0].exists()) {
            var u = { status: 'completed', completedAt: new Date().toISOString() };
            await db.ref(path).update(u);
            wdso.orders[tid] = Object.assign({}, o, u);
        } else if (!r[1].exists()) {
            await db.ref(path).update({ status: 'pending', txId: null });   // the queued sale was cancelled
            wdso.orders[tid] = Object.assign({}, o, { status: 'pending', txId: null });
        }
    } catch (e) { /* try again next time */ }
}

async function wdsoLoadList() {
    var sid = wdsoSid(), box = function () { return document.getElementById('wdso-list'); };
    try {
        var snap = await wdsoTimeout(firebase.database().ref('customerOrders/' + sid).once('value'), 15000);
        wdso.orders = snap.val() || {};
        var procIds = Object.keys(wdso.orders).filter(function (k) { return wdso.orders[k].status === 'processing'; }).slice(0, 10);
        if (procIds.length) await Promise.all(procIds.map(wdsoReconcile));
        var rows = Object.keys(wdso.orders).map(function (k) { return Object.assign({ tid: k }, wdso.orders[k]); })
            .filter(function (o) { return o.status === 'pending' || o.status === 'processing'; })
            .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 30);
        if (!box()) return;
        box().innerHTML = rows.length === 0 ? '<div style="color:#166534; font-size:13px; padding:10px 0;">✅ No open customer orders.</div>' :
            rows.map(function (o) {
                var n = Object.keys(o.items || {}).length;
                return '<div data-t="' + wdsoEsc(o.tid) + '" onclick="wdsoShow(this.dataset.t)" style="border:1px solid #e2e8f0; border-radius:8px; padding:9px 10px; margin-bottom:6px; cursor:pointer;">' +
                    '<div style="display:flex; justify-content:space-between; gap:8px; align-items:center;"><strong>' + wdsoEsc(o.tid) + '</strong>' + wdsoChip(o.status) + '</div>' +
                    '<div style="font-size:12px; color:#475569;">' + wdsoEsc(o.name) + ' · ' + n + ' item' + (n === 1 ? '' : 's') + ' · ' + wdsoWhen(o.createdAt) + '</div></div>';
            }).join('');
    } catch (e) {
        if (box()) box().innerHTML = '<div style="color:#b91c1c; font-size:12px;">Could not load orders: ' + wdsoEsc((e && (e.code || e.message)) || 'error') + '</div>';
    }
}

async function wdsoFind() {
    var raw = String((document.getElementById('wdso-tid') || {}).value || '').toUpperCase().replace(/\s+/g, '');
    if (!raw) { alert('Type the tracking ID.'); return; }
    var tid = raw.indexOf('WD-') === 0 ? raw : 'WD-' + raw.replace(/^WD/, '').replace(/^-/, '');
    if (/[.#$\[\]\/]/.test(tid)) { alert('That tracking ID does not look right.'); return; }
    try {
        var rec = (await wdsoTimeout(firebase.database().ref('customerOrders/' + wdsoSid() + '/' + tid).once('value'), 12000)).val();
        if (!rec) { alert('No order found with ID ' + tid + ' in this store.'); return; }
        wdso.orders[tid] = rec;
        wdso.recon[tid] = false;
        wdsoShow(tid);
    } catch (e) { alert('Could not look it up: ' + ((e && (e.code || e.message)) || 'error')); }
}

// ---------- One order ----------
function wdsoShow(tid) {
    var o = wdso.orders[tid];
    if (!o) { wdsoOpen(); return; }
    wdso.current = tid;
    var inv = wdsoInvReady();
    if (!inv && !wdso.loading) {
        wdso.loading = true;
        wdsoInventory().then(function () { wdso.loading = false; if (wdso.current === tid) wdsoShow(tid); })
            .catch(function () { wdso.loading = false; wdso.inv = { byId: {}, byName: {}, failed: true }; wdso.invSid = wdsoSid(); wdso.invBranch = wdsoBranch(); wdso.invAt = Date.now(); if (wdso.current === tid) wdsoShow(tid); });
    }
    if (o.status === 'processing' && !wdso.recon[tid]) {
        wdso.recon[tid] = true;
        wdsoReconcile(tid).then(function () { if (wdso.current === tid && wdso.orders[tid] && wdso.orders[tid].status !== 'processing') wdsoShow(tid); });
    }

    var failed = !!(inv && inv.failed);
    var ti = wdsoTier(o);
    var b = inv && !failed ? wdsoBuild(o, inv, ti.tier) : null;
    var rows = '';
    if (b) {
        rows = b.lines.map(function (l) {
            return '<div style="display:flex; justify-content:space-between; gap:8px; font-size:13px; padding:6px 0; border-bottom:1px dashed #e2e8f0;">' +
                '<span style="flex:1;">' + wdsoEsc(l.name) + '<br><small style="color:' + (l.item ? '#64748b' : '#b91c1c') + ';">' +
                (l.item ? (l.unitPrice > 0 ? wdsoMoney(l.unitPrice) + ' / ' + wdsoEsc(wdsoLabel(l.item, l.pack, 1)) : 'no price set') + ' · stock ' + l.stock + ' pcs' : 'not found in this branch') + '</small></span>' +
                '<strong style="white-space:nowrap;">× ' + wdsoEsc(l.qty) + ' ' + wdsoEsc(l.label) + '</strong>' +
                '<span style="min-width:78px; text-align:right; white-space:nowrap;">' + (l.item ? wdsoMoney(l.total) : '—') + '</span></div>';
        }).join('');
    } else {
        var items = o.items || {};
        rows = Object.keys(items).map(function (k) {
            return '<div style="display:flex; justify-content:space-between; gap:8px; font-size:13px; padding:6px 0; border-bottom:1px dashed #e2e8f0;"><span>' + wdsoEsc(items[k].name) + '</span><strong>× ' + wdsoEsc(items[k].qty) + '</strong></div>';
        }).join('') + '<div style="font-size:12px; color:' + (failed ? '#b91c1c' : '#64748b') + '; padding:8px 0;">' + (failed ? 'Could not load your prices. Check your internet and reopen this order.' : 'Loading prices...') + '</div>';
    }
    var warn = '';
    if (b && b.missing.length) warn += '<div style="font-size:12px; color:#b91c1c; margin-top:6px;">Not found or no price: ' + b.missing.map(wdsoEsc).join(', ') + '. Fix these in Inventory (or refresh the product list) before taking payment.</div>';
    if (b && b.short.length) warn += '<div style="font-size:12px; color:#b45309; margin-top:6px;">Not enough stock: ' + b.short.map(wdsoEsc).join(', ') + '.</div>';
    var totalRow = b ? '<div style="display:flex; justify-content:space-between; font-size:16px; font-weight:bold; padding:10px 0 2px;"><span>Total</span><span>' + wdsoMoney(b.total) + '</span></div>' + warn : '';

    var wa = wdsoWa(o.phone), t = wdsoEsc(tid), st = o.status;
    var tierBadge = ti.customer ? '<div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; padding:6px 10px; border-radius:6px; font-size:12px; margin-bottom:8px;">✔ Saved customer: <strong>' + wdsoEsc(ti.customer.c.name) + '</strong> — wholesale prices applied</div>' : '<div style="background:#f8fafc; border:1px solid #e2e8f0; color:#475569; padding:6px 10px; border-radius:6px; font-size:12px; margin-bottom:8px;">New customer — retail prices</div>';
    var payLabel = wdsoCanTakePayment() ? '💳 Take payment' : '➡ Send to accountant';
    var actions = '<button data-t="' + t + '" onclick="wdsoPrint(this.dataset.t)" class="menu-btn" style="margin:0; flex:1; justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;">🖨 Print slip</button>';
    if (st === 'pending') actions += '<button data-t="' + t + '" onclick="wdsoProcess(this.dataset.t)" class="menu-btn btn-action-primary" style="margin:0; flex:1; justify-content:center; background:#16a34a;">' + payLabel + '</button>';
    if (st === 'processing' && wdsoCanTakePayment()) actions += '<button data-t="' + t + '" onclick="wdsoResume(this.dataset.t)" class="menu-btn btn-action-primary" style="margin:0; flex:1; justify-content:center; background:#16a34a;">💳 Take payment</button>';

    var note = st === 'processing' ? '<div style="background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; padding:8px; border-radius:6px; font-size:12px; margin:10px 0;">In the Accountant queue as receipt <strong>' + wdsoEsc(o.txId || '') + '</strong>. Once paid, the receipt prints and this order shows Completed.</div>' :
        (st === 'completed' ? '<div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; padding:8px; border-radius:6px; font-size:12px; margin:10px 0;">Paid' + (o.txId ? ' · receipt ' + wdsoEsc(o.txId) : '') + '. Find the receipt in Accountant → Completed Sales.</div>' :
        '<div style="background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:8px; border-radius:6px; font-size:12px; margin:10px 0;">Each item is charged in the unit the customer chose (piece or pack; Kg for items sold by weight). Taking payment adds this to your normal sales queue at the prices shown.</div>');

    wdsoModal('Order ' + tid,
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' + wdsoChip(st) + '<span style="font-size:11px; color:#64748b;">' + wdsoWhen(o.createdAt) + '</span></div>' +
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:10px; font-size:13px;">' +
        '<div><strong>' + wdsoEsc(o.name) + '</strong></div>' +
        '<div style="margin-top:4px;"><a href="tel:' + wdsoEsc(o.phone) + '" style="color:#0369a1; font-weight:bold;">📞 ' + wdsoEsc(o.phone) + '</a>' +
        (wa ? ' &nbsp; <a href="https://wa.me/' + wdsoEsc(wa) + '" target="_blank" rel="noopener" style="color:#166534; font-weight:bold;">💬 WhatsApp</a>' : '') + '</div></div>' +
        tierBadge + '<div style="font-weight:bold; font-size:13px; margin-bottom:4px;">Goods ordered</div>' + rows + totalRow + note +
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' + actions + '</div>' +
        (st === 'pending' ? '<button data-t="' + t + '" onclick="wdsoCancel(this.dataset.t)" class="menu-btn" style="margin:8px 0 0; width:100%; justify-content:center; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;">✖ Cancel this order</button>' : '') +
        '<button class="menu-btn" style="margin:8px 0 0; width:100%; justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdsoOpen()">← Back to list</button>');
}

async function wdsoCancel(tid) {
    var o = wdso.orders[tid];
    if (!o || o.status !== 'pending') { alert('This order is no longer pending.'); wdsoOpen(); return; }
    if (!confirm('Cancel this order?\n\n' + tid + ' — ' + o.name)) return;
    try {
        var sref = firebase.database().ref('customerOrders/' + wdsoSid() + '/' + tid + '/status');
        var tx = await sref.transaction(function (cur) { return cur === 'pending' ? 'cancelled' : (cur === null ? cur : undefined); });
        if (!tx.committed) { alert('This order was already handled by someone else.'); wdsoOpen(); return; }
        var upd = { decidedAt: new Date().toISOString(), decidedBy: String(wdsoRole()) };
        await firebase.database().ref('customerOrders/' + wdsoSid() + '/' + tid).update(upd);
        wdso.orders[tid] = Object.assign({}, o, upd, { status: 'cancelled' });
        wdsoShow(tid);
    } catch (e) { alert('Failed: ' + ((e && (e.code || e.message)) || 'error')); }
}

// ---------- Turn the order into a normal pending sale ----------
async function wdsoProcess(tid) {
    if (wdso.busy) return;
    var o = wdso.orders[tid];
    if (!o || o.status !== 'pending') { alert('This order is no longer pending.'); wdsoOpen(); return; }
    if (typeof generateNextTransactionId !== 'function') { alert('The sales system is not ready. Please reload the app and try again.'); return; }
    wdso.busy = true;
    var sid = wdsoSid(), db = firebase.database(), sref = db.ref('customerOrders/' + sid + '/' + tid + '/status'), claimed = false;
    try {
        var inv = await wdsoInventory(true);
        var ti = wdsoTier(o);
        var b = wdsoBuild(o, inv, ti.tier);
        if (b.missing.length) { alert('Cannot continue. Not found in this branch, or no price set:\n\n' + b.missing.join('\n') + '\n\nFix these in Inventory first.'); wdsoShow(tid); return; }
        if (b.short.length) { alert('Not enough stock for:\n\n' + b.short.join('\n') + '\n\nTell the customer, or restock first.'); wdsoShow(tid); return; }
        if (!(b.total > 0)) { alert('The order total is zero. Check the prices in Inventory.'); return; }

        var tx = await sref.transaction(function (cur) { return cur === 'pending' ? 'processing' : (cur === null ? cur : undefined); });
        if (!tx.committed || tx.snapshot.val() !== 'processing') { alert('Someone else is already processing this order.'); wdsoOpen(); return; }
        claimed = true;

        var txId = await generateNextTransactionId();
        var label = '';
        try { label = (document.getElementById('user-role-label') || {}).textContent || wdsoRole(); } catch (e) { label = wdsoRole(); }
        var cart = b.lines.map(function (l) {
            var weight = !!l.item.soldByWeight;
            return {
                id: l.id,
                name: l.item.name || l.item.productName || l.name,
                qty: l.qty,
                saleUnit: weight ? (l.item.weightUnit || 'Kg') : (l.pack ? 'Pack' : 'Piece'),
                unitsPerPack: weight ? 1 : (Number(l.item.unitsPerPack) || 1),
                piecesNeeded: wdsoRound2(l.pieces),
                price: l.unitPrice,
                total: l.total,
                customerType: ti.tier,
                baseUnitName: l.item.baseUnitName || '',
                bulkUnitName: l.item.bulkUnitName || ''
            };
        });
        var pending = {
            txId: txId, items: cart, totalAmount: b.total, staff: label, soldBy: label, date: new Date().toISOString(),
            status: 'Pending Verification', branchId: wdsoBranch(), customerId: ti.customer ? ti.customer.id : null,
            customerName: (ti.customer ? ti.customer.c.name : o.name) + ' (' + tid + ')', customerPhone: o.phone, source: 'customer-order', customerOrderId: tid
        };
        await db.ref('stores/' + sid + '/pendingOrders/' + txId).set(pending);
        await db.ref('customerOrders/' + sid + '/' + tid).update({ txId: txId, processedAt: new Date().toISOString(), processedBy: label });
        claimed = false;
        wdso.orders[tid] = Object.assign({}, o, { status: 'processing', txId: txId });
        wdso.recon[tid] = false;

        wdsoClose();
        if (wdsoCanTakePayment() && typeof openSplitModal === 'function') openSplitModal(txId, b.total);
        else alert('Sent to the Accountant queue. Receipt ID: ' + txId);
    } catch (e) {
        if (claimed) { try { await sref.set('pending'); } catch (_) {} }
        alert('Could not process this order: ' + ((e && (e.code || e.message)) || 'error'));
    } finally { wdso.busy = false; }
}

async function wdsoResume(tid) {
    var o = wdso.orders[tid];
    if (!o || !o.txId) { alert('This order has no receipt in the queue yet.'); return; }
    try {
        var snap = await firebase.database().ref('stores/' + wdsoSid() + '/pendingOrders/' + o.txId).once('value');
        if (!snap.exists()) { wdso.recon[tid] = false; await wdsoReconcile(tid); wdsoShow(tid); return; }
        wdsoClose();
        if (typeof openSplitModal === 'function') openSplitModal(o.txId, Number(snap.val().totalAmount) || 0);
    } catch (e) { alert('Failed: ' + ((e && (e.code || e.message)) || 'error')); }
}

// ---------- Print an order slip with the same thermal printer function as your receipts ----------
async function wdsoPrint(tid) {
    var o = wdso.orders[tid];
    if (!o) return;
    if (typeof triggerThermalPrint !== 'function') { alert('The receipt printer is not ready. Please reload the app and try again.'); return; }
    var sid = wdsoSid(), store = '', addr = '', phone = '';
    try {
        var db = firebase.database();
        var r = await wdsoTimeout(Promise.all([db.ref('stores/' + sid + '/businessName').once('value'), db.ref('stores/' + sid + '/address').once('value'), db.ref('stores/' + sid + '/phone').once('value')]), 6000);
        store = r[0].val() || ''; addr = r[1].val() || ''; phone = r[2].val() || '';
    } catch (e) { /* print with what we have */ }
    var inv = null;
    try { inv = await wdsoInventory(); } catch (e) { inv = null; }
    var b = inv ? wdsoBuild(o, inv, wdsoTier(o).tier) : null;
    var rows = '', total = 0;
    if (b) {
        rows = b.lines.map(function (l) { total += l.total; return '<tr><td style="font-weight:bold;">' + wdsoEsc(l.name) + '</td><td>' + wdsoEsc(l.qty) + ' ' + wdsoEsc(l.label) + '</td><td>' + (l.item ? wdsoMoney(l.total) : '-') + '</td></tr>'; }).join('');
    } else {
        var items = o.items || {};
        rows = Object.keys(items).map(function (k) { return '<tr><td style="font-weight:bold;">' + wdsoEsc(items[k].name) + '</td><td>' + wdsoEsc(items[k].qty) + '</td><td>-</td></tr>'; }).join('');
    }
    var html = '<div style="text-align:center; margin-bottom:8px;"><h3 style="margin:0; font-size:16px;">' + wdsoEsc(store) + '</h3>' +
        (addr ? '<div style="font-size:10px; margin-top:3px;">' + wdsoEsc(addr) + '</div>' : '') +
        (phone ? '<div style="font-size:10px;">Tel: ' + wdsoEsc(phone) + '</div>' : '') + '</div>' +
        '<hr style="border:dashed 1px #ccc;"><div style="text-align:center; font-weight:bold; font-size:12px; margin:6px 0;">CUSTOMER ORDER</div>' +
        '<div style="font-size:11px; margin-bottom:10px;"><div><strong>TrackID:</strong> ' + wdsoEsc(tid) + '</div>' +
        '<div><strong>Date:</strong> ' + wdsoEsc(wdsoWhen(o.createdAt)) + '</div>' +
        '<div><strong>Customer:</strong> ' + wdsoEsc(o.name) + '</div><div><strong>Phone:</strong> ' + wdsoEsc(o.phone) + '</div></div>' +
        '<table><thead><tr style="border-bottom:1px solid #000;"><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<hr style="border:dashed 1px #ccc;">' +
        (b ? '<div style="font-size:13px; font-weight:bold; display:flex; justify-content:space-between;"><span>TOTAL:</span><span>' + wdsoMoney(total) + '</span></div>' : '') +
        '<div style="text-align:center; font-size:11px; margin-top:8px;">Pay at the counter. Thank you!</div>';
    triggerThermalPrint(html);
}

// ---------- Sidebar button (insert-only, idempotent) ----------
function wdsoShown(el) { return !!(el && el.getClientRects().length > 0); }
function wdsoFindShownButton(root, test) {
    var btns = root.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
        if (test((btns[i].textContent || '').trim().toLowerCase()) && wdsoShown(btns[i])) return btns[i];
    }
    return null;
}
function wdsoAttachSidebar() {
    var wrap = document.getElementById('dashboard-main-wrapper');
    var old = document.querySelectorAll('#wdso-sidebar-btn');
    if (!wrap || !wdsoStoreUser()) { old.forEach(function (b) { b.remove(); }); return; }
    var logout = wdsoFindShownButton(wrap, function (t) { return /logout$/.test(t); });
    if (!logout) return;
    var subs = document.getElementById('wdp-sidebar-btn');
    var anchor = subs && subs.parentNode === logout.parentNode ? subs : logout;
    if (old.length === 1 && anchor.previousElementSibling === old[0]) return;
    old.forEach(function (b) { b.remove(); });
    var b = document.createElement('button');
    b.id = 'wdso-sidebar-btn';
    b.className = 'menu-btn btn-subscription';
    b.textContent = '📦 Customer Orders';
    b.onclick = wdsoOpen;
    anchor.parentNode.insertBefore(b, anchor);
}

function wdsoAttach() { try { wdsoAttachSidebar(); } catch (e) { console.warn(e); } }
window.addEventListener('load', function () { setTimeout(wdsoAttach, 400); });
(function () {
    var obs = new MutationObserver(wdsoAttach);
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function () { obs.observe(document.body, { childList: true, subtree: true }); });
})();
setInterval(wdsoAttach, 3000);
