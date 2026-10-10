// ==================== WISE DECISION MATERIALS POLISH PATCH (v2) ====================
// Loads AFTER materials-patch.js.
//
// Adds:
//   1. Quick-Add Materials panel — pre-filled common products
//   2. Materials-friendly form labels (sheet/bundle/roll instead of Piece/Pack)
//   3. Cleaner receipt format (quantity × unit price)
//   4. Big "Start New Sale" button on the materials dashboard
//
// v2 changes:
//   • Nails: kg (base) / bag (bulk) — matches how shops open bags and sell by kg
//   • Corrected units across the materials library
//
// Only affects stores with storeType === 'hardware' or starts with 'hardware:'.

console.log("Wise Decision materials-polish-patch.js — v2 loaded");

// =====================================================================
// HELPERS
// =====================================================================
function wdpEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function wdpNum(n) { return Number(n) || 0; }
function wdpMoney(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + (Number(n) || 0).toLocaleString()); }
function wdpIsMaterialsStore() {
    if (typeof wdmStoreType !== 'undefined' && wdmStoreType) {
        var t = String(wdmStoreType).toLowerCase();
        return t === 'hardware' || t.indexOf('hardware:') === 0;
    }
    return false;
}

// =====================================================================
// 1. COMMON MATERIALS LIBRARY
// =====================================================================
var WDP_COMMON_MATERIALS = [
    // Roofing
    { category: 'Roofing', name: 'Roofing Sheet 3m', baseUnit: 'sheet', bulkUnit: 'bundle', piecesPerBulk: 10 },
    { category: 'Roofing', name: 'Roofing Sheet 4m', baseUnit: 'sheet', bulkUnit: 'bundle', piecesPerBulk: 10 },
    { category: 'Roofing', name: 'Roofing Sheet 6m', baseUnit: 'sheet', bulkUnit: 'bundle', piecesPerBulk: 10 },
    { category: 'Roofing', name: 'Ridge Cap', baseUnit: 'piece', bulkUnit: 'bundle', piecesPerBulk: 20 },
    { category: 'Roofing', name: 'Roofing Nails (with rubber)', baseUnit: 'kg', bulkUnit: 'bag', piecesPerBulk: 25 },
    { category: 'Roofing', name: 'Roofing Clips', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 100 },

    // Nails & Screws — sold loose by kg or by full bag
    { category: 'Nails & Screws', name: 'Nail 1 inch', baseUnit: 'kg', bulkUnit: 'bag', piecesPerBulk: 25 },
    { category: 'Nails & Screws', name: 'Nail 2 inch', baseUnit: 'kg', bulkUnit: 'bag', piecesPerBulk: 25 },
    { category: 'Nails & Screws', name: 'Nail 3 inch', baseUnit: 'kg', bulkUnit: 'bag', piecesPerBulk: 25 },
    { category: 'Nails & Screws', name: 'Nail 4 inch', baseUnit: 'kg', bulkUnit: 'bag', piecesPerBulk: 25 },
    { category: 'Nails & Screws', name: 'Wood Screw (Assorted)', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 100 },

    // Boards
    { category: 'Boards', name: 'Plywood 4ft × 8ft', baseUnit: 'sheet', bulkUnit: 'pallet', piecesPerBulk: 30 },
    { category: 'Boards', name: 'MDF Board 6ft × 8ft', baseUnit: 'sheet', bulkUnit: 'pallet', piecesPerBulk: 30 },
    { category: 'Boards', name: 'Particle Board 6ft × 8ft', baseUnit: 'sheet', bulkUnit: 'pallet', piecesPerBulk: 30 },

    // Doors
    { category: 'Doors', name: 'Wooden Door', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 1 },
    { category: 'Doors', name: 'Bulletproof Door', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 1 },
    { category: 'Doors', name: 'Glass Door', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 1 },
    { category: 'Doors', name: 'Door Frame', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 1 },

    // Cement & Blocks
    { category: 'Cement & Blocks', name: 'Cement 50kg', baseUnit: 'bag', bulkUnit: 'pallet', piecesPerBulk: 50 },
    { category: 'Cement & Blocks', name: 'Building Block 6 inch', baseUnit: 'piece', bulkUnit: 'pallet', piecesPerBulk: 100 },
    { category: 'Cement & Blocks', name: 'Building Block 9 inch', baseUnit: 'piece', bulkUnit: 'pallet', piecesPerBulk: 100 },

    // Wire & Rods
    { category: 'Wire & Rods', name: 'Binding Wire', baseUnit: 'roll', bulkUnit: 'carton', piecesPerBulk: 10 },
    { category: 'Wire & Rods', name: 'Iron Rod 12mm', baseUnit: 'length', bulkUnit: 'tonne', piecesPerBulk: 100 },
    { category: 'Wire & Rods', name: 'Iron Rod 16mm', baseUnit: 'length', bulkUnit: 'tonne', piecesPerBulk: 100 },

    // Plumbing
    { category: 'Plumbing', name: 'PVC Pipe 1 inch', baseUnit: 'length', bulkUnit: 'bundle', piecesPerBulk: 10 },
    { category: 'Plumbing', name: 'PVC Pipe 2 inch', baseUnit: 'length', bulkUnit: 'bundle', piecesPerBulk: 10 },
    { category: 'Plumbing', name: 'Elbow Joint', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 20 },
    { category: 'Plumbing', name: 'Tee Joint', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 20 },
    { category: 'Plumbing', name: 'Plumbing Tape', baseUnit: 'roll', bulkUnit: 'pack', piecesPerBulk: 10 },

    // Tiles & Ceramics
    { category: 'Tiles & Ceramics', name: 'Floor Tile 60cm × 60cm', baseUnit: 'box', bulkUnit: 'pallet', piecesPerBulk: 40 },
    { category: 'Tiles & Ceramics', name: 'Wall Tile 30cm × 60cm', baseUnit: 'box', bulkUnit: 'pallet', piecesPerBulk: 40 },
    { category: 'Tiles & Ceramics', name: 'Tile Adhesive 25kg', baseUnit: 'bag', bulkUnit: 'pallet', piecesPerBulk: 40 },
    { category: 'Tiles & Ceramics', name: 'Tile Grout 5kg', baseUnit: 'pack', bulkUnit: 'carton', piecesPerBulk: 10 },

    // Wardrobe
    { category: 'Wardrobe', name: 'Hinges (Soft Close)', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 10 },
    { category: 'Wardrobe', name: 'Door Handle', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 10 },
    { category: 'Wardrobe', name: 'Wardrobe Rail', baseUnit: 'length', bulkUnit: 'bundle', piecesPerBulk: 5 },
    { category: 'Wardrobe', name: 'Edge Tape', baseUnit: 'roll', bulkUnit: 'carton', piecesPerBulk: 20 },

    // Paint
    { category: 'Paint', name: 'Emulsion Paint 20L', baseUnit: 'drum', bulkUnit: 'pallet', piecesPerBulk: 20 },
    { category: 'Paint', name: 'Gloss Paint 4L', baseUnit: 'tin', bulkUnit: 'carton', piecesPerBulk: 4 },
    { category: 'Paint', name: 'Paint Brush 4 inch', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 12 },
    { category: 'Paint', name: 'Roller Brush', baseUnit: 'piece', bulkUnit: 'pack', piecesPerBulk: 12 }
];

