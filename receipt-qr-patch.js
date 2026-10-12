// ==================== WISE DECISION RECEIPT QR CODE PATCH (v2) ====================
// Load AFTER store-logo-patch.js.
//
// What this does:
//   1. Detects when a receipt is displayed on screen
//   2. Reads the receipt content from the DOM (store, total, items)
//   3. Generates a short random public code (8 characters)
//   4. Writes a scrubbed public copy to `publicReceipts/{code}` in Firebase
//   5. Renders a QR pointing to verify.html?c={code} so customers can scan it
//
// The public copy contains ONLY:
//   storeName, address, phone, receiptId, date, total, customer (name only), items[name,qty]
//   NO customer phone, NO cost prices, NO internal notes, NO balance owed, NO profit.

console.log("Wise Decision receipt-qr-patch.js — v2 loaded");

// ---------- CONFIG ----------
var WDQ_VERIFY_PATH = 'verify.html';   // relative to app.html on same origin

// ---------- Load QR library on demand ----------
function wdqLoadLib() {
    return new Promise(function (resolve, reject) {
        if (window.qrcode) return resolve(window.qrcode);
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
        s.onload = function () {
            if (window.qrcode) resolve(window.qrcode);
            else reject(new Error('QR library did not initialise.'));
        };
        s.onerror = function () { reject(new Error('Could not load QR library.')); };
        document.head.appendChild(s);
    });
}

// ---------- Generate random code ----------
function wdqRandomCode() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var out = '';
    for (var i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}

// ---------- Text helpers ----------
function wdqText(el) { return el ? String(el.textContent || '').trim() : ''; }
function wdqNumFromText(s) {
    if (!s) return 0;
    var cleaned = String(s).replace(/[^0-9.]/g, '');
    return parseFloat(cleaned) || 0;
}

// ---------- Extract receipt data from the DOM ----------
function wdqScrapeReceipt(container) {
    // Store info
    var storeName = wdqText(container.querySelector('#receipt-store-name, #debt-receipt-store-name, #refund-receipt-store-name, #wdf-r-store, #wdp-r-store'));
    var address   = wdqText(container.querySelector('#receipt-store-address, #debt-receipt-store-address, #refund-receipt-store-address, #wdf-r-addr, #wdp-r-addr'));
    var phone     = wdqText(container.querySelector('#receipt-store-phone, #debt-receipt-store-phone, #refund-receipt-store-phone, #wdf-r-tel, #wdp-r-tel'));

    // Receipt identifier
    var idCandidates = [
        '#receipt-tx-id', '#debt-receipt-tx-id', '#refund-receipt-id', '#waybill-id'
    ];
    var receiptId = '';
    for (var i = 0; i < idCandidates.length && !receiptId; i++) {
        var t = wdqText(container.querySelector(idCandidates[i]));
        if (t && t !== '--' && !/000000/.test(t)) receiptId = t;
    }
    if (!receiptId) {
        // Fallback: scan entire receipt text for a pattern
        var all = container.textContent || '';
        var m = all.match(/\b(WD-\d{6}|FS-\d{6}|RF-\d{6}|PMT-\d{6}|LW-\d{6})\b/);
        if (m) receiptId = m[1];
    }
    if (!receiptId) return null;   // can't publicise a receipt without an ID

    // Date
    var dateStr = wdqText(container.querySelector('#receipt-date, #debt-receipt-date, #refund-receipt-date, #waybill-date'));
    var dateIso = new Date().toISOString();
    if (dateStr && dateStr !== '--') {
        var parsed = new Date(dateStr);
        if (!isNaN(parsed)) dateIso = parsed.toISOString();
    }

    // Total
    var totalStr = wdqText(container.querySelector('#receipt-grand-total, #debt-receipt-amount-paid, #refund-receipt-total, #wdp-r-body'));
    var total = wdqNumFromText(totalStr);
    // Try harder for main POS: search for "TOTAL:" line
    if (!total) {
        var totalLine = (container.textContent || '').match(/TOTAL[:\s]+₦?([\d,]+\.?\d*)/i);
        if (totalLine) total = wdqNumFromText(totalLine[1]);
    }

    // Items (best-effort — varies by receipt type)
    var items = [];
    // Main POS items table
    var itemRows = container.querySelectorAll('#receipt-items-body tr, #refund-receipt-items-body tr');
    if (itemRows.length) {
        itemRows.forEach(function (row) {
            var cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
                var name = wdqText(cells[0]).replace(/\s+/g, ' ');
                var qty = wdqText(cells[1]);
                if (name) items.push({ name: name, qty: qty });
            } else if (cells.length === 1) {
                var txt = wdqText(cells[0]);
                if (txt) items.push({ name: txt, qty: '' });
            }
        });
    }
    // Fashion / Water receipts: lines inside the receipt body
    if (!items.length) {
        var bodyEl = container.querySelector('#wdf-r-body, #wdp-r-body');
        if (bodyEl) {
            bodyEl.querySelectorAll('div').forEach(function (d) {
                var txt = (d.textContent || '').trim();
                var m = txt.match(/^(\d+)\s*[×x]\s*(.+)$/);
                if (m && m[2]) items.push({ name: m[2].trim(), qty: m[1] });
            });
        }
    }

    // Customer name only (never phone)
    var customer = wdqText(container.querySelector('#debt-receipt-customer-name'));
    if (!customer) {
        // Look for "Customer:" line in the receipt body
        var custLine = (container.textContent || '').match(/Customer:\s*([^\n]+)/i);
        if (custLine) customer = custLine[1].trim().split('·')[0].trim();
    }
    if (customer === '--' || customer === 'Walk-in Customer') customer = '';

    return {
        storeName: storeName || 'Store',
        address: address || '',
        phone: phone ? phone.replace(/^Tel:\s*/i, '') : '',
        receiptId: receiptId,
        date: dateIso,
        total: total,
        customer: customer,
        items: items
    };
}

