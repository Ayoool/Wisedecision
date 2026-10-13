// ==================== WISE DECISION SUPER ADMIN QR TOGGLE PATCH (v1) ====================
// Load AFTER superadmin-patch.js.
// Adds a "QR Code" column to the Super Admin store directory with an ON/OFF toggle per store.
// Toggle writes to stores/{storeId}/showQR — the QR patch reads it.

console.log("Wise Decision superadmin-qr-toggle-patch.js — v1 loaded");

var waqtStoreQR = {};   // { storeId: true|false }

function waqtEl(id) { return document.getElementById(id); }
function waqtEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Update the toggle button appearance ----------
function waqtUpdateToggleUI(storeId, isOn) {
    var btn = document.querySelector('[data-waqt-store="' + storeId.replace(/"/g, '\\"') + '"]');
    if (!btn) return;
    if (isOn) {
        btn.textContent = 'QR ON';
        btn.style.background = '#16a34a';
        btn.style.color = '#fff';
        btn.style.border = '1px solid #15803d';
    } else {
        btn.textContent = 'QR OFF';
        btn.style.background = '#e2e8f0';
        btn.style.color = '#64748b';
        btn.style.border = '1px solid #cbd5e1';
    }
}

// ---------- Toggle handler ----------
window.waqtToggle = function (btn) {
    var storeId = btn.getAttribute('data-waqt-store');
    if (!storeId) return;
    var current = waqtStoreQR[storeId] !== false;
    var next = !current;

    // Optimistic UI
    waqtStoreQR[storeId] = next;
    waqtUpdateToggleUI(storeId, next);

    // Save
    firebase.database().ref('stores/' + storeId + '/showQR').set(next)
        .catch(function (err) {
            // Revert on failure
            waqtStoreQR[storeId] = current;
            waqtUpdateToggleUI(storeId, current);
            alert('Could not save: ' + (err.message || err));
        });
};

// ---------- Inject header + body cells ----------
function waqtInjectColumn() {
    var tbody = waqtEl('super-admin-stores-body');
    if (!tbody) return;

    // 1) Header cell — add once
    var thead = tbody.parentElement.querySelector('thead tr');
    if (thead && !thead.querySelector('th[data-waqt]')) {
        var th = document.createElement('th');
        th.setAttribute('data-waqt', '1');
        th.setAttribute('style', 'padding: 12px; text-align: center;');
        th.textContent = 'QR Code';
        var existingTh = thead.querySelectorAll('th');
        if (existingTh.length) thead.insertBefore(th, existingTh[existingTh.length - 1]);
        else thead.appendChild(th);
    }

    // 2) Body cells — add to each row
    var rows = tbody.querySelectorAll('tr');
    rows.forEach(function (row) {
        if (row.querySelector('td[data-waqt]')) return;
        var cells = row.querySelectorAll('td');
        if (!cells.length) return;
        var storeId = (cells[0].textContent || '').trim();
        if (!storeId || storeId.toLowerCase().indexOf('loading') !== -1) return;

        var td = document.createElement('td');
        td.setAttribute('data-waqt', '1');
        td.setAttribute('style', 'padding: 12px; text-align: center;');
        var initial = (waqtStoreQR[storeId] !== false) ? 'QR ON' : 'QR OFF';
        var bg = (waqtStoreQR[storeId] !== false) ? '#16a34a' : '#e2e8f0';
        var fg = (waqtStoreQR[storeId] !== false) ? '#fff' : '#64748b';
        td.innerHTML =
            '<button data-waqt-store="' + waqtEsc(storeId) + '" onclick="waqtToggle(this)" ' +
            'style="width: auto; margin: 0; padding: 6px 12px; border-radius: 14px; ' +
            'font-size: 11px; font-weight: bold; cursor: pointer; background:' + bg + '; ' +
            'color:' + fg + '; border: 1px solid #cbd5e1;">' + initial + '</button>';

        if (cells.length >= 2) row.insertBefore(td, cells[cells.length - 1]);
        else row.appendChild(td);
    });
}

// ---------- Load all store QR settings in one read ----------
function waqtLoadAllSettings() {
    firebase.database().ref('stores').once('value').then(function (snap) {
        var stores = snap.val() || {};
        Object.keys(stores).forEach(function (sid) {
            var v = stores[sid].showQR;
            if (v === null || v === undefined) v = true;   // default
            waqtStoreQR[sid] = !!v;
            waqtUpdateToggleUI(sid, !!v);
        });
    }).catch(function () {});
}

// ---------- Watch for dashboard ----------
function waqtAttach() {
    var tbody = waqtEl('super-admin-stores-body');
    if (!tbody) return;
    if (tbody.getAttribute('data-waqt-obs') !== 'true') {
        tbody.setAttribute('data-waqt-obs', 'true');
        var obs = new MutationObserver(function () { waqtInjectColumn(); });
        obs.observe(tbody, { childList: true, subtree: true });
    }
    waqtInjectColumn();
    waqtLoadAllSettings();
}

window.addEventListener('load', function () {
    setInterval(waqtAttach, 1500);
    var obs = new MutationObserver(function () { waqtAttach(); });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
});