// =====================================================================
// 2. QUICK-ADD MATERIALS MODAL
// =====================================================================
window.wdpOpenQuickAddModal = function () {
    var m = document.getElementById('wdp-quick-modal');
    if (m) m.remove();

    m = document.createElement('div');
    m.id = 'wdp-quick-modal';
    m.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; justify-content:center; align-items:center; z-index:1700; padding:16px; box-sizing:border-box; overflow-y:auto;';

    var byCategory = {};
    WDP_COMMON_MATERIALS.forEach(function (item) {
        if (!byCategory[item.category]) byCategory[item.category] = [];
        byCategory[item.category].push(item);
    });

    var categoriesHtml = Object.keys(byCategory).map(function (cat) {
        var itemsHtml = byCategory[cat].map(function (item, idx) {
            return '<label style="display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid #f1f5f9; cursor:pointer; font-size:13px;">' +
                '<input type="checkbox" class="wdp-quick-check" data-category="' + wdpEsc(item.category) + '" data-name="' + wdpEsc(item.name) + '" data-base="' + wdpEsc(item.baseUnit) + '" data-bulk="' + wdpEsc(item.bulkUnit) + '" data-per="' + item.piecesPerBulk + '" style="width:16px; height:16px; margin:0;">' +
                '<span>' + wdpEsc(item.name) + ' <small style="color:#64748b;">(' + item.piecesPerBulk + ' ' + item.baseUnit + ' per ' + item.bulkUnit + ')</small></span>' +
            '</label>';
        }).join('');
        return '<div style="margin-bottom:14px;">' +
            '<div style="font-weight:bold; font-size:12px; color:#c2410c; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; padding:6px 8px; background:#fff7ed; border-radius:6px;">' + wdpEsc(cat) + '</div>' +
            '<div>' + itemsHtml + '</div>' +
        '</div>';
    }).join('');

    m.innerHTML =
        '<div style="background:#fff; color:#0f172a; border-radius:14px; width:100%; max-width:560px; max-height:92vh; padding:20px; box-sizing:border-box; display:flex; flex-direction:column;">' +
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;">' +
                '<div>' +
                    '<h3 style="margin:0; font-size:17px;">📚 Common Materials</h3>' +
                    '<p style="margin:4px 0 0 0; font-size:12px; color:#64748b;">Tick everything you sell. You can adjust prices after.</p>' +
                '</div>' +
                '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="document.getElementById(\'wdp-quick-modal\').remove()">✕</button>' +
            '</div>' +

            '<div style="flex:1; overflow-y:auto; margin-bottom:14px; border:1px solid #e2e8f0; border-radius:10px; padding:8px;">' +
                categoriesHtml +
            '</div>' +

            '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:12px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' +
                '<span style="font-size:12px; font-weight:bold; color:#334155;">Default Selling Prices:</span>' +
                '<input id="wdp-quick-retail" type="number" placeholder="Retail ₦" style="width:110px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px;">' +
                '<input id="wdp-quick-wholesale" type="number" placeholder="Wholesale ₦" style="width:120px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px;">' +
                '<input id="wdp-quick-cost" type="number" placeholder="Cost ₦" style="width:100px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px;">' +
            '</div>' +
            '<div style="font-size:11px; color:#64748b; margin:-6px 0 10px 0;">Leave any price blank — you can set individual prices after adding.</div>' +

            '<div id="wdp-quick-error" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-bottom:10px;"></div>' +

            '<div style="display:flex; gap:10px;">' +
                '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdpSaveQuickAdd()">➕ Add Selected Materials</button>' +
                '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="document.getElementById(\'wdp-quick-modal\').remove()">Cancel</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(m);
};

