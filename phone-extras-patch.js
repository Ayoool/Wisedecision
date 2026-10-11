// ==================== WISE DECISION PHONE EXTRAS PATCH (v1) ====================
// Load AFTER phone-sale-patch.js (and after staff-sidebar-patch.js if you use it).
//
// STAGE 3 — Fixes + part payments + returns + trade-ins + reports + permissions
//           + warranty lookup + repairs.
//
// Fixes (without touching Stage 1 / Stage 2 files):
//   • Profit cards now read the real sale data (they were always ₦0)
//   • A phone can no longer be sold twice (atomic claim on status)
//   • Phone listener no longer piles up every time you open the screen
//   • "Missing" status chip + filter option, Edit title + warranty pre-selected
//
// New data (all beside the old data, nothing is renamed):
//   phoneSales/{storeId}/{saleId}: netPayable, amountPaid, balance, dueDate,
//                                  payments{}, tradeIn{}, refunded{}
//   phoneRepairs/{storeId}/{repairId}
//
// IMPORTANT: roles are enforced in the UI only. Real enforcement needs the
// Firebase rules lock (security Phase 3).

console.log("Wise Decision phone-extras-patch.js — v1 loaded");

// Set to true if phone vendors should NOT see the normal POS Sales / Inventory
// buttons. Leave false so they can sell accessories (chargers, cases) there.
var WDX_HIDE_GROCERY_FOR_PHONE_VENDORS = false;

// Safety net for the old bulk-add typo (`|| EDIT0`). Please also fix the line
// in phone-vendor-patch.js: change `|| EDIT0` to `|| 0`.
if (typeof window.EDIT0 === 'undefined') window.EDIT0 = 0;

// =====================================================================
// HELPERS
// =====================================================================
function wdxEl(id) { return document.getElementById(id); }
function wdxVal(id) { var e = wdxEl(id); return e ? String(e.value || '').trim() : ''; }
function wdxR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function wdxIsAdmin() { return typeof currentUserRole !== 'undefined' && currentUserRole === 'Admin'; }
function wdxIsManager() { return typeof currentUserRole !== 'undefined' && currentUserRole === 'Manager'; }
function wdxCanManageStock() { return wdxIsAdmin() || wdxIsManager(); }
function wdxCanRefund() { return wdxIsAdmin() || wdxIsManager(); }
function wdxUser() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
function wdxLocalDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + wdsPad(d.getMonth() + 1) + '-' + wdsPad(d.getDate());
}
function wdxPlusDays(n) {
    var d = new Date(); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + wdsPad(d.getMonth() + 1) + '-' + wdsPad(d.getDate());
}
function wdxDaysUntil(dateStr) {
    var a = new Date(wdsToday() + 'T00:00:00'), b = new Date(dateStr + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.round((b - a) / 86400000);
}
function wdxIntlPhone(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '0') return '234' + d.slice(1);
    if (d.length === 10) return '234' + d;
    return d;
}
function wdxWhatsApp(phone, msg) {
    var num = wdxIntlPhone(phone);
    if (!num) { alert('No valid phone number.'); return; }
    window.open('https://wa.me/' + num + '?text=' + encodeURIComponent(msg), '_blank');
}

var WDX_INP = 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;';
var WDX_LBL = 'display:block; font-size:11px; font-weight:bold; color:#334155; margin-bottom:4px; margin-top:10px; text-transform:uppercase; letter-spacing:0.5px;';
var WDX_BTN = 'width:auto; margin:0; padding:8px 14px; font-weight:bold; font-size:12px;';
function wdxErrBox(id) {
    return '<div id="' + id + '" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>';
}
function wdxShowErr(id, msg) { var e = wdxEl(id); if (e) { e.textContent = msg; e.style.display = 'block'; } }
function wdxOpts(arr, sel) {
    return arr.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + wdsEsc(x) + '</option>'; }).join('');
}

// Store name (for WhatsApp messages)
var wdxStoreName = 'our shop', wdxStoreNameFor = null;
function wdxCacheStoreName() {
    if (typeof currentStoreId === 'undefined' || !currentStoreId || wdxStoreNameFor === currentStoreId) return;
    wdxStoreNameFor = currentStoreId;
    firebase.database().ref('stores/' + currentStoreId + '/businessName').once('value')
        .then(function (s) { if (s.val()) wdxStoreName = s.val(); })
        .catch(function () {});
}

// =====================================================================
// SALES CACHE (one live listener, shared by history / debtors / reports)
// =====================================================================
var wdxSales = {};
var wdxSalesRef = null, wdxSalesStore = null;

function wdxWatchSales() {
    if (typeof currentStoreId === 'undefined' || !currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
    if (wdxSalesStore === currentStoreId) return;
    if (wdxSalesRef) { try { wdxSalesRef.off(); } catch (e) {} }
    wdxSalesStore = currentStoreId;
    wdxSalesRef = firebase.database().ref('phoneSales/' + currentStoreId);
    wdxSalesRef.on('value', function (snap) {
        wdxSales = snap.val() || {};
        if (wdxEl('wdv-table-body') && typeof window.wdvRenderSummary === 'function') window.wdvRenderSummary();
        wdxUpdateDebtBadge();
        if (wdxEl('wds-h-body')) window.wdsRenderSalesHistory();
    }, function () {});
}

function wdxSaleList() {
    return Object.keys(wdxSales).map(function (k) { return Object.assign({ _id: k }, wdxSales[k]); });
}
function wdxSaleBalance(s) { return s.refunded ? 0 : wdsNum(s.balance); }
function wdxSaleNet(s) { return s.netPayable != null ? wdsNum(s.netPayable) : wdsNum(s.price); }
function wdxSalePaid(s) { return s.amountPaid != null ? wdsNum(s.amountPaid) : wdsNum(s.price); }
// Payments list (old Stage-2 sales have none, so treat them as paid in full on sale day)
function wdxPayments(s) {
    if (s.payments) {
        return Object.keys(s.payments).map(function (k) { return s.payments[k]; })
            .sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); });
    }
    if (s.amountPaid == null && wdsNum(s.price) > 0) {
        return [{ amount: wdsNum(s.price), method: s.paymentMethod || 'Cash', at: s.soldAt }];
    }
    return [];
}

// =====================================================================
// FIX 1 — Load phones with ONE listener (no pile-up)
// =====================================================================
var wdxPhonesRef = null;
window.wdvLoadPhones = function () {
    return new Promise(function (resolve) {
        if (typeof currentStoreId === 'undefined' || !currentStoreId) { resolve(); return; }
        try {
            if (wdxPhonesRef) { try { wdxPhonesRef.off(); } catch (e) {} }
            wdxPhonesRef = firebase.database().ref('phoneInventory/' + currentStoreId);
            var first = true;
            wdxPhonesRef.on('value', function (snap) {
                wdvPhones = snap.val() || {};
                if (wdxEl('wdv-table-body')) { window.wdvRenderInventory(); window.wdvRenderSummary(); }
                if (first) { first = false; resolve(); }
            }, function () { resolve(); });
        } catch (e) { resolve(); }
    });
};

// =====================================================================
// FIX 2 — Status chip knows "missing"; summary cards use real sale data
// =====================================================================
window.wdvStatusChip = function (status) {
    var m = {
        in_stock: ['#dcfce7', '#166534', 'IN STOCK'],
        sold:     ['#e0e7ff', '#3730a3', 'SOLD'],
        reserved: ['#fef3c7', '#92400e', 'RESERVED'],
        returned: ['#fee2e2', '#991b1b', 'RETURNED'],
        missing:  ['#fee2e2', '#991b1b', 'MISSING']
    }[status] || ['#e2e8f0', '#334155', String(status || '').toUpperCase()];
    return '<span style="background:' + m[0] + '; color:' + m[1] + '; font-size:10px; font-weight:bold; padding:3px 9px; border-radius:10px;">' + m[2] + '</span>';
};

window.wdvRenderSummary = function () {
    var today = wdsToday(), month = today.substring(0, 7);
    var profitToday = 0, profitMonth = 0, capital = 0, dead = 0;

    Object.keys(wdxSales).forEach(function (k) {
        var s = wdxSales[k];
        if (s.refunded) return;
        var d = wdxLocalDate(s.soldAt);
        var profit = wdsNum(s.profit);
        if (d === today) profitToday += profit;
        if (d.substring(0, 7) === month) profitMonth += profit;
    });

    var phones = (typeof wdvPhones !== 'undefined') ? wdvPhones : {};
    Object.keys(phones).forEach(function (id) {
        var p = phones[id];
        if (p.status === 'in_stock') {
            capital += wdsNum(p.costPrice);
            var days = p.createdAt ? Math.round((Date.now() - new Date(p.createdAt).getTime()) / 86400000) : 0;
            if (days > 30) dead++;
        }
    });

    var setText = function (id, val) { var e = wdxEl(id); if (e && e.textContent !== String(val)) e.textContent = val; };
    setText('wdv-card-profit-today', wdsMoney(profitToday));
    setText('wdv-card-profit-month', wdsMoney(profitMonth));
    setText('wdv-card-capital', wdsMoney(capital));
    setText('wdv-card-dead', dead);
};

// Edit modal: correct title + warranty pre-selected
var wdxOrigOpenAdd = window.wdvOpenAddPhoneModal;
window.wdvOpenAddPhoneModal = function (editId) {
    wdxOrigOpenAdd.apply(this, arguments);
    if (editId && wdvPhones[editId]) {
        var h = document.querySelector('#wdv-modal h3');
        if (h) h.textContent = '✏️ Edit Phone';
        var w = wdxEl('wdv-f-warranty');
        if (w) w.value = String(wdsNum(wdvPhones[editId].warrantyMonths));
    }
};

