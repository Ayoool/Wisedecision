// ==================== WISE DECISION RECEIPT QR CODE PATCH (v7) ====================
// Load AFTER store-logo-patch.js.
//
// v7: Store name, address, and phone are now read directly from Firebase
//     (stores/{storeId}) instead of scraped from the receipt DOM. This fixes the
//     bug where the placeholder "WISE DECISION" was published before the real
//     store name finished loading from the database.

console.log("Wise Decision receipt-qr-patch.js — v7 loaded");

// ---------- QR library loading (eager + multi-CDN fallback) ----------
var wdqLibReady = null;

function wdqLoadLibOnce() {
    if (wdqLibReady) return wdqLibReady;
    wdqLibReady = new Promise(function (resolve, reject) {
        if (window.qrcode) return resolve(window.qrcode);

        var cdns = [
            'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js',
            'https://unpkg.com/qrcode-generator@1.4.4/qrcode.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'
        ];
        var idx = 0;
        function tryNext() {
            if (idx >= cdns.length) return reject(new Error('All QR CDNs failed.'));
            var s = document.createElement('script');
            s.src = cdns[idx++];
            s.onload = function () {
                if (window.qrcode) resolve(window.qrcode);
                else tryNext();
            };
            s.onerror = function () { tryNext(); };
            document.head.appendChild(s);
        }
        tryNext();
    });
    return wdqLibReady;
}

// ---------- Store info cache (fetched once per session) ----------
var wdqStoreInfo = null;
function wdqFetchStoreInfo() {
    if (wdqStoreInfo) return Promise.resolve(wdqStoreInfo);
    return new Promise(function (resolve) {
        try {
            if (typeof firebase === 'undefined' || !firebase.database || typeof currentStoreId === 'undefined' || !currentStoreId) {
                return resolve({ name: '', address: '', phone: '' });
            }
            firebase.database().ref('stores/' + currentStoreId).once('value')
                .then(function (snap) {
                    var s = snap.val() || {};
                    wdqStoreInfo = {
                        name: s.businessName || s.name || '',
                        address: s.address || '',
                        phone: s.phone || ''
                    };
                    resolve(wdqStoreInfo);
                })
                .catch(function () { resolve({ name: '', address: '', phone: '' }); });
        } catch (e) { resolve({ name: '', address: '', phone: '' }); }
    });
}

// ---------- Generate random code ----------
function wdqRandomCode() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var out = '';
    for (var i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

// ---------- Build absolute verify URL ----------
function wdqBuildVerifyUrl(code) {
    var origin = window.location.origin;
    var path = window.location.pathname;
    var dir = path.replace(/\/[^\/]*$/, '/');
    return origin + dir + 'verify.html?c=' + code;
}

// ---------- Text helpers ----------
function wdqText(el) { return el ? String(el.textContent || '').trim() : ''; }
function wdqNumFromText(s) {
    if (!s) return 0;
    var cleaned = String(s).replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
}

// ---------- Scrape receipt data (items & totals from DOM; store info from Firebase) ----------
function wdqScrapeReceipt(container, storeInfo) {
    // Receipt ID
    var idCandidates = ['#receipt-tx-id', '#debt-receipt-tx-id', '#refund-receipt-id', '#waybill-id'];
    var receiptId = '';
    for (var i = 0; i < idCandidates.length && !receiptId; i++) {
        var t = wdqText(container.querySelector(idCandidates[i]));
        if (t && t !== '--' && !/000000/.test(t)) receiptId = t;
    }
    if (!receiptId) {
        var all = container.textContent || '';
        var m = all.match(/\b(WD-\d{6}|FS-\d{6}|RF-\d{6}|PMT-\d{6}|LW-\d{6})\b/);
        if (m) receiptId = m[1];
    }
    if (!receiptId) return null;

    // Date
    var dateStr = wdqText(container.querySelector('#receipt-date, #debt-receipt-date, #refund-receipt-date, #waybill-date'));
    var dateIso = new Date().toISOString();
    if (dateStr && dateStr !== '--') {
        var parsed = new Date(dateStr);
        if (!isNaN(parsed)) dateIso = parsed.toISOString();
    }

    // Total
    var totalStr = wdqText(container.querySelector('#receipt-grand-total, #debt-receipt-amount-paid, #refund-receipt-total'));
    var total = wdqNumFromText(totalStr);
    if (!total) {
        var totalLine = (container.textContent || '').match(/TOTAL[:\s]+₦?([\d,]+\.?\d*)/i);
        if (totalLine) total = wdqNumFromText(totalLine[1]);
    }

    // Items
    var items = [];
    var itemRows = container.querySelectorAll('#receipt-items-body tr, #refund-receipt-items-body tr');
    if (itemRows.length) {
        itemRows.forEach(function (row) {
            var cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
                var name = wdqText(cells[0]).replace(/\s+/g, ' ');
                var qty = wdqText(cells[1]);
                if (name) items.push({ name: name, qty: qty });
            }
        });
    }

    // Customer
    var customer = wdqText(container.querySelector('#debt-receipt-customer-name'));
    if (customer === '--' || customer === 'Walk-in Customer') customer = '';

    return {
        storeName: storeInfo.name || 'Store',
        address:   storeInfo.address || '',
        phone:     storeInfo.phone || '',
        receiptId: receiptId,
        date:      dateIso,
        total:     total,
        customer:  customer,
        items:     items
    };
}

