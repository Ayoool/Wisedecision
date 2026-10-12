// ==================== WISE DECISION LAYAWAY / INSTALLMENTS PATCH (v1) ====================
// Load AFTER fashion-patch.js
//
// Adds layaway (installment) plans to the Fashion module:
//   • Reserve items with a deposit
//   • Pay in installments over a target date
//   • Track overdue/upcoming payments
//   • Convert to a sale when fully paid
//
// Data lives here:
//   fashionLayaways/{storeId}/{layawayId} = {
//     id, customerName, customerPhone, items[], total, deposit, amountPaid,
//     payments{}, targetDate, status: 'active'|'completed'|'cancelled'|'forfeited',
//     createdAt, createdBy, completedAt, saleId
//   }
//   fashionCounters/{storeId}/lastLayawayNumber

console.log("Wise Decision layaway-patch.js — v1 loaded");

// ---------- helpers (reuse from fashion-patch.js) ----------
function wdlNum(n) { return Number(n) || 0; }
function wdlR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function wdlMoney(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + (Number(n) || 0).toLocaleString()); }
function wdlNow() { return new Date().toISOString(); }
function wdlPad(n) { return String(n).padStart(2, '0'); }
function wdlToday() { var d = new Date(); return d.getFullYear() + '-' + wdlPad(d.getMonth() + 1) + '-' + wdlPad(d.getDate()); }
function wdlPlusDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + wdlPad(d.getMonth() + 1) + '-' + wdlPad(d.getDate()); }
function wdlPretty(s) { var d = new Date(s); if (isNaN(d)) return '—'; return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
function wdlEl(id) { return document.getElementById(id); }
function wdlVal(id) { var e = wdlEl(id); return e ? String(e.value || '').trim() : ''; }
function wdlUser() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
function wdlCanManage() { return typeof wdfIsAdmin === 'function' ? (wdfIsAdmin() || wdfIsManager()) : true; }
function wdlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// ---------- state ----------
var wdlLayaways = {}, wdlDataOn = false, wdlRef = null;

function wdlStartData() {
    if (wdlDataOn) return;
    wdlDataOn = true;
    wdlRef = firebase.database().ref('fashionLayaways/' + currentStoreId);
    wdlRef.on('value', function (s) { wdlLayaways = s.val() || {}; wdlRefreshBadge(); }, function () {});
}
function wdlStopData() {
    if (wdlRef) { try { wdlRef.off(); } catch (e) {} }
    wdlRef = null; wdlDataOn = false; wdlLayaways = {};
}
function wdlList() { return Object.keys(wdlLayaways).map(function (k) { return Object.assign({ _id: k }, wdlLayaways[k]); }); }

// ---------- layaway maths ----------
function wdlBalance(l) { return Math.max(0, wdlR2(wdlNum(l.total) - wdlNum(l.amountPaid))); }
function wdlPayments(l) {
    if (!l.payments) return [];
    return Object.keys(l.payments).map(function (k) { return l.payments[k]; })
        .sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); });
}
function wdlIsOverdue(l) {
    if (l.status !== 'active') return false;
    if (!l.targetDate) return false;
    return wdlBalance(l) > 0 && l.targetDate < wdlToday();
}
function wdlDaysLeft(l) {
    if (!l.targetDate) return null;
    var a = new Date(wdlToday() + 'T00:00:00'), b = new Date(l.targetDate + 'T00:00:00');
    return Math.round((b - a) / 86400000);
}

// ---------- refresh badge ----------
function wdlRefreshBadge() {
    var b = wdlEl('wdl-layaway-badge');
    if (!b) return;
    var active = wdlList().filter(function (l) { return l.status === 'active'; });
    var overdue = active.filter(wdlIsOverdue).length;
    b.textContent = active.length > 0 ? String(active.length) : '';
    b.style.display = active.length > 0 ? 'inline-block' : 'none';
    b.style.background = overdue > 0 ? '#dc2626' : '#f59e0b';
}

