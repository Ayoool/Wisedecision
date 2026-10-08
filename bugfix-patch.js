// ==================== WISE DECISION BUG-FIX PATCH (v23) ====================
// Load AFTER script.js and perf-patch.js (all with `defer`).
//
// Fixes:
//  1. Overselling / double stock deduction  -> claim orders + deduct stock atomically
//  2. Profit using today's cost price       -> cost is now saved on every sale line
//  3. Editing a product undoing sales       -> only the stock CHANGE you make is applied
//  4. Stock transfers losing settings/decimals
//  5. Split payments with decimals never balancing
//  6. "Print Receipt" button printing a blank page

console.log("Wise Decision bugfix-patch.js — v23 loaded");

// ---------- Helpers ----------
function wdRound2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function wdFmtMoney(n) { return wdRound2(n).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function wdEscAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function wdStockOf(p) { return Number(p.stock !== undefined ? p.stock : (p.stockQty || 0)) || 0; }

// Put stock back (used to undo a partly-finished sale/transfer). list = [{ ref, amount }]
async function wdRestoreStock(list) {
    for (const entry of list) {
        try {
            await entry.ref.transaction(p => {
                if (p === null || typeof p !== 'object') return p;
                const next = wdRound2(wdStockOf(p) + entry.amount);
                p.stock = next; p.stockQty = next;
                return p;
            });
        } catch (e) { console.error("Stock restore failed:", e); }
    }
}

// ==================== FIX 1: atomic claim + atomic stock deduction ====================
// Removes the pending order in one atomic step. Whoever removes it first "owns" it, so
// two devices can never both complete the same order.
function wdClaimPendingOrder(txId) {
    let claimed = null;
    const ref = firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`);
    return ref.transaction(current => {
        claimed = current;
        return null; // delete it
    }).then(res => (res.committed && claimed) ? claimed : null);
}

// Deducts every cart line from stock atomically; refuses (and undoes everything) if any
// line no longer has enough stock. Also records each line's cost at the moment of sale.
async function wdDeductStockForItems(branchId, items) {
    const done = [];
    const out = [];

    for (const it of items) {
        const copy = Object.assign({}, it);
        const sold = wdRound2(it.piecesNeeded !== undefined ? it.piecesNeeded : it.qty);

        if (!it.id || !(sold > 0)) { out.push(copy); continue; }

        const ref = firebase.database().ref(`stores/${currentStoreId}/inventory/${branchId}/${it.id}`);
        let state = 'missing', cost = 0, available = 0;

        const res = await ref.transaction(prod => {
            if (prod === null || typeof prod !== 'object') { state = 'missing'; return prod; }
            const cur = wdStockOf(prod);
            available = cur;
            const upp = Number(prod.unitsPerPack) || 1;
            cost = (Number(prod.costPrice) || 0) / upp;
            if (cur + 1e-9 < sold) { state = 'insufficient'; return; } // abort
            state = 'ok';
            const next = wdRound2(cur - sold);
            prod.stock = next; prod.stockQty = next;
            return prod;
        });

        if (state === 'insufficient') {
            await wdRestoreStock(done);
            const unit = (it.saleUnit === 'Kg' || it.saleUnit === 'g') ? ' ' + it.saleUnit.toLowerCase() : ' piece(s)';
            return { ok: false, message: `Payment NOT processed: "${it.name}" no longer has enough stock (available ${available}${unit}, needed ${sold}${unit}). The order is still pending — adjust or cancel it.` };
        }

        if (state === 'ok') {
            if (!res.committed) {
                await wdRestoreStock(done);
                return { ok: false, message: 'Could not update stock (connection problem). Nothing was charged — please try again.' };
            }
            done.push({ ref, amount: sold });
            copy.costPerPiece = Math.round(cost * 10000) / 10000;
            copy.lineCost = wdRound2(cost * sold);

            const after = res.snapshot.val();
            if (after && inventoryCache[branchId] && inventoryCache[branchId][it.id]) {
                inventoryCache[branchId][it.id].stock = after.stock;
                inventoryCache[branchId][it.id].stockQty = after.stock;
            }
        }
        out.push(copy);
    }
    return { ok: true, items: out, done };
}

async function completeSplitCheckout() {
    if (!currentActiveOrder) return;

    const cash = wdRound2(parseFloat(document.getElementById('split-cash').value) || 0);
    const transfer = wdRound2(parseFloat(document.getElementById('split-transfer').value) || 0);
    const creditContainer = document.getElementById('split-credit-container');
    const creditVisible = creditContainer && creditContainer.style.display !== 'none';
    const credit = creditVisible ? wdRound2(parseFloat(document.getElementById('split-credit').value) || 0) : 0;

    const txId = currentActiveOrder.txId;
    const customerId = currentActiveOrder.customerId;
    const customerName = currentActiveOrder.customerName;

    if (Math.abs(wdRound2(cash + transfer + credit) - wdRound2(currentActiveOrder.totalAmount)) > 0.005) {
        alert("The payment amounts don't add up to the total due.");
        return;
    }

    closeSplitModal();
    wdShowLoader('Processing payment...');

    let claimedOrder = null;
    let deduction = null;

    try {
        claimedOrder = await wdClaimPendingOrder(txId);
        if (!claimedOrder) {
            wdHideLoader();
            alert("This order was already processed or cancelled by someone else. Nothing was charged.");
            return;
        }

        const branchId = claimedOrder.branchId || 'main';
        deduction = await wdDeductStockForItems(branchId, Array.isArray(claimedOrder.items) ? claimedOrder.items : []);

        if (!deduction.ok) {
            await firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).set(claimedOrder); // put it back
            wdHideLoader();
            alert(deduction.message);
            return;
        }

        const orderData = Object.assign({}, claimedOrder, {
            items: deduction.items,
            status: 'Completed',
            paymentBreakdown: { cash, transfer, credit },
            date: new Date().toISOString(),
            branchId,
            customerId: customerId || null,
            customerName,
            totalAmount: wdRound2(claimedOrder.totalAmount)
        });

        try {
            await firebase.database().ref(`stores/${currentStoreId}/transactions/${txId}`).set(orderData);
        } catch (e) {
            await wdRestoreStock(deduction.done);
            await firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).set(claimedOrder).catch(() => {});
            throw e;
        }

        // Customer credit / lifetime value (each field updated atomically)
        if (customerId && customersCache[customerId]) {
            try {
                const custRef = firebase.database().ref(`stores/${currentStoreId}/customers/${customerId}`);
                let balanceBefore = 0, balanceAfter = 0;
                await custRef.child('balance').transaction(b => {
                    balanceBefore = Number(b) || 0;
                    balanceAfter = wdRound2(balanceBefore + credit);
                    return balanceAfter;
                });
                await custRef.child('totalSpent').transaction(v => wdRound2((Number(v) || 0) + orderData.totalAmount));
                await custRef.child('visitCount').transaction(v => (Number(v) || 0) + 1);
                await custRef.child('lastVisit').set(orderData.date);

                if (credit > 0) {
                    await custRef.child('ledger').push({
                        type: 'credit_sale',
                        amount: credit,
                        balanceBefore,
                        balanceAfter,
                        date: orderData.date,
                        txId,
                        recordedBy: orderData.staff || orderData.soldBy || 'Staff',
                        note: `Credit portion of sale ${txId}`
                    });
                }
            } catch (e) {
                console.error("Customer ledger update failed:", e);
            }
        }

        wdHideLoader();
        renderReceiptView(orderData, false);
    } catch (error) {
        console.error("completeSplitCheckout error:", error);
        wdHideLoader();
        alert("Failed to complete checkout: " + error.message);
    }
}

// ==================== FIX 5: decimal-safe split payments ====================
function openSplitModal(txId, totalAmount) {
    const numericTotal = wdRound2(totalAmount);
    currentActiveOrder = { txId, totalAmount: numericTotal, customerId: null, customerName: 'Walk-In Customer', branchId: currentBranch };

    document.getElementById('modal-tx-id-label').textContent = txId;
    document.getElementById('split-modal-total').textContent = wdFmtMoney(numericTotal);
    document.getElementById('split-cash').value = numericTotal;
    document.getElementById('split-transfer').value = 0;
    const creditInput = document.getElementById('split-credit');
    if (creditInput) creditInput.value = 0;

    const creditContainer = document.getElementById('split-credit-container');
    const custInfo = document.getElementById('split-modal-customer-info');

    firebase.database().ref(`stores/${currentStoreId}/pendingOrders/${txId}`).once('value').then(snapshot => {
        if (snapshot.exists()) {
            const order = snapshot.val();
            currentActiveOrder.customerId = order.customerId || null;
            currentActiveOrder.customerName = order.customerName || 'Walk-In Customer';
            currentActiveOrder.branchId = order.branchId || 'main';
        }

        if (currentActiveOrder.customerId && customersCache[currentActiveOrder.customerId]) {
            const c = customersCache[currentActiveOrder.customerId];
            const available = Math.max(0, (Number(c.creditLimit) || 0) - (Number(c.balance) || 0));
            if (custInfo) custInfo.innerHTML = `Customer: <strong>${c.name}</strong> &nbsp;|&nbsp; Current Balance: ₦${wdFmtMoney(c.balance)} &nbsp;|&nbsp; Credit Available: ₦${wdFmtMoney(available)}`;
            if (creditContainer) creditContainer.style.display = 'block';
        } else {
            if (custInfo) custInfo.innerHTML = `Customer: <strong>${currentActiveOrder.customerName}</strong> &nbsp;|&nbsp; Branch: <strong>${branchNameOf(currentActiveOrder.branchId)}</strong>`;
            if (creditContainer) creditContainer.style.display = 'none';
        }

        document.getElementById('split-modal').style.display = 'flex';
        calcSplit();
    });
}

function calcSplit() {
    const totalDue = currentActiveOrder ? wdRound2(currentActiveOrder.totalAmount) : 0;
    const cashVal = wdRound2(parseFloat(document.getElementById('split-cash').value) || 0);
    const transferVal = wdRound2(parseFloat(document.getElementById('split-transfer').value) || 0);

    const creditContainer = document.getElementById('split-credit-container');
    const creditVisible = creditContainer && creditContainer.style.display !== 'none';
    const creditVal = creditVisible ? wdRound2(parseFloat(document.getElementById('split-credit').value) || 0) : 0;

    const totalPaid = wdRound2(cashVal + transferVal + creditVal);
    const statusField = document.getElementById('split-status');
    const acceptBtn = document.getElementById('dynamic-accept-print-btn');

    const setBtn = (enabled) => {
        acceptBtn.disabled = !enabled;
        acceptBtn.style.opacity = enabled ? "1" : "0.6";
        acceptBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    };

    if (creditVal > 0 && currentActiveOrder && currentActiveOrder.customerId && customersCache[currentActiveOrder.customerId]) {
        const c = customersCache[currentActiveOrder.customerId];
        const available = Math.max(0, (Number(c.creditLimit) || 0) - (Number(c.balance) || 0));
        if (creditVal > available + 0.005) {
            statusField.value = `Status: Credit exceeds available limit (₦${wdFmtMoney(available)}) ⚠`;
            statusField.style.background = "#fef9c3";
            statusField.style.color = "#854d0e";
            setBtn(false);
            return;
        }
    }

    const diffCents = Math.round(totalPaid * 100) - Math.round(totalDue * 100);

    if (diffCents === 0 && totalDue > 0) {
        statusField.value = "Status: Balanced ✅";
        statusField.style.background = "#dcfce7";
        statusField.style.color = "#166534";
        setBtn(true);
    } else if (diffCents > 0) {
        statusField.value = `Status: Overpaid by ₦${wdFmtMoney(totalPaid - totalDue)} ⚠`;
        statusField.style.background = "#fef9c3";
        statusField.style.color = "#854d0e";
        setBtn(false);
    } else {
        statusField.value = `Status: Balance Remaining ₦${wdFmtMoney(totalDue - totalPaid)}`;
        statusField.style.background = "#fee2e2";
        statusField.style.color = "#991b1b";
        setBtn(false);
    }
}

// ==================== FIX 2: profit uses the cost saved on each sale ====================
function loadProfitAndLossModule() {
    if (!currentStoreId) return;

    const plBranchFilter = document.getElementById('sales-branch-filter') ? currentReportBranchFilter : currentBranch;
    const plLabel = document.getElementById('pl-branch-label');
    if (plLabel) plLabel.textContent = plBranchFilter === 'all' ? '(All Branches)' : `(${branchNameOf(plBranchFilter)})`;

    const from = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const root = `stores/${currentStoreId}`;

    Promise.all([
        firebase.database().ref(`${root}/transactions`).orderByChild('date').startAt(from).once('value'),
        firebase.database().ref(`${root}/inventory`).once('value'),
        firebase.database().ref(`${root}/expenses`).orderByChild('date').startAt(from).once('value'),
        firebase.database().ref(`${root}/refunds`).orderByChild('date').startAt(from).once('value')
    ]).then(([txSnapshot, invSnapshot, expSnapshot, refundSnapshot]) => {

        // Only used for OLD sales that were saved before cost-per-line existed
        const costPriceMap = {};
        invSnapshot.forEach(branchChild => {
            const branchId = branchChild.key;
            branchChild.forEach(prodChild => {
                const item = prodChild.val();
                const unitsPerPack = Number(item.unitsPerPack) || 1;
                const cPricePerPiece = (Number(item.costPrice) || 0) / unitsPerPack;
                const itemName = item.name || item.productName || '';
                costPriceMap[`${branchId}_${prodChild.key}`] = cPricePerPiece;
                if (itemName) costPriceMap[itemName.toLowerCase().trim()] = cPricePerPiece;
            });
        });

        let monthRevenue = 0, monthCost = 0, monthExpenses = 0, monthRefunds = 0, monthRefundCost = 0;
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        txSnapshot.forEach(child => {
            const tx = child.val();
            const txBranch = tx.branchId || 'main';
            if (plBranchFilter !== 'all' && txBranch !== plBranchFilter) return;

            const txDate = tx.date ? new Date(tx.date) : null;
            const txTotal = Number(tx.totalAmount) || 0;

            let txCogs = 0;
            if (Array.isArray(tx.items)) {
                tx.items.forEach(cartItem => {
                    if (cartItem.lineCost !== undefined && cartItem.lineCost !== null) {
                        txCogs += Number(cartItem.lineCost) || 0;       // cost frozen at time of sale
                    } else {
                        const unitCost = costPriceMap[`${txBranch}_${cartItem.id}`] || costPriceMap[(cartItem.name || '').toLowerCase().trim()] || 0;
                        const pieces = Number(cartItem.piecesNeeded !== undefined ? cartItem.piecesNeeded : cartItem.qty) || 0;
                        txCogs += unitCost * pieces;
                    }
                });
            }

            if (txDate && txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth) {
                monthRevenue += txTotal;
                monthCost += txCogs;
            }
        });

        expSnapshot.forEach(child => {
            const exp = child.val();
            const expBranch = exp.branchId || 'main';
            if (plBranchFilter !== 'all' && expBranch !== plBranchFilter) return;
            const expDate = exp.date ? new Date(exp.date) : null;
            if (expDate && expDate.getFullYear() === currentYear && expDate.getMonth() === currentMonth) {
                monthExpenses += Number(exp.amount) || 0;
            }
        });

        refundSnapshot.forEach(child => {
            const r = child.val();
            const rBranch = r.branchId || 'main';
            if (plBranchFilter !== 'all' && rBranch !== plBranchFilter) return;
            const rDate = r.date ? new Date(r.date) : null;
            if (rDate && rDate.getFullYear() === currentYear && rDate.getMonth() === currentMonth) {
                monthRefunds += Number(r.totalRefund) || 0;
                if (Array.isArray(r.items)) r.items.forEach(ri => { monthRefundCost += Number(ri.totalCost) || 0; });
            }
        });

        const monthNet = ((monthRevenue - monthRefunds) - (monthCost - monthRefundCost)) - monthExpenses;

        const netProfitDisplay = document.getElementById('net-profit-display');
        if (netProfitDisplay) {
            netProfitDisplay.textContent = '₦' + wdRound2(monthNet).toLocaleString();
            netProfitDisplay.style.color = monthNet >= 0 ? '#065f46' : '#dc2626';
        }
    });
}

// Refunds: block double-refunds atomically, restock atomically, and use the cost saved at sale time.
async function processRefund() {
    if (!currentActiveRefund) return;
    if (currentUserRole !== 'Admin' && currentUserRole !== 'Accountant') {
        alert("Access Restricted: Only an Admin or Accountant can process refunds.");
        return;
    }

    const inputs = document.querySelectorAll('.refund-qty-input');
    const method = document.getElementById('refund-method').value;
    const reason = document.getElementById('refund-reason').value.trim();
    const { txId, branchId, customerId, customerName } = currentActiveRefund;

    const refundLines = [];
    let invalid = false;

    inputs.forEach((input, idx) => {
        const qty = parseFloat(input.value) || 0;
        if (qty <= 0) return;
        const max = parseFloat(input.getAttribute('data-max-refundable')) || 0;
        if (qty > max) { invalid = true; return; }

        const price = parseFloat(input.getAttribute('data-unit-price')) || 0;
        const saleUnit = input.getAttribute('data-sale-unit') || 'Pack';
        const unitsPerPack = parseFloat(input.getAttribute('data-units-per-pack')) || 1;
        const piecesToRestock = wdRound2(saleUnit === 'Piece' ? qty : qty * unitsPerPack);

        refundLines.push({
            itemIndex: idx,
            id: input.getAttribute('data-item-id'),
            name: input.getAttribute('data-item-name'),
            qty,
            saleUnit,
            unitsPerPack,
            unitPrice: price,
            amount: wdRound2(qty * price),
            piecesToRestock
        });
    });

    if (invalid) { alert("One or more refund quantities exceed what's still refundable. Please review and try again."); return; }
    if (refundLines.length === 0) { alert("Select at least one item and quantity to refund."); return; }

    const totalRefund = wdRound2(refundLines.reduce((sum, l) => sum + l.amount, 0));

    if (method === 'Customer Balance') {
        if (!customerId || !customersCache[customerId] || (Number(customersCache[customerId].balance) || 0) <= 0) {
            alert("This customer has no outstanding balance to reduce. Choose Cash or Transfer instead.");
            return;
        }
    }

    wdShowLoader('Processing refund...');
    try {
        const refundId = await generateNextRefundId();
        const processedBy = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;
        const nowIso = new Date().toISOString();

        // 1. Record the refunded quantities on the original sale atomically. If someone
        //    already refunded these items, this fails instead of double-refunding.
        let txState = 'ok';
        const txRef = firebase.database().ref(`stores/${currentStoreId}/transactions/${txId}`);
        const txRes = await txRef.transaction(t => {
            if (t === null) { txState = 'missing'; return t; }
            const items = Array.isArray(t.items) ? t.items : [];
            for (const line of refundLines) {
                const it = items[line.itemIndex];
                if (!it) { txState = 'invalid'; return; }
                const remaining = wdRound2((Number(it.qty) || 0) - (Number(it.refundedQty) || 0));
                if (line.qty > remaining + 1e-9) { txState = 'exceeds'; return; }
            }
            txState = 'ok';
            refundLines.forEach(line => {
                items[line.itemIndex].refundedQty = wdRound2((Number(items[line.itemIndex].refundedQty) || 0) + line.qty);
            });
            t.items = items;
            t.refundedAmount = wdRound2((Number(t.refundedAmount) || 0) + totalRefund);
            t.refundStatus = t.refundedAmount >= (Number(t.totalAmount) || 0) - 0.5 ? 'Refunded' : 'Partially Refunded';
            return t;
        });

        if (!txRes.committed || txState !== 'ok') {
            wdHideLoader();
            closeRefundModal();
            alert("Refund NOT processed: those items were already refunded (possibly from another device) or the order changed. Reopen the order to see its current state.");
            return;
        }
        const updatedTx = txRes.snapshot.val() || {};

        // 2. Restock atomically, and work out the cost being reversed
        const invRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${branchId}`);
        for (const line of refundLines) {
            const saleItem = (updatedTx.items || [])[line.itemIndex] || {};
            let fallbackCost = 0;

            if (line.id) {
                await invRef.child(line.id).transaction(prod => {
                    if (prod === null || typeof prod !== 'object') return prod;
                    fallbackCost = (Number(prod.costPrice) || 0) / (Number(prod.unitsPerPack) || 1);
                    const next = wdRound2(wdStockOf(prod) + line.piecesToRestock);
                    prod.stock = next; prod.stockQty = next;
                    return prod;
                }).then(res => {
                    const after = res.snapshot.val();
                    if (after && inventoryCache[branchId] && inventoryCache[branchId][line.id]) {
                        inventoryCache[branchId][line.id].stock = after.stock;
                        inventoryCache[branchId][line.id].stockQty = after.stock;
                    }
                });
            }

            const cpp = (saleItem.costPerPiece !== undefined && saleItem.costPerPiece !== null) ? (Number(saleItem.costPerPiece) || 0) : fallbackCost;
            line.totalCost = wdRound2(cpp * line.piecesToRestock);
        }

        // 3. Standalone refund record
        const refundData = {
            refundId,
            txId,
            branchId,
            customerId: customerId || null,
            customerName: customerName || 'Walk-In Customer',
            items: refundLines.map(({ itemIndex, piecesToRestock, ...rest }) => rest),
            totalRefund,
            method,
            reason,
            processedBy,
            date: nowIso
        };
        await firebase.database().ref(`stores/${currentStoreId}/refunds/${refundId}`).set(refundData);

        // 4. Customer adjustments
        if (customerId && customersCache[customerId]) {
            try {
                const custRef = firebase.database().ref(`stores/${currentStoreId}/customers/${customerId}`);
                await custRef.child('totalSpent').transaction(v => Math.max(0, wdRound2((Number(v) || 0) - totalRefund)));

                if (method === 'Customer Balance') {
                    let balanceBefore = 0, balanceAfter = 0;
                    await custRef.child('balance').transaction(b => {
                        balanceBefore = Number(b) || 0;
                        balanceAfter = Math.max(0, wdRound2(balanceBefore - totalRefund));
                        return balanceAfter;
                    });
                    await custRef.child('ledger').push({
                        type: 'refund_adjustment',
                        amount: totalRefund,
                        balanceBefore,
                        balanceAfter,
                        date: nowIso,
                        recordedBy: processedBy,
                        note: `Refund ${refundId} applied to balance (order ${txId})`
                    });
                }
            } catch (e) {
                console.error("Customer refund adjustment failed:", e);
            }
        }

        wdHideLoader();
        closeRefundModal();
        renderRefundReceiptView(refundData);
    } catch (err) {
        console.error("processRefund error:", err);
        wdHideLoader();
        alert("Failed to process refund: " + err.message + "\n\nPlease check the order and inventory before retrying.");
    }
}