// Role guards (UI level)
var wdxOrigDelete = window.wdvDeletePhone;
window.wdvDeletePhone = function (id) {
    if (!wdxIsAdmin()) { alert('Only the Admin can delete phones.'); return; }
    return wdxOrigDelete.apply(this, arguments);
};
var wdxOrigEdit = window.wdvEditPhone;
window.wdvEditPhone = function (id) {
    if (!wdxIsAdmin()) { alert('Only the Admin can edit phone details.'); return; }
    return wdxOrigEdit.apply(this, arguments);
};
var wdxOrigAdjust = window.wdsConfirmAdjustStock;
window.wdsConfirmAdjustStock = function () {
    if (!wdxCanManageStock()) { alert('Only the Admin or Manager can adjust stock.'); return; }
    return wdxOrigAdjust.apply(this, arguments);
};

// =====================================================================
// SIDEBAR — every role gets the Phone Sales button in a phone-vendor store
// =====================================================================
window.wdvApplySidebar = function () {
    var side = document.querySelector('#dashboard-main-wrapper .sidebar');
    if (!side) return;

    var posBtn = null, invBtn = null;
    side.querySelectorAll('button').forEach(function (b) {
        var t = (b.textContent || '').trim();
        if (t.indexOf('POS Sales') !== -1) posBtn = b;
        if (t.indexOf('Inventory') !== -1 && t.indexOf('Phone') === -1) invBtn = b;
    });

    var phoneBtn = wdxEl('wdv-sidebar-phone-btn');
    var inStore = typeof currentStoreId !== 'undefined' && currentStoreId && currentStoreId !== 'SUPER_ADMIN';
    var isPhoneVendor = (typeof wdvGetDashboardForStore === 'function') && wdvGetDashboardForStore() === 'phone_vendor';

    if (isPhoneVendor && inStore) {
        if (WDX_HIDE_GROCERY_FOR_PHONE_VENDORS) {
            if (posBtn) posBtn.style.display = 'none';
            if (invBtn) invBtn.style.display = 'none';
        }
        if (!phoneBtn) {
            var b = document.createElement('button');
            b.id = 'wdv-sidebar-phone-btn';
            b.className = 'menu-btn btn-phone';
            b.textContent = '📱 Phone Sales';
            b.onclick = function () { wdvShowInventory(); };
            var dashBtn = null;
            side.querySelectorAll('button').forEach(function (x) {
                if ((x.textContent || '').indexOf('Dashboard') !== -1 && !dashBtn) dashBtn = x;
            });
            if (dashBtn && dashBtn.nextSibling) side.insertBefore(b, dashBtn.nextSibling);
            else side.appendChild(b);
        }
    } else {
        if (posBtn && posBtn.style.display === 'none') posBtn.style.display = '';
        if (invBtn && invBtn.style.display === 'none') invBtn.style.display = '';
        if (phoneBtn) phoneBtn.remove();
    }
};

// =====================================================================
// SELL MODAL v2 — part payment + trade-in + atomic "claim" of the phone
// =====================================================================
window.wdsOpenSellModal = function (phoneId) {
    var p = (typeof wdvPhones !== 'undefined' && wdvPhones[phoneId]) ? wdvPhones[phoneId] : null;
    if (!p) { alert('Phone not found.'); return; }
    if (p.status !== 'in_stock') { alert('Only in-stock phones can be sold.'); return; }

    var html =
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:6px; font-size:13px;">' +
            '<div><strong>' + wdsEsc(p.brand || '') + ' ' + wdsEsc(p.model || '') + '</strong></div>' +
            '<div style="color:#64748b; font-size:12px; margin-top:4px;">' + [p.storage, p.color, p.condition].filter(Boolean).map(wdsEsc).join(' · ') + '</div>' +
            '<div style="font-family:monospace; font-size:11px; margin-top:6px;">IMEI: ' + wdsEsc(p.imei || '') + '</div>' +
            (wdxIsAdmin() ? '<div style="color:#64748b; font-size:12px; margin-top:6px;">Cost Price: <strong>' + wdsMoney(p.costPrice) + '</strong></div>' : '') +
        '</div>' +

        '<label style="' + WDX_LBL + '">Selling Price (₦) *</label>' +
        '<input id="wdx-s-price" type="number" value="' + (wdsNum(p.sellingPrice) || '') + '" oninput="wdxSellRecalc()" style="' + WDX_INP + '">' +

        '<label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:13px; cursor:pointer;">' +
            '<input type="checkbox" id="wdx-s-trade-on" onchange="wdxSellRecalc()"> 🔁 Customer is trading in a phone</label>' +
        '<div id="wdx-s-trade" style="display:none; background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px; margin-top:8px;">' +
            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
                '<div><label style="' + WDX_LBL + '">Brand</label><select id="wdx-t-brand" style="' + WDX_INP + '">' + wdxOpts(WDV_PHONE_BRANDS) + '</select></div>' +
                '<div><label style="' + WDX_LBL + '">Storage</label><select id="wdx-t-storage" style="' + WDX_INP + '">' + wdxOpts(WDV_STORAGE_OPTIONS, '64GB') + '</select></div>' +
            '</div>' +
            '<label style="' + WDX_LBL + '">Model *</label><input id="wdx-t-model" type="text" placeholder="e.g. iPhone 8" style="' + WDX_INP + '">' +
            '<label style="' + WDX_LBL + '">IMEI *</label><input id="wdx-t-imei" type="text" placeholder="Dial *#06#" style="' + WDX_INP + ' font-family:monospace;">' +
            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
                '<div><label style="' + WDX_LBL + '">Trade-in Value (₦) *</label><input id="wdx-t-value" type="number" oninput="wdxSellRecalc()" style="' + WDX_INP + '"></div>' +
                '<div><label style="' + WDX_LBL + '">Resale Price (₦)</label><input id="wdx-t-resale" type="number" placeholder="Optional" style="' + WDX_INP + '"></div>' +
            '</div>' +
            '<label style="' + WDX_LBL + '">Condition</label><select id="wdx-t-cond" style="' + WDX_INP + '">' + wdxOpts(WDV_CONDITIONS, 'UK Used') + '</select>' +
            '<div style="font-size:11px; color:#92400e; margin-top:6px;">The traded-in phone is added to your stock automatically, with the trade-in value as its cost.</div>' +
        '</div>' +

        '<div id="wdx-s-net" style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px; padding:8px 10px; font-size:13px; margin-top:12px;"></div>' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDX_LBL + '">Payment Method</label>' +
                '<select id="wdx-s-method" onchange="wdxSellRecalc()" style="' + WDX_INP + '"><option>Cash</option><option>Transfer</option><option>POS</option><option>Part Payment</option></select></div>' +
            '<div><label style="' + WDX_LBL + '">Warranty</label>' +
                '<select id="wdx-s-warranty" style="' + WDX_INP + '">' +
                [0, 3, 6, 12, 24].map(function (m) { return '<option value="' + m + '"' + (m === 12 ? ' selected' : '') + '>' + (m === 0 ? 'No warranty' : m + ' months') + '</option>'; }).join('') +
                '</select></div>' +
        '</div>' +

        '<div id="wdx-s-part" style="display:none; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px; margin-top:8px;">' +
            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
                '<div><label style="' + WDX_LBL + '">Deposit Paid (₦) *</label><input id="wdx-s-paid" type="number" oninput="wdxSellRecalc()" style="' + WDX_INP + '"></div>' +
                '<div><label style="' + WDX_LBL + '">Deposit Paid By</label><select id="wdx-s-depmethod" style="' + WDX_INP + '"><option>Cash</option><option>Transfer</option><option>POS</option></select></div>' +
            '</div>' +
            '<label style="' + WDX_LBL + '">Balance Due Date</label>' +
            '<input id="wdx-s-due" type="date" value="' + wdxPlusDays(14) + '" style="' + WDX_INP + '">' +
            '<div id="wdx-s-bal" style="font-size:13px; font-weight:bold; color:#1d4ed8; margin-top:8px;"></div>' +
        '</div>' +

        '<label style="' + WDX_LBL + '">Customer Name *</label><input id="wdx-s-name" type="text" placeholder="e.g. John Doe" style="' + WDX_INP + '">' +
        '<label style="' + WDX_LBL + '">Customer Phone *</label><input id="wdx-s-phone" type="text" placeholder="e.g. 08012345678" style="' + WDX_INP + '">' +
        '<label style="' + WDX_LBL + '">Notes (optional)</label><textarea id="wdx-s-notes" rows="2" placeholder="e.g. Includes charger and case" style="' + WDX_INP + '"></textarea>' +

        wdxErrBox('wds-sell-error') +

        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center; background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);" onclick="wdsConfirmSale(\'' + wdsEsc(phoneId) + '\')">✅ Confirm Sale & Print Receipt</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdsCloseModal()">Cancel</button>' +
        '</div>';

    wdsModal('💰 Sell Phone', html);
    wdxSellRecalc();
};

window.wdxSellRecalc = function () {
    var price = parseFloat(wdxVal('wdx-s-price')) || 0;
    var tOn = !!(wdxEl('wdx-s-trade-on') && wdxEl('wdx-s-trade-on').checked);
    var tVal = tOn ? (parseFloat(wdxVal('wdx-t-value')) || 0) : 0;
    var net = Math.max(0, price - tVal);
    var part = wdxVal('wdx-s-method') === 'Part Payment';
    var paid = parseFloat(wdxVal('wdx-s-paid')) || 0;

    if (wdxEl('wdx-s-trade')) wdxEl('wdx-s-trade').style.display = tOn ? 'block' : 'none';
    if (wdxEl('wdx-s-part')) wdxEl('wdx-s-part').style.display = part ? 'block' : 'none';
    if (wdxEl('wdx-s-net')) {
        wdxEl('wdx-s-net').innerHTML = tVal > 0
            ? wdsMoney(price) + ' − trade-in ' + wdsMoney(tVal) + ' = <strong>Net payable ' + wdsMoney(net) + '</strong>'
            : 'Net payable: <strong>' + wdsMoney(net) + '</strong>';
    }
    if (wdxEl('wdx-s-bal')) {
        wdxEl('wdx-s-bal').textContent = part ? 'Balance after deposit: ' + wdsMoney(Math.max(0, net - paid)) : '';
    }
};

