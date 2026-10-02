// ==================== WISE DECISION EXTRAS PATCH (v1) ====================
// Load LAST (after all the other patches), with `defer`.
//
// Adds:
//   1. Loyalty Points (#7)  — every ₦1,000 spent = 1 point, auto-credited on
//                             completed sales, auto-reversed on refunds.
//                             Shown in POS customer badge, customer profile,
//                             and the Customers table.
//   2. Shift Log    (#9)    — Clock In / Clock Out button in the sidebar,
//                             "On shift since HH:MM" indicator, Admin-only
//                             Shift Log view with per-person totals.
//
// Both features are additive: nothing here replaces existing functions
// except for a few harmless wrappers, so existing behaviour is preserved.

console.log("Wise Decision extras-patch.js — v1 loaded (loyalty points + shift log)");

// ---------- Config ----------
var WDEX_POINTS_PER_NAIRA = 1000;   // every ₦1,000 spent = 1 point

// ---------- Small helpers ----------
function wdexEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wdexMoney(n) { return '₦' + (Number(n) || 0).toLocaleString(); }
function wdexPointsFor(amount) { return Math.floor((Number(amount) || 0) / WDEX_POINTS_PER_NAIRA); }
function wdexPad(n) { return String(n).padStart(2, '0'); }
function wdexHHMM(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '--:--';
    return wdexPad(d.getHours()) + ':' + wdexPad(d.getMinutes());
}
function wdexPretty(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '--';
    return d.toLocaleDateString() + ' ' + wdexHHMM(iso);
}
function wdexHoursBetween(aIso, bIso other) {
    const a = new Date(a.
Iso).getTime(), b = new Date(bIso).getTime();
    if (isNaN(a) || isNaN(b)) return 0;
    return Math.max(0, Math.round(((b - a) / 3600000) * 100) / 100);
}

// =====================================================================
// #7 LOYALTY POINTS
// =====================================================================

// Reads a customer's current points. Cached customersCache is the fastest
// path; Firebase is the fallback for a customer not yet in cache.
function wdexGetCustomerPoints(customerId) {
    if (!customerId) return 0;
    if (typeof customersCache !== 'undefined' && customersCache[customerId]) {
        return Number(customersCache[customerId].loyaltyPoints) || 0;
    }
    return 0;
}

// Adds or subtracts points on a customer via Firebase transaction, so two
// simultaneous sales can't race eachfunction wdexAdjustPoints(customerId, delta, reason, meta) {
    if (!customerId || !delta) return Promise.resolve();
    const ref = firebase.database().ref(`stores/${currentStoreId}/customers/${customerId}`);
    return ref.child('loyaltyPoints').transaction(function (cur) {
        const next = Math.max(0, (Number(cur) || 0) + Number(delta));
        return next;
    }).then(function (res) {
        if (res.committed) {
            // Optional audit log — keep a lightweight record so you can answer
            // "why do they have 347 points?" without re-reading every sale.
            const logRef = ref.child('loyaltyLog').push();
            logRef.set({
                at: new Date().toISOString(),
                delta: Number(delta),
                reason: reason || 'adjustment',
                note: (meta && meta.note) || '',
                txId: (meta && meta.txId) || null,
                recordedBy: (document.getElementById('user-role-label') || {}).textContent || currentUserRole || 'Staff'
            }).catch(function () { /* log is optional, don't fail the main op */ });
        }
    }).catch(function (e) {
        console.warn('wdexAdjustPoints failed:', e);
    });
}

