// ==================== WISE DECISION CUSTOM CATEGORIES PATCH (v1) ====================
// Load AFTER fashion-reserve-patch.js, BEFORE fashion-barcode-patch.js
//
// Lets Admin/Manager add, edit, and delete their own product categories (e.g. Perfumes,
// Hijabs, Kids Toys). Custom categories live in Firebase so every device sees them.
//
// Data lives here:
//   fashionCategories/{storeId}/{categoryId} = {
//     id, icon, sizes: [], custom: true, createdBy, createdAt, updatedAt
//   }

console.log("Wise Decision categories-patch.js — v1 loaded");

// ---------- helpers ----------
function wdcEl(id) { return document.getElementById(id); }
function wdcVal(id) { var e = wdcEl(id); return e ? String(e.value || '').trim() : ''; }
function wdcEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function wdcCanManage() { return typeof wdfIsAdmin === 'function' ? (wdfIsAdmin() || wdfIsManager()) : true; }
function wdcIsAdmin() { return typeof wdfIsAdmin === 'function' ? wdfIsAdmin() : true; }
function wdcUser() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
function wdcNow() { return new Date().toISOString(); }

// ---------- state ----------
var wdcCustom = {};   // { [id]: { icon, sizes, custom:true } }
var wdcRef = null, wdcOn = false;

function wdcStart() {
    if (wdcOn) return;
    wdcOn = true;
    wdcRef = firebase.database().ref('fashionCategories/' + currentStoreId);
    wdcRef.on('value', function (s) {
        wdcCustom = s.val() || {};
        wdfApplyCategories();
    }, function () {});
}
function wdcStop() {
    if (wdcRef) { try { wdcRef.off(); } catch (e) {} }
    wdcRef = null; wdcOn = false; wdcCustom = {};
}
window.wdcCustomCategories = function () { return wdcCustom; };

// ---------- merge built-ins with custom ----------
// This is what the whole app will now call instead of reading WDF_CATEGORIES directly.
window.wdfAllCategories = function () {
    var builtins = (typeof WDF_CATEGORIES !== 'undefined') ? WDF_CATEGORIES.slice() : [];
    var builtinIds = {};
    builtins.forEach(function (c) { builtinIds[c.id.toLowerCase()] = true; });
    var custom = Object.keys(wdcCustom).map(function (k) {
        var c = wdcCustom[k] || {};
        return {
            id: c.id || k,
            icon: c.icon || '🏷️',
            sizes: Array.isArray(c.sizes) && c.sizes.length ? c.sizes : ['One size'],
            custom: true
        };
    }).filter(function (c) { return !builtinIds[c.id.toLowerCase()]; });
    return builtins.concat(custom);
};

// Look up a single category across both built-in and custom.
window.wdfCat = function (id) {
    var all = window.wdfAllCategories();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    // Fallback: return a made-up "Other" category so nothing crashes
    return { id: id || 'Other', icon: '🏷️', sizes: ['One size'] };
};