window.__wdxSelling = false;
window.wdsConfirmSale = async function (phoneId) {
    if (window.__wdxSelling) return;
    var errId = 'wds-sell-error';
    var errEl = wdxEl(errId); if (errEl) errEl.style.display = 'none';
    var fail = function (m) { wdxShowErr(errId, m); };

    var p = (typeof wdvPhones !== 'undefined' && wdvPhones[phoneId]) ? wdvPhones[phoneId] : null;
    if (!p) return fail('Phone not found.');
    if (p.status !== 'in_stock') return fail('This phone is no longer in stock.');

    var price = parseFloat(wdxVal('wdx-s-price')) || 0;
    var method = wdxVal('wdx-s-method');
    var warrantyMonths = parseInt(wdxVal('wdx-s-warranty')) || 0;
    var custName = wdxVal('wdx-s-name');
    var custPhone = wdxVal('wdx-s-phone');
    var notes = wdxVal('wdx-s-notes');
    var tOn = !!wdxEl('wdx-s-trade-on').checked;

    if (!(price > 0)) return fail('Selling price must be greater than 0.');
    if (!custName) return fail('Customer name is required (used on the warranty receipt).');
    if (!custPhone) return fail('Customer phone is required (used on the warranty receipt).');

    // ---- trade-in checks
    var trade = null;
    if (tOn) {
        var tModel = wdxVal('wdx-t-model'), tImei = wdxVal('wdx-t-imei');
        var tValue = parseFloat(wdxVal('wdx-t-value')) || 0;
        if (!tModel) return fail('Enter the model of the traded-in phone.');
        if (!/^\d{10,20}$/.test(tImei)) return fail('Traded-in phone IMEI should be 10–20 digits.');
        if (!(tValue > 0)) return fail('Enter the trade-in value.');
        if (tValue >= price) return fail('Trade-in value must be less than the selling price.');
        var phonesNow = wdvPhones || {};
        var dupId = Object.keys(phonesNow).find(function (id) {
            return phonesNow[id].imei === tImei || phonesNow[id].imei2 === tImei;
        });
        if (dupId) return fail('The traded-in IMEI is already in your inventory (' + phonesNow[dupId].brand + ' ' + phonesNow[dupId].model + ', ' + phonesNow[dupId].status + ').');
        var tResale = parseFloat(wdxVal('wdx-t-resale')) || 0;
        trade = {
            brand: wdxVal('wdx-t-brand'), model: tModel, storage: wdxVal('wdx-t-storage'),
            imei: tImei, value: tValue, resale: tResale, condition: wdxVal('wdx-t-cond')
        };
    }

    var net = wdxR2(price - (trade ? trade.value : 0));

    // ---- payment checks
    var paid, balance = 0, depMethod = method, dueDate = null;
    if (method === 'Part Payment') {
        paid = parseFloat(wdxVal('wdx-s-paid')) || 0;
        if (!(paid > 0)) return fail('Enter the deposit the customer is paying now.');
        if (paid >= net) return fail('Deposit must be less than the net payable (' + wdsMoney(net) + '). For full payment pick Cash, Transfer or POS.');
        balance = wdxR2(net - paid);
        depMethod = wdxVal('wdx-s-depmethod') || 'Cash';
        dueDate = wdxVal('wdx-s-due') || null;
    } else {
        paid = net;
    }

    window.__wdxSelling = true;
    var db = firebase.database();
    var statusRef = db.ref('phoneInventory/' + currentStoreId + '/' + phoneId + '/status');
    var claimed = false, saved = false;

    try {
        // Claim the phone atomically so two devices can't both sell it
        var claim = await statusRef.transaction(function (cur) {
            if (cur === null) return cur;
            return cur === 'in_stock' ? 'sold' : undefined;
        });
        if (!claim.committed || claim.snapshot.val() !== 'sold') {
            window.__wdxSelling = false;
            return fail('This phone was just sold or changed on another device. Close this window and check the list.');
        }
        claimed = true;

        var saleId = await wdsNextSaleId();
        var nowIso = wdsNow();
        var soldDate = wdsToday();
        var warrantyEnd = warrantyMonths > 0 ? wdsAddMonths(soldDate, warrantyMonths) : null;
        var seller = wdxUser();
        var cost = wdsNum(p.costPrice);
        var profit = wdxR2(price - cost);

        var sale = {
            saleId: saleId, phoneId: phoneId,
            imei: p.imei || '', imei2: p.imei2 || '',
            brand: p.brand || '', model: p.model || '', storage: p.storage || '',
            color: p.color || '', condition: p.condition || '',
            customerName: custName, customerPhone: custPhone,
            price: price, costPrice: cost, profit: profit,
            netPayable: net, amountPaid: paid, balance: balance, dueDate: dueDate,
            paymentMethod: method,
            warrantyMonths: warrantyMonths, warrantyStart: soldDate, warrantyEnd: warrantyEnd,
            notes: notes, soldBy: seller, soldAt: nowIso,
            tradeIn: trade ? { brand: trade.brand, model: trade.model, imei: trade.imei, value: trade.value } : null
        };
        if (paid > 0) {
            sale.payments = { p0: { amount: paid, method: depMethod, at: nowIso, by: seller, note: method === 'Part Payment' ? 'Deposit' : 'Full payment' } };
        }

        var updates = {};
        updates['phoneInventory/' + currentStoreId + '/' + phoneId + '/soldTo'] = {
            saleId: saleId, price: price, soldPrice: price, soldDate: soldDate,
            costPrice: cost, profit: profit, paymentMethod: method,
            customerName: custName, customerPhone: custPhone,
            warrantyMonths: warrantyMonths, warrantyStart: soldDate, warrantyEnd: warrantyEnd,
            notes: notes, soldBy: seller, soldAt: nowIso
        };
        updates['phoneSales/' + currentStoreId + '/' + saleId] = sale;

        if (trade) {
            var tradeId = db.ref('phoneInventory/' + currentStoreId).push().key;
            updates['phoneInventory/' + currentStoreId + '/' + tradeId] = {
                imei: trade.imei, imei2: '', brand: trade.brand, model: trade.model,
                storage: trade.storage, color: '', condition: trade.condition,
                costPrice: trade.value, sellingPrice: trade.resale || Math.round(trade.value * 1.15 / 500) * 500,
                purchaseDate: soldDate, warrantyMonths: 0,
                notes: 'Trade-in on ' + saleId, status: 'in_stock',
                createdAt: nowIso, createdBy: seller, tradeInFrom: saleId
            };
        }

        await db.ref().update(updates);
        saved = true;
        window.__wdxSelling = false;
        wdsCloseModal();
        wdsShowReceipt(saleId);
    } catch (e) {
        window.__wdxSelling = false;
        if (claimed && !saved) { try { await statusRef.set('in_stock'); } catch (_) {} }
        fail('Could not complete sale: ' + (e.message || e));
    }
};

