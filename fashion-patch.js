// ==================== WISE DECISION FASHION / BOUTIQUE PATCH (v1.1) ====================
// Load AFTER phone-extras-patch.js (and after staff-sidebar-patch.js).
//
// For stores whose storeType is 'fashion' (chosen at registration or set by Super Admin).
// Adds a "👗 Fashion Sales" sidebar button with:
//   • Stock by SIZE + COLOR (clothes, shoes, bags, sunglasses, underwear, chains)
//   • Multi-item selling (cart), editable price per line, discount
//   • Part payment + customer debts (WhatsApp reminder)
//   • Returns and exchanges (with exchange credit)
//   • Receipts, sales history, reports, restock list, stock log
//
// Nothing existing is touched. New data lives here:
//   fashionItems/{storeId}/{itemId}/variants/{variantId} = { size, color, qty }
//   fashionSales/{storeId}/{saleId}
//   fashionCounters/{storeId}/lastSaleNumber
//   fashionStockLog/{storeId}/{logId}
//
// Roles (UI only until the Firebase rules are locked):
//   Admin   : everything, sees cost + profit
//   Manager : sell, add/edit stock, returns, reports (no cost/profit, no delete)
//   Others  : sell, record payments, view stock (no cost/profit)

console.log("Wise Decision fashion-patch.js — v1.1 loaded");

// ----- Settings you may want to change -----
var WDF_RETURN_POLICY = 'Goods can be exchanged within 7 days with this receipt, unworn and with tags. No cash refunds.';
var WDF_LOW_STOCK = 3;   // an item is "LOW" when total units are this number or fewer

var WDF_CATEGORIES = [
    { id: 'Clothes',          icon: '👗', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Free size'] },
    { id: 'Shoes',            icon: '👟', sizes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] },
    { id: 'Bags',             icon: '👜', sizes: ['One size', 'Small', 'Medium', 'Large'] },
    { id: 'Sunglasses',       icon: '🕶️', sizes: ['One size'] },
    { id: 'Underwear',        icon: '🩲', sizes: ['S', 'M', 'L', 'XL', 'XXL', 'Free size'] },
    { id: 'Chains & Jewelry', icon: '⛓️', sizes: ['16"', '18"', '20"', '22"', '24"', '26"'] },
    { id: 'Other',            icon: '🏷️', sizes: ['One size'] }
];
var WDF_COLORS = ['Black', 'White', 'Red', 'Blue', 'Navy', 'Green', 'Yellow', 'Pink', 'Purple', 'Brown', 'Grey', 'Cream', 'Orange', 'Gold', 'Silver', 'Multi'];

// =====================================================================
// HELPERS
// =====================================================================
function wdfEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function wdfNum(n) { return Number(n) || 0; }
function wdfR2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function wdfMoney(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + (Number(n) || 0).toLocaleString()); }
function wdfPad(n) { return String(n).padStart(2, '0'); }
function wdfToday() { var d = new Date(); return d.getFullYear() + '-' + wdfPad(d.getMonth() + 1) + '-' + wdfPad(d.getDate()); }
function wdfNow() { return new Date().toISOString(); }
function wdfLocalDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + wdfPad(d.getMonth() + 1) + '-' + wdfPad(d.getDate());
}
function wdfPlusDays(n) {
    var d = new Date(); d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + wdfPad(d.getMonth() + 1) + '-' + wdfPad(d.getDate());
}
function wdfDaysUntil(ds) {
    var a = new Date(wdfToday() + 'T00:00:00'), b = new Date(ds + 'T00:00:00');
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.round((b - a) / 86400000);
}
function wdfPretty(s) {
    var d = new Date(s);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
// Note: This is Nigeria-specific (234). If expanding, use a library like libphonenumber-js.
function wdfIntl(p) {
    var d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '0') return '234' + d.slice(1);
    if (d.length === 10) return '234' + d;
    return d;
}
window.wdfWhatsApp = function (phone, msg) {
    var n = wdfIntl(phone);
    if (!n) { alert('No valid phone number.'); return; }
    window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(msg), '_blank');
};
function wdfEl(id) { return document.getElementById(id); }
function wdfVal(id) { var e = wdfEl(id); return e ? String(e.value || '').trim() : ''; }
function wdfIsAdmin() { return typeof currentUserRole !== 'undefined' && currentUserRole === 'Admin'; }
function wdfIsManager() { return typeof currentUserRole !== 'undefined' && currentUserRole === 'Manager'; }
function wdfCanManage() { return wdfIsAdmin() || wdfIsManager(); }
function wdfUser() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
function wdfCat(id) {
    for (var i = 0; i < WDF_CATEGORIES.length; i++) if (WDF_CATEGORIES[i].id === id) return WDF_CATEGORIES[i];
    return WDF_CATEGORIES[WDF_CATEGORIES.length - 1];
}

var WDF_INP = 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;';
var WDF_LBL = 'display:block; font-size:11px; font-weight:bold; color:#334155; margin-bottom:4px; margin-top:10px; text-transform:uppercase; letter-spacing:0.5px;';
var WDF_BTN = 'width:auto; margin:0; padding:8px 14px; font-weight:bold; font-size:12px;';
var WDF_SBTN = 'width:auto; margin:0; padding:5px 10px; font-size:11px;';

function wdfErrBox(id) {
    return '<div id="' + id + '" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>';
}
function wdfShowErr(id, msg) { var e = wdfEl(id); if (e) { e.textContent = msg; e.style.display = 'block'; } }
function wdfOpts(arr, sel) {
    return arr.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + wdfEsc(x) + '</option>'; }).join('');
}

function wdfModal(title, html, width) {
    var m = wdfEl('wdf-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdf-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1700; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML =
        '<div style="background:#fff; color:#0f172a; border-radius:14px; width:100%; max-width:' + (width || 520) + 'px; max-height:94vh; overflow-y:auto; padding:20px; box-sizing:border-box;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:8px;">' +
            '<h3 style="margin:0; font-size:17px;">' + wdfEsc(title) + '</h3>' +
            '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdfCloseModal()">✕</button>' +
          '</div>' + html +
        '</div>';
    m.style.display = 'flex';
}
window.wdfCloseModal = function () { var m = wdfEl('wdf-modal'); if (m) m.style.display = 'none'; };

// =====================================================================
// STATE + LIVE DATA (only loaded for fashion stores)
// =====================================================================
var wdfItems = {}, wdfSales = {};
var wdfStoreType = null, wdfWatchedStore = null, wdfTypeRef = null;
var wdfDataRefs = [], wdfDataOn = false;
var wdfCart = [], wdfDiscount = 0, wdfExchange = null;

function wdfStartData() {
    if (wdfDataOn) return;
    wdfDataOn = true;
    var db = firebase.database(), id = currentStoreId;
    var r1 = db.ref('fashionItems/' + id), r2 = db.ref('fashionSales/' + id);
    r1.on('value', function (s) { wdfItems = s.val() || {}; wdfRefresh(); }, function () {});
    r2.on('value', function (s) { wdfSales = s.val() || {}; wdfRefresh(); }, function () {});
    wdfDataRefs = [r1, r2];
}
function wdfStopData() {
    wdfDataRefs.forEach(function (r) { try { r.off(); } catch (e) {} });
    wdfDataRefs = []; wdfDataOn = false; wdfItems = {}; wdfSales = {};
}

function wdfWatch() {
    if (typeof currentStoreId === 'undefined' || !currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
    if (wdfWatchedStore === currentStoreId) return;
    if (wdfTypeRef) { try { wdfTypeRef.off(); } catch (e) {} }
    wdfStopData();
    wdfWatchedStore = currentStoreId;
    wdfStoreType = null; wdfCart = []; wdfDiscount = 0; wdfExchange = null;
    wdfTypeRef = firebase.database().ref('stores/' + currentStoreId + '/storeType');
    wdfTypeRef.on('value', function (snap) {
        wdfStoreType = snap.val() || 'general';
        if (wdfStoreType === 'fashion') wdfStartData(); else wdfStopData();
        wdfApplySidebar();
    }, function () {});
}

function wdfRefresh() {
    try {
        if (wdfEl('wdf-cards')) wdfRenderCards();
        if (wdfEl('wdf-stock-body')) window.wdfRenderStock();
        if (wdfEl('wdf-sell-results')) window.wdfRenderSellResults();
        if (wdfEl('wdf-h-body')) window.wdfRenderHistory();
        wdfUpdateDebtBadge();
    } catch (e) { console.warn('[fashion]', e); }
}

// =====================================================================
// SIDEBAR
// =====================================================================
function wdfApplySidebar() {
    var side = document.querySelector('#dashboard-main-wrapper .sidebar');
    if (!side) return;
    var btn = wdfEl('wdf-sidebar-btn');
    var show = wdfStoreType === 'fashion' && typeof currentStoreId !== 'undefined' && currentStoreId && currentStoreId !== 'SUPER_ADMIN';
    if (show) {
        if (!btn) {
            var b = document.createElement('button');
            b.id = 'wdf-sidebar-btn';
            b.className = 'menu-btn btn-phone';
            b.textContent = '👗 Fashion Sales';
            b.onclick = function () { wdfShowStock(); };
            var dashBtn = null;
            side.querySelectorAll('button').forEach(function (x) { if ((x.textContent || '').indexOf('Dashboard') !== -1 && !dashBtn) dashBtn = x; });
            if (dashBtn && dashBtn.nextSibling) side.insertBefore(b, dashBtn.nextSibling);
            else side.appendChild(b);
        }
    } else if (btn) {
        btn.remove();
    }
}

// =====================================================================
// SALE MATHS (everything is derived, so returns stay consistent)
// =====================================================================
function wdfLines(s) {
    var it = s.items || {};
    return Object.keys(it).map(function (k) { return Object.assign({ _i: k }, it[k]); });
}
function wdfKept(l) { return Math.max(0, wdfNum(l.qty) - wdfNum(l.returnedQty)); }
function wdfSubtotal(s) { return wdfLines(s).reduce(function (t, l) { return t + wdfNum(l.unitPrice) * wdfNum(l.qty); }, 0); }
function wdfRatio(s) { var sub = wdfSubtotal(s); return sub > 0 ? wdfNum(s.discount) / sub : 0; }
function wdfGoods(s) {   // value of goods the customer still keeps (after discount + returns)
    var kept = wdfLines(s).reduce(function (t, l) { return t + wdfNum(l.unitPrice) * wdfKept(l); }, 0);
    return wdfR2(kept * (1 - wdfRatio(s)));
}
function wdfCost(s) { return wdfLines(s).reduce(function (t, l) { return t + wdfNum(l.costPrice) * wdfKept(l); }, 0); }
function wdfProfit(s) { return wdfR2(wdfGoods(s) - wdfCost(s)); }
function wdfUnits(s) { return wdfLines(s).reduce(function (t, l) { return t + wdfKept(l); }, 0); }
function wdfNetPaid(s) { return wdfR2(wdfNum(s.amountPaid) - wdfNum(s.refundedTotal)); }
function wdfBalance(s) { return Math.max(0, wdfR2(wdfGoods(s) - wdfNetPaid(s))); }
function wdfSaleList() { return Object.keys(wdfSales).map(function (k) { return Object.assign({ _id: k }, wdfSales[k]); }); }
function wdfStatus(s) {
    var u = wdfUnits(s), total = wdfLines(s).reduce(function (t, l) { return t + wdfNum(l.qty); }, 0);
    if (total > 0 && u === 0) return 'RETURNED';
    if (u < total) return 'PART RETURN';
    return '';
}
function wdfPayments(s) {
    if (!s.payments) return [];
    return Object.keys(s.payments).map(function (k) { return s.payments[k]; })
        .sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); });
}
function wdfLineName(l) {
    return wdfEsc(l.name) + ' (' + wdfEsc([l.size, l.color].filter(Boolean).join(', ')) + ')';
}

