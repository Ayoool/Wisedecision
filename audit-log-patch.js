/* ============================================================
   audit-log-patch.js  v2 — hardened
   ============================================================ */
(function () {
    'use strict';

    var cache = null;
    var renderAttempts = 0;

    /* ---------- runtime discovery ---------- */
    function currentUser() {
        var candidates = [window.currentUserName, window.loggedInUserName, window.currentStaffName, window.currentUser, window.activeUser];
        for (var i = 0; i < candidates.length; i++) if (candidates[i]) return String(candidates[i]);
        var el = document.getElementById('user-role-label');
        if (el) { var m = (el.textContent || '').match(/logged in as\s+(.+)/i); if (m && m[1]) return m[1].trim(); }
        try { var s = localStorage.getItem('currentUserName') || localStorage.getItem('loggedInUser') || localStorage.getItem('userName'); if (s) return s; } catch (e) {}
        return 'Unknown';
    }
    function currentBranch() {
        return window.currentBranchId || window.currentInventoryBranchFilter
            || (function(){ try { return localStorage.getItem('currentBranchId'); } catch(e){ return null; } })()
            || 'all';
    }
    function currentStore() {
        var s = window.currentStoreId || window.storeId || window.activeStoreId;
        if (s) return s;
        try { return localStorage.getItem('currentStoreId') || localStorage.getItem('storeId') || ''; } catch (e) { return ''; }
    }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
    function fmtDate(d) { if (!d) return '--'; var dt = new Date(d); if (isNaN(dt)) return '--'; return dt.toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }

    /* ---------- public: log ---------- */
    window.auditLog = function (action, target, details, extra) {
        if (typeof firebase === 'undefined' || !firebase.database) { console.warn('[audit] firebase not ready'); return; }
        var store = currentStore();
        if (!store) { console.warn('[audit] no store id — cannot log'); alert('Audit: store id not found. Cannot write.'); return; }
        var entry = {
            action: String(action || 'unknown'),
            target: String(target || ''),
            details: (typeof details === 'string') ? details : JSON.stringify(details || {}),
            user: currentUser(),
            branch: currentBranch(),
            date: new Date().toISOString(),
            ts: Date.now()
        };
        if (extra && typeof extra === 'object') Object.keys(extra).forEach(function (k) { entry[k] = extra[k]; });
        var id = 'AL-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        firebase.database().ref('audit/' + store + '/' + id).set(entry)
            .then(function () { console.log('[audit] wrote', id); cache = null; })
            .catch(function (e) { console.error('[audit] write failed', e); alert('Audit write failed: ' + (e.message || e)); });
    };

    /* ---------- safe wrapper ---------- */
    function wrap(name, beforeFn) {
        var orig = window[name];
        if (typeof orig !== 'function') return;
        window[name] = function () {
            try { beforeFn.apply(this, arguments); } catch (e) { console.warn('[audit] hook error in ' + name, e); }
            return orig.apply(this, arguments);
        };
    }
    wrap('handleStoreLogin', function () { setTimeout(function () { window.auditLog('login', 'session', 'Login attempt'); }, 500); });
    wrap('logout', function () { window.auditLog('logout', 'session', 'User logged out'); });
    wrap('saveProduct', function () {
        var editId = document.getElementById('edit-product-id') ? document.getElementById('edit-product-id').value : '';
        var name = document.getElementById('inv-name') ? document.getElementById('inv-name').value : '';
        window.auditLog(editId ? 'product_edit' : 'product_create', name || 'product', editId ? ('Edited ' + name) : ('Created ' + name));
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
        var cart = window.currentCart || []; var total = 0;
        cart.forEach(function (it) { total += Number(it.qty || 0) * Number(it.price || 0); });
        window.auditLog('sale', 'cart', 'Completed sale, ' + cart.length + ' items, ₦' + total.toFixed(0));
    });

    /* ---------- load ---------- */
    function loadAudit(callback, force) {
        if (cache && !force) { callback(cache); return; }
        var store = currentStore();
        if (!store) { callback(null, 'No store id found'); return; }
        if (typeof firebase === 'undefined' || !firebase.database) {
            if (renderAttempts++ < 20) setTimeout(function () { loadAudit(callback, force); }, 400);
            else callback(null, 'Firebase not loaded');
            return;
        }
        firebase.database().ref('audit/' + store).limitToLast(500).once('value').then(function (snap) {
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
        if (!body) { console.warn('[audit] audit-log-body not in DOM'); return; }
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
                    var o = document.createElement('option'); o.value = u; o.textContent = u; userSel.appendChild(o);
                });
            }

            var countEl = document.getElementById('audit-count-label');
            if (countEl) countEl.textContent = filtered.length + ' entr' + (filtered.length === 1 ? 'y' : 'ies');

            if (!list.length) {
                body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">' +
                    'No audit entries yet. Actions you take from now on will show up here.<br><br>' +
                    '<button class="menu-btn btn-action-primary" style="width:auto; margin:6px auto 0; padding:8px 16px;" onclick="window.auditLog(\'login\',\'session\',\'Manual test entry\'); setTimeout(renderAuditLog, 600);">✎ Log Test Entry</button>' +
                    '</td></tr>';
                return;
            }
            if (!filtered.length) {
                body.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">No entries match the filters.</td></tr>';
                return;
            }

            body.innerHTML = filtered.map(function (e) {
                return '<tr style="border-bottom:1px solid #f1f5f9;">' +
                    '<td style="padding:8px; white-space:nowrap;">' + fmtDate(e.date) + '</td>' +
                    '<td style="padding:8px;">' + esc(e.user) + '</td>' +
                    '<td style="padding:8px;"><span style="background:#eff6ff; color:#1d4ed8; padding:2px 8px; border-radius:6px; font-size:11px; font-weight:bold;">' + esc(e.action) + '</span></td>' +
                    '<td style="padding:8px;">' + esc(e.target) + '</td>' +
                    '<td style="padding:8px;">' + esc(e.details) + '</td>' +
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

    window.exportAuditLogCSV = function () {
        loadAudit(function (list, err) {
            if (err || !list) { alert('Cannot export: ' + (err || 'no data')); return; }
            var rows = [['Date','User','Action','Target','Details','Branch']];
            list.forEach(function (e) { rows.push([e.date || '', e.user || '', e.action || '', e.target || '', e.details || '', e.branch || '']); });
            var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
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
        // if the audit view is already active (edge case), render it now
        setTimeout(function () {
            if (document.getElementById('audit-log-view-template') && document.querySelector('#audit-log-view-template').style.display !== 'none') {
                renderAuditLog();
            }
        }, 400);
    });
})();