// Rebuild all category dropdowns in the DOM if they're currently rendered.
window.wdfApplyCategories = function () {
    try {
        // Add/Edit Item modal — category dropdown
        var sel = wdcEl('wdf-i-cat');
        if (sel) {
            var cur = sel.value;
            sel.innerHTML = window.wdfAllCategories().map(function (c) {
                return '<option value="' + wdcEsc(c.id) + '">' + c.icon + ' ' + wdcEsc(c.id) + '</option>';
            }).join('');
            if (cur) sel.value = cur;
            if (typeof window.wdfCategoryChanged === 'function') window.wdfCategoryChanged();
        }
        // Stock screen filter dropdown
        var stockCat = wdcEl('wdf-cat');
        if (stockCat) {
            var curStock = stockCat.value;
            stockCat.innerHTML = '<option value="">All categories</option>' +
                window.wdfAllCategories().map(function (c) {
                    return '<option value="' + wdcEsc(c.id) + '">' + c.icon + ' ' + wdcEsc(c.id) + '</option>';
                }).join('');
            if (curStock) stockCat.value = curStock;
        }
        // Sell screen filter dropdown
        var sellCat = wdcEl('wdf-s-cat');
        if (sellCat) {
            var curSell = sellCat.value;
            sellCat.innerHTML = '<option value="">All</option>' +
                window.wdfAllCategories().map(function (c) {
                    return '<option value="' + wdcEsc(c.id) + '">' + c.icon + ' ' + wdcEsc(c.id) + '</option>';
                }).join('');
            if (curSell) sellCat.value = curSell;
        }
        // Re-render stock list so icons update
        if (typeof window.wdfRenderStock === 'function' && wdcEl('wdf-stock-body')) window.wdfRenderStock();
        if (typeof window.wdfRenderSellResults === 'function' && wdcEl('wdf-sell-results')) window.wdfRenderSellResults();
    } catch (e) { console.warn('[categories]', e); }
};

