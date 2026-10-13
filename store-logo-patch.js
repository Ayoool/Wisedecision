// ==================== WISE DECISION STORE LOGO PATCH (v2) ====================
// Load AFTER all other patches, just before </body>.
//
// v2: Added a per-store "Show logo on receipts" toggle. Each store owner can
//     keep their logo uploaded but hide it from printed receipts.
//     Default = ON, so existing stores keep their logos.

console.log("Wise Decision store-logo-patch.js — v2 loaded");

// ---------- CONFIG ----------
var WDL_MAX_DIM = 400;
var WDL_QUALITY = 0.85;
var WDL_MAX_BYTES = 150000;

// ---------- HELPERS ----------
function wdlEl(id) { return document.getElementById(id); }
function wdlEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function wdlStore() { return typeof currentStoreId !== 'undefined' ? currentStoreId : null; }
function wdlCanEdit() {
    if (typeof currentUserRole === 'undefined') return true;
    return currentUserRole === 'Admin' || currentUserRole === 'Manager';
}

// ---------- LOGO CACHE ----------
var wdl_logoCache = {};
var wdl_logoLoaded = {};

window.wdGetStoreLogo = function (storeId) {
    storeId = storeId || wdlStore();
    if (!storeId) return Promise.resolve(null);
    if (wdl_logoLoaded[storeId]) return Promise.resolve(wdl_logoCache[storeId] || null);
    return firebase.database().ref('stores/' + storeId + '/logo').once('value')
        .then(function (s) {
            wdl_logoCache[storeId] = s.val() || null;
            wdl_logoLoaded[storeId] = true;
            return wdl_logoCache[storeId];
        })
        .catch(function () { return null; });
};

window.wdSaveStoreLogo = function (dataUrl) {
    var storeId = wdlStore();
    if (!storeId) return Promise.reject(new Error('No store selected.'));
    return firebase.database().ref('stores/' + storeId + '/logo').set(dataUrl)
        .then(function () {
            wdl_logoCache[storeId] = dataUrl;
            wdl_logoLoaded[storeId] = true;
        });
};

window.wdRemoveStoreLogo = function () {
    var storeId = wdlStore();
    if (!storeId) return Promise.reject(new Error('No store selected.'));
    return firebase.database().ref('stores/' + storeId + '/logo').remove()
        .then(function () {
            wdl_logoCache[storeId] = null;
            wdl_logoLoaded[storeId] = true;
        });
};

// ---------- SHOW-LOGO FLAG CACHE ----------
var wdl_showCache = {};     // { storeId: true|false }
var wdl_showLoaded = {};    // { storeId: bool }

window.wdGetShowLogo = function (storeId) {
    storeId = storeId || wdlStore();
    if (!storeId) return Promise.resolve(true);
    if (wdl_showLoaded[storeId]) return Promise.resolve(wdl_showCache[storeId]);
    return firebase.database().ref('stores/' + storeId + '/showLogo').once('value')
        .then(function (s) {
            var v = s.val();
            // Default to TRUE if never set (so existing stores keep their logo)
            if (v === null || v === undefined) v = true;
            wdl_showCache[storeId] = !!v;
            wdl_showLoaded[storeId] = true;
            return wdl_showCache[storeId];
        })
        .catch(function () { return true; });
};

window.wdSaveShowLogo = function (val) {
    var storeId = wdlStore();
    if (!storeId) return Promise.reject(new Error('No store selected.'));
    return firebase.database().ref('stores/' + storeId + '/showLogo').set(!!val)
        .then(function () {
            wdl_showCache[storeId] = !!val;
            wdl_showLoaded[storeId] = true;
        });
};