// =====================================================================
// ITEM / STOCK HELPERS
// =====================================================================
function wdfVariantsOf(it) {
    var cat = wdfCat(it.category), v = it.variants || {};
    return Object.keys(v).map(function (k) { return Object.assign({ _id: k }, v[k]); }).sort(function (a, b) {
        var ia = cat.sizes.indexOf(a.size), ib = cat.sizes.indexOf(b.size);
        ia = ia < 0 ? 999 : ia; ib = ib < 0 ? 999 : ib;
        return (ia - ib) || String(a.color).localeCompare(String(b.color));
    });
}
function wdfTotal(it) { return wdfVariantsOf(it).reduce(function (t, v) { return t + Math.max(0, wdfNum(v.qty)); }, 0); }
function wdfItemList() { return Object.keys(wdfItems).map(function (k) { return Object.assign({ _id: k }, wdfItems[k]); }); }
function wdfVariantLabel(v) { return wdfEsc([v.size, v.color].filter(Boolean).join(' · ')); }
function wdfChip(v) {
    var q = wdfNum(v.qty);
    var c = q <= 0 ? ['#f1f5f9', '#94a3b8'] : (q === 1 ? ['#fef3c7', '#92400e'] : ['#e0f2fe', '#075985']);
    return '<span style="display:inline-block; margin:2px; padding:2px 7px; border-radius:8px; font-size:11px; background:' + c[0] + '; color:' + c[1] + ';">' + wdfVariantLabel(v) + ' ×' + q + '</span>';
}
function wdfTotalBadge(total) {
    if (total <= 0) return '<span style="background:#fee2e2; color:#991b1b; font-size:10px; font-weight:bold; padding:3px 9px; border-radius:10px;">OUT</span>';
    if (total <= WDF_LOW_STOCK) return '<span style="background:#fef3c7; color:#92400e; font-size:11px; font-weight:bold; padding:3px 9px; border-radius:10px;">' + total + ' LOW</span>';
    return '<strong>' + total + '</strong>';
}
function wdfLog(itemId, variantId, label, change, reason) {
    try {
        firebase.database().ref('fashionStockLog/' + currentStoreId).push().set({
            itemId: itemId, variantId: variantId || '', label: label || '', change: change, reason: reason || '',
            by: wdfUser(), at: wdfNow()
        }).catch(function () {});
    } catch (e) {}
}

// =====================================================================
// STOCK SCREEN (home of the fashion dashboard)
// =====================================================================
window.wdfShowStock = function () {
    var ws = wdfEl('workspace-content');
    if (!ws) return;
    var admin = wdfIsAdmin(), manage = wdfCanManage();

    ws.innerHTML =
        '<h2 style="margin:0 0 8px 0;">👗 Fashion Sales</h2>' +
        '<p style="font-size:13px; color:var(--text-muted); margin:0 0 14px 0;">Stock is tracked by size and color. Tap New Sale to sell several items on one receipt.</p>' +
        '<div id="wdf-cards" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:14px;"></div>' +

        '<div style="background:#fff; padding:14px; border-radius:12px; border:1px solid #eef2f7; margin-bottom:12px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; box-shadow:0 6px 18px rgba(15,23,42,0.04);">' +
            '<button class="menu-btn btn-action-primary" style="' + WDF_BTN + ' background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);" onclick="wdfShowSell()">🛒 New Sale' + (wdfCart.length ? ' (' + wdfCart.length + ')' : '') + '</button>' +
            '<button class="menu-btn" style="' + WDF_BTN + ' background:#fef3c7; border:1px solid #fde68a; color:#92400e;" onclick="wdfOpenHistory()">📜 Sales History</button>' +
            '<button class="menu-btn" style="' + WDF_BTN + ' background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdfOpenDebtors()">💵 Debtors <span id="wdf-debt-badge" style="display:none; background:#dc2626; color:#fff; border-radius:10px; padding:1px 7px; font-size:10px; margin-left:4px;"></span></button>' +
            '<button class="menu-btn" style="' + WDF_BTN + ' background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46;" onclick="wdfOpenReports()">📈 Reports</button>' +
            (manage ? '<button class="menu-btn" style="' + WDF_BTN + ' background:#fff7ed; border:1px solid #fed7aa; color:#9a3412;" onclick="wdfOpenRestock()">📦 Restock List</button>' : '') +
        '</div>' +

        '<div style="background:#fff; padding:14px; border-radius:12px; border:1px solid #eef2f7; margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; box-shadow:0 6px 18px rgba(15,23,42,0.04);">' +
            '<input type="text" id="wdf-q" placeholder="🔍 Search item, code, size or color..." oninput="wdfRenderStock()" style="flex:1; min-width:200px; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;">' +
            '<select id="wdf-cat" onchange="wdfRenderStock()" style="padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;"><option value="">All categories</option>' +
                WDF_CATEGORIES.map(function (c) { return '<option value="' + wdfEsc(c.id) + '">' + c.icon + ' ' + wdfEsc(c.id) + '</option>'; }).join('') + '</select>' +
            '<select id="wdf-sf" onchange="wdfRenderStock()" style="padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;"><option value="">All stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select>' +
            (manage ? '<button class="menu-btn btn-action-primary" style="' + WDF_BTN + '" onclick="wdfOpenItemModal()">+ Add Item</button>' : '') +
        '</div>' +

        '<div style="background:#fff; border-radius:12px; border:1px solid #eef2f7; overflow-x:auto; box-shadow:0 6px 18px rgba(15,23,42,0.04);">' +
          '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
            '<thead><tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1; color:#475569;">' +
              '<th style="padding:10px; text-align:left;">Item</th>' +
              '<th style="padding:10px; text-align:left;">Size / Color × Qty</th>' +
              '<th style="padding:10px; text-align:center;">Total</th>' +
              (admin ? '<th style="padding:10px; text-align:right;">Cost</th>' : '') +
              '<th style="padding:10px; text-align:right;">Price</th>' +
              '<th style="padding:10px; text-align:center;">Actions</th>' +
            '</tr></thead>' +
            '<tbody id="wdf-stock-body"></tbody>' +
          '</table>' +
        '</div>';

    wdfRenderCards();
    window.wdfRenderStock();
    wdfUpdateDebtBadge();
};

function wdfCard(label, id, bg, fg, border) {
    return '<div style="background:' + bg + '; border:1px solid ' + border + '; padding:14px; border-radius:12px;">' +
        '<span style="font-size:11px; color:' + fg + '; font-weight:bold; text-transform:uppercase;">' + label + '</span>' +
        '<h3 id="' + id + '" style="font-size:19px; color:' + fg + '; margin:6px 0 0 0;">—</h3></div>';
}

function wdfRenderCards() {
    var box = wdfEl('wdf-cards');
    if (!box) return;
    var admin = wdfIsAdmin();
    var items = wdfItemList(), units = 0, vCost = 0, vSell = 0;
    items.forEach(function (it) {
        var t = wdfTotal(it); units += t;
        vCost += t * wdfNum(it.costPrice); vSell += t * wdfNum(it.sellingPrice);
    });
    var today = wdfToday(), salesToday = 0, profitToday = 0, owed = 0;
    wdfSaleList().forEach(function (s) {
        if (wdfLocalDate(s.soldAt) === today) { salesToday += wdfGoods(s); profitToday += wdfProfit(s); }
        owed += wdfBalance(s);
    });
    
    // Always rebuild to ensure consistent state
    box.innerHTML =
        wdfCard('Items', 'wdf-c-items', '#eff6ff', '#1d4ed8', '#bfdbfe') +
        wdfCard('Units in stock', 'wdf-c-units', '#ecfdf5', '#065f46', '#a7f3d0') +
        (admin ? wdfCard('Stock value (cost)', 'wdf-c-vcost', '#fef2f2', '#b91c1c', '#fecaca') : '') +
        wdfCard('Sales today', 'wdf-c-today', '#f0fdf4', '#166534', '#bbf7d0') +
        (admin ? wdfCard('Profit today', 'wdf-c-profit', '#fefce8', '#854d0e', '#fde68a') : '') +
        wdfCard('Owed by customers', 'wdf-c-owed', '#fff7ed', '#9a3412', '#fed7aa');
        
    var set = function (id, v) { var e = wdfEl(id); if (e && e.textContent !== String(v)) e.textContent = v; };
    set('wdf-c-items', items.length); set('wdf-c-units', units);
    set('wdf-c-vcost', wdfMoney(vCost)); set('wdf-c-today', wdfMoney(salesToday));
    set('wdf-c-profit', wdfMoney(profitToday)); set('wdf-c-owed', wdfMoney(owed));
}

window.wdfRenderStock = function () {
    var tb = wdfEl('wdf-stock-body');
    if (!tb) return;
    var q = wdfVal('wdf-q').toLowerCase(), fc = wdfVal('wdf-cat'), fs = wdfVal('wdf-sf');
    var admin = wdfIsAdmin(), manage = wdfCanManage();
    var cols = admin ? 6 : 5;

    var rows = wdfItemList().filter(function (it) {
        if (fc && it.category !== fc) return false;
        var t = wdfTotal(it);
        if (fs === 'out' && t > 0) return false;
        if (fs === 'low' && !(t > 0 && t <= WDF_LOW_STOCK)) return false;
        if (q) {
            var hay = ((it.name || '') + ' ' + (it.code || '') + ' ' + (it.category || '') + ' ' +
                wdfVariantsOf(it).map(function (v) { return (v.size || '') + ' ' + (v.color || ''); }).join(' ')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    }).sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });

    if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="' + cols + '" style="text-align:center; color:#94a3b8; padding:30px;">' +
            (Object.keys(wdfItems).length ? 'No items match.' : (manage ? 'No items yet. Tap "+ Add Item" to add your first one.' : 'No items yet.')) + '</td></tr>';
        return;
    }

    tb.innerHTML = rows.map(function (it) {
        var vs = wdfVariantsOf(it), cat = wdfCat(it.category), id = wdfEsc(it._id);
        var chips = vs.slice(0, 8).map(wdfChip).join('') + (vs.length > 8 ? ' <span style="font-size:11px; color:#64748b;">+' + (vs.length - 8) + ' more</span>' : '');
        return '<tr style="border-bottom:1px solid #f1f5f9;">' +
            '<td style="padding:10px;"><strong>' + wdfEsc(it.name) + '</strong><div style="font-size:11px; color:#64748b;">' + cat.icon + ' ' + wdfEsc(cat.id) + (it.code ? ' · ' + wdfEsc(it.code) : '') + '</div></td>' +
            '<td style="padding:10px; max-width:320px;">' + (chips || '<span style="color:#94a3b8; font-size:12px;">No sizes yet</span>') + '</td>' +
            '<td style="padding:10px; text-align:center;">' + wdfTotalBadge(wdfTotal(it)) + '</td>' +
            (admin ? '<td style="padding:10px; text-align:right;">' + wdfMoney(it.costPrice) + '</td>' : '') +
            '<td style="padding:10px; text-align:right;">' + wdfMoney(it.sellingPrice) + '</td>' +
            '<td style="padding:10px; text-align:center; white-space:nowrap;">' +
                '<button class="menu-btn" style="' + WDF_SBTN + ' background:#dcfce7; border:1px solid #86efac; color:#166534; font-weight:bold;" onclick="wdfOpenPicker(\'' + id + '\')">Sell</button> ' +
                (manage ? '<button class="menu-btn" style="' + WDF_SBTN + ' background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8;" onclick="wdfOpenStockModal(\'' + id + '\')">Stock</button> ' : '') +
                (manage ? '<button class="menu-btn" style="' + WDF_SBTN + ' background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdfOpenItemModal(\'' + id + '\')">Edit</button> ' : '') +
                (admin ? '<button class="menu-btn" style="' + WDF_SBTN + ' background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdfDeleteItem(\'' + id + '\')">Del</button>' : '') +
            '</td></tr>';
    }).join('');
};

// =====================================================================
// ADD / EDIT ITEM
// =====================================================================
window.wdfOpenItemModal = function (editId) {
    if (!wdfCanManage()) { alert('Only the Admin or Manager can add or edit items.'); return; }
    var it = editId ? wdfItems[editId] : null;
    if (editId && !it) return;
    var cat = it ? it.category : 'Clothes';

    var html =
        '<label style="' + WDF_LBL + '">Item Name *</label>' +
        '<input id="wdf-i-name" type="text" value="' + wdfEsc(it ? it.name : '') + '" placeholder="e.g. Ankara Gown, Nike Sneakers, Ray-Ban Shades" style="' + WDF_INP + '">' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDF_LBL + '">Category</label><select id="wdf-i-cat" onchange="wdfCategoryChanged()" style="' + WDF_INP + '">' +
                WDF_CATEGORIES.map(function (c) { return '<option value="' + wdfEsc(c.id) + '"' + (c.id === cat ? ' selected' : '') + '>' + c.icon + ' ' + wdfEsc(c.id) + '</option>'; }).join('') + '</select></div>' +
            '<div><label style="' + WDF_LBL + '">Item Code (optional)</label><input id="wdf-i-code" type="text" value="' + wdfEsc(it ? it.code : '') + '" placeholder="e.g. AG-01" style="' + WDF_INP + '"></div>' +
        '</div>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDF_LBL + '">Cost Price (₦) *</label><input id="wdf-i-cost" type="number" value="' + (it ? wdfNum(it.costPrice) : '') + '" style="' + WDF_INP + '"></div>' +
            '<div><label style="' + WDF_LBL + '">Selling Price (₦) *</label><input id="wdf-i-price" type="number" value="' + (it ? wdfNum(it.sellingPrice) : '') + '" style="' + WDF_INP + '"></div>' +
        '</div>' +
        '<label style="' + WDF_LBL + '">Notes (optional)</label>' +
        '<input id="wdf-i-notes" type="text" value="' + wdfEsc(it ? it.notes : '') + '" placeholder="e.g. Imported, 18k gold plated" style="' + WDF_INP + '">' +
        '<datalist id="wdf-sizes"></datalist><datalist id="wdf-colors">' + WDF_COLORS.map(function (c) { return '<option value="' + c + '">'; }).join('') + '</datalist>';

    if (!it) {
        html +=
            '<label style="' + WDF_LBL + '">Sizes, Colors and Quantity *</label>' +
            '<div style="font-size:11px; color:#64748b; margin-bottom:6px;">Tap a size to add a row, then fill in the color and how many you have.</div>' +
            '<div id="wdf-i-chips" style="margin-bottom:6px;"></div>' +
            '<div id="wdf-v-rows"></div>' +
            '<button class="menu-btn" style="' + WDF_SBTN + ' background:#f1f5f9; border:1px solid #cbd5e1; margin-top:6px;" onclick="wdfAddVariantRow()">+ Add row</button>';
    } else {
        html += '<div style="font-size:12px; color:#64748b; margin-top:10px;">To change sizes, colors or quantities, use the <strong>Stock</strong> button on the item.</div>';
    }
    html += wdfErrBox('wdf-i-err') +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdfSaveItem(' + (editId ? '\'' + wdfEsc(editId) + '\'' : 'null') + ')">' + (editId ? 'Save Changes' : 'Add Item') + '</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Cancel</button>' +
        '</div>';

    wdfModal(editId ? '✏️ Edit Item' : '👗 Add Item', html);
    wdfCategoryChanged();
    if (!it) wdfAddVariantRow();
};