window.wdpSaveQuickAdd = async function () {
    var err = document.getElementById('wdp-quick-error');
    err.style.display = 'none';
    var fail = function (m) { err.textContent = m; err.style.display = 'block'; };

    var checked = document.querySelectorAll('.wdp-quick-check:checked');
    if (checked.length === 0) return fail('Tick at least one material to add.');

    var retail = parseFloat(document.getElementById('wdp-quick-retail').value) || 0;
    var wholesale = parseFloat(document.getElementById('wdp-quick-wholesale').value) || 0;
    var cost = parseFloat(document.getElementById('wdp-quick-cost').value) || 0;

    var branchId = (typeof currentInventoryBranchFilter !== 'undefined' && currentInventoryBranchFilter && currentInventoryBranchFilter !== 'all')
        ? currentInventoryBranchFilter
        : (typeof currentBranch !== 'undefined' ? currentBranch : 'main');
    if (!branchId) return fail('No branch selected. Please open Inventory first.');

    try {
        var db = firebase.database();
        var batch = {};
        var nowIso = new Date().toISOString();
        var createdBy = (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin';

        var existingSnap = await db.ref('stores/' + currentStoreId + '/inventory/' + branchId).once('value');
        var existing = existingSnap.val() || {};
        var existingNames = {};
        Object.keys(existing).forEach(function (id) {
            var n = (existing[id].name || existing[id].productName || '').toLowerCase().trim();
            if (n) existingNames[n] = true;
        });

        var skipped = [];

        checked.forEach(function (cb) {
            var name = cb.dataset.name;
            if (existingNames[name.toLowerCase().trim()]) {
                skipped.push(name);
                return;
            }
            var newRef = db.ref('stores/' + currentStoreId + '/inventory/' + branchId).push();
            batch[newRef.key] = {
                name: name,
                productName: name,
                category: cb.dataset.category,
                baseUnitName: cb.dataset.base,
                bulkUnitName: cb.dataset.bulk,
                unitsPerPack: parseInt(cb.dataset.per) || 1,
                costPrice: cost,
                price: retail,
                retailPrice: retail,
                wholesalePrice: wholesale,
                piecePrice: 0,
                pieceWholesalePrice: 0,
                stock: 0,
                stockQty: 0,
                expiry: '',
                expiryDate: '',
                branchId: branchId,
                createdAt: nowIso,
                createdBy: createdBy
            };
        });

        var count = Object.keys(batch).length;
        if (count === 0) {
            return fail('All selected materials already exist in this branch. Nothing new added.' + (skipped.length ? '\n\nAlready there: ' + skipped.join(', ') : ''));
        }

        await db.ref('stores/' + currentStoreId + '/inventory/' + branchId).update(batch);
        document.getElementById('wdp-quick-modal').remove();
        alert('✅ Added ' + count + ' material' + (count === 1 ? '' : 's') + ' to your inventory.\n\nOpen Inventory to set individual prices and stock.' + (skipped.length ? '\n\nSkipped (already exist): ' + skipped.join(', ') : ''));

        if (typeof loadInventoryTable === 'function') loadInventoryTable();
    } catch (e) {
        fail('Could not save: ' + (e.message || e));
    }
};

// =====================================================================
// 3. MATERIALS-FRIENDLY FORM LABELS
// =====================================================================
function wdpAdjustProductForm() {
    if (!wdpIsMaterialsStore()) return;
    var modal = document.getElementById('product-form-modal');
    if (!modal || modal.style.display === 'none') return;
    if (modal.dataset.wdpAdjusted === '1') return;

    var baseField = document.getElementById('inv-base-unit-name');
    var bulkField = document.getElementById('inv-bulk-unit-name');

    if (baseField && !baseField.placeholder.includes('sheet')) {
        baseField.placeholder = 'e.g. sheet, bag, piece, kg, roll, box';
    }
    if (bulkField && !bulkField.placeholder.includes('bundle')) {
        bulkField.placeholder = 'e.g. bundle, carton, pallet, roll, tin';
    }

    var lowStockLabel = document.getElementById('inv-low-stock-threshold-label');
    if (lowStockLabel && lowStockLabel.textContent.indexOf('packs') !== -1) {
        lowStockLabel.textContent = lowStockLabel.textContent.replace('packs', 'bulk units');
    }

    modal.dataset.wdpAdjusted = '1';
}

// =====================================================================
// 4. CLEANER RECEIPT FORMAT (quantity × unit price)
// =====================================================================
function wdpEnhanceReceipt() {
    if (!wdpIsMaterialsStore()) return;
    var tbody = document.getElementById('receipt-items-body');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('tr');
    if (rows.length === 0) return;

    rows.forEach(function (row) {
        var cells = row.querySelectorAll('td');
        if (cells.length < 3) return;
        if (row.dataset.wdpFormatted === '1') return;

        var qtyAndUnit = (cells[1].textContent || '').trim();
        var match = qtyAndUnit.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
        if (match) {
            var qty = match[1];
            var unit = match[2].replace(/s$/, '');
            cells[1].innerHTML = '<strong>' + qty + '</strong> ' + unit + (parseFloat(qty) === 1 ? '' : 's');
        }
        cells[2].style.textAlign = 'right';
        row.dataset.wdpFormatted = '1';
    });

    var box = document.getElementById('printable-receipt-box');
    if (box && !box.querySelector('.wdp-served-by')) {
        var staffName = (document.getElementById('user-role-label')?.textContent || 'Staff').split('(')[0].trim();
        var served = document.createElement('div');
        served.className = 'wdp-served-by';
        served.style.cssText = 'margin-top:12px; font-size:11px; text-align:center; padding-top:8px; border-top:1px dashed #ccc; color:#333;';
        served.textContent = 'Served by: ' + staffName;
        box.appendChild(served);
    }
}

window.addEventListener('load', function () {
    if (typeof window.renderReceiptView === 'function' && !window.__wdpReceiptHooked) {
        window.__wdpReceiptHooked = true;
        var origRender = window.renderReceiptView;
        window.renderReceiptView = function () {
            var result = origRender.apply(this, arguments);
            setTimeout(wdpEnhanceReceipt, 250);
            return result;
        };
    }
});

// =====================================================================
// 5. QUICK SALE BUTTON ON MATERIALS DASHBOARD
// =====================================================================
function wdpInjectQuickSaleButton() {
    if (!wdpIsMaterialsStore()) return;
    var ws = document.getElementById('workspace-content');
    if (!ws) return;
    if (document.getElementById('wdp-quick-sale-btn')) return;

    var h2 = ws.querySelector('h2');
    if (!h2 || (h2.textContent || '').indexOf('Materials Dashboard') === -1) return;

    var wrap = document.createElement('div');
    wrap.id = 'wdp-quick-sale-btn';
    wrap.style.cssText = 'margin: 4px 0 16px 0; display:flex; gap:10px; flex-wrap:wrap;';
    wrap.innerHTML =
        '<button class="menu-btn" style="width:auto; margin:0; padding:14px 22px; background:linear-gradient(135deg,#16a34a 0%,#15803d 100%); color:#fff; border:none; font-weight:bold; font-size:14px; box-shadow:0 6px 16px rgba(22,163,74,0.3);" onclick="switchView(\'pos-view\')">🛒 Start New Sale</button>' +
        '<button class="menu-btn" style="width:auto; margin:0; padding:14px 22px; background:linear-gradient(135deg,#0284c7 0%,#0369a1 100%); color:#fff; border:none; font-weight:bold; font-size:14px; box-shadow:0 6px 16px rgba(2,132,199,0.3);" onclick="wdpOpenQuickAddModal()">📚 Common Materials</button>';

    h2.parentNode.insertBefore(wrap, h2.nextSibling);
}

// =====================================================================
// MAIN ATTACH
// =====================================================================
function wdpAttach() {
    if (!wdpIsMaterialsStore()) return;
    wdpAdjustProductForm();
    wdpInjectQuickSaleButton();
}

window.addEventListener('load', function () {
    setTimeout(function () { try { wdpAttach(); } catch (e) { console.warn(e); } }, 1200);

    var wdpObs = new MutationObserver(function () {
        try { wdpAttach(); } catch (e) { console.warn(e); }
    });
    if (document.body) wdpObs.observe(document.body, { childList: true, subtree: true });
});