// ---------- dashboard ----------
window.wdlOpenDashboard = function () {
    if (!wdlCanManage()) { alert('Only Admin/Manager can view layaway plans.'); return; }
    var all = wdlList();
    var active = all.filter(function (l) { return l.status === 'active'; });
    var overdue = active.filter(wdlIsOverdue);
    var totalOwed = active.reduce(function (t, l) { return t + wdlBalance(l); }, 0);

    var body = all.length ? all.sort(function (a, b) {
        var sa = a.status === 'active' ? 0 : 1, sb = b.status === 'active' ? 0 : 1;
        return (sa - sb) || String(a.targetDate || '9999').localeCompare(String(b.targetDate || '9999'));
    }).map(function (l) {
        var bal = wdlBalance(l), left = wdlDaysLeft(l), od = wdlIsOverdue(l);
        var statusColor = l.status === 'completed' ? '#166534' : l.status === 'active' ? (od ? '#991b1b' : '#1d4ed8') : '#64748b';
        var dueTxt = l.status !== 'active' ? '' :
            (od ? '<span style="color:#991b1b; font-weight:bold;">' + Math.abs(left) + ' days overdue</span>' :
             left === 0 ? '<span style="color:#92400e; font-weight:bold;">Due today</span>' :
             left < 0 ? '' :
             'Due in ' + left + ' days');
        return '<div style="border:1px solid ' + (od ? '#fecaca' : '#e2e8f0') + '; border-radius:10px; padding:12px; margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">' +
                '<div style="flex:1; min-width:160px;">' +
                    '<div style="font-weight:bold; font-size:13px; color:' + statusColor + ';">' + wdlEsc(l.id) + ' · ' + wdlEsc(l.status.toUpperCase()) + '</div>' +
                    '<div style="font-size:12px; margin-top:3px;">👤 ' + wdlEsc(l.customerName) + ' · ' + wdlEsc(l.customerPhone) + '</div>' +
                    '<div style="font-size:11px; color:#64748b; margin-top:3px;">' + (l.items || []).length + ' item(s) · Started ' + wdlPretty(l.createdAt) + '</div>' +
                '</div>' +
                '<div style="text-align:right;">' +
                    '<div style="font-size:15px; font-weight:bold; color:#b91c1c;">' + wdlMoney(bal) + '</div>' +
                    '<div style="font-size:11px; color:#64748b;">of ' + wdlMoney(l.total) + '</div>' +
                    (dueTxt ? '<div style="font-size:11px; margin-top:3px;">' + dueTxt + '</div>' : '') +
                '</div>' +
            '</div>' +
            '<div style="background:#f8fafc; height:6px; border-radius:3px; margin-top:8px; overflow:hidden;">' +
                '<div style="background:linear-gradient(90deg,#16a34a,#22c55e); height:100%; width:' + Math.min(100, Math.round(wdlNum(l.amountPaid) / Math.max(1, wdlNum(l.total)) * 100)) + '%;"></div>' +
            '</div>' +
            '<div style="font-size:11px; color:#64748b; margin-top:4px;">Paid ' + wdlMoney(l.amountPaid) + ' (' + Math.round(wdlNum(l.amountPaid) / Math.max(1, wdlNum(l.total)) * 100) + '%)</div>' +
            '<div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">' +
                (l.status === 'active' ? '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:5px 10px; font-size:11px;" onclick="wdlOpenPay(\'' + wdlEsc(l._id) + '\')">💵 Add Payment</button>' : '') +
                (l.status === 'active' && wdlCanManage() ? '<button class="menu-btn" style="width:auto; margin:0; padding:5px 10px; font-size:11px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdlCancel(\'' + wdlEsc(l._id) + '\')">✕ Cancel</button>' : '') +
                (l.status === 'completed' ? '<button class="menu-btn btn-dash" style="width:auto; margin:0; padding:5px 10px; font-size:11px;" onclick="wdfCloseModal(); wdfShowReceipt(\'' + wdlEsc(l.saleId) + '\')">🖨 Receipt</button>' : '') +
                '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:5px 10px; font-size:11px;" onclick="wdlViewDetail(\'' + wdlEsc(l._id) + '\')">View</button>' +
            '</div></div>';
    }).join('') : '<div style="text-align:center; color:#94a3b8; padding:30px;">No layaway plans yet.</div>';

    wdfModal('📅 Layaway Plans',
        '<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:12px;">' +
            '<div style="background:#eff6ff; border-radius:8px; padding:8px;"><div style="font-size:10px; font-weight:bold; color:#1d4ed8;">ACTIVE</div><div style="font-size:16px; font-weight:bold; color:#1d4ed8;">' + active.length + '</div></div>' +
            '<div style="background:#fef2f2; border-radius:8px; padding:8px;"><div style="font-size:10px; font-weight:bold; color:#991b1b;">OVERDUE</div><div style="font-size:16px; font-weight:bold; color:#991b1b;">' + overdue.length + '</div></div>' +
            '<div style="background:#fff7ed; border-radius:8px; padding:8px;"><div style="font-size:10px; font-weight:bold; color:#9a3412;">OWED</div><div style="font-size:14px; font-weight:bold; color:#9a3412;">' + wdlMoney(totalOwed) + '</div></div>' +
        '</div>' +
        '<div style="max-height:55vh; overflow-y:auto;">' + body + '</div>' +
        '<div style="margin-top:14px; display:flex; gap:8px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdlCloseAndStart()">➕ New Layaway</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Close</button>' +
        '</div>', 620);
};