// ---------- Write the scrubbed copy to Firebase ----------
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

// ---------- Render the QR ----------
function wdqRenderQR(holder, url) {
    wdqLoadLib().then(function (qrFactory) {
        try {
            var qr = qrFactory(0, 'M');
            qr.addData(url);
            qr.make();
            holder.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
            var svg = holder.querySelector('svg');
            if (svg) {
                svg.setAttribute('width', '96');
                svg.setAttribute('height', '96');
                svg.style.display = 'block';
                svg.style.margin = '0 auto';
            }
        } catch (e) {
            holder.innerHTML = '<div style="font-size:9px;color:#991b1b;">QR unavailable</div>';
        }
    }).catch(function () {
        holder.innerHTML = '';
    });
}

// ---------- Check whether a container is visible on screen ----------
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

// ---------- Cache: containerId -> { receiptId, code } ----------
var wdqDone = {};

// ---------- Main per-container routine ----------
function wdqInject(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    if (!wdqIsVisible(container)) return;

    var data = wdqScrapeReceipt(container);
    if (!data) return;

    // Already handled this exact receipt in this container?
    if (wdqDone[containerId] && wdqDone[containerId].receiptId === data.receiptId) return;

    // Remove any stale QR from a previous receipt
    var existing = container.querySelector('.wdq-qr-wrap');
    if (existing) existing.remove();

    // Generate a fresh code and try to publish
    var code = wdqRandomCode();
    var url = WDQ_VERIFY_PATH + '?c=' + code;

    // Create the wrapper with a placeholder
    var wrap = document.createElement('div');
    wrap.className = 'wdq-qr-wrap';
    wrap.style.cssText =
        'text-align:center; margin-top:12px; padding-top:8px; ' +
        'border-top:1px dashed #ccc; font-family:monospace;';
    var holderId = 'wdq-qr-' + containerId;
    wrap.innerHTML =
        '<div style="font-size:9px; color:#555; letter-spacing:0.5px; margin-bottom:4px;">SCAN TO VERIFY</div>' +
        '<div id="' + holderId + '" style="display:inline-block; padding:3px; background:#fff;"></div>' +
        '<div style="font-size:9px; color:#888; margin-top:4px;">' + data.receiptId + '</div>';

    container.appendChild(wrap);

    var holder = document.getElementById(holderId);
    if (holder) wdqRenderQR(holder, url);

    wdqDone[containerId] = { receiptId: data.receiptId, code: code };

    // Publish asynchronously — the QR is already on screen with the URL.
    wdqPublish(code, data);
}

// ---------- Scan all targets ----------
function wdqScan() {
    WDQ_TARGETS.forEach(wdqInject);
}

// ---------- Init ----------
function wdqAttach() {
    try { wdqScan(); } catch (e) { /* silent */ }
}

window.addEventListener('load', function () {
    setTimeout(wdqAttach, 1200);
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
