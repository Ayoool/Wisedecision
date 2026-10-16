// ==================== WISE DECISION CART UNIT SWITCH PATCH (v1) ====================
// Load LAST (after every other patch), with `defer`.
//
// Adds a small "⇄" button to each POS cart line so a cashier can switch that line
// between Pack and Piece/Sachet (or whatever the product's custom unit names are)
// without removing the item and adding it again.
//
// What a switch does:
//   - keeps the same quantity number (2 packs -> 2 pieces)
//   - re-prices the line using the product's price for the new unit and the
//     customer tier already on the line (Retail / Wholesale)
//   - re-checks stock for the new unit and refuses if there isn't enough
//   - asks first if the line had a manually typed price
// The button only shows for products that can be sold both ways (pieces per pack > 1).

console.log("Wise Decision cart-unit-toggle-patch.js — v1 loaded");

function wdcRound2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function wdcStockOf(p) {
    return Number(p.stock !== undefined ? p.stock : (p.stockQty || 0)) || 0;
}

function wdcPackPrice(stockItem, customerType) {
    var retail = Number(stockItem.price || stockItem.retailPrice) || 0;
    var wholesale = Number(stockItem.wholesalePrice) || retail;
    return customerType === 'Wholesale' ? wholesale : retail;
}

function wdcDefaultPrice(stockItem, unit, customerType) {
    return unit === 'Piece' ? getPiecePrice(stockItem, customerType) : wdcPackPrice(stockItem, customerType);
}

function wdcCanToggle(line, stockItem) {
    if (!line || !stockItem) return false;
    if (line.saleUnit !== 'Piece' && line.saleUnit !== 'Pack') return false;
    if (stockItem.soldByWeight) return false;
    return (Number(line.unitsPerPack || stockItem.unitsPerPack) || 1) > 1;
}

function toggleCartUnit(index) {
    var line = currentCart[index];
    if (!line) return;

    var stockItem = (inventoryCache[currentBranch] || {})[line.id];
    if (!wdcCanToggle(line, stockItem)) {
        alert("This item can't be switched between units.");
        return;
    }

    var upp = Number(line.unitsPerPack || stockItem.unitsPerPack) || 1;
    var fromUnit = line.saleUnit;
    var toUnit = fromUnit === 'Piece' ? 'Pack' : 'Piece';
    var tier = line.customerType || currentCustomerType;
    var labels = getUnitLabels(stockItem);
    var toName = toUnit === 'Piece' ? labels.baseName : labels.bulkName;

    // If the cashier typed a custom price on this line, ask before replacing it.
    var oldDefault = wdcDefaultPrice(stockItem, fromUnit, tier);
    if (Math.abs((Number(line.price) || 0) - oldDefault) > 0.005) {
        var newDefaultPreview = wdcDefaultPrice(stockItem, toUnit, tier);
        if (!confirm('This line has a custom price of ₦' + Number(line.price).toLocaleString() +
            '.\n\nSwitching to ' + toName + ' will use the normal ' + tier.toLowerCase() +
            ' price of ₦' + Number(newDefaultPreview).toLocaleString() + '. Continue?')) return;
    }

    var newPrice = wdcDefaultPrice(stockItem, toUnit, tier);
    var newPieces = wdcRound2(toUnit === 'Piece' ? line.qty : line.qty * upp);

    // Stock check, counting other cart lines for the same product
    var inOtherLines = currentCart
        .filter(function (ci, i) { return i !== index && ci.id === line.id; })
        .reduce(function (sum, ci) { return sum + (Number(ci.piecesNeeded) || 0); }, 0);
    var stock = wdcStockOf(stockItem);

    if (inOtherLines + newPieces > stock + 1e-9) {
        var remaining = Math.max(0, stock - inOtherLines);
        alert('Cannot switch to ' + toName.toLowerCase() + ': only ' + remaining +
            ' piece(s) of "' + line.name + '" are in stock and this would need ' + newPieces + '.');
        return;
    }

    var oldPrice = Number(line.price) || 0;
    var oldUnit = fromUnit;

    line.saleUnit = toUnit;
    line.unitsPerPack = upp;
    line.price = newPrice;
    line.piecesNeeded = newPieces;
    line.total = wdcRound2(line.qty * newPrice);

    try {
        if (typeof window.auditLog === 'function') {
            window.auditLog(
                'unit_switch',
                line.name,
                'Cart line switched from ' + oldUnit + ' (₦' + oldPrice + ') to ' + toUnit + ' (₦' + newPrice + ') x' + line.qty,
                { from: oldUnit, to: toUnit, oldPrice: oldPrice, newPrice: newPrice, qty: line.qty, source: 'cart_unit_switch' }
            );
        }
    } catch (e) { /* audit is optional */ }

    renderCart();
}

// Adds the button to every eligible row after the cart is drawn.
function wdcDecorateCart() {
    var tbody = document.getElementById('cart-body');
    if (!tbody || typeof currentCart === 'undefined') return;

    var rows = tbody.querySelectorAll(':scope > tr');
    if (rows.length !== currentCart.length) return;   // empty-cart row or a different layout

    rows.forEach(function (row, index) {
        var line = currentCart[index];
        var stockItem = (inventoryCache[currentBranch] || {})[line && line.id];
        if (!wdcCanToggle(line, stockItem)) return;

        var firstCell = row.querySelector('td');
        if (!firstCell || firstCell.querySelector('.wd-unit-toggle')) return;

        var labels = getUnitLabels(stockItem);
        var targetName = line.saleUnit === 'Piece' ? labels.bulkName : labels.baseName;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-btn wd-unit-toggle';
        btn.textContent = '⇄ ' + targetName;
        btn.title = 'Switch this line to ' + targetName;
        btn.style.cssText = 'display:inline-block; width:auto; margin:4px 0 0 0; padding:2px 8px; font-size:10px; ' +
            'background:#f5f3ff; color:#6d28d9; border:1px solid #ddd6fe;';
        btn.onclick = function () { toggleCartUnit(index); };

        firstCell.appendChild(document.createElement('br'));
        firstCell.appendChild(btn);
    });
}

// Wrap renderCart so every redraw (add, +/-, resume held cart, etc.) gets the buttons.
(function wrapRenderCart() {
    var prev = window.renderCart;
    if (typeof prev !== 'function') return;
    window.renderCart = function () {
        var result = prev.apply(this, arguments);
        try { wdcDecorateCart(); } catch (e) { console.warn('cart unit switch: could not add buttons', e); }
        return result;
    };
})();