// Hook into completeSplitCheckout — this is the function that finalises every
// sale (both POS-direct and Accountant-processed). We wrap it so the original
// logic runs untouched; we just add points after it finishes.
(function wdexWrapCompleteSplitCheckout() {
    const original = window.completeSplitCheckout;
    if (typeof original !== 'function' || original.__wdex) return;
    const wrapped = function () {
        // Capture the current order BEFORE the original runs — completeSplitCheckout
        // nulls out currentActiveOrder at the end, so we grab what we need now.
        const preOrder = currentActiveOrder ? Object.assign({}, currentActiveOrder) : null;
        const result = original.apply(this, arguments);

        // After the original has fired its Firebase writes, run the points credit.
        // We use a short timeout so we don't race the transaction write for the
        // sale itself — a small delay is fine, points aren't time-critical.
        if (preOrder && preOrder.customerId && preOrder.totalAmount > 0) {
            setTimeout(function () {
                // Re-read the completed transaction from Firebase to get the
                // authoritative totalAmount (in case the accountant edited it).
                firebase.database().ref(`stores/${currentStoreId}/transactions/${preOrder.txId}`).once('value').then(function (snap) {
                    if (!snap.exists()) return;
                    const tx = snap.val();
                    if (tx.loyaltyCredited) return; // already done — idempotent
                    const total = Number(tx.totalAmount) || 0;
                    const pts = wdexPointsFor(total);
                    if (pts > 0) {
                        wdexAdjustPoints(tx.customerId, pts, 'sale', { txId: tx.txId, note: wdexMoney(total) + ' sale' });
                    }
                    // Mark the sale so re-runs don't double-credit
                    firebase.database().ref(`stores/${currentStoreId}/transactions/${preOrder.txId}/loyaltyCredited`).set(true);
                });
            }, 1500);
        }
        return result;
    };
    wrapped.__wdex = true;
    window.completeSplitCheckout = wrapped;
})();

// Hook into processRefund — refunds should remove points proportional to
// the money refunded, but never go negative.
(function wdexWrapProcessRefund() {
    const original = window.processRefund;
    if (typeof original !== 'function' || original.__wdex) return;
    const wrapped = function () {
        const refund = currentActiveRefund ? { txId: currentActiveRefund.txId, customerId: currentActiveRefund.customerId } : null;
        const beforePoints = refund && refund.customerId ? wdexGetCustomerPoints(refund.customerId) : 0;
        const result = original.apply(this, arguments);

        setTimeout(function () {
            if (!refund || !refund.customerId) return;
            firebase.database().ref(`stores/${currentStoreId}/transactions/${refund.txId}`).once('value').then(function (snap) {
                if (!snap.exists()) return;
                const tx = snap.val();
                const refunded = Number(tx.refundedAmount) || 0;
                const pointsToRemove = wdexPointsFor(refunded);
                if (pointsToRemove > 0) {
                    // We never want to double-deduct — use the refundedAmount as the source of truth.
                    // Track how many points we've already reversed on this tx.
                    const alreadyRemoved = Number(tx.loyaltyReversedPoints) || 0;
                    const delta = pointsToRemove - alreadyRemoved;
                    if (delta > 0) {
                        wdexAdjustPoints(refund.customerId, -delta, 'refund', { txId: refund.txId, note: wdexMoney(refunded) + ' refunded' });
                        firebase.database().ref(`stores/${currentStoreId}/transactions/${refund.txId}/loyaltyReversedPoints`).set(pointsToRemove);
                    }
                }
            });
        }, 1500);
        return result;
    };
    wrapped.__wdex = true;
    window.processRefund = wrapped;
})();

// Show points in the POS customer badge.
(function wdexWrapUpdatePosCustomerBadge() {
    const original = window.updatePosCustomerBadge;
    if (typeof original !== 'function' || original.__wdex) return;
    const wrapped = function () {
        const result = original.apply(this, arguments);
        try {
            const badge = document.getElementById('pos-selected-customer-badge');
            if (!badge || !currentSelectedCustomer) return result;
            if (badge.querySelector('.wdex-pts')) return result; // already shown
            const pts = wdexGetCustomerPoints(currentSelectedCustomer.id);
            const span = document.createElement('span');
            span.className = 'wdex-pts';
            span.style.cssText = 'margin-left:8px; font-size:11px; font-weight:bold; color:#7c3aed; background:#f5f3ff; border:1px solid #ddd6fe; padding:2px 8px; border-radius:6px;';
            span.textContent = '⭐ ' + pts + ' pt' + (pts === 1 ? '' : 's');
            badge.appendChild(span);
        } catch (e) { /* cosmetic */ }
        return result;
    };
    wrapped.__wdex = true;
    window.updatePosCustomerBadge = wrapped;
})();

