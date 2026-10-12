// ==================== WISE DECISION BARCODE / QR PATCH (v1) ====================
// Load AFTER fashion-patch.js
//
// Adds:
//   • Auto-generated barcode per variant (short code based on item code + variant)
//   • "Scan Barcode" input on the Sell screen — type/scan to add to cart
//   • "Print Labels" for a whole item (or a whole category)
//   • Uses JsBarcode (auto-loaded from CDN if missing)
//
// Data lives INSIDE the variant:
//   fashionItems/{storeId}/{itemId}/variants/{variantId}/barcode = "WD-XXXX-YY"
//   If a variant doesn't have a barcode, we generate one on demand and save it.

console.log("Wise Decision barcode-patch.js — v1 loaded");

function wdbEl(id) { return document.getElementById(id); }
function wdbNum(n) { return Number(n) || 0; }
function wdbEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

// ---------- Load JsBarcode if needed ----------
function wdbLoadJsBarcode() {
    return new Promise(function (resolve, reject) {
        if (window.JsBarcode) return resolve(window.JsBarcode);
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
        s.onload = function () { resolve(window.JsBarcode); };
        s.onerror = function () { reject(new Error('Could not load JsBarcode library. Check your internet connection.')); };
        document.head.appendChild(s);
    });
}

// ---------- Barcode generation ----------
// Short, human-readable, still unique. Uses a 6-char base36 of the variant key.
function wdbMakeBarcode(itemCode, itemId, variantId) {
    // Use itemCode prefix if provided, else "WD"
    var prefix = (itemCode || 'WD').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (!prefix) prefix = 'WD';
    // Derive a short suffix from the variant id (last 4 chars are often unique)
    var suffix = String(variantId || '').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
    // Fallback: derive from item id
    if (suffix.length < 4) suffix = String(itemId || '').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
    return prefix + '-' + suffix;
}

// Ensure a variant has a barcode; if not, generate and save it.
async function wdbEnsureBarcode(itemId, variantId, silent) {
    var it = wdfItems[itemId], v = it && it.variants && it.variants[variantId];
    if (!v) return null;
    if (v.barcode) return v.barcode;
    var code = wdbMakeBarcode(it.code, itemId, variantId);
    try {
        await firebase.database().ref('fashionItems/' + currentStoreId + '/' + itemId + '/variants/' + variantId + '/barcode').set(code);
        if (v) v.barcode = code;
        return code;
    } catch (e) {
        if (!silent) console.warn('Barcode save failed:', e);
        return code;
    }
}

// ---------- Build an index of barcode -> {itemId, variantId} ----------
function wdbIndex() {
    var idx = {};
    wdfItemList().forEach(function (it) {
        wdfVariantsOf(it).forEach(function (v) {
            if (v.barcode) idx[v.barcode.toUpperCase()] = { itemId: it._id, variantId: v._id, item: it, variant: v };
        });
    });
    return idx;
}

// ---------- Scan handler ----------
window.wdbScanLookup = function (raw) {
    var code = String(raw || '').trim().toUpperCase();
    if (!code) return null;
    var idx = wdbIndex();
    if (idx[code]) return idx[code];
    // Also try matching without the dash
    var alt = code.replace(/-/g, '');
    for (var k in idx) {
        if (k.replace(/-/g, '') === alt) return idx[k];
    }
    return null;
};

window.wdbHandleScan = function (input) {
    var raw = input.value || '';
    var hit = wdbScanLookup(raw);
    var status = wdbEl('wdb-scan-status');
    if (!hit) {
        if (status) { status.style.display = 'block'; status.style.background = '#fef2f2'; status.style.color = '#991b1b'; status.textContent = '✕ No match for "' + raw + '"'; }
        return;
    }
    if (wdrReservedOf && wdrAvailable && wdrAvailable(hit.variant) <= 0) {
        if (status) { status.style.display = 'block'; status.style.background = '#fef3c7'; status.style.color = '#92400e'; status.textContent = '⚠ All units reserved or out of stock.'; }
        return;
    }
    window.wdfAddToCart(hit.itemId, hit.variantId);
    input.value = '';
    if (status) { status.style.display = 'block'; status.style.background = '#f0fdf4'; status.style.color = '#166534'; status.textContent = '✓ Added ' + hit.item.name + ' (' + [hit.variant.size, hit.variant.color].filter(Boolean).join(', ') + ')'; }
    setTimeout(function () { if (status) status.style.display = 'none'; }, 2500);
    input.focus();
};

