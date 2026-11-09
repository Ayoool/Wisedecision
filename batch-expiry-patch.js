// ==================== WISE DECISION BATCH & EXPIRY PATCH (v1) ====================
// Load LAST (after script.js, perf-patch.js, bugfix-patch.js and every other patch), with `defer`.
//
// Every product can now hold several BATCHES: batch number, expiry date and quantity left.
//
//   * Restock (single restock and Record Supply) gets "Batch no." and "Expiry date" boxes.
//   * Selling uses the batch that expires FIRST. The batch used is saved on every sale line (for recalls).
//     In the cart, a "change batch" link lets the cashier pick a different batch.
//   * A batch that has passed its expiry date is never sold: adding it to the cart is blocked.
//   * Dashboard "Expiring Soon" now lists each batch ("Amoxicillin - batch B-204, 40 left").
//   * Inventory screen: "📅 Batches" on each product, "📅 Expiry report" and "🔎 Batch recall" buttons.
//   * Expired stock can be written off (Admin/Manager). Refunds put stock back into the batch it came from.
//
// Your existing stock figure and expiry field are NOT replaced:
//   - product.stock stays the total (every other screen keeps working)
//   - product.expiry is kept equal to the EARLIEST expiry among the batches that still have stock
//   - the first time a product gets a batch, its current stock becomes an "Opening stock" batch
//
// Data:  stores/<id>/inventory/<branch>/<productId>/batches/<batchId> = { batchNo, expiry, qty, received, receivedAt, ... }
//        stores/<id>/expiryWriteOffs/<id>  (written-off expired stock)
// Quantities are in the same unit as `stock` (pieces, or Kg/g for items sold by weight).
//
// Known limits of v1: stock transfers between branches and product edits do not move batches. If batch totals
// ever differ from the stock figure, open the product's "📅 Batches" and tap "Match batches to stock".

console.log("Wise Decision batch-expiry-patch.js — v1 loaded");