window.wdfCategoryChanged = function () {
    var cat = wdfCat(wdfVal('wdf-i-cat'));
    var dl = wdfEl('wdf-sizes');
    if (dl) dl.innerHTML = cat.sizes.map(function (s) { return '<option value="' + wdfEsc(s) + '">'; }).join('');
    var chips = wdfEl('wdf-i-chips');
    if (chips) {
        chips.innerHTML = cat.sizes.map(function (s) {
            return '<button type="button" class="menu-btn" style="width:auto; margin:2px; padding:3px 9px; font-size:11px; background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8;" data-size="' + wdfEsc(s) + '" onclick="wdfAddVariantRow(this.dataset.size)">' + wdfEsc(s) + '</button>';
        }).join('');
    }
};

window.wdfAddVariantRow = function (size, color, qty) {
    var box = wdfEl('wdf-v-rows');
    if (!box) return;
    var row = document.createElement('div');
    row.className = 'wdf-vrow';
    row.style.cssText = 'display:grid; grid-template-columns:1.1fr 1.1fr 0.8fr auto; gap:6px; margin-bottom:6px;';
    var s = 'padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box; width:100%;';
    row.innerHTML =
        '<input class="wdf-vr-size" list="wdf-sizes" placeholder="Size" value="' + wdfEsc(size || '') + '" style="' + s + '">' +
        '<input class="wdf-vr-color" list="wdf-colors" placeholder="Color" value="' + wdfEsc(color || '') + '" style="' + s + '">' +
        '<input class="wdf-vr-qty" type="number" min="0" placeholder="Qty" value="' + (qty != null ? qty : '') + '" style="' + s + '">' +
        '<button type="button" class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 10px;" onclick="this.parentNode.remove()">✕</button>';
    box.appendChild(row);
};

function wdfReadVariantRows() {
    var out = [], seen = {}, error = '';
    document.querySelectorAll('.wdf-vrow').forEach(function (r) {
        var size = (r.querySelector('.wdf-vr-size').value || '').trim();
        var color = (r.querySelector('.wdf-vr-color').value || '').trim();
        var qRaw = r.querySelector('.wdf-vr-qty').value;
        if (!size && !color && qRaw === '') return;           // empty row, ignore
        var qty = parseInt(qRaw, 10);
        if (!size) { error = 'Every row needs a size (use "One size" if there is none).'; return; }
        if (isNaN(qty) || qty < 0) { error = 'Enter a quantity (0 or more) for ' + size + '.'; return; }
        var key = (size + '|' + color).toLowerCase();
        if (seen[key]) { error = 'You entered ' + size + (color ? ' / ' + color : '') + ' twice. Combine them into one row.'; return; }
        seen[key] = true;
        out.push({ size: size, color: color, qty: qty });
    });
    return { rows: out, error: error };
}

window.wdfSaveItem = async function (editId) {
    var name = wdfVal('wdf-i-name'), cat = wdfVal('wdf-i-cat'), code = wdfVal('wdf-i-code');
    var cost = parseFloat(wdfVal('wdf-i-cost')) || 0, price = parseFloat(wdfVal('wdf-i-price')) || 0;
    var notes = wdfVal('wdf-i-notes');
    var fail = function (m) { wdfShowErr('wdf-i-err', m); };
    if (!name) return fail('Item name is required.');
    if (!(cost > 0)) return fail('Cost price must be greater than 0.');
    if (!(price > 0)) return fail('Selling price must be greater than 0.');

    try {
        var db = firebase.database();
        if (editId) {
            await db.ref('fashionItems/' + currentStoreId + '/' + editId).update({
                name: name, category: cat, code: code, costPrice: cost, sellingPrice: price, notes: notes, updatedAt: wdfNow()
            });
        } else {
            var r = wdfReadVariantRows();
            if (r.error) return fail(r.error);
            if (!r.rows.length) return fail('Add at least one size/color row.');
            var ref = db.ref('fashionItems/' + currentStoreId).push();
            var variants = {}, logs = [];
            r.rows.forEach(function (v) {
                var vid = ref.child('variants').push().key;
                variants[vid] = { size: v.size, color: v.color, qty: v.qty };
                logs.push({ vid: vid, label: v.size + (v.color ? ' · ' + v.color : ''), qty: v.qty });
            });
            await ref.set({
                name: name, category: cat, code: code, costPrice: cost, sellingPrice: price, notes: notes,
                variants: variants, createdAt: wdfNow(), createdBy: wdfUser()
            });
            logs.forEach(function (l) { if (l.qty > 0) wdfLog(ref.key, l.vid, l.label, l.qty, 'Opening stock'); });
        }
        wdfCloseModal();
    } catch (e) { fail('Could not save: ' + (e.message || e)); }
};

window.wdfDeleteItem = async function (id) {
    if (!wdfIsAdmin()) { alert('Only the Admin can delete items.'); return; }
    var it = wdfItems[id];
    if (!it) return;
    if (!confirm('Delete "' + it.name + '" and all its sizes?\n\nOld receipts keep their details. This cannot be undone.')) return;
    try { await firebase.database().ref('fashionItems/' + currentStoreId + '/' + id).remove(); }
    catch (e) { alert('Could not delete: ' + (e.message || e)); }
};

// =====================================================================
// MANAGE STOCK (add sizes, receive stock, damaged/missing, stock count)
// =====================================================================
window.wdfOpenStockModal = function (itemId) {
    if (!wdfCanManage()) { alert('Only the Admin or Manager can adjust stock.'); return; }
    var it = wdfItems[itemId];
    if (!it) return;
    var vs = wdfVariantsOf(it), cat = wdfCat(it.category);

    var list = vs.length ? vs.map(function (v) {
        return '<div style="display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid #f1f5f9; font-size:13px;">' +
            '<span>' + wdfVariantLabel(v) + '</span><span><strong>' + wdfNum(v.qty) + '</strong> ' +
            (wdfIsAdmin() ? '<button class="menu-btn" style="' + WDF_SBTN + ' background:#fef2f2; border:1px solid #fecaca; color:#991b1b; margin-left:8px;" onclick="wdfDeleteVariant(\'' + wdfEsc(itemId) + '\',\'' + wdfEsc(v._id) + '\')">Remove</button>' : '') +
            '</span></div>';
    }).join('') : '<div style="color:#94a3b8; font-size:13px; padding:8px 0;">No sizes yet.</div>';

    var html =
        '<div style="font-size:13px; color:#64748b; margin-bottom:6px;">' + cat.icon + ' ' + wdfEsc(it.category) + ' · ' + wdfTotal(it) + ' in stock</div>' + list +

        '<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px; margin-top:12px;">' +
            '<div style="font-weight:bold; font-size:12px; color:#1d4ed8;">Change a quantity</div>' +
            '<label style="' + WDF_LBL + '">Size / Color</label>' +
            '<select id="wdf-a-var" style="' + WDF_INP + '">' + vs.map(function (v) { return '<option value="' + wdfEsc(v._id) + '">' + wdfVariantLabel(v) + ' (now ' + wdfNum(v.qty) + ')</option>'; }).join('') + '</select>' +
            '<div style="display:grid; grid-template-columns:1.4fr 1fr; gap:8px;">' +
                '<div><label style="' + WDF_LBL + '">What happened</label><select id="wdf-a-act" style="' + WDF_INP + '">' +
                    '<option value="add">➕ Received new stock</option><option value="damaged">🗑 Damaged (remove)</option><option value="missing">⚠️ Missing (remove)</option><option value="set">🔢 Stock count (set to)</option></select></div>' +
                '<div><label style="' + WDF_LBL + '">Number</label><input id="wdf-a-n" type="number" min="0" style="' + WDF_INP + '"></div>' +
            '</div>' +
            '<button class="menu-btn btn-action-primary" style="' + WDF_BTN + ' margin-top:10px;" onclick="wdfApplyAdjust(\'' + wdfEsc(itemId) + '\')">Apply</button>' +
        '</div>' +

        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px; margin-top:12px;">' +
            '<div style="font-weight:bold; font-size:12px; color:#334155;">Add a new size / color</div>' +
            '<datalist id="wdf-sizes">' + cat.sizes.map(function (s) { return '<option value="' + wdfEsc(s) + '">'; }).join('') + '</datalist>' +
            '<datalist id="wdf-colors">' + WDF_COLORS.map(function (c) { return '<option value="' + c + '">'; }).join('') + '</datalist>' +
            '<div style="display:grid; grid-template-columns:1fr 1fr 0.7fr; gap:6px; margin-top:6px;">' +
                '<input id="wdf-n-size" list="wdf-sizes" placeholder="Size" style="' + WDF_INP + '">' +
                '<input id="wdf-n-color" list="wdf-colors" placeholder="Color" style="' + WDF_INP + '">' +
                '<input id="wdf-n-qty" type="number" min="0" placeholder="Qty" style="' + WDF_INP + '">' +
            '</div>' +
            '<button class="menu-btn" style="' + WDF_BTN + ' margin-top:10px; background:#e2e8f0; border:1px solid #cbd5e1;" onclick="wdfAddVariantToItem(\'' + wdfEsc(itemId) + '\')">+ Add size</button>' +
        '</div>' +
        wdfErrBox('wdf-a-err') +
        '<div style="display:flex; gap:10px; margin-top:14px;">' +
            '<button class="menu-btn btn-dash" style="' + WDF_BTN + '" onclick="wdfOpenStockLog(\'' + wdfEsc(itemId) + '\')">🕘 History</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Close</button>' +
        '</div>';
    wdfModal('📦 ' + (it.name || 'Stock'), html, 540);
};

window.wdfApplyAdjust = async function (itemId) {
    var vid = wdfVal('wdf-a-var'), act = wdfVal('wdf-a-act');
    var n = parseInt(wdfVal('wdf-a-n'), 10);
    var it = wdfItems[itemId], v = it && it.variants && it.variants[vid];
    if (!v) return wdfShowErr('wdf-a-err', 'Pick a size / color.');
    if (isNaN(n) || n < 0) return wdfShowErr('wdf-a-err', 'Enter a number (0 or more).');
    if (act !== 'set' && n === 0) return wdfShowErr('wdf-a-err', 'Enter a number greater than 0.');

    var before = wdfNum(v.qty), after = before;
    try {
        var ref = firebase.database().ref('fashionItems/' + currentStoreId + '/' + itemId + '/variants/' + vid + '/qty');
        var res = await ref.transaction(function (cur) {
            if (typeof cur !== 'number') return cur;
            var nv = act === 'add' ? cur + n : (act === 'set' ? n : cur - n);
            if (nv < 0) return;
            return nv;
        });
        if (!res.committed || typeof res.snapshot.val() !== 'number') return wdfShowErr('wdf-a-err', 'Could not apply. You cannot remove more than is in stock.');
        after = res.snapshot.val();
        var reasons = { add: 'Received stock', damaged: 'Damaged', missing: 'Missing', set: 'Stock count' };
        wdfLog(itemId, vid, v.size + (v.color ? ' · ' + v.color : ''), after - before, reasons[act]);
        wdfOpenStockModal(itemId);
    } catch (e) { wdfShowErr('wdf-a-err', 'Failed: ' + (e.message || e)); }
};