// ---------- PROCESS FILE ----------
function wdLogoProcessFile(file) {
    return new Promise(function (resolve, reject) {
        if (!file) return reject(new Error('No file selected.'));
        if (!file.type || file.type.indexOf('image/') !== 0) return reject(new Error('Please choose an image file (PNG, JPG, etc).'));
        if (file.size > WDL_MAX_BYTES * 4) return reject(new Error('Image is too large. Please choose a file under 500 KB.'));
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error('Could not read the file.')); };
        reader.onload = function (e) {
            var img = new Image();
            img.onerror = function () { reject(new Error('Could not open the image.')); };
            img.onload = function () {
                try {
                    var w = img.naturalWidth || img.width;
                    var h = img.naturalHeight || img.height;
                    if (!w || !h) return reject(new Error('Image has no dimensions.'));
                    var scale = Math.min(1, WDL_MAX_DIM / Math.max(w, h));
                    var nw = Math.max(1, Math.round(w * scale));
                    var nh = Math.max(1, Math.round(h * scale));
                    var canvas = document.createElement('canvas');
                    canvas.width = nw; canvas.height = nh;
                    var ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, nw, nh);
                    ctx.drawImage(img, 0, 0, nw, nh);
                    var dataUrl = canvas.toDataURL('image/jpeg', WDL_QUALITY);
                    if (dataUrl.length > 200000) dataUrl = canvas.toDataURL('image/jpeg', 0.65);
                    resolve(dataUrl);
                } catch (err) { reject(err); }
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// =====================================================================
// UI: inject the "Store Logo" card into Business Settings
// =====================================================================
function wdLogoInjectSettingsUI() {
    var anchor = wdlEl('settings-store-name');
    if (!anchor) return;
    if (wdlEl('wd-logo-card')) return;

    var profileCard = anchor.closest('.card') || anchor.closest('div[style*="max-width: 600px"]') || anchor.parentNode.parentNode;
    if (!profileCard) return;

    var canEdit = wdlCanEdit();
    var card = document.createElement('div');
    card.id = 'wd-logo-card';
    card.className = profileCard.className || '';
    card.style.cssText = 'max-width: 600px; margin: 20px 0; padding: 25px; background: #ffffff; border-radius: var(--radius); border: 1px solid #eef2f7; box-shadow: 0 6px 18px rgba(15,23,42,0.06);';
    card.innerHTML =
        '<h3 style="margin-top: 0; margin-bottom: 10px; color: #1e293b; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px; font-size: 16px;">🏪 Store Logo</h3>' +
        '<p style="font-size: 12px; color: #64748b; margin: 0 0 14px 0;">Upload your shop logo. It will appear at the top of every receipt. Recommended: square or wide image, at least 200 pixels, white background.</p>' +
        '<div id="wd-logo-preview" style="text-align:center; padding: 20px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:10px; margin-bottom: 12px; min-height: 100px; display:flex; align-items:center; justify-content:center;">' +
            '<span style="color:#94a3b8; font-size: 12px;">No logo uploaded yet</span>' +
        '</div>' +
        (canEdit
            ? '<input type="file" id="wd-logo-file" accept="image/*" style="display:none;" onchange="wdLogoFileSelected(this)">' +
              '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom: 14px;">' +
                '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="document.getElementById(\'wd-logo-file\').click()">📤 Upload Logo</button>' +
                '<button id="wd-logo-remove-btn" class="menu-btn" style="margin:0; width:auto; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; display:none;" onclick="wdLogoRemove()">🗑 Remove</button>' +
              '</div>' +
              '<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:12px;">' +
                '<div style="display:flex; align-items:center; gap:10px;">' +
                  '<input type="checkbox" id="wd-logo-show-toggle" onchange="wdLogoToggleChanged(this.checked)" style="width:18px; height:18px; margin:0; cursor:pointer;">' +
                  '<label for="wd-logo-show-toggle" style="margin:0; font-size:13px; font-weight:bold; color:#1e40af; cursor:pointer;">Show logo on printed receipts</label>' +
                '</div>' +
                '<div style="font-size:11px; color:#1e40af; margin-top:6px;">If turned off, the logo stays saved here but won\'t appear on receipts.</div>' +
              '</div>' +
              '<div id="wd-logo-status" style="font-size: 12px; color:#64748b; margin-top: 8px;"></div>'
            : '<div style="font-size:12px; color:#94a3b8;">Only Admin or Manager can change the logo.</div>');

    if (profileCard.nextSibling) profileCard.parentNode.insertBefore(card, profileCard.nextSibling);
    else profileCard.parentNode.appendChild(card);

    wdLogoRefreshPreview();
}

function wdLogoRefreshPreview() {
    var box = wdlEl('wd-logo-preview');
    if (!box) return;
    var storeId = wdlStore();
    if (!storeId) { box.innerHTML = '<span style="color:#94a3b8; font-size:12px;">No store selected.</span>'; return; }

    Promise.all([window.wdGetStoreLogo(storeId), window.wdGetShowLogo(storeId)]).then(function (res) {
        var dataUrl = res[0], show = res[1];
        var btn = wdlEl('wd-logo-remove-btn');
        var toggle = wdlEl('wd-logo-show-toggle');
        if (dataUrl) {
            box.innerHTML = '<img src="' + dataUrl + '" alt="Logo" style="max-width: 220px; max-height: 120px; object-fit: contain; background:#fff; padding:6px; border-radius:6px; border:1px solid #e2e8f0;">';
            if (btn) btn.style.display = 'inline-block';
        } else {
            box.innerHTML = '<span style="color:#94a3b8; font-size: 12px;">No logo uploaded yet</span>';
            if (btn) btn.style.display = 'none';
        }
        if (toggle) toggle.checked = !!show;
    });
}

window.wdLogoFileSelected = function (input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    var status = wdlEl('wd-logo-status');
    if (status) { status.textContent = 'Processing image...'; status.style.color = '#64748b'; }

    wdLogoProcessFile(file).then(function (dataUrl) {
        if (status) status.textContent = 'Saving...';
        return window.wdSaveStoreLogo(dataUrl);
    }).then(function () {
        // Auto-enable the toggle when a new logo is uploaded
        return window.wdSaveShowLogo(true);
    }).then(function () {
        if (status) { status.textContent = '✅ Logo saved.'; status.style.color = '#16a34a'; }
        wdLogoRefreshPreview();
        input.value = '';
        setTimeout(function () { if (status) status.textContent = ''; }, 2500);
    }).catch(function (err) {
        if (status) { status.textContent = '✕ ' + (err.message || 'Upload failed.'); status.style.color = '#991b1b'; }
    });
};

window.wdLogoToggleChanged = function (checked) {
    var status = wdlEl('wd-logo-status');
    if (status) { status.textContent = checked ? 'Enabling...' : 'Disabling...'; status.style.color = '#64748b'; }
    window.wdSaveShowLogo(!!checked).then(function () {
        if (status) { status.textContent = checked ? '✅ Logo will show on receipts.' : '✅ Logo hidden from receipts.'; status.style.color = '#16a34a'; }
        setTimeout(function () { if (status) status.textContent = ''; }, 2500);
    }).catch(function (err) {
        if (status) { status.textContent = '✕ ' + (err.message || 'Save failed.'); status.style.color = '#991b1b'; }
    });
};

window.wdLogoRemove = function () {
    if (!confirm('Remove the store logo? It will be removed from all future receipts (past receipts already printed are not affected).')) return;
    var status = wdlEl('wd-logo-status');
    if (status) { status.textContent = 'Removing...'; status.style.color = '#64748b'; }
    window.wdRemoveStoreLogo().then(function () {
        if (status) { status.textContent = '✅ Logo removed.'; status.style.color = '#16a34a'; }
        wdLogoRefreshPreview();
        setTimeout(function () { if (status) status.textContent = ''; }, 2500);
    }).catch(function (err) {
        if (status) { status.textContent = '✕ ' + (err.message || 'Remove failed.'); status.style.color = '#991b1b'; }
    });
};

// =====================================================================
// UI: inject logo into every receipt (respecting the showLogo flag)
// =====================================================================
var WDL_RECEIPT_TARGETS = [
    { container: 'printable-receipt-box',      anchor: 'receipt-store-name' },
    { container: 'printable-debt-receipt-box', anchor: 'debt-receipt-store-name' },
    { container: 'printable-refund-receipt-box', anchor: 'refund-receipt-store-name' },
    { container: 'printable-waybill-box',      anchor: null },
    { container: 'wdf-printable',              anchor: 'wdf-r-store' },
    { container: 'wdp-printable',              anchor: 'wdp-r-store' }
];

function wdLogoInjectIntoReceipts() {
    WDL_RECEIPT_TARGETS.forEach(function (t) {
        var cont = wdlEl(t.container);
        if (!cont) return;

        // Check the showLogo flag first
        window.wdGetShowLogo().then(function (show) {
            var existing = cont.querySelector('.wd-receipt-logo');

            if (!show) {
                // Setting is OFF — remove any logo already injected
                if (existing) existing.remove();
                return;
            }

            // Setting is ON
            if (existing) return;   // already injected

            var img = document.createElement('img');
            img.className = 'wd-receipt-logo';
            img.style.cssText = 'display:block; margin: 0 auto 10px auto; max-width: 140px; max-height: 80px; object-fit: contain;';
            img.alt = '';

            if (t.anchor && wdlEl(t.anchor)) {
                var anchor = wdlEl(t.anchor);
                anchor.parentNode.insertBefore(img, anchor);
            } else {
                cont.insertBefore(img, cont.firstChild);
            }

            window.wdGetStoreLogo().then(function (dataUrl) {
                if (dataUrl) img.src = dataUrl;
                else img.remove();
            });
        });
    });
}

// =====================================================================
// INIT
// =====================================================================
function wdLogoAttach() {
    try {
        wdLogoInjectSettingsUI();
        wdLogoInjectIntoReceipts();
    } catch (e) { /* silent */ }
}

window.addEventListener('load', function () {
    setTimeout(wdLogoAttach, 1200);
    var obs = new MutationObserver(function () {
        if (window.__wdLogoSched) return;
        window.__wdLogoSched = true;
        setTimeout(function () {
            window.__wdLogoSched = false;
            wdLogoAttach();
        }, 200);
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
});
