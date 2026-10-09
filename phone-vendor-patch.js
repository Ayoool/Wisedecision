// ==================== WISE DECISION PHONE VENDOR DASHBOARD (v1) ====================
// Load LAST, after payments-patch.js and every other patch.
//
// STAGE 1 — Store type selection + Phone Inventory + Add Phone + Bulk paste + Dashboard
//
// Adds a completely separate dashboard for phone vendors. Nothing in the existing
// grocery/pharmacy code is touched. All phone data lives under phoneInventory/{storeId}/...
//
// Sidebar switches automatically based on stores/{storeId}/storeType.
// Super Admin can override from the store row.

console.log("Wise Decision phone-vendor-patch.js — v1 loaded");

// =====================================================================
// MONEY FORMATTER — future-proof, so we can add other currencies later
// =====================================================================
window.WDV_CURRENCY = window.WDV_CURRENCY || { symbol: '₦', code: 'NGN' };
window.formatMoney = window.formatMoney || function (n) {
    const num = Number(n) || 0;
    return window.WDV_CURRENCY.symbol + (Math.round(num * 100) / 100).toLocaleString();
};

// =====================================================================
// STORE TYPES — the list shown at registration
// =====================================================================
var WDV_STORE_TYPES = [
    { id: 'general',    label: '🛒 Retail / Provision Store',  dashboard: 'general' },
    { id: 'phone_vendor', label: '📱 Phone Vendor / Phone Shop', dashboard: 'phone_vendor' },
    { id: 'pharmacy',   label: '💊 Pharmacy / Chemist',        dashboard: 'general' },
    { id: 'restaurant', label: '🍽️ Restaurant / Food',         dashboard: 'general' },
    { id: 'fashion',    label: '👕 Fashion / Boutique',        dashboard: 'general' },
    { id: 'hardware',   label: '🏗️ Hardware / Building',       dashboard: 'general' },
    { id: 'stationery', label: '📚 Stationery / Bookshop',     dashboard: 'general' },
    { id: 'water',      label: '💧 Water / Drinks Distributor',dashboard: 'general' },
    { id: 'cosmetics',  label: '🎨 Cosmetics Shop',            dashboard: 'general' },
    { id: 'other',      label: '➕ Other (tell us your type)',  dashboard: 'general' }
];

var WDV_PHONE_BRANDS = ['Samsung','Apple','Tecno','Infinix','itel','Xiaomi','Redmi','Oppo','Vivo','Nokia','Huawei','Google Pixel','OnePlus','Realme','Other'];
var WDV_STORAGE_OPTIONS = ['16GB','32GB','64GB','128GB','256GB','512GB','1TB','Other'];
var WDV_CONDITIONS = ['New','UK Used','Refurbished'];

// =====================================================================
// HELPERS
// =====================================================================
function wdvEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function wdvNum(n) { return Number(n) || 0; }
function wdvMoney(n) { return window.formatMoney(n); }
function wdvPad(n) { return String(n).padStart(2,'0'); }
function wdvToday() { const d = new Date(); return d.getFullYear() + '-' + wdvPad(d.getMonth()+1) + '-' + wdvPad(d.getDate()); }
function wdvNow() { return new Date().toISOString(); }
function wdvDaysBetween(a, b) {
    const d1 = new Date(a), d2 = new Date(b);
    if (isNaN(d1) || isNaN(d2)) return 0;
    return Math.round((d2 - d1) / 86400000);
}
function wdvProfitPct(cost, sell) {
    const c = wdvNum(cost);
    if (c <= 0) return 0;
    return ((wdvNum(sell) - c) / c) * 100;
}
function wdvProfitColor(pct) {
    if (pct >= 15) return { bg:'#dcfce7', fg:'#166534' };   // green
    if (pct >= 8)  return { bg:'#fef3c7', fg:'#92400e' };   // amber
    return { bg:'#fee2e2', fg:'#991b1b' };                  // red
}
function wdvStatusChip(status) {
    const m = {
        in_stock: ['#dcfce7', '#166534', 'IN STOCK'],
        sold:     ['#e0e7ff', '#3730a3', 'SOLD'],
        reserved: ['#fef3c7', '#92400e', 'RESERVED'],
        returned: ['#fee2e2', '#991b1b', 'RETURNED']
    }[status] || ['#e2e8f0', '#334155', String(status||'').toUpperCase()];
    return '<span style="background:'+m[0]+'; color:'+m[1]+'; font-size:10px; font-weight:bold; padding:3px 9px; border-radius:10px;">'+m[2]+'</span>';
}

// =====================================================================
// STATE
// =====================================================================
var wdvPhones = {};       // cached phones for current store
var wdvStoreType = null;  // 'general' | 'phone_vendor' | ...
var wdvBusinessType = null; // actual business type id (may differ from dashboard)
var wdvListenerAttached = false;

// =====================================================================
// WHAT DASHBOARD SHOULD BE SHOWN FOR THIS STORE?
// =====================================================================
function wdvGetDashboardForStore() {
    // phone_vendor storeType is the only one that switches to the phone dashboard today.
    // Later, restaurant/fashion/etc. can each get their own dashboard.
    if (wdvStoreType === 'phone_vendor') return 'phone_vendor';
    return 'general';
}