window.wdfAddVariantToItem = async function (itemId) {
    var size = wdfVal('wdf-n-size'), color = wdfVal('wdf-n-color');
    var qty = parseInt(wdfVal('wdf-n-qty'), 10);
    var it = wdfItems[itemId];
    if (!it) return;
    if (!size) return wdfShowErr('wdf-a-err', 'Enter a size.');
    if (isNaN(qty) || qty < 0) return wdfShowErr('wdf-a-err', 'Enter a quantity (0 or more).');
    var key = (size + '|' + color).toLowerCase();
    var dup = wdfVariantsOf(it).some(function (v) { return ((v.size || '') + '|' + (v.color || '')).toLowerCase() === key; });
    if (dup) return wdfShowErr('wdf-a-err', 'That size / color already exists. Use "Received new stock" on it.');
    try {
        var ref = firebase.database().ref('fashionItems/' + currentStoreId + '/' + itemId + '/variants').push();
        await ref.set({ size: size, color: color, qty: qty });
        if (qty > 0) wdfLog(itemId, ref.key, size + (color ? ' · ' + color : ''), qty, 'New size added');
        wdfOpenStockModal(itemId);
    } catch (e) { wdfShowErr('wdf-a-err', 'Failed: ' + (e.message || e)); }
};

window.wdfDeleteVariant = async function (itemId, vid) {
    if (!wdfIsAdmin()) return;
    var it = wdfItems[itemId], v = it && it.variants && it.variants[vid];
    if (!v) return;
    if (!confirm('Remove ' + v.size + (v.color ? ' / ' + v.color : '') + ' (' + wdfNum(v.qty) + ' in stock) from this item?\nThis will permanently remove this size/color from the catalog.')) return;
    try {
        await firebase.database().ref('fashionItems/' + currentStoreId + '/' + itemId + '/variants/' + vid).remove();
        wdfLog(itemId, vid, v.size + (v.color ? ' · ' + v.color : ''), -wdfNum(v.qty), 'Size removed');
        wdfOpenStockModal(itemId);
    } catch (e) { alert('Failed: ' + (e.message || e)); }
};

window.wdfOpenStockLog = async function (itemId) {
    var it = wdfItems[itemId] || {};
    wdfModal('🕘 Stock History — ' + (it.name || ''), '<div id="wdf-log-body" style="max-height:60vh; overflow-y:auto; font-size:12px;">Loading...</div>' +
        '<div style="margin-top:12px;"><button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfOpenStockModal(\'' + wdfEsc(itemId) + '\')">Back</button></div>', 540);
    try {
        var snap = await firebase.database().ref('fashionStockLog/' + currentStoreId).limitToLast(400).once('value');
        var all = snap.val() || {};
        var rows = Object.keys(all).map(function (k) { return all[k]; }).filter(function (r) { return r.itemId === itemId; })
            .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
        var box = wdfEl('wdf-log-body');
        if (!box) return;
        box.innerHTML = rows.length ? rows.map(function (r) {
            var c = wdfNum(r.change);
            return '<div style="display:flex; justify-content:space-between; gap:8px; padding:7px 0; border-bottom:1px solid #f1f5f9;">' +
                '<div><strong>' + wdfEsc(r.label) + '</strong> — ' + wdfEsc(r.reason) + '<div style="color:#94a3b8;">' + wdfPretty(r.at) + ' · ' + wdfEsc(r.by) + '</div></div>' +
                '<div style="font-weight:bold; color:' + (c >= 0 ? '#166534' : '#991b1b') + ';">' + (c >= 0 ? '+' : '') + c + '</div></div>';
        }).join('') : '<div style="color:#94a3b8; text-align:center; padding:20px;">No history yet.</div>';
    } catch (e) { var b = wdfEl('wdf-log-body'); if (b) b.textContent = 'Could not load history.'; }
};

// =====================================================================
// RESTOCK LIST
// =====================================================================
window.wdfOpenRestock = function () {
    var low = wdfItemList().filter(function (it) { return wdfTotal(it) <= WDF_LOW_STOCK; })
        .sort(function (a, b) { return wdfTotal(a) - wdfTotal(b); });
    var lines = low.map(function (it) {
        var empty = wdfVariantsOf(it).filter(function (v) { return wdfNum(v.qty) <= 0; }).map(function (v) { return [v.size, v.color].filter(Boolean).join(' '); });
        return '• ' + it.name + ' — ' + wdfTotal(it) + ' left' + (empty.length ? ' (finished: ' + empty.join(', ') + ')' : '');
    });
    window.__wdfRestockText = '📦 Restock list — ' + wdfToday() + '\n' + lines.join('\n');
    var html = low.length
        ? '<div style="max-height:56vh; overflow-y:auto;">' + low.map(function (it, i) {
            return '<div style="padding:8px 0; border-bottom:1px solid #f1f5f9; font-size:13px;"><strong>' + wdfEsc(it.name) + '</strong> ' + wdfTotalBadge(wdfTotal(it)) +
                '<div style="margin-top:4px;">' + wdfVariantsOf(it).map(wdfChip).join('') + '</div></div>';
        }).join('') + '</div>'
        : '<div style="text-align:center; color:#94a3b8; padding:30px;">Nothing is running low ✅</div>';
    wdfModal('📦 Restock List (' + WDF_LOW_STOCK + ' or fewer left)', html +
        '<div style="display:flex; gap:10px; margin-top:14px;">' +
            (low.length ? '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdfCopyRestock()">📋 Copy for WhatsApp</button>' : '') +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Close</button></div>', 560);
};
window.wdfCopyRestock = function () {
    var t = window.__wdfRestockText || '';
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { alert('Copied. Paste it in WhatsApp.'); }, function () { prompt('Copy this:', t); });
    else prompt('Copy this:', t);
};

// =====================================================================
// SELL SCREEN (cart)
// =====================================================================
window.wdfShowSell = function () {
    var ws = wdfEl('workspace-content');
    if (!ws) return;
    ws.innerHTML =
        '<div style="display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap; align-items:center;">' +
            '<button class="menu-btn btn-logout" style="' + WDF_BTN + '" onclick="wdfShowStock()">🔙 Stock</button>' +
            '<h2 style="margin:0; font-size:18px;">🛒 New Sale</h2>' +
        '</div>' +
        '<div id="wdf-exchange-banner"></div>' +
        '<div id="wdf-cart"></div>' +
        '<div style="background:#fff; padding:12px; border-radius:12px; border:1px solid #eef2f7; margin:14px 0 10px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">' +
            '<input type="text" id="wdf-s-q" placeholder="🔍 Find an item to add..." oninput="wdfRenderSellResults()" style="flex:1; min-width:200px; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px;">' +
            '<select id="wdf-s-cat" onchange="wdfRenderSellResults()" style="padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;"><option value="">All</option>' +
                WDF_CATEGORIES.map(function (c) { return '<option value="' + wdfEsc(c.id) + '">' + c.icon + ' ' + wdfEsc(c.id) + '</option>'; }).join('') + '</select>' +
        '</div>' +
        '<div id="wdf-sell-results"></div>';
    wdfRenderExchangeBanner();
    wdfRenderCart();
    window.wdfRenderSellResults();
};

function wdfRenderExchangeBanner() {
    var b = wdfEl('wdf-exchange-banner');
    if (!b) return;
    b.innerHTML = wdfExchange
        ? '<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px 12px; margin-bottom:10px; font-size:13px;">🔁 <strong>Exchange credit ' + wdfMoney(wdfExchange.credit) + '</strong> from ' + wdfEsc(wdfExchange.saleId) +
          '. Pick items worth at least this much.' +
          ' <button class="menu-btn" style="' + WDF_SBTN + ' background:#fff; border:1px solid #fde68a; margin-left:6px;" onclick="wdfCancelExchange()">Cancel exchange</button></div>'
        : '';
}
window.wdfCancelExchange = function () { wdfExchange = null; wdfRenderExchangeBanner(); wdfRenderCart(); };

function wdfCartTotals() {
    var sub = wdfCart.reduce(function (t, l) { return t + wdfNum(l.unitPrice) * l.qty; }, 0);
    var disc = Math.min(Math.max(0, wdfNum(wdfDiscount)), sub);
    return { sub: wdfR2(sub), disc: wdfR2(disc), total: wdfR2(sub - disc) };
}

function wdfRenderCart() {
    var box = wdfEl('wdf-cart');
    if (!box) return;
    if (!wdfCart.length) {
        box.innerHTML = '<div style="background:#fff; border:1px dashed #cbd5e1; border-radius:12px; padding:18px; text-align:center; color:#94a3b8; font-size:13px;">Cart is empty. Find an item below and pick a size.</div>';
        return;
    }
    var t = wdfCartTotals();
    box.innerHTML =
        '<div style="background:#fff; border:1px solid #bbf7d0; border-radius:12px; padding:12px; box-shadow:0 6px 18px rgba(15,23,42,0.04);">' +
        wdfCart.map(function (l, i) {
            return '<div style="display:grid; grid-template-columns:1fr auto; gap:6px; padding:8px 0; border-bottom:1px solid #f1f5f9;">' +
                '<div><div style="font-weight:bold; font-size:13px;">' + wdfEsc(l.name) + '</div>' +
                '<div style="font-size:12px; color:#64748b;">' + wdfEsc([l.size, l.color].filter(Boolean).join(' · ')) + '</div>' +
                '<div style="display:flex; align-items:center; gap:8px; margin-top:6px;">' +
                    '<button class="menu-btn" style="width:30px; margin:0; padding:4px 0; justify-content:center;" onclick="wdfCartQty(' + i + ',-1)">−</button>' +
                    '<strong>' + l.qty + '</strong>' +
                    '<button class="menu-btn" style="width:30px; margin:0; padding:4px 0; justify-content:center;" onclick="wdfCartQty(' + i + ',1)">+</button>' +
                    '<span style="font-size:12px; color:#64748b; margin-left:6px;">₦ each</span>' +
                    '<input type="number" value="' + l.unitPrice + '" onchange="wdfCartPrice(' + i + ', this.value)" style="width:100px; padding:6px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px;">' +
                '</div></div>' +
                '<div style="text-align:right;"><div style="font-weight:bold;">' + wdfMoney(l.unitPrice * l.qty) + '</div>' +
                '<button class="menu-btn btn-logout" style="width:auto; margin:6px 0 0; padding:3px 9px; font-size:11px;" onclick="wdfCartRemove(' + i + ')">✕</button></div>' +
            '</div>';
        }).join('') +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; font-size:13px;"><span>Subtotal</span><strong>' + wdfMoney(t.sub) + '</strong></div>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px; font-size:13px;"><span>Discount (₦)</span>' +
            '<input type="number" min="0" value="' + (t.disc || '') + '" placeholder="0" onchange="wdfSetDiscount(this.value)" style="width:110px; padding:6px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; text-align:right;"></div>' +
        '<div style="display:flex; justify-content:space-between; margin-top:10px; font-size:17px;"><strong>Total</strong><strong style="color:#16a34a;">' + wdfMoney(t.total) + '</strong></div>' +
        '<div style="display:flex; gap:10px; margin-top:12px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center; background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);" onclick="wdfOpenCheckout()">✅ Checkout</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfClearCart()">Clear</button>' +
        '</div></div>';
}

function wdfLiveQty(itemId, variantId) {
    var it = wdfItems[itemId];
    if (!it || !it.variants) return 0;
    var v = it.variants[variantId];
    return v ? Math.max(0, wdfNum(v.qty)) : 0;
}

window.wdfAddToCart = function (itemId, variantId) {
    var it = wdfItems[itemId], v = it && it.variants && it.variants[variantId];
    if (!v) return;
    var line = wdfCart.find(function (l) { return l.itemId === itemId && l.variantId === variantId; });
    var have = wdfLiveQty(itemId, variantId);
    if ((line ? line.qty : 0) + 1 > have) { alert('Only ' + have + ' of this size/color in stock.'); return; }
    if (line) line.qty++;
    else wdfCart.push({
        itemId: itemId, variantId: variantId, name: it.name || '', category: it.category || '',
        size: v.size || '', color: v.color || '', qty: 1,
        unitPrice: wdfNum(it.sellingPrice), listPrice: wdfNum(it.sellingPrice), costPrice: wdfNum(it.costPrice)
    });
    wdfRenderCart();
    // NOTE: Removed redundant wdfOpenPicker() call to prevent UI flash.
};

