// ==================== WISE DECISION RESERVED ITEMS PATCH (v1) ====================
// Load AFTER fashion-patch.js
//
// Lets staff hold specific size/color units for a customer without selling them.
//   • Reserve button in the stock modal
//   • Reserved units excluded from stock available to sell
//   • Auto-expire after WDR_HOLD_HOURS (default 24h)
//
// Reserved data lives INSIDE the variant:
//   fashionItems/{storeId}/{itemId}/variants/{variantId}/reserved = {
//     { holdId }: { qty, customerName, customerPhone, at, by, expiresAt }
//   }

console.log("Wise Decision reserve-patch.js — v1 loaded");

var WDR_HOLD_HOURS = 24;

function wdrEl(id) { return document.getElementById(id); }
function wdrVal(id) { var e = wdrEl(id); return e ? String(e.value || '').trim() : ''; }
function wdrNum(n) { return Number(n) || 0; }
function wdrMoney(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + (Number(n) || 0).toLocaleString()); }
function wdrNow() { return new Date().toISOString(); }
function wdrUser() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
function wdrEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function wdrPad(n) { return String(n).padStart(2, '0'); }
function wdrPlusHours(h) { var d = new Date(); d.setHours(d.getHours() + h); return d.toISOString(); }
function wdrPretty(s) { var d = new Date(s); if (isNaN(d)) return '—'; return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function wdrHoursLeft(expiresAt) {
    if (!expiresAt) return null;
    return Math.round((new Date(expiresAt) - new Date()) / 3600000);
}

// Total reserved qty for a variant (excluding expired holds)
function wdrReservedOf(v) {
    if (!v || !v.reserved) return 0;
    var now = new Date();
    return Object.keys(v.reserved).reduce(function (t, k) {
        var r = v.reserved[k];
        if (new Date(r.expiresAt) < now) return t;
        return t + wdrNum(r.qty);
    }, 0);
}
// Available qty to sell = total - reserved
function wdrAvailable(v) { return Math.max(0, wdrNum(v.qty) - wdrReservedOf(v)); }

// ---------- open reserve form ----------
window.wdrOpenReserve = function (itemId, variantId) {
    var it = wdfItems[itemId], v = it && it.variants && it.variants[variantId];
    if (!v) return;
    var avail = wdrAvailable(v);
    if (avail <= 0) { alert('No available units to reserve (all are reserved or out of stock).'); return; }
    var html =
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; font-size:13px;">' +
            '<div><strong>' + wdrEsc(it.name) + '</strong></div>' +
            '<div style="color:#64748b; margin-top:3px;">' + wdrEsc([v.size, v.color].filter(Boolean).join(' · ')) + '</div>' +
            '<div style="margin-top:6px;">Stock: ' + wdrNum(v.qty) + ' · Reserved: ' + wdrReservedOf(v) + ' · <strong style="color:#16a34a;">Available: ' + avail + '</strong></div>' +
        '</div>' +
        '<label style="' + WDF_LBL + '">Quantity to Reserve *</label><input id="wdr-qty" type="number" min="1" max="' + avail + '" value="1" style="' + WDF_INP + '">' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + WDF_LBL + '">Customer Name</label><input id="wdr-name" type="text" style="' + WDF_INP + '"></div>' +
            '<div><label style="' + WDF_LBL + '">Phone</label><input id="wdr-phone" type="text" style="' + WDF_INP + '"></div>' +
        '</div>' +
        '<label style="' + WDF_LBL + '">Hold For</label>' +
        '<select id="wdr-hours" style="' + WDF_INP + '">' +
            '<option value="1">1 hour</option><option value="4">4 hours</option><option value="24" selected>24 hours</option><option value="72">3 days</option><option value="168">1 week</option>' +
        '</select>' +
        '<div id="wdr-err" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>' +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center; background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);" onclick="wdrSave(\'' + wdrEsc(itemId) + '\',\'' + wdrEsc(variantId) + '\')">🔒 Reserve</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal(); wdfOpenStockModal(\'' + wdrEsc(itemId) + '\')">Cancel</button>' +
        '</div>';
    wdfModal('🔒 Reserve Item', html);
};

window.wdrSave = async function (itemId, variantId) {
    var fail = function (m) { var e = wdrEl('wdr-err'); if (e) { e.textContent = m; e.style.display = 'block'; } };
    var qty = parseInt(wdrVal('wdr-qty'), 10);
    var name = wdrVal('wdr-name'), phone = wdrVal('wdr-phone');
    var hours = parseInt(wdrVal('wdr-hours'), 10) || 24;
    if (!(qty > 0)) return fail('Enter a quantity greater than 0.');
    var it = wdfItems[itemId], v = it && it.variants && it.variants[variantId];
    if (!v) return fail('Item not found.');
    if (qty > wdrAvailable(v)) return fail('Only ' + wdrAvailable(v) + ' available to reserve.');

    var holdId = 'h' + Date.now();
    var hold = {
        qty: qty, customerName: name, customerPhone: phone,
        at: wdrNow(), by: wdrUser(), expiresAt: wdrPlusHours(hours)
    };
    try {
        await firebase.database().ref('fashionItems/' + currentStoreId + '/' + itemId + '/variants/' + variantId + '/reserved/' + holdId).set(hold);
        wdfCloseModal();
        wdfOpenStockModal(itemId);
        alert('🔒 Reserved ' + qty + ' for ' + (name || 'customer') + ' until ' + wdrPretty(hold.expiresAt));
    } catch (e) { fail('Failed: ' + (e.message || e)); }
};

// ---------- release reserve ----------
window.wdrRelease = async function (itemId, variantId, holdId) {
    if (!confirm('Release this reservation? The units will be available to sell again.')) return;
    try {
        await firebase.database().ref('fashionItems/' + currentStoreId + '/' + itemId + '/variants/' + variantId + '/reserved/' + holdId).remove();
        wdfOpenStockModal(itemId);
    } catch (e) { alert('Failed: ' + (e.message || e)); }
};

// ---------- show reserved in stock modal ----------
var __wdrOrigStockModal = window.wdfOpenStockModal;
window.wdfOpenStockModal = function (itemId) {
    __wdrOrigStockModal.apply(this, arguments);
    // Append reserved info to the variant list, then re-render if we can
    setTimeout(function () {
        var it = wdfItems[itemId];
        if (!it) return;
        var list = document.querySelector('#wdf-modal');
        if (!list) return;
        // The stock modal already shows variants. We add a reserved row under each variant.
        var vs = wdfVariantsOf(it);
        var rows = document.querySelectorAll('#wdf-modal > div > div > div');
        // Instead of hacking DOM, append a "Reserved" section below the variant list.
        // Find the modal content div
        var content = document.querySelector('#wdf-modal > div');
        if (!content) return;
        // Check if we already added the section
        if (content.querySelector('#wdr-reserved-section')) return;
        var hasReserved = vs.some(function (v) { return Object.keys(v.reserved || {}).length > 0; });
        if (!hasReserved) return;
        var sec = document.createElement('div');
        sec.id = 'wdr-reserved-section';
        sec.style.cssText = 'background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px; margin-top:12px;';
        var html = '<div style="font-weight:bold; font-size:12px; color:#92400e;">🔒 Active Reservations</div>';
        vs.forEach(function (v) {
            var rsv = v.reserved || {};
            Object.keys(rsv).forEach(function (hid) {
                var r = rsv[hid];
                var left = wdrHoursLeft(r.expiresAt);
                html += '<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid #fde68a; font-size:12px;">' +
                    '<div><strong>' + wdrEsc([v.size, v.color].filter(Boolean).join(' · ')) + '</strong> × ' + r.qty +
                    '<div style="color:#92400e; font-size:11px;">' + (r.customerName ? wdrEsc(r.customerName) + ' · ' : '') + 'Expires ' + wdrPretty(r.expiresAt) + ' (' + (left > 0 ? left + 'h left' : 'expired') + ')</div></div>' +
                    '<button class="menu-btn" style="width:auto; margin:0; padding:4px 10px; font-size:11px; background:#fff; border:1px solid #fde68a; color:#92400e;" onclick="wdrRelease(\'' + wdrEsc(itemId) + '\',\'' + wdrEsc(v._id) + '\',\'' + wdrEsc(hid) + '\')">Release</button>' +
                '</div>';
            });
        });
        sec.innerHTML = html;
        content.appendChild(sec);
    }, 150);
};

// ---------- add reserve button to each variant in stock modal ----------
// Hook into wdfVariantsOf to display reserved units
var __wdrOrigVariantsOf = window.wdfVariantsOf;
if (typeof wdfVariantsOf === 'function') {
    window.wdfVariantsOf = function (it) {
        var vs = __wdrOrigVariantsOf ? __wdrOrigVariantsOf(it) : [];
        vs.forEach(function (v) {
            v._reserved = wdrReservedOf(v);
            v._available = wdrAvailable(v);
        });
        return vs;
    };
}

// Show reserved + available on stock rows (chips already show qty; we update the chip text)
var __wdrOrigChip = window.wdfChip;
if (typeof wdfChip === 'function') {
    window.wdfChip = function (v) {
        var q = wdrNum(v.qty);
        var r = wdrReservedOf(v);
        var a = Math.max(0, q - r);
        var c = a <= 0 ? ['#f1f5f9', '#94a3b8'] : (a === 1 ? ['#fef3c7', '#92400e'] : ['#e0f2fe', '#075985']);
        var reservedTag = r > 0 ? ' <span style="background:#fde68a; color:#92400e; padding:0 4px; border-radius:4px; font-size:9px;">🔒' + r + '</span>' : '';
        return '<span style="display:inline-block; margin:2px; padding:2px 7px; border-radius:8px; font-size:11px; background:' + c[0] + '; color:' + c[1] + ';">' + wdfVariantLabel(v) + ' ×' + a + reservedTag + '</span>';
    };
}

// Disallow adding reserved units to cart
var __wdrOrigLiveQty = window.wdfLiveQty;
if (typeof wdfLiveQty === 'function') {
    window.wdfLiveQty = function (itemId, variantId) {
        var it = wdfItems[itemId], v = it && it.variants && it.variants[variantId];
        if (!v) return 0;
        return wdrAvailable(v);
    };
}

// Add Reserve button to the stock modal variant list
// We wrap wdfOpenStockModal to inject a Reserve button per variant
(function () {
    var orig = window.wdfOpenStockModal;
    window.wdfOpenStockModal = function (itemId) {
        orig.apply(this, arguments);
        setTimeout(function () {
            var it = wdfItems[itemId];
            if (!it) return;
            var content = document.querySelector('#wdf-modal > div');
            if (!content) return;
            // Find the variant list (first list of variants rendered by the original modal)
            // We inject Reserve buttons by finding rows with variant labels
            var vs = wdfVariantsOf(it);
            // Walk through the first children of content to find the list section
            var listDiv = content.querySelectorAll('div[style*="border-bottom:1px solid #f1f5f9"]');
            // Simpler approach: append a "Quick reserve" section after the add-size section
            if (content.querySelector('#wdr-quick-reserve')) return;
            var sec = document.createElement('div');
            sec.id = 'wdr-quick-reserve';
            sec.style.cssText = 'background:#fffbeb; border:1px solid #fde68a; border-radius:10px; padding:10px; margin-top:12px;';
            var opts = vs.filter(function (v) { return wdrAvailable(v) > 0; }).map(function (v) {
                return '<option value="' + wdrEsc(v._id) + '">' + wdrEsc([v.size, v.color].filter(Boolean).join(' · ')) + ' (' + wdrAvailable(v) + ' avail)</option>';
            }).join('');
            if (!opts) return;
            sec.innerHTML =
                '<div style="font-weight:bold; font-size:12px; color:#92400e;">🔒 Quick Reserve</div>' +
                '<select id="wdr-quick-var" style="' + WDF_INP + ' margin-top:6px;">' + opts + '</select>' +
                '<button class="menu-btn" style="width:auto; margin:8px 0 0; padding:6px 12px; background:#f59e0b; color:#fff; border:none; font-weight:bold;" onclick="(function(){var v=document.getElementById(\'wdr-quick-var\').value; wdfCloseModal(); wdrOpenReserve(\'' + wdrEsc(itemId) + '\', v);})()">Reserve</button>';
            content.appendChild(sec);
        }, 200);
    };
})();