// =====================================================================
// REGISTRATION — inject store type selector into the register form
// =====================================================================
function wdvInjectRegistrationSelector() {
    var form = document.querySelector('#register-view .auth-card');
    if (!form) return;
    if (form.querySelector('#reg-store-type-selector')) return;   // already there

    var existing = form.querySelector('#reg-store-id');
    if (!existing) return;

    var block = document.createElement('div');
    block.id = 'reg-store-type-selector';
    block.className = 'form-group';
    block.style.marginTop = '4px';
    block.innerHTML =
        '<label style="font-weight:700; color:#334155; font-size:13px; margin-bottom:6px; display:block;">What type of business do you run?</label>' +
        '<select id="reg-store-type" style="width:100%; padding:13px 14px; font-size:14px; border-radius:10px; border:1px solid #cbd5e1; background:#f8fafc; box-sizing:border-box;" onchange="wdvOnRegTypeChange()">' +
        WDV_STORE_TYPES.map(function(t){ return '<option value="'+t.id+'">'+t.label+'</option>'; }).join('') +
        '</select>' +
        '<input type="text" id="reg-store-type-other" placeholder="e.g. Bookshop, Vet store, Betting shop..." style="display:none; width:100%; padding:13px 14px; font-size:14px; border-radius:10px; border:1px solid #cbd5e1; background:#f8fafc; box-sizing:border-box; margin-top:8px;">';

    // Insert right after the "Store ID" field's form-group
    var storeIdGroup = existing.closest('.form-group');
    if (storeIdGroup && storeIdGroup.parentNode) {
        storeIdGroup.parentNode.insertBefore(block, storeIdGroup.nextSibling);
    } else {
        form.appendChild(block);
    }
}

window.wdvOnRegTypeChange = function () {
    var sel = document.getElementById('reg-store-type');
    var other = document.getElementById('reg-store-type-other');
    if (!sel || !other) return;
    other.style.display = sel.value === 'other' ? 'block' : 'none';
};

// =====================================================================
// REGISTER HOOK — capture the store type on registration
// =====================================================================
window.addEventListener('load', function () {
    if (typeof window.registerBusinessAccount === 'function' && !window.__wdvRegisterHooked) {
        window.__wdvRegisterHooked = true;
        var origRegister = window.registerBusinessAccount;
        window.registerBusinessAccount = async function () {
            var sel = document.getElementById('reg-store-type');
            var other = document.getElementById('reg-store-type-other');
            var type = sel ? sel.value : 'general';
            if (type === 'other' && other && other.value.trim()) {
                type = 'other:' + other.value.trim();
            }
            // Stash the choice so we can write it after the original function saves the store
            window.__wdvPendingStoreType = type;
            var result = await origRegister.apply(this, arguments);
            // After the original register finishes, patch the store with the chosen type
            try {
                var sid = (typeof currentStoreId !== 'undefined' && currentStoreId)
                    ? currentStoreId
                    : (document.getElementById('reg-store-id') ? document.getElementById('reg-store-id').value.trim().toLowerCase() : '');
                if (sid && window.__wdvPendingStoreType) {
                    await firebase.database().ref('stores/' + sid + '/storeType').set(window.__wdvPendingStoreType);
                }
            } catch (e) { console.warn('[phone-vendor] could not save store type:', e); }
            window.__wdvPendingStoreType = null;
            return result;
        };
    }
});

// =====================================================================
// SIDEBAR SWITCHER — show/hide buttons based on dashboard type
// =====================================================================
function wdvApplySidebar() {
    var dashboard = wdvGetDashboardForStore();
    var side = document.querySelector('#dashboard-main-wrapper .sidebar');
    if (!side) return;

    // Buttons to hide when phone vendor
    var posBtn = null, invBtn = null;
    side.querySelectorAll('button').forEach(function (b) {
        var t = (b.textContent || '').trim();
        if (t.indexOf('POS Sales') !== -1) posBtn = b;
        if (t.indexOf('Inventory') !== -1 && t.indexOf('Phone') === -1) invBtn = b;
    });

    var phoneBtn = document.getElementById('wdv-sidebar-phone-btn');
    var isPhoneVendor = (dashboard === 'phone_vendor');
    var isAdmin = (typeof currentUserRole !== 'undefined') && currentUserRole === 'Admin'
                  && (typeof currentStoreId !== 'undefined') && currentStoreId && currentStoreId !== 'SUPER_ADMIN';

    if (isPhoneVendor && isAdmin) {
        // Hide grocery buttons
        if (posBtn) posBtn.style.display = 'none';
        if (invBtn) invBtn.style.display = 'none';

        // Show phone button
        if (!phoneBtn) {
            var b = document.createElement('button');
            b.id = 'wdv-sidebar-phone-btn';
            b.className = 'menu-btn btn-phone';
            b.textContent = '📱 Phone Sales';
            b.onclick = function () { wdvShowInventory(); };
            // Insert after Dashboard button
            var dashBtn = null;
            side.querySelectorAll('button').forEach(function(x){ if ((x.textContent||'').indexOf('Dashboard') !== -1 && !dashBtn) dashBtn = x; });
            if (dashBtn && dashBtn.nextSibling) side.insertBefore(b, dashBtn.nextSibling);
            else side.appendChild(b);
        }
    } else {
        // Restore grocery buttons
        if (posBtn) posBtn.style.display = '';
        if (invBtn) invBtn.style.display = '';
        if (phoneBtn) phoneBtn.remove();
    }
}

