// ==================== WISE DECISION SUPER ADMIN QR TOGGLE PATCH (v2) ====================
// Load AFTER superadmin-patch.js.
//
// v2: Works with the CARD layout of the Super Admin dashboard (not a table).
//     Injects a "📱 QR ON / QR OFF" button next to the Lock and PIN buttons
//     on each store card. Toggle writes to stores/{storeId}/showQR.

console.log("Wise Decision superadmin-qr-toggle-patch.js — v2 loaded");

var waqtStoreQR = {};   // { storeId: true|false }

function waqtEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- Update the button appearance after a toggle ----------
function waqtUpdateToggleUI(storeId, isOn) {
    var btns = document.querySelectorAll('[data-waqt-store="' + storeId.replace(/"/g, '\\"') + '"]');
    btns.forEach(function (btn) {
        if (isOn) {
            btn.textContent = '📱 QR ON';
            btn.style.background = '#dcfce7';
            btn.style.color = '#166534';
            btn.style.border = '1px solid #86efac';
            btn.title = 'QR code is currently ON — click to turn off';
        } else {
            btn.textContent = '📱 QR OFF';
            btn.style.background = '#f1f5f9';
            btn.style.color = '#64748b';
            btn.style.border = '1px solid #cbd5e1';
            btn.title = 'QR code is currently OFF — click to turn on';
        }
    });
}

// ---------- Toggle handler ----------
window.waqtToggle = function (btn) {
    var storeId = btn.getAttribute('data-waqt-store');
    if (!storeId) return;

    var current = (waqtStoreQR[storeId] !== false);
    var next = !current;

    // Optimistic UI
    waqtStoreQR[storeId] = next;
    waqtUpdateToggleUI(storeId, next);

    firebase.database().ref('stores/' + storeId + '/showQR').set(next)
        .catch(function (err) {
            // Revert on failure
            waqtStoreQR[storeId] = current;
            waqtUpdateToggleUI(storeId, current);
            alert('Could not save: ' + (err.message || err));
        });
};

// ---------- Extract the store ID from a card ----------
function waqtGetStoreIdFromCard(card) {
    // Cards typically contain a line like "medstar · 09132564109, ..."
    var text = card.textContent || '';
    var m = text.match(/(?:^|\s)([a-z][a-z0-9_-]{2,})\s*·/);
    if (m) return m[1];

    // Fallback: look for any element with a data-store attribute
    var withData = card.querySelector('[data-store]');
    if (withData) return withData.getAttribute('data-store');

    return null;
}

// ---------- Inject one button per store card ----------
function waqtInjectButtons() {
    // Find every button whose text is "Lock" or "PIN" — these mark store cards
    var allButtons = document.querySelectorAll('button');
    allButtons.forEach(function (btn) {
        var txt = (btn.textContent || '').trim().toLowerCase();
        // We look for the "Lock" button specifically (it's on every store card)
        if (txt.indexOf('lock') === -1) return;
        if (btn.getAttribute('data-waqt-anchor')) return;

        // Walk up to find the card container (rounded border, shadow)
        var card = btn;
        while (card && card.parentElement) {
            var style = card.getAttribute && card.getAttribute('style') || '';
            if (style.indexOf('border-radius') !== -1 && style.indexOf('box-shadow') !== -1) break;
            card = card.parentElement;
        }
        if (!card || !card.parentElement) return;

        var storeId = waqtGetStoreIdFromCard(card);
        if (!storeId) return;

        // Skip if this card already has a QR button
        if (card.querySelector('[data-waqt-store]')) {
            btn.setAttribute('data-waqt-anchor', '1');
            return;
        }

        // Build the QR button matching Lock/PIN button style
        var qrBtn = document.createElement('button');
        qrBtn.setAttribute('data-waqt-store', storeId);
        qrBtn.onclick = function () { waqtToggle(qrBtn); };
        qrBtn.style.cssText =
            'width: auto; margin: 0 0 0 4px; padding: 6px 12px; border-radius: 8px; ' +
            'font-size: 12px; font-weight: bold; cursor: pointer; ' +
            'background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1;';
        qrBtn.textContent = '📱 QR ...';   // placeholder until state loads

        // Insert right after the Lock button
        btn.parentElement.insertBefore(qrBtn, btn.nextSibling);
        btn.setAttribute('data-waqt-anchor', '1');

        // Load the current state from Firebase
        firebase.database().ref('stores/' + storeId + '/showQR').once('value')
            .then(function (snap) {
                var v = snap.val();
                if (v === null || v === undefined) v = true;   // default ON
                waqtStoreQR[storeId] = !!v;
                waqtUpdateToggleUI(storeId, !!v);
            })
            .catch(function () {
                waqtStoreQR[storeId] = true;
                waqtUpdateToggleUI(storeId, true);
            });
    });
}

// ---------- Attach (runs continuously since cards re-render) ----------
function waqtAttach() {
    try { waqtInjectButtons(); } catch (e) { /* silent */ }
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