window.wdlCloseAndStart = function () { wdfCloseModal(); window.wdlOpenStart(); };

// ---------- start layaway ----------
window.wdlOpenStart = function () {
    if (!wdlCanManage()) { alert('Only Admin/Manager can start layaway plans.'); return; }
    // Reset cart and use the sell screen to pick items
    wdfCart = [];
    window.__wdlMode = true;
    window.wdfShowSell();
    // Replace the checkout button behavior after render
    setTimeout(function () {
        var box = wdlEl('wdf-cart');
        if (!box) return;
        var banner = document.createElement('div');
        banner.style.cssText = 'background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 12px; margin-bottom:10px; font-size:13px;';
        banner.innerHTML = '📅 <strong>Layaway mode</strong>. Add the items the customer is reserving, then click "Start Layaway".';
        box.parentNode.insertBefore(banner, box);
    }, 100);
};

// Override checkout to intercept in layaway mode
var __wdlOrigCheckout = window.wdfOpenCheckout;
window.wdfOpenCheckout = function () {
    if (window.__wdlMode) { window.wdlOpenForm(); return; }
    return __wdlOrigCheckout.apply(this, arguments);
};

window.wdlOpenForm = function () {
    if (!wdfCart.length) { alert('Add items to the cart first.'); return; }
    var t = wdfCartTotals();
    var html =
        '<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 12px; font-size:13px;">' +
            wdfCart.length + ' item(s) · Total <strong>' + wdlMoney(t.total) + '</strong>' +
        '</div>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDF_LBL + '">Customer Name *</label><input id="wdl-name" type="text" style="' + WDF_INP + '"></div>' +
            '<div><label style="' + WDF_LBL + '">Phone *</label><input id="wdl-phone" type="text" placeholder="08012345678" style="' + WDF_INP + '"></div>' +
        '</div>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDF_LBL + '">Deposit (₦) *</label><input id="wdl-deposit" type="number" oninput="wdlFormRecalc()" style="' + WDF_INP + '"></div>' +
            '<div><label style="' + WDF_LBL + '">Paid By</label><select id="wdl-depmethod" style="' + WDF_INP + '"><option>Cash</option><option>Transfer</option><option>POS</option></select></div>' +
        '</div>' +
        '<label style="' + WDF_LBL + '">Target Completion Date</label><input id="wdl-target" type="date" value="' + wdlPlusDays(30) + '" style="' + WDF_INP + '">' +
        '<div id="wdl-form-bal" style="font-size:13px; font-weight:bold; color:#1d4ed8; margin-top:8px;"></div>' +
        '<label style="' + WDF_LBL + '">Notes</label><input id="wdl-notes" type="text" style="' + WDF_INP + '">' +
        '<div id="wdl-form-err" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>' +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdlSave()">📅 Start Layaway</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdlBackToCart()">Back</button>' +
        '</div>';
    wdfModal('📅 Start Layaway', html);
    setTimeout(function () { var d = wdlEl('wdl-deposit'); if (d) { d.value = Math.round(t.total * 0.3); wdlFormRecalc(); } }, 50);
};

window.wdlFormRecalc = function () {
    var t = wdfCartTotals();
    var d = parseFloat(wdlVal('wdl-deposit')) || 0;
    var b = wdlEl('wdl-form-bal');
    if (b) b.textContent = d > 0 ? 'Balance after deposit: ' + wdlMoney(Math.max(0, t.total - d)) : '';
};

window.wdlBackToCart = function () { wdfCloseModal(); window.wdfShowSell(); };