// ---------- Inject scan input on Sell screen ----------
var __wdbOrigShowSell = window.wdfShowSell;
window.wdfShowSell = function () {
    __wdbOrigShowSell.apply(this, arguments);
    setTimeout(function () {
        var ws = wdbEl('workspace-content');
        if (!ws) return;
        if (wdbEl('wdb-scan-wrap')) return;
        // Insert scan box above the cart
        var cart = wdbEl('wdf-cart');
        if (!cart) return;
        var wrap = document.createElement('div');
        wrap.id = 'wdb-scan-wrap';
        wrap.style.cssText = 'background:#fff; padding:12px; border-radius:12px; border:1px solid #eef2f7; margin-bottom:12px; display:flex; gap:8px; flex-wrap:wrap; align-items:center;';
        wrap.innerHTML =
            '<span style="font-size:20px;">📷</span>' +
            '<input id="wdb-scan" type="text" placeholder="Scan or type barcode, then press Enter..." style="flex:1; min-width:200px; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; font-family:monospace;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();wdbHandleScan(this);}">' +
            '<button class="menu-btn" style="width:auto; margin:0; padding:8px 14px; font-size:12px; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdbHandleScan(document.getElementById(\'wdb-scan\'))">Look Up</button>' +
            '<div id="wdb-scan-status" style="display:none; width:100%; padding:6px 10px; border-radius:8px; font-size:12px;"></div>';
        cart.parentNode.insertBefore(wrap, cart);
        // Focus after a short delay so user can immediately scan
        setTimeout(function () { var i = wdbEl('wdb-scan'); if (i) i.focus(); }, 100);
    }, 150);
};

// ---------- Barcode view for a single variant ----------
window.wdbShowBarcode = async function (itemId, variantId) {
    var it = wdfItems[itemId], v = it && it.variants && it.variants[variantId];
    if (!v) return;
    var code = await wdbEnsureBarcode(itemId, variantId);
    if (!code) { alert('Could not generate barcode.'); return; }
    var html =
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; font-size:13px;">' +
            '<div><strong>' + wdbEsc(it.name) + '</strong></div>' +
            '<div style="color:#64748b; margin-top:3px;">' + wdbEsc([v.size, v.color].filter(Boolean).join(' · ')) + '</div>' +
        '</div>' +
        '<div id="wdb-bc-render" style="text-align:center; margin:20px 0; padding:16px; background:#fff; border:1px solid #e2e8f0; border-radius:10px;">' +
            '<svg id="wdb-bc-svg"></svg>' +
            '<div style="font-family:monospace; font-size:14px; margin-top:8px;">' + wdbEsc(code) + '</div>' +
        '</div>' +
        '<div style="display:flex; gap:10px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdbPrintBarcode()">🖨 Print</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Close</button>' +
        '</div>';
    wdfModal('🏷 Barcode', html, 440);
    try {
        var JsBarcode = await wdbLoadJsBarcode();
        JsBarcode('#wdb-bc-svg', code, { format: 'CODE128', displayValue: false, width: 2, height: 70, margin: 8 });
    } catch (e) { alert(e.message); }
};

window.wdbPrintBarcode = function () {
    var svg = wdbEl('wdb-bc-svg');
    if (!svg) return;
    var w = window.open('', '_blank');
    w.document.write('<html><head><title>Print Barcode</title><style>body{font-family:monospace; text-align:center; padding:20px;}</style></head><body>' +
        '<div>' + svg.outerHTML + '</div>' +
        '<div style="font-size:14px; margin-top:8px;">' + (svg.getAttribute('data-code') || '') + '</div>' +
        '<script>window.onload=function(){setTimeout(function(){window.print();},300);};<\/script></body></html>');
    w.document.close();
};