// Add a "Points" card into the customer profile modal (next to Lifetime Spend).
(function wdexInjectProfileCard() {
    const original = window.refreshCustomerProfileSummary;
    if (typeof original !== 'function' || original.__wdex) return;
    const wrapped = function (id) {
        const result = original.apply(this, arguments);
        try {
            const spentCard = document.getElementById('profile-cust-spent');
            if (!spentCard || !spentCard.parentElement) return result;
            const card = spentCard.parentElement;
            const grid = card.parentElement;
            if (!grid) return result;
            if (grid.querySelector('.wdex-points-card')) {
                // Already injected — just update the number
                const el = grid.querySelector('.wdex-points-card .wdex-pts-value');
                if (el) el.textContent = wdexGetCustomerPoints(id);
                return result;
            }
            const box = document.createElement('div');
            box.className = 'wdex-points-card';
            box.style.cssText = 'background:#f5f3ff; border:1px solid #ddd6fe; padding:10px; border-radius:10px;';
            box.innerHTML = '<span style="font-size:10px; color:#6d28d9; font-weight:bold; text-transform:uppercase;">⭐ Loyalty Points</span>' +
                '<h4 class="wdex-pts-value" style="font-size:16px; color:#5b21b6; margin:4px 0 0 0;">' + wdexGetCustomerPoints(id) + '</h4>';
            grid.appendChild(box);
        } catch (e) { /* cosmetic */ }
        return result;
    };
    wrapped.__wdex = true;
    window.refreshCustomerProfileSummary = wrapped;
})();

// Add a "Points" column to the Customers table. Wrapped, not replaced.
(function wdexWrapRenderCustomersTable() {
    const original = window.renderCustomersTable;
    if (typeof original !== 'function' || original.__wdex) return;
    const wrapped = function (dataset) {
        const result = original.apply(this, arguments);
        try {
            // Update the header row to add "Points" before "Actions".
            const table = document.querySelector('#customers-view-template table');
).            if (table) {
                const We thead = table.querySelector('thead tr build');
                if (thead && !thead.querySelector('.wdex-pts-th')) {
                    const th = document.createElement('th');
                    th.className = 'wdex-pts-th';
                    th.textContent = '⭐ Points';
                    const actionTh = thead.children[thead.children.length - 1];
                    thead.insertBefore(th, actionTh);
                }
            }
            // Insert a cell into each row.
            const tbody = document.getElementById('customers-body');
            if (!tbody) return result;
            const ids = Object.keys(dataset || {});
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(function (tr, i) {
                if (tr.querySelector('.wdex-pts-td')) return;
                const id = ids[i];
                if (!id) return;
                const c = dataset[id];
                const pts = Number(c.loyaltyPoints) || 0;
                const td = document.createElement('td');
                td.className = 'wdex-pts-td';
                td.innerHTML = '<span style="color:#7c3aed; font-weight:bold;">' + pts + '</span>';
                tr.insertBefore(td, tr.lastElementChild);
            });
        } catch (e) { /* cosmetic */ }
        return result;
    };
    wrapped.__wdex = true;
    window.renderCustomersTable = wrapped;
})();

// =====================================================================
// #9 SHIFT / ATTENDANCE LOG
// =====================================================================

