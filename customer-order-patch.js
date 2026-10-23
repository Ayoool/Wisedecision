// ==================== WISE DECISION CUSTOMER ORDER PATCH (v1) ====================
// Load AFTER email-auth-patch.js (defer).
//
// CUSTOMER SIDE (login page, no sign-in needed)
//   * "🛒 Order goods" button on the login screen.
//   * Customer types the Store ID, picks goods (sees retail prices, chooses piece or pack), enters name + phone, and gets a TRACKING ID.
//   * Order is saved to customerOrders/{storeId}/{trackingId} with status "pending".
//
// STORE SIDE (Admin)
//   * Settings page card: "Publish product list" copies product NAMES and RETAIL prices only (never cost, wholesale or stock) from
//     stores/{id}/inventory to publicCatalog/{id}, which customers can read.
//
// Needs the database rules for publicCatalog and customerOrders (see the rules snippet).

console.log("Wise Decision customer-order-patch.js v4 loaded");

var WDCO_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
var wdco = { sid: '', name: '', list: [], byKey: {}, qty: {}, unit: {}, q: '', busy: false };

function wdcoEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdcoMoney(n) { return '₦' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(); }
function wdcoTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
        p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
}
function wdcoTrackingId() {
    var a = new Uint32Array(6), s = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += WDCO_ALPHA.charAt(a[i] % WDCO_ALPHA.length);
    return 'WD-' + s;
}

var WDCO_INPUT = 'width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px; box-sizing:border-box; font-size:14px;';

