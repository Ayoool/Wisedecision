// ==================== WISE DECISION EXTRAS PATCH (v4) ====================
// Load LAST (after all the other patches), with defer.
//
// v4: Clock In / Shift Log now works for Standard Workers.
//     Because staff-sidebar-patch.js hides most sidebar buttons for that role,
//     the shift controls are also injected at the top of the POS screen where
//     Standard Workers actually spend their time. Everyone else keeps the
//     sidebar versions too.
//
// v3: Shift Log visible to all roles. Admin sees everyone; others see only
//     their own shifts.
//
// Adds:
//   1. Loyalty Points: every 1000 Naira spent = 1 point.
//   2. Shift Log: Clock In / Clock Out + hours report.

console.log("Wise Decision extras-patch.js - v4 loaded (loyalty points + shift log)");

// Config
var WDEX_POINTS_PER_NAIRA = 1000;

// Helpers
function wdexEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wdexMoney(n) { return String.fromCharCode(8358) + (Number(n) || 0).toLocaleString(); }
function wdexPointsFor(amount) { return Math.floor((Number(amount) || 0) / WDEX_POINTS_PER_NAIRA); }
function wdexPad(n) { return String(n).padStart(2, '0'); }
function wdexHHMM(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '--:--';
    return wdexPad(d.getHours()) + ':' + wdexPad(d.getMinutes());
}
function wdexPretty(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '--';
    return d.toLocaleDateString() + ' ' + wdexHHMM(iso);
}
function wdexHoursBetween(aIso, bIso) {
    var a = new Date(aIso).getTime(), b = new Date(bIso).getTime();
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.max(0, Math.round(((b - a) / 3600000) * 100) / 100);
}

// =====================================================================
// LOYALTY POINTS
// =====================================================================
function wdexGetCustomerPoints(customerId) {
    if (!customerId) return 0;
    if (typeof customersCache !== 'undefined' && customersCache[customerId]) {
        return Number(customersCache[customerId].loyaltyPoints) || 0;
    }
    return 0;
}

function wdexAdjustPoints(customerId, delta, reason, meta) {
    if (!customerId || !delta) return Promise.resolve();
    var ref = firebase.database().ref('stores/' + currentStoreId + '/customers/' + customerId);
    return ref.child('loyaltyPoints').transaction(function (cur) {
        return Math.max(0, (Number(cur) || 0) + Number(delta));
    }).then(function (res) {
        if (res.committed) {
            var label = document.getElementById('user-role-label');
            ref.child('loyaltyLog').push({
                at: new Date().toISOString(),
                delta: Number(delta),
                reason: reason || 'adjustment',
                note: (meta && meta.note) || '',
                txId: (meta && meta.txId) || null,
                recordedBy: (label && label.textContent) || currentUserRole || 'Staff'
            }).catch(function () {});
        }
    }).catch(function (e) {
        console.warn('wdexAdjustPoints failed:', e);
    });
}

(function wdexWrapCompleteSplitCheckout() {
    var original = window.completeSplitCheckout;
    if (typeof original !== 'function' || original.__wdex) return;
    var wrapped = function () {
        var preOrder = currentActiveOrder ? Object.assign({}, currentActiveOrder) : null;
        var result = original.apply(this, arguments);
        if (preOrder && preOrder.customerId && preOrder.totalAmount > 0) {
            setTimeout(function () {
                firebase.database().ref('stores/' + currentStoreId + '/transactions/' + preOrder.txId).once('value').then(function (snap) {
                    if (!snap.exists()) return;
                    var tx = snap.val();
                    if (tx.loyaltyCredited) return;
                    var pts = wdexPointsFor(tx.totalAmount);
                    if (pts > 0) {
                        wdexAdjustPoints(tx.customerId, pts, 'sale', { txId: tx.txId, note: wdexMoney(tx.totalAmount) + ' sale' });
                    }
                    firebase.database().ref('stores/' + currentStoreId + '/transactions/' + preOrder.txId + '/loyaltyCredited').set(true);
                });
            }, 1500);
        }
        return result;
    };
    wrapped.__wdex = true;
    window.completeSplitCheckout = wrapped;
})();