// =====================================================================
// PHONE INVENTORY VIEW
// =====================================================================
window.wdvShowInventory = function () {
    var ws = document.getElementById('workspace-content');
    if (!ws) return;

    ws.innerHTML =
        '<h2 style="margin:0 0 8px 0;">📱 Phone Inventory</h2>' +
        '<p style="font-size:13px; color:var(--text-muted); margin:0 0 16px 0;">Every phone is tracked individually by IMEI. Cost, selling price and profit are shown for each device.</p>' +

        // Dead stock + capital locked banner
        '<div id="wdv-summary-cards" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:16px;">' +
          '<div style="background:linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%); border:1px solid #a7f3d0; padding:14px; border-radius:12px;">' +
            '<span style="font-size:11px; color:#047857; font-weight:bold; text-transform:uppercase;">Profit Today</span>' +
            '<h3 id="wdv-card-profit-today" style="font-size:20px; color:#065f46; margin:6px 0 0 0;">₦0</h3>' +
          '</div>' +
          '<div style="background:linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%); border:1px solid #bfdbfe; padding:14px; border-radius:12px;">' +
            '<span style="font-size:11px; color:#1e40af; font-weight:bold; text-transform:uppercase;">Profit This Month</span>' +
            '<h3 id="wdv-card-profit-month" style="font-size:20px; color:#1d4ed8; margin:6px 0 0 0;">₦0</h3>' +
          '</div>' +
          '<div style="background:linear-gradient(135deg,#fef2f2 0%,#fee2e2 100%); border:1px solid #fecaca; padding:14px; border-radius:12px;">' +
            '<span style="font-size:11px; color:#991b1b; font-weight:bold; text-transform:uppercase;">Capital Locked</span>' +
            '<h3 id="wdv-card-capital" style="font-size:20px; color:#b91c1c; margin:6px 0 0 0;">₦0</h3>' +
            '<span style="font-size:10px; color:#7f1d1d;" id="wdv-card-capital-note">in unsold phones</span>' +
          '</div>' +
          '<div style="background:linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%); border:1px solid #fde68a; padding:14px; border-radius:12px;">' +
            '<span style="font-size:11px; color:#92400e; font-weight:bold; text-transform:uppercase;">Dead Stock</span>' +
            '<h3 id="wdv-card-dead" style="font-size:20px; color:#92400e; margin:6px 0 0 0;">0</h3>' +
            '<span style="font-size:10px; color:#78350f;" id="wdv-card-dead-note">phones >30 days</span>' +
          '</div>' +
        '</div>' +

        // Toolbar
        '<div style="background:#fff; padding:14px; border-radius:12px; border:1px solid #eef2f7; margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; box-shadow:0 6px 18px rgba(15,23,42,0.04);">' +
          '<input type="text" id="wdv-search" placeholder="🔍 Search by IMEI, brand or model..." oninput="wdvRenderInventory()" style="flex:1; min-width:220px; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;">' +
          '<select id="wdv-filter-brand" onchange="wdvRenderInventory()" style="padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;">' +
            '<option value="">All brands</option>' +
            WDV_PHONE_BRANDS.map(function(b){ return '<option value="'+wdvEsc(b)+'">'+wdvEsc(b)+'</option>'; }).join('') +
          '</select>' +
          '<select id="wdv-filter-status" onchange="wdvRenderInventory()" style="padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px;">' +
            '<option value="in_stock">In stock only</option>' +
            '<option value="">All statuses</option>' +
            '<option value="sold">Sold</option>' +
            '<option value="reserved">Reserved</option>' +
            '<option value="returned">Returned</option>' +
          '</select>' +
          '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:10px 16px;" onclick="wdvOpenAddPhoneModal()">+ Add Phone</button>' +
          '<button class="menu-btn" style="width:auto; margin:0; padding:10px 16px; background:#e2e8f0; border:1px solid #cbd5e1;" onclick="wdvOpenBulkModal()">📋 Bulk Add</button>' +
        '</div>' +

        // Table
        '<div style="background:#fff; border-radius:12px; border:1px solid #eef2f7; overflow-x:auto; box-shadow:0 6px 18px rgba(15,23,42,0.04);">' +
          '<table style="width:100%; border-collapse:collapse; font-size:13px;">' +
            '<thead><tr style="background:#f8fafc; border-bottom:2px solid #cbd5e1; color:#475569;">' +
              '<th style="padding:10px; text-align:left;">IMEI</th>' +
              '<th style="padding:10px; text-align:left;">Brand / Model</th>' +
              '<th style="padding:10px; text-align:left;">Spec</th>' +
              '<th style="padding:10px; text-align:left;">Condition</th>' +
              '<th style="padding:10px; text-align:right;">Cost</th>' +
              '<th style="padding:10px; text-align:right;">Selling</th>' +
              '<th style="padding:10px; text-align:right;">Profit</th>' +
              '<th style="padding:10px; text-align:center;">Status</th>' +
              '<th style="padding:10px; text-align:right;">Days</th>' +
              '<th style="padding:10px; text-align:center;">Actions</th>' +
            '</tr></thead>' +
            '<tbody id="wdv-table-body"><tr><td colspan="10" style="text-align:center; color:#94a3b8; padding:30px;">Loading phones...</td></tr></tbody>' +
          '</table>' +
        '</div>';

    wdvLoadPhones().then(function () {
        wdvRenderInventory();
        wdvRenderSummary();
    });
};