// ==================== FIX 3: editing a product never overwrites live stock ====================
window.wdEditOriginalStock = null;

(function wrapProductFormHelpers() {
    const origEdit = window.editProduct;
    window.editProduct = function (branchId, id) {
        origEdit(branchId, id);
        const item = inventoryCache[branchId] && inventoryCache[branchId][id];
        window.wdEditOriginalStock = item ? wdStockOf(item) : null;
    };

    const origReset = window.resetInventoryForm;
    window.resetInventoryForm = function () {
        window.wdEditOriginalStock = null;
        return origReset.apply(this, arguments);
    };
})();

function saveProduct() {
    if (!currentStoreId) {
        alert("Error: No active Store ID found. Please log out and log back in.");
        return;
    }
    if (currentInventoryBranchFilter === 'all') {
        alert("Please select a specific branch before adding or editing products — stock is tracked per branch.");
        return;
    }

    const targetBranch = currentInventoryBranchFilter;
    const editId = document.getElementById('edit-product-id').value;
    const editBranch = document.getElementById('edit-product-branch').value || targetBranch;
    const name = document.getElementById('inv-name').value.trim();
    const category = document.getElementById('inv-category')?.value.trim() || '';
    const soldByWeight = document.getElementById('inv-sold-by-weight')?.checked || false;
    const weightUnit = soldByWeight ? (document.getElementById('inv-weight-unit')?.value || 'Kg') : null;
    const weightPerBag = soldByWeight ? (parseFloat(document.getElementById('inv-weight-per-bag')?.value) || 0) : 0;
    const lowStockThresholdRaw = document.getElementById('inv-low-stock-threshold')?.value;
    const lowStockThreshold = (lowStockThresholdRaw !== '' && lowStockThresholdRaw !== undefined) ? (parseFloat(lowStockThresholdRaw) || 0) : null;
    const costPrice = parseFloat(document.getElementById('inv-cost-price').value) || 0;
    const price = parseFloat(document.getElementById('inv-price').value) || 0;
    const wholesalePrice = parseFloat(document.getElementById('inv-wholesale-price').value) || 0;
    const unitsPerPack = soldByWeight ? 1 : (parseInt(document.getElementById('inv-units-per-pack').value) || 1);
    const piecePrice = soldByWeight ? 0 : (parseFloat(document.getElementById('inv-piece-price').value) || 0);

    let stock;
    if (soldByWeight) {
        stock = parseFloat(document.getElementById('inv-stock').value) || 0;
    } else if (unitsPerPack > 1) {
        const packs = parseInt(document.getElementById('inv-stock-packs').value) || 0;
        const loose = parseInt(document.getElementById('inv-stock-loose').value) || 0;
        stock = (packs * unitsPerPack) + loose;
    } else {
        const packs = parseInt(document.getElementById('inv-stock').value) || 0;
        stock = packs * unitsPerPack;
    }

    const expiry = document.getElementById('inv-expiry').value;

    if (!name) {
        alert("Please provide a product name.");
        return;
    }

    const prodData = {
        name,
        productName: name,
        category,
        soldByWeight,
        weightUnit,
        weightPerBag,
        lowStockThreshold,
        costPrice,
        price,
        retailPrice: price,
        wholesalePrice,
        unitsPerPack,
        piecePrice,
        stock,
        stockQty: stock,
        expiry,
        expiryDate: expiry,
        branchId: editId ? editBranch : targetBranch
    };

    const invRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${editId ? editBranch : targetBranch}`);

    if (editId) {
        const original = window.wdEditOriginalStock;
        const knowsOriginal = original !== null && original !== undefined;
        const stockDelta = knowsOriginal ? wdRound2(stock - original) : 0;

        // Never write the (possibly stale) stock figure from the form — only the change the user made.
        const updateData = Object.assign({}, prodData);
        if (knowsOriginal) { delete updateData.stock; delete updateData.stockQty; }

        invRef.child(editId).update(updateData).then(() => {
            if (!knowsOriginal || Math.abs(stockDelta) < 1e-9) return;
            return invRef.child(editId).transaction(p => {
                if (p === null || typeof p !== 'object') return p;
                const next = Math.max(0, wdRound2(wdStockOf(p) + stockDelta));
                p.stock = next; p.stockQty = next;
                return p;
            });
        }).then(() => {
            alert("Product updated successfully!");
            resetInventoryForm();
            closeProductModal();
        }).catch(err => {
            alert("Failed to update product: " + err.message);
        });
    } else {
        const newRef = invRef.push();
        newRef.set(prodData).then(() => {
            alert(`Product saved successfully to ${branchNameOf(targetBranch)}!`);
            resetInventoryForm();
            closeProductModal();
        }).catch(err => {
            saveRecordLocallyOrCloud('offline_inventory_queue', prodData, `stores/${currentStoreId}/inventory/${targetBranch}`, () => {
                resetInventoryForm();
                closeProductModal();
            });
        });
    }
}

// ==================== FIX 4: stock transfers keep settings and decimals ====================
function onTransferFromBranchChange() {
    const fromBranchId = document.getElementById('transfer-from-branch').value;
    const itemsList = document.getElementById('transfer-items-list');
    if (!itemsList) return;

    firebase.database().ref(`stores/${currentStoreId}/inventory/${fromBranchId}`).once('value').then(snapshot => {
        let html = '';
        snapshot.forEach(child => {
            const item = child.val();
            const stock = wdStockOf(item);
            if (stock <= 0) return;
            const name = item.name || item.productName || 'Unnamed Item';
            const unit = item.soldByWeight ? ' ' + (item.weightUnit || 'Kg').toLowerCase() : ((Number(item.unitsPerPack) || 1) > 1 ? ' pcs' : '');
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 4px; border-bottom:1px solid #f1f5f9; font-size:13px;">
                    <span>${name} <small style="color:var(--text-muted);">(Stock: ${stock}${unit})</small></span>
                    <input type="number" min="0" max="${stock}" step="any" value="0" data-product-id="${wdEscAttr(child.key)}" data-product-name="${wdEscAttr(name)}" data-max-stock="${stock}" class="transfer-qty-input" style="width:80px; padding:4px 6px; border:1px solid #cbd5e1; border-radius:6px;">
                </div>
            `;
        });

        itemsList.innerHTML = html || `<div style="text-align:center; color: var(--text-muted); font-size: 12px; padding: 10px;">No stock available at ${branchNameOf(fromBranchId)}.</div>`;
    });
}