// =====================================================================
// RECEIPT v2 — shows trade-in, payments and balance
// =====================================================================
window.wdsShowReceipt = function (saleId) {
    var ws = wdxEl('workspace-content');
    if (!ws) return;

    ws.innerHTML =
        '<div style="display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap;">' +
            '<button class="menu-btn btn-action-primary" style="width:auto; justify-content:center;" onclick="wdsPrintReceipt()">🖨 Print Receipt</button>' +
            '<button class="menu-btn btn-dash" style="width:auto;" onclick="wdsDownloadReceiptPDF()">📥 Download PDF</button>' +
            '<button class="menu-btn btn-logout" style="width:auto;" onclick="wdsBackToPhoneInventory()">🔙 Back to Phone Inventory</button>' +
        '</div>' +
        '<div id="wds-printable-receipt" style="background:#fff; color:#000; padding:20px; border-radius:8px; max-width:380px; font-family:monospace; margin:0 auto; border:1px solid #ccc;">' +
            '<div style="text-align:center; margin-bottom:8px;">' +
                '<h3 id="wds-receipt-store-name" style="margin:0; font-size:16px;">WISE DECISION</h3>' +
                '<div id="wds-receipt-store-address" style="font-size:10px; color:#333; margin-top:3px;"></div>' +
                '<div id="wds-receipt-store-phone" style="font-size:10px; color:#333;"></div>' +
            '</div>' +
            '<hr style="border:dashed 1px #ccc;">' +
            '<div style="text-align:center; font-weight:bold; font-size:12px; margin:6px 0;">WARRANTY RECEIPT</div>' +
            '<hr style="border:dashed 1px #ccc;">' +
            '<div id="wds-receipt-body" style="font-size:11px; line-height:1.7;">Loading...</div>' +
            '<hr style="border:dashed 1px #ccc;">' +
            '<div style="text-align:center; font-size:10px; color:#333; margin-top:10px;">Keep this receipt safe. It is your proof of purchase and warranty.</div>' +
            '<div style="margin-top:14px; font-size:10px;"><div style="border-top:1px solid #000; width:70%; margin-top:24px;"></div>Buyer signature</div>' +
        '</div>' +
        '<div id="wdx-receipt-actions" style="max-width:380px; margin:12px auto 0; display:flex; gap:8px; flex-wrap:wrap;"></div>';

    var db = firebase.database();
    db.ref('phoneSales/' + currentStoreId + '/' + saleId).once('value').then(function (snap) {
        var sale = snap.val();
        var body = wdxEl('wds-receipt-body');
        if (!body) return;
        if (!sale) { body.innerHTML = '<div style="color:#991b1b;">Sale record not found.</div>'; return; }

        db.ref('stores/' + currentStoreId).once('value').then(function (storeSnap) {
            var store = storeSnap.val() || {};
            var n = wdxEl('wds-receipt-store-name'), a = wdxEl('wds-receipt-store-address'), ph = wdxEl('wds-receipt-store-phone');
            if (n) n.textContent = store.businessName || 'WISE DECISION';
            if (a) a.textContent = store.address || '';
            if (ph) ph.textContent = store.phone ? ('Tel: ' + store.phone) : '';
        });

        var net = wdxSaleNet(sale), paid = wdxSalePaid(sale), bal = wdxSaleBalance(sale);
        var hr = '<hr style="border:dashed 1px #ccc; margin:8px 0;">';
        var pays = wdxPayments(sale);

        var html =
            (sale.refunded ? '<div style="text-align:center; font-weight:bold; color:#991b1b; border:2px solid #991b1b; padding:4px; margin-bottom:8px;">REFUNDED — WARRANTY VOID</div>' : '') +
            '<div><strong>Receipt ID:</strong> ' + wdsEsc(sale.saleId) + '</div>' +
            '<div><strong>Date:</strong> ' + wdsPrettyDate(sale.soldAt) + '</div>' + hr +
            '<div><strong>Device:</strong> ' + wdsEsc(sale.brand) + ' ' + wdsEsc(sale.model) + '</div>' +
            '<div><strong>Storage:</strong> ' + wdsEsc(sale.storage || '—') + ' &nbsp; <strong>Color:</strong> ' + wdsEsc(sale.color || '—') + '</div>' +
            '<div><strong>Condition:</strong> ' + wdsEsc(sale.condition || '—') + '</div>' +
            '<div><strong>IMEI 1:</strong> ' + wdsEsc(sale.imei || '—') + '</div>' +
            (sale.imei2 ? '<div><strong>IMEI 2:</strong> ' + wdsEsc(sale.imei2) + '</div>' : '') + hr +
            '<div><strong>Customer:</strong> ' + wdsEsc(sale.customerName) + '</div>' +
            '<div><strong>Phone:</strong> ' + wdsEsc(sale.customerPhone) + '</div>' + hr +
            '<div><strong>Price:</strong> ' + wdsMoney(sale.price) + '</div>' +
            (sale.tradeIn ? '<div><strong>Trade-in:</strong> −' + wdsMoney(sale.tradeIn.value) + '<br><span style="font-size:10px;">' + wdsEsc(sale.tradeIn.brand) + ' ' + wdsEsc(sale.tradeIn.model) + ' · ' + wdsEsc(sale.tradeIn.imei) + '</span></div>' : '') +
            (sale.tradeIn ? '<div><strong>Net Payable:</strong> ' + wdsMoney(net) + '</div>' : '') +
            '<div style="font-size:13px;"><strong>Amount Paid:</strong> ' + wdsMoney(paid) + '</div>' +
            (pays.length > 1 || (pays.length === 1 && bal > 0)
                ? '<div style="font-size:10px; color:#333;">' + pays.map(function (x) { return wdsPrettyDate(x.at) + ' — ' + wdsMoney(x.amount) + ' (' + wdsEsc(x.method) + ')'; }).join('<br>') + '</div>'
                : '<div><strong>Payment Method:</strong> ' + wdsEsc(sale.paymentMethod) + '</div>') +
            (bal > 0 ? '<div style="margin-top:4px; padding:4px; border:1px solid #991b1b; color:#991b1b; font-weight:bold;">BALANCE DUE: ' + wdsMoney(bal) + (sale.dueDate ? '<br><span style="font-size:10px;">Pay by ' + wdsPrettyDate(sale.dueDate) + '</span>' : '') + '</div>' : '') +
            '<div><strong>Sold By:</strong> ' + wdsEsc(sale.soldBy) + '</div>' +
            (wdsNum(sale.warrantyMonths) > 0 && !sale.refunded
                ? '<div style="margin-top:8px; padding:6px; background:#f0fdf4; border:1px dashed #86efac;">' +
                    '<strong>Warranty:</strong> ' + sale.warrantyMonths + ' month' + (sale.warrantyMonths === 1 ? '' : 's') + '<br>' +
                    '<strong>Starts:</strong> ' + wdsPrettyDate(sale.warrantyStart) + '<br>' +
                    '<strong>Expires:</strong> ' + wdsPrettyDate(sale.warrantyEnd) + '</div>' : '') +
            (sale.notes ? '<div style="margin-top:6px; font-style:italic;">Notes: ' + wdsEsc(sale.notes) + '</div>' : '');
        body.innerHTML = html;

        var act = wdxEl('wdx-receipt-actions');
        if (act) {
            var h = '';
            if (bal > 0) h += '<button class="menu-btn btn-action-primary" style="' + WDX_BTN + '" onclick="wdxOpenPayModal(\'' + wdsEsc(saleId) + '\',\'receipt\')">💵 Record Payment</button>';
            if (!sale.refunded && wdxCanRefund()) h += '<button class="menu-btn" style="' + WDX_BTN + ' background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdxOpenReturnModal(\'' + wdsEsc(saleId) + '\',\'receipt\')">↩️ Return / Refund</button>';
            act.innerHTML = h;
        }
    });
};