// =====================================================================
// LOAD PHONES FROM FIREBASE
// =====================================================================
async function wdvLoadPhones() {
    return new Promise(function (resolve) {
        if (!currentStoreId) { resolve(); return; }
        try {
            firebase.database().ref('phoneInventory/' + currentStoreId).on('value', function (snap) {
                wdvPhones = snap.val() || {};
                if (document.getElementById('wdv-table-body')) {
                    wdvRenderInventory();
                    wdvRenderSummary();
                }
                resolve();
            }, function () { resolve(); });
            wdvListenerAttached = true;
        } catch (e) { resolve(); }
    });
}

// =====================================================================
// RENDER TABLE
// =====================================================================
window.wdvRenderInventory = function () {
    var tbody = document.getElementById('wdv-table-body');
    if (!tbody) return;

    var q = (document.getElementById('wdv-search')?.value || '').toLowerCase().trim();
    var fBrand = document.getElementById('wdv-filter-brand')?.value || '';
    var fStatus = document.getElementById('wdv-filter-status')?.value || '';

    var rows = Object.keys(wdvPhones).map(function (id) {
        return Object.assign({}, wdvPhones[id], { _id: id });
    });

    rows = rows.filter(function (p) {
        if (fBrand && p.brand !== fBrand) return false;
        if (fStatus && p.status !== fStatus) return false;
        if (q) {
            var hay = ((p.imei||'') + ' ' + (p.imei2||'') + ' ' + (p.brand||'') + ' ' + (p.model||'') + ' ' + (p.storage||'') + ' ' + (p.color||'')).toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    });

    // Sort: in stock first, then most recent
    rows.sort(function (a, b) {
        if (a.status !== b.status) {
            if (a.status === 'in_stock') return -1;
            if (b.status === 'in_stock') return 1;
        }
        return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
    });

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:#94a3b8; padding:30px;">No phones match. Click "+ Add Phone" to add your first phone.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(function (p) {
        var profit = wdvNum(p.sellingPrice) - wdvNum(p.costPrice);
        var pct = wdvProfitPct(p.costPrice, p.sellingPrice);
        var pc = wdvProfitColor(pct);
        var days = p.createdAt ? wdvDaysBetween(p.createdAt, wdvNow()) : 0;
        var daysColor = days > 60 ? '#b91c1c' : (days > 30 ? '#92400e' : '#475569');
        var spec = [p.storage, p.color].filter(Boolean).join(' · ');
        return '<tr style="border-bottom:1px solid #f1f5f9;">' +
            '<td style="padding:10px; font-family:monospace; font-size:12px; cursor:pointer;" title="Click to copy" onclick="wdvCopyIMEI(this, \''+wdvEsc(p.imei||'')+'\')">'+wdvEsc(p.imei||'—')+'</td>' +
            '<td style="padding:10px;"><strong>'+wdvEsc(p.brand||'')+'</strong> '+wdvEsc(p.model||'')+'</td>' +
            '<td style="padding:10px; color:#64748b; font-size:12px;">'+wdvEsc(spec||'—')+'</td>' +
            '<td style="padding:10px; font-size:12px;">'+wdvEsc(p.condition||'—')+'</td>' +
            '<td style="padding:10px; text-align:right;">'+wdvMoney(p.costPrice)+'</td>' +
            '<td style="padding:10px; text-align:right;">'+wdvMoney(p.sellingPrice)+'</td>' +
            '<td style="padding:10px; text-align:right;"><span style="background:'+pc.bg+'; color:'+pc.fg+'; padding:3px 8px; border-radius:6px; font-weight:bold; font-size:12px;">'+wdvMoney(profit)+' ('+pct.toFixed(0)+'%)</span></td>' +
            '<td style="padding:10px; text-align:center;">'+wdvStatusChip(p.status)+'</td>' +
            '<td style="padding:10px; text-align:right; color:'+daysColor+'; font-weight:bold;">'+days+'</td>' +
            '<td style="padding:10px; text-align:center; white-space:nowrap;">' +
              '<button class="menu-btn" style="width:auto; margin:0; padding:4px 8px; font-size:11px; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdvEditPhone(\''+wdvEsc(p._id)+'\')">Edit</button> ' +
              '<button class="menu-btn" style="width:auto; margin:0; padding:4px 8px; font-size:11px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;" onclick="wdvDeletePhone(\''+wdvEsc(p._id)+'\')">Del</button>' +
            '</td>' +
        '</tr>';
    }).join('');
};

