// ==================== WISE DECISION SUPER ADMIN QR TOGGLE PATCH (v3) ====================
// Load AFTER superadmin-patch.js.
//
// v3: Instead of injecting into store cards (fragile), this adds a
//     "📱 QR Codes" button to the Super Admin header. Clicking it opens a
//     modal that lists every store with an easy ON/OFF toggle.
//
//     Toggle writes to stores/{storeId}/showQR — the receipt-qr patch reads it.

console.log("Wise Decision superadmin-qr-toggle-patch.js — v3 loaded");

var waqtModal = null;

function waqtEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Ensure modal container exists ----------
function waqtEnsureModal() {
    if (waqtModal) return waqtModal;
    waqtModal = document.createElement('div');
    waqtModal.id = 'waqt-modal';
    waqtModal.style.cssText =
        'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); ' +
        'justify-content:center; align-items:center; z-index:2500; padding:16px; box-sizing:border-box;';
    document.body.appendChild(waqtModal);
    return waqtModal;
}

// ---------- Close ----------
window.waqtClose = function () {
    if (waqtModal) waqtModal.style.display = 'none';
};

// ---------- Open the QR manager modal ----------
window.waqtOpenManager = function () {
    var m = waqtEnsureModal();
    m.innerHTML =
        '<div style="background:#fff; color:#0f172a; border-radius:14px; width:100%; max-width:520px; max-height:92vh; overflow-y:auto; padding:20px; box-sizing:border-box;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">' +
            '<h3 style="margin:0; font-size:17px;">📱 Receipt QR Codes</h3>' +
            '<button onclick="waqtClose()" style="width:auto; margin:0; padding:6px 12px; border:none; background:#f1f5f9; border-radius:8px; font-size:14px; cursor:pointer;">✕</button>' +
          '</div>' +
          '<p style="font-size:12px; color:#64748b; margin:0 0 14px 0;">Turn the QR code on or off for each store. When off, the store\'s receipts will not include a QR code — saves paper for high-volume stores.</p>' +
          '<div id="waqt-list" style="max-height:60vh; overflow-y:auto;">' +
            '<div style="text-align:center; color:#94a3b8; padding:30px; font-size:13px;">Loading stores...</div>' +
          '</div>' +
          '<div style="margin-top:16px;"><button onclick="waqtClose()" style="width:100%; margin:0; padding:10px; background:#e2e8f0; border:none; border-radius:8px; font-weight:bold; cursor:pointer;">Close</button></div>' +
        '</div>';
    m.style.display = 'flex';
    waqtLoadStores();
};

// ---------- Load all stores and their QR settings ----------
function waqtLoadStores() {
    var list = document.getElementById('waqt-list');
    if (!list) return;

    firebase.database().ref('stores').once('value').then(function (snap) {
        var stores = snap.val() || {};
        var ids = Object.keys(stores);
        if (!ids.length) {
            list.innerHTML = '<div style="text-align:center; color:#94a3b8; padding:30px; font-size:13px;">No stores found.</div>';
            return;
        }

        list.innerHTML = ids.map(function (sid) {
            var s = stores[sid] || {};
            var name = s.businessName || s.name || sid;
            var v = s.showQR;
            var on = (v === null || v === undefined) ? true : !!v;

            var btnBg = on ? '#dcfce7' : '#f1f5f9';
            var btnColor = on ? '#166534' : '#64748b';
            var btnBorder = on ? '#86efac' : '#cbd5e1';
            var btnText = on ? '📱 QR ON' : '📱 QR OFF';

            return '<div style="border:1px solid #e2e8f0; border-radius:10px; padding:12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:10px;">' +
                '<div style="min-width:0; flex:1;">' +
                  '<div style="font-weight:bold; font-size:13px;">' + waqtEsc(name) + '</div>' +
                  '<div style="font-size:11px; color:#64748b;">' + waqtEsc(sid) + (s.phone ? ' · ' + waqtEsc(s.phone) : '') + '</div>' +
                '</div>' +
                '<button data-waqt-sid="' + waqtEsc(sid) + '" onclick="waqtToggleBtn(this)" style="' +
                    'width:auto; margin:0; padding:8px 14px; border-radius:20px; font-size:12px; font-weight:bold; ' +
                    'cursor:pointer; background:' + btnBg + '; color:' + btnColor + '; border:1px solid ' + btnBorder + '; white-space:nowrap;">' +
                    btnText +
                '</button>' +
              '</div>';
        }).join('');
    }).catch(function (err) {
        list.innerHTML = '<div style="text-align:center; color:#991b1b; padding:30px; font-size:13px;">Could not load stores: ' + waqtEsc(err.message || '') + '</div>';
    });
}

// ---------- Toggle one store ----------
window.waqtToggleBtn = function (btn) {
    var sid = btn.getAttribute('data-waqt-sid');
    if (!sid) return;

    var isOnNow = btn.textContent.indexOf('ON') !== -1;
    var next = !isOnNow;

    // Optimistic UI
    waqtApplyButtonState(btn, next);

    firebase.database().ref('stores/' + sid + '/showQR').set(next)
        .catch(function (err) {
            // Revert on failure
            waqtApplyButtonState(btn, isOnNow);
            alert('Could not save: ' + (err.message || err));
        });
};

function waqtApplyButtonState(btn, on) {
    btn.textContent = on ? '📱 QR ON' : '📱 QR OFF';
    btn.style.background = on ? '#dcfce7' : '#f1f5f9';
    btn.style.color = on ? '#166534' : '#64748b';
    btn.style.border = '1px solid ' + (on ? '#86efac' : '#cbd5e1');
}

// ---------- Inject the header button ----------
function waqtInjectHeaderButton() {
    // Already injected?
    if (document.getElementById('waqt-header-btn')) return;

    // Find the "Activation codes" button in the Super Admin header
    var allButtons = document.querySelectorAll('button');
    var anchorBtn = null;
    for (var i = 0; i < allButtons.length; i++) {
        var txt = (allButtons[i].textContent || '').trim();
        if (txt.indexOf('Activation codes') !== -1) { anchorBtn = allButtons[i]; break; }
    }
    if (!anchorBtn) return;

    var btn = document.createElement('button');
    btn.id = 'waqt-header-btn';
    btn.className = anchorBtn.className || 'menu-btn';
    btn.style.cssText = 'width: auto; margin: 0; background: #0ea5e9; color: #fff; border: none; padding: 8px 14px; border-radius: 8px; font-weight: bold; cursor: pointer;';
    btn.textContent = '📱 QR Codes';
    btn.onclick = window.waqtOpenManager;

    // Insert right after Activation codes
    anchorBtn.parentElement.insertBefore(btn, anchorBtn.nextSibling);
}

// ---------- Attach loop ----------
function waqtAttach() {
    try { waqtInjectHeaderButton(); } catch (e) { /* silent */ }
}

window.addEventListener('load', function () {
    setTimeout(waqtAttach, 1200);
    setInterval(waqtAttach, 2000);
    var obs = new MutationObserver(function () {
        if (window.__waqtSched) return;
        window.__waqtSched = true;
        setTimeout(function () {
            window.__waqtSched = false;
            waqtAttach();
        }, 200);
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
});