window.wdfCartQty = function (i, d) {
    var l = wdfCart[i]; if (!l) return;
    var n = l.qty + d;
    if (n <= 0) { wdfCart.splice(i, 1); }
    else if (n > wdfLiveQty(l.itemId, l.variantId)) { alert('Only ' + wdfLiveQty(l.itemId, l.variantId) + ' in stock.'); return; }
    else l.qty = n;
    wdfRenderCart();
};
window.wdfCartPrice = function (i, v) {
    var l = wdfCart[i]; if (!l) return;
    var p = parseFloat(v);
    if (isNaN(p) || p < 0) { wdfRenderCart(); return; }
    l.unitPrice = p; wdfRenderCart();
};
window.wdfCartRemove = function (i) { wdfCart.splice(i, 1); wdfRenderCart(); };
window.wdfSetDiscount = function (v) { wdfDiscount = Math.max(0, parseFloat(v) || 0); wdfRenderCart(); };
window.wdfClearCart = function () { if (wdfCart.length && !confirm('Clear the cart?')) return; wdfCart = []; wdfDiscount = 0; wdfRenderCart(); };

window.wdfRenderSellResults = function () {
    var box = wdfEl('wdf-sell-results');
    if (!box) return;
    var q = wdfVal('wdf-s-q').toLowerCase(), fc = wdfVal('wdf-s-cat');
    var rows = wdfItemList().filter(function (it) {
        if (fc && it.category !== fc) return false;
        if (q) {
            var hay = ((it.name || '') + ' ' + (it.code || '') + ' ' + (it.category || '') + ' ' +
                wdfVariantsOf(it).map(function (v) { return (v.size || '') + ' ' + (v.color || ''); }).join(' ')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    }).sort(function (a, b) {
        var ta = wdfTotal(a) > 0 ? 0 : 1, tb = wdfTotal(b) > 0 ? 0 : 1;
        return (ta - tb) || String(a.name || '').localeCompare(String(b.name || ''));
    }).slice(0, 40);

    if (!rows.length) { box.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:24px; font-size:13px;">No items found.</div>'; return; }
    box.innerHTML = rows.map(function (it) {
        var t = wdfTotal(it), cat = wdfCat(it.category);
        return '<div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:8px; display:flex; justify-content:space-between; gap:10px; align-items:center; ' + (t <= 0 ? 'opacity:0.55;' : '') + '">' +
            '<div style="min-width:0;"><div style="font-weight:bold; font-size:13px;">' + wdfEsc(it.name) + '</div>' +
            '<div style="font-size:11px; color:#64748b;">' + cat.icon + ' ' + wdfEsc(cat.id) + ' · ' + (t > 0 ? t + ' in stock' : 'Out of stock') + '</div></div>' +
            '<div style="text-align:right; white-space:nowrap;"><div style="font-weight:bold; color:#16a34a;">' + wdfMoney(it.sellingPrice) + '</div>' +
            (t > 0 ? '<button class="menu-btn" style="' + WDF_SBTN + ' background:#dcfce7; border:1px solid #86efac; color:#166534; font-weight:bold; margin-top:4px;" onclick="wdfOpenPicker(\'' + wdfEsc(it._id) + '\')">Pick size</button>' : '') +
            '</div></div>';
    }).join('');
};

// Size / color picker
window.wdfOpenPicker = function (itemId) {
    var it = wdfItems[itemId];
    if (!it) return;
    var vs = wdfVariantsOf(it);
    var html = '<div id="wdf-picker"></div>' +
        '<div style="font-size:12px; color:#64748b; margin-bottom:6px;">' + wdfMoney(it.sellingPrice) + ' each. Tap + to add one to the cart.</div>' +
        (vs.length ? vs.map(function (v) {
            var inCart = (wdfCart.find(function (l) { return l.itemId === itemId && l.variantId === v._id; }) || {}).qty || 0;
            var q = wdfNum(v.qty);
            return '<div style="display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid #f1f5f9; ' + (q <= 0 ? 'opacity:0.5;' : '') + '">' +
                '<div><strong style="font-size:14px;">' + wdfVariantLabel(v) + '</strong><div style="font-size:11px; color:#64748b;">' + (q > 0 ? q + ' left' : 'Out of stock') + (inCart ? ' · <span style="color:#16a34a;">' + inCart + ' in cart</span>' : '') + '</div></div>' +
                (q > 0 ? '<button class="menu-btn" style="width:auto; margin:0; padding:7px 16px; background:#dcfce7; border:1px solid #86efac; color:#166534; font-weight:bold; font-size:15px;" onclick="wdfAddToCart(\'' + wdfEsc(itemId) + '\',\'' + wdfEsc(v._id) + '\')">+</button>' : '') +
                '</div>';
        }).join('') : '<div style="color:#94a3b8; padding:14px;">No sizes added for this item yet.</div>') +
        '<div style="display:flex; gap:10px; margin-top:14px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdfCloseModal(); wdfShowSell();">🛒 Go to cart' + (wdfCart.length ? ' (' + wdfCart.length + ')' : '') + '</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Done</button>' +
        '</div>';
    wdfModal(it.name || 'Pick size', html, 440);
};

// =====================================================================
// CHECKOUT
// =====================================================================
window.wdfOpenCheckout = function () {
    if (!wdfCart.length) return;
    var t = wdfCartTotals();
    var credit = wdfExchange ? wdfExchange.credit : 0;
    if (credit > t.total + 0.001) { alert('The exchange credit (' + wdfMoney(credit) + ') is more than this total. Add items worth at least the credit, or cancel the exchange and refund instead.'); return; }

    var html =
        '<div style="background:#ecfdf5; border:1px solid #a7f3d0; border-radius:10px; padding:10px 12px; font-size:13px;">' +
            wdfCart.length + ' item' + (wdfCart.length === 1 ? '' : 's') + ' · Total <strong>' + wdfMoney(t.total) + '</strong>' +
            (credit > 0 ? '<br>Exchange credit: −' + wdfMoney(credit) + ' → <strong>To pay: ' + wdfMoney(t.total - credit) + '</strong>' : '') +
        '</div>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDF_LBL + '">Payment Method</label><select id="wdf-c-method" onchange="wdfCheckoutRecalc()" style="' + WDF_INP + '"><option>Cash</option><option>Transfer</option><option>POS</option><option>Part Payment</option></select></div>' +
            '<div><label style="' + WDF_LBL + '">Customer Name</label><input id="wdf-c-name" type="text" placeholder="Optional" style="' + WDF_INP + '"></div>' +
        '</div>' +
        '<label style="' + WDF_LBL + '">Customer Phone</label><input id="wdf-c-phone" type="text" placeholder="e.g. 08012345678" style="' + WDF_INP + '">' +
        '<div id="wdf-c-part" style="display:none; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px; margin-top:10px;">' +
            '<div style="font-size:11px; color:#1d4ed8; font-weight:bold;">Name and phone are required for part payment.</div>' +
            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
                '<div><label style="' + WDF_LBL + '">Deposit (₦) *</label><input id="wdf-c-paid" type="number" oninput="wdfCheckoutRecalc()" style="' + WDF_INP + '"></div>' +
                '<div><label style="' + WDF_LBL + '">Deposit Paid By</label><select id="wdf-c-dep" style="' + WDF_INP + '"><option>Cash</option><option>Transfer</option><option>POS</option></select></div>' +
            '</div>' +
            '<label style="' + WDF_LBL + '">Balance Due Date</label><input id="wdf-c-due" type="date" value="' + wdfPlusDays(14) + '" style="' + WDF_INP + '">' +
            '<div id="wdf-c-bal" style="font-size:13px; font-weight:bold; color:#1d4ed8; margin-top:8px;"></div>' +
        '</div>' +
        '<label style="' + WDF_LBL + '">Notes (optional)</label><input id="wdf-c-notes" type="text" style="' + WDF_INP + '">' +
        wdfErrBox('wdf-c-err') +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center; background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);" onclick="wdfConfirmSale()">✅ Confirm & Print Receipt</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Back</button>' +
        '</div>';
    wdfModal('✅ Checkout', html);
    wdfCheckoutRecalc();
};

window.wdfCheckoutRecalc = function () {
    var part = wdfVal('wdf-c-method') === 'Part Payment';
    var box = wdfEl('wdf-c-part');
    if (box) box.style.display = part ? 'block' : 'none';
    var t = wdfCartTotals(), credit = wdfExchange ? wdfExchange.credit : 0;
    var paid = parseFloat(wdfVal('wdf-c-paid')) || 0;
    var bal = wdfEl('wdf-c-bal');
    if (bal) bal.textContent = part ? 'Balance after deposit: ' + wdfMoney(Math.max(0, t.total - credit - paid)) : '';
};

window.__wdfBusy = false;
window.wdfConfirmSale = async function () {
    if (window.__wdfBusy) return;
    var fail = function (m) { wdfShowErr('wdf-c-err', m); };
    if (!wdfCart.length) return fail('The cart is empty.');

    // Re-check against live stock
    for (var i = 0; i < wdfCart.length; i++) {
        var l = wdfCart[i];
        if (wdfLiveQty(l.itemId, l.variantId) < l.qty) return fail('Not enough stock for ' + l.name + ' (' + [l.size, l.color].filter(Boolean).join(', ') + '). Only ' + wdfLiveQty(l.itemId, l.variantId) + ' left.');
    }

    var t = wdfCartTotals();
    if (!(t.total > 0)) return fail('Total must be greater than 0.');
    var ex = wdfExchange, credit = ex ? ex.credit : 0;
    if (credit > t.total + 0.001) return fail('Exchange credit is more than the total.');
    var method = wdfVal('wdf-c-method'), name = wdfVal('wdf-c-name'), phone = wdfVal('wdf-c-phone'), notes = wdfVal('wdf-c-notes');
    var remaining = wdfR2(t.total - credit);
    var deposit = remaining, depMethod = method, dueDate = null;

    if (method === 'Part Payment') {
        deposit = parseFloat(wdfVal('wdf-c-paid')) || 0;
        if (!name || !phone) return fail('Customer name and phone are required for part payment.');
        if (!(deposit > 0) || deposit >= remaining) return fail('Deposit must be more than 0 and less than ' + wdfMoney(remaining) + '. For full payment pick Cash, Transfer or POS.');
        depMethod = wdfVal('wdf-c-dep') || 'Cash';
        dueDate = wdfVal('wdf-c-due') || null;
    }

    window.__wdfBusy = true;
    var db = firebase.database();
    var taken = [];     // stock already deducted (so we can put it back on failure)
    var undo = async function () {
        for (var k = 0; k < taken.length; k++) {
            try {
                await db.ref('fashionItems/' + currentStoreId + '/' + taken[k].itemId + '/variants/' + taken[k].variantId + '/qty')
                    .transaction(function (cur) { return typeof cur === 'number' ? cur + taken[k].qty : cur; });
            } catch (e) {}
        }
    };

    try {
        // 1) take stock, atomically per line
        for (var j = 0; j < wdfCart.length; j++) {
            var L = wdfCart[j];
            var ref = db.ref('fashionItems/' + currentStoreId + '/' + L.itemId + '/variants/' + L.variantId + '/qty');
            var res = await ref.transaction(function (cur) {
                if (typeof cur !== 'number') return cur;
                return cur >= L.qty ? cur - L.qty : undefined;
            });
            if (!res.committed || typeof res.snapshot.val() !== 'number') {
                await undo();
                window.__wdfBusy = false;
                return fail('Not enough stock for ' + L.name + ' (' + [L.size, L.color].filter(Boolean).join(', ') + '). Someone may have just sold it, or the item was deleted.');
            }
            taken.push({ itemId: L.itemId, variantId: L.variantId, qty: L.qty });
        }

        // 2) receipt number
        var cRes = await db.ref('fashionCounters/' + currentStoreId + '/lastSaleNumber').transaction(function (c) { return (c || 0) + 1; });
        if (!cRes.committed) throw new Error('Could not reserve a receipt number.');
        var saleId = 'FS-' + String(cRes.snapshot.val()).padStart(6, '0');
        var nowIso = wdfNow(), by = wdfUser();

        // 3) if this is an exchange, record the return on the old sale first
        var exLines = [];
        if (ex) {
            var old = wdfSales[ex.saleId];
            exLines = ex.picks.map(function (p) {
                var ol = old && old.items && old.items[p.i];
                return ol ? { itemId: ol.itemId, variantId: ol.variantId, qty: p.qty } : null;
            }).filter(Boolean);
            var rr = await wdfApplyReturn(ex.saleId, ex.picks, credit, 'Exchange credit', ex.reason, ex.restock, saleId);
            if (!rr.ok) { await undo(); window.__wdfBusy = false; return fail(rr.error); }
        }

        // 4) write the sale
        var pays = {};
        if (credit > 0) pays.c0 = { amount: credit, method: 'Exchange credit', at: nowIso, by: by, note: 'Exchange from ' + ex.saleId };
        if (deposit > 0) pays.p0 = { amount: deposit, method: depMethod, at: nowIso, by: by, note: method === 'Part Payment' ? 'Deposit' : 'Full payment' };
        var paidTotal = wdfR2(credit + deposit);
        var sale = {
            saleId: saleId,
            items: wdfCart.map(function (x) {
                return { itemId: x.itemId, variantId: x.variantId, name: x.name, category: x.category, size: x.size, color: x.color,
                         qty: x.qty, unitPrice: x.unitPrice, listPrice: x.listPrice, costPrice: x.costPrice, returnedQty: 0 };
            }),
            subtotal: t.sub, discount: t.disc, total: t.total,
            amountPaid: paidTotal, refundedTotal: 0, balance: wdfR2(t.total - paidTotal), dueDate: dueDate,
            paymentMethod: (credit >= t.total - 0.001 && method !== 'Part Payment') ? 'Exchange credit' : method,
            payments: pays,
            customerName: name, customerPhone: phone, notes: notes,
            exchangeFrom: ex ? ex.saleId : null,
            soldBy: by, soldAt: nowIso
        };
        await db.ref('fashionSales/' + currentStoreId + '/' + saleId).set(sale);

        if (ex) wdfRestock(exLines, ex.restock);

        wdfCart = []; wdfDiscount = 0; wdfExchange = null;
        window.__wdfBusy = false;
        wdfCloseModal();
        wdfShowReceipt(saleId);
    } catch (e) {
        await undo();
        window.__wdfBusy = false;
        fail('Could not complete the sale: ' + (e.message || e));
    }
};

// =====================================================================
// RETURNS / EXCHANGES
// =====================================================================
function wdfCalcAfter(s, picks) {
    var c = JSON.parse(JSON.stringify(s));
    picks.forEach(function (p) { var l = c.items && c.items[p.i]; if (l) l.returnedQty = wdfNum(l.returnedQty) + p.qty; });
    var goods = wdfGoods(c), paidNet = wdfNum(c.amountPaid) - wdfNum(c.refundedTotal);
    return { goods: goods, maxRefund: Math.max(0, wdfR2(paidNet - goods)) };
}

window.wdfOpenReturnModal = function (saleId, from) {
    if (!wdfCanManage()) { alert('Only the Admin or Manager can process returns.'); return; }
    var s = wdfSales[saleId];
    if (!s) { alert('Sale not found.'); return; }
    window.__wdfFrom = from || 'history';
    var lines = wdfLines(s).filter(function (l) { return wdfKept(l) > 0; });
    if (!lines.length) { alert('Everything on this sale was already returned.'); return; }

    var html =
        '<div style="font-size:13px; margin-bottom:6px;"><strong>' + wdfEsc(s.saleId) + '</strong> · ' + wdfEsc(s.customerName || 'Walk-in') + ' · Paid so far ' + wdfMoney(wdfNetPaid(s)) + '</div>' +
        '<div style="font-size:12px; color:#64748b; margin-bottom:6px;">How many of each is coming back?</div>' +
        lines.map(function (l) {
            return '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #f1f5f9;">' +
                '<div style="font-size:13px;">' + wdfLineName(l) + '<div style="font-size:11px; color:#64748b;">' + wdfMoney(l.unitPrice) + ' each · ' + wdfKept(l) + ' kept</div></div>' +
                '<input type="number" min="0" max="' + wdfKept(l) + '" value="0" data-i="' + wdfEsc(l._i) + '" class="wdf-rq" oninput="wdfReturnRecalc(\'' + wdfEsc(saleId) + '\')" style="width:64px; padding:7px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; text-align:center;"></div>';
        }).join('') +
        '<div id="wdf-r-sum" style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:8px 10px; font-size:13px; margin-top:10px;">Pick the items being returned.</div>' +
        '<label style="' + WDF_LBL + '">Reason</label>' +
        '<select id="wdf-r-reason" style="' + WDF_INP + '"><option>Wrong size</option><option>Wrong color</option><option>Fault / defect</option><option>Customer changed mind</option><option>Other</option></select>' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDF_LBL + '">Back on shelf?</label><select id="wdf-r-restock" style="' + WDF_INP + '"><option value="yes">Yes, resellable</option><option value="no">No (damaged)</option></select></div>' +
            '<div><label style="' + WDF_LBL + '">Refund Amount (₦)</label><input id="wdf-r-amt" type="number" min="0" value="0" style="' + WDF_INP + '"></div>' +
        '</div>' +
        '<label style="' + WDF_LBL + '">Refund Paid By</label><select id="wdf-r-method" style="' + WDF_INP + '"><option>Cash</option><option>Transfer</option></select>' +
        wdfErrBox('wdf-r-err') +
        '<div style="display:flex; gap:8px; margin-top:16px; flex-wrap:wrap;">' +
            '<button class="menu-btn" style="flex:1; margin:0; justify-content:center; background:#dc2626; color:#fff; border:none; min-width:140px;" onclick="wdfConfirmReturn(\'' + wdfEsc(saleId) + '\')">↩️ Refund</button>' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center; min-width:140px;" onclick="wdfStartExchange(\'' + wdfEsc(saleId) + '\')">🔁 Exchange</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfBackFrom(\'' + wdfEsc(saleId) + '\')">Cancel</button>' +
        '</div>' +
        '<div style="font-size:11px; color:#64748b; margin-top:8px;">Refund = money back. Exchange = the customer picks other items and the credit is applied to the new sale.</div>';
    wdfModal('↩️ Return / Exchange', html, 540);
};

function wdfReadPicks() {
    var picks = [];
    document.querySelectorAll('.wdf-rq').forEach(function (inp) {
        var n = parseInt(inp.value, 10) || 0;
        if (n > 0) picks.push({ i: inp.getAttribute('data-i'), qty: n });
    });
    return picks;
}

window.wdfReturnRecalc = function (saleId) {
    var s = wdfSales[saleId]; if (!s) return;
    var picks = wdfReadPicks(), sum = wdfEl('wdf-r-sum'), amt = wdfEl('wdf-r-amt');
    for (var k = 0; k < picks.length; k++) {
        var l = s.items[picks[k].i];
        if (l && picks[k].qty > wdfKept(l)) { picks[k].qty = wdfKept(l); }
    }
    if (!picks.length) { if (sum) sum.textContent = 'Pick the items being returned.'; if (amt) amt.value = 0; return; }
    var c = wdfCalcAfter(s, picks);
    if (sum) sum.innerHTML = 'Goods after return: ' + wdfMoney(c.goods) + '<br>Customer has paid more than that by: <strong>' + wdfMoney(c.maxRefund) + '</strong> (most you can refund or credit)';
    if (amt) amt.value = c.maxRefund;
};

window.wdfBackFrom = function (saleId) {
    var from = window.__wdfFrom;
    wdfCloseModal();
    if (from === 'receipt') wdfShowReceipt(saleId);
    else if (from === 'debtors') wdfOpenDebtors();
    else wdfOpenHistory();
};

// Records a return on a sale (atomic). Used by Refund and by Exchange.
async function wdfApplyReturn(saleId, picks, refundAmt, method, reason, restock, exchangeTo) {
    var nowIso = wdfNow(), by = wdfUser(), summary = [];
    try {
        var ref = firebase.database().ref('fashionSales/' + currentStoreId + '/' + saleId);
        var failMsg = 'Could not record the return. The sale may have changed. Try again.';
        var res = await ref.transaction(function (cur) {
            if (!cur || !cur.items) return cur;
            summary = [];
            for (var k = 0; k < picks.length; k++) {
                var l = cur.items[picks[k].i];
                if (!l || picks[k].qty <= 0 || picks[k].qty > wdfKept(l)) { failMsg = 'One of the items was already returned.'; return; }
                l.returnedQty = wdfNum(l.returnedQty) + picks[k].qty;
                summary.push({ name: l.name, size: l.size || '', color: l.color || '', qty: picks[k].qty });
            }
            
            // FIX: Only refund actual money paid, not exchange credit
            var realPaid = wdfPayments(cur).filter(function(p) { return p.method !== 'Exchange credit'; }).reduce(function(sum, p) { return sum + wdfNum(p.amount); }, 0);
            var goods = wdfGoods(cur);
            var maxRefund = Math.max(0, wdfR2(realPaid - goods));
            
            if (refundAmt > maxRefund + 0.001) { failMsg = 'Refund is more than the customer has paid in real money for these items (' + wdfMoney(maxRefund) + ').'; return; }
            cur.refundedTotal = wdfR2(wdfNum(cur.refundedTotal) + refundAmt);
            cur.balance = Math.max(0, wdfR2(goods - (wdfNum(cur.amountPaid) - cur.refundedTotal)));
            var rs = Object.assign({}, cur.returns || {});
            rs['r' + Date.now()] = { at: nowIso, by: by, items: summary, refund: refundAmt, method: method, reason: reason, restocked: !!restock, exchangeTo: exchangeTo || null };
            cur.returns = rs;
            return cur;
        });
        if (!res.committed || !res.snapshot.val() || !res.snapshot.val().returns) return { ok: false, error: failMsg };
        return { ok: true };
    } catch (e) { return { ok: false, error: 'Return failed: ' + (e.message || e) }; }
}

async function wdfRestock(lines, restock) {
    if (!restock) return;
    for (var i = 0; i < lines.length; i++) {
        var l = lines[i], it = wdfItems[l.itemId];
        if (!it || !it.variants || !it.variants[l.variantId]) continue;       // item/size was deleted
        try {
            await firebase.database().ref('fashionItems/' + currentStoreId + '/' + l.itemId + '/variants/' + l.variantId + '/qty')
                .transaction(function (cur) { return typeof cur === 'number' ? cur + l.qty : cur; });
            wdfLog(l.itemId, l.variantId, [it.variants[l.variantId].size, it.variants[l.variantId].color].filter(Boolean).join(' · '), l.qty, 'Returned by customer');
        } catch (e) {}
    }
}

window.wdfConfirmReturn = async function (saleId) {
    var s = wdfSales[saleId]; if (!s) return;
    var picks = wdfReadPicks();
    if (!picks.length) return wdfShowErr('wdf-r-err', 'Pick at least one item to return.');
    var amt = parseFloat(wdfVal('wdf-r-amt')); if (isNaN(amt) || amt < 0) amt = 0;
    var c = wdfCalcAfter(s, picks);
    if (amt > c.maxRefund + 0.001) return wdfShowErr('wdf-r-err', 'You can refund at most ' + wdfMoney(c.maxRefund) + ' for these items.');
    var restock = wdfVal('wdf-r-restock') === 'yes';
    var lines = picks.map(function (p) { var l = s.items[p.i]; return l ? { itemId: l.itemId, variantId: l.variantId, qty: p.qty } : null; }).filter(Boolean);

    var r = await wdfApplyReturn(saleId, picks, amt, wdfVal('wdf-r-method'), wdfVal('wdf-r-reason'), restock, null);
    if (!r.ok) return wdfShowErr('wdf-r-err', r.error);
    await wdfRestock(lines, restock);
    var from = window.__wdfFrom;
    wdfCloseModal();
    alert('✅ Return recorded' + (amt > 0 ? '. Refund: ' + wdfMoney(amt) : '') + '.');
    if (from === 'receipt') wdfShowReceipt(saleId); else wdfOpenHistory();
};

window.wdfStartExchange = function (saleId) {
    var s = wdfSales[saleId]; if (!s) return;
    var picks = wdfReadPicks();
    if (!picks.length) return wdfShowErr('wdf-r-err', 'Pick at least one item to exchange.');
    var c = wdfCalcAfter(s, picks);
    if (!(c.maxRefund > 0)) return wdfShowErr('wdf-r-err', 'The customer has not paid anything for these items yet, so there is no credit. Use Refund instead: it reduces what they owe.');
    wdfExchange = { saleId: saleId, picks: picks, credit: c.maxRefund, reason: wdfVal('wdf-r-reason'), restock: wdfVal('wdf-r-restock') === 'yes' };
    wdfCloseModal();
    wdfShowSell();
};

// =====================================================================
// RECEIPT
// =====================================================================
window.wdfShowReceipt = function (saleId) {
    var ws = wdfEl('workspace-content');
    if (!ws) return;
    ws.innerHTML =
        '<div style="display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap;">' +
            '<button class="menu-btn btn-action-primary" style="width:auto; justify-content:center;" onclick="wdfPrintReceipt()">🖨 Print Receipt</button>' +
            '<button class="menu-btn btn-dash" style="width:auto;" onclick="wdfDownloadReceiptPDF()">📥 Download PDF</button>' +
            '<button class="menu-btn btn-logout" style="width:auto;" onclick="wdfShowStock()">🔙 Back to Fashion Sales</button>' +
        '</div>' +
        '<div id="wdf-printable" style="background:#fff; color:#000; padding:20px; border-radius:8px; max-width:380px; font-family:monospace; margin:0 auto; border:1px solid #ccc;">' +
            '<div style="text-align:center; margin-bottom:8px;">' +
                '<h3 id="wdf-r-store" style="margin:0; font-size:16px;">WISE DECISION</h3>' +
                '<div id="wdf-r-addr" style="font-size:10px; color:#333; margin-top:3px;"></div>' +
                '<div id="wdf-r-tel" style="font-size:10px; color:#333;"></div>' +
            '</div>' +
            '<hr style="border:dashed 1px #ccc;">' +
            '<div style="text-align:center; font-weight:bold; font-size:12px; margin:6px 0;">SALES RECEIPT</div>' +
            '<hr style="border:dashed 1px #ccc;">' +
            '<div id="wdf-r-body" style="font-size:11px; line-height:1.7;">Loading...</div>' +
            '<hr style="border:dashed 1px #ccc;">' +
            '<div style="text-align:center; font-size:10px; color:#333; margin-top:8px;">' + wdfEsc(WDF_RETURN_POLICY) + '</div>' +
            '<div style="text-align:center; font-size:10px; color:#333; margin-top:6px;">Thank you for shopping with us!</div>' +
        '</div>' +
        '<div id="wdf-r-actions" style="max-width:380px; margin:12px auto 0; display:flex; gap:8px; flex-wrap:wrap;"></div>';

    var db = firebase.database();
    db.ref('fashionSales/' + currentStoreId + '/' + saleId).once('value').then(function (snap) {
        var s = snap.val(), body = wdfEl('wdf-r-body');
        if (!body) return;
        if (!s) { body.innerHTML = '<div style="color:#991b1b;">Sale record not found.</div>'; return; }

        db.ref('stores/' + currentStoreId).once('value').then(function (ss) {
            var st = ss.val() || {};
            var a = wdfEl('wdf-r-store'), b = wdfEl('wdf-r-addr'), c = wdfEl('wdf-r-tel');
            if (a) a.textContent = st.businessName || 'WISE DECISION';
            if (b) b.textContent = st.address || '';
            if (c) c.textContent = st.phone ? ('Tel: ' + st.phone) : '';
        });

        var hr = '<hr style="border:dashed 1px #ccc; margin:8px 0;">';
        var row = function (l, r, bold) { return '<div style="display:flex; justify-content:space-between; gap:8px;' + (bold ? ' font-weight:bold;' : '') + '"><span>' + l + '</span><span>' + r + '</span></div>'; };
        var lines = wdfLines(s);
        var returns = s.returns ? Object.keys(s.returns).map(function (k) { return s.returns[k]; }) : [];
        var bal = wdfBalance(s), pays = wdfPayments(s);

        body.innerHTML =
            '<div><strong>Receipt:</strong> ' + wdfEsc(s.saleId) + '</div>' +
            '<div><strong>Date:</strong> ' + wdfPretty(s.soldAt) + '</div>' +
            (s.customerName ? '<div><strong>Customer:</strong> ' + wdfEsc(s.customerName) + (s.customerPhone ? ' · ' + wdfEsc(s.customerPhone) : '') + '</div>' : '') +
            '<div><strong>Served by:</strong> ' + wdfEsc(s.soldBy) + '</div>' + hr +
            lines.map(function (l) {
                return '<div>' + wdfNum(l.qty) + ' × ' + wdfLineName(l) + (wdfNum(l.returnedQty) > 0 ? ' <span style="color:#991b1b;">[' + wdfNum(l.returnedQty) + ' returned]</span>' : '') + '</div>' +
                       row('&nbsp;&nbsp;@ ' + wdfMoney(l.unitPrice), wdfMoney(wdfNum(l.unitPrice) * wdfNum(l.qty)));
            }).join('') + hr +
            row('Subtotal', wdfMoney(s.subtotal)) +
            (wdfNum(s.discount) > 0 ? row('Discount', '−' + wdfMoney(s.discount)) : '') +
            row('TOTAL', wdfMoney(s.total), true) + hr +
            pays.map(function (p) { return row(wdfEsc(p.method) + ' · ' + wdfPretty(p.at), wdfMoney(p.amount)); }).join('') +
            row('Amount paid', wdfMoney(s.amountPaid), true) +
            (bal > 0 ? '<div style="margin-top:4px; padding:4px; border:1px solid #991b1b; color:#991b1b; font-weight:bold;">BALANCE DUE: ' + wdfMoney(bal) + (s.dueDate ? '<br><span style="font-size:10px;">Pay by ' + wdfPretty(s.dueDate) + '</span>' : '') + '</div>' : '') +
            (s.exchangeFrom ? '<div style="margin-top:6px; font-size:10px;">Exchange from receipt ' + wdfEsc(s.exchangeFrom) + '</div>' : '') +
            (returns.length ? hr + '<div style="font-weight:bold;">Returns</div>' + returns.map(function (r) {
                return '<div style="font-size:10px;">' + wdfPretty(r.at) + ': ' + (r.items || []).map(function (i) { return wdfNum(i.qty) + '× ' + wdfEsc(i.name) + ' (' + wdfEsc([i.size, i.color].filter(Boolean).join(', ')) + ')'; }).join(', ') +
                    (wdfNum(r.refund) > 0 ? ' — ' + (r.method === 'Exchange credit' ? 'credit ' : 'refund ') + wdfMoney(r.refund) : '') + '</div>';
            }).join('') : '') +
            (s.notes ? '<div style="margin-top:6px; font-style:italic;">Notes: ' + wdfEsc(s.notes) + '</div>' : '');

        var act = wdfEl('wdf-r-actions');
        if (act) {
            var h = '';
            if (bal > 0) h += '<button class="menu-btn btn-action-primary" style="' + WDF_BTN + '" onclick="wdfOpenPayModal(\'' + wdfEsc(saleId) + '\',\'receipt\')">💵 Record Payment</button>';
            if (wdfCanManage() && wdfUnits(s) > 0) h += '<button class="menu-btn" style="' + WDF_BTN + ' background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdfOpenReturnModal(\'' + wdfEsc(saleId) + '\',\'receipt\')">↩️ Return / Exchange</button>';
            act.innerHTML = h;
        }
    });
};

window.wdfPrintReceipt = function () {
    var el = wdfEl('wdf-printable');
    if (!el) return;
    if (typeof triggerThermalPrint === 'function') triggerThermalPrint(el.innerHTML); else window.print();
};
window.wdfDownloadReceiptPDF = function () {
    var el = wdfEl('wdf-printable');
    if (!el) return;
    if (typeof loadHtml2PdfLibrary === 'function') {
        loadHtml2PdfLibrary().then(function () {
            html2pdf().from(el).set({ margin: 5, filename: 'Receipt.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' } }).save();
        }).catch(function (e) { alert(e.message); });
    } else window.print();
};

// =====================================================================
// SALES HISTORY
// =====================================================================
window.wdfOpenHistory = function () {
    var html =
        '<input id="wdf-h-q" type="text" placeholder="🔍 Receipt no, customer, phone or item..." oninput="wdfRenderHistory()" style="' + WDF_INP + '">' +
        '<div id="wdf-h-body" style="max-height:58vh; overflow-y:auto; margin-top:12px;"></div>' +
        '<div style="margin-top:14px;"><button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Close</button></div>';
    wdfModal('📜 Sales History', html, 620);
    window.wdfRenderHistory();
};

window.wdfRenderHistory = function () {
    var box = wdfEl('wdf-h-body');
    if (!box) return;
    var q = wdfVal('wdf-h-q').toLowerCase(), admin = wdfIsAdmin();
    var rows = wdfSaleList().sort(function (a, b) { return String(b.soldAt || '').localeCompare(String(a.soldAt || '')); });
    if (q) rows = rows.filter(function (s) {
        var hay = ((s.saleId || '') + ' ' + (s.customerName || '') + ' ' + (s.customerPhone || '') + ' ' + wdfLines(s).map(function (l) { return l.name; }).join(' ')).toLowerCase();
        return hay.indexOf(q) !== -1;
    });
    if (!rows.length) { box.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:30px;">No sales found.</div>'; return; }

    box.innerHTML = rows.slice(0, 80).map(function (s) {
        var bal = wdfBalance(s), st = wdfStatus(s), lines = wdfLines(s);
        var badges = '';
        if (st) badges += '<span style="background:#fee2e2; color:#991b1b; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px; margin-left:4px;">' + st + '</span>';
        badges += bal > 0
            ? '<span style="background:#fef3c7; color:#92400e; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px; margin-left:4px;">OWES ' + wdfMoney(bal) + '</span>'
            : (st === 'RETURNED' ? '' : '<span style="background:#dcfce7; color:#166534; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px; margin-left:4px;">PAID</span>');
        var id = wdfEsc(s._id);
        return '<div style="border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">' +
                '<div style="flex:1; min-width:180px;"><div style="font-weight:bold; font-size:13px;">' + wdfEsc(s.saleId) + badges + '</div>' +
                '<div style="font-size:12px; color:#64748b; margin-top:3px;">' + lines.slice(0, 2).map(function (l) { return wdfNum(l.qty) + '× ' + wdfEsc(l.name); }).join(', ') + (lines.length > 2 ? ' +' + (lines.length - 2) + ' more' : '') + '</div>' +
                (s.customerName ? '<div style="font-size:12px; margin-top:3px;">👤 ' + wdfEsc(s.customerName) + (s.customerPhone ? ' · ' + wdfEsc(s.customerPhone) : '') + '</div>' : '') + '</div>' +
                '<div style="text-align:right;"><div style="font-weight:bold; color:#16a34a; font-size:15px;">' + wdfMoney(wdfGoods(s)) + '</div><div style="font-size:11px; color:#64748b;">' + wdfPretty(s.soldAt) + '</div>' +
                (admin ? '<div style="font-size:11px; color:#64748b;">Profit ' + wdfMoney(wdfProfit(s)) + '</div>' : '') + '</div>' +
            '</div>' +
            '<div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">' +
                '<button class="menu-btn btn-dash" style="' + WDF_SBTN + '" onclick="wdfCloseModal(); wdfShowReceipt(\'' + id + '\')">🖨 Receipt</button>' +
                (bal > 0 ? '<button class="menu-btn btn-action-primary" style="' + WDF_SBTN + '" onclick="wdfOpenPayModal(\'' + id + '\',\'history\')">💵 Record Payment</button>' : '') +
                (wdfCanManage() && wdfUnits(s) > 0 ? '<button class="menu-btn" style="' + WDF_SBTN + ' background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdfOpenReturnModal(\'' + id + '\',\'history\')">↩️ Return / Exchange</button>' : '') +
            '</div></div>';
    }).join('');
};

// =====================================================================
// RECORD PAYMENT + DEBTORS
// =====================================================================
function wdfUpdateDebtBadge() {
    var b = wdfEl('wdf-debt-badge');
    if (!b) return;
    var n = wdfSaleList().filter(function (s) { return wdfBalance(s) > 0; }).length;
    var txt = n > 0 ? String(n) : '';
    if (b.textContent !== txt) b.textContent = txt;
    var d = n > 0 ? 'inline-block' : 'none';
    if (b.style.display !== d) b.style.display = d;
}

window.wdfOpenPayModal = function (saleId, from) {
    var s = wdfSales[saleId];
    if (!s) { alert('Sale not found.'); return; }
    var bal = wdfBalance(s);
    if (bal <= 0) { alert('This sale has no balance.'); return; }
    window.__wdfFrom = from || 'debtors';
    var html =
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; font-size:13px;">' +
            '<div><strong>' + wdfEsc(s.customerName || 'Customer') + '</strong> ' + wdfEsc(s.customerPhone || '') + '</div>' +
            '<div style="color:#64748b; font-size:12px; margin-top:4px;">' + wdfEsc(s.saleId) + '</div>' +
            '<div style="margin-top:6px;">Paid ' + wdfMoney(wdfNetPaid(s)) + ' · <strong style="color:#b91c1c;">Owes ' + wdfMoney(bal) + '</strong></div>' +
        '</div>' +
        '<label style="' + WDF_LBL + '">Amount Received (₦)</label><input id="wdf-p-amt" type="number" value="' + bal + '" style="' + WDF_INP + '">' +
        '<label style="' + WDF_LBL + '">Paid By</label><select id="wdf-p-method" style="' + WDF_INP + '"><option>Cash</option><option>Transfer</option><option>POS</option></select>' +
        wdfErrBox('wdf-p-err') +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdfConfirmPayment(\'' + wdfEsc(saleId) + '\')">Save Payment</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfBackFrom(\'' + wdfEsc(saleId) + '\')">Cancel</button>' +
        '</div>';
    wdfModal('💵 Record Payment', html);
};

window.wdfConfirmPayment = async function (saleId) {
    var amt = parseFloat(wdfVal('wdf-p-amt')) || 0, method = wdfVal('wdf-p-method') || 'Cash';
    if (!(amt > 0)) return wdfShowErr('wdf-p-err', 'Enter the amount received.');
    var key = 'p' + Date.now(), nowIso = wdfNow(), by = wdfUser();
    try {
        var ref = firebase.database().ref('fashionSales/' + currentStoreId + '/' + saleId);
        var res = await ref.transaction(function (cur) {
            if (!cur) return cur;
            if (amt > wdfBalance(cur) + 0.001) return;
            var p = Object.assign({}, cur.payments || {});
            p[key] = { amount: amt, method: method, at: nowIso, by: by, note: 'Balance payment' };
            cur.payments = p;
            cur.amountPaid = wdfR2(wdfNum(cur.amountPaid) + amt);
            cur.balance = Math.max(0, wdfR2(wdfGoods(cur) - (wdfNum(cur.amountPaid) - wdfNum(cur.refundedTotal))));
            return cur;
        });
        var v = res.snapshot.val();
        if (!res.committed || !v || !v.payments || !v.payments[key]) return wdfShowErr('wdf-p-err', 'Could not save. The amount is more than the balance.');
        var from = window.__wdfFrom;
        wdfCloseModal();
        if (from === 'receipt') wdfShowReceipt(saleId); else if (from === 'history') wdfOpenHistory(); else wdfOpenDebtors();
    } catch (e) { wdfShowErr('wdf-p-err', 'Could not save payment: ' + (e.message || e)); }
};

var wdfStoreName = 'our shop', wdfStoreNameFor = null;
function wdfCacheStoreName() {
    if (typeof currentStoreId === 'undefined' || !currentStoreId || wdfStoreNameFor === currentStoreId) return;
    wdfStoreNameFor = currentStoreId;
    firebase.database().ref('stores/' + currentStoreId + '/businessName').once('value')
        .then(function (s) { if (s.val()) wdfStoreName = s.val(); }).catch(function () {});
}

window.wdfOpenDebtors = function () {
    var d = wdfSaleList().filter(function (s) { return wdfBalance(s) > 0; });
    d.sort(function (a, b) { return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')) || String(a.soldAt).localeCompare(String(b.soldAt)); });
    var total = d.reduce(function (t, s) { return t + wdfBalance(s); }, 0);

    var body = d.length ? d.map(function (s) {
        var left = s.dueDate ? wdfDaysUntil(s.dueDate) : null;
        var dueTxt = s.dueDate ? (left < 0 ? '<span style="color:#b91c1c; font-weight:bold;">' + Math.abs(left) + ' day' + (left === -1 ? '' : 's') + ' overdue</span>' : (left === 0 ? '<span style="color:#92400e; font-weight:bold;">Due today</span>' : 'Due in ' + left + ' day' + (left === 1 ? '' : 's'))) : 'No due date';
        var msg = 'Hello ' + (s.customerName || '') + ', this is a friendly reminder from ' + wdfStoreName + ' about your outstanding balance of ' + wdfMoney(wdfBalance(s)) + ' (receipt ' + s.saleId + ').' + (s.dueDate ? ' Kindly complete payment by ' + wdfPretty(s.dueDate) + '.' : ' Kindly complete payment at your earliest convenience.') + ' Thank you.';
        return '<div style="border:1px solid ' + (left !== null && left < 0 ? '#fecaca' : '#e2e8f0') + '; border-radius:10px; padding:12px; margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">' +
                '<div><div style="font-weight:bold; font-size:13px;">👤 ' + wdfEsc(s.customerName) + '</div><div style="font-size:12px; color:#64748b;">' + wdfEsc(s.customerPhone) + ' · ' + wdfEsc(s.saleId) + '</div></div>' +
                '<div style="text-align:right;"><div style="font-weight:bold; color:#b91c1c; font-size:15px;">' + wdfMoney(wdfBalance(s)) + '</div><div style="font-size:11px;">' + dueTxt + '</div></div></div>' +
            '<div style="display:flex; gap:8px; margin-top:8px; flex-wrap:wrap;">' +
                '<button class="menu-btn btn-action-primary" style="' + WDF_SBTN + '" onclick="wdfOpenPayModal(\'' + wdfEsc(s._id) + '\',\'debtors\')">💵 Record Payment</button>' +
                '<button class="menu-btn" style="' + WDF_SBTN + ' background:#dcfce7; border:1px solid #86efac; color:#166534;" data-phone="' + wdfEsc(s.customerPhone) + '" data-msg="' + wdfEsc(msg) + '" onclick="wdfWhatsApp(this.dataset.phone, this.dataset.msg)">💬 WhatsApp</button>' +
                '<button class="menu-btn btn-dash" style="' + WDF_SBTN + '" onclick="wdfCloseModal(); wdfShowReceipt(\'' + wdfEsc(s._id) + '\')">🖨 Receipt</button>' +
            '</div></div>';
    }).join('') : '<div style="text-align:center; color:#94a3b8; padding:30px;">Nobody owes you. All paid ✅</div>';

    wdfModal('💵 Customers Who Owe You',
        '<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:10px 12px; margin-bottom:12px; font-size:13px;">Total owed: <strong style="color:#b91c1c; font-size:16px;">' + wdfMoney(total) + '</strong> · ' + d.length + ' customer' + (d.length === 1 ? '' : 's') + '</div>' +
        '<div style="max-height:58vh; overflow-y:auto;">' + body + '</div>' +
        '<div style="margin-top:14px;"><button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Close</button></div>', 600);
};

// =====================================================================
// REPORTS
// =====================================================================
function wdfRange(p) {
    var t = wdfToday();
    if (p === 'today') return [t, t, 'Today'];
    if (p === 'week') return [wdfPlusDays(-6), t, 'Last 7 days'];
    if (p === 'month') return [t.substring(0, 7) + '-01', t, 'This month'];
    return ['0000-00-00', '9999-99-99', 'All time'];
}

function wdfBuildReport(period) {
    var r = wdfRange(period), from = r[0], to = r[1];
    var inP = function (iso) { var d = wdfLocalDate(iso); return d && d >= from && d <= to; };
    var all = wdfSaleList();
    var rep = { label: r[2], sales: 0, units: 0, value: 0, profit: 0, collected: 0, byMethod: {}, refunds: 0, refundCount: 0, outstanding: 0, owing: 0, cats: {}, items: {}, staff: {}, discount: 0 };

    all.forEach(function (s) {
        if (inP(s.soldAt)) {
            var goods = wdfGoods(s), ratio = wdfRatio(s);
            if (wdfUnits(s) > 0) rep.sales++;
            rep.units += wdfUnits(s); rep.value += goods; rep.profit += wdfProfit(s); rep.discount += wdfNum(s.discount);
            wdfLines(s).forEach(function (l) {
                var k = wdfKept(l); if (k <= 0) return;
                var v = wdfNum(l.unitPrice) * k * (1 - ratio);
                var c = rep.cats[l.category || 'Other'] = rep.cats[l.category || 'Other'] || { n: 0, v: 0 }; c.n += k; c.v += v;
                var it = rep.items[l.name] = rep.items[l.name] || { n: 0, v: 0 }; it.n += k; it.v += v;
            });
            var st = rep.staff[s.soldBy || '—'] = rep.staff[s.soldBy || '—'] || { n: 0, v: 0 }; st.n += wdfUnits(s); st.v += goods;
        }
        wdfPayments(s).forEach(function (pm) {
            if (pm.method === 'Exchange credit' || !inP(pm.at)) return;       // not real money
            rep.collected += wdfNum(pm.amount);
            rep.byMethod[pm.method || 'Cash'] = (rep.byMethod[pm.method || 'Cash'] || 0) + wdfNum(pm.amount);
        });
        if (s.returns) Object.keys(s.returns).forEach(function (k) {
            var rt = s.returns[k];
            if (rt.method !== 'Exchange credit' && wdfNum(rt.refund) > 0 && inP(rt.at)) { rep.refunds += wdfNum(rt.refund); rep.refundCount++; }
        });
        var b = wdfBalance(s); if (b > 0) { rep.outstanding += b; rep.owing++; }
    });
    return rep;
}

function wdfReportText(rep) {
    var methods = Object.keys(rep.byMethod).map(function (k) { return k + ' ' + wdfMoney(rep.byMethod[k]); }).join(', ');
    var lines = [
        '👗 ' + wdfStoreName + ' — Report (' + rep.label + ')',
        'Sales: ' + rep.sales + ' · Units: ' + rep.units,
        'Sales value: ' + wdfMoney(rep.value),
        'Money received: ' + wdfMoney(rep.collected) + (methods ? ' (' + methods + ')' : ''),
        'Refunds: ' + wdfMoney(rep.refunds),
        'Net cash in: ' + wdfMoney(rep.collected - rep.refunds),
        'Still owed by customers: ' + wdfMoney(rep.outstanding) + ' (' + rep.owing + ')'
    ];
    if (wdfIsAdmin()) lines.splice(3, 0, 'Profit: ' + wdfMoney(rep.profit));
    return lines.join('\n');
}

window.wdfOpenReports = function () {
    wdfModal('📈 Reports',
        '<select id="wdf-rep-p" onchange="wdfRenderReports()" style="' + WDF_INP + '"><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">This month</option><option value="all">All time</option></select>' +
        '<div id="wdf-rep-body" style="max-height:58vh; overflow-y:auto; margin-top:12px;"></div>' +
        '<div style="display:flex; gap:10px; margin-top:14px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdfCopyReport()">📋 Copy Summary (WhatsApp)</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Close</button></div>', 600);
    wdfRenderReports();
};

window.wdfRenderReports = function () {
    var box = wdfEl('wdf-rep-body');
    if (!box) return;
    var rep = wdfBuildReport(wdfVal('wdf-rep-p') || 'today'), admin = wdfIsAdmin();
    var card = function (l, v, bg, fg) { return '<div style="background:' + bg + '; border-radius:10px; padding:10px;"><div style="font-size:10px; font-weight:bold; text-transform:uppercase; color:' + fg + ';">' + l + '</div><div style="font-size:17px; font-weight:bold; color:' + fg + '; margin-top:4px;">' + v + '</div></div>'; };
    var table = function (title, obj, limit) {
        var keys = Object.keys(obj).sort(function (a, b) { return obj[b].v - obj[a].v; }).slice(0, limit || 99);
        if (!keys.length) return '';
        return '<div style="margin-top:14px;"><div style="font-size:12px; font-weight:bold; color:#334155; margin-bottom:6px;">' + title + '</div>' + keys.map(function (k) {
            return '<div style="display:flex; justify-content:space-between; font-size:12px; padding:5px 0; border-bottom:1px solid #f1f5f9;"><span>' + wdfEsc(k) + ' <span style="color:#94a3b8;">×' + obj[k].n + '</span></span><strong>' + wdfMoney(obj[k].v) + '</strong></div>';
        }).join('') + '</div>';
    };
    var methods = Object.keys(rep.byMethod).map(function (k) { return '<div style="display:flex; justify-content:space-between; font-size:12px; padding:5px 0; border-bottom:1px solid #f1f5f9;"><span>' + wdfEsc(k) + '</span><strong>' + wdfMoney(rep.byMethod[k]) + '</strong></div>'; }).join('');

    box.innerHTML =
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">' +
            card('Sales / Units', rep.sales + ' / ' + rep.units, '#eff6ff', '#1d4ed8') +
            card('Sales Value', wdfMoney(rep.value), '#ecfdf5', '#065f46') +
            card('Money Received', wdfMoney(rep.collected), '#f0fdf4', '#166534') +
            (admin ? card('Profit', wdfMoney(rep.profit), '#fefce8', '#854d0e') : card('Discounts Given', wdfMoney(rep.discount), '#fefce8', '#854d0e')) +
            card('Refunds', wdfMoney(rep.refunds) + ' (' + rep.refundCount + ')', '#fef2f2', '#991b1b') +
            card('Still Owed (all time)', wdfMoney(rep.outstanding) + ' (' + rep.owing + ')', '#fff7ed', '#9a3412') +
        '</div>' +
        (methods ? '<div style="margin-top:14px;"><div style="font-size:12px; font-weight:bold; color:#334155; margin-bottom:6px;">Money received by method</div>' + methods + '</div>' : '') +
        table('By category', rep.cats) + table('Top items', rep.items, 8) + table('By staff', rep.staff);
};

window.wdfCopyReport = function () {
    var t = wdfReportText(wdfBuildReport(wdfVal('wdf-rep-p') || 'today'));
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { alert('Copied. Paste it in WhatsApp.'); }, function () { prompt('Copy this:', t); });
    else prompt('Copy this:', t);
};

// =====================================================================
// MAIN ATTACH
// =====================================================================
function wdfAttach() {
    wdfWatch();
    wdfCacheStoreName();
    wdfApplySidebar();
}
var wdfTimer = null;
function wdfSchedule() {
    if (wdfTimer) return;
    wdfTimer = setTimeout(function () {
        wdfTimer = null;
        try { wdfAttach(); } catch (e) { console.warn('[fashion]', e); }
    }, 150);
}
window.addEventListener('load', function () {
    setTimeout(function () { try { wdfAttach(); } catch (e) { console.warn(e); } }, 900);
    var obs = new MutationObserver(wdfSchedule);
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
});