window.wdvCopyIMEI = function (el, imei) {
    if (!imei) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(imei).then(function () {
            var old = el.textContent;
            el.textContent = '✓ Copied';
            setTimeout(function(){ el.textContent = old; }, 1000);
        });
    }
};

// =====================================================================
// RENDER SUMMARY CARDS (profit, capital, dead stock)
// =====================================================================
window.wdvRenderSummary = function () {
    var all = Object.keys(wdvPhones).map(function(id){ return wdvPhones[id]; });
    var today = wdvToday();
    var thisMonth = today.substring(0, 7);

    var profitToday = 0, profitMonth = 0, capital = 0, dead = 0;
    all.forEach(function (p) {
        if (p.status === 'sold' && p.soldTo) {
            var profit = wdvNum(p.soldTo.soldPrice) - wdvNum(p.costPrice);
            var soldDate = (p.soldTo.soldDate || '').substring(0, 10);
            if (soldDate === today) profitToday += profit;
            if (soldDate.substring(0, 7) === thisMonth) profitMonth += profit;
        }
        if (p.status === 'in_stock') {
            capital += wdvNum(p.costPrice);
            var days = p.createdAt ? wdvDaysBetween(p.createdAt, wdvNow()) : 0;
            if (days > 30) dead++;
        }
    });

    var setText = function (id, val) { var e = document.getElementById(id); if (e) e.textContent = val; };
    setText('wdv-card-profit-today', wdvMoney(profitToday));
    setText('wdv-card-profit-month', wdvMoney(profitMonth));
    setText('wdv-card-capital', wdvMoney(capital));
    setText('wdv-card-dead', dead);
};

// =====================================================================
// ADD PHONE MODAL
// =====================================================================
window.wdvOpenAddPhoneModal = function (editId) {
    var editing = editId && wdvPhones[editId] ? wdvPhones[editId] : null;
    var title = editing ? '✏️ Edit Phone' : '📱 Add Phone';

    var inp = 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;';
    var lbl = 'display:block; font-size:11px; font-weight:bold; color:#334155; margin-bottom:4px; margin-top:10px; text-transform:uppercase; letter-spacing:0.5px;';

    var html =
        '<div style="text-align:center; font-size:15px; font-weight:bold; margin-bottom:12px;">'+title+'</div>' +
        '<label style="'+lbl+'">IMEI 1 * (required, unique)</label>' +
        '<input id="wdv-f-imei" type="text" value="'+wdvEsc(editing?.imei||'')+'" placeholder="e.g. 356938035643809" style="'+inp+'" autocomplete="off">' +
        '<div style="font-size:11px; color:#64748b; margin-top:4px;">Dial *#06# on the phone to see its IMEI</div>' +

        '<label style="'+lbl+'">IMEI 2 (optional, dual SIM)</label>' +
        '<input id="wdv-f-imei2" type="text" value="'+wdvEsc(editing?.imei2||'')+'" placeholder="Leave blank if single SIM" style="'+inp+'">' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
          '<div><label style="'+lbl+'">Brand</label>' +
            '<select id="wdv-f-brand" style="'+inp+'">' +
              WDV_PHONE_BRANDS.map(function(b){ return '<option'+(editing?.brand===b?' selected':'')+'>'+b+'</option>'; }).join('') +
            '</select></div>' +
          '<div><label style="'+lbl+'">Condition</label>' +
            '<select id="wdv-f-condition" style="'+inp+'">' +
              WDV_CONDITIONS.map(function(c){ return '<option'+(editing?.condition===c?' selected':'')+'>'+c+'</option>'; }).join('') +
            '</select></div>' +
        '</div>' +

        '<label style="'+lbl+'">Model</label>' +
        '<input id="wdv-f-model" type="text" value="'+wdvEsc(editing?.model||'')+'" placeholder="e.g. Galaxy A15, iPhone 11" style="'+inp+'">' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
          '<div><label style="'+lbl+'">Storage</label>' +
            '<select id="wdv-f-storage" style="'+inp+'">' +
              WDV_STORAGE_OPTIONS.map(function(s){ return '<option'+(editing?.storage===s?' selected':'')+'>'+s+'</option>'; }).join('') +
            '</select></div>' +
          '<div><label style="'+lbl+'">Color</label>' +
            '<input id="wdv-f-color" type="text" value="'+wdvEsc(editing?.color||'')+'" placeholder="e.g. Blue" style="'+inp+'"></div>' +
        '</div>' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
          '<div><label style="'+lbl+'">Cost Price (₦)</label>' +
            '<input id="wdv-f-cost" type="number" value="'+(editing?.costPrice||'')+'" placeholder="e.g. 185000" style="'+inp+'"></div>' +
          '<div><label style="'+lbl+'">Selling Price (₦)</label>' +
            '<input id="wdv-f-sell" type="number" value="'+(editing?.sellingPrice||'')+'" placeholder="e.g. 215000" style="'+inp+'"></div>' +
        '</div>' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
          '<div><label style="'+lbl+'">Purchase Date</label>' +
            '<input id="wdv-f-date" type="date" value="'+wdvEsc(editing?.purchaseDate||wdvToday())+'" style="'+inp+'"></div>' +
          '<div><label style="'+lbl+'">Warranty (months)</label>' +
            '<select id="wdv-f-warranty" style="'+inp+'">' +
              [0,3,6,12,24].map(function(m){ return '<option value="'+m+'"'+(editing?.warrantyMonths===m?' selected':'')+'>'+(m===0?'No warranty':m+' months')+'</option>'; }).join('') +
            '</select></div>' +
        '</div>' +

        '<label style="'+lbl+'">Notes (optional)</label>' +
        '<textarea id="wdv-f-notes" rows="2" placeholder="e.g. Came with charger, sealed box" style="'+inp+'">'+wdvEsc(editing?.notes||'')+'</textarea>' +

        '<div id="wdv-add-error" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>' +

        '<div style="display:flex; gap:10px; margin-top:16px;">' +
          '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdvSavePhone('+(editing?'\''+wdvEsc(editId)+'\'':'null')+')">'+ (editing?'Save Changes':'Add Phone') +'</button>' +
          '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdvCloseModal()">Cancel</button>' +
        '</div>';

    wdvModal('📱 Add Phone', html);
};

