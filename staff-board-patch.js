// ==================== WISE DECISION STAFF BOARD PATCH (v1) ====================
// Load LAST (after sidebar-colors-patch.js), with `defer`.
//
// Adds a "🏆 Staff Board" button (Admin only) under Staff in the sidebar.
// Shows, per staff member: number of sales, total CASH, total TRANSFER/POS, total received, and refunds.
// Filters: Today / This Week / This Month / Custom dates, Branch, and "Received by" vs "Sold by".
// Tap a staff row to see every sale behind the numbers.
//
// "Received by" = the person who accepted the payment (the Accountant, or the cashier at the till).
// From now on every completed sale is stamped with receivedBy. Older sales have no stamp,
// so they fall back to the seller (the `staff` field) and are shown that way.

console.log("Wise Decision staff-board-patch.js — v1 loaded");

(function () {
    var state = { range: 'today', from: '', to: '', branch: 'all', by: 'both', txs: [], rows: [] };

    function money(n) { return '₦' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(); }

    // Admin sees every branch. Manager sees only their own branch (same as the Reports screen).
    function canView() {
        return typeof currentUserRole !== 'undefined' &&
            (currentUserRole === 'Admin' || currentUserRole === 'Manager');
    }

    function esc(s) {
        if (typeof escapeHtml === 'function') return escapeHtml(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ---------- Stamp "receivedBy" on every new completed sale ----------
    function stampReceivedBy(storeId, txId, label, tries) {
        var ref = firebase.database().ref('stores/' + storeId + '/transactions/' + txId);
        ref.once('value').then(function (snap) {
            if (snap.exists()) {
                if (!snap.val().receivedBy) return ref.child('receivedBy').set(label);
            } else if (tries < 12) {
                setTimeout(function () { stampReceivedBy(storeId, txId, label, tries + 1); }, 500);
            }
        }).catch(function () { /* never block a sale */ });
    }

    (function hookCheckout() {
        var prev = window.completeSplitCheckout;
        if (typeof prev !== 'function') return;
        window.completeSplitCheckout = function () {
            try {
                if (currentActiveOrder && currentActiveOrder.txId && currentStoreId) {
                    var labelEl = document.getElementById('user-role-label');
                    var label = (labelEl && labelEl.textContent) || currentUserRole;
                    stampReceivedBy(currentStoreId, currentActiveOrder.txId, label, 0);
                }
            } catch (e) { /* ignore */ }
            return prev.apply(this, arguments);
        };
    })();

    // ---------- Date ranges ----------
    function rangeBounds() {
        var now = new Date();
        var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
        var s, e;
        if (state.range === 'today') {
            s = new Date(y, m, d);
            e = new Date(y, m, d + 1); e = new Date(e.getTime() - 1);
        } else if (state.range === 'week') {
            s = new Date(y, m, d - now.getDay());
            e = new Date(y, m, d - now.getDay() + 7); e = new Date(e.getTime() - 1);
        } else if (state.range === 'month') {
            s = new Date(y, m, 1);
            e = new Date(y, m + 1, 1); e = new Date(e.getTime() - 1);
        } else {
            if (!state.from || !state.to) return null;
            s = new Date(state.from + 'T00:00:00');
            e = new Date(state.to + 'T23:59:59.999');
            if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return null;
        }
        return { s: s, e: e };
    }

    // ---------- Load + aggregate ----------
    function load() {
        var host = document.getElementById('wdsb-results');
        if (!host || !currentStoreId) return;
        var b = rangeBounds();
        if (!b) {
            host.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b;">Pick a start and end date, then tap Apply.</div>';
            return;
        }
        host.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b;">Loading sales...</div>';

        firebase.database().ref('stores/' + currentStoreId + '/transactions')
            .orderByChild('date').startAt(b.s.toISOString()).endAt(b.e.toISOString())
            .once('value').then(function (snap) {
                var txs = [];
                snap.forEach(function (c) {
                    var t = c.val();
                    if (!t) return;
                    t._key = c.key;
                    txs.push(t);
                });
                state.txs = txs;
                render();
            }).catch(function (err) {
                host.innerHTML = '<div style="padding:20px; color:#991b1b;">Could not load sales: ' + esc(err.message) + '</div>';
            });
    }

    function ownerOf(t) {
        var who = state.by === 'seller' ? (t.staff || t.soldBy) : (t.receivedBy || t.staff || t.soldBy);
        return who || 'Unknown';
    }

    function split(t) {
        var total = Number(t.totalAmount) || 0;
        var pb = t.paymentBreakdown;
        return {
            total: total,
            cash: pb ? (Number(pb.cash) || 0) : total,
            transfer: pb ? (Number(pb.transfer) || 0) : 0,
            credit: pb ? (Number(pb.credit) || 0) : 0
        };
    }

    // Side-by-side view: each sale counts as "sold" for the person who made the order
    // and as "received" for the person who took the payment (they can be the same person).
    function addRole(r, t, role) {
        var e = r._ids[t._key];
        if (!e) { e = r._ids[t._key] = { tx: t, role: role }; r.list.push(e); }
        else if (e.role !== role) e.role = 'Sold & received';
    }

    function aggregateBoth() {
        var map = {};
        var totals = { cash: 0, transfer: 0, sales: 0, refunds: 0 };
        function row(k) {
            return map[k] || (map[k] = { name: k, sold: 0, soldCount: 0, cash: 0, transfer: 0, credit: 0, refunds: 0, list: [], _ids: {} });
        }
        state.txs.forEach(function (t) {
            var br = t.branchId || 'main';
            if (state.branch !== 'all' && br !== state.branch) return;
            var p = split(t);
            var seller = t.staff || t.soldBy || 'Unknown';
            var receiver = t.receivedBy || seller;
            var refunded = Number(t.refundedAmount) || 0;

            var s = row(seller);
            s.soldCount++;
            s.sold += p.total;
            s.refunds += refunded;
            addRole(s, t, 'Sold');

            var r = row(receiver);
            r.cash += p.cash;
            r.transfer += p.transfer;
            r.credit += p.credit;
            addRole(r, t, 'Received');

            totals.cash += p.cash;
            totals.transfer += p.transfer;
            totals.sales++;
            totals.refunds += refunded;
        });
        var rows = Object.keys(map).map(function (k) { return map[k]; });
        rows.sort(function (a, b) { return ((b.cash + b.transfer) - (a.cash + a.transfer)) || (b.sold - a.sold); });
        return { rows: rows, totals: totals };
    }

    function bothTable(rows) {
        var h = '<div style="overflow-x:auto; background:#fff; border:1px solid #eef2f7; border-radius:10px; box-shadow:0 6px 18px rgba(15,23,42,0.06);">' +
            '<table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">' +
            '<thead><tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; color:#64748b;">' +
            '<th style="padding:10px;">#</th><th style="padding:10px;">Staff</th>' +
            '<th style="padding:10px;">Sold</th><th style="padding:10px;">Cash received</th>' +
            '<th style="padding:10px;">Transfer received</th><th style="padding:10px;">Total received</th>' +
            '<th style="padding:10px;">Refunds</th></tr></thead><tbody>';
        if (rows.length === 0) {
            h += '<tr><td colspan="7" style="text-align:center; color:#64748b; padding:25px;">No sales found for this period.</td></tr>';
        } else {
            rows.forEach(function (r, i) {
                h += '<tr style="border-bottom:1px solid #f1f5f9; cursor:pointer;" onclick="wdsbDetail(' + i + ')">' +
                    '<td style="padding:10px; color:#94a3b8;">' + (i + 1) + '</td>' +
                    '<td style="padding:10px;"><strong>' + esc(r.name) + '</strong> <span style="color:#0284c7; font-size:11px;">view ›</span></td>' +
                    '<td style="padding:10px; font-weight:bold;">' + (r.soldCount ? money(r.sold) + '<br><small style="color:#64748b; font-weight:normal;">' + r.soldCount + ' sale' + (r.soldCount === 1 ? '' : 's') + '</small>' : '—') + '</td>' +
                    '<td style="padding:10px; color:#166534; font-weight:bold;">' + money(r.cash) + '</td>' +
                    '<td style="padding:10px; color:#1d4ed8; font-weight:bold;">' + money(r.transfer) + '</td>' +
                    '<td style="padding:10px; font-weight:800;">' + money(r.cash + r.transfer) + '</td>' +
                    '<td style="padding:10px; color:' + (r.refunds > 0 ? '#991b1b' : '#94a3b8') + ';">' + (r.refunds > 0 ? money(r.refunds) : '—') + '</td>' +
                    '</tr>';
            });
        }
        h += '</tbody></table></div>' +
            '<p style="font-size:11px; color:#64748b; margin-top:10px;">Sold = value of the orders they made (credit included). Cash and transfer received = what they actually took at the till. Tap a name to see their sales.</p>';
        return h;
    }

    function aggregate() {
        if (state.by === 'both') return aggregateBoth();
        var map = {};
        var totals = { cash: 0, transfer: 0, sales: 0, refunds: 0 };
        state.txs.forEach(function (t) {
            var br = t.branchId || 'main';
            if (state.branch !== 'all' && br !== state.branch) return;
            var p = split(t);
            var key = ownerOf(t);
            var r = map[key] || (map[key] = { name: key, sales: 0, cash: 0, transfer: 0, credit: 0, refunds: 0, list: [] });
            r.sales++;
            r.cash += p.cash;
            r.transfer += p.transfer;
            r.credit += p.credit;
            r.refunds += Number(t.refundedAmount) || 0;
            r.list.push(t);
            totals.cash += p.cash;
            totals.transfer += p.transfer;
            totals.sales++;
            totals.refunds += Number(t.refundedAmount) || 0;
        });
        var rows = Object.keys(map).map(function (k) { return map[k]; });
        rows.sort(function (a, b) { return (b.cash + b.transfer) - (a.cash + a.transfer); });
        return { rows: rows, totals: totals };
    }

    // ---------- Screen ----------
    function render() {
        var host = document.getElementById('wdsb-results');
        if (!host) return;
        var agg = aggregate();
        state.rows = agg.rows;
        var t = agg.totals;

        var h = '';
        h += '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:18px;">' +
            card('Total Cash', money(t.cash), '#f0fdf4', '#bbf7d0', '#166534', '#14532d') +
            card('Total Transfer / POS', money(t.transfer), '#eff6ff', '#bfdbfe', '#1e40af', '#1e3a8a') +
            card('Total Received', money(t.cash + t.transfer), '#faf5ff', '#e9d5ff', '#6b21a8', '#581c87') +
            card('Sales Count', String(t.sales), '#f8fafc', '#e2e8f0', '#475569', '#0f172a') +
            '</div>';

        if (state.by === 'both') {
            h += bothTable(agg.rows);
            host.innerHTML = h;
            return;
        }

        h += '<div style="overflow-x:auto; background:#fff; border:1px solid #eef2f7; border-radius:10px; box-shadow:0 6px 18px rgba(15,23,42,0.06);">' +
            '<table style="width:100%; border-collapse:collapse; font-size:13px; text-align:left;">' +
            '<thead><tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; color:#64748b;">' +
            '<th style="padding:10px;">#</th><th style="padding:10px;">Staff</th><th style="padding:10px;">Sales</th>' +
            '<th style="padding:10px;">Cash</th><th style="padding:10px;">Transfer / POS</th>' +
            '<th style="padding:10px;">Total Received</th><th style="padding:10px;">Refunds</th></tr></thead><tbody>';

        if (agg.rows.length === 0) {
            h += '<tr><td colspan="7" style="text-align:center; color:#64748b; padding:25px;">No sales found for this period.</td></tr>';
        } else {
            agg.rows.forEach(function (r, i) {
                h += '<tr style="border-bottom:1px solid #f1f5f9; cursor:pointer;" onclick="wdsbDetail(' + i + ')">' +
                    '<td style="padding:10px; color:#94a3b8;">' + (i + 1) + '</td>' +
                    '<td style="padding:10px;"><strong>' + esc(r.name) + '</strong> <span style="color:#0284c7; font-size:11px;">view ›</span></td>' +
                    '<td style="padding:10px;">' + r.sales + '</td>' +
                    '<td style="padding:10px; color:#166534; font-weight:bold;">' + money(r.cash) + '</td>' +
                    '<td style="padding:10px; color:#1d4ed8; font-weight:bold;">' + money(r.transfer) + '</td>' +
                    '<td style="padding:10px; font-weight:800;">' + money(r.cash + r.transfer) + '</td>' +
                    '<td style="padding:10px; color:' + (r.refunds > 0 ? '#991b1b' : '#94a3b8') + ';">' + (r.refunds > 0 ? money(r.refunds) : '—') + '</td>' +
                    '</tr>';
            });
        }
        h += '</tbody></table></div>';
        h += '<p style="font-size:11px; color:#64748b; margin-top:10px;">Cash and transfer are what was actually paid at the till. Credit given to customers is not counted as received. ' +
            (state.by === 'receiver' ? 'Sales recorded before this board existed are credited to the seller.' : '') + '</p>';
        host.innerHTML = h;
    }

    function card(label, value, bg, border, labelColor, valueColor) {
        return '<div style="background:' + bg + '; border:1px solid ' + border + '; padding:14px; border-radius:10px;">' +
            '<span style="font-size:11px; color:' + labelColor + '; font-weight:bold; text-transform:uppercase; display:block;">' + label + '</span>' +
            '<h3 style="font-size:19px; color:' + valueColor + '; margin:6px 0 0 0;">' + value + '</h3></div>';
    }

    function btnStyle(active) {
        return 'width:auto; margin:0; padding:6px 14px; font-size:12px; ' +
            (active ? 'background:#0284c7; color:#fff;' : 'background:#e2e8f0; color:#1e293b;');
    }

    function drawControls() {
        var ranges = [['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom']];
        var h = '';
        ranges.forEach(function (r) {
            h += '<button class="menu-btn" style="' + btnStyle(state.range === r[0]) + '" onclick="wdsbSetRange(\'' + r[0] + '\')">' + r[1] + '</button>';
        });
        var bar = document.getElementById('wdsb-range-bar');
        if (bar) bar.innerHTML = h;

        var custom = document.getElementById('wdsb-custom');
        if (custom) custom.style.display = state.range === 'custom' ? 'flex' : 'none';
    }

    window.wdsbSetRange = function (r) {
        state.range = r;
        drawControls();
        if (r !== 'custom') load();
    };

    window.wdsbApplyCustom = function () {
        state.from = (document.getElementById('wdsb-from') || {}).value || '';
        state.to = (document.getElementById('wdsb-to') || {}).value || '';
        load();
    };

    window.wdsbSetBranch = function (v) { state.branch = v; render(); };
    window.wdsbSetBy = function (v) { state.by = v; render(); };

    window.wdsbOpen = function () {
        if (!canView()) {
            alert("Access Restricted: only the Admin or Manager can open the Staff Board.");
            return;
        }
        if (currentUserRole !== 'Admin') state.branch = currentBranch;
        var ws = document.getElementById('workspace-content');
        if (!ws) return;
        var mw = document.getElementById('dashboard-main-wrapper');
        if (mw) { mw.classList.add('active'); mw.style.display = 'block'; }

        var isAdmin = currentUserRole === 'Admin';
        var branchOpts = isAdmin ? '<option value="all">🌐 All Branches</option>' : '';
        if (typeof branchesCache !== 'undefined') {
            Object.keys(branchesCache).forEach(function (id) {
                if (!isAdmin && id !== currentBranch) return;
                branchOpts += '<option value="' + esc(id) + '"' + (state.branch === id ? ' selected' : '') + '>' + esc(branchesCache[id].name) + '</option>';
            });
        }
        if (!branchOpts) {
            branchOpts = '<option value="' + esc(currentBranch) + '" selected>' +
                esc(typeof branchNameOf === 'function' ? branchNameOf(currentBranch) : currentBranch) + '</option>';
        }

        ws.innerHTML =
            '<h2>🏆 Staff Board</h2>' +
            '<p style="font-size:13px; color:#64748b; margin-bottom:15px;">How much cash and transfer each staff member has received. Tap a name to see their sales.</p>' +
            '<div style="background:#f8fafc; padding:12px; border-radius:10px; border:1px solid #eef2f7; margin-bottom:18px;">' +
                '<div id="wdsb-range-bar" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;"></div>' +
                '<div id="wdsb-custom" style="display:none; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:10px;">' +
                    '<input type="date" id="wdsb-from" value="' + esc(state.from) + '" style="padding:6px 10px; border-radius:8px; border:1px solid #cbd5e1; font-size:14px;">' +
                    '<span style="font-size:12px; color:#64748b;">to</span>' +
                    '<input type="date" id="wdsb-to" value="' + esc(state.to) + '" style="padding:6px 10px; border-radius:8px; border:1px solid #cbd5e1; font-size:14px;">' +
                    '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:6px 14px; font-size:12px;" onclick="wdsbApplyCustom()">Apply</button>' +
                '</div>' +
                '<div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">' +
                    '<label style="font-size:12px; font-weight:bold; color:#334155;">Branch:</label>' +
                    '<select onchange="wdsbSetBranch(this.value)"' + (isAdmin ? '' : ' disabled') + ' style="padding:6px 10px; border-radius:8px; border:1px solid #cbd5e1; font-size:13px;">' + branchOpts + '</select>' +
                    '<label style="font-size:12px; font-weight:bold; color:#334155;">Group by:</label>' +
                    '<select onchange="wdsbSetBy(this.value)" style="padding:6px 10px; border-radius:8px; border:1px solid #cbd5e1; font-size:13px;">' +
                        '<option value="both"' + (state.by === 'both' ? ' selected' : '') + '>Sold &amp; Received (side by side)</option>' +
                        '<option value="receiver"' + (state.by === 'receiver' ? ' selected' : '') + '>Received by (took the payment)</option>' +
                        '<option value="seller"' + (state.by === 'seller' ? ' selected' : '') + '>Sold by (made the order)</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<div id="wdsb-results"></div>';

        drawControls();
        load();
    };

    // ---------- Staff detail popup ----------
    function closeDetail() {
        var m = document.getElementById('wdsb-modal');
        if (m) m.style.display = 'none';
    }
    window.wdsbCloseDetail = closeDetail;

    window.wdsbDetail = function (i) {
        var r = state.rows[i];
        if (!r) return;
        var m = document.getElementById('wdsb-modal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'wdsb-modal';
            m.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1200; padding:20px; box-sizing:border-box;';
            m.addEventListener('click', function (ev) { if (ev.target === m) closeDetail(); });
            document.body.appendChild(m);
        }

        var items = r.list.map(function (x) { return x && x.tx ? x : { tx: x, role: '' }; });
        items.sort(function (a, b) { return new Date(b.tx.date || 0) - new Date(a.tx.date || 0); });
        var rowsHtml = items.map(function (it) {
            var t = it.tx;
            var p = split(t);
            var roleTag = it.role ? '<br><small style="color:#0284c7; font-weight:bold;">' + it.role + '</small>' : '';
            var when = t.date ? new Date(t.date).toLocaleString() : 'N/A';
            var cust = t.customerName && t.customerName !== 'Walk-In Customer' ? '<br><small style="color:#64748b;">👤 ' + esc(t.customerName) + '</small>' : '';
            var refund = Number(t.refundedAmount) > 0 ? '<br><small style="color:#991b1b;">Refunded ' + money(t.refundedAmount) + '</small>' : '';
            return '<tr style="border-bottom:1px solid #f1f5f9;">' +
                '<td style="padding:8px;"><strong>' + esc(t.txId || t._key) + '</strong>' + cust + '<br><small style="color:#64748b;">' + esc(when) + '</small>' + roleTag + '</td>' +
                '<td style="padding:8px; color:#166534;">' + money(p.cash) + '</td>' +
                '<td style="padding:8px; color:#1d4ed8;">' + money(p.transfer) + '</td>' +
                '<td style="padding:8px;">' + (p.credit > 0 ? money(p.credit) : '—') + '</td>' +
                '<td style="padding:8px; font-weight:bold;">' + money(p.total) + refund + '</td></tr>';
        }).join('');

        m.innerHTML =
            '<div style="background:#fff; padding:20px; border-radius:14px; width:100%; max-width:640px; max-height:90vh; overflow-y:auto; box-shadow:0 20px 45px rgba(15,23,42,0.25);">' +
                '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;">' +
                    '<h3 style="margin:0; font-size:17px;">' + esc(r.name) + '</h3>' +
                    '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdsbCloseDetail()">✕ Close</button>' +
                '</div>' +
                '<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:8px; margin-bottom:14px;">' +
                    card('Cash', money(r.cash), '#f0fdf4', '#bbf7d0', '#166534', '#14532d') +
                    card('Transfer / POS', money(r.transfer), '#eff6ff', '#bfdbfe', '#1e40af', '#1e3a8a') +
                    card('Credit given', money(r.credit), '#fffbeb', '#fde68a', '#92400e', '#78350f') +
                '</div>' +
                '<div style="overflow-x:auto; border:1px solid #eef2f7; border-radius:10px;">' +
                '<table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">' +
                    '<thead><tr style="background:#f8fafc; color:#64748b;"><th style="padding:8px;">Sale</th><th style="padding:8px;">Cash</th><th style="padding:8px;">Transfer</th><th style="padding:8px;">Credit</th><th style="padding:8px;">Total</th></tr></thead>' +
                    '<tbody>' + rowsHtml + '</tbody></table></div>' +
            '</div>';
        m.style.display = 'flex';
    };

    // ---------- Sidebar button (Admin only) ----------
    function ensureButton() {
        var sb = document.querySelector('.sidebar');
        if (!sb) return;
        var btn = document.getElementById('wdsb-sidebar-btn');
        if (!btn) {
            var anchor = null;
            sb.querySelectorAll('button').forEach(function (b) {
                if ((b.getAttribute('onclick') || '').indexOf('staff-view') > -1) anchor = b;
            });
            btn = document.createElement('button');
            btn.id = 'wdsb-sidebar-btn';
            btn.className = 'menu-btn btn-staff';
            btn.setAttribute('data-static', '1');
            btn.setAttribute('onclick', 'wdsbOpen()');
            btn.textContent = '🏆 Staff Board';
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
            else sb.appendChild(btn);
        }
        var show = (canView() &&
                    typeof currentStoreId !== 'undefined' && currentStoreId && currentStoreId !== 'SUPER_ADMIN');
        btn.style.display = show ? 'block' : 'none';

        // Other patches (staff-sidebar, manager-role) re-apply their own button lists every second.
        // If one of them hides this button for a person who should see it, show it again straight away.
        if (!btn._wdsbWatch && window.MutationObserver) {
            btn._wdsbWatch = true;
            new MutationObserver(function () {
                var ok = canView() && currentStoreId && currentStoreId !== 'SUPER_ADMIN';
                if (ok && btn.style.display === 'none') btn.style.display = 'block';
            }).observe(btn, { attributes: true, attributeFilter: ['style'] });
        }
    }
    setInterval(ensureButton, 1000);
    ensureButton();
})();