// ---------- Publish public receipt to Firebase ----------
function wdqPublish(code, data) {
    try {
        if (typeof firebase === 'undefined' || !firebase.database) return Promise.resolve(false);
        return firebase.database().ref('publicReceipts/' + code).set({
            storeName: data.storeName,
            address: data.address,
            phone: data.phone,
            receiptId: data.receiptId,
            date: data.date,
            total: data.total,
            customer: data.customer,
            items: data.items,
            publishedAt: new Date().toISOString()
        }).then(function () { return true; }).catch(function () { return false; });
    } catch (e) { return Promise.resolve(false); }
}

// ---------- Render QR ----------
function wdqRenderQR(holder, url) {
    wdqLoadLibOnce().then(function (qrFactory) {
        try {
            var qr = qrFactory(0, 'M');
            qr.addData(url);
            qr.make();
            var dataUrl = qr.createDataURL(4, 2);
            holder.innerHTML = '';
            var img = document.createElement('img');
            img.src = dataUrl;
            img.alt = '';
            img.style.cssText = 'display:block; margin:0 auto; width:140px; height:140px; image-rendering:pixelated;';
            holder.appendChild(img);
        } catch (e) {
            console.error('[qr] render failed:', e);
            holder.innerHTML = '<div style="font-size:9px;color:#991b1b;">QR error</div>';
        }
    }).catch(function (e) {
        console.error('[qr] library failed:', e);
        holder.innerHTML = '<div style="font-size:9px;color:#991b1b;">QR unavailable</div>';
    });
}

// ---------- Visibility check ----------
function wdqIsVisible(el) {
    var node = el;
    while (node) {
        if (node.style && node.style.display === 'none') return false;
        node = node.parentElement;
    }
    return true;
}

// ---------- Targets ----------
var WDQ_TARGETS = [
    'printable-receipt-box',
    'printable-debt-receipt-box',
    'printable-refund-receipt-box',
    'printable-waybill-box',
    'wdf-printable',
    'wdp-printable'
];

var wdqDone = {};

// ---------- Inject per-container ----------
function wdqInject(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    if (!wdqIsVisible(container)) return;

    // Skip if this container already shows a QR
    if (container.querySelector('.wdq-qr-wrap')) {
        // But if the receipt ID has changed, remove and reprocess
        var existingId = wdqDone[containerId] && wdqDone[containerId].receiptId;
        var currentId = wdqText(container.querySelector('#receipt-tx-id, #debt-receipt-tx-id, #refund-receipt-id, #waybill-id'));
        if (existingId && currentId && existingId === currentId) return;
        container.querySelector('.wdq-qr-wrap').remove();
    }

    // Fetch store info from Firebase (cached after first call), then build & publish
    wdqFetchStoreInfo().then(function (storeInfo) {
        var data = wdqScrapeReceipt(container, storeInfo);
        if (!data) return;
        if (wdqDone[containerId] && wdqDone[containerId].receiptId === data.receiptId) return;

        var code = wdqRandomCode();
        var url = wdqBuildVerifyUrl(code);

        var wrap = document.createElement('div');
        wrap.className = 'wdq-qr-wrap';
        wrap.style.cssText =
            'text-align:center; margin-top:12px; padding-top:8px; ' +
            'border-top:1px dashed #ccc; font-family:monospace;';
        var holderId = 'wdq-qr-' + containerId;
        wrap.innerHTML =
            '<div style="font-size:9px; color:#555; letter-spacing:0.5px; margin-bottom:4px;">SCAN TO VERIFY</div>' +
            '<div id="' + holderId + '" style="display:inline-block; padding:3px; background:#fff; min-width:140px; min-height:140px;"></div>' +
            '<div style="font-size:9px; color:#888; margin-top:4px;">' + data.receiptId + '</div>';

        container.appendChild(wrap);

        var holder = document.getElementById(holderId);
        if (holder) wdqRenderQR(holder, url);

        wdqDone[containerId] = { receiptId: data.receiptId, code: code };
        wdqPublish(code, data);
    });
}

// ---------- Scan all ----------
function wdqScan() {
    WDQ_TARGETS.forEach(wdqInject);
}

// ---------- Init ----------
function wdqAttach() {
    try { wdqScan(); } catch (e) { /* silent */ }
}

window.addEventListener('load', function () {
    wdqLoadLibOnce().then(function () {
        console.log('[qr] library ready');
        wdqAttach();
    }).catch(function (e) {
        console.error('[qr] library could not be loaded from any CDN:', e);
    });

    setTimeout(wdqAttach, 1500);
    var obs = new MutationObserver(function () {
        if (window.__wdqSched) return;
        window.__wdqSched = true;
        setTimeout(function () {
            window.__wdqSched = false;
            wdqScan();
        }, 200);
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
});