window.wdlSave = async function () {
    var fail = function (m) { var e = wdlEl('wdl-form-err'); if (e) { e.textContent = m; e.style.display = 'block'; } };
    var name = wdlVal('wdl-name'), phone = wdlVal('wdl-phone');
    var deposit = parseFloat(wdlVal('wdl-deposit')) || 0;
    var target = wdlVal('wdl-target'), notes = wdlVal('wdl-notes');
    var method = wdlVal('wdl-depmethod') || 'Cash';
    if (!name) return fail('Customer name is required.');
    if (!phone) return fail('Customer phone is required.');
    var t = wdfCartTotals();
    if (!(deposit > 0)) return fail('Deposit must be greater than 0.');
    if (deposit >= t.total) return fail('Deposit must be less than the total. For full payment, use Checkout instead.');

    // Check stock
    for (var i = 0; i < wdfCart.length; i++) {
        var l = wdfCart[i];
        if (wdfLiveQty(l.itemId, l.variantId) < l.qty) return fail('Not enough stock for ' + l.name + ' (' + [l.size, l.color].filter(Boolean).join(', ') + ').');
    }

    window.__wdlBusy = true;
    var db = firebase.database();
    try {
        var cRes = await db.ref('fashionCounters/' + currentStoreId + '/lastLayawayNumber').transaction(function (c) { return (c || 0) + 1; });
        if (!cRes.committed) throw new Error('Could not reserve a layaway number.');
        var id = 'LW-' + String(cRes.snapshot.val()).padStart(6, '0');
        var nowIso = wdlNow(), by = wdlUser();
        var pays = {};
        pays.p0 = { amount: deposit, method: method, at: nowIso, by: by, note: 'Initial deposit' };

        var layaway = {
            id: id,
            customerName: name, customerPhone: phone,
            items: wdfCart.map(function (x) {
                return { itemId: x.itemId, variantId: x.variantId, name: x.name, category: x.category, size: x.size, color: x.color,
                         qty: x.qty, unitPrice: x.unitPrice, listPrice: x.listPrice, costPrice: x.costPrice };
            }),
            subtotal: t.sub, discount: t.disc, total: t.total,
            amountPaid: deposit, payments: pays,
            targetDate: target, status: 'active',
            notes: notes,
            createdAt: nowIso, createdBy: by,
            saleId: null, completedAt: null
        };
        await db.ref('fashionLayaways/' + currentStoreId + '/' + id).set(layaway);

        wdfCart = []; wdfDiscount = 0; window.__wdlMode = false;
        window.__wdlBusy = false;
        wdfCloseModal();
        alert('✅ Layaway ' + id + ' started.\nBalance: ' + wdlMoney(wdlR2(t.total - deposit)));
        window.wdlOpenDashboard();
    } catch (e) {
        window.__wdlBusy = false;
        fail('Could not save: ' + (e.message || e));
    }
};