// =====================================================================
// RECORD A PAYMENT (debtors)
// =====================================================================
window.wdxOpenPayModal = function (saleId, from) {
    var s = wdxSales[saleId];
    if (!s) { alert('Sale not found.'); return; }
    var bal = wdxSaleBalance(s);
    if (bal <= 0) { alert('This sale has no balance.'); return; }
    window.__wdxFrom = from || 'debtors';

    var html =
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; font-size:13px;">' +
            '<div><strong>' + wdsEsc(s.customerName) + '</strong> · ' + wdsEsc(s.customerPhone) + '</div>' +
            '<div style="color:#64748b; font-size:12px; margin-top:4px;">' + wdsEsc(s.brand) + ' ' + wdsEsc(s.model) + ' · ' + wdsEsc(s.saleId) + '</div>' +
            '<div style="margin-top:6px;">Net ' + wdsMoney(wdxSaleNet(s)) + ' · Paid ' + wdsMoney(wdxSalePaid(s)) + ' · <strong style="color:#b91c1c;">Owes ' + wdsMoney(bal) + '</strong></div>' +
        '</div>' +
        '<label style="' + WDX_LBL + '">Amount Received (₦)</label>' +
        '<input id="wdx-p-amt" type="number" value="' + bal + '" style="' + WDX_INP + '">' +
        '<label style="' + WDX_LBL + '">Paid By</label>' +
        '<select id="wdx-p-method" style="' + WDX_INP + '"><option>Cash</option><option>Transfer</option><option>POS</option></select>' +
        wdxErrBox('wdx-p-err') +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdxConfirmPayment(\'' + wdsEsc(saleId) + '\')">Save Payment</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdxBackFrom(\'' + wdsEsc(saleId) + '\')">Cancel</button>' +
        '</div>';
    wdsModal('💵 Record Payment', html);
};

window.wdxBackFrom = function (saleId) {
    var from = window.__wdxFrom;
    wdsCloseModal();
    if (from === 'receipt') wdsShowReceipt(saleId);
    else if (from === 'history') wdsOpenSalesHistoryModal();
    else wdxOpenDebtors();
};

window.wdxConfirmPayment = async function (saleId) {
    var amt = parseFloat(wdxVal('wdx-p-amt')) || 0;
    var method = wdxVal('wdx-p-method') || 'Cash';
    if (!(amt > 0)) return wdxShowErr('wdx-p-err', 'Enter the amount received.');
    var payKey = 'p' + Date.now();
    var nowIso = wdsNow(), by = wdxUser();
    try {
        var ref = firebase.database().ref('phoneSales/' + currentStoreId + '/' + saleId);
        var res = await ref.transaction(function (cur) {
            if (!cur) return cur;
            if (cur.refunded) return;
            var bal = wdsNum(cur.balance);
            if (amt > bal + 0.001) return;
            var pays = Object.assign({}, cur.payments || {});
            pays[payKey] = { amount: amt, method: method, at: nowIso, by: by, note: 'Balance payment' };
            cur.payments = pays;
            cur.amountPaid = wdxR2(wdsNum(cur.amountPaid) + amt);
            cur.balance = Math.max(0, wdxR2(bal - amt));
            if (cur.balance === 0) cur.clearedAt = nowIso;
            return cur;
        });
        var v = res.snapshot.val();
        if (!res.committed || !v || !v.payments || !v.payments[payKey]) {
            return wdxShowErr('wdx-p-err', 'Could not save. The amount is more than the balance, or the sale was refunded.');
        }
        var from = window.__wdxFrom;
        wdsCloseModal();
        if (from === 'receipt') wdsShowReceipt(saleId);
        else if (from === 'history') wdsOpenSalesHistoryModal();
        else wdxOpenDebtors();
    } catch (e) {
        wdxShowErr('wdx-p-err', 'Could not save payment: ' + (e.message || e));
    }
};

// =====================================================================
// DEBTORS
// =====================================================================
function wdxUpdateDebtBadge() {
    var b = wdxEl('wdx-debt-badge');
    if (!b) return;
    var n = wdxSaleList().filter(function (s) { return wdxSaleBalance(s) > 0; }).length;
    var txt = n > 0 ? String(n) : '';
    if (b.textContent !== txt) b.textContent = txt;
    var disp = n > 0 ? 'inline-block' : 'none';
    if (b.style.display !== disp) b.style.display = disp;
}

window.wdxOpenDebtors = function () {
    var debtors = wdxSaleList().filter(function (s) { return wdxSaleBalance(s) > 0; });
    debtors.sort(function (a, b) {
        return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')) || String(a.soldAt).localeCompare(String(b.soldAt));
    });
    var total = debtors.reduce(function (t, s) { return t + wdxSaleBalance(s); }, 0);

    var body = debtors.length === 0
        ? '<div style="text-align:center; color:#94a3b8; padding:30px;">Nobody owes you. All paid ✅</div>'
        : debtors.map(function (s) {
            var left = s.dueDate ? wdxDaysUntil(s.dueDate) : null;
            var dueTxt = s.dueDate
                ? (left < 0 ? '<span style="color:#b91c1c; font-weight:bold;">' + Math.abs(left) + ' day' + (left === -1 ? '' : 's') + ' overdue</span>' : (left === 0 ? '<span style="color:#92400e; font-weight:bold;">Due today</span>' : 'Due in ' + left + ' day' + (left === 1 ? '' : 's')))
                : 'No due date';
            var msg = 'Hello ' + s.customerName + ', this is a friendly reminder from ' + wdxStoreName + ' about your outstanding balance of ' + wdsMoney(wdxSaleBalance(s)) + ' on the ' + s.brand + ' ' + s.model + ' (receipt ' + s.saleId + ').' + (s.dueDate ? ' Kindly complete payment by ' + wdsPrettyDate(s.dueDate) + '.' : ' Kindly complete payment at your earliest convenience.') + ' Thank you.';
            return '<div style="border:1px solid ' + (left !== null && left < 0 ? '#fecaca' : '#e2e8f0') + '; border-radius:10px; padding:12px; margin-bottom:8px;">' +
                '<div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">' +
                    '<div><div style="font-weight:bold; font-size:13px;">👤 ' + wdsEsc(s.customerName) + '</div>' +
                    '<div style="font-size:12px; color:#64748b;">' + wdsEsc(s.customerPhone) + ' · ' + wdsEsc(s.brand) + ' ' + wdsEsc(s.model) + '</div></div>' +
                    '<div style="text-align:right;"><div style="font-weight:bold; color:#b91c1c; font-size:15px;">' + wdsMoney(wdxSaleBalance(s)) + '</div><div style="font-size:11px;">' + dueTxt + '</div></div>' +
                '</div>' +
                '<div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">' +
                    '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:5px 10px; font-size:11px;" onclick="wdxOpenPayModal(\'' + wdsEsc(s._id) + '\',\'debtors\')">💵 Record Payment</button>' +
                    '<button class="menu-btn" style="width:auto; margin:0; padding:5px 10px; font-size:11px; background:#dcfce7; border:1px solid #86efac; color:#166534;" data-phone="' + wdsEsc(s.customerPhone) + '" data-msg="' + wdsEsc(msg) + '" onclick="wdxWhatsApp(this.dataset.phone, this.dataset.msg)">💬 WhatsApp</button>' +
                    '<button class="menu-btn btn-dash" style="width:auto; margin:0; padding:5px 10px; font-size:11px;" onclick="wdsViewSaleReceipt(\'' + wdsEsc(s._id) + '\')">🖨 Receipt</button>' +
                '</div></div>';
        }).join('');

    var html =
        '<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:10px 12px; margin-bottom:12px; font-size:13px;">' +
            'Total owed to you: <strong style="color:#b91c1c; font-size:16px;">' + wdsMoney(total) + '</strong> · ' + debtors.length + ' customer' + (debtors.length === 1 ? '' : 's') +
        '</div>' +
        '<div style="max-height:58vh; overflow-y:auto;">' + body + '</div>' +
        '<div style="margin-top:14px;"><button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdsCloseModal()">Close</button></div>';
    wdsModal('💵 Customers Who Owe You', html, 600);
};

// =====================================================================
// RETURN / REFUND
// =====================================================================
window.wdxOpenReturnModal = function (saleId, from) {
    if (!wdxCanRefund()) { alert('Only the Admin or Manager can process returns.'); return; }
    var s = wdxSales[saleId];
    if (!s) { alert('Sale not found.'); return; }
    if (s.refunded) { alert('This sale was already refunded.'); return; }
    window.__wdxFrom = from || 'history';

    var html =
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; font-size:13px;">' +
            '<div><strong>' + wdsEsc(s.brand) + ' ' + wdsEsc(s.model) + '</strong> · ' + wdsEsc(s.saleId) + '</div>' +
            '<div style="font-family:monospace; font-size:11px; color:#64748b;">IMEI: ' + wdsEsc(s.imei) + '</div>' +
            '<div style="margin-top:6px;">👤 ' + wdsEsc(s.customerName) + ' · Paid so far: <strong>' + wdsMoney(wdxSalePaid(s)) + '</strong></div>' +
            (s.tradeIn ? '<div style="margin-top:6px; color:#92400e; font-size:12px;">⚠ A trade-in phone (' + wdsEsc(s.tradeIn.brand) + ' ' + wdsEsc(s.tradeIn.model) + ') was taken on this sale. It stays in your stock. Hand it back or adjust the refund amount yourself.</div>' : '') +
        '</div>' +
        '<label style="' + WDX_LBL + '">Reason *</label>' +
        '<select id="wdx-r-reason" style="' + WDX_INP + '"><option>Phone has a fault</option><option>Wrong model / size</option><option>Customer changed mind</option><option>Other</option></select>' +
        '<input id="wdx-r-note" type="text" placeholder="More details (optional)" style="' + WDX_INP + ' margin-top:6px;">' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDX_LBL + '">Refund Amount (₦)</label><input id="wdx-r-amt" type="number" value="' + wdxSalePaid(s) + '" style="' + WDX_INP + '"></div>' +
            '<div><label style="' + WDX_LBL + '">Refunded By</label><select id="wdx-r-method" style="' + WDX_INP + '"><option>Cash</option><option>Transfer</option><option>Store credit</option></select></div>' +
        '</div>' +
        '<label style="' + WDX_LBL + '">What happens to the phone?</label>' +
        '<select id="wdx-r-restock" style="' + WDX_INP + '"><option value="restock">Put it back in stock (resellable)</option><option value="returned">Mark as RETURNED (faulty, not for sale)</option></select>' +
        wdxErrBox('wdx-r-err') +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn" style="flex:1; margin:0; justify-content:center; background:#dc2626; color:#fff; border:none;" onclick="wdxConfirmReturn(\'' + wdsEsc(saleId) + '\')">Confirm Return</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdxBackFrom(\'' + wdsEsc(saleId) + '\')">Cancel</button>' +
        '</div>';
    wdsModal('↩️ Return / Refund', html);
};

window.wdxConfirmReturn = async function (saleId) {
    var s = wdxSales[saleId];
    if (!s) return;
    var amt = parseFloat(wdxVal('wdx-r-amt'));
    if (isNaN(amt) || amt < 0) return wdxShowErr('wdx-r-err', 'Enter a valid refund amount (0 if nothing is refunded).');
    if (amt > wdxSalePaid(s) + 0.001) return wdxShowErr('wdx-r-err', 'Refund cannot be more than what the customer paid (' + wdsMoney(wdxSalePaid(s)) + ').');
    var reason = wdxVal('wdx-r-reason') + (wdxVal('wdx-r-note') ? ' — ' + wdxVal('wdx-r-note') : '');
    var restock = wdxVal('wdx-r-restock') === 'restock';
    var nowIso = wdsNow(), by = wdxUser();

    try {
        var db = firebase.database();
        var ref = db.ref('phoneSales/' + currentStoreId + '/' + saleId);
        var res = await ref.transaction(function (cur) {
            if (!cur) return cur;
            if (cur.refunded) return;
            cur.refunded = { at: nowIso, by: by, amount: amt, method: wdxVal('wdx-r-method'), reason: reason, restocked: restock };
            cur.balance = 0;
            return cur;
        });
        var v = res.snapshot.val();
        if (!res.committed || !v || !v.refunded) return wdxShowErr('wdx-r-err', 'Could not process. It may already be refunded.');

        // Put the phone back (only if it still exists in inventory)
        if (s.phoneId && wdvPhones && wdvPhones[s.phoneId]) {
            await db.ref('phoneInventory/' + currentStoreId + '/' + s.phoneId).update({
                status: restock ? 'in_stock' : 'returned',
                soldTo: null,
                returnedFromSale: saleId,
                returnedAt: nowIso
            });
        }
        wdsCloseModal();
        alert('✅ Return recorded.' + (restock ? ' The phone is back in stock.' : ' The phone is marked RETURNED.'));
        if (window.__wdxFrom === 'receipt') wdsShowReceipt(saleId);
        else wdsOpenSalesHistoryModal();
    } catch (e) {
        wdxShowErr('wdx-r-err', 'Could not process return: ' + (e.message || e));
    }
};

// =====================================================================
// SALES HISTORY v2 (uses live cache, shows balance / refunds)
// =====================================================================
window.wdsRenderSalesHistory = function () {
    var box = wdxEl('wds-h-body');
    if (!box) return;
    var q = wdxVal('wds-h-search').toLowerCase();

    var rows = wdxSaleList();
    rows.sort(function (a, b) { return String(b.soldAt || '').localeCompare(String(a.soldAt || '')); });
    if (q) {
        rows = rows.filter(function (s) {
            var hay = ((s.imei || '') + ' ' + (s.imei2 || '') + ' ' + (s.brand || '') + ' ' + (s.model || '') + ' ' + (s.customerName || '') + ' ' + (s.customerPhone || '') + ' ' + (s.saleId || '')).toLowerCase();
            return hay.indexOf(q) !== -1;
        });
    }
    window.wdsLastSalesCache = rows;

    if (rows.length === 0) {
        box.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:30px;">No sales found.</div>';
        return;
    }

    box.innerHTML = rows.map(function (s) {
        var bal = wdxSaleBalance(s);
        var badge = s.refunded
            ? '<span style="background:#fee2e2; color:#991b1b; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">REFUNDED</span>'
            : (bal > 0
                ? '<span style="background:#fef3c7; color:#92400e; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">OWES ' + wdsMoney(bal) + '</span>'
                : '<span style="background:#dcfce7; color:#166534; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">PAID</span>');
        return '<div style="border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:8px; ' + (s.refunded ? 'opacity:0.65;' : '') + '">' +
            '<div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start; flex-wrap:wrap;">' +
                '<div style="flex:1; min-width:200px;">' +
                    '<div style="font-weight:bold; font-size:13px;">' + wdsEsc(s.brand) + ' ' + wdsEsc(s.model) + ' ' + badge + '</div>' +
                    '<div style="font-family:monospace; font-size:11px; color:#64748b;">IMEI: ' + wdsEsc(s.imei) + '</div>' +
                    '<div style="font-size:12px; margin-top:4px;">👤 ' + wdsEsc(s.customerName) + ' · ' + wdsEsc(s.customerPhone) + '</div>' +
                    (s.tradeIn ? '<div style="font-size:11px; color:#92400e;">🔁 Trade-in: ' + wdsEsc(s.tradeIn.brand) + ' ' + wdsEsc(s.tradeIn.model) + ' (' + wdsMoney(s.tradeIn.value) + ')</div>' : '') +
                '</div>' +
                '<div style="text-align:right;">' +
                    '<div style="font-weight:bold; font-size:15px; color:#16a34a;">' + wdsMoney(s.price) + '</div>' +
                    '<div style="font-size:11px; color:#64748b;">' + wdsPrettyDate(s.soldAt) + '</div>' +
                '</div>' +
            '</div>' +
            '<div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center;">' +
                '<button class="menu-btn btn-dash" style="width:auto; margin:0; padding:5px 10px; font-size:11px;" onclick="wdsViewSaleReceipt(\'' + wdsEsc(s._id) + '\')">🖨 View Receipt</button>' +
                (bal > 0 ? '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:5px 10px; font-size:11px;" onclick="wdxOpenPayModal(\'' + wdsEsc(s._id) + '\',\'history\')">💵 Record Payment</button>' : '') +
                (!s.refunded && wdxCanRefund() ? '<button class="menu-btn" style="width:auto; margin:0; padding:5px 10px; font-size:11px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdxOpenReturnModal(\'' + wdsEsc(s._id) + '\',\'history\')">↩️ Return</button>' : '') +
                (wdxIsAdmin() && !s.refunded && wdsNum(s.profit) ? '<span style="font-size:11px; color:#64748b;">Profit: ' + wdsMoney(s.profit) + '</span>' : '') +
            '</div>' +
        '</div>';
    }).join('');
};

window.wdsExportSalesHistoryCSV = function () {
    var rows = window.wdsLastSalesCache || [];
    if (rows.length === 0) { alert('Nothing to export.'); return; }
    var admin = wdxIsAdmin();
    var headers = ['Receipt ID', 'Date', 'Brand', 'Model', 'Storage', 'Color', 'IMEI', 'IMEI 2', 'Customer', 'Customer Phone', 'Price', 'Trade-in', 'Net Payable', 'Paid', 'Balance', 'Due Date', 'Payment', 'Warranty (m)', 'Sold By', 'Refunded'];
    if (admin) headers.push('Cost', 'Profit');
    var csv = [headers.join(',')].concat(rows.map(function (s) {
        var cols = [
            s.saleId, s.soldAt, s.brand, s.model, s.storage, s.color, s.imei, s.imei2 || '',
            s.customerName, s.customerPhone, s.price, s.tradeIn ? s.tradeIn.value : 0,
            wdxSaleNet(s), wdxSalePaid(s), wdxSaleBalance(s), s.dueDate || '',
            s.paymentMethod, s.warrantyMonths || 0, s.soldBy,
            s.refunded ? ('Yes - ' + wdsNum(s.refunded.amount)) : ''
        ];
        if (admin) cols.push(s.costPrice, s.refunded ? 0 : s.profit);
        return cols.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    })).join('\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'phone-sales-' + wdsToday() + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
};

// =====================================================================
// PHONE REPORTS (day summary / week / month / all)
// =====================================================================
function wdxRange(period) {
    var t = wdsToday();
    if (period === 'today') return [t, t, 'Today'];
    if (period === 'week') return [wdxPlusDays(-6), t, 'Last 7 days'];
    if (period === 'month') return [t.substring(0, 7) + '-01', t, 'This month'];
    return ['0000-00-00', '9999-99-99', 'All time'];
}

function wdxBuildReport(period) {
    var r = wdxRange(period), from = r[0], to = r[1];
    var inP = function (iso) { var d = wdxLocalDate(iso); return d && d >= from && d <= to; };
    var all = wdxSaleList();
    var sold = all.filter(function (s) { return !s.refunded && inP(s.soldAt); });

    var rep = { label: r[2], units: sold.length, value: 0, profit: 0, collected: 0, byMethod: {}, refunds: 0, refundCount: 0, outstanding: 0, owing: 0, brands: {}, models: {}, staff: {} };
    sold.forEach(function (s) {
        rep.value += wdsNum(s.price);
        rep.profit += wdsNum(s.profit);
        var b = rep.brands[s.brand || 'Other'] = rep.brands[s.brand || 'Other'] || { n: 0, v: 0 }; b.n++; b.v += wdsNum(s.price);
        var mk = (s.brand || '') + ' ' + (s.model || ''); var m = rep.models[mk] = rep.models[mk] || { n: 0, v: 0 }; m.n++; m.v += wdsNum(s.price);
        var st = rep.staff[s.soldBy || '—'] = rep.staff[s.soldBy || '—'] || { n: 0, v: 0 }; st.n++; st.v += wdsNum(s.price);
    });
    all.forEach(function (s) {
        wdxPayments(s).forEach(function (pm) {
            if (inP(pm.at)) {
                rep.collected += wdsNum(pm.amount);
                rep.byMethod[pm.method || 'Cash'] = (rep.byMethod[pm.method || 'Cash'] || 0) + wdsNum(pm.amount);
            }
        });
        if (s.refunded && inP(s.refunded.at)) { rep.refunds += wdsNum(s.refunded.amount); rep.refundCount++; }
        var bal = wdxSaleBalance(s);
        if (bal > 0) { rep.outstanding += bal; rep.owing++; }
    });
    return rep;
}

function wdxReportText(rep) {
    var lines = [
        '📱 ' + wdxStoreName + ' — Phone Report (' + rep.label + ')',
        'Units sold: ' + rep.units,
        'Sales value: ' + wdsMoney(rep.value),
        'Money received: ' + wdsMoney(rep.collected) + Object.keys(rep.byMethod).map(function (k, i) { return (i === 0 ? ' (' : '') + k + ' ' + wdsMoney(rep.byMethod[k]); }).join(', ') + (Object.keys(rep.byMethod).length ? ')' : ''),
        'Refunds: ' + wdsMoney(rep.refunds) + ' (' + rep.refundCount + ')',
        'Net cash in: ' + wdsMoney(rep.collected - rep.refunds),
        'Still owed by customers: ' + wdsMoney(rep.outstanding) + ' (' + rep.owing + ')'
    ];
    if (wdxIsAdmin()) lines.splice(3, 0, 'Profit: ' + wdsMoney(rep.profit));
    return lines.join('\n');
}

window.wdxOpenReports = function () {
    var html =
        '<select id="wdx-rep-period" onchange="wdxRenderReports()" style="' + WDX_INP + '">' +
            '<option value="today">Today</option><option value="week">Last 7 days</option><option value="month">This month</option><option value="all">All time</option>' +
        '</select>' +
        '<div id="wdx-rep-body" style="max-height:58vh; overflow-y:auto; margin-top:12px;"></div>' +
        '<div style="display:flex; gap:10px; margin-top:14px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdxCopyReport()">📋 Copy Summary (WhatsApp)</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdsCloseModal()">Close</button>' +
        '</div>';
    wdsModal('📈 Phone Reports', html, 600);
    wdxRenderReports();
};

window.wdxRenderReports = function () {
    var box = wdxEl('wdx-rep-body');
    if (!box) return;
    var rep = wdxBuildReport(wdxVal('wdx-rep-period') || 'today');
    var card = function (label, val, bg, fg) {
        return '<div style="background:' + bg + '; border-radius:10px; padding:10px;"><div style="font-size:10px; font-weight:bold; text-transform:uppercase; color:' + fg + ';">' + label + '</div><div style="font-size:17px; font-weight:bold; color:' + fg + '; margin-top:4px;">' + val + '</div></div>';
    };
    var table = function (title, obj, limit) {
        var keys = Object.keys(obj).sort(function (a, b) { return obj[b].v - obj[a].v; }).slice(0, limit || 99);
        if (!keys.length) return '';
        return '<div style="margin-top:14px;"><div style="font-size:12px; font-weight:bold; color:#334155; margin-bottom:6px;">' + title + '</div>' +
            keys.map(function (k) {
                return '<div style="display:flex; justify-content:space-between; font-size:12px; padding:5px 0; border-bottom:1px solid #f1f5f9;"><span>' + wdsEsc(k) + ' <span style="color:#94a3b8;">×' + obj[k].n + '</span></span><strong>' + wdsMoney(obj[k].v) + '</strong></div>';
            }).join('') + '</div>';
    };
    var methods = Object.keys(rep.byMethod).map(function (k) {
        return '<div style="display:flex; justify-content:space-between; font-size:12px; padding:5px 0; border-bottom:1px solid #f1f5f9;"><span>' + wdsEsc(k) + '</span><strong>' + wdsMoney(rep.byMethod[k]) + '</strong></div>';
    }).join('');

    box.innerHTML =
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">' +
            card('Units Sold', rep.units, '#eff6ff', '#1d4ed8') +
            card('Sales Value', wdsMoney(rep.value), '#ecfdf5', '#065f46') +
            card('Money Received', wdsMoney(rep.collected), '#f0fdf4', '#166534') +
            (wdxIsAdmin() ? card('Profit', wdsMoney(rep.profit), '#fefce8', '#854d0e') : card('Refunds', wdsMoney(rep.refunds), '#fef2f2', '#991b1b')) +
            (wdxIsAdmin() ? card('Refunds', wdsMoney(rep.refunds) + ' (' + rep.refundCount + ')', '#fef2f2', '#991b1b') : '') +
            card('Still Owed (all time)', wdsMoney(rep.outstanding) + ' (' + rep.owing + ')', '#fff7ed', '#9a3412') +
        '</div>' +
        (methods ? '<div style="margin-top:14px;"><div style="font-size:12px; font-weight:bold; color:#334155; margin-bottom:6px;">Money received by method</div>' + methods + '</div>' : '') +
        table('By brand', rep.brands) + table('Top models', rep.models, 5) + table('By staff', rep.staff);
};

window.wdxCopyReport = function () {
    var rep = wdxBuildReport(wdxVal('wdx-rep-period') || 'today');
    var text = wdxReportText(rep);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { alert('Copied. Paste it in WhatsApp.'); }, function () { prompt('Copy this:', text); });
    } else { prompt('Copy this:', text); }
};