(function wdexWrapProcessRefund() {
    var original = window.processRefund;
    if (typeof original !== 'function' || original.__wdex) return;
    var wrapped = function () {
        var refund = currentActiveRefund ? { txId: currentActiveRefund.txId, customerId: currentActiveRefund.customerId } : null;
        var result = original.apply(this, arguments);
        setTimeout(function () {
            if (!refund || !refund.customerId) return;
            firebase.database().ref('stores/' + currentStoreId + '/transactions/' + refund.txId).once('value').then(function (snap) {
                if (!snap.exists()) return;
                var tx = snap.val();
                var refunded = Number(tx.refundedAmount) || 0;
                var pointsToRemove = wdexPointsFor(refunded);
                if (pointsToRemove > 0) {
                    var alreadyRemoved = Number(tx.loyaltyReversedPoints) || 0;
                    var delta = pointsToRemove - alreadyRemoved;
                    if (delta > 0) {
                        wdexAdjustPoints(refund.customerId, -delta, 'refund', { txId: refund.txId, note: wdexMoney(refunded) + ' refunded' });
                        firebase.database().ref('stores/' + currentStoreId + '/transactions/' + refund.txId + '/loyaltyReversedPoints').set(pointsToRemove);
                    }
                }
            });
        }, 1500);
        return result;
    };
    wrapped.__wdex = true;
    window.processRefund = wrapped;
})();

(function wdexWrapUpdatePosCustomerBadge() {
    var original = window.updatePosCustomerBadge;
    if (typeof original !== 'function' || original.__wdex) return;
    var wrapped = function () {
        var result = original.apply(this, arguments);
        try {
            var badge = document.getElementById('pos-selected-customer-badge');
            if (!badge || !currentSelectedCustomer) return result;
            if (badge.querySelector('.wdex-pts')) return result;
            var pts = wdexGetCustomerPoints(currentSelectedCustomer.id);
            var span = document.createElement('span');
            span.className = 'wdex-pts';
            span.style.cssText = 'margin-left:8px; font-size:11px; font-weight:bold; color:#7c3aed; background:#f5f3ff; border:1px solid #ddd6fe; padding:2px 8px; border-radius:6px;';
            span.textContent = 'Points: ' + pts;
            badge.appendChild(span);
        } catch (e) {}
        return result;
    };
    wrapped.__wdex = true;
    window.updatePosCustomerBadge = wrapped;
})();

(function wdexInjectProfileCard() {
    var original = window.refreshCustomerProfileSummary;
    if (typeof original !== 'function' || original.__wdex) return;
    var wrapped = function (id) {
        var result = original.apply(this, arguments);
        try {
            var spentCard = document.getElementById('profile-cust-spent');
            if (!spentCard || !spentCard.parentElement) return result;
            var grid = spentCard.parentElement.parentElement;
            if (!grid) return result;
            if (grid.querySelector('.wdex-points-card')) {
                var el = grid.querySelector('.wdex-points-card .wdex-pts-value');
                if (el) el.textContent = wdexGetCustomerPoints(id);
                return result;
            }
            var box = document.createElement('div');
            box.className = 'wdex-points-card';
            box.style.cssText = 'background:#f5f3ff; border:1px solid #ddd6fe; padding:10px; border-radius:10px;';
            box.innerHTML = '<span style="font-size:10px; color:#6d28d9; font-weight:bold; text-transform:uppercase;">Loyalty Points</span>' +
                '<h4 class="wdex-pts-value" style="font-size:16px; color:#5b21b6; margin:4px 0 0 0;">' + wdexGetCustomerPoints(id) + '</h4>';
            grid.appendChild(box);
        } catch (e) {}
        return result;
    };
    wrapped.__wdex = true;
    window.refreshCustomerProfileSummary = wrapped;
})();