async function createTransfer() {
    const fromBranch = document.getElementById('transfer-from-branch').value;
    const toBranch = document.getElementById('transfer-to-branch').value;

    if (fromBranch === toBranch) {
        alert("Source and destination branches must be different.");
        return;
    }

    const wanted = [];
    let overStock = null;
    document.querySelectorAll('.transfer-qty-input').forEach(input => {
        const qty = wdRound2(parseFloat(input.value) || 0);
        const maxStock = parseFloat(input.getAttribute('data-max-stock')) || 0;
        if (qty > 0) {
            if (qty > maxStock + 1e-9) { overStock = input.getAttribute('data-product-name'); return; }
            wanted.push({ productId: input.getAttribute('data-product-id'), name: input.getAttribute('data-product-name'), qty });
        }
    });

    if (overStock) { alert(`Quantity for "${overStock}" exceeds available stock at the source branch.`); return; }
    if (wanted.length === 0) { alert("Please enter a quantity greater than zero for at least one item."); return; }

    wdShowLoader('Dispatching transfer...');
    const done = [];
    const items = [];

    try {
        for (const w of wanted) {
            const ref = firebase.database().ref(`stores/${currentStoreId}/inventory/${fromBranch}/${w.productId}`);
            let state = 'missing', available = 0, snap = null;

            const res = await ref.transaction(prod => {
                if (prod === null || typeof prod !== 'object') { state = 'missing'; return prod; }
                const cur = wdStockOf(prod);
                available = cur;
                if (cur + 1e-9 < w.qty) { state = 'insufficient'; return; }
                state = 'ok';
                snap = {
                    category: prod.category || '',
                    soldByWeight: !!prod.soldByWeight,
                    weightUnit: prod.weightUnit || '',
                    weightPerBag: Number(prod.weightPerBag) || 0,
                    lowStockThreshold: (prod.lowStockThreshold === undefined || prod.lowStockThreshold === null) ? null : Number(prod.lowStockThreshold),
                    costPrice: Number(prod.costPrice) || 0,
                    price: Number(prod.price !== undefined ? prod.price : prod.retailPrice) || 0,
                    wholesalePrice: Number(prod.wholesalePrice) || 0,
                    unitsPerPack: Number(prod.unitsPerPack) || 1,
                    piecePrice: Number(prod.piecePrice) || 0,
                    expiry: prod.expiry || prod.expiryDate || ''
                };
                const next = wdRound2(cur - w.qty);
                prod.stock = next; prod.stockQty = next;
                return prod;
            });

            if (state !== 'ok' || !res.committed) {
                await wdRestoreStock(done);
                wdHideLoader();
                alert(state === 'insufficient'
                    ? `Transfer NOT sent: "${w.name}" only has ${available} left at the source branch now.`
                    : `Transfer NOT sent: "${w.name}" could not be found at the source branch.`);
                return;
            }
            done.push({ ref, amount: w.qty });
            items.push({ productId: w.productId, name: w.name, qty: w.qty, product: snap });
        }

        const transferId = 'TRF-' + Math.floor(100000 + Math.random() * 900000);
        const createdBy = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;

        try {
            await firebase.database().ref(`stores/${currentStoreId}/transfers/${transferId}`).set({
                fromBranch, toBranch, items, status: 'In Transit', createdBy, createdAt: new Date().toISOString()
            });
        } catch (e) {
            await wdRestoreStock(done);
            throw e;
        }

        wdHideLoader();
        alert(`Transfer waybill ${transferId} dispatched from ${branchNameOf(fromBranch)} to ${branchNameOf(toBranch)}!`);
        closeCreateTransferModal();
        switchView('transfers-view');
    } catch (err) {
        wdHideLoader();
        alert("Failed to create transfer: " + err.message);
    }
}