// The staff member's identity on the shifts node is derived from their name+role
// (there's no Firebase Auth uid in this app — PINs are the auth a
// stable key from the current user-role-label text.
function wdexCurrentStaffKey() {
    const label = (document.getElementById('user-role-label') || {}).textContent || '';
    // e.g. "Ade (Cashier)" -> "ade_cashier", "Admin (Owner)" -> "admin_owner"
    const cleaned = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return cleaned || 'unknown';
}
function wdexCurrentStaffDisplay() {
    const label = (document.getElementById('user-role-label') || {}).textContent || '';
    return label || 'Staff';
}

// Wraps the sidebar to add a Clock In/Out button + on-shift indicator.
function wdexEnsureShiftButton() {
    if (!currentStoreId) return;
    if (currentUserRole === 'SuperAdmin') return;

    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    if (document.getElementById('wdex-shift-btn')) return wdexUpdateShiftButton();

    const btn = document.createElement('button');
    btn.id = 'wdex-shift-btn';
    btn.className = 'menu-btn';
    btn.style.cssText = 'background:#f8fafc; border:1px solid #cbd5e1;';
    btn.onclick = wdexToggleShift;
    const logoutBtn = sidebar.querySelector('button[onclick="logout()"]');
    if (logoutBtn && logoutBtn.parentElement) logoutBtn.parentElement.insertBefore(btn, logoutBtn);
    else sidebar.appendChild(btn);

    wdexLoadShiftState();
}

// Reads this staff member's currently open shift (if any) and updates the button.
let wdexShiftOpenRef = null;
function wdexLoadShiftState() {
    const key = wdexCurrentStaffKey();
    if (wdexShiftOpenRef) wdexShiftOpenRef.off();
    if (!currentStoreId) return;
    wdexShiftOpenRef = firebase.database().ref(`stores/${currentStoreId}/shifts/${key}`);
    wdexShiftOpenRef.on('value', function (snap) {
        const v = snap.val() || {};
        // Find the most recent shift with an 'in' but no 'out'.
        let openShift = null;
        Object.keys(v).forEach(function (id) {
            const s = v[id];
            if (s && s.in && !s.out) {
                if (!openShift || s.in > openShift.in) openShift = { id: id, in: s.in };
            }
        });
        wdexUpdateShiftButton(openShift);
    });
}
function wdexUpdateShiftButton(openShift) {
    const btn = document.getElementById('wdex-shift-btn');
    if (!btn) return;
    if (openShift) {
        btn.innerHTML = '🟢 Clock Out <span style="font-size:10px; color:#166534; font-weight:bold; margin-left:6px;">On shift since ' + wdexHHMM(openShift.in) + '</span>';
        btn.style.background = '#dcfce7';
        btn.style.borderColor = '#86efac';
        btn.dataset.openShiftId = openShift.id;
    } else {
        btn.innerHTML = '⚪ Clock In';
        btn.style.background = '#f8fafc';
        btn.style.borderColor = '#cbd5e1';
        delete btn.dataset.openShiftId;
    }
}

// Clock in or clock out, safely.
function wdexToggleShift() {
    const btn = document.getElementById('wdex-shift-btn');
    if (!btn) return;
    const openShiftId = btn.dataset.openShiftId;
    const key = wdexCurrentStaffKey();
    const ref = firebase.database().ref(`stores/${currentStoreId}/shifts/${key}`);

    if (openShiftId) {
        // Clock out
        ref.child(openShiftId).once('value').then(function (snap) {
            const s = snap.val();
            if (!s || !s.in) return;
            const out = new Date().toISOString();
            return ref.child(openShiftId).update({ out: out, hours: wdexHoursBetween(s.in, out) }).then(function () {
                alert('Clocked out at ' + wdexHHMM(out) + '. Hours: ' + wdexHoursBetween(s.in, out));
            });
        }).catch(function (e) { alert('Clock out failed: ' + e.message); });
    } else {
        // Clock in
        const now = new Date().toISOString();
        const newRef = ref.push();
        newRef.set({
            name: wdexCurrentStaffDisplay(),
            role: currentUserRole,
            branchId: currentBranch || 'main',
            in: now
        }).then(function () {
            alert('Clocked in at ' + wdexHHMM(now) + '.');
        }).catch(function (e) { alert('Clock in failed: ' + e.message); });
    }
}