(function wdexWrapRenderCustomersTable() {
    var original = window.renderCustomersTable;
    if (typeof original !== 'function' || original.__wdex) return;
    var wrapped = function (dataset) {
        var result = original.apply(this, arguments);
        try {
            var table = document.querySelector('#customers-view-template table');
            if (table) {
                var thead = table.querySelector('thead tr');
                if (thead && !thead.querySelector('.wdex-pts-th')) {
                    var th = document.createElement('th');
                    th.className = 'wdex-pts-th';
                    th.textContent = 'Points';
                    var actionTh = thead.children[thead.children.length - 1];
                    thead.insertBefore(th, actionTh);
                }
            }
            var tbody = document.getElementById('customers-body');
            if (!tbody) return result;
            var rows = tbody.querySelectorAll('tr');
            rows.forEach(function (tr) {
                if (tr.querySelector('.wdex-pts-td')) return;
                var viewBtn = tr.querySelector('button[onclick^="openCustomerProfile"]');
                if (!viewBtn) return;
                var m = /openCustomerProfile\('([^']+)'\)/.exec(viewBtn.getAttribute('onclick') || '');
                if (!m) return;
                var id = m[1];
                var c = dataset && dataset[id] ? dataset[id] : null;
                var pts = c ? (Number(c.loyaltyPoints) || 0) : 0;
                var td = document.createElement('td');
                td.className = 'wdex-pts-td';
                td.innerHTML = '<span style="color:#7c3aed; font-weight:bold;">' + pts + '</span>';
                tr.insertBefore(td, tr.lastElementChild);
            });
        } catch (e) {}
        return result;
    };
    wrapped.__wdex = true;
    window.renderCustomersTable = wrapped;
})();

// =====================================================================
// SHIFT LOG
// =====================================================================
function wdexCurrentStaffKey() {
    var label = (document.getElementById('user-role-label') || {}).textContent || '';
    var cleaned = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return cleaned || 'unknown';
}
function wdexCurrentStaffDisplay() {
    var label = (document.getElementById('user-role-label') || {}).textContent || '';
    return label || 'Staff';
}

var wdexShiftOpenRef = null;
var wdexShiftOpenListenerKey = null;
var wdexLastOpenShift = null;

// Sidebar version — for everyone except Standard Workers (whose sidebar is trimmed)
function wdexEnsureShiftButton() {
    if (!currentStoreId) return;
    if (currentUserRole === 'SuperAdmin') return;
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    var btn = document.getElementById('wdex-shift-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'wdex-shift-btn';
        btn.className = 'menu-btn';
        btn.style.cssText = 'background:#f8fafc; border:1px solid #cbd5e1;';
        btn.onclick = wdexToggleShift;
        btn.textContent = 'Clock In';
        var logoutBtn = sidebar.querySelector('button[onclick="logout()"]');
        if (logoutBtn && logoutBtn.parentElement) logoutBtn.parentElement.insertBefore(btn, logoutBtn);
        else sidebar.appendChild(btn);
    } else if (btn.style.display === 'none') {
        btn.style.display = 'block';
    }
    wdexLoadShiftState();
}

// POS version — for Standard Workers (and anyone else, since it's harmless there too)
function wdexEnsurePosShiftPill() {
    if (!currentStoreId) return;
    if (currentUserRole === 'SuperAdmin') return;
    var posLabel = document.getElementById('pos-branch-label');
    if (!posLabel) return;                          // not the POS view
    var pillWrap = posLabel.parentElement;
    if (!pillWrap || !pillWrap.parentElement) return;

    var pill = document.getElementById('wdex-pos-shift-pill');
    if (!pill) {
        pill = document.createElement('button');
        pill.id = 'wdex-pos-shift-pill';
        pill.style.cssText = 'margin-left:auto; font-size:12px; font-weight:bold; padding:6px 12px; border-radius:8px; cursor:pointer; border:1px solid #cbd5e1; background:#f8fafc; color:#1e293b;';
        pill.onclick = wdexToggleShift;
        pillWrap.parentElement.insertBefore(pill, pillWrap.nextSibling);
    }
    wdexUpdatePosShiftPill();
}

function wdexUpdatePosShiftPill() {
    var pill = document.getElementById('wdex-pos-shift-pill');
    if (!pill) return;
    if (wdexLastOpenShift) {
        pill.textContent = 'On shift since ' + wdexHHMM(wdexLastOpenShift.in) + ' - Clock Out';
        pill.style.background = '#dcfce7';
        pill.style.borderColor = '#86efac';
        pill.style.color = '#166534';
    } else {
        pill.textContent = 'Clock In';
        pill.style.background = '#f8fafc';
        pill.style.borderColor = '#cbd5e1';
        pill.style.color = '#1e293b';
    }
}

