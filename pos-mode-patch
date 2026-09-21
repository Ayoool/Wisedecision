// ==================== WISE DECISION POS MODE PATCH (v31) ====================
// Load LAST (after all the other patches), with `defer`.
//
// Lets a store choose how payment is taken:
//   • "With an Accountant" (default, exactly as before): staff send orders to the Accountant.
//   • "At the till": no accountant needed — staff take payment and print the receipt
//     straight from the POS with a 💳 Pay & Print Receipt button.
// Admin and Accountant always get the Pay & Print button. The choice is saved per store
// (Business Settings → "How do you take payment?") and applies to every device of that store.

console.log("Wise Decision pos-mode-patch.js — v31 loaded");

var wdpMode = 'accountant';      // 'accountant' | 'direct'
var wdpLoadedFor = null;

// Which buttons should this person see at the POS?
function wdpPolicy(mode, role) {
    var privileged = role === 'Admin' || role === 'Accountant';
    var direct = mode === 'direct';
    return {
        showPay: direct || privileged,
        showSend: !direct && role !== 'Accountant'
    };
}

function wdpPayAtTill() {
    if (typeof processDirectPosPayment === 'function') processDirectPosPayment();
}

// ---------- POS screen ----------
function wdpApplyToPos() {
    var ws = document.getElementById('workspace-content');
    if (!ws) return;
    var sendBtn = ws.querySelector('button[onclick="submitOrderForAccountant()"]');
    if (!sendBtn) return;                                   // not the POS screen

    var p = wdpPolicy(wdpMode, currentUserRole);
    sendBtn.style.display = p.showSend ? '' : 'none';

    var pay = document.getElementById('wdp-pay-btn');
    if (p.showPay) {
        if (!pay) {
            pay = document.createElement('button');
            pay.id = 'wdp-pay-btn';
            pay.className = 'menu-btn btn-action-primary';
            pay.style.cssText = 'width:100%; justify-content:center; margin:0 0 10px 0; padding:14px; font-size:15px;';
            pay.textContent = '💳 Pay & Print Receipt 🖨';
            pay.onclick = wdpPayAtTill;
            var row = sendBtn.parentElement;
            row.parentElement.insertBefore(pay, row);
        }
        pay.style.display = '';
    } else if (pay) {
        pay.style.display = 'none';
    }
}

// ---------- Business Settings (Admin only) ----------
function wdpApplyToSettings() {
    if (currentUserRole !== 'Admin') return;
    var ws = document.getElementById('workspace-content');
    if (!ws || !document.getElementById('settings-store-name')) return;   // not the settings screen

    var card = document.getElementById('wdp-settings-card');
    if (!card) {
        card = document.createElement('div');
        card.id = 'wdp-settings-card';
        card.style.cssText = 'max-width:600px; margin:20px 0; padding:25px; background:#ffffff; border-radius:8px; border:1px solid #e2e8f0; box-shadow:0 4px 6px rgba(0,0,0,0.02);';
        card.innerHTML =
            '<h3 style="margin-top:0; margin-bottom:14px; color:#1e293b; border-bottom:2px solid #f1f5f9; padding-bottom:10px; font-size:16px;">💳 How do you take payment?</h3>' +
            '<label style="display:flex; gap:10px; align-items:flex-start; margin-bottom:12px; cursor:pointer;">' +
                '<input type="radio" name="wdp-mode" value="accountant" style="margin-top:4px;">' +
                '<span><strong>With an Accountant</strong><br><small style="color:#64748b;">Cashiers send each order to the Accountant, who takes the payment and prints the receipt.</small></span></label>' +
            '<label style="display:flex; gap:10px; align-items:flex-start; margin-bottom:14px; cursor:pointer;">' +
                '<input type="radio" name="wdp-mode" value="direct" style="margin-top:4px;">' +
                '<span><strong>At the till (no accountant)</strong><br><small style="color:#64748b;">Staff take the payment and print the receipt themselves, right from the POS.</small></span></label>' +
            '<button class="menu-btn btn-action-primary" style="justify-content:center;" onclick="wdpSaveMode()">Save</button>';
        ws.appendChild(card);
    }
    var radios = card.querySelectorAll('input[name="wdp-mode"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = (radios[i].value === wdpMode);
}

function wdpSaveMode() {
    if (currentUserRole !== 'Admin' || !currentStoreId) return;
    var mode = 'accountant';
    var radios = document.querySelectorAll('input[name="wdp-mode"]');
    for (var i = 0; i < radios.length; i++) if (radios[i].checked) mode = radios[i].value === 'direct' ? 'direct' : 'accountant';

    firebase.database().ref('stores/' + currentStoreId + '/settings/posMode').set(mode).then(function () {
        wdpMode = mode;
        try { localStorage.setItem('wd_posmode_' + currentStoreId, mode); } catch (e) {}
        alert(mode === 'direct'
            ? "Saved. Staff at this store now take payment and print receipts right from the POS."
            : "Saved. Staff at this store now send orders to the Accountant.");
    }).catch(function (e) { alert("Could not save: " + e.message); });
}

// ---------- Load the store's choice (live, and remembered for offline) ----------
function wdpLoadMode() {
    if (!currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
    var sid = currentStoreId;
    try { var cached = localStorage.getItem('wd_posmode_' + sid); if (cached === 'direct' || cached === 'accountant') wdpMode = cached; } catch (e) {}
    try {
        firebase.database().ref('stores/' + sid + '/settings/posMode').on('value', function (snap) {
            if (sid !== currentStoreId) return;
            wdpMode = snap.val() === 'direct' ? 'direct' : 'accountant';
            try { localStorage.setItem('wd_posmode_' + sid, wdpMode); } catch (e) {}
            wdpApplyToPos();
            wdpApplyToSettings();
        }, function () { /* offline or not allowed: keep the remembered choice */ });
    } catch (e) { /* keep default */ }
    wdpApplyToPos();
}

(function hookNavigation() {
    var prev = window.switchView;
    window.switchView = function (viewId) {
        var result = prev.apply(this, arguments);
        try {
            if (viewId === 'login-view') {
                wdpLoadedFor = null;
                wdpMode = 'accountant';
            } else if (currentStoreId && currentStoreId !== 'SUPER_ADMIN' && viewId !== 'register-view') {
                if (wdpLoadedFor !== currentStoreId) { wdpLoadedFor = currentStoreId; wdpLoadMode(); }
                if (viewId === 'pos-view') wdpApplyToPos();
                if (viewId === 'settings-view') wdpApplyToSettings();
            }
        } catch (e) { /* never block navigation */ }
        return result;
    };
})();

// ---------- After a sale, "Back" returns to the POS (staff can't open Reports) ----------
(function hookReceiptButtons() {
    var prev = window.renderReceiptView;
    if (typeof prev !== 'function') return;
    window.renderReceiptView = function (orderData, isReprint) {
        var result = prev.apply(this, arguments);
        setTimeout(function () {
            try {
                var canSeeReports = currentUserRole === 'Admin' || currentUserRole === 'Accountant';
                var btn = document.querySelector('#workspace-content button[onclick*="reports-view"]');
                if (btn && (!isReprint || !canSeeReports)) {
                    btn.textContent = '🔙 Back to POS';
                    btn.setAttribute('onclick', "switchView('pos-view')");
                }
            } catch (e) { /* cosmetic only */ }
        }, 30);
        return result;
    };
})();