// =====================================================================
// WARRANTY LOOKUP
// =====================================================================
window.wdxOpenWarranty = function () {
    var html =
        '<input id="wdx-w-q" type="text" placeholder="🔍 IMEI, customer name or phone number..." oninput="wdxRenderWarranty()" style="' + WDX_INP + '">' +
        '<div id="wdx-w-body" style="margin-top:12px; max-height:56vh; overflow-y:auto;"><div style="text-align:center; color:#94a3b8; padding:24px; font-size:13px;">Type at least 4 characters.</div></div>' +
        '<div style="margin-top:14px;"><button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdsCloseModal()">Close</button></div>';
    wdsModal('🛡 Warranty Check', html, 560);
    setTimeout(function () { var i = wdxEl('wdx-w-q'); if (i) i.focus(); }, 100);
};

window.wdxRenderWarranty = function () {
    var box = wdxEl('wdx-w-body');
    if (!box) return;
    var q = wdxVal('wdx-w-q').toLowerCase();
    if (q.length < 4) { box.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:24px; font-size:13px;">Type at least 4 characters.</div>'; return; }

    var hits = wdxSaleList().filter(function (s) {
        return ((s.imei || '') + ' ' + (s.imei2 || '') + ' ' + (s.customerName || '') + ' ' + (s.customerPhone || '')).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return String(b.soldAt).localeCompare(String(a.soldAt)); });

    if (!hits.length) {
        var phones = (typeof wdvPhones !== 'undefined') ? wdvPhones : {};
        var inStock = Object.keys(phones).map(function (id) { return phones[id]; }).filter(function (p) {
            return p.status === 'in_stock' && ((p.imei || '') + ' ' + (p.imei2 || '')).indexOf(q) !== -1;
        });
        box.innerHTML = inStock.length
            ? '<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:12px; font-size:13px;">This phone (' + wdsEsc(inStock[0].brand) + ' ' + wdsEsc(inStock[0].model) + ') is still <strong>in your stock</strong> — it was not sold by this shop.</div>'
            : '<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:12px; font-size:13px; color:#991b1b;">No sale found. This phone was not sold through this shop.</div>';
        return;
    }

    box.innerHTML = hits.slice(0, 20).map(function (s) {
        var st;
        if (s.refunded) st = ['#fee2e2', '#991b1b', 'REFUNDED — warranty void'];
        else if (!s.warrantyEnd || !wdsNum(s.warrantyMonths)) st = ['#f1f5f9', '#475569', 'NO WARRANTY'];
        else {
            var left = wdxDaysUntil(s.warrantyEnd);
            st = left >= 0 ? ['#dcfce7', '#166534', 'ACTIVE — ' + left + ' day' + (left === 1 ? '' : 's') + ' left'] : ['#fee2e2', '#991b1b', 'EXPIRED ' + Math.abs(left) + ' day' + (left === -1 ? '' : 's') + ' ago'];
        }
        return '<div style="border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:8px;">' +
            '<div style="background:' + st[0] + '; color:' + st[1] + '; font-weight:bold; font-size:13px; text-align:center; padding:6px; border-radius:8px; margin-bottom:8px;">' + st[2] + '</div>' +
            '<div style="font-weight:bold; font-size:13px;">' + wdsEsc(s.brand) + ' ' + wdsEsc(s.model) + '</div>' +
            '<div style="font-family:monospace; font-size:11px; color:#64748b;">IMEI: ' + wdsEsc(s.imei) + '</div>' +
            '<div style="font-size:12px; margin-top:4px;">👤 ' + wdsEsc(s.customerName) + ' · ' + wdsEsc(s.customerPhone) + '</div>' +
            '<div style="font-size:12px; color:#64748b;">Sold ' + wdsPrettyDate(s.soldAt) + (s.warrantyEnd ? ' · warranty ends ' + wdsPrettyDate(s.warrantyEnd) : '') + '</div>' +
            '<button class="menu-btn btn-dash" style="width:auto; margin:8px 0 0; padding:5px 10px; font-size:11px;" onclick="wdsViewSaleReceipt(\'' + wdsEsc(s._id) + '\')">🖨 View Receipt</button>' +
        '</div>';
    }).join('');
};

// =====================================================================
// REPAIRS
// =====================================================================
var WDX_REPAIR_STATUS = ['Received', 'In Progress', 'Ready', 'Collected', 'Unrepairable'];
var WDX_REPAIR_COLORS = { 'Received': ['#e0e7ff', '#3730a3'], 'In Progress': ['#fef3c7', '#92400e'], 'Ready': ['#dcfce7', '#166534'], 'Collected': ['#f1f5f9', '#475569'], 'Unrepairable': ['#fee2e2', '#991b1b'] };

window.wdxOpenRepairs = async function () {
    var html =
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            '<input id="wdx-rp-q" type="text" placeholder="🔍 Customer, phone or device..." oninput="wdxRenderRepairs()" style="flex:1; min-width:160px; ' + WDX_INP + '">' +
            '<select id="wdx-rp-f" onchange="wdxRenderRepairs()" style="width:auto; ' + WDX_INP + '"><option value="open">Open jobs</option><option value="">All</option>' + WDX_REPAIR_STATUS.map(function (x) { return '<option>' + x + '</option>'; }).join('') + '</select>' +
        '</div>' +
        '<div id="wdx-rp-sum" style="font-size:12px; color:#64748b; margin-top:8px;"></div>' +
        '<div id="wdx-rp-body" style="max-height:52vh; overflow-y:auto; margin-top:8px;"><div style="text-align:center; color:#94a3b8; padding:24px;">Loading...</div></div>' +
        '<div style="display:flex; gap:10px; margin-top:14px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdxOpenRepairForm()">+ New Repair</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdsCloseModal()">Close</button>' +
        '</div>';
    wdsModal('🔧 Repairs', html, 620);
    await wdxLoadRepairs();
    wdxRenderRepairs();
};

window.__wdxRepairs = {};
async function wdxLoadRepairs() {
    try {
        var snap = await firebase.database().ref('phoneRepairs/' + currentStoreId).once('value');
        window.__wdxRepairs = snap.val() || {};
    } catch (e) { window.__wdxRepairs = {}; }
}

window.wdxRenderRepairs = function () {
    var box = wdxEl('wdx-rp-body');
    if (!box) return;
    var q = wdxVal('wdx-rp-q').toLowerCase(), f = wdxVal('wdx-rp-f');
    var all = Object.keys(window.__wdxRepairs).map(function (k) { return Object.assign({ _id: k }, window.__wdxRepairs[k]); });
    var open = all.filter(function (r) { return r.status !== 'Collected' && r.status !== 'Unrepairable'; });
    var owed = all.reduce(function (t, r) { return t + (r.status === 'Unrepairable' ? 0 : wdsNum(r.balance)); }, 0);
    var sum = wdxEl('wdx-rp-sum');
    if (sum) sum.textContent = open.length + ' open job' + (open.length === 1 ? '' : 's') + ' · Balances still owed on repairs: ' + wdsMoney(owed);

    var rows = all.filter(function (r) {
        if (f === 'open') { if (r.status === 'Collected' || r.status === 'Unrepairable') return false; }
        else if (f && r.status !== f) return false;
        if (q) {
            var hay = ((r.customerName || '') + ' ' + (r.customerPhone || '') + ' ' + (r.device || '') + ' ' + (r.imei || '') + ' ' + (r.fault || '')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    }).sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });

    if (!rows.length) { box.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:24px;">No repair jobs here.</div>'; return; }

    box.innerHTML = rows.map(function (r) {
        var c = WDX_REPAIR_COLORS[r.status] || ['#e2e8f0', '#334155'];
        var bal = wdsNum(r.balance);
        var msg = 'Hello ' + r.customerName + ', your ' + r.device + ' is ready for pickup at ' + wdxStoreName + '.' + (bal > 0 ? ' Balance to pay: ' + wdsMoney(bal) + '.' : '') + ' Thank you.';
        return '<div style="border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">' +
                '<div><div style="font-weight:bold; font-size:13px;">' + wdsEsc(r.device) + '</div>' +
                '<div style="font-size:12px; color:#64748b;">👤 ' + wdsEsc(r.customerName) + ' · ' + wdsEsc(r.customerPhone) + '</div>' +
                '<div style="font-size:12px; margin-top:4px;">🔧 ' + wdsEsc(r.fault) + '</div>' +
                (r.imei ? '<div style="font-family:monospace; font-size:11px; color:#64748b;">IMEI: ' + wdsEsc(r.imei) + '</div>' : '') + '</div>' +
                '<div style="text-align:right;"><div style="font-weight:bold;">' + wdsMoney(r.charge) + '</div>' +
                '<div style="font-size:11px; color:' + (bal > 0 ? '#b91c1c' : '#166534') + ';">' + (bal > 0 ? 'Owes ' + wdsMoney(bal) : 'Paid') + '</div>' +
                '<div style="font-size:10px; color:#94a3b8;">' + wdsPrettyDate(r.createdAt) + '</div></div>' +
            '</div>' +
            '<div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center;">' +
                '<select onchange="wdxSetRepairStatus(\'' + wdsEsc(r._id) + '\', this.value)" style="padding:5px 8px; border-radius:8px; border:1px solid #cbd5e1; font-size:11px; font-weight:bold; background:' + c[0] + '; color:' + c[1] + ';">' +
                    wdxOpts(WDX_REPAIR_STATUS, r.status) + '</select>' +
                '<button class="menu-btn" style="width:auto; margin:0; padding:5px 10px; font-size:11px; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdxEditRepairCharge(\'' + wdsEsc(r._id) + '\')">💲 Charge / Payment</button>' +
                (r.status === 'Ready' ? '<button class="menu-btn" style="width:auto; margin:0; padding:5px 10px; font-size:11px; background:#dcfce7; border:1px solid #86efac; color:#166534;" data-phone="' + wdsEsc(r.customerPhone) + '" data-msg="' + wdsEsc(msg) + '" onclick="wdxWhatsApp(this.dataset.phone, this.dataset.msg)">💬 Tell customer</button>' : '') +
            '</div></div>';
    }).join('');
};

window.wdxOpenRepairForm = function () {
    var html =
        '<label style="' + WDX_LBL + '">Customer Name *</label><input id="wdx-rf-name" type="text" style="' + WDX_INP + '">' +
        '<label style="' + WDX_LBL + '">Customer Phone *</label><input id="wdx-rf-phone" type="text" placeholder="e.g. 08012345678" style="' + WDX_INP + '">' +
        '<label style="' + WDX_LBL + '">Device *</label><input id="wdx-rf-device" type="text" placeholder="e.g. Samsung A12" style="' + WDX_INP + '">' +
        '<label style="' + WDX_LBL + '">IMEI (optional)</label><input id="wdx-rf-imei" type="text" style="' + WDX_INP + ' font-family:monospace;">' +
        '<label style="' + WDX_LBL + '">Fault *</label><textarea id="wdx-rf-fault" rows="2" placeholder="e.g. Cracked screen, not charging" style="' + WDX_INP + '"></textarea>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDX_LBL + '">Repair Charge (₦)</label><input id="wdx-rf-charge" type="number" style="' + WDX_INP + '"></div>' +
            '<div><label style="' + WDX_LBL + '">Deposit Paid (₦)</label><input id="wdx-rf-dep" type="number" placeholder="0" style="' + WDX_INP + '"></div>' +
        '</div>' +
        wdxErrBox('wdx-rf-err') +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdxSaveRepair()">Save Repair Job</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdxOpenRepairs()">Back</button>' +
        '</div>';
    wdsModal('🔧 New Repair Job', html);
};

window.wdxSaveRepair = async function () {
    var name = wdxVal('wdx-rf-name'), phone = wdxVal('wdx-rf-phone'), device = wdxVal('wdx-rf-device');
    var fault = wdxVal('wdx-rf-fault'), imei = wdxVal('wdx-rf-imei');
    var charge = parseFloat(wdxVal('wdx-rf-charge')) || 0, dep = parseFloat(wdxVal('wdx-rf-dep')) || 0;
    if (!name || !phone || !device || !fault) return wdxShowErr('wdx-rf-err', 'Customer name, phone, device and fault are required.');
    if (dep < 0 || dep > charge) return wdxShowErr('wdx-rf-err', 'Deposit cannot be more than the repair charge.');
    try {
        var db = firebase.database();
        var ref = db.ref('phoneRepairs/' + currentStoreId).push();
        await ref.set({
            customerName: name, customerPhone: phone, device: device, imei: imei, fault: fault,
            charge: charge, amountPaid: dep, balance: wdxR2(charge - dep),
            status: 'Received', createdAt: wdsNow(), createdBy: wdxUser(), updatedAt: wdsNow()
        });
        wdxOpenRepairs();
    } catch (e) { wdxShowErr('wdx-rf-err', 'Could not save: ' + (e.message || e)); }
};

window.wdxSetRepairStatus = async function (id, status) {
    var r = window.__wdxRepairs[id];
    if (!r) return;
    var upd = { status: status, updatedAt: wdsNow() };
    if (status === 'Collected' && wdsNum(r.balance) > 0) {
        if (confirm('Has the customer paid the remaining ' + wdsMoney(r.balance) + '?\n\nOK = Yes, mark as paid\nCancel = No, keep the job open')) {
            upd.amountPaid = wdsNum(r.charge); upd.balance = 0;
        } else { wdxRenderRepairs(); return; }
    }
    try {
        await firebase.database().ref('phoneRepairs/' + currentStoreId + '/' + id).update(upd);
        await wdxLoadRepairs();
        wdxRenderRepairs();
    } catch (e) { alert('Could not update: ' + (e.message || e)); }
};

window.wdxEditRepairCharge = async function (id) {
    var r = window.__wdxRepairs[id];
    if (!r) return;
    var c = prompt('Total repair charge (₦):', wdsNum(r.charge));
    if (c === null) return;
    var charge = parseFloat(c);
    if (isNaN(charge) || charge < 0) { alert('Enter a valid amount.'); return; }
    var p = prompt('Total amount paid so far (₦):', wdsNum(r.amountPaid));
    if (p === null) return;
    var paid = parseFloat(p);
    if (isNaN(paid) || paid < 0 || paid > charge) { alert('Amount paid must be between 0 and the charge.'); return; }
    try {
        await firebase.database().ref('phoneRepairs/' + currentStoreId + '/' + id).update({
            charge: charge, amountPaid: paid, balance: wdxR2(charge - paid), updatedAt: wdsNow()
        });
        await wdxLoadRepairs();
        wdxRenderRepairs();
    } catch (e) { alert('Could not update: ' + (e.message || e)); }
};

// =====================================================================
// TOOLS PANEL + PERMISSIONS + MAIN ATTACH
// =====================================================================
function wdxEnsureStyle() {
    if (wdxEl('wdx-style')) return;
    var s = document.createElement('style');
    s.id = 'wdx-style';
    s.textContent = '.wdx-nocost th:nth-child(5), .wdx-nocost td:nth-child(5), .wdx-nocost th:nth-child(7), .wdx-nocost td:nth-child(7) { display:none !important; }';
    document.head.appendChild(s);
}

function wdxInjectToolsPanel() {
    if (wdxEl('wdx-tools-panel')) return;
    var anchor = wdxEl('wds-stock-panel') || wdxEl('wdv-summary-cards');
    if (!anchor) return;

    var panel = document.createElement('div');
    panel.id = 'wdx-tools-panel';
    panel.style.cssText = 'background:#fff; border:1px solid #eef2f7; border-radius:12px; padding:14px; margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; box-shadow:0 6px 18px rgba(15,23,42,0.04);';
    var b = function (label, fn, style) {
        return '<button class="menu-btn" style="' + WDX_BTN + ' ' + style + '" onclick="' + fn + '">' + label + '</button>';
    };
    panel.innerHTML =
        '<span style="font-weight:bold; font-size:13px; color:#0f172a; margin-right:6px;">🧰 Tools:</span>' +
        b('💵 Debtors <span id="wdx-debt-badge" style="display:none; background:#dc2626; color:#fff; border-radius:10px; padding:1px 7px; font-size:10px; margin-left:4px;"></span>', 'wdxOpenDebtors()', 'background:#fef2f2; border:1px solid #fecaca; color:#991b1b;') +
        b('📈 Reports', 'wdxOpenReports()', 'background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46;') +
        b('🛡 Warranty Check', 'wdxOpenWarranty()', 'background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8;') +
        b('🔧 Repairs', 'wdxOpenRepairs()', 'background:#fff7ed; border:1px solid #fed7aa; color:#9a3412;');
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);
    wdxUpdateDebtBadge();
}

function wdxFixStatusFilter() {
    var sel = wdxEl('wdv-filter-status');
    if (!sel) return;
    var has = false;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === 'missing') has = true;
    if (!has) {
        var o = document.createElement('option');
        o.value = 'missing'; o.textContent = 'Missing';
        sel.appendChild(o);
    }
}