// ---------- payment ----------
window.wdlOpenPay = function (id) {
    var l = wdlLayaways[id]; if (!l) return;
    var bal = wdlBalance(l);
    if (bal <= 0) { alert('This layaway is fully paid.'); return; }
    var html =
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; font-size:13px;">' +
            '<div><strong>' + wdlEsc(l.customerName) + '</strong> · ' + wdlEsc(l.customerPhone) + '</div>' +
            '<div style="color:#64748b; font-size:12px; margin-top:4px;">' + wdlEsc(l.id) + '</div>' +
            '<div style="margin-top:6px;">Paid ' + wdlMoney(l.amountPaid) + ' · <strong style="color:#b91c1c;">Owes ' + wdlMoney(bal) + '</strong></div>' +
        '</div>' +
        '<label style="' + WDF_LBL + '">Amount Received (₦)</label><input id="wdl-p-amt" type="number" value="' + bal + '" style="' + WDF_INP + '">' +
        '<label style="' + WDF_LBL + '">Paid By</label><select id="wdl-p-method" style="' + WDF_INP + '"><option>Cash</option><option>Transfer</option><option>POS</option></select>' +
        '<div id="wdl-p-err" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>' +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdlSavePayment(\'' + wdlEsc(id) + '\')">Save Payment</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal(); wdlOpenDashboard()">Cancel</button>' +
        '</div>';
    wdfModal('💵 Layaway Payment', html);
};

window.wdlSavePayment = async function (id) {
    var amt = parseFloat(wdlVal('wdl-p-amt')) || 0, method = wdlVal('wdl-p-method') || 'Cash';
    var fail = function (m) { var e = wdlEl('wdl-p-err'); if (e) { e.textContent = m; e.style.display = 'block'; } };
    if (!(amt > 0)) return fail('Enter an amount greater than 0.');
    var key = 'p' + Date.now(), nowIso = wdlNow(), by = wdlUser();
    try {
        var ref = firebase.database().ref('fashionLayaways/' + currentStoreId + '/' + id);
        var res = await ref.transaction(function (cur) {
            if (!cur || cur.status !== 'active') return;
            var bal = Math.max(0, wdlR2(wdlNum(cur.total) - wdlNum(cur.amountPaid)));
            if (amt > bal + 0.001) return;
            var p = Object.assign({}, cur.payments || {});
            p[key] = { amount: amt, method: method, at: nowIso, by: by, note: 'Installment' };
            cur.payments = p;
            cur.amountPaid = wdlR2(wdlNum(cur.amountPaid) + amt);
            // If fully paid, complete
            if (wdlR2(wdlNum(cur.total) - cur.amountPaid) <= 0.001) {
                cur.status = 'completed';
                cur.completedAt = nowIso;
            }
            return cur;
        });
        var v = res.snapshot.val();
        if (!res.committed || !v || !v.payments || !v.payments[key]) return fail('Could not save. Amount may exceed the balance.');
        wdfCloseModal();
        if (v.status === 'completed') {
            await wdlCompleteSale(id);
        } else {
            alert('✅ Payment saved. Balance: ' + wdlMoney(wdlBalance(v)));
            window.wdlOpenDashboard();
        }
    } catch (e) { fail('Failed: ' + (e.message || e)); }
};

// When fully paid: deduct stock and create the sale
async function wdlCompleteSale(id) {
    var l = wdlLayaways[id];
    if (!l) { wdlOpenDashboard(); return; }
    if (!confirm('Layaway ' + id + ' is fully paid. Convert to a sale now?')) { wdlOpenDashboard(); return; }
    var db = firebase.database();
    var taken = [];
    var undo = async function () {
        for (var k = 0; k < taken.length; k++) {
            try {
                await db.ref('fashionItems/' + currentStoreId + '/' + taken[k].itemId + '/variants/' + taken[k].variantId + '/qty')
                    .transaction(function (cur) { return typeof cur === 'number' ? cur + taken[k].qty : cur; });
            } catch (e) {}
        }
    };
    try {
        for (var i = 0; i < l.items.length; i++) {
            var it = l.items[i];
            var ref = db.ref('fashionItems/' + currentStoreId + '/' + it.itemId + '/variants/' + it.variantId + '/qty');
            var res = await ref.transaction(function (cur) {
                if (typeof cur !== 'number') return cur;
                return cur >= it.qty ? cur - it.qty : undefined;
            });
            if (!res.committed) { await undo(); alert('Not enough stock for ' + it.name + '. Please restock or cancel the layaway.'); return; }
            taken.push({ itemId: it.itemId, variantId: it.variantId, qty: it.qty });
        }
        var cRes = await db.ref('fashionCounters/' + currentStoreId + '/lastSaleNumber').transaction(function (c) { return (c || 0) + 1; });
        var saleId = 'FS-' + String(cRes.snapshot.val()).padStart(6, '0');
        var nowIso = wdlNow(), by = wdlUser();
        var sale = {
            saleId: saleId,
            items: l.items.map(function (x) { return Object.assign({}, x, { returnedQty: 0 }); }),
            subtotal: l.subtotal, discount: l.discount, total: l.total,
            amountPaid: l.amountPaid, refundedTotal: 0, balance: 0, dueDate: null,
            paymentMethod: 'Layaway',
            payments: l.payments,
            customerName: l.customerName, customerPhone: l.customerPhone,
            notes: 'Layaway ' + l.id + (l.notes ? ' — ' + l.notes : ''),
            soldBy: l.createdBy, soldAt: l.createdAt, completedAt: nowIso
        };
        await db.ref('fashionSales/' + currentStoreId + '/' + saleId).set(sale);
        await db.ref('fashionLayaways/' + currentStoreId + '/' + id).update({ saleId: saleId });
        alert('✅ Sale ' + saleId + ' created.');
        wdfShowReceipt(saleId);
    } catch (e) {
        await undo();
        alert('Could not convert: ' + (e.message || e));
    }
}

// ---------- cancel ----------
window.wdlCancel = async function (id) {
    var l = wdlLayaways[id]; if (!l) return;
    var refundAmt = prompt('Refund amount (₦). Enter 0 for no refund:', l.amountPaid || 0);
    if (refundAmt === null) return;
    refundAmt = Math.max(0, parseFloat(refundAmt) || 0);
    if (!confirm('Cancel layaway ' + id + '?\nRefund: ' + wdlMoney(refundAmt) + '\n\nItems will be returned to stock.')) return;
    try {
        await firebase.database().ref('fashionLayaways/' + currentStoreId + '/' + id).update({
            status: 'cancelled', cancelledAt: wdlNow(), cancelledBy: wdlUser(), refundAmount: refundAmt
        });
        // Optionally log the refund
        alert('Layaway cancelled.');
        window.wdlOpenDashboard();
    } catch (e) { alert('Failed: ' + (e.message || e)); }
};

// ---------- detail view ----------
window.wdlViewDetail = function (id) {
    var l = wdlLayaways[id]; if (!l) return;
    var pays = wdlPayments(l);
    var html =
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; font-size:13px;">' +
            '<div><strong>' + wdlEsc(l.id) + '</strong> · ' + wdlEsc(l.status.toUpperCase()) + '</div>' +
            '<div style="margin-top:4px;">👤 ' + wdlEsc(l.customerName) + ' · ' + wdlEsc(l.customerPhone) + '</div>' +
            '<div style="color:#64748b; font-size:12px; margin-top:4px;">Started ' + wdlPretty(l.createdAt) + ' · Target ' + wdlPretty(l.targetDate) + '</div>' +
        '</div>' +
        '<div style="margin-top:10px; font-size:13px;">' +
            '<div style="font-weight:bold; margin-bottom:4px;">Items</div>' +
            l.items.map(function (i) {
                return '<div style="padding:5px 0; border-bottom:1px solid #f1f5f9;">' + i.qty + '× ' + wdlEsc(i.name) + ' (' + wdlEsc([i.size, i.color].filter(Boolean).join(', ')) + ') — ' + wdlMoney(wdlNum(i.unitPrice) * i.qty) + '</div>';
            }).join('') +
        '</div>' +
        '<div style="margin-top:10px; font-size:13px;">' +
            '<div style="font-weight:bold; margin-bottom:4px;">Payments</div>' +
            (pays.length ? pays.map(function (p) {
                return '<div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #f1f5f9;">' +
                    '<span>' + wdlPretty(p.at) + ' · ' + wdlEsc(p.method) + ' · ' + wdlEsc(p.by) + '</span><strong>' + wdlMoney(p.amount) + '</strong></div>';
            }).join('') : '<div style="color:#94a3b8;">No payments yet.</div>') +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; margin-top:12px; font-size:14px; padding:8px; background:#f0fdf4; border-radius:8px;">' +
            '<span>Paid</span><strong>' + wdlMoney(l.amountPaid) + '</strong>' +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; margin-top:4px; font-size:14px; padding:8px; background:#fef2f2; border-radius:8px;">' +
            '<span>Balance</span><strong style="color:#b91c1c;">' + wdlMoney(wdlBalance(l)) + '</strong>' +
        '</div>' +
        (l.notes ? '<div style="margin-top:10px; font-size:12px; font-style:italic;">Notes: ' + wdlEsc(l.notes) + '</div>' : '') +
        '<div style="margin-top:14px;"><button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal(); wdlOpenDashboard()">Back</button></div>';
    wdfModal('📅 Layaway Details', html, 560);
};

// ---------- auto-attach when store data loads ----------
function wdlAttach() {
    if (typeof wdfStoreType === 'undefined' || wdfStoreType !== 'fashion') { wdlStopData(); return; }
    wdlStartData();
    // Inject Layaway button into the Fashion dashboard action bar if present
    setTimeout(function () {
        var bar = document.querySelector('button[onclick="wdfOpenHistory()"]');
        if (!bar) return;
        var btn = wdlEl('wdl-layaway-btn');
        if (btn) return;
        btn = document.createElement('button');
        btn.id = 'wdl-layaway-btn';
        btn.className = 'menu-btn';
        btn.style.cssText = 'width:auto; margin:0; padding:8px 14px; font-weight:bold; font-size:12px; background:#eef2ff; border:1px solid #c7d2fe; color:#3730a3;';
        btn.innerHTML = '📅 Layaway <span id="wdl-layaway-badge" style="display:none; background:#f59e0b; color:#fff; border-radius:10px; padding:1px 7px; font-size:10px; margin-left:4px;"></span>';
        btn.onclick = window.wdlOpenDashboard;
        bar.parentNode.insertBefore(btn, bar.nextSibling);
        wdlRefreshBadge();
    }, 200);
}

// Watch for store type changes
setInterval(wdlAttach, 1500);