// =====================================================================
// BULK ADD MODAL
// =====================================================================
window.wdvOpenBulkModal = function () {
    var inp = 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box;';
    var lbl = 'display:block; font-size:11px; font-weight:bold; color:#334155; margin-bottom:4px; margin-top:10px; text-transform:uppercase; letter-spacing:0.5px;';

    var html =
        '<div style="text-align:center; font-size:15px; font-weight:bold; margin-bottom:6px;">📋 Bulk Add Phones</div>' +
        '<div style="text-align:center; font-size:12px; color:#64748b; margin-bottom:14px;">Great for when a supplier drops 20 phones. All phones below share the same brand, model, cost and price.</div>' +

        '<label style="'+lbl+'">IMEIs — one per line</label>' +
        '<textarea id="wdv-b-imeis" rows="8" placeholder="356938035643809&#10;356938035643817&#10;356938035643825" style="'+inp+' font-family:monospace;"></textarea>' +
        '<div id="wdv-b-count" style="font-size:12px; color:#0284c7; margin-top:6px;">0 IMEIs detected</div>' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
          '<div><label style="'+lbl+'">Brand</label>' +
            '<select id="wdv-b-brand" style="'+inp+'">' +
              WDV_PHONE_BRANDS.map(function(b){ return '<option>'+b+'</option>'; }).join('') +
            '</select></div>' +
          '<div><label style="'+lbl+'">Condition</label>' +
            '<select id="wdv-b-condition" style="'+inp+'">' +
              WDV_CONDITIONS.map(function(c){ return '<option>'+c+'</option>'; }).join('') +
            '</select></div>' +
        '</div>' +

        '<label style="'+lbl+'">Model</label>' +
        '<input id="wdv-b-model" type="text" placeholder="e.g. Galaxy A15" style="'+inp+'">' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
          '<div><label style="'+lbl+'">Storage</label>' +
            '<select id="wdv-b-storage" style="'+inp+'">' +
              WDV_STORAGE_OPTIONS.map(function(s){ return '<option>'+s+'</option>'; }).join('') +
            '</select></div>' +
          '<div><label style="'+lbl+'">Color</label>' +
            '<input id="wdv-b-color" type="text" placeholder="e.g. Blue" style="'+inp+'"></div>' +
        '</div>' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
          '<div><label style="'+lbl+'">Cost Price each (₦)</label>' +
            '<input id="wdv-b-cost" type="number" placeholder="e.g. 185000" style="'+inp+'"></div>' +
          '<div><label style="'+lbl+'">Selling Price each (₦)</label>' +
            '<input id="wdv-b-sell" type="number" placeholder="e.g. 215000" style="'+inp+'"></div>' +
        '</div>' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">' +
          '<div><label style="'+lbl+'">Purchase Date</label>' +
            '<input id="wdv-b-date" type="date" value="'+wdvToday()+'" style="'+inp+'"></div>' +
          '<div><label style="'+lbl+'">Warranty (months)</label>' +
            '<select id="wdv-b-warranty" style="'+inp+'">' +
              [0,3,6,12,24].map(function(m){ return '<option value="'+m+'"'+(m===12?' selected':'')+'>'+(m===0?'No warranty':m+' months')+'</option>'; }).join('') +
            '</select></div>' +
        '</div>' +

        '<div id="wdv-b-error" style="display:none; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:8px; font-size:12px; margin-top:10px;"></div>' +

        '<div style="display:flex; gap:10px; margin-top:16px;">' +
          '<button class="menu-btn btn-action-primary" style="flex:1; margin:0; justify-content:center;" onclick="wdvSaveBulk()">Add All Phones</button>' +
          '<button class="menu-btn btn-logout" style="margin:0; width:auto;" onclick="wdvCloseModal()">Cancel</button>' +
        '</div>';

    wdvModal('📋 Bulk Add Phones', html);

    // Live IMEI counter
    setTimeout(function(){
        var ta = document.getElementById('wdv-b-imeis');
        var counter = document.getElementById('wdv-b-count');
        if (ta && counter) {
            ta.addEventListener('input', function(){
                var n = ta.value.split(/\r?\n/).map(function(s){return s.trim();}).filter(Boolean).length;
                counter.textContent = n + ' IMEI' + (n===1?'':'s') + ' detected';
            });
        }
    }, 50);
};

