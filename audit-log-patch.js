/* ============================================================
   audit-log-patch.js  v5 — Firebase-first + price override report
   Multi-tenant aware. Reads store id / user from runtime,
   caches the last known values, writes to audit/{storeId}.
   ============================================================ */
(function () {
    'use strict';

    var cache = null;
    var renderAttempts = 0;
    var __lastKnownUser = null;
    var __lastKnownStore = null;
    var __lastKnownBranch = null;

    /* Set to true if you want per-branch audit isolation:
       audit/{storeId}/{branchId}/{entryId}
       Leave false for a single audit trail per tenant. */
    var BRANCH_SCOPED = false;

    /* ---------- runtime discovery: user ---------- */
    function currentUser() {
        var candidates = [
            window.currentUserName, window.loggedInUserName, window.currentStaffName,
            window.currentUser, window.activeUser, window.userName, window.staffName,
            window.adminName, window.adminUser, window.loggedInStaff, window.currentCashier
        ];
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i]) { __lastKnownUser = String(candidates[i]); return __lastKnownUser; }
        }
        var el = document.getElementById('user-role-label');
        if (el) {
            var m = (el.textContent || '').match(/logged in as\s+(.+)/i);
            if (m && m[1]) { __lastKnownUser = m[1].trim(); return __lastKnownUser; }
        }
        if (__lastKnownUser) return __lastKnownUser;
        return 'Unknown';
    }

    /* ---------- runtime discovery: store id ---------- */
    function currentStore() {
        var cands = [
            window.currentStoreId, window.storeId, window.storeID,
            window.activeStoreId, window.currentStore, window.loggedInStore,
            window.activeStore, window.businessId, window.currentBusinessId,
            window.currentBizId, window.tenantId, window.currentTenant,
            window.storeCode, window.store_id, window.currentStoreCode
        ];
        for (var i = 0; i < cands.length; i++) {
            if (cands[i]) { __lastKnownStore = String(cands[i]).trim(); return __lastKnownStore; }
        }
        var inp = document.getElementById('store-id-input');
        if (inp && inp.value && inp.value.trim()) {
            __lastKnownStore = inp.value.trim();
            return __lastKnownStore;
        }
        var brand = document.getElementById('dashboard-store-title');
        if (brand) {
            var txt = (brand.textContent || '').trim();
            if (txt && !/wise decision/i.test(txt)) { __lastKnownStore = txt; return __lastKnownStore; }
        }
        if (__lastKnownStore) return __lastKnownStore;
        return '';
    }

    /* ---------- runtime discovery: branch ---------- */
    function currentBranch() {
        var cands = [
            window.currentBranchId, window.currentInventoryBranchFilter,
            window.activeBranchId, window.branchId, window.selectedBranchId
        ];
        for (var i = 0; i < cands.length; i++) {
            if (cands[i]) { __lastKnownBranch = String(cands[i]); return __lastKnownBranch; }
        }
        if (__lastKnownBranch) return __lastKnownBranch;
        return 'all';
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
        });
    }
    function fmtDate(d) {
        if (!d) return '--';
        var dt = new Date(d);
        if (isNaN(dt)) return '--';
        return dt.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function auditBasePath() {
        var store = currentStore();
        if (!store) return null;
        if (BRANCH_SCOPED) {
            var branch = currentBranch();
            return 'audit/' + store + '/' + branch;
        }
        return 'audit/' + store;
    }

    /* ---------- public: log ---------- */
    window.auditLog = function (action, target, details, extra) {
        if (typeof firebase === 'undefined' || !firebase.database) return;
        var base = auditBasePath();
        if (!base) {
            console.warn('[audit] store id unknown — skipping');
            return;
        }
        var entry = {
            action: String(action || 'unknown'),
            target: String(target || ''),
            details: (typeof details === 'string') ? details : JSON.stringify(details || {}),
            user: currentUser(),
            branch: currentBranch(),
            date: new Date().toISOString(),
            ts: Date.now()
        };
        if (extra && typeof extra === 'object') {
            Object.keys(extra).forEach(function (k) { entry[k] = extra[k]; });
        }
        var id = 'AL-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        firebase.database().ref(base + '/' + id).set(entry)
            .then(function () { cache = null; })
            .catch(function (e) { console.warn('[audit] write failed', e); });
    };

    /* ---------- safe wrapper ---------- */
    function wrap(name, beforeFn) {
        var orig = window[name];
        if (typeof orig !== 'function') return;
        window[name] = function () {
            try { beforeFn.apply(this, arguments); }
            catch (e) { console.warn('[audit] hook error in ' + name, e); }
            return orig.apply(this, arguments);
        };
    }

    wrap('handleStoreLogin', function () {
        var inp = document.getElementById('store-id-input');
        if (inp && inp.value && inp.value.trim()) __lastKnownStore = inp.value.trim();
        setTimeout(function () {
            var el = document.getElementById('user-role-label');
            if (el) {
                var m = (el.textContent || '').match(/logged in as\s+(.+)/i);
                if (m && m[1]) __lastKnownUser = m[1].trim();
            }
            window.auditLog('login', 'session', 'User logged in');
        }, 1500);
    });

    wrap('logout', function () {
        window.auditLog('logout', 'session', 'User logged out');
        __lastKnownStore = null;
        __lastKnownUser = null;
        __lastKnownBranch = null;
    });

    wrap('saveProduct', function () {
        var editId = document.getElementById('edit-product-id') ? document.getElementById('edit-product-id').value : '';
        var name = document.getElementById('inv-name') ? document.getElementById('inv-name').value : '';
        window.auditLog(editId ? 'product_edit' : 'product_create', name || 'product',
            editId ? ('Edited ' + name) : ('Created ' + name));
    });
    wrap('changeAdminOwnPin', function () { window.auditLog('pin_change', 'self', 'Attempted PIN change'); });
    wrap('updateBusinessProfile', function () { window.auditLog('settings_change', 'business_profile', 'Updated business profile'); });
    wrap('saveWriteOff', function () {
        var pid = document.getElementById('writeoff-product-id') ? document.getElementById('writeoff-product-id').value : '';
        var qty = document.getElementById('writeoff-qty') ? document.getElementById('writeoff-qty').value : '';
        window.auditLog('writeoff', pid, 'Wrote off ' + qty);
    });
    wrap('processRefund', function () { window.auditLog('refund', 'sale', 'Processed refund'); });
    wrap('processDebtPayment', function () {
        var cid = document.getElementById('debt-payment-customer-id') ? document.getElementById('debt-payment-customer-id').value : '';
        var amt = document.getElementById('debt-payment-amount') ? document.getElementById('debt-payment-amount').value : '';
        window.auditLog('debt_payment', cid, 'Received ₦' + amt);
    });
    wrap('completeSplitCheckout', function () {
        var cart = window.currentCart || [];
        var total = 0;
        cart.forEach(function (it) { total += Number(it.qty || 0) * Number(it.price || 0); });
        window.auditLog('sale', 'cart', 'Completed sale, ' + cart.length + ' items, ₦' + total.toFixed(0));
    });

    /* ---------- PRICE OVERRIDE LOGGING ----------
       The actual override is captured in index.html, inside the addToCart
       wrapper. That code calls window.auditLog('price_override', ...)
       directly. Nothing to hook here — this note exists so future-you
       knows where the logic lives.
       -------------------------------------------- */

    /* ---------- load ---------- */
    function loadAudit(callback, force) {
        if (cache && !force) { callback(cache); return; }
        var base = auditBasePath();
        if (!base) { callback(null, 'No store id found. Please log in.'); return; }
        if (typeof firebase === 'undefined' || !firebase.database) {
            if (renderAttempts++ < 20) setTimeout(function () { loadAudit(callback, force); }, 400);
            else callback(null, 'Firebase not loaded');
            return;
        }
        firebase.database().ref(base).limitToLast(500).once('value').then(function (snap) {
            var val = snap.val() || {};
            var list = Object.keys(val).map(function (k) { var e = val[k]; e.__id = k; return e; });
            list.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
            cache = list;
            callback(list);
        }).catch(function (err) {
            console.error('[audit] read failed', err);
            callback(null, 'Read failed: ' + (err.message || err));
        });
    }

    /* ---------- render ---------- */
    window.renderAuditLog = function () {
        var body = document.getElementById('audit-log-body');
        if (!body) return;
        body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">Loading…</td></tr>';

        loadAudit(function (list, err) {
            if (err) {
                body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#dc2626; padding:20px;">⚠ ' + esc(err) + '</td></tr>';
                return;
            }
            list = list || [];

            var uFilter = document.getElementById('audit-filter-user').value;
            var aFilter = document.getElementById('audit-filter-action').value;
            var fromEl = document.getElementById('audit-filter-from');
            var toEl = document.getElementById('audit-filter-to');
            var fromTs = fromEl.value ? new Date(fromEl.value + 'T00:00:00').getTime() : 0;
            var toTs = toEl.value ? new Date(toEl.value + 'T23:59:59').getTime() : Infinity;

            var filtered = list.filter(function (e) {
                if (uFilter && e.user !== uFilter) return false;
                if (aFilter && e.action !== aFilter) return false;
                if (e.ts && (e.ts < fromTs || e.ts > toTs)) return false;
                return true;
            });

            var userSel = document.getElementById('audit-filter-user');
            if (userSel.options.length <= 1) {
                var users = {};
                list.forEach(function (e) { if (e.user) users[e.user] = true; });
                Object.keys(users).forEach(function (u) {
                    var o = document.createElement('option');
                    o.value = u; o.textContent = u;
                    userSel.appendChild(o);
                });
            }

            var countEl = document.getElementById('audit-count-label');
            if (countEl) countEl.textContent = filtered.length + ' entr' + (filtered.length === 1 ? 'y' : 'ies');

            if (!list.length) {
                body.innerHTML =
                    '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">' +
                    'No audit entries yet. Actions you take from now on will show up here.<br><br>' +
                    '<button class="menu-btn btn-action-primary" style="width:auto; margin:6px auto 0; padding:8px 16px;" ' +
                    'onclick="window.auditLog(\'login\',\'session\',\'Manual test entry\'); setTimeout(renderAuditLog, 800);">✎ Log Test Entry</button>' +
                    '</td></tr>';
                return;
            }
            if (!filtered.length) {
                body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">No entries match the filters.</td></tr>';
                return;
            }

            body.innerHTML = filtered.map(function (e) {
                // price_override rows get a highlighted old → new price cell
                var detailsHtml = esc(e.details);
                if (e.action === 'price_override' && e.oldPrice != null && e.newPrice != null) {
                    var drop = Number(e.oldPrice) - Number(e.newPrice);
                    var dropColor = drop > 0 ? '#dc2626' : '#16a34a';
                    detailsHtml = '₦' + Number(e.oldPrice).toLocaleString() +
                                  ' → <strong style="color:' + dropColor + ';">₦' + Number(e.newPrice).toLocaleString() + '</strong>' +
                                  (drop !== 0 ? ' (' + (drop > 0 ? '−' : '+') + '₦' + Math.abs(drop).toLocaleString() + ')' : '') +
                                  ' × ' + (e.qty || 1);
                }

                return '<tr style="border-bottom:1px solid #f1f5f9;">' +
                    '<td style="padding:8px; white-space:nowrap;">' + fmtDate(e.date) + '</td>' +
                    '<td style="padding:8px;">' + esc(e.user) + '</td>' +
                    '<td style="padding:8px;"><span style="background:#eff6ff; color:#1d4ed8; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:bold;">' + esc(e.action) + '</span></td>' +
                    '<td style="padding:8px;">' + esc(e.target) + '</td>' +
                    '<td style="padding:8px;">' + detailsHtml + '</td>' +
                    '<td style="padding:8px;">' + esc(e.branch) + '</td>' +
                '</tr>';
            }).join('');
        }, true);
    };

    window.clearAuditFilters = function () {
        document.getElementById('audit-filter-user').value = '';
        document.getElementById('audit-filter-action').value = '';
        document.getElementById('audit-filter-from').value = '';
        document.getElementById('audit-filter-to').value = '';
        renderAuditLog();
    };

    /* ---------- price overrides quick report ---------- */
    window.showPriceOverridesOnly = function () {
        document.getElementById('audit-filter-user').value = '';
        document.getElementById('audit-filter-action').value = 'price_override';
        document.getElementById('audit-filter-from').value = '';
        document.getElementById('audit-filter-to').value = '';
        renderAuditLog();
    };

    window.exportAuditLogCSV = function () {
        loadAudit(function (list, err) {
            if (err || !list) { alert('Cannot export: ' + (err || 'no data')); return; }
            var rows = [['Date','User','Action','Target','Details','Branch','Old Price','New Price','Qty']];
            list.forEach(function (e) {
                rows.push([
                    e.date || '', e.user || '', e.action || '', e.target || '',
                    e.details || '', e.branch || '',
                    e.oldPrice != null ? e.oldPrice : '',
                    e.newPrice != null ? e.newPrice : '',
                    e.qty != null ? e.qty : ''
                ]);
            });
            var csv = rows.map(function (r) {
                return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
            }).join('\n');
            var blob = new Blob([csv], { type: 'text/csv' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'audit_log_' + new Date().toISOString().slice(0, 10) + '.csv';
            a.click();
        }, true);
    };

    /* ---------- inject on view switch ---------- */
    window.addEventListener('load', function () {
        var orig = window.switchView;
        if (typeof orig === 'function') {
            window.switchView = function (viewId) {
                var ret = orig.apply(this, arguments);
                if (viewId === 'audit-log-view') setTimeout(renderAuditLog, 80);
                return ret;
            };
        }
        setTimeout(function () {
            if (document.getElementById('audit-log-view-template') &&
                document.querySelector('#audit-log-view-template').style.display !== 'none') {
                renderAuditLog();
            }
        }, 400);
    });
})();