// ---------- Print all labels for an item ----------
window.wdbPrintLabels = async function (itemId) {
    var it = wdfItems[itemId];
    if (!it) return;
    var vs = wdfVariantsOf(it);
    if (!vs.length) { alert('No sizes to print.'); return; }
    var JsBarcode;
    try { JsBarcode = await wdbLoadJsBarcode(); } catch (e) { alert(e.message); return; }
    // Ensure all variants have a barcode
    var codes = [];
    for (var i = 0; i < vs.length; i++) {
        var code = await wdbEnsureBarcode(itemId, vs[i]._id, true);
        codes.push({ v: vs[i], code: code });
    }
    var w = window.open('', '_blank');
    var html = '<html><head><title>Labels - ' + wdbEsc(it.name) + '</title><style>' +
        'body{font-family:monospace; margin:10px;}' +
        '.label{display:inline-block; width:180px; padding:6px; border:1px dashed #ccc; margin:4px; text-align:center; vertical-align:top;}' +
        '.label .name{font-size:10px; font-weight:bold; margin-bottom:2px; overflow:hidden; height:24px;}' +
        '.label .variant{font-size:9px; color:#555; margin-bottom:2px;}' +
        '.label svg{max-width:100%; height:50px;}' +
        '.label .code{font-size:10px; margin-top:2px;}' +
        '.label .price{font-size:11px; font-weight:bold; margin-top:2px;}' +
        '@media print { .label { page-break-inside: avoid; } }' +
        '</style></head><body>';
    codes.forEach(function (c, idx) {
        html += '<div class="label">' +
            '<div class="name">' + wdbEsc(it.name) + '</div>' +
            '<div class="variant">' + wdbEsc([c.v.size, c.v.color].filter(Boolean).join(' · ')) + '</div>' +
            '<svg id="bc' + idx + '"></svg>' +
            '<div class="code">' + wdbEsc(c.code) + '</div>' +
            '<div class="price">' + (window.formatMoney ? window.formatMoney(it.sellingPrice) : '₦' + it.sellingPrice) + '</div>' +
            '</div>';
    });
    html += '<script>window.onload=function(){';
    codes.forEach(function (c, idx) {
        html += 'JsBarcode("#bc' + idx + '",' + JSON.stringify(c.code) + ',{format:"CODE128",displayValue:false,width:1.5,height:40,margin:2});';
    });
    html += 'setTimeout(function(){window.print();},500);};<\/script>';
    // Inject JsBarcode script
    html += '<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>';
    html += '</body></html>';
    w.document.write(html);
    w.document.close();
};

// ---------- Add Barcode buttons to the stock modal ----------
(function () {
    var orig = window.wdfOpenStockModal;
    window.wdfOpenStockModal = function (itemId) {
        orig.apply(this, arguments);
        setTimeout(function () {
            var it = wdfItems[itemId];
            if (!it) return;
            var content = document.querySelector('#wdf-modal > div');
            if (!content) return;
            if (content.querySelector('#wdb-label-section')) return;
            var sec = document.createElement('div');
            sec.id = 'wdb-label-section';
            sec.style.cssText = 'background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px; padding:10px; margin-top:12px;';
            sec.innerHTML =
                '<div style="font-weight:bold; font-size:12px; color:#075985;">🏷 Barcodes</div>' +
                '<div style="font-size:11px; color:#0c4a6e; margin-top:3px;">Print labels for all sizes, or view a single variant barcode.</div>' +
                '<button class="menu-btn" style="width:auto; margin:8px 0 0; padding:6px 12px; background:#0ea5e9; color:#fff; border:none; font-weight:bold;" onclick="wdbPrintLabels(\'' + wdbEsc(itemId) + '\')">🖨 Print all labels</button>';
            content.appendChild(sec);
        }, 200);
    };
})();

// ---------- Ensure barcodes exist for all variants on data load ----------
// Run lazily: when the sell screen renders, make sure items have barcodes.
function wdbBackfillBarcodes() {
    if (typeof wdfStoreType === 'undefined' || wdfStoreType !== 'fashion') return;
    if (!wdfItemList) return;
    wdfItemList().forEach(function (it) {
        wdfVariantsOf(it).forEach(function (v) {
            if (!v.barcode) wdbEnsureBarcode(it._id, v._id, true);
        });
    });
}
setInterval(wdbBackfillBarcodes, 8000);