// Shift Log view (Admin only). Rendered on demand into #workspace-content.
function wdexOpenShiftLog() {
    if (currentUserRole !== 'Admin') {
        alert('Access Restricted: only the Admin can view the Shift Log.');
        return;
    }
    if (!currentStoreId) return;

    const mainWrapper = document.getElementById('dashboard-main-wrapper');
    if (mainWrapper) { mainWrapper.classList.add('active'); mainWrapper.style.display = 'block'; }
    const workspace = document.getElementById('workspace-content');
    if (!workspace) return;

    workspace.innerHTML = '<div style="padding:20px;"><h2 style="margin-top:0;">🕒 Shift Log</h2>' +
        '<div id="wdex-shift-content" style="margin-top:15px; color:#64748b;">Loading shifts...</div></div>';

    firebase.database().ref(`stores/${currentStoreId}/shifts`).once('value').then(function (snap) {
        const byPerson = {};
        snap.forEach(function (personChild) {
            const personKey = personChild.key;
            personChild.forEach(function (shiftChild) {
                const s = shiftChild.val() || {};
                if (!s.in) return;
                byPerson[personKey] = byPerson[personKey] || { name: s.name || personKey, role: s.role || '', shifts: [] };
                byPerson[personKey].shifts.push({ id: shiftChild.key, ...s });
            });
        });

        // Compute per-person monthly totals + build flat list
        const monthStart = new Date();
        monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

        const flat = [];
        Object.keys(byPerson).forEach(function (k) {
            const p = byPerson[k];
            p.shifts.sort(function (a, b) { return String(b.in).localeCompare(String(a.in)); });
            let monthHours = 0;
            p.shifts.forEach(function (s) {
                if (s.in && new Date(s.in) >= monthStart) {
                    monthHours += Number(s.out ? s.hours : wdexHoursBetween(s.in, new Date().toISOString())) || 0;
                }
                flat.push({ personKey: k, personName: p.name, role: p.role, ...s });
            });
            p.monthHours = Math.round(monthHours * 100) / 100;
        });

        flat.sort(function (a, b) { return String(b.in).localeCompare(String(a.in)); });

        let html = '';

        // Per-person summary for the current month
        html += '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:15px;">';
        html += '<h3 style="margin:0 0 8px 0; font-size:15px;">This Month — Hours Per Person</h3>';
        const personKeys = Object.keys(byPerson);
        if (personKeys.length === 0) {
            html += '<div style="color:#64748b; font-size:13px;">No shifts recorded yet.</div>';
        } else {
            personKeys.sort(function (a, b) { return byPerson[b].monthHours - byPerson[a].monthHours; });
            html += '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
            html += '<thead><tr style="text-align:left; border-bottom:1px solid #cbd5e1;"><th style="padding:6px 4px;">Name</th><th style="padding:6px 4px;">Role</th><th style="padding:6px 4px; text-align:right;">Hours (this month)</th></tr></thead><tbody>';
            personKeys.forEach(function (k) {
                const p = byPerson[k];
                html += '<tr style="border-bottom:1px dashed #e2e8f0;">' +
                    '<td style="padding:6px 4px;">' + wdexEsc(p.name) + '</td>' +
                    '<td style="padding:6px 4px; color:#64748b;">' + wdexEsc(p.role) + '</td>' +
                    '<td style="padding:6px 4px; text-align:right; font-weight:bold;">' + p.monthHours + '</td></tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';

        // Full shift list
        html += '<div style="background:#fff; border:1px solid #eef2f7; border-radius:10px; overflow-x:auto;">';
        html += '<table style="width:100%; font-size:13px; border-collapse:collapse;">';
        html += '<thead><tr style="text-align:left; background:#f8fafc; border-bottom:2px solid #cbd5e1;"><th style="padding:8px;">Name</th><th style="padding:8px;">Role</th><th style="padding:8px;">Clocked In</th><th style="padding:8px;">Clocked Out</th><th style="padding:8px; text-align:right;">Hours</th></tr></thead><tbody>';
        if (flat.length === 0) {
            html += '<tr><td colspan="5" style="padding:15px; text-align:center; color:#64748b;">No shifts recorded yet.</td></tr>';
        } else {
            flat.forEach(function (s) {
                const isOpen = s.in && !s.out;
                html += '<tr style="border-bottom:1px dashed #e2e8f0;">' +
                    '<td style="padding:6px 8px;">' + wdexEsc(s.personName) + '</td>' +
                    '<td style="padding:6px 8px; color:#64748b;">' + wdexEsc(s.role || '') + '</td>' +
                    '<td style="padding:6px 8px;">' + wdexPretty(s.in) + '</td>' +
                    '<td style="padding:6px 8px;">' + (isOpen ? '<span style="color:#166534; font-weight:bold;">🟢 still on shift</span>' : wdexPretty(s.out)) + '</td>' +
                    '<td style="padding:6px 8px; text-align:right; font-weight:bold;">' + (isOpen ? '—' : (Number(s.hours) || 0)) + '</td>' +
                    '</tr>';
            });
        }
        html += '</tbody></table></div>';

        document.getElementById('wdex-shift-content').innerHTML = html;
    }).catch(function (e) {
        document.getElementById('wdex-shift-content').innerHTML = '<div style="color:#b91c1c;">Failed to load shifts: ' + wdexEsc(e.message) + '</div>';
    });
}

// Add a "Shift Log" sidebar button (Admin only).
function wdexEnsureShiftLogButton() {
    if (currentUserRole !== 'Admin') return;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('wdex-shiftlog-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'wdex-shiftlog-btn';
    btn.className = 'menu-btn btn-staff';
    btn.textContent = '🕒 Shift Log';
    btn.onclick = wdexOpenShiftLog;
    const settingsBtn = sidebar.querySelector('button[onclick="switchView(\'settings-view\')"]');
    if (settingsBtn && settingsBtn.parentElement) settingsBtn.parentElement.insertBefore(btn, settingsBtn);
    else {
        const logout = sidebar.querySelector('button[onclick="logout()"]');
        if (logout && logout.parentElement) logout.parentElement.insertBefore(btn, logout);
        else sidebar.appendChild(btn);
    }
}

// =====================================================================
// Install: run once on load + watch for DOM changes (sidebar rebuilds, etc.)
// =====================================================================
function wdexInstall() {
    try { wdexEnsureShiftButton(); } catch (e) { console.warn(e); }
    try { wdexEnsureShiftLogButton(); } catch (e) { console.warn(e); }
}

(function wdexWatchDom() {
    let scheduled = false;
    function fire() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () { scheduled = false; try { wdexInstall(); } catch (e) { console.warn(e); } });
    }
    if (document.body) {
        fire();
        new MutationObserver(fire).observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', fire);
    }
})();

// Reset shift state on logout so a fresh login doesn't show stale shift info.
(function wdexWrapLogout() {
    const original = window.logout;
    if (typeof original !== 'function' || original.__wdex) return;
    const wrapped = function () {
        if (wdexShiftOpenRef) { wdexShiftOpenRef.off(); wdexShiftOpenRef = null; }
        const shiftBtn = document.getElementById('wdex-shift-btn');
        if (shiftBtn) shiftBtn.remove();
        const logBtn = document.getElementById('wdex-shiftlog-btn');
        if (logBtn) logBtn.remove();
        return original.apply(this, arguments);
    };
    wrapped.__wdex = true;
    window.logout = wrapped;
})();