(function () {
    'use strict';

    var SOON_DAYS = 30;

    // =====================================================================
    // HELPERS
    // =====================================================================
    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function num(n) { return Number(n) || 0; }
    function r3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }
    function pad2(n) { return String(n).padStart(2, '0'); }
    function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function daysTo(exp) {
        if (!exp) return null;
        var a = new Date(todayStr() + 'T00:00:00'), b = new Date(exp + 'T00:00:00');
        return isNaN(b) ? null : Math.round((b - a) / 86400000);
    }
    function prettyDate(exp) { if (!exp) return '—'; var d = new Date(exp + 'T00:00:00'); return isNaN(d) ? esc(exp) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function role() { return (typeof currentUserRole !== 'undefined') ? currentUserRole : ''; }
    function canManage() { var r = role(); return r === 'Admin' || r === 'Manager'; }
    function who() { var el = $('user-role-label'); return (el && el.textContent) ? el.textContent : role(); }
    function invBranch() {
        return (typeof currentInventoryBranchFilter !== 'undefined' && currentInventoryBranchFilter && currentInventoryBranchFilter !== 'all')
            ? currentInventoryBranchFilter : ((typeof currentBranch !== 'undefined' && currentBranch) ? currentBranch : 'main');
    }
    function prodRef(branch, id) { return firebase.database().ref('stores/' + sid() + '/inventory/' + branch + '/' + id); }
    function stockOf(p) { return num(p && (p.stock !== undefined ? p.stock : p.stockQty)); }
    function isExpiredOn(exp, today) { return !!exp && exp < today; }

    // ---------- pure batch maths (also exposed for testing) ----------
    function batchList(item) {
        var b = (item && item.batches) || {};
        return Object.keys(b).map(function (k) {
            var x = b[k] || {};
            return { id: k, batchNo: x.batchNo || '', expiry: x.expiry || '', qty: num(x.qty), received: num(x.received), receivedAt: x.receivedAt || '', supplier: x.supplier || '', opening: !!x.opening };
        });
    }
    function sortFefo(list) {
        return list.slice().sort(function (a, b) {
            var ae = a.expiry || '9999-99-99', be = b.expiry || '9999-99-99';
            if (ae !== be) return ae < be ? -1 : 1;
            return String(a.receivedAt).localeCompare(String(b.receivedAt));
        });
    }
    function minExpiry(list) {
        var e = sortFefo(list.filter(function (b) { return b.qty > 0 && b.expiry; }))[0];
        return e ? e.expiry : '';
    }
    // Takes `need` units out of the batches object, earliest expiry first. Expired batches are used only as a last resort.
    // Mutates batchesObj and returns { alloc:[{batchId,batchNo,expiry,qty,expired}], left }
    function allocate(batchesObj, need, today, pickId) {
        var out = { alloc: [], left: need };
        if (!batchesObj || typeof batchesObj !== 'object') return out;
        var list = Object.keys(batchesObj).map(function (k) {
            var x = batchesObj[k] || {};
            return { id: k, expiry: x.expiry || '', qty: num(x.qty), receivedAt: x.receivedAt || '', batchNo: x.batchNo || '' };
        }).filter(function (b) { return b.qty > 0; });
        var ok = sortFefo(list.filter(function (b) { return !isExpiredOn(b.expiry, today); }));
        var expd = sortFefo(list.filter(function (b) { return isExpiredOn(b.expiry, today); }));
        var order = [];
        if (pickId) {
            var picked = ok.filter(function (b) { return b.id === pickId; })[0];
            if (picked) { order.push(picked); ok = ok.filter(function (b) { return b !== picked; }); }
        }
        order = order.concat(ok).concat(expd);
        var left = need;
        order.forEach(function (b) {
            if (left <= 1e-9) return;
            var take = Math.min(b.qty, left);
            if (take <= 0) return;
            batchesObj[b.id].qty = r3(b.qty - take);
            left = r3(left - take);
            out.alloc.push({ batchId: b.id, batchNo: b.batchNo, expiry: b.expiry, qty: r3(take), expired: isExpiredOn(b.expiry, today) });
        });
        out.left = left;
        return out;
    }
    window.__wdbt = { allocate: allocate, sortFefo: sortFefo, minExpiry: minExpiry, batchList: batchList };

    function fmtQty(item, q) {
        if (item && item.soldByWeight) return r3(q) + ' ' + String(item.weightUnit || 'Kg').toLowerCase();
        if (typeof stockBreakdownLabelWithUnits === 'function' && typeof getUnitLabels === 'function') {
            try { return stockBreakdownLabelWithUnits(q, item && item.unitsPerPack, getUnitLabels(item)); } catch (e) { /* fall through */ }
        }
        return String(r3(q));
    }
    function chip(exp, qty) {
        if (qty !== undefined && qty <= 0) return '<span style="background:#f1f5f9; color:#64748b; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">EMPTY</span>';
        var d = daysTo(exp);
        if (d === null) return '<span style="background:#f1f5f9; color:#475569; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">NO EXPIRY</span>';
        if (d < 0) return '<span style="background:#fee2e2; color:#991b1b; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">EXPIRED ' + (-d) + ' d ago</span>';
        if (d <= SOON_DAYS) return '<span style="background:#fef3c7; color:#92400e; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">' + d + ' day' + (d === 1 ? '' : 's') + ' left</span>';
        return '<span style="background:#dcfce7; color:#166534; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">OK</span>';
    }

    // =====================================================================
    // DATABASE ACTIONS
    // =====================================================================
    async function syncExpiry(branch, id) {
        var snap = await prodRef(branch, id).child('batches').once('value');
        var list = batchList({ batches: snap.val() });
        if (!list.length) return;
        var exp = minExpiry(list);
        await prodRef(branch, id).update({ expiry: exp, expiryDate: exp });
        try { if (inventoryCache[branch] && inventoryCache[branch][id]) { inventoryCache[branch][id].expiry = exp; inventoryCache[branch][id].expiryDate = exp; } } catch (e) { /* cache optional */ }
    }

    // First batch for a product: today's stock becomes an "Opening stock" batch so nothing is lost.
    async function ensureOpening(branch, id) {
        var snap = await prodRef(branch, id).once('value');
        var p = snap.val();
        if (!p) return null;
        var has = p.batches && Object.keys(p.batches).length > 0;
        var st = stockOf(p);
        if (!has && st > 0) {
            var k = prodRef(branch, id).child('batches').push().key;
            await prodRef(branch, id).child('batches/' + k).set({
                batchNo: 'Opening stock', expiry: p.expiry || p.expiryDate || '', qty: r3(st), received: r3(st),
                receivedAt: '2000-01-01T00:00:00.000Z', opening: true, by: who()
            });
        }
        return p;
    }

    async function addBatch(branch, id, qty, batchNo, expiry, supplier) {
        var ref = prodRef(branch, id).child('batches').push();
        await ref.set({ batchNo: batchNo || '', expiry: expiry || '', qty: r3(qty), received: r3(qty), receivedAt: new Date().toISOString(), supplier: supplier || '', by: who() });
        await syncExpiry(branch, id);
    }

    async function deductBatches(branch, id, pieces, pickId) {
        var ref = prodRef(branch, id).child('batches');
        var alloc = [], t = todayStr();
        var res = await ref.transaction(function (cur) {
            alloc = [];
            if (!cur || typeof cur !== 'object') return cur;
            var o = allocate(cur, pieces, t, pickId);
            alloc = o.alloc;
            return alloc.length ? cur : undefined;
        });
        if (!res.committed || !alloc.length) return [];
        try { await syncExpiry(branch, id); } catch (e) { console.warn('[batch] expiry sync failed', e); }
        try {   // keep the in-memory POS list in step
            var c = inventoryCache[branch] && inventoryCache[branch][id];
            if (c && c.batches) alloc.forEach(function (a) { if (c.batches[a.batchId]) c.batches[a.batchId].qty = r3(num(c.batches[a.batchId].qty) - a.qty); });
        } catch (e) { /* optional */ }
        return alloc;
    }

    async function restoreBatches(branch, id, allocs) {
        if (!allocs || !allocs.length) return;
        await prodRef(branch, id).child('batches').transaction(function (cur) {
            if (!cur || typeof cur !== 'object') return cur;
            var changed = false;
            allocs.forEach(function (a) {
                if (cur[a.batchId]) { cur[a.batchId].qty = r3(num(cur[a.batchId].qty) + num(a.qty)); changed = true; }
            });
            return changed ? cur : undefined;
        });
        try { await syncExpiry(branch, id); } catch (e) { /* ignore */ }
    }

    // =====================================================================
    // HOOK 1 - SELLING: take batches in earliest-expiry order when a sale completes
    // =====================================================================
    (function hookDeduct() {
        var origDeduct = window.wdDeductStockForItems;
        var origRestore = window.wdRestoreStock;
        if (typeof origDeduct !== 'function') { console.warn('[batch] wdDeductStockForItems not found - selling will not use batches'); return; }

        window.wdDeductStockForItems = async function (branchId, items) {
            var res = await origDeduct.apply(this, arguments);
            if (!res || !res.ok || !Array.isArray(res.items)) return res;
            for (var i = 0; i < res.items.length; i++) {
                var it = res.items[i];
                var pieces = r3(it.piecesNeeded !== undefined ? it.piecesNeeded : it.qty);
                if (!it.id || !(pieces > 0)) continue;
                try {
                    var alloc = await deductBatches(branchId, it.id, pieces, it.batchPick || null);
                    if (alloc.length) {
                        it.batchAllocations = alloc;
                        var d = (res.done || []).filter(function (x) { return x.ref && x.ref.key === it.id && !x.__alloc; })[0];
                        if (d) { d.__alloc = alloc; d.__branch = branchId; }
                    }
                } catch (e) { console.warn('[batch] could not take batch stock for', it.name, e); }
            }
            return res;
        };

        if (typeof origRestore === 'function') {   // a sale that fails half-way puts the batches back too
            window.wdRestoreStock = async function (list) {
                await origRestore.apply(this, arguments);
                for (var i = 0; i < (list || []).length; i++) {
                    var e = list[i];
                    if (e && e.__alloc) { try { await restoreBatches(e.__branch, e.ref.key, e.__alloc); } catch (err) { console.warn('[batch] restore failed', err); } }
                }
            };
        }
    })();

    // =====================================================================
    // HOOK 2 - REFUNDS: stock goes back to the batch it came from
    // =====================================================================
    (function hookRefund() {
        var orig = window.renderRefundReceiptView;
        if (typeof orig !== 'function') return;
        window.renderRefundReceiptView = function (refundData) {
            try { wdbtRestoreRefund(refundData); } catch (e) { console.warn('[batch] refund restore failed', e); }
            return orig.apply(this, arguments);
        };
    })();

    async function wdbtRestoreRefund(refundData) {
        if (!refundData || !refundData.txId || !sid()) return;
        var branch = refundData.branchId || 'main';
        var snap = await firebase.database().ref('stores/' + sid() + '/transactions/' + refundData.txId + '/items').once('value');
        var items = snap.val();
        if (!Array.isArray(items)) return;
        for (var i = 0; i < (refundData.items || []).length; i++) {
            var line = refundData.items[i];
            if (!line.id) continue;
            var saleLine = items.filter(function (x) { return x && x.id === line.id && Array.isArray(x.batchAllocations); })[0];
            if (!saleLine) continue;
            var unit = line.saleUnit || 'Pack', upp = num(line.unitsPerPack) || 1;
            var pieces = r3(unit === 'Piece' || unit === 'Kg' || unit === 'g' ? num(line.qty) : num(line.qty) * upp);
            var give = [], left = pieces;
            saleLine.batchAllocations.forEach(function (a) {
                if (left <= 0) return;
                var q = Math.min(num(a.qty), left);
                give.push({ batchId: a.batchId, qty: q });
                left = r3(left - q);
            });
            if (give.length) await restoreBatches(branch, line.id, give);
        }
    }

    // =====================================================================
    // HOOK 3 - POS: never sell expired batches; choose a different batch in the cart
    // =====================================================================
    (function hookAddToCart() {
        var orig = window.addToCart;
        if (typeof orig !== 'function') return;
        window.addToCart = function () {
            try {
                var selEl = $('pos-product-select');
                var id = selEl ? selEl.value : '';
                var branchItems = (typeof inventoryCache !== 'undefined' && inventoryCache[currentBranch]) || {};
                var item = id ? branchItems[id] : null;
                if (item) {
                    var qty = parseFloat(($('pos-qty') || {}).value) || 1;
                    var upp = Number(item.unitsPerPack) || 1;
                    var saleUnit = item.soldByWeight ? (item.weightUnit || 'Kg') : currentSaleUnit;
                    var weight = saleUnit === 'Kg' || saleUnit === 'g';
                    var need = r3((saleUnit === 'Piece' || weight) ? qty : qty * upp);
                    var inCart = currentCart.filter(function (c) { return c.id === id; }).reduce(function (s, c) { return s + (Number(c.piecesNeeded) || 0); }, 0);
                    var list = batchList(item).filter(function (b) { return b.qty > 0; });
                    var t = todayStr();
                    if (list.length) {
                        var good = list.filter(function (b) { return !isExpiredOn(b.expiry, t); }).reduce(function (s, b) { return s + b.qty; }, 0);
                        var bad = list.filter(function (b) { return isExpiredOn(b.expiry, t); }).reduce(function (s, b) { return s + b.qty; }, 0);
                        if (inCart + need > good + 1e-9) {
                            alert('Cannot add "' + (item.name || item.productName) + '": only ' + fmtQty(item, Math.max(0, good - inCart)) + ' within its expiry date is available' +
                                (bad > 0 ? ' (' + fmtQty(item, bad) + ' is EXPIRED and must not be sold - write it off in Inventory > Batches)' : '') + '.');
                            return;
                        }
                    } else if (isExpiredOn(item.expiry || item.expiryDate, t)) {
                        if (!confirm('"' + (item.name || item.productName) + '" has an expiry date of ' + (item.expiry || item.expiryDate) + ', which has PASSED.\n\nSell anyway?')) return;
                    }
                }
            } catch (e) { console.warn('[batch] expiry check skipped', e); }
            return orig.apply(this, arguments);
        };
    })();

    (function hookRenderCart() {
        var orig = window.renderCart;
        if (typeof orig !== 'function') return;
        window.renderCart = function () {
            var r = orig.apply(this, arguments);
            try { decorateCart(); } catch (e) { console.warn('[batch] cart decorate failed', e); }
            return r;
        };
    })();

    function decorateCart() {
        var tb = $('cart-body');
        if (!tb || typeof currentCart === 'undefined') return;
        var rows = tb.querySelectorAll('tr');
        if (rows.length !== currentCart.length) return;
        var inv = (typeof inventoryCache !== 'undefined' && inventoryCache[currentBranch]) || {};
        var t = todayStr();
        rows.forEach(function (tr, i) {
            var ci = currentCart[i], p = inv[ci.id];
            if (!p) return;
            var avail = sortFefo(batchList(p).filter(function (b) { return b.qty > 0 && !isExpiredOn(b.expiry, t); }));
            if (avail.length < 2) return;
            var td = tr.querySelector('td');
            if (!td || td.querySelector('.wdbt-pick')) return;
            var picked = ci.batchPick ? avail.filter(function (b) { return b.id === ci.batchPick; })[0] : null;
            var label = picked ? 'Batch ' + (picked.batchNo || 'n/a') + ' (exp ' + (picked.expiry || '—') + ')' : 'Batch: earliest expiry';
            td.insertAdjacentHTML('beforeend', '<br><a class="wdbt-pick" href="javascript:void(0)" style="font-size:11px; color:#0369a1;" onclick="wdbtPickBatch(' + i + ')">📅 ' + esc(label) + ' · change</a>');
        });
    }

    window.wdbtPickBatch = function (i) {
        var ci = currentCart[i];
        var p = ((inventoryCache[currentBranch] || {})[ci.id]);
        if (!p) return;
        var t = todayStr();
        var avail = sortFefo(batchList(p).filter(function (b) { return b.qty > 0 && !isExpiredOn(b.expiry, t); }));
        var rows = '<label style="display:flex; gap:8px; align-items:center; padding:8px; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:6px; cursor:pointer;"><input type="radio" name="wdbt-pick" value="" ' + (!ci.batchPick ? 'checked' : '') + '><span><strong>Automatic</strong><br><small style="color:#64748b;">Earliest expiry first (recommended)</small></span></label>';
        avail.forEach(function (b) {
            rows += '<label style="display:flex; gap:8px; align-items:center; padding:8px; border:1px solid #e2e8f0; border-radius:8px; margin-bottom:6px; cursor:pointer;"><input type="radio" name="wdbt-pick" value="' + esc(b.id) + '" ' + (ci.batchPick === b.id ? 'checked' : '') + '>' +
                '<span><strong>' + esc(b.batchNo || 'No batch no.') + '</strong> · exp ' + prettyDate(b.expiry) + '<br><small style="color:#64748b;">' + esc(fmtQty(p, b.qty)) + ' left</small></span></label>';
        });
        modal('📅 Choose batch — ' + esc(ci.name), rows +
            '<div style="display:flex; gap:8px; margin-top:10px;"><button class="menu-btn btn-action-primary" style="margin:0; flex:1; justify-content:center;" onclick="wdbtApplyPick(' + i + ')">Use this batch</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdbtClose()">Cancel</button></div>');
    };
    window.wdbtApplyPick = function (i) {
        var r = document.querySelector('input[name="wdbt-pick"]:checked');
        currentCart[i].batchPick = r && r.value ? r.value : null;
        wdbtClose();
        if (typeof renderCart === 'function') renderCart();
    };

    // =====================================================================
    // MODAL SHELL
    // =====================================================================
    function modal(title, html) {
        var m = $('wdbt-modal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'wdbt-modal';
            m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1700; padding:14px; box-sizing:border-box;';
            document.body.appendChild(m);
        }
        m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:14px; width:100%; max-width:640px; max-height:92vh; overflow-y:auto; padding:18px; box-sizing:border-box;">' +
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;"><h3 style="margin:0; font-size:17px;">' + title + '</h3>' +
            '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdbtClose()">✕</button></div>' + html + '</div>';
        m.style.display = 'flex';
    }
    window.wdbtClose = function () { var m = $('wdbt-modal'); if (m) m.style.display = 'none'; };

    // =====================================================================
    // BATCHES SCREEN (one product)
    // =====================================================================
    window.wdbtOpen = async function (branch, id) {
        modal('📅 Batches', '<div style="text-align:center; color:#64748b; padding:24px;">Loading...</div>');
        try {
            var snap = await prodRef(branch, id).once('value');
            var p = snap.val();
            if (!p) { modal('📅 Batches', '<div style="color:#b91c1c;">Product not found.</div>'); return; }
            var name = p.name || p.productName || 'Product';
            var list = sortFefo(batchList(p));
            var tracked = list.reduce(function (s, b) { return s + b.qty; }, 0);
            var stock = stockOf(p);
            var diff = r3(stock - tracked);
            var mg = canManage();
            var b = esc(branch), pid = esc(id);

            var rows = list.length === 0
                ? '<tr><td colspan="5" style="text-align:center; color:#64748b; padding:18px;">No batches yet. They are created when you restock with a batch number / expiry date.<br>' +
                  (stock > 0 && p.expiry ? '<small>This product currently has one expiry date: ' + prettyDate(p.expiry) + '</small>' : '') + '</td></tr>'
                : list.map(function (x) {
                    var acts = '';
                    if (mg) {
                        acts = '<button data-b="' + b + '" data-p="' + pid + '" data-x="' + esc(x.id) + '" onclick="wdbtEdit(this.dataset.b,this.dataset.p,this.dataset.x)" style="padding:4px 8px; font-size:11px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; cursor:pointer;">Edit</button> ' +
                            (x.qty > 0 ? '<button data-b="' + b + '" data-p="' + pid + '" data-x="' + esc(x.id) + '" onclick="wdbtWriteOff(this.dataset.b,this.dataset.p,this.dataset.x)" style="padding:4px 8px; font-size:11px; border:1px solid #fecaca; border-radius:6px; background:#fef2f2; color:#991b1b; cursor:pointer;">Write off</button>' : '');
                    }
                    return '<tr style="border-bottom:1px solid #f1f5f9;' + (x.qty <= 0 ? ' opacity:0.55;' : '') + '"><td style="padding:8px 4px;"><strong>' + esc(x.batchNo || '—') + '</strong>' + (x.supplier ? '<br><small style="color:#64748b;">' + esc(x.supplier) + '</small>' : '') + '</td>' +
                        '<td style="padding:8px 4px;">' + prettyDate(x.expiry) + '<br>' + chip(x.expiry, x.qty) + '</td>' +
                        '<td style="padding:8px 4px;"><strong>' + esc(fmtQty(p, x.qty)) + '</strong></td>' +
                        '<td style="padding:8px 4px; font-size:11px; color:#64748b;">' + (x.opening ? '—' : esc(fmtQty(p, x.received))) + '</td>' +
                        '<td style="padding:8px 4px; white-space:nowrap;">' + acts + '</td></tr>';
                }).join('');

            var warn = '';
            if (list.length && Math.abs(diff) > 0.0005) {
                warn = '<div style="background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:8px 10px; border-radius:8px; font-size:12px; margin:10px 0;">Batch totals (' + esc(fmtQty(p, tracked)) + ') differ from the stock figure (' + esc(fmtQty(p, stock)) + ') by ' + esc(r3(Math.abs(diff))) + '. ' +
                    (mg ? '<button data-b="' + b + '" data-p="' + pid + '" onclick="wdbtMatch(this.dataset.b,this.dataset.p)" style="margin-left:6px; padding:4px 10px; font-size:11px; border:1px solid #fcd34d; border-radius:6px; background:#fff; cursor:pointer; font-weight:bold;">Match batches to stock</button>' : '') + '</div>';
            }

            modal('📅 Batches — ' + esc(name),
                '<div style="font-size:12px; color:#64748b; margin-bottom:6px;">Stock now: <strong style="color:#0f172a;">' + esc(fmtQty(p, stock)) + '</strong> · selling uses the earliest expiry first · to add a batch, use <strong>Restock</strong> (type the batch no. and expiry).</div>' + warn +
                '<div style="overflow-x:auto;"><table style="width:100%; font-size:13px; border-collapse:collapse;"><thead><tr style="color:#475569; text-align:left;"><th style="padding:6px 4px;">Batch</th><th style="padding:6px 4px;">Expiry</th><th style="padding:6px 4px;">Left</th><th style="padding:6px 4px;">Received</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>');
        } catch (e) {
            modal('📅 Batches', '<div style="color:#b91c1c;">Could not load: ' + esc(e.message) + '</div>');
        }
    };

    window.wdbtEdit = async function (branch, id, bid) {
        if (!canManage()) return;
        var snap = await prodRef(branch, id).child('batches/' + bid).once('value');
        var b = snap.val(); if (!b) return;
        var no = prompt('Batch number:', b.batchNo || '');
        if (no === null) return;
        var ex = prompt('Expiry date (YYYY-MM-DD), or leave empty for none:', b.expiry || '');
        if (ex === null) return;
        ex = ex.trim();
        if (ex && !/^\d{4}-\d{2}-\d{2}$/.test(ex)) { alert('Please type the date like 2027-08-31.'); return; }
        try {
            await prodRef(branch, id).child('batches/' + bid).update({ batchNo: no.trim(), expiry: ex });
            await syncExpiry(branch, id);
            wdbtOpen(branch, id);
        } catch (e) { alert('Could not save: ' + e.message); }
    };

    window.wdbtWriteOff = async function (branch, id, bid) {
        if (!canManage()) return;
        var ref = prodRef(branch, id);
        var snap = await ref.once('value');
        var p = snap.val();
        if (!p || !p.batches || !p.batches[bid]) return;
        var b = p.batches[bid], q = num(b.qty);
        if (q <= 0) return;
        var reason = prompt('Write off ' + fmtQty(p, q) + ' of "' + (p.name || p.productName) + '" (batch ' + (b.batchNo || 'n/a') + ').\n\nReason (e.g. expired, damaged):', isExpiredOn(b.expiry, todayStr()) ? 'Expired' : '');
        if (reason === null) return;
        var written = 0;
        try {
            var res = await ref.transaction(function (cur) {
                if (!cur || typeof cur !== 'object' || !cur.batches || !cur.batches[bid]) return;
                var qq = num(cur.batches[bid].qty);
                if (qq <= 0) return;
                written = qq;
                cur.batches[bid].qty = 0;
                var ns = Math.max(0, r3(stockOf(cur) - qq));
                cur.stock = ns; cur.stockQty = ns;
                var e = minExpiry(batchList(cur));
                cur.expiry = e; cur.expiryDate = e;
                return cur;
            });
            if (!res.committed) { alert('Nothing was written off (it may have changed). Please reopen the batch list.'); return; }
            var upp = num(p.unitsPerPack) || 1;
            await firebase.database().ref('stores/' + sid() + '/expiryWriteOffs').push({
                productId: id, productName: p.name || p.productName || '', branchId: branch, batchNo: b.batchNo || '', expiry: b.expiry || '',
                qty: r3(written), costValue: r3((num(p.costPrice) / upp) * written), reason: (reason || '').trim(), by: who(), date: new Date().toISOString()
            });
            try { if (inventoryCache[branch]) inventoryCache[branch][id] = res.snapshot.val(); } catch (e2) { /* optional */ }
            alert('Written off. Stock is now ' + fmtQty(p, stockOf(res.snapshot.val())) + '.');
            wdbtOpen(branch, id);
        } catch (e3) { alert('Could not write off: ' + e3.message); }
    };

    window.wdbtMatch = async function (branch, id) {
        if (!canManage()) return;
        if (!confirm('Make the batch totals equal to the stock figure?\n\nIf batches hold more than the stock, the earliest-expiry batches are reduced. If they hold less, the difference is added as an "Unlisted stock" batch.')) return;
        var ref = prodRef(branch, id);
        var newKey = ref.child('batches').push().key;
        try {
            var res = await ref.transaction(function (cur) {
                if (!cur || typeof cur !== 'object') return cur;
                var list = batchList(cur), tracked = list.reduce(function (s, b) { return s + b.qty; }, 0);
                var diff = r3(stockOf(cur) - tracked);
                if (Math.abs(diff) < 0.0005) return;
                cur.batches = cur.batches || {};
                if (diff > 0) {
                    cur.batches[newKey] = { batchNo: 'Unlisted stock', expiry: '', qty: diff, received: diff, receivedAt: new Date().toISOString(), by: who() };
                } else {
                    allocate(cur.batches, -diff, todayStr(), null);
                }
                var e = minExpiry(batchList(cur));
                cur.expiry = e; cur.expiryDate = e;
                return cur;
            });
            try { if (res.committed && inventoryCache[branch]) inventoryCache[branch][id] = res.snapshot.val(); } catch (e2) { /* optional */ }
            wdbtOpen(branch, id);
        } catch (e) { alert('Could not match: ' + e.message); }
    };

    // =====================================================================
    // EXPIRY REPORT (all batches of the branch, soonest first)
    // =====================================================================
    window.wdbtReport = function (filter) {
        var branch = invBranch();
        var items = (typeof inventoryCache !== 'undefined' && inventoryCache[branch]) || {};
        var t = todayStr();
        filter = filter || '30';
        var rows = [];
        Object.keys(items).forEach(function (id) {
            var p = items[id]; if (!p || typeof p !== 'object') return;
            var name = p.name || p.productName || 'Unnamed';
            var bl = batchList(p).filter(function (b) { return b.qty > 0; });
            if (bl.length) bl.forEach(function (b) { rows.push({ id: id, p: p, name: name, batchNo: b.batchNo, expiry: b.expiry, qty: b.qty }); });
            else if (stockOf(p) > 0 && (p.expiry || p.expiryDate)) rows.push({ id: id, p: p, name: name, batchNo: '(single expiry date)', expiry: p.expiry || p.expiryDate, qty: stockOf(p) });
        });
        rows = rows.filter(function (r) {
            var d = daysTo(r.expiry);
            if (filter === 'expired') return d !== null && d < 0;
            if (filter === 'all') return true;
            return d !== null && d <= parseInt(filter, 10);
        }).sort(function (a, b) { return (a.expiry || '9999').localeCompare(b.expiry || '9999'); });

        var sel = function (v, l) { return '<option value="' + v + '"' + (filter === v ? ' selected' : '') + '>' + l + '</option>'; };
        var body = '<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px;"><span style="font-size:12px; color:#64748b;">' + esc(typeof branchNameOf === 'function' ? branchNameOf(branch) : branch) + '</span>' +
            '<select onchange="wdbtReport(this.value)" style="padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px;">' + sel('expired', 'Already expired') + sel('30', 'Expiring in 30 days') + sel('60', 'Expiring in 60 days') + sel('90', 'Expiring in 90 days') + sel('all', 'Everything with an expiry date') + '</select></div>';
        body += rows.length === 0 ? '<div style="text-align:center; color:#166534; padding:20px;">✅ Nothing in this list.</div>' :
            '<div style="overflow-x:auto;"><table style="width:100%; font-size:13px; border-collapse:collapse;"><thead><tr style="text-align:left; color:#475569;"><th style="padding:6px 4px;">Product</th><th>Batch</th><th>Expiry</th><th>Left</th></tr></thead><tbody>' +
            rows.map(function (r) {
                return '<tr style="border-bottom:1px solid #f1f5f9; cursor:pointer;" data-b="' + esc(branch) + '" data-p="' + esc(r.id) + '" onclick="wdbtOpen(this.dataset.b,this.dataset.p)"><td style="padding:8px 4px;"><strong>' + esc(r.name) + '</strong></td><td>' + esc(r.batchNo || '—') + '</td><td>' + prettyDate(r.expiry) + '<br>' + chip(r.expiry) + '</td><td>' + esc(fmtQty(r.p, r.qty)) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        modal('📅 Expiry report', body);
    };

    // =====================================================================
    // RECALL SEARCH: which sales used a given batch number?
    // =====================================================================
    window.wdbtRecall = async function () {
        var q = prompt('Batch number to look up (e.g. B-204):', '');
        if (q === null || !q.trim()) return;
        var key = q.trim().toLowerCase();
        modal('🔎 Batch recall — ' + esc(q.trim()), '<div style="text-align:center; color:#64748b; padding:24px;">Searching recent sales...</div>');
        try {
            var snap = await firebase.database().ref('stores/' + sid() + '/transactions').orderByChild('date').limitToLast(1500).once('value');
            var hits = [];
            snap.forEach(function (c) {
                var tx = c.val() || {};
                (tx.items || []).forEach(function (it) {
                    (it.batchAllocations || []).forEach(function (a) {
                        if (String(a.batchNo || '').toLowerCase().indexOf(key) !== -1) hits.push({ tx: tx, name: it.name, a: a });
                    });
                });
            });
            hits.sort(function (x, y) { return String(y.tx.date).localeCompare(String(x.tx.date)); });
            var total = hits.reduce(function (s, h) { return s + num(h.a.qty); }, 0);
            modal('🔎 Batch recall — ' + esc(q.trim()),
                '<div style="font-size:12px; color:#64748b; margin-bottom:8px;">Searched the last 1,500 sales. Sales made before batches were switched on are not included.</div>' +
                (hits.length === 0 ? '<div style="text-align:center; color:#166534; padding:18px;">No sale found with that batch number.</div>' :
                    '<div style="background:#fef3c7; border:1px solid #fde68a; color:#92400e; padding:8px 10px; border-radius:8px; font-size:13px; margin-bottom:10px;"><strong>' + hits.length + '</strong> sale line' + (hits.length === 1 ? '' : 's') + ' · ' + esc(r3(total)) + ' units sold from this batch</div>' +
                    '<div style="overflow-x:auto;"><table style="width:100%; font-size:12px; border-collapse:collapse;"><thead><tr style="text-align:left; color:#475569;"><th style="padding:6px 4px;">Date</th><th>Receipt</th><th>Customer</th><th>Product</th><th>Qty</th></tr></thead><tbody>' +
                    hits.map(function (h) {
                        return '<tr style="border-bottom:1px solid #f1f5f9;"><td style="padding:6px 4px;">' + esc(new Date(h.tx.date).toLocaleDateString()) + '</td>' +
                            '<td><a href="javascript:void(0)" data-t="' + esc(h.tx.txId || '') + '" onclick="wdbtClose(); viewPastReceipt(this.dataset.t)" style="color:#0369a1; font-weight:bold;">' + esc(h.tx.txId || '') + '</a></td>' +
                            '<td>' + esc(h.tx.customerName || 'Walk-In') + '</td><td>' + esc(h.name) + '</td><td>' + esc(h.a.qty) + '</td></tr>';
                    }).join('') + '</tbody></table></div>'));
        } catch (e) { modal('🔎 Batch recall', '<div style="color:#b91c1c;">Could not search: ' + esc(e.message) + '</div>'); }
    };

    // =====================================================================
    // INVENTORY SCREEN: "📅 Batches" on each product + header buttons
    // =====================================================================
    function decorateInventoryRows() {
        var tbody = $('inventory-body');
        if (!tbody) return;
        tbody.querySelectorAll('tr[id^="inv-row-"]').forEach(function (tr) {
            if (tr.querySelector('.wdbt-btn')) return;
            var edit = tr.querySelector('button[onclick^="editProduct("]');
            if (!edit) return;
            var m = /editProduct\('([^']*)','([^']*)'\)/.exec(edit.getAttribute('onclick') || '');
            if (!m) return;
            var b = document.createElement('button');
            b.className = 'menu-btn wdbt-btn';
            b.style.cssText = 'padding:4px 8px; font-size:11px; width:auto; display:inline-block; background:#fffbeb; color:#92400e; border:1px solid #fde68a;';
            b.textContent = '📅 Batches';
            b.setAttribute('data-b', m[1]); b.setAttribute('data-p', m[2]);
            b.onclick = function () { wdbtOpen(this.getAttribute('data-b'), this.getAttribute('data-p')); };
            edit.parentElement.appendChild(b);
        });
    }
    ['renderInventoryTable', 'filterInventoryTable'].forEach(function (name) {
        var orig = window[name];
        if (typeof orig !== 'function') return;
        window[name] = function () {
            var r = orig.apply(this, arguments);
            try { decorateInventoryRows(); } catch (e) { console.warn('[batch] inventory decorate failed', e); }
            return r;
        };
    });

    function injectHeaderButtons() {
        var add = $('add-product-trigger-btn');
        if (!add || $('wdbt-btn-report')) return;
        function mk(id, label, fn, style) {
            var b = document.createElement('button');
            b.id = id; b.className = 'menu-btn'; b.textContent = label; b.onclick = fn;
            b.style.cssText = 'width:auto; margin:0; padding:8px 14px; font-size:12px; background:#fffbeb; border:1px solid #fde68a; color:#92400e; font-weight:bold;' + (style || '');
            return b;
        }
        add.parentElement.insertBefore(mk('wdbt-btn-recall', '🔎 Batch recall', function () { wdbtRecall(); }), add);
        add.parentElement.insertBefore(mk('wdbt-btn-report', '📅 Expiry report', function () { wdbtReport('30'); }), add);
    }
    (function hookSwitchView() {
        var prev = window.switchView;
        if (typeof prev !== 'function') return;
        window.switchView = function (viewId) {
            var r = prev.apply(this, arguments);
            try { if (viewId === 'inventory-view') { injectHeaderButtons(); decorateInventoryRows(); } } catch (e) { console.warn('[batch] header buttons failed', e); }
            return r;
        };
    })();

    // =====================================================================
    // DASHBOARD: expiring soon, by batch
    // =====================================================================
    async function applyBatchAlerts() {
        if (!sid() || typeof dashboardAlertsCache === 'undefined' || !$('dashboard-alerts-tbody')) return;
        var snap = await firebase.database().ref('stores/' + sid() + '/inventory/' + currentBranch).once('value');
        var now = new Date(), t = todayStr(), alerts = [];
        snap.forEach(function (child) {
            var item = child.val() || {};
            var stock = stockOf(item);
            var name = item.name || item.productName || 'Unnamed Item';
            var threshold = (item.lowStockThreshold !== null && item.lowStockThreshold !== undefined) ? Number(item.lowStockThreshold) : 5;
            var isLow = stock <= threshold;
            var base = { name: name, category: item.category || '', stock: stock, soldByWeight: !!item.soldByWeight, weightUnit: item.weightUnit || 'Kg', baseUnitName: item.baseUnitName, bulkUnitName: item.bulkUnitName, unitsPerPack: item.unitsPerPack };
            var bl = batchList(item).filter(function (b) { return b.qty > 0; });

            if (!bl.length) {                                   // product without batches: as before
                var ev = item.expiry || item.expiryDate;
                var ed = ev ? new Date(ev) : null;
                var soon = ed && (ed - now) / 86400000 <= SOON_DAYS;
                if (isLow || soon) alerts.push(Object.assign({}, base, { expiryVal: ev, isLowStock: isLow, isExpiringSoon: !!soon }));
                return;
            }
            if (isLow) alerts.push(Object.assign({}, base, { expiryVal: minExpiry(bl), isLowStock: true, isExpiringSoon: false }));
            sortFefo(bl).forEach(function (b) {
                var d = daysTo(b.expiry);
                if (d === null || d > SOON_DAYS) return;
                alerts.push(Object.assign({}, base, {
                    name: name + ' — batch ' + (b.batchNo || 'n/a') + (d < 0 ? ' (EXPIRED)' : ''),
                    stock: b.qty, expiryVal: b.expiry, isLowStock: false, isExpiringSoon: true
                }));
            });
        });
        dashboardAlertsCache = alerts;
        if (typeof renderDashboardAlerts === 'function') renderDashboardAlerts();
    }
    (function hookDashboard() {
        var orig = window.loadDashboardMetrics;
        if (typeof orig !== 'function') return;
        window.loadDashboardMetrics = function () {
            var r = orig.apply(this, arguments);
            var run = function () { applyBatchAlerts().catch(function (e) { console.warn('[batch] dashboard alerts failed', e); }); };
            setTimeout(run, 400);
            setTimeout(run, 2500);   // the original list may finish later: apply again so the batch version wins
            return r;
        };
    })();

    // =====================================================================
    // RESTOCK: Batch no. + Expiry date boxes
    // =====================================================================
    (function hookRestockModal() {
        var orig = window.openQuickRestockModal;
        if (typeof orig !== 'function') return;
        window.openQuickRestockModal = function (branchId, productId) {
            var r = orig.apply(this, arguments);
            try {
                var notes = $('restock-notes');
                var grp = notes && notes.closest('.form-group');
                if (grp && !$('wdbt-rs-wrap')) {
                    var d = document.createElement('div');
                    d.id = 'wdbt-rs-wrap';
                    d.innerHTML =
                        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
                        '<div class="form-group"><label>Batch no.</label><input type="text" id="wdbt-rs-batch" placeholder="e.g. B-204"></div>' +
                        '<div class="form-group"><label>Expiry date</label><input type="date" id="wdbt-rs-exp"></div></div>' +
                        '<div id="wdbt-rs-note" style="font-size:11px; margin:-6px 0 12px 0;"></div>';
                    grp.parentNode.insertBefore(d, grp);
                }
                if ($('wdbt-rs-batch')) { $('wdbt-rs-batch').value = ''; $('wdbt-rs-exp').value = ''; }
                var item = inventoryCache[branchId] && inventoryCache[branchId][productId];
                var tracked = item && batchList(item).length > 0;
                var note = $('wdbt-rs-note');
                if (note) {
                    note.style.color = tracked ? '#92400e' : '#64748b';
                    note.textContent = tracked ? 'This product is tracked by batch: the expiry date is required.' : 'Optional. Fill these in to start tracking this product by batch.';
                }
            } catch (e) { console.warn('[batch] restock fields failed', e); }
            return r;
        };
    })();

    // Same as script.js saveQuickRestock, plus the batch record.
    window.saveQuickRestock = function () {
        if (!currentStoreId) return;
        var branchId = $('restock-branch-id').value;
        var productId = $('restock-product-id').value;
        var supplierId = $('restock-supplier-select').value;
        var notes = $('restock-notes').value.trim();

        if (!supplierId || !suppliersCache[supplierId]) { alert("Please select a supplier."); return; }
        var item = inventoryCache[branchId] && inventoryCache[branchId][productId];
        if (!item) { alert("Product not found. Try refreshing the Inventory page."); return; }

        var unitsPerPack = Number(item.unitsPerPack) || 1;
        var costPrice = parseFloat($('restock-cost-price').value) || 0;
        var packs, loose, piecesReceived, lineCost, bagsReceived, weightPerBag;

        if (item.soldByWeight) {
            bagsReceived = parseFloat($('restock-weight-bags').value) || 0;
            weightPerBag = parseFloat($('restock-weight-per-bag').value) || 0;
            piecesReceived = Math.round((bagsReceived * weightPerBag) * 100) / 100;
            packs = piecesReceived; loose = 0;
            lineCost = Math.round((costPrice * piecesReceived) * 100) / 100;
            if (piecesReceived <= 0) { alert("Enter both the number of bags and the weight per bag."); return; }
        } else {
            packs = parseFloat($('restock-qty-packs').value) || 0;
            loose = (unitsPerPack > 1) ? (parseInt($('restock-qty-loose').value) || 0) : 0;
            if (packs <= 0 && loose <= 0) { alert("Enter a quantity received greater than zero."); return; }
            piecesReceived = Math.round(((packs * unitsPerPack) + loose) * 100) / 100;
            var costPerPiece = unitsPerPack > 1 ? (costPrice / unitsPerPack) : costPrice;
            lineCost = Math.round(((costPrice * packs) + (costPerPiece * loose)) * 100) / 100;
        }

        var batchNo = (($('wdbt-rs-batch') || {}).value || '').trim();
        var expiry = (($('wdbt-rs-exp') || {}).value || '').trim();
        var tracked = batchList(item).length > 0;
        if (tracked && !expiry) { alert("This product is tracked by batch. Please enter the expiry date (and batch number) of the stock you received."); return; }
        var wantBatch = !!(batchNo || expiry);

        var currentStock = item.stock !== undefined ? Number(item.stock) : (Number(item.stockQty) || 0);
        var newStock = Math.round((currentStock + piecesReceived) * 100) / 100;
        var productName = item.name || item.productName || 'Unnamed Item';
        var supplyId = 'SUP-' + firebase.database().ref('stores/' + currentStoreId + '/supplies').push().key;
        var recordedBy = who();
        var nowIso = new Date().toISOString();
        var supplierName = suppliersCache[supplierId].name;

        var supplyData = {
            supplyId: supplyId, supplierId: supplierId, supplierName: supplierName, branchId: branchId,
            items: [{
                name: productName, productId: productId, qty: packs, loosePieces: loose,
                bagsReceived: item.soldByWeight ? bagsReceived : null, weightPerBag: item.soldByWeight ? weightPerBag : null,
                costPrice: costPrice, unitsPerPackAtSupply: unitsPerPack, piecesReceived: piecesReceived, lineCost: lineCost,
                stockBefore: currentStock, stockAfter: newStock, retailPrice: null, wholesalePrice: null,
                batchNo: batchNo, expiry: expiry
            }],
            totalCost: lineCost, notes: notes, date: nowIso, recordedBy: recordedBy
        };

        var pre = (wantBatch && !tracked) ? ensureOpening(branchId, productId).catch(function (e) { console.warn('[batch] opening batch failed', e); }) : Promise.resolve();
        return pre.then(function () {
            return firebase.database().ref('stores/' + currentStoreId + '/supplies/' + supplyId).set(supplyData);
        }).then(function () {
            return firebase.database().ref('stores/' + currentStoreId + '/inventory/' + branchId + '/' + productId).update({ stock: newStock, stockQty: newStock, costPrice: costPrice });
        }).then(function () {
            if (wantBatch) return addBatch(branchId, productId, piecesReceived, batchNo, expiry, supplierName);
        }).then(function () {
            var supp = suppliersCache[supplierId];
            return firebase.database().ref('stores/' + currentStoreId + '/suppliers/' + supplierId).update({
                totalSupplied: (Number(supp.totalSupplied) || 0) + lineCost,
                supplyCount: (Number(supp.supplyCount) || 0) + 1,
                lastSupplyDate: nowIso
            });
        }).then(function () {
            alert('Restocked "' + productName + '" — stock is now ' + formatStockLabel(Object.assign({}, item, { stock: newStock })) + '.' + (wantBatch ? '\nBatch ' + (batchNo || 'n/a') + (expiry ? ' (expires ' + expiry + ')' : '') + ' recorded.' : ''));
            closeQuickRestockModal();
            loadSuppliesHistory();
            loadSuppliersCache();
            var historyModal = $('restock-history-modal');
            if (historyModal && historyModal.style.display === 'flex' && historyModal.dataset.productId === productId) openProductRestockHistory(branchId, productId);
        }).catch(function (err) {
            alert("Failed to save restock: " + err.message);
        });
    };

    // =====================================================================
    // RECORD SUPPLY (several items): batch / expiry boxes on each row
    // =====================================================================
    (function hookSupplyRow() {
        var orig = window.addSupplyItemRow;
        if (typeof orig !== 'function') return;
        window.addSupplyItemRow = function () {
            orig.apply(this, arguments);
            try {
                var rows = document.querySelectorAll('#supply-items-container > div');
                var row = rows[rows.length - 1];
                if (row && !row.querySelector('.supply-item-batch')) {
                    var h = document.createElement('div');
                    h.style.cssText = 'display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px;';
                    h.innerHTML = '<input type="text" class="supply-item-batch" placeholder="Batch no. (optional)" style="padding:6px; border:1px solid #cbd5e1; border-radius:6px;">' +
                        '<input type="date" class="supply-item-exp" title="Expiry date" style="padding:6px; border:1px solid #cbd5e1; border-radius:6px;">';
                    row.insertBefore(h, row.querySelector('button.btn-logout'));
                }
            } catch (e) { console.warn('[batch] supply row fields failed', e); }
        };
    })();

    // Same as script.js saveSupply, plus the batch records.
    window.saveSupply = function () {
        if (!currentStoreId) return;
        var supplierId = $('supply-supplier-select').value;
        var branchId = $('supply-branch-select').value;
        var notes = $('supply-notes').value.trim();
        if (!supplierId || !suppliersCache[supplierId]) { alert("Please select a valid supplier."); return; }
        if (!branchId) { alert("Please select a destination branch."); return; }

        var rows = document.querySelectorAll('#supply-items-container > div');
        var items = [], invalidRow = false, totalCost = 0;
        rows.forEach(function (row) {
            var name = (row.querySelector('.supply-item-name') || {}).value || ''; name = name.trim();
            var qty = parseFloat((row.querySelector('.supply-item-qty') || {}).value) || 0;
            var loosePieces = parseFloat((row.querySelector('.supply-item-loose') || {}).value) || 0;
            var cost = parseFloat((row.querySelector('.supply-item-cost') || {}).value) || 0;
            var retailRaw = (row.querySelector('.supply-item-retail') || {}).value;
            var wholesaleRaw = (row.querySelector('.supply-item-wholesale') || {}).value;
            var batchNo = ((row.querySelector('.supply-item-batch') || {}).value || '').trim();
            var expiry = ((row.querySelector('.supply-item-exp') || {}).value || '').trim();
            if (!name && qty === 0 && loosePieces === 0) return;
            if (!name || (qty <= 0 && loosePieces <= 0)) { invalidRow = true; return; }
            items.push({
                name: name, qty: qty, loosePieces: loosePieces, costPrice: cost,
                retailPrice: (retailRaw !== '' && retailRaw !== undefined) ? parseFloat(retailRaw) : null,
                wholesalePrice: (wholesaleRaw !== '' && wholesaleRaw !== undefined) ? parseFloat(wholesaleRaw) : null,
                batchNo: batchNo, expiry: expiry
            });
        });
        if (invalidRow) { alert("Each item needs a product name and either a pack count or a loose piece count greater than zero."); return; }
        if (items.length === 0) { alert("Please add at least one item received in this supply."); return; }

        var supplyId = 'SUP-' + firebase.database().ref('stores/' + currentStoreId + '/supplies').push().key;
        var recordedBy = who();
        var nowIso = new Date().toISOString();
        var invRef = firebase.database().ref('stores/' + currentStoreId + '/inventory/' + branchId);
        var supplierName = suppliersCache[supplierId].name;

        return invRef.once('value').then(function (snapshot) {
            var existingByName = {};
            snapshot.forEach(function (child) {
                var item = child.val();
                var n = (item.name || item.productName || '').toLowerCase().trim();
                if (n) existingByName[n] = { id: child.key, data: item };
            });

            items.forEach(function (item) {
                var match = existingByName[item.name.toLowerCase().trim()];
                var upp = match ? (Number(match.data.unitsPerPack) || 1) : 1;
                var piecesReceived = (item.qty * upp) + item.loosePieces;
                var costPerPiece = item.costPrice / upp;
                var lineCost = (item.costPrice * item.qty) + (costPerPiece * item.loosePieces);
                item.unitsPerPackAtSupply = upp; item.piecesReceived = piecesReceived; item.lineCost = lineCost;
                totalCost += lineCost;
                if (match) {
                    var cur = Number(match.data.stock !== undefined ? match.data.stock : (match.data.stockQty || 0));
                    item.stockBefore = cur; item.stockAfter = cur + piecesReceived; item._matchId = match.id;
                    item._tracked = batchList(match.data).length > 0;
                    if (item._tracked && !item.expiry) throw new Error('"' + item.name + '" is tracked by batch - please enter its expiry date.');
                } else {
                    item.stockBefore = 0; item.stockAfter = piecesReceived; item._matchId = null; item._tracked = false;
                }
            });

            var supplyData = {
                supplyId: supplyId, supplierId: supplierId, supplierName: supplierName, branchId: branchId,
                items: items.map(function (it) { var o = Object.assign({}, it); delete o._matchId; delete o._tracked; o.productId = it._matchId || null; return o; }),
                totalCost: totalCost, notes: notes, date: nowIso, recordedBy: recordedBy
            };

            return firebase.database().ref('stores/' + currentStoreId + '/supplies/' + supplyId).set(supplyData).then(function () {
                var chain = Promise.resolve();
                items.forEach(function (item) {
                    chain = chain.then(function () {
                        var wantBatch = !!(item.batchNo || item.expiry);
                        if (item._matchId) {
                            var pre = (wantBatch && !item._tracked) ? ensureOpening(branchId, item._matchId).catch(function (e) { console.warn(e); }) : Promise.resolve();
                            return pre.then(function () {
                                var upd = { stock: item.stockAfter, stockQty: item.stockAfter, costPrice: item.costPrice };
                                if (item.retailPrice !== null && !isNaN(item.retailPrice)) { upd.price = item.retailPrice; upd.retailPrice = item.retailPrice; }
                                if (item.wholesalePrice !== null && !isNaN(item.wholesalePrice)) upd.wholesalePrice = item.wholesalePrice;
                                return invRef.child(item._matchId).update(upd);
                            }).then(function () {
                                if (wantBatch) return addBatch(branchId, item._matchId, item.piecesReceived, item.batchNo, item.expiry, supplierName);
                            });
                        }
                        var ref = invRef.push();
                        return ref.set({
                            name: item.name, productName: item.name, costPrice: item.costPrice,
                            price: item.retailPrice || 0, retailPrice: item.retailPrice || 0, wholesalePrice: item.wholesalePrice || 0,
                            unitsPerPack: 1, piecePrice: 0, pieceWholesalePrice: 0, baseUnitName: '', bulkUnitName: '',
                            stock: item.stockAfter, stockQty: item.stockAfter, expiry: item.expiry || '', expiryDate: item.expiry || '', branchId: branchId
                        }).then(function () {
                            if (wantBatch) return addBatch(branchId, ref.key, item.piecesReceived, item.batchNo, item.expiry, supplierName);
                        });
                    });
                });
                return chain;
            });
        }).then(function () {
            var supp = suppliersCache[supplierId];
            return firebase.database().ref('stores/' + currentStoreId + '/suppliers/' + supplierId).update({
                totalSupplied: (Number(supp.totalSupplied) || 0) + totalCost,
                supplyCount: (Number(supp.supplyCount) || 0) + 1,
                lastSupplyDate: nowIso
            });
        }).then(function () {
            alert('Supply recorded successfully! Inventory at ' + branchNameOf(branchId) + ' has been updated automatically.');
            closeRecordSupplyModal();
            loadSuppliesHistory();
            loadSuppliersCache();
        }).catch(function (err) {
            console.error("saveSupply error:", err);
            alert("⚠️ This supply was NOT saved. Nothing was changed — please check and try again.\n\nError: " + err.message);
        });
    };
})();