function wdcoModal(title, html) {
    var m = document.getElementById('wdco-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdco-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1600; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:480px; max-height:94vh; overflow-y:auto; padding:18px; box-sizing:border-box;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">' +
        '<h3 style="margin:0; font-size:17px;">' + wdcoEsc(title) + '</h3>' +
        '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdcoClose()">✕</button></div>' + html + '</div>';
    m.style.display = 'flex';
}
function wdcoClose() { var m = document.getElementById('wdco-modal'); if (m) m.style.display = 'none'; }

// ---------- Step 1: which store ----------
function wdcoOpen() {
    var last = '';
    try { last = localStorage.getItem('wdco_last_store') || ''; } catch (e) {}
    wdcoAsk('', last);
}
function wdcoAsk(msg, pre) {
    wdcoModal('🛒 Order goods',
        (msg ? '<div style="background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:8px; border-radius:6px; font-size:12px; margin-bottom:10px;">' + wdcoEsc(msg) + '</div>' : '') +
        '<div style="font-size:13px; color:#475569; margin-bottom:10px;">Choose what you want, get a tracking ID, then show it at the shop and pay there.</div>' +
        '<label style="font-size:12px; font-weight:bold;">Store ID (ask the shop)</label>' +
        '<input id="wdco-sid" type="text" value="' + wdcoEsc(pre || '') + '" placeholder="e.g. oreoloyun" autocapitalize="none" style="' + WDCO_INPUT + '">' +
        '<button class="menu-btn btn-action-primary" style="justify-content:center; margin:0;" onclick="wdcoLoad(document.getElementById(\'wdco-sid\').value)">Continue</button>');
}

async function wdcoLoad(raw) {
    var id = String(raw || '').trim().toLowerCase();
    if (!id || /[.#$\[\]\/\s]/.test(id)) { wdcoAsk('Please type the Store ID correctly.', id); return; }
    wdcoModal('🛒 Order goods', '<div style="text-align:center; color:#64748b; padding:24px;">Loading products...</div>');
    var v;
    try { v = (await wdcoTimeout(firebase.database().ref('publicCatalog/' + id).once('value'), 15000)).val(); }
    catch (e) {
        wdcoModal('🛒 Order goods', '<div style="color:#b91c1c; padding:8px;">Could not load. Check your internet and try again.</div>' +
            '<button class="menu-btn btn-action-primary" style="justify-content:center; margin:0;" onclick="wdcoLoad(\'' + wdcoEsc(id) + '\')">Try again</button>');
        return;
    }
    if (!v || !v.items) { wdcoAsk('This store has not opened online ordering yet. Please check the Store ID or ask the shop.', id); return; }
    wdco.sid = id;
    wdco.name = v.name || id;
    wdco.byKey = v.items;
    wdco.list = Object.keys(v.items).map(function (k) { var it = v.items[k] || {}; return { k: k, name: String(it.name || ''), price: Number(it.price) || 0, unit: String(it.unit || '') }; })
        .filter(function (x) { return x.name; })
        .sort(function (a, b) { return a.name.localeCompare(b.name); });
    wdco.qty = {}; wdco.unit = {}; wdco.q = '';
    try { localStorage.setItem('wdco_last_store', id); } catch (e) {}
    wdcoRenderForm();
}

// ---------- Step 2: pick goods + details ----------
function wdcoRenderForm() {
    wdcoModal('🛒 ' + wdco.name,
        '<label style="font-size:12px; font-weight:bold;">Your name</label><input id="wdco-name" type="text" autocomplete="name" style="' + WDCO_INPUT + '">' +
        '<label style="font-size:12px; font-weight:bold;">Phone number</label><input id="wdco-phone" type="tel" autocomplete="tel" style="' + WDCO_INPUT + '">' +
        '<label style="font-size:12px; font-weight:bold;">Find goods</label><input id="wdco-search" type="search" placeholder="Type to search..." oninput="wdcoSearch(this.value)" style="' + WDCO_INPUT + '">' +
        '<div id="wdco-list"></div>' +
        '<div id="wdco-summary" style="margin:10px 0;"></div>' +
        '<button id="wdco-submit" class="menu-btn btn-action-primary" style="justify-content:center; margin:0 0 8px; background:#16a34a;" onclick="wdcoSubmit()">Send my order</button>' +
        '<button class="menu-btn" style="margin:0; justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdcoOpen()">Change store</button>');
    wdcoRenderList();
    wdcoRenderSummary();
}
function wdcoSearch(v) { wdco.q = String(v || '').trim().toLowerCase(); wdcoRenderList(); }
// A product can be sold by the piece (sachet, capsule...) or by the pack (carton, box...) when the shop set it up that way.
function wdcoSplit(it) { return !!(it && !it.unit && Number(it.upp) > 1 && Number(it.packPrice) > 0); }
function wdcoUnitOf(k) { var it = wdco.byKey[k] || {}; return wdcoSplit(it) && wdco.unit[k] === 'Pack' ? 'Pack' : 'Piece'; }
function wdcoPriceOf(it, unit) { return unit === 'Pack' ? (Number(it.packPrice) || 0) : (Number(it.price) || 0); }
function wdcoLabel(it, unit, qty) {
    if (it.unit) return String(it.unit);
    var n = unit === 'Pack' ? (it.bulk || 'Pack') : (it.base || 'Piece');
    return Number(qty) === 1 ? n : n + 's';
}
function wdcoRenderList() {
    var el = document.getElementById('wdco-list');
    if (!el) return;
    var q = wdco.q;
    var rows = wdco.list.filter(function (x) { return !q || x.name.toLowerCase().indexOf(q) !== -1; });
    var shown = rows.slice(0, 40);
    if (!shown.length) { el.innerHTML = '<div style="font-size:12px; color:#64748b; padding:6px 0;">' + (wdco.list.length ? 'No match. Try another word.' : 'No products available.') + '</div>'; return; }
    el.innerHTML = '<div style="border:1px solid #e2e8f0; border-radius:8px; max-height:300px; overflow-y:auto;">' + shown.map(function (x) {
        var it = wdco.byKey[x.k] || {}, n = wdco.qty[x.k] || 0, k = wdcoEsc(x.k);
        var split = wdcoSplit(it), unit = wdcoUnitOf(x.k), pr = wdcoPriceOf(it, unit);
        var priceLine = pr > 0 ? wdcoMoney(pr) + (it.unit ? ' / ' + wdcoEsc(it.unit) : (split ? ' / ' + wdcoEsc(wdcoLabel(it, unit, 1)) : ' each')) : '';
        var hint = split ? ' <span style="color:#64748b;">(1 ' + wdcoEsc(it.bulk || 'Pack') + ' = ' + Number(it.upp) + ' ' + wdcoEsc((it.base || 'Piece') + 's') + ')</span>' : '';
        var toggle = split ? '<div style="display:flex; gap:6px; margin-top:5px;">' + ['Piece', 'Pack'].map(function (u) {
            var on = unit === u;
            return '<button data-k="' + k + '" data-u="' + u + '" onclick="wdcoSetUnit(this.dataset.k,this.dataset.u)" style="padding:3px 12px; font-size:11px; border-radius:12px; cursor:pointer; border:1px solid ' + (on ? '#0284c7' : '#cbd5e1') + '; background:' + (on ? '#0284c7' : '#fff') + '; color:' + (on ? '#fff' : '#334155') + ';">' + wdcoEsc(wdcoLabel(it, u, 1)) + '</button>';
        }).join('') + '</div>' : '';
        return '<div style="padding:7px 10px; border-bottom:1px solid #f1f5f9; font-size:13px;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">' +
            '<span style="flex:1;">' + wdcoEsc(x.name) + (priceLine ? '<br><small style="color:#166534;">' + priceLine + '</small>' + hint : '') + '</span>' +
            '<span style="display:flex; align-items:center; gap:4px;">' +
            '<button data-k="' + k + '" onclick="wdcoStep(this.dataset.k,-1)" style="width:28px; height:28px; border-radius:6px; border:1px solid #cbd5e1; background:#f8fafc; cursor:pointer;">−</button>' +
            '<input data-k="' + k + '" type="number" min="0" value="' + n + '" oninput="wdcoSet(this.dataset.k,this.value)" style="width:48px; text-align:center; padding:4px; border:1px solid #cbd5e1; border-radius:6px;">' +
            '<button data-k="' + k + '" onclick="wdcoStep(this.dataset.k,1)" style="width:28px; height:28px; border-radius:6px; border:none; background:#0284c7; color:#fff; cursor:pointer;">+</button></span></div>' + toggle + '</div>';
    }).join('') + '</div>' + (rows.length > shown.length ? '<div style="font-size:11px; color:#64748b; margin-top:4px;">Showing ' + shown.length + ' of ' + rows.length + '. Type to narrow down.</div>' : '');
}
function wdcoSetUnit(k, u) { wdco.unit[k] = u === 'Pack' ? 'Pack' : 'Piece'; wdcoRenderList(); wdcoRenderSummary(); }
function wdcoSet(k, v) {
    var n = Math.max(0, Math.min(9999, parseInt(v) || 0));
    if (n > 0) wdco.qty[k] = n; else delete wdco.qty[k];
    wdcoRenderSummary();
}
function wdcoStep(k, d) { wdcoSet(k, (wdco.qty[k] || 0) + d); wdcoRenderList(); }
function wdcoRenderSummary() {
    var el = document.getElementById('wdco-summary');
    if (!el) return;
    var keys = Object.keys(wdco.qty);
    if (!keys.length) { el.innerHTML = '<div style="font-size:12px; color:#64748b;">Nothing chosen yet.</div>'; return; }
    var total = 0, unpriced = 0;
    var rows = keys.map(function (k) {
        var it = wdco.byKey[k] || {}, qty = wdco.qty[k], unit = wdcoUnitOf(k), pr = wdcoPriceOf(it, unit);
        if (pr > 0) total += pr * qty; else unpriced++;
        return '<div style="display:flex; justify-content:space-between; gap:8px; font-size:12px; padding:2px 0;"><span>' + wdcoEsc(it.name || k) + '</span><span style="white-space:nowrap;">× ' + qty + ' ' + wdcoEsc(wdcoLabel(it, unit, qty)) + (pr > 0 ? ' · ' + wdcoMoney(pr * qty) : '') + '</span></div>';
    }).join('');
    el.innerHTML = '<div style="font-weight:bold; font-size:13px; margin-bottom:4px;">Your order (' + keys.length + ' item' + (keys.length === 1 ? '' : 's') + ')</div>' + rows +
        (total > 0 ? '<div style="display:flex; justify-content:space-between; font-weight:bold; border-top:1px solid #e2e8f0; margin-top:6px; padding-top:6px;"><span>Total' + (unpriced ? ' (priced items)' : '') + '</span><span>' + wdcoMoney(total) + '</span></div>' : '') +
        '<div style="font-size:11px; color:#64748b; margin-top:4px;">Prices shown are retail. Registered customers get the shop\'s special price at the counter.</div>';
}

// ---------- Step 3: send ----------
async function wdcoSubmit() {
    if (wdco.busy) return;
    var name = (document.getElementById('wdco-name').value || '').trim();
    var phone = (document.getElementById('wdco-phone').value || '').trim();
    var keys = Object.keys(wdco.qty).filter(function (k) { return wdco.qty[k] > 0; });
    if (name.length < 2) { alert('Please enter your name.'); return; }
    if (phone.replace(/\D/g, '').length < 7) { alert('Please enter a valid phone number.'); return; }
    if (!keys.length) { alert('Choose at least one item.'); return; }
    if (keys.length > 40) { alert('Please order at most 40 different items at once.'); return; }

    var items = {};
    keys.forEach(function (k) {
        var it = wdco.byKey[k] || {}, unit = wdcoUnitOf(k);
        items[k] = { name: String(it.name || k).slice(0, 190), qty: wdco.qty[k], unit: unit, unitName: String(wdcoLabel(it, unit, 1)).slice(0, 40) };
    });
    var rec = { storeId: wdco.sid, name: name.slice(0, 90), phone: phone.slice(0, 25), items: items, status: 'pending', createdAt: new Date().toISOString() };

    wdco.busy = true;
    var btn = document.getElementById('wdco-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    var db = firebase.database(), tid = null, lastErr = null;
    for (var attempt = 0; attempt < 4 && !tid; attempt++) {
        var t = wdcoTrackingId();
        rec.trackingId = t;
        try { await wdcoTimeout(db.ref('customerOrders/' + wdco.sid + '/' + t).set(rec), 15000); tid = t; }
        catch (e) { lastErr = e; if (!(e && e.code === 'PERMISSION_DENIED')) break; }
    }
    wdco.busy = false;
    if (!tid) {
        if (btn) { btn.disabled = false; btn.textContent = 'Send my order'; }
        alert('Could not send your order: ' + ((lastErr && (lastErr.code || lastErr.message)) || 'unknown error') + '\n\nPlease check your internet and try again.');
        return;
    }
    wdcoDone(tid, rec);
}

function wdcoDone(tid, rec) {
    var lines = Object.keys(rec.items).map(function (k) { var r = rec.items[k]; return r.name + ' × ' + r.qty + (r.unitName ? ' ' + r.unitName + (r.qty === 1 || (wdco.byKey[k] || {}).unit ? '' : 's') : ''); });
    var est = 0;
    Object.keys(rec.items).forEach(function (k) { est += wdcoPriceOf(wdco.byKey[k] || {}, rec.items[k].unit === 'Pack' ? 'Pack' : 'Piece') * rec.items[k].qty; });
    var text = 'My order at ' + wdco.name + '\nTracking ID: ' + tid + '\n' + lines.join('\n') + (est > 0 ? '\nTotal (retail): ' + wdcoMoney(est) : '');
    wdcoModal('✅ Order sent',
        '<div style="text-align:center; margin-bottom:12px;">' +
        '<div style="font-size:12px; color:#64748b;">Your tracking ID</div>' +
        '<div style="font-size:30px; font-weight:800; letter-spacing:2px; user-select:all; color:#166534;">' + wdcoEsc(tid) + '</div></div>' +
        '<div style="background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; padding:10px; border-radius:8px; font-size:13px; margin-bottom:10px;">Go to <strong>' + wdcoEsc(wdco.name) + '</strong>, give them this ID and pay there. Take a screenshot or copy it so you do not lose it.</div>' +
        '<div style="font-size:12px; color:#475569; margin-bottom:10px;">' + lines.map(wdcoEsc).join('<br>') + (est > 0 ? '<br><strong>Total (retail): ' + wdcoMoney(est) + '</strong>' : '') + '</div>' +
        '<button class="menu-btn btn-action-primary" style="justify-content:center; margin:0 0 8px;" data-t="' + wdcoEsc(text) + '" onclick="wdcoCopy(this.dataset.t)">📋 Copy my order details</button>' +
        '<button class="menu-btn" style="margin:0; justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdcoClose()">Close</button>');
}
function wdcoCopy(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { alert('Copied.'); }, function () { prompt('Copy this:', t); });
    else prompt('Copy this:', t);
}

// ---------- Login screen button ----------
function wdcoInsertLoginButton() {
    var reg = document.getElementById('wdae-register-btn');
    var old = document.querySelectorAll('#wdco-login-btn');
    if (reg && reg.getClientRects().length > 0 && old.length === 1 && reg.previousElementSibling === old[0]) return;   // already in place
    old.forEach(function (b) { b.remove(); });
    if (!reg || reg.getClientRects().length === 0) return;
    var b = document.createElement('button');
    b.id = 'wdco-login-btn';
    b.className = 'menu-btn btn-secondary';
    b.style.cssText = 'margin-top:10px; font-size:12px;';
    b.textContent = '🛒 Order goods (customers)';
    b.onclick = wdcoOpen;
    reg.insertAdjacentElement('beforebegin', b);   // before Register, so it never fights the payments-patch link that sits after it
}
function wdcoHookLoginBuild() {
    var prev = window.wdaeBuildLoginScreen;
    if (typeof prev !== 'function' || prev.__wdco) return;
    var hooked = function () {
        var r = prev.apply(this, arguments);
        try { wdcoInsertLoginButton(); } catch (e) { console.warn(e); }
        return r;
    };
    hooked.__wdco = true;
    window.wdaeBuildLoginScreen = hooked;
}

// ---------- Admin: publish the product list ----------
async function wdcoPublish() {
    var sid = currentStoreId;
    if (!sid || currentUserRole !== 'Admin') return;
    var btn = document.getElementById('wdco-publish-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }
    try {
        var db = firebase.database();
        var r = await Promise.all([db.ref('stores/' + sid + '/inventory').once('value'), db.ref('stores/' + sid + '/businessName').once('value')]);
        var items = {}, seen = 0, sample = null, count = 0, names = {};
        r[0].forEach(function (branch) {
            branch.forEach(function (pc) {
                var p = pc.val();
                if (!p || typeof p !== 'object') return;
                seen++;
                if (!sample) sample = Object.keys(p).join(', ');
                var nm = String(p.name || p.productName || p.title || p.itemName || '').trim();
                var nk = nm.toLowerCase().replace(/\s+/g, ' ');
                if (!nm || names[nk] || items[pc.key] || count >= 3000) return;
                names[nk] = true;
                var price = 0, unit = '';
                if (p.soldByWeight) { price = Number(p.price != null ? p.price : p.retailPrice) || 0; unit = String(p.weightUnit || 'Kg').toLowerCase(); }
                else if (typeof getPiecePrice === 'function') { price = Number(getPiecePrice(p, 'Retail')) || 0; }
                else { price = Number(p.price != null ? p.price : p.retailPrice) || 0; }
                var entry = { name: nm.slice(0, 150), price: price, unit: unit };
                var upp = p.soldByWeight ? 1 : (Number(p.unitsPerPack) || 1);
                if (upp > 1) {
                    entry.upp = upp;
                    entry.packPrice = Number(p.price != null ? p.price : p.retailPrice) || 0;
                    entry.base = String(p.baseUnitName || '').trim().slice(0, 30);
                    entry.bulk = String(p.bulkUnitName || '').trim().slice(0, 30);
                }
                items[pc.key] = entry;
                count++;
            });
        });
        if (!count) {
            alert('No product names were found (' + seen + ' product records seen).' + (sample ? '\n\nA product has these fields: ' + sample + '\n\nSend me this line so I can match the name field.' : ''));
            return;
        }
        await db.ref('publicCatalog/' + sid).set({ name: r[1].val() || sid, updatedAt: new Date().toISOString(), count: count, items: items });
        alert('Published ' + count + ' products (names and retail prices only). Customers can now order from the login page with Store ID: ' + sid);
    } catch (e) {
        alert('Could not publish: ' + ((e && (e.code || e.message)) || 'unknown error'));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📤 Publish / refresh product list'; }
        wdcoDrawCard(true);
    }
}

async function wdcoDrawCard(force) {
    if (currentUserRole !== 'Admin' || !currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
    var ws = document.getElementById('workspace-content');
    if (!ws || !document.getElementById('settings-store-name')) { var gone = document.getElementById('wdco-card'); if (gone) gone.remove(); return; }
    var card = document.getElementById('wdco-card');
    if (card && card.parentElement === ws && !force) return;
    if (!card) {
        card = document.createElement('div');
        card.id = 'wdco-card';
        card.style.cssText = 'max-width:600px; margin:20px 0; padding:25px; background:#ffffff; border-radius:8px; border:1px solid #e2e8f0; box-shadow:0 4px 6px rgba(0,0,0,0.02);';
    }
    if (card.parentElement !== ws) ws.appendChild(card);
    var sid = currentStoreId, info = 'Not published yet.';
    try {
        var u = (await wdcoTimeout(firebase.database().ref('publicCatalog/' + sid + '/updatedAt').once('value'), 8000)).val();
        var c = (await wdcoTimeout(firebase.database().ref('publicCatalog/' + sid + '/count').once('value'), 8000)).val();
        if (u) info = c + ' products published · ' + new Date(u).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) { info = 'Could not check status.'; }
    if (sid !== currentStoreId) return;
    card.innerHTML = '<h3 style="margin-top:0; margin-bottom:10px; color:#1e293b; border-bottom:2px solid #f1f5f9; padding-bottom:10px; font-size:16px;">🛒 Customer orders</h3>' +
        '<div style="font-size:13px; color:#475569; margin-bottom:6px;">Customers pick goods from the login page (they see names and retail prices only) and get a tracking ID to bring to the shop.</div>' +
        '<div style="font-size:12px; color:#64748b; margin-bottom:10px;">Store ID to give customers: <strong>' + wdcoEsc(sid) + '</strong><br>' + wdcoEsc(info) + '</div>' +
        '<button id="wdco-publish-btn" class="menu-btn btn-action-primary" style="justify-content:center; margin:0;" onclick="wdcoPublish()">📤 Publish / refresh product list</button>';
}

function wdcoAttach() {
    try { wdcoHookLoginBuild(); } catch (e) { console.warn(e); }
    try { wdcoInsertLoginButton(); } catch (e) { console.warn(e); }
    try { wdcoDrawCard(false); } catch (e) { console.warn(e); }
}
window.addEventListener('load', function () { setTimeout(wdcoAttach, 300); });
(function () {
    var obs = new MutationObserver(function () { wdcoAttach(); });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function () { obs.observe(document.body, { childList: true, subtree: true }); });
})();
setInterval(wdcoAttach, 3000);