function wdexLoadShiftState() {
    var key = wdexCurrentStaffKey();
    if (!currentStoreId) return;
    if (wdexShiftOpenListenerKey === currentStoreId + '|' + key && wdexShiftOpenRef) return;
    if (wdexShiftOpenRef) wdexShiftOpenRef.off();
    wdexShiftOpenListenerKey = currentStoreId + '|' + key;
    wdexShiftOpenRef = firebase.database().ref('stores/' + currentStoreId + '/shifts/' + key);
    wdexShiftOpenRef.on('value', function (snap) {
        var v = snap.val() || {};
        var openShift = null;
        Object.keys(v).forEach(function (id) {
            var s = v[id];
            if (s && s.in && !s.out) {
                if (!openShift || s.in > openShift.in) openShift = { id: id, in: s.in };
            }
        });
        wdexLastOpenShift = openShift;
        wdexUpdateShiftButton(openShift);
        wdexUpdatePosShiftPill();
    });
}

function wdexUpdateShiftButton(openShift) {
    var btn = document.getElementById('wdex-shift-btn');
    if (!btn) return;
    if (openShift) {
        btn.innerHTML = '<span style="color:#166534; font-weight:bold;">On shift since ' + wdexHHMM(openShift.in) + '</span> - Clock Out';
        btn.style.background = '#dcfce7';
        btn.style.borderColor = '#86efac';
        btn.dataset.openShiftId = openShift.id;
    } else {
        btn.textContent = 'Clock In';
        btn.style.background = '#f8fafc';
        btn.style.borderColor = '#cbd5e1';
        delete btn.dataset.openShiftId;
    }
}

function wdexToggleShift() {
    var btn = document.getElementById('wdex-shift-btn');
    var pill = document.getElementById('wdex-pos-shift-pill');
    var openShiftId = (btn && btn.dataset.openShiftId) || (wdexLastOpenShift && wdexLastOpenShift.id) || null;
    var key = wdexCurrentStaffKey();
    var ref = firebase.database().ref('stores/' + currentStoreId + '/shifts/' + key);

    if (openShiftId) {
        ref.child(openShiftId).once('value').then(function (snap) {
            var s = snap.val();
            if (!s || !s.in) return;
            var out = new Date().toISOString();
            var hours = wdexHoursBetween(s.in, out);
            return ref.child(openShiftId).update({ out: out, hours: hours }).then(function () {
                alert('Clocked out at ' + wdexHHMM(out) + '. Hours worked: ' + hours);
            });
        }).catch(function (e) { alert('Clock out failed: ' + e.message); });
    } else {
        var now = new Date().toISOString();
        ref.push().set({
            name: wdexCurrentStaffDisplay(),
            role: currentUserRole,
            branchId: currentBranch || 'main',
            in: now
        }).then(function () {
            alert('Clocked in at ' + wdexHHMM(now) + '.');
        }).catch(function (e) { alert('Clock in failed: ' + e.message); });
    }
}

