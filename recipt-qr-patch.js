// ==================== WISE DECISION RECEIPT QR CODE PATCH (v1) ====================
// Load AFTER store-logo-patch.js.
// Adds a small QR code to the footer of every receipt. Scanning it opens a link
// back into the app with the receipt ID pre-filled, so staff can pull up the sale
// instantly on any device signed into the same store.
//
// Works on all receipt types:
//   • Main POS sale       (printable-receipt-box)
//   • Debt repayment      (printable-debt-receipt-box)
//   • Refund              (printable-refund-receipt-box)
//   • Stock transfer      (printable-waybill-box)
//   • Fashion sale        (wdf-printable)
//   • Water/Distributor   (wdp-printable)

console.log("Wise Decision receipt-qr-patch.js — v1 loaded");

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

// ---------- Extract the receipt ID from a container ----------
function wdqReadId(container, explicitElId) {
    // 1) Try the specific ID element (e.g. <span id="receipt-tx-id">WD-001653</span>)
    if (explicitElId) {
        var el = document.getElementById(explicitElId);
        if (el) {
            var txt = (el.textContent || '').trim();
            if (txt && txt !== '--' && txt !== 'WD-000000' && txt !== 'PMT-000000' && txt !== 'RF-000000') {
                return txt;
            }
        }
    }
    // 2) Fallback: scan the whole container text for a receipt-ID pattern
    var text = container.textContent || '';
    var m = text.match(/\b(WD-\d{6}|FS-\d{6}|RF-\d{6}|PMT-\d{6}|LW-\d{6}|SUP-\d{6}|WB-\d{6})\b/);
    return m ? m[1] : null;
}

// ---------- Build the deep-link URL ----------
function wdqBuildUrl(receiptId) {
    // Base the URL on the current page so it works on any deployment (localhost, gh-pages, custom domain)
    var base = window.location.origin + window.location.pathname;
    return base + '?receipt=' + encodeURIComponent(receiptId);
}

// ---------- Render the QR into a holder element ----------
function wdqRender(holder, url) {
    wdqLoadLib().then(function (qrFactory) {
        try {
            var qr = qrFactory(0, 'M');   // type 0 = auto-detect size, M = medium error correction
            qr.addData(url);
            qr.make();
            holder.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 1, scalable: true });
            // Ensure the SVG scales nicely inside the receipt
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

// ---------- Check whether an element is actually visible ----------
function wdqIsVisible(el) {
    var node = el;
    while (node) {
        if (node.style && node.style.display === 'none') return false;
        node = node.parentElement;
    }
    return true;
}

// ---------- Cache of { containerId -> receiptId } so we don't re-render every mutation ----------
var wdqDone = {};

// ---------- Targets: every receipt container we want to augment ----------
var WDQ_TARGETS = [
    { c: 'printable-receipt-box',        id: 'receipt-tx-id' },
    { c: 'printable-debt-receipt-box',   id: 'debt-receipt-tx-id' },
    { c: 'printable-refund-receipt-box', id: 'refund-receipt-id' },
    { c: 'printable-waybill-box',        id: 'waybill-id' },
    { c: 'wdf-printable',                id: null },
    { c: 'wdp-printable',                id: null }
];

// ---------- Inject the QR into one container ----------
function wdqInject(containerId, idSourceEl) {
    var container = document.getElementById(containerId);
    if (!container) return;
    if (!wdqIsVisible(container)) return;

    var receiptId = wdqReadId(container, idSourceEl);
    if (!receiptId) return;

    // Same receipt already rendered in this container? Nothing to do.
    if (wdqDone[containerId] === receiptId) return;

    // Remove any stale QR from a previous receipt
    var existing = container.querySelector('.wdq-qr-wrap');
    if (existing) existing.remove();

    // Create the wrapper (with a dashed separator so it looks intentional, not bolted on)
    var wrap = document.createElement('div');
    wrap.className = 'wdq-qr-wrap';
    wrap.style.cssText =
        'text-align:center; margin-top:12px; padding-top:8px; ' +
        'border-top:1px dashed #ccc; font-family:monospace;';
    var holderId = 'wdq-qr-' + containerId;
    wrap.innerHTML =
        '<div style="font-size:9px; color:#555; letter-spacing:0.5px; margin-bottom:4px;">SCAN TO VERIFY</div>' +
        '<div id="' + holderId + '" style="display:inline-block; padding:3px; background:#fff;"></div>' +
        '<div style="font-size:9px; color:#888; margin-top:4px;">' + receiptId + '</div>';

    container.appendChild(wrap);

    var holder = document.getElementById(holderId);
    if (!holder) return;
    wdqRender(holder, wdqBuildUrl(receiptId));
    wdqDone[containerId] = receiptId;
}

// ---------- Scan all targets (called on DOM changes) ----------
function wdqScan() {
    WDQ_TARGETS.forEach(function (t) { wdqInject(t.c, t.id); });
}

// ---------- Deep-link: if the URL has ?receipt=XXX, remember it and try to open ----------
function wdqCaptureDeepLink() {
    var params = new URLSearchParams(window.location.search);
    var id = params.get('receipt');
    if (!id) return;
    try { sessionStorage.setItem('wd_pending_receipt', id); } catch (e) {}
    wdqTryOpenPending();
}

function wdqTryOpenPending() {
    var id = null;
    try { id = sessionStorage.getItem('wd_pending_receipt'); } catch (e) {}
    if (!id) return;

    // Only proceed once the app knows which store we're signed into
    if (typeof currentStoreId === 'undefined' || !currentStoreId) return;
    if (currentStoreId === 'SUPER_ADMIN') return;

    var opened = false;

    // Fashion
    if (!opened && /^FS-/.test(id) && typeof window.wdfShowReceipt === 'function') {
        try { window.wdfShowReceipt(id); opened = true; } catch (e) {}
    }
    // Water / Distributor
    if (!opened && /^WD-/.test(id) && typeof window.wdpShowReceipt === 'function') {
        try { window.wdpShowReceipt(id); opened = true; } catch (e) {}
    }
    // Common main-POS receipt viewer names (try each in turn)
    var names = ['showReceipt', 'openReceipt', 'viewReceipt', 'displayReceipt', 'renderReceipt', 'showSaleReceipt', 'openSalesReceipt', 'showTransactionReceipt'];
    for (var i = 0; i < names.length && !opened; i++) {
        var fn = window[names[i]];
        if (typeof fn === 'function') {
            try { fn(id); opened = true; } catch (e) {}
        }
    }
    // Last resort: open the reports view and pre-fill the search box
    if (!opened && typeof window.switchView === 'function') {
        try {
            window.switchView('reports-view');
            setTimeout(function () {
                var inp = document.getElementById('txidSearchInput');
                if (inp) {
                    inp.value = id;
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    if (typeof filterTransactions === 'function') filterTransactions();
                }
            }, 400);
            opened = true;
        } catch (e) {}
    }

    if (opened) {
        try { sessionStorage.removeItem('wd_pending_receipt'); } catch (e) {}
    }
}

// ---------- Init ----------
function wdqAttach() {
    try {
        wdqScan();
        wdqTryOpenPending();
    } catch (e) { /* silent */ }
}

window.addEventListener('load', function () {
    wdqCaptureDeepLink();
    setTimeout(wdqAttach, 1200);
    // Deep-link retry — in case login finishes a moment after load
    setTimeout(wdqTryOpenPending, 2500);
    setTimeout(wdqTryOpenPending, 5000);

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