function wdxHide(sel, hide) {
    document.querySelectorAll(sel).forEach(function (b) {
        var v = hide ? 'none' : '';
        if (b.style.display !== v) b.style.display = v;
    });
}

function wdxApplyPermissions() {
    var admin = wdxIsAdmin(), stock = wdxCanManageStock();
    var tbody = wdxEl('wdv-table-body');
    if (tbody) {
        var t = tbody.closest('table');
        if (t && t.classList.contains('wdx-nocost') === admin) t.classList.toggle('wdx-nocost', !admin);
    }
    wdxHide('#wdv-table-body .menu-btn[onclick*="wdvEditPhone"], #wdv-table-body .menu-btn[onclick*="wdvDeletePhone"]', !admin);
    wdxHide('#workspace-content .menu-btn[onclick*="wdvOpenAddPhoneModal"], #workspace-content .menu-btn[onclick*="wdvOpenBulkModal"]', !stock);
    wdxHide('#wds-stock-panel .menu-btn[onclick*="wdsOpenAdjustStockModal"], #wds-stock-panel .menu-btn[onclick*="wdsOpenMissingPhonesModal"]', !stock);
    ['wdv-card-profit-today', 'wdv-card-profit-month', 'wdv-card-capital'].forEach(function (id) {
        var e = wdxEl(id);
        if (e && e.parentElement) { var v = admin ? '' : 'none'; if (e.parentElement.style.display !== v) e.parentElement.style.display = v; }
    });
}

function wdxAttach() {
    if (!wdxEl('wdv-table-body')) return;
    wdxWatchSales();
    wdxCacheStoreName();
    wdxEnsureStyle();
    wdxInjectToolsPanel();
    wdxFixStatusFilter();
    wdxApplyPermissions();
}

var wdxTimer = null;
function wdxSchedule() {
    if (wdxTimer) return;
    wdxTimer = setTimeout(function () {
        wdxTimer = null;
        try { wdxAttach(); } catch (e) { console.warn('[phone-extras]', e); }
    }, 120);
}

window.addEventListener('load', function () {
    setTimeout(function () { try { wdxAttach(); if (typeof wdvApplySidebar === 'function') wdvApplySidebar(); } catch (e) { console.warn(e); } }, 1000);
    var obs = new MutationObserver(wdxSchedule);
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
});