async function confirmTransferReceipt(transferId) {
    const tRef = firebase.database().ref(`stores/${currentStoreId}/transfers/${transferId}`);
    const snapshot = await tRef.once('value');
    if (!snapshot.exists()) return;
    const t = snapshot.val();
    if (t.status !== 'In Transit') { alert("This transfer has already been processed."); return; }

    if (!confirm(`Confirm that ${branchNameOf(t.toBranch)} has received this shipment from ${branchNameOf(t.fromBranch)}? This will add the items to ${branchNameOf(t.toBranch)}'s stock.`)) return;

    wdShowLoader('Receiving stock...');
    let processed = 0;

    try {
        // Claim it so it can't be received twice (or cancelled at the same time)
        const claim = await tRef.child('status').transaction(cur => (cur === 'In Transit' ? 'Receiving' : (cur === null ? cur : undefined)));
        if (!claim.committed || claim.snapshot.val() !== 'Receiving') {
            wdHideLoader();
            alert("This transfer has already been processed.");
            return;
        }

        const destRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${t.toBranch}`);

        for (const item of (t.items || [])) {
            const destSnap = await destRef.once('value');
            let matchId = null;
            const wanted = (item.name || '').toLowerCase().trim();
            destSnap.forEach(prodChild => {
                const p = prodChild.val();
                if (((p.name || p.productName || '').toLowerCase().trim()) === wanted) matchId = prodChild.key;
            });

            if (matchId) {
                await destRef.child(matchId).transaction(p => {
                    if (p === null || typeof p !== 'object') return p;
                    const next = wdRound2(wdStockOf(p) + item.qty);
                    p.stock = next; p.stockQty = next;
                    return p;
                });
            } else {
                let src = item.product;
                if (!src) { // older transfers without a saved snapshot: copy from the source branch
                    try {
                        const s = await firebase.database().ref(`stores/${currentStoreId}/inventory/${t.fromBranch}/${item.productId}`).once('value');
                        src = s.exists() ? s.val() : {};
                    } catch (e) { src = {}; }
                }
                const stockVal = wdRound2(item.qty);
                const expiry = src.expiry || src.expiryDate || '';
                const retail = Number(src.price !== undefined ? src.price : src.retailPrice) || 0;
                await destRef.push().set({
                    name: item.name,
                    productName: item.name,
                    category: src.category || '',
                    soldByWeight: !!src.soldByWeight,
                    weightUnit: src.soldByWeight ? (src.weightUnit || 'Kg') : null,
                    weightPerBag: Number(src.weightPerBag) || 0,
                    lowStockThreshold: (src.lowStockThreshold === undefined || src.lowStockThreshold === null) ? null : Number(src.lowStockThreshold),
                    costPrice: Number(src.costPrice) || 0,
                    price: retail,
                    retailPrice: retail,
                    wholesalePrice: Number(src.wholesalePrice) || 0,
                    unitsPerPack: Number(src.unitsPerPack) || 1,
                    piecePrice: Number(src.piecePrice) || 0,
                    stock: stockVal,
                    stockQty: stockVal,
                    expiry,
                    expiryDate: expiry,
                    branchId: t.toBranch
                });
            }
            processed++;
        }

        const receivedBy = document.getElementById('user-role-label') ? document.getElementById('user-role-label').textContent : currentUserRole;
        await tRef.update({ status: 'Completed', receivedBy, receivedAt: new Date().toISOString() });
        wdHideLoader();
        alert("Transfer confirmed — stock has been added to the destination branch.");
    } catch (err) {
        console.error("confirmTransferReceipt error:", err);
        wdHideLoader();
        if (processed === 0) {
            await tRef.child('status').set('In Transit').catch(() => {});
            alert("Failed to confirm transfer: " + err.message);
        } else {
            alert("The transfer was only PARTLY received (" + processed + " item(s) added) before an error happened. Please check " + branchNameOf(t.toBranch) + "'s stock before doing anything else.\n\n" + err.message);
        }
    }
}

async function cancelTransfer(transferId) {
    const tRef = firebase.database().ref(`stores/${currentStoreId}/transfers/${transferId}`);
    const snapshot = await tRef.once('value');
    if (!snapshot.exists()) return;
    const t = snapshot.val();
    if (t.status !== 'In Transit') { alert("Only transfers still In Transit can be cancelled."); return; }

    if (!confirm(`Cancel this transfer and return the stock to ${branchNameOf(t.fromBranch)}?`)) return;

    wdShowLoader('Cancelling transfer...');
    try {
        const claim = await tRef.child('status').transaction(cur => (cur === 'In Transit' ? 'Cancelled' : (cur === null ? cur : undefined)));
        if (!claim.committed || claim.snapshot.val() !== 'Cancelled') {
            wdHideLoader();
            alert("This transfer has already been processed.");
            return;
        }

        const sourceRef = firebase.database().ref(`stores/${currentStoreId}/inventory/${t.fromBranch}`);
        for (const item of (t.items || [])) {
            await sourceRef.child(item.productId).transaction(p => {
                if (p === null || typeof p !== 'object') return p;
                const next = wdRound2(wdStockOf(p) + item.qty);
                p.stock = next; p.stockQty = next;
                return p;
            });
        }
        wdHideLoader();
        alert("Transfer cancelled and stock returned to the source branch.");
    } catch (err) {
        wdHideLoader();
        alert("Failed to cancel transfer: " + err.message);
    }
}

// ==================== FIX 6: "Print Receipt" buttons print the receipt, not a blank page ====================
// The page's print stylesheet hides everything (including the parents of the receipt), so
// window.print() came out blank. Route those buttons through the same hidden-frame printer
// already used for automatic receipts.
(function fixReceiptPrintButtons() {
    try {
        const nativePrint = window.print.bind(window);
        window.print = function () {
            const box = document.querySelector(
                '#workspace-content #printable-receipt-box, #workspace-content #printable-debt-receipt-box, ' +
                '#workspace-content #printable-refund-receipt-box, #workspace-content #printable-waybill-box'
            );
            if (box && typeof triggerThermalPrint === 'function') {
                triggerThermalPrint(box.innerHTML);
                return;
            }
            nativePrint();
        };
    } catch (e) {
        console.warn("Could not patch window.print:", e);
    }
})();