function wdexOpenShiftLog() {
    if (!currentStoreId) return;
    var isAdmin = (currentUserRole === 'Admin');

    var mainWrapper = document.getElementById('dashboard-main-wrapper');
    if (mainWrapper) { mainWrapper.classList.add('active'); mainWrapper.style.display = 'block'; }
    var workspace = document.getElementById('workspace-content');
    if (!workspace) return;

    var heading = isAdmin ? 'Shift Log - All Staff' : 'My Shift Log';
    workspace.innerHTML = '<div style="padding:20px;"><h2 style="margin-top:0;">' + heading + '</h2>' +
        '<div id="wdex-shift-content" style="margin-top:15px; color:#64748b;">Loading shifts...</div></div>';

    firebase.database().ref('stores/' + currentStoreId + '/shifts').once('value').then(function (snap) {
        var byPerson = {};
        snap.forEach(function (personChild) {
            var personKey = personChild.key;
            personChild.forEach(function (shiftChild) {
                var s = shiftChild.val() || {};
                if (!s.in) return;
                byPerson[personKey] = byPerson[personKey] || { name: s.name || personKey, role: s.role || '', shifts: [] };
                var clone = {}; Object.keys(s).forEach(function(k){ clone[k] = s[k]; }); clone.id = shiftChild.key;
                byPerson[personKey].shifts.push(clone);
            });
        });

        var monthStart = new Date();
        monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
        var flat = [];
        Object.keys(byPerson).forEach(function (k) {
            var p = byPerson[k];
            p.shifts.sort(function (a, b) { return String(b.in).localeCompare(String(a.in)); });
            var monthHours = 0;
            p.shifts.forEach(function (s) {
                if (s.in && new Date(s.in) >= monthStart) {
                    monthHours += Number(s.out ? s.hours : wdexHoursBetween(s.in, new Date().toISOString())) || 0;
                }
                var clone = {}; Object.keys(s).forEach(function(kk){ clone[kk] = s[kk]; });
                clone.personName = p.name;
                clone.role = p.role || clone.role;
                clone.personKey = k;
                flat.push(clone);
            });
            p.monthHours = Math.round(monthHours * 100) / 100;
        });
        flat.sort(function (a, b) { return String(b.in).localeCompare(String(a.in)); });

        var html = '';
        html += '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:15px;">';
        html += '<h3 style="margin:0 0 8px 0; font-size:15px;">' + (isAdmin ? 'This Month - Hours Per Person' : 'My Hours This Month') + '</h3>';
        var myKey = wdexCurrentStaffKey();
        var personKeys = Object.keys(byPerson);
        if (!isAdmin) personKeys = personKeys.filter(function (k) { return k === myKey; });
        if (personKeys.length === 0) {
            html += '<div style="color:#64748b; font-size:13px;">No shifts recorded yet.</div>';
        } else {
            personKeys.sort(function (a, b) { return byPerson[b].monthHours - byPerson[a].monthHours; });
            html += '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
            html += '<thead><tr style="text-align:left; border-bottom:1px solid #cbd5e1;"><th style="padding:6px 4px;">Name</th><th style="padding:6px 4px;">Role</th><th style="padding:6px 4px; text-align:right;">Hours (this month)</th></tr></thead><tbody>';
            personKeys.forEach(function (k) {
                var p = byPerson[k];
                html += '<tr style="border-bottom:1px dashed #e2e8f0;">' +
                    '<td style="padding:6px 4px;">' + wdexEsc(p.name) + '</td>' +
                    '<td style="padding:6px 4px; color:#64748b;">' + wdexEsc(p.role) + '</td>' +
                    '<td style="padding:6px 4px; text-align:right; font-weight:bold;">' + p.monthHours + '</td></tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';

        html += '<div style="background:#fff; border:1px solid #eef2f7; border-radius:10px; overflow-x:auto;">';
        html += '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
        html += '<thead><tr style="text-align:left; background:#f8fafc; border-bottom:2px solid #cbd5e1;">';
        if (isAdmin) html += '<th style="padding:8px;">Name</th>';
        html += '<th style="padding:8px;">Role</th><th style="padding:8px;">Clocked In</th><th style="padding:8px;">Clocked Out</th><th style="padding:8px; text-align:right;">Hours</th></tr></thead><tbody>';

        var shown = 0;
        flat.forEach(function (s) {
            if (!isAdmin && s.personKey !== myKey) return;
            shown++;
            var isOpen = s.in && !s.out;
            html += '<tr style="border-bottom:1px dashed #e2e8f0;">';
            if (isAdmin) html += '<td style="padding:6px 8px;">' + wdexEsc(s.personName) + '</td>';
            html += '<td style="padding:6px 8px; color:#64748b;">' + wdexEsc(s.role || '') + '</td>' +
                '<td style="padding:6px 8px;">' + wdexPretty(s.in) + '</td>' +
                '<td style="padding:6px 8px;">' + (isOpen ? '<span style="color:#166534; font-weight:bold;">still on shift</span>' : wdexPretty(s.out)) + '</td>' +
                '<td style="padding:6px 8px; text-align:right; font-weight:bold;">' + (isOpen ? '--' : (Number(s.hours) || 0)) + '</td>' +
                '</tr>';
        });
        if (shown === 0) {
            var colspan = isAdmin ? 5 : 4;
            html += '<tr><td colspan="' + colspan + '" style="padding:15px; text-align:center; color:#64748b;">No shifts recorded yet.</td></tr>';
        }
        html += '</tbody></table></div>';

        document.getElementById('wdex-shift-content').innerHTML = html;
    }).catch(function (e) {
        document.getElementById('wdex-shift-content').innerHTML = '<div style="color:#b91c1c;">Failed to load shifts: ' + wdexEsc(e.message) + '</div>';
    });
}

// Opens shift log from POS pill (uses same view renderer as sidebar button)
function wdexOpenShiftLogFromPos() {
    wdexOpenShiftLog();
}

function wdexEnsureShiftLogButton() {
    if (currentUserRole === 'SuperAdmin') return;
    if (!currentStoreId) return;
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    var existing = document.getElementById('wdex-shiftlog-btn');
    if (existing) {
        if (existing.style.display === 'none') existing.style.display = 'block';
        return;
    }
    var btn = document.createElement('button');
    btn.id = 'wdex-shiftlog-btn';
    btn.className = 'menu-btn btn-staff';
    btn.textContent = 'Shift Log';
    btn.onclick = wdexOpenShiftLog;
    var settingsBtn = sidebar.querySelector('button[onclick="switchView(\'settings-view\')"]');
    if (settingsBtn && settingsBtn.parentElement) settingsBtn.parentElement.insertBefore(btn, settingsBtn);
    else {
        var logout = sidebar.querySelector('button[onclick="logout()"]');
        if (logout && logout.parentElement) logout.parentElement.insertBefore(btn, logout);
        else sidebar.appendChild(btn);
    }
}

// POS shift log button — injected next to the POS pill so workers can see their hours
function wdexEnsurePosShiftLogButton() {
    if (currentUserRole === 'SuperAdmin') return;
    if (!currentStoreId) return;
    var posLabel = document.getElementById('pos-branch-label');
    if (!posLabel) return;
    var wrap = posLabel.parentElement;
    if (!wrap || !wrap.parentElement) return;
    if (document.getElementById('wdex-pos-shiftlog-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'wdex-pos-shiftlog-btn';
    btn.style.cssText = 'margin-left:8px; font-size:12px; font-weight:bold; padding:6px 12px; border-radius:8px; cursor:pointer; border:1px solid #cbd5e1; background:#f0f9ff; color:#0369a1;';
    btn.textContent = 'Shift Log';
    btn.onclick = wdexOpenShiftLog;
    wrap.parentElement.appendChild(btn);
}

function wdexInstall() {
    try { wdexEnsureShiftButton(); } catch (e) { console.warn(e); }
    try { wdexEnsureShiftLogButton(); } catch (e) { console.warn(e); }
    try { wdexEnsurePosShiftPill(); } catch (e) { console.warn(e); }
    try { wdexEnsurePosShiftLogButton(); } catch (e) { console.warn(e); }
}

(function wdexHookSwitchView() {
    var prev = window.switchView;
    if (typeof prev !== 'function' || prev.__wdex) return;
    var wrapped = function () {
        var result = prev.apply(this, arguments);
        setTimeout(function () { try { wdexInstall(); } catch (e) {} }, 80);
        setTimeout(function () { try { wdexInstall(); } catch (e) {} }, 400);
        return result;
    };
    wrapped.__wdex = true;
    window.switchView = wrapped;
})();

(function wdexHookLogin() {
    var prev = window.handleStoreLogin;
    if (typeof prev !== 'function' || prev.__wdex) return;
    var wrapped = function () {
        var result = prev.apply(this, arguments);
        setTimeout(function () { try { wdexInstall(); } catch (e) {} }, 500);
        setTimeout(function () { try { wdexInstall(); } catch (e) {} }, 1500);
        return result;
    };
    wrapped.__wdex = true;
    window.handleStoreLogin = wrapped;
})();

(function wdexWatchDom() {
    var scheduled = false;
    function fire() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            try { wdexInstall(); } catch (e) {}
        });
    }
    if (document.body) {
        fire();
        new MutationObserver(fire).observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', fire);
    }
})();

(function wdexWrapLogout() {
    var original = window.logout;
    if (typeof original !== 'function' || original.__wdex) return;
    var wrapped = function () {
        if (wdexShiftOpenRef) { wdexShiftOpenRef.off(); wdexShiftOpenRef = null; wdexShiftOpenListenerKey = null; }
        wdexLastOpenShift = null;
        var b = document.getElementById('wdex-shift-btn');
        if (b) b.remove();
        var l = document.getElementById('wdex-shiftlog-btn');
        if (l) l.remove();
        var p = document.getElementById('wdex-pos-shift-pill');
        if (p) p.remove();
        var pl = document.getElementById('wdex-pos-shiftlog-btn');
        if (pl) pl.remove();
        return original.apply(this, arguments);
    };
    wrapped.__wdex = true;
    window.logout = wrapped;
})();