// ---------- inject a "Manage Categories" button on the Fashion dashboard ----------
function wdcInjectManageButton() {
    if (!wdcCanManage()) return;
    var addBtn = document.querySelector('button[onclick="wdfOpenItemModal()"]');
    if (!addBtn) return;
    if (wdcEl('wdc-manage-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'wdc-manage-btn';
    btn.className = 'menu-btn';
    btn.style.cssText = 'width:auto; margin:0; padding:8px 14px; font-weight:bold; font-size:12px; background:#f5f3ff; border:1px solid #ddd6fe; color:#6d28d9;';
    btn.textContent = '🏷 Categories';
    btn.onclick = window.wdcOpenManager;
    addBtn.parentNode.insertBefore(btn, addBtn.nextSibling);
}

// ---------- main manager modal ----------
window.wdcOpenManager = function () {
    if (!wdcCanManage()) { alert('Only Admin or Manager can manage categories.'); return; }
    var builtins = (typeof WDF_CATEGORIES !== 'undefined') ? WDF_CATEGORIES.slice() : [];
    var custom = Object.keys(wdcCustom).map(function (k) { return Object.assign({ _id: k }, wdcCustom[k]); });

    var builtinRows = builtins.map(function (c) {
        return '<div style="display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid #f1f5f9;">' +
            '<div><strong style="font-size:13px;">' + c.icon + ' ' + wdcEsc(c.id) + '</strong>' +
            '<div style="font-size:11px; color:#64748b;">' + (c.sizes || []).length + ' size option' + ((c.sizes || []).length === 1 ? '' : 's') + ' · built-in</div></div>' +
            '<span style="font-size:10px; font-weight:bold; color:#64748b; background:#f1f5f9; padding:3px 8px; border-radius:6px;">LOCKED</span>' +
        '</div>';
    }).join('');

    var customRows = custom.length ? custom.map(function (c) {
        return '<div style="display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid #f1f5f9;">' +
            '<div><strong style="font-size:13px;">' + (c.icon || '🏷️') + ' ' + wdcEsc(c.id) + '</strong>' +
            '<div style="font-size:11px; color:#64748b;">' + (c.sizes || []).length + ' size option' + ((c.sizes || []).length === 1 ? '' : 's') + ' · custom</div></div>' +
            '<div style="display:flex; gap:6px;">' +
                '<button class="menu-btn" style="width:auto; margin:0; padding:5px 10px; font-size:11px; background:#eff6ff; border:1px solid #bfdbfe; color:#1d4ed8;" onclick="wdcOpenEdit(\'' + wdcEsc(c._id) + '\')">Edit</button>' +
                '<button class="menu-btn" style="width:auto; margin:0; padding:5px 10px; font-size:11px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdcDelete(\'' + wdcEsc(c._id) + '\')">Delete</button>' +
            '</div>' +
        '</div>';
    }).join('') : '<div style="color:#94a3b8; font-size:12px; padding:14px; text-align:center;">No custom categories yet.</div>';

    var html =
        '<div style="font-size:12px; color:#64748b; margin-bottom:10px;">Built-in categories cover common boutique items. Add your own for anything else — perfumes, hijabs, kids toys, phone accessories, and so on.</div>' +
        '<div style="margin-bottom:16px;">' +
            '<div style="font-size:12px; font-weight:bold; color:#334155; margin-bottom:6px;">Built-in</div>' +
            '<div style="background:#f8fafc; border:1px solid #eef2f7; border-radius:10px; padding:6px 12px;">' + builtinRows + '</div>' +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">' +
            '<div style="font-size:12px; font-weight:bold; color:#334155;">Your custom categories</div>' +
            '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:6px 12px; font-size:11px;" onclick="wdcOpenAdd()">+ Add Category</button>' +
        '</div>' +
        '<div style="background:#fff; border:1px solid #eef2f7; border-radius:10px; padding:6px 12px;">' + customRows + '</div>' +
        '<div style="margin-top:14px;"><button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdfCloseModal()">Close</button></div>';

    wdfModal('🏷 Manage Categories', html, 560);
};

// ---------- add ----------
window.wdcOpenAdd = function () {
    var html =
        '<label style="' + WDF_LBL + '">Category Name *</label>' +
        '<input id="wdc-name" type="text" placeholder="e.g. Perfumes, Hijabs, Kids Toys" style="' + WDF_INP + '">' +
        '<label style="' + WDF_LBL + '">Icon (emoji, optional)</label>' +
        '<input id="wdc-icon" type="text" placeholder="e.g. 🧴" maxlength="4" style="' + WDF_INP + '">' +
        '<div style="font-size:11px; color:#64748b; margin-top:4px;">Pick any emoji: 🧴 👒 🧸 💄 🎩 👞 💍 🎀 🧣 🕶️ 👝</div>' +
        '<label style="' + WDF_LBL + '">Size Options (comma separated)</label>' +
        '<input id="wdc-sizes" type="text" placeholder="e.g. 30ml, 50ml, 100ml" style="' + WDF_INP + '">' +
        '<div style="font-size:11px; color:#64748b; margin-top:4px;">Leave blank to use just "One size". You can edit these later.</div>' +
        '<div id="wdc-err" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>' +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdcSaveNew()">Add Category</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdcOpenManager()">Back</button>' +
        '</div>';
    wdfModal('+ Add Custom Category', html, 480);
};

window.wdcSaveNew = async function () {
    var fail = function (m) { var e = wdcEl('wdc-err'); if (e) { e.textContent = m; e.style.display = 'block'; } };
    var rawName = wdcVal('wdc-name');
    if (!rawName) return fail('Enter a category name.');
    // Normalise id: keep letters/digits/spaces, trim, Title Case for display consistency
    var id = rawName.replace(/\s+/g, ' ').trim();
    if (id.length > 40) return fail('Name is too long (max 40 characters).');

    // Prevent collisions with built-in names
    var builtinIds = ((typeof WDF_CATEGORIES !== 'undefined') ? WDF_CATEGORIES : []).map(function (c) { return c.id.toLowerCase(); });
    if (builtinIds.indexOf(id.toLowerCase()) !== -1) return fail('"' + id + '" is already a built-in category.');

    // Prevent duplicate custom
    if (wdcCustom[id]) return fail('You already have a category named "' + id + '".');

    var icon = wdcVal('wdc-icon') || '🏷️';
    var sizesRaw = wdcVal('wdc-sizes');
    var sizes = sizesRaw ? sizesRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : ['One size'];
    // De-dupe sizes, preserving order
    var seen = {}, uniq = [];
    sizes.forEach(function (s) { var k = s.toLowerCase(); if (!seen[k]) { seen[k] = true; uniq.push(s); } });

    try {
        await firebase.database().ref('fashionCategories/' + currentStoreId + '/' + id).set({
            id: id, icon: icon, sizes: uniq, custom: true,
            createdBy: wdcUser(), createdAt: wdcNow()
        });
        alert('✅ Category "' + id + '" added.');
        wdcOpenManager();
    } catch (e) { fail('Could not save: ' + (e.message || e)); }
};

// ---------- edit ----------
window.wdcOpenEdit = function (id) {
    var c = wdcCustom[id]; if (!c) return;
    var html =
        '<label style="' + WDF_LBL + '">Category Name</label>' +
        '<input id="wdc-name" type="text" value="' + wdcEsc(c.id || id) + '" disabled style="' + WDF_INP + ' background:#f1f5f9; color:#64748b;">' +
        '<div style="font-size:11px; color:#64748b; margin-top:4px;">The name cannot be changed because existing items reference it. You can change the icon and sizes.</div>' +
        '<label style="' + WDF_LBL + '">Icon (emoji)</label>' +
        '<input id="wdc-icon" type="text" value="' + wdcEsc(c.icon || '') + '" maxlength="4" placeholder="e.g. 🧴" style="' + WDF_INP + '">' +
        '<label style="' + WDF_LBL + '">Size Options (comma separated)</label>' +
        '<input id="wdc-sizes" type="text" value="' + wdcEsc((c.sizes || []).join(', ')) + '" style="' + WDF_INP + '">' +
        '<div id="wdc-err" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>' +
        '<div style="display:flex; gap:10px; margin-top:16px;">' +
            '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdcSaveEdit(\'' + wdcEsc(id) + '\')">Save Changes</button>' +
            '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdcOpenManager()">Back</button>' +
        '</div>';
    wdfModal('✏️ Edit Category', html, 480);
};

window.wdcSaveEdit = async function (id) {
    var fail = function (m) { var e = wdcEl('wdc-err'); if (e) { e.textContent = m; e.style.display = 'block'; } };
    var icon = wdcVal('wdc-icon') || '🏷️';
    var sizesRaw = wdcVal('wdc-sizes');
    var sizes = sizesRaw ? sizesRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : ['One size'];
    if (!sizes.length) return fail('At least one size option is required.');
    try {
        await firebase.database().ref('fashionCategories/' + currentStoreId + '/' + id).update({
            icon: icon, sizes: sizes, updatedAt: wdcNow(), updatedBy: wdcUser()
        });
        alert('✅ Saved.');
        wdcOpenManager();
    } catch (e) { fail('Could not save: ' + (e.message || e)); }
};

// ---------- delete ----------
window.wdcDelete = async function (id) {
    if (!wdcIsAdmin()) { alert('Only the Admin can delete categories.'); return; }
    // Warn if items in this category exist
    var used = 0;
    if (typeof wdfItemList === 'function') {
        wdfItemList().forEach(function (it) { if (it.category === id) used++; });
    }
    var msg = 'Delete category "' + id + '"?';
    if (used > 0) msg += '\n\n⚠ ' + used + ' existing item' + (used === 1 ? '' : 's') + ' still use this category. They will keep their category label but will show "Other" styling until re-categorised.';
    if (!confirm(msg)) return;
    try {
        await firebase.database().ref('fashionCategories/' + currentStoreId + '/' + id).remove();
        alert('✅ Deleted.');
        wdcOpenManager();
    } catch (e) { alert('Could not delete: ' + (e.message || e)); }
};

// ---------- attach: start listening when store type is fashion ----------
function wdcAttach() {
    if (typeof wdfStoreType === 'undefined' || wdfStoreType !== 'fashion') { wdcStop(); return; }
    wdcStart();
    // Wait for the Fashion dashboard button to exist, then inject ours
    wdcInjectManageButton();
}
setInterval(wdcAttach, 1500);
