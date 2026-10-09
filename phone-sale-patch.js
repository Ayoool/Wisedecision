// ==================== WISE DECISION PHONE SALE PATCH (v1) ====================
// Loads AFTER phone-vendor-patch.js.
//
// STAGE 2 — Phone sales, warranty receipts, stock adjustment, sales history.
//
// Adds:
//   • Sell button on each in-stock phone row
//   • Sale modal (price, payment, customer, warranty, notes)
//   • Warranty receipt with IMEI + expiry date (printable)
//   • Stock Summary panel with "Adjust Stock" and "Sales History" buttons
//   • Adjust Stock modal (add new stock OR correct existing counts)
//   • Phone Sales History modal (searchable by IMEI or customer)
//
// Nothing in Stage 1 is touched. New data lives alongside it:
//   phoneInventory/{storeId}/{phoneId}/soldTo  ← sale record
//   phoneSales/{storeId}/{saleId}              ← history index
//   phoneCounters/{storeId}/lastSaleNumber     ← sequential receipt IDs

console.log("Wise Decision phone-sale-patch.js — v1 loaded");

// =====================================================================
// HELPERS
// =====================================================================
function wdsEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function wdsMoney(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + (Number(n) || 0).toLocaleString()); }
function wdsNum(n) { return Number(n) || 0; }
function wdsPad(n) { return String(n).padStart(2, '0'); }
function wdsToday() { const d = new Date(); return d.getFullYear() + '-' + wdsPad(d.getMonth()+1) + '-' + wdsPad(d.getDate()); }
function wdsNow() { return new Date().toISOString(); }
function wdsAddMonths(dateStr, months) {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    d.setMonth(d.getMonth() + (Number(months) || 0));
    return d.getFullYear() + '-' + wdsPad(d.getMonth()+1) + '-' + wdsPad(d.getDate());
}
function wdsPrettyDate(s) {
    const d = new Date(s);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

async function wdsNextSaleId() {
    if (!currentStoreId) return 'PH-000001';
    const ref = firebase.database().ref('phoneCounters/' + currentStoreId + '/lastSaleNumber');
    const res = await ref.transaction(cur => (cur || 0) + 1);
    if (!res.committed) throw new Error('Could not reserve a receipt number.');
    return 'PH-' + String(res.snapshot.val()).padStart(6, '0');
}

// =====================================================================
// MODAL WRAPPER (reuses Stage 1's pattern, but with its own id)
// =====================================================================
function wdsModal(title, html, width) {
    var m = document.getElementById('wds-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wds-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1600; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML =
        '<div style="background:#fff; color:#0f172a; border-radius:14px; width:100%; max-width:' + (width || 520) + 'px; max-height:94vh; overflow-y:auto; padding:20px; box-sizing:border-box;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:8px;">' +
            '<h3 style="margin:0; font-size:17px;">' + wdsEsc(title) + '</h3>' +
            '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdsCloseModal()">✕</button>' +
          '</div>' + html +
        '</div>';
    m.style.display = 'flex';
}
window.wdsCloseModal = function () {
    var m = document.getElementById('wds-modal');
    if (m) m.style.display = 'none';
};

// =====================================================================
// HOOK INTO STAGE 1 — inject "Sell" button into each in-stock row
// =====================================================================
function wdsInjectSellButtons() {
    var tbody = document.getElementById('wdv-table-body');
    if (!tbody) return;

    // Only touch rows we haven't processed yet
    tbody.querySelectorAll('tr').forEach(function (row) {
        if (row.dataset.wdsProcessed === '1') return;
        if (!row.children || row.children.length < 10) return;

        var imeiCell = row.children[0];
        var imei = (imeiCell.textContent || '').trim();
        if (!imei || imei === '—') return;
        if (!/^\d{10,20}$/.test(imei)) return;

        var statusCell = row.children[7];
        var statusText = (statusCell.textContent || '').trim().toUpperCase();
        if (statusText.indexOf('IN STOCK') === -1) {
            row.dataset.wdsProcessed = '1';
            return;
        }

        // Find the phoneId from the delete button's onclick handler
        var actionCell = row.children[9];
        var delBtn = actionCell ? actionCell.querySelector('.menu-btn[onclick*="wdvDeletePhone"]') : null;
        if (!delBtn) { row.dataset.wdsProcessed = '1'; return; }
        var match = delBtn.getAttribute('onclick').match(/wdvDeletePhone\('([^']+)'\)/);
        if (!match) { row.dataset.wdsProcessed = '1'; return; }
        var phoneId = match[1];

        // Insert Sell button before Edit
        var sellBtn = document.createElement('button');
        sellBtn.className = 'menu-btn';
        sellBtn.style.cssText = 'width:auto; margin:0; padding:4px 8px; font-size:11px; background:#dcfce7; border:1px solid #86efac; color:#166534; font-weight:bold;';
        sellBtn.textContent = 'Sell';
        sellBtn.onclick = function () { wdsOpenSellModal(phoneId); };

        var editBtn = actionCell.querySelector('.menu-btn[onclick*="wdvEditPhone"]');
        if (editBtn) {
            actionCell.insertBefore(sellBtn, editBtn);
        } else {
            actionCell.insertBefore(sellBtn, actionCell.firstChild);
        }

        row.dataset.wdsProcessed = '1';
    });
}

// =====================================================================
// SELL MODAL
// =====================================================================
window.wdsOpenSellModal = function (phoneId) {
    var p = (typeof wdvPhones !== 'undefined' && wdvPhones[phoneId]) ? wdvPhones[phoneId] : null;
    if (!p) { alert('Phone not found.'); return; }
    if (p.status === 'sold') { alert('This phone has already been sold.'); return; }

    var inp = 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;';
    var lbl = 'display:block; font-size:11px; font-weight:bold; color:#334155; margin-bottom:4px; margin-top:10px; text-transform:uppercase; letter-spacing:0.5px;';

    var html =
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:14px; font-size:13px;">' +
            '<div><strong>' + wdsEsc(p.brand || '') + ' ' + wdsEsc(p.model || '') + '</strong></div>' +
            '<div style="color:#64748b; font-size:12px; margin-top:4px;">' +
                [p.storage, p.color, p.condition].filter(Boolean).map(wdsEsc).join(' · ') +
            '</div>' +
            '<div style="font-family:monospace; font-size:11px; margin-top:6px;">IMEI: ' + wdsEsc(p.imei || '') + '</div>' +
            '<div style="color:#64748b; font-size:12px; margin-top:6px;">Cost Price: <strong>' + wdsMoney(p.costPrice) + '</strong></div>' +
        '</div>' +

        '<label style="' + lbl + '">Selling Price (₦) *</label>' +
        '<input id="wds-f-price" type="number" value="' + (wdsNum(p.sellingPrice) || '') + '" placeholder="e.g. 215000" style="' + inp + '">' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + lbl + '">Payment Method</label>' +
                '<select id="wds-f-method" style="' + inp + '">' +
                    '<option>Cash</option><option>Transfer</option><option>POS</option><option>Part Payment</option>' +
                '</select></div>' +
            '<div><label style="' + lbl + '">Warranty</label>' +
                '<select id="wds-f-warranty" style="' + inp + '">' +
                    [0,3,6,12,24].map(function (m) {
                        return '<option value="' + m + '"' + (m === 12 ? ' selected' : '') + '>' + (m === 0 ? 'No warranty' : m + ' months') + '</option>';
                    }).join('') +
                '</select></div>' +
        '</div>' +

        '<label style="' + lbl + '">Customer Name *</label>' +
        '<input id="wds-f-cust-name" type="text" placeholder="e.g. John Doe" style="' + inp + '">' +

        '<label style="' + lbl + '">Customer Phone *</label>' +
        '<input id="wds-f-cust-phone" type="text" placeholder="e.g. 08012345678" style="' + inp + '">' +

        '<label style="' + lbl + '">Notes (optional)</label>' +
        '<textarea id="wds-f-notes" rows="2" placeholder="e.g. Includes charger and case" style="' + inp + '"></textarea>' +

        '<div id="wds-sell-error" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>' +

        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center; background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);" onclick="wdsConfirmSale(\'' + wdsEsc(phoneId) + '\')">✅ Confirm Sale & Print Receipt</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdsCloseModal()">Cancel</button>' +
        '</div>';

    wdsModal('💰 Sell Phone', html);
};

// =====================================================================
// CONFIRM SALE
// =====================================================================
window.wdsConfirmSale = async function (phoneId) {
    var err = document.getElementById('wds-sell-error');
    err.style.display = 'none';
    var fail = function (m) { err.textContent = m; err.style.display = 'block'; };

    var p = (typeof wdvPhones !== 'undefined' && wdvPhones[phoneId]) ? wdvPhones[phoneId] : null;
    if (!p) return fail('Phone not found.');
    if (p.status === 'sold') return fail('This phone has already been sold.');

    var price = parseFloat(document.getElementById('wds-f-price').value) || 0;
    var method = document.getElementById('wds-f-method').value;
    var warrantyMonths = parseInt(document.getElementById('wds-f-warranty').value) || 0;
    var custName = (document.getElementById('wds-f-cust-name').value || '').trim();
    var custPhone = (document.getElementById('wds-f-cust-phone').value || '').trim();
    var notes = (document.getElementById('wds-f-notes').value || '').trim();

    if (!(price > 0)) return fail('Selling price must be greater than 0.');
    if (!custName) return fail('Customer name is required (used on the warranty receipt).');
    if (!custPhone) return fail('Customer phone is required (used on the warranty receipt).');

    try {
        var saleId = await wdsNextSaleId();
        var nowIso = wdsNow();
        var soldDate = wdsToday();
        var warrantyStart = soldDate;
        var warrantyEnd = warrantyMonths > 0 ? wdsAddMonths(soldDate, warrantyMonths) : null;
        var seller = (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin';

        var soldTo = {
            saleId: saleId,
            price: price,
            costPrice: wdsNum(p.costPrice),
            profit: Math.round((price - wdsNum(p.costPrice)) * 100) / 100,
            paymentMethod: method,
            customerName: custName,
            customerPhone: custPhone,
            warrantyMonths: warrantyMonths,
            warrantyStart: warrantyStart,
            warrantyEnd: warrantyEnd,
            notes: notes,
            soldBy: seller,
            soldAt: nowIso
        };

        var db = firebase.database();
        var updates = {};
        updates['phoneInventory/' + currentStoreId + '/' + phoneId + '/status'] = 'sold';
        updates['phoneInventory/' + currentStoreId + '/' + phoneId + '/soldTo'] = soldTo;
        updates['phoneSales/' + currentStoreId + '/' + saleId] = {
            phoneId: phoneId,
            imei: p.imei || '',
            imei2: p.imei2 || '',
            brand: p.brand || '',
            model: p.model || '',
            storage: p.storage || '',
            color: p.color || '',
            condition: p.condition || '',
            customerName: custName,
            customerPhone: custPhone,
            price: price,
            costPrice: wdsNum(p.costPrice),
            profit: soldTo.profit,
            paymentMethod: method,
            warrantyMonths: warrantyMonths,
            warrantyStart: warrantyStart,
            warrantyEnd: warrantyEnd,
            notes: notes,
            soldBy: seller,
            soldAt: nowIso
        };

        await db.ref().update(updates);
        wdsCloseModal();

        // Show the warranty receipt
        wdsShowReceipt(saleId);

        // Refresh the table so the row now shows "SOLD"
        if (typeof wdvRenderInventory === 'function') {
            setTimeout(function () {
                wdvRenderInventory();
                if (typeof wdvRenderSummary === 'function') wdvRenderSummary();
            }, 400);
        }
    } catch (e) {
        fail('Could not complete sale: ' + (e.message || e));
    }
};

// =====================================================================
// WARRANTY RECEIPT
// =====================================================================
window.wdsShowReceipt = function (saleId) {
    var ws = document.getElementById('workspace-content');
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
            '<div style="text-align:center; font-weight:bold; font-size:12px; margin: 6px 0;">WARRANTY RECEIPT</div>' +
            '<hr style="border:dashed 1px #ccc;">' +
            '<div id="wds-receipt-body" style="font-size:11px; line-height:1.7;"></div>' +
            '<hr style="border:dashed 1px #ccc;">' +
            '<div style="text-align:center; font-size:10px; color:#333; margin-top:10px;">' +
                'Keep this receipt safe. It is your proof of purchase and warranty.' +
            '</div>' +
            '<div style="margin-top:14px; font-size:10px;">' +
                '<div style="border-top:1px solid #000; width:70%; margin-top:24px;"></div>' +
                'Buyer signature' +
            '</div>' +
        '</div>';

    firebase.database().ref('phoneSales/' + currentStoreId + '/' + saleId).once('value').then(function (snap) {
        var sale = snap.val();
        if (!sale) {
            document.getElementById('wds-receipt-body').innerHTML = '<div style="color:#991b1b;">Sale record not found.</div>';
            return;
        }

        firebase.database().ref('stores/' + currentStoreId).once('value').then(function (storeSnap) {
            var store = storeSnap.val() || {};
            var storeNameEl = document.getElementById('wds-receipt-store-name');
            var storeAddrEl = document.getElementById('wds-receipt-store-address');
            var storePhoneEl = document.getElementById('wds-receipt-store-phone');
            if (storeNameEl) storeNameEl.textContent = store.businessName || 'WISE DECISION';
            if (storeAddrEl) storeAddrEl.textContent = store.address || '';
            if (storePhoneEl) storePhoneEl.textContent = store.phone ? ('Tel: ' + store.phone) : '';

            var body = document.getElementById('wds-receipt-body');
            if (!body) return;

            var warrantyLine = '';
            if (wdsNum(sale.warrantyMonths) > 0) {
                warrantyLine =
                    '<div style="margin-top:8px; padding:6px; background:#f0fdf4; border:1px dashed #86efac;">' +
                        '<strong>Warranty:</strong> ' + sale.warrantyMonths + ' month' + (sale.warrantyMonths === 1 ? '' : 's') + '<br>' +
                        '<strong>Starts:</strong> ' + wdsPrettyDate(sale.warrantyStart) + '<br>' +
                        '<strong>Expires:</strong> ' + wdsPrettyDate(sale.warrantyEnd) +
                    '</div>';
            }

            body.innerHTML =
                '<div><strong>Receipt ID:</strong> ' + wdsEsc(sale.saleId) + '</div>' +
                '<div><strong>Date:</strong> ' + wdsPrettyDate(sale.soldAt) + '</div>' +
                '<hr style="border:dashed 1px #ccc; margin:8px 0;">' +
                '<div><strong>Device:</strong> ' + wdsEsc(sale.brand) + ' ' + wdsEsc(sale.model) + '</div>' +
                '<div><strong>Storage:</strong> ' + wdsEsc(sale.storage || '—') + ' &nbsp; <strong>Color:</strong> ' + wdsEsc(sale.color || '—') + '</div>' +
                '<div><strong>Condition:</strong> ' + wdsEsc(sale.condition || '—') + '</div>' +
                '<div><strong>IMEI 1:</strong> ' + wdsEsc(sale.imei || '—') + '</div>' +
                (sale.imei2 ? '<div><strong>IMEI 2:</strong> ' + wdsEsc(sale.imei2) + '</div>' : '') +
                '<hr style="border:dashed 1px #ccc; margin:8px 0;">' +
                '<div><strong>Customer:</strong> ' + wdsEsc(sale.customerName) + '</div>' +
                '<div><strong>Phone:</strong> ' + wdsEsc(sale.customerPhone) + '</div>' +
                '<hr style="border:dashed 1px #ccc; margin:8px 0;">' +
                '<div style="font-size:13px;"><strong>Amount Paid:</strong> ' + wdsMoney(sale.price) + '</div>' +
                '<div><strong>Payment Method:</strong> ' + wdsEsc(sale.paymentMethod) + '</div>' +
                '<div><strong>Sold By:</strong> ' + wdsEsc(sale.soldBy) + '</div>' +
                warrantyLine +
                (sale.notes ? '<div style="margin-top:6px; font-style:italic;">Notes: ' + wdsEsc(sale.notes) + '</div>' : '');
        });
    });
};

window.wdsPrintReceipt = function () {
    var el = document.getElementById('wds-printable-receipt');
    if (!el) return;
    if (typeof triggerThermalPrint === 'function') {
        triggerThermalPrint(el.innerHTML);
    } else {
        window.print();
    }
};

window.wdsDownloadReceiptPDF = function () {
    var el = document.getElementById('wds-printable-receipt');
    if (!el) return;
    if (typeof loadHtml2PdfLibrary === 'function') {
        loadHtml2PdfLibrary().then(function () {
            var opt = {
                margin: 5,
                filename: 'Warranty-Receipt.pdf',
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a6', orientation: 'portrait' }
            };
            html2pdf().from(el).set(opt).save();
        }).catch(function (e) { alert(e.message); });
    } else {
        window.print();
    }
};

window.wdsBackToPhoneInventory = function () {
    if (typeof wdvShowInventory === 'function') wdvShowInventory();
};

// =====================================================================
// STOCK SUMMARY PANEL — displayed above the phone table
// =====================================================================
function wdsInjectStockSummaryPanel() {
    var ws = document.getElementById('workspace-content');
    if (!ws) return;
    if (document.getElementById('wds-stock-panel')) return;
    if (!document.getElementById('wdv-table-body')) return;

    var toolbar = ws.querySelector('#wdv-summary-cards');
    if (!toolbar) return;

    var panel = document.createElement('div');
    panel.id = 'wds-stock-panel';
    panel.style.cssText = 'background:#fff; border:1px solid #eef2f7; border-radius:12px; padding:14px; margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; box-shadow:0 6px 18px rgba(15,23,42,0.04);';

    panel.innerHTML =
        '<span style="font-weight:bold; font-size:13px; color:#0f172a; margin-right:6px;">📊 Stock Management:</span>' +
        '<button class="menu-btn" style="width:auto; margin:0; padding:8px 14px; background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8; font-weight:bold; font-size:12px;" onclick="wdsOpenAdjustStockModal()">🔄 Adjust Stock</button>' +
        '<button class="menu-btn" style="width:auto; margin:0; padding:8px 14px; background:#fef3c7; border:1px solid #fde68a; color:#92400e; font-weight:bold; font-size:12px;" onclick="wdsOpenSalesHistoryModal()">📜 Sales History</button>' +
        '<button class="menu-btn" style="width:auto; margin:0; padding:8px 14px; background:#f5f3ff; border:1px solid #ddd6fe; color:#6d28d9; font-weight:bold; font-size:12px;" onclick="wdsOpenMissingPhonesModal()">⚠️ Mark Missing</button>';

    toolbar.parentNode.insertBefore(panel, toolbar.nextSibling);
}

// =====================================================================
// ADJUST STOCK MODAL
// =====================================================================
window.wdsOpenAdjustStockModal = function () {
    var inp = 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;';
    var lbl = 'display:block; font-size:11px; font-weight:bold; color:#334155; margin-bottom:4px; margin-top:10px; text-transform:uppercase; letter-spacing:0.5px;';

    var html =
        '<p style="font-size:12px; color:#64748b; margin:0 0 12px 0;">' +
            'Adjust the phone inventory when a supplier delivers new units, or when you correct a count after a physical stock check.' +
        '</p>' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
            '<div><label style="' + lbl + '">What to do</label>' +
                '<select id="wds-a-action" style="' + inp + '" onchange="wdsAdjustActionChange()">' +
                    '<option value="add">➕ Add new stock</option>' +
                    '<option value="missing">⚠️ Mark a phone as missing</option>' +
                    '<option value="found">✅ Mark a missing phone as found</option>' +
                '</select></div>' +
        '</div>' +

        '<div id="wds-a-add-section">' +
            '<label style="' + lbl + '">Product Already in Inventory?</label>' +
            '<select id="wds-a-product" style="' + inp + '"></select>' +
            '<div style="font-size:11px; color:#64748b; margin-top:4px;">' +
                'Adds new units of a phone you already sell. Same cost, price, and warranty settings are used.' +
            '</div>' +

            '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
                '<div><label style="' + lbl + '">How Many Units Received</label>' +
                    '<input id="wds-a-qty" type="number" min="1" placeholder="e.g. 5" style="' + inp + '"></div>' +
                '<div><label style="' + lbl + '">IMEIs (one per line)</label>' +
                    '<textarea id="wds-a-imeis" rows="4" placeholder="Paste IMEIs, one per line" style="' + inp + ' font-family:monospace; font-size:12px;"></textarea></div>' +
            '</div>' +

            '<div class="form-group" style="margin-top:12px;">' +
                '<label style="' + lbl + '">Cost Price per Unit (₦) — leave blank to use existing</label>' +
                '<input id="wds-a-cost" type="number" placeholder="Optional" style="' + inp + '">' +
            '</div>' +
        '</div>' +

        '<div id="wds-a-missing-section" style="display:none;">' +
            '<label style="' + lbl + '">Select the phone to mark as MISSING</label>' +
            '<select id="wds-a-missing-phone" style="' + inp + '"></select>' +
            '<label style="' + lbl + '">Reason</label>' +
            '<input id="wds-a-missing-reason" type="text" placeholder="e.g. Not in shelf, presumed stolen" style="' + inp + '">' +
        '</div>' +

        '<div id="wds-a-found-section" style="display:none;">' +
            '<label style="' + lbl + '">Select the phone to mark as FOUND (restored to In Stock)</label>' +
            '<select id="wds-a-found-phone" style="' + inp + '"></select>' +
        '</div>' +

        '<div id="wds-a-error" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>' +

        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdsConfirmAdjustStock()">Confirm Adjustment</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdsCloseModal()">Cancel</button>' +
        '</div>';

    wdsModal('🔄 Adjust Stock', html);

    setTimeout(wdsPopulateAdjustDropdowns, 50);
};

window.wdsAdjustActionChange = function () {
    var action = document.getElementById('wds-a-action').value;
    document.getElementById('wds-a-add-section').style.display = (action === 'add') ? 'block' : 'none';
    document.getElementById('wds-a-missing-section').style.display = (action === 'missing') ? 'block' : 'none';
    document.getElementById('wds-a-found-section').style.display = (action === 'found') ? 'block' : 'none';
};

function wdsPopulateAdjustDropdowns() {
    var phones = (typeof wdvPhones !== 'undefined') ? wdvPhones : {};
    var productSeen = {};
    var products = [];

    Object.keys(phones).forEach(function (id) {
        var p = phones[id];
        var key = (p.brand || '') + '|' + (p.model || '') + '|' + (p.storage || '') + '|' + (p.color || '');
        if (!productSeen[key]) {
            productSeen[key] = true;
            products.push({
                key: key,
                label: p.brand + ' ' + p.model + ' [' + (p.storage || '—') + ' · ' + (p.color || '—') + ']',
                cost: wdsNum(p.costPrice),
                price: wdsNum(p.sellingPrice),
                warranty: wdsNum(p.warrantyMonths)
            });
        }
    });

    var prodSel = document.getElementById('wds-a-product');
    if (prodSel) {
        prodSel.innerHTML = products.map(function (x) {
            return '<option value="' + wdsEsc(x.key) + '" data-cost="' + x.cost + '" data-price="' + x.price + '" data-warranty="' + x.warranty + '">' + wdsEsc(x.label) + '</option>';
        }).join('') || '<option value="">No products yet — add a phone first</option>';
    }

    var missingSel = document.getElementById('wds-a-missing-phone');
    var foundSel = document.getElementById('wds-a-found-phone');
    var missingOpts = [], foundOpts = [];
    Object.keys(phones).forEach(function (id) {
        var p = phones[id];
        var label = p.brand + ' ' + p.model + ' · ' + p.imei;
        if (p.status === 'in_stock') missingOpts.push('<option value="' + wdsEsc(id) + '">' + wdsEsc(label) + '</option>');
        if (p.status === 'missing') foundOpts.push('<option value="' + wdsEsc(id) + '">' + wdsEsc(label) + '</option>');
    });
    if (missingSel) missingSel.innerHTML = missingOpts.join('') || '<option value="">No in-stock phones</option>';
    if (foundSel) foundSel.innerHTML = foundOpts.join('') || '<option value="">No missing phones</option>';
}

window.wdsConfirmAdjustStock = async function () {
    var err = document.getElementById('wds-a-error');
    err.style.display = 'none';
    var fail = function (m) { err.textContent = m; err.style.display = 'block'; };

    var action = document.getElementById('wds-a-action').value;
    var db = firebase.database();

    try {
        if (action === 'add') {
            var productKey = document.getElementById('wds-a-product').value;
            if (!productKey) return fail('Select a product to add stock for.');

            var qty = parseInt(document.getElementById('wds-a-qty').value) || 0;
            if (qty <= 0) return fail('Enter a number of units greater than zero.');

            var imeiRaw = (document.getElementById('wds-a-imeis').value || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
            if (imeiRaw.length !== qty) return fail('You entered ' + qty + ' units, but pasted ' + imeiRaw.length + ' IMEI' + (imeiRaw.length === 1 ? '' : 's') + '. They must match.');
            var bad = imeiRaw.find(function (x) { return !/^\d{10,20}$/.test(x); });
            if (bad) return fail('Not a valid IMEI: "' + bad + '"');

            // Check for duplicates
            var existingSet = {};
            var phones = (typeof wdvPhones !== 'undefined') ? wdvPhones : {};
            Object.keys(phones).forEach(function (id) {
                existingSet[phones[id].imei] = true;
                if (phones[id].imei2) existingSet[phones[id].imei2] = true;
            });
            var dupes = imeiRaw.filter(function (x) { return existingSet[x]; });
            if (dupes.length) return fail('Already in inventory: ' + dupes.join(', '));

            // Find a template from any existing unit of the same product
            var template = null;
            var templateKey = productKey;
            Object.keys(phones).forEach(function (id) {
                var p = phones[id];
                var k = (p.brand || '') + '|' + (p.model || '') + '|' + (p.storage || '') + '|' + (p.color || '');
                if (k === templateKey && !template) template = p;
            });
            if (!template) return fail('Could not find a template phone for this product.');

            var overrideCost = parseFloat(document.getElementById('wds-a-cost').value);
            var finalCost = (!isNaN(overrideCost) && overrideCost > 0) ? overrideCost : wdsNum(template.costPrice);

            var batch = {};
            var nowIso = wdsNow();
            var seller = (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin';

            imeiRaw.forEach(function (imei) {
                var newRef = db.ref('phoneInventory/' + currentStoreId).push();
                batch[newRef.key] = {
                    imei: imei,
                    imei2: '',
                    brand: template.brand || '',
                    model: template.model || '',
                    storage: template.storage || '',
                    color: template.color || '',
                    condition: template.condition || 'New',
                    costPrice: finalCost,
                    sellingPrice: wdsNum(template.sellingPrice),
                    purchaseDate: wdsToday(),
                    warrantyMonths: wdsNum(template.warrantyMonths),
                    notes: '',
                    status: 'in_stock',
                    createdAt: nowIso,
                    createdBy: seller
                };
            });

            await db.ref('phoneInventory/' + currentStoreId).update(batch);
            wdsCloseModal();
            alert('✅ Added ' + qty + ' unit' + (qty === 1 ? '' : 's') + '.');
            wdsRefreshInventory();

        } else if (action === 'missing') {
            var phoneId = document.getElementById('wds-a-missing-phone').value;
            if (!phoneId) return fail('Select a phone to mark as missing.');
            var reason = (document.getElementById('wds-a-missing-reason').value || '').trim();
            var seller2 = (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin';

            await db.ref('phoneInventory/' + currentStoreId + '/' + phoneId).update({
                status: 'missing',
                missingSince: wdsNow(),
                missingReason: reason,
                markedMissingBy: seller2
            });
            wdsCloseModal();
            alert('⚠️ Phone marked as missing. It will appear under "Mark Missing" → found if recovered.');
            wdsRefreshInventory();

        } else if (action === 'found') {
            var foundId = document.getElementById('wds-a-found-phone').value;
            if (!foundId) return fail('Select a phone to mark as found.');

            await db.ref('phoneInventory/' + currentStoreId + '/' + foundId).update({
                status: 'in_stock',
                missingSince: null,
                missingReason: null,
                markedMissingBy: null
            });
            wdsCloseModal();
            alert('✅ Phone restored to In Stock.');
            wdsRefreshInventory();
        }
    } catch (e) {
        fail('Could not adjust stock: ' + (e.message || e));
    }
};

// =====================================================================
// SALES HISTORY MODAL
// =====================================================================
window.wdsOpenSalesHistoryModal = function () {
    var inp = 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;';

    var html =
        '<input id="wds-h-search" type="text" placeholder="🔍 Search by IMEI, customer name, or phone..." oninput="wdsRenderSalesHistory()" style="' + inp + '">' +
        '<div id="wds-h-body" style="max-height:56vh; overflow-y:auto; margin-top:12px;">' +
            '<div style="text-align:center; color:#94a3b8; padding:30px;">Loading...</div>' +
        '</div>' +
        '<div style="display:flex; gap:10px; margin-top:14px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdsExportSalesHistoryCSV()">📥 Export CSV</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdsCloseModal()">Close</button>' +
        '</div>';

    wdsModal('📜 Phone Sales History', html, 640);
    wdsRenderSalesHistory();
};

async function wdsLoadSalesCache() {
    if (!currentStoreId) return {};
    var snap = await firebase.database().ref('phoneSales/' + currentStoreId).once('value');
    return snap.val() || {};
}

window.wdsRenderSalesHistory = async function () {
    var box = document.getElementById('wds-h-body');
    if (!box) return;
    var q = (document.getElementById('wds-h-search')?.value || '').toLowerCase().trim();

    var sales = await wdsLoadSalesCache();
    var rows = Object.keys(sales).map(function (k) { return Object.assign({ _id: k }, sales[k]); });
    rows.sort(function (a, b) { return String(b.soldAt || '').localeCompare(String(a.soldAt || '')); });

    if (q) {
        rows = rows.filter(function (s) {
            var hay = ((s.imei || '') + ' ' + (s.imei2 || '') + ' ' + (s.brand || '') + ' ' + (s.model || '') + ' ' + (s.customerName || '') + ' ' + (s.customerPhone || '')).toLowerCase();
            return hay.indexOf(q) !== -1;
        });
    }

    if (rows.length === 0) {
        box.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:30px;">No sales recorded yet.</div>';
        return;
    }

    window.wdsLastSalesCache = rows;

    box.innerHTML = rows.map(function (s) {
        return '<div style="border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:8px;">' +
            '<div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start; flex-wrap:wrap;">' +
                '<div style="flex:1; min-width:200px;">' +
                    '<div style="font-weight:bold; font-size:13px;">' + wdsEsc(s.brand) + ' ' + wdsEsc(s.model) + '</div>' +
                    '<div style="font-family:monospace; font-size:11px; color:#64748b;">IMEI: ' + wdsEsc(s.imei) + '</div>' +
                    '<div style="font-size:12px; margin-top:4px;">👤 ' + wdsEsc(s.customerName) + ' · ' + wdsEsc(s.customerPhone) + '</div>' +
                '</div>' +
                '<div style="text-align:right;">' +
                    '<div style="font-weight:bold; font-size:15px; color:#16a34a;">' + wdsMoney(s.price) + '</div>' +
                    '<div style="font-size:11px; color:#64748b;">' + wdsPrettyDate(s.soldAt) + '</div>' +
                '</div>' +
            '</div>' +
            '<div style="display:flex; gap:8px; margin-top:8px;">' +
                '<button class="menu-btn btn-dash" style="width:auto; margin:0; padding:5px 10px; font-size:11px;" onclick="wdsViewSaleReceipt(\'' + wdsEsc(s.saleId) + '\')">🖨 View Receipt</button>' +
                (wdsNum(s.profit) ? '<span style="font-size:11px; color:#64748b; align-self:center;">Profit: ' + wdsMoney(s.profit) + '</span>' : '') +
            '</div>' +
        '</div>';
    }).join('');
};

window.wdsViewSaleReceipt = function (saleId) {
    wdsCloseModal();
    setTimeout(function () { wdsShowReceipt(saleId); }, 150);
};

window.wdsExportSalesHistoryCSV = function () {
    var rows = window.wdsLastSalesCache || [];
    if (rows.length === 0) { alert('Nothing to export.'); return; }
    var headers = ['Receipt ID', 'Date', 'Brand', 'Model', 'Storage', 'Color', 'IMEI', 'IMEI 2', 'Customer', 'Customer Phone', 'Price', 'Cost', 'Profit', 'Payment', 'Warranty (m)', 'Sold By'];
    var csv = [headers.join(',')].concat(rows.map(function (s) {
        return [
            s.saleId, s.soldAt, s.brand, s.model, s.storage, s.color, s.imei, s.imei2 || '',
            s.customerName, s.customerPhone, s.price, s.costPrice, s.profit, s.paymentMethod,
            s.warrantyMonths || 0, s.soldBy
        ].map(function (v) {
            var s2 = String(v == null ? '' : v);
            return '"' + s2.replace(/"/g, '""') + '"';
        }).join(',');
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
// MISSING PHONES MODAL
// =====================================================================
window.wdsOpenMissingPhonesModal = function () {
    var phones = (typeof wdvPhones !== 'undefined') ? wdvPhones : {};
    var missing = Object.keys(phones).filter(function (id) { return phones[id].status === 'missing'; });

    var body = missing.length === 0
        ? '<div style="text-align:center; color:#94a3b8; padding:30px;">No missing phones. All good ✅</div>'
        : missing.map(function (id) {
            var p = phones[id];
            return '<div style="border:1px solid #fecaca; background:#fef2f2; border-radius:10px; padding:12px; margin-bottom:8px;">' +
                '<div style="font-weight:bold; font-size:13px;">' + wdsEsc(p.brand) + ' ' + wdsEsc(p.model) + '</div>' +
                '<div style="font-family:monospace; font-size:11px; color:#7f1d1d;">IMEI: ' + wdsEsc(p.imei) + '</div>' +
                (p.missingReason ? '<div style="font-size:12px; margin-top:4px;">Reason: ' + wdsEsc(p.missingReason) + '</div>' : '') +
                '<div style="font-size:11px; color:#7f1d1d; margin-top:2px;">Marked missing by ' + wdsEsc(p.markedMissingBy || '—') + ' on ' + wdsPrettyDate(p.missingSince) + '</div>' +
                '<button class="menu-btn" style="width:auto; margin:8px 0 0; padding:5px 10px; font-size:11px; background:#dcfce7; border:1px solid #86efac; color:#166534;" onclick="wdsRestoreMissing(\'' + wdsEsc(id) + '\')">✅ Mark as Found</button>' +
            '</div>';
        }).join('');

    var html =
        '<p style="font-size:12px; color:#64748b; margin:0 0 12px 0;">' +
            'Phones you\'ve marked as missing (not on the shelf, presumed lost or stolen). When one is recovered, click "Mark as Found" to restore it.' +
        '</p>' +
        body +
        '<div style="margin-top:16px;">' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdsCloseModal()">Close</button>' +
        '</div>';

    wdsModal('⚠️ Missing Phones', html, 560);
};

window.wdsRestoreMissing = async function (phoneId) {
    try {
        await firebase.database().ref('phoneInventory/' + currentStoreId + '/' + phoneId).update({
            status: 'in_stock',
            missingSince: null,
            missingReason: null,
            markedMissingBy: null
        });
        alert('✅ Phone restored to In Stock.');
        wdsCloseModal();
        wdsRefreshInventory();
    } catch (e) {
        alert('Could not restore: ' + e.message);
    }
};

// =====================================================================
// REFRESH HELPER
// =====================================================================
function wdsRefreshInventory() {
    if (typeof wdvLoadPhones === 'function') {
        wdvLoadPhones().then(function () {
            if (typeof wdvRenderInventory === 'function') wdvRenderInventory();
            if (typeof wdvRenderSummary === 'function') wdvRenderSummary();
        });
    }
}

// =====================================================================
// MAIN ATTACH — runs on every DOM change (idempotent)
// =====================================================================
function wdsAttach() {
    if (!document.getElementById('wdv-table-body')) return;
    wdsInjectStockSummaryPanel();
    wdsInjectSellButtons();
}

window.addEventListener('load', function () {
    setTimeout(function () { try { wdsAttach(); } catch (e) { console.warn(e); } }, 800);

    var wdsObs = new MutationObserver(function () {
        try { wdsAttach(); } catch (e) { console.warn(e); }
    });
    if (document.body) wdsObs.observe(document.body, { childList: true, subtree: true });
});