// =====================================================================
// SAVE A SINGLE PHONE
// =====================================================================
window.wdvSavePhone = async function (editId) {
    var err = document.getElementById('wdv-add-error');
    err.style.display = 'none';

    var imei = (document.getElementById('wdv-f-imei').value || '').trim();
    var imei2 = (document.getElementById('wdv-f-imei2').value || '').trim();
    var brand = document.getElementById('wdv-f-brand').value;
    var model = (document.getElementById('wdv-f-model').value || '').trim();
    var storage = document.getElementById('wdv-f-storage').value;
    var color = (document.getElementById('wdv-f-color').value || '').trim();
    var condition = document.getElementById('wdv-f-condition').value;
    var cost = parseFloat(document.getElementById('wdv-f-cost').value) || 0;
    var sell = parseFloat(document.getElementById('wdv-f-sell').value) || 0;
    var purchaseDate = document.getElementById('wdv-f-date').value || wdvToday();
    var warranty = parseInt(document.getElementById('wdv-f-warranty').value) || 0;
    var notes = (document.getElementById('wdv-f-notes').value || '').trim();

    var fail = function (msg) { err.textContent = msg; err.style.display = 'block'; };
    if (!imei) return fail('IMEI is required.');
    if (!/^\d{10,20}$/.test(imei)) return fail('IMEI should be 10–20 digits (usually 15).');
    if (!model) return fail('Model is required.');
    if (!(cost > 0)) return fail('Cost price must be greater than 0.');
    if (!(sell > 0)) return fail('Selling price must be greater than 0.');

    // Duplicate IMEI check
    var dup = Object.keys(wdvPhonesock).find(function (id) {
        if (edit',
Id && id === editId) return false        createdAt:;
        var p = wdvPhones[id];
        return p.imei === imei || (imei2 && p.imei === imei2) || (p.imei2 && (p.imei2 === imei || p.imei2 === imei2));
    });
    if (dup) {
        var d = wdvPhones[dup];
        return fail('This IMEI ('+imei+') is already in your inventory: '+d.brand+' '+d.model+' ('+d.status+').');
    }

    var rec = {
        imei: imei, imei2: imei2,
        brand: brand, model: model, storage: storage, color: color,
        condition: condition,
        costPrice: cost, sellingPrice: sell,
        purchaseDate: purchaseDate, warrantyMonths: warranty,
        notes: notes,
        status: 'in_st wdvNow(),
        createdBy: (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'
    };

    try {
        var db = firebase.database();
        if (editId) {
            // Preserve status, soldTo, createdAt
            var existing = wdvPhones[editId] || {};
            rec.status = existing.status || 'in_stock';
            rec.createdAt = existing.createdAt || wdvNow();
            rec.soldTo = existing.soldTo || null;
            await db.ref('phoneInventory/' + currentStoreId + '/' + editId).update(rec);
        } else {
            var ref = db.ref('phoneInventory/' + currentStoreId).push();
            await ref.set(rec);
        }
        wdvCloseModal();
    } catch (e) {
        fail('Could not save: ' + e.message);
    }
};

// =====================================================================
// SAVE BULK
// =====================================================================
window.wdvSaveBulk = async function () {
    var err = document.getElementById('wdv-b-error');
    err.style.display = 'none';
    var fail = function (msg) { err.textContent = msg; err.style.display = 'block'; };

    var raw = (document.getElementById('wdv-b-imeis').value || '').split(/\r?\n/).map(function(s){return s.trim();}).filter(Boolean);
    var brand = document.getElementById('wdv-b-brand').value;
    var model = (document.getElementById('wdv-b-model').value || '').trim();
    var storage = document.getElementById('wdv-b-storage').value;
    var color = (document.getElementById('wdv-b-color').value || '').trim();
    var condition = document.getElementById('wdv-b-condition').value;
    var cost = parseFloat(document.getElementById('wdv-b-cost').value) || 0;
    var sell = parseFloat(document.getElementById('wdv-b-sell').value) || 0;
    var purchaseDate = document.getElementById('wdv-b-date').value || wdvToday();
    var warranty = parseInt(document.getElementById('wdv-b-warranty').value) || 0;

    if (raw.length === 0) return fail('Paste at least one IMEI, one per line.');
    if (!model) return fail('Model is required.');
    if (!(cost > 0)) return fail('Cost price must be greater than 0.');
    if (!(sell > 0)) return fail('Selling price must be greater than 0.');

    // Reject non-numeric IMEIs
    var bad = raw.find(function (x) { return !/^\d{10,20}$/.test(x); });
    if (bad) return fail('Not a valid IMEI: "'+bad+'" — IMEIs are 10–20 digits.');

    // Reject IMEIs already in inventory
    var existingSet = {};
    Object.keys(wdvPhones).forEach(function(id){ existingSet[wdvPhones[id].imei] = true; if (wdvPhones[id].imei2) existingSet[wdvPhones[id].imei2] = true; });
    var dupes = raw.filter(function(x){ return existingSet[x]; });
    if (dupes.length) return fail('Already in inventory: ' + dupes.join(', '));

    // Reject duplicates within the pasted list
    var seen = {}; var withinDupes = [];
    raw.forEach(function(x){ if (seen[x]) withinDupes.push(x); seen[x] = true; });
    if (withinDupes.length) return fail('Same IMEI pasted twice: ' + withinDupes.join(', '));

    try {
        var db = firebase.database();
        var batch = {};
        var createdBy = (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin';
        raw.forEach(function (imei) {
            var ref = db.ref('phoneInventory/' + currentStoreId).push();
            batch[ref.key] = {
                imei: imei, imei2: '',
                brand: brand, model: model, storage: storage, color: color,
                condition: condition,
                costPrice: cost, sellingPrice: sell,
                purchaseDate: purchaseDate, warrantyMonths: warranty,
                notes: '',
                status: 'in_stock',
                createdAt: wdvNow(),
                createdBy: createdBy
            };
        });
        await db.ref('phoneInventory/' + currentStoreId).update(batch);
        wdvCloseModal();
    } catch (e) {
        fail('Could not save: ' + e.message);
    }
};

// =====================================================================
// EDIT / DELETE
// =====================================================================
window.wdvEditPhone = function (id) { wdvOpenAddPhoneModal(id); };

window.wdvDeletePhone = async function (id) {
    var p = wdvPhones[id];
    if (!p) return;
    if (!confirm('Delete this phone?\n\n' + p.brand + ' ' + p.model + '\nIMEI: ' + p.imei + '\n\nThis cannot be undone.')) return;
    try {
        await firebase.database().ref('phoneInventory/' + currentStoreId + '/' + id).remove();
    } catch (e) { alert('Could not delete: ' + e.message); }
};

// =====================================================================
// MODAL HELPERS
// =====================================================================
function wdvModal(title, html) {
    var m = document.getElementById('wdv-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdv-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1500; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML =
        '<div style="background:#fff; color:#0f172a; border-radius:14px; width:100%; max-width:520px; max-height:94vh; overflow-y:auto; padding:20px; box-sizing:border-box;">' +
          '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:8px;">' +
            '<h3 style="margin:0; font-size:17px;">'+wdvEsc(title)+'</h3>' +
            '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdvCloseModal()">✕</button>' +
          '</div>' + html +
        '</div>';
    m.style.display = 'flex';
}
window.wdvCloseModal = function () { var m = document.getElementById('wdv-modal'); if (m) m.style.display = 'none'; };

// =====================================================================
// DETECT STORE TYPE ON LOGIN — attach listener + reapply sidebar
// =====================================================================
function wdvWatchStoreType() {
    if (!currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
    try {
        firebase.database().ref('stores/' + currentStoreId + '/storeType').on('value', function (snap) {
            wdvStoreType = snap.val() || 'general';
            wdvApplySidebar();
        });
    } catch (e) { /* ignore */ }
}

// =====================================================================
// SUPER ADMIN — override store type from a store row
// (This is a safety net so you can flip a store if they chose wrong)
// =====================================================================
window.wdvSuperAdminToggleType = async function (storeId) {
    var current = prompt('Store type for "' + storeId + '"?\n\nOptions:\n  general\n  phone_vendor\n  pharmacy\n  restaurant\n  fashion\n  hardware\n  stationery\n  water\n  cosmetics', 'general');
    if (!current) return;
    var val = current.trim().toLowerCase();
    try {
        await firebase.database().ref('stores/' + storeId + '/storeType').set(val);
        alert('Updated ' + storeId + ' → ' + val + '. The store will see the new dashboard on next refresh.');
    } catch (e) { alert('Failed: ' + e.message); }
};

// =====================================================================
// MAIN ATTACH — runs on every DOM change (idempotent)
// =====================================================================
function wdvAttach() {
    // 1. Inject the store type selector at registration
    wdvInjectRegistrationSelector();

    // 2. Watch store type once we know which store is logged in
    if (typeof currentStoreId !== 'undefined' && currentStoreId && currentStoreId !== 'SUPER_ADMIN' && !wdvStoreType) {
        wdvWatchStoreType();
    }

    // 3. Reapply sidebar in case another patch rebuilt it
    wdvApplySidebar();
}

// Kick off
window.addEventListener('load', function () {
    setTimeout(function(){ try { wdvAttach(); } catch (e) { console.warn(e); } }, 500);

    var wdvObs = new MutationObserver(function () {
        try { wdvAttach(); } catch (e) { console.warn(e); }
    });
    if (document.body) wdvObs.observe(document.body, { childList: true, subtree: true });
});
