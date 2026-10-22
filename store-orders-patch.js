// ==================== WISE DECISION STORE ORDERS PATCH (v1) ====================
// Load AFTER payments-patch.js and customer-order-patch.js (defer).
//
// Adds a "📦 Customer Orders" button to the store sidebar (any signed-in store user, not the Super Admin).
//   * Type a tracking ID (e.g. WD-4K7P2X) to load the customer's order, or pick from the pending list.
//   * Shows customer name, phone (call / WhatsApp), and the goods ordered.
//   * Print an order slip (no prices), mark the order Completed, or Cancel it.
// Prices, stock and the normal sale/receipt are NOT connected yet (needs the checkout code).

console.log("Wise Decision store-orders-patch.js v1 loaded");

var wdso = { orders: {} };

function wdsoEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdsoTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
        var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
        p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
}
function wdsoWhen(iso) { var d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
function wdsoWa(phone) {
    var p = String(phone || '').replace(/[^\d+]/g, '');
    if (p.charAt(0) === '+') p = p.slice(1);
    else if (p.indexOf('00') === 0) p = p.slice(2);
    else if (p.charAt(0) === '0') p = '234' + p.slice(1);
    return p;
}
function wdsoChip(st) {
    var m = { pending: ['#fef3c7', '#92400e', 'PENDING'], completed: ['#dcfce7', '#166534', 'COMPLETED'], cancelled: ['#fee2e2', '#991b1b', 'CANCELLED'] }[st] || ['#e2e8f0', '#334155', String(st || '').toUpperCase()];
    return '<span style="background:' + m[0] + '; color:' + m[1] + '; font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">' + m[2] + '</span>';
}
function wdsoSid() { try { return currentStoreId; } catch (e) { return ''; } }
function wdsoStoreUser() {
    try { return !!(currentStoreId && currentStoreId !== 'SUPER_ADMIN' && currentUserRole && currentUserRole !== 'SuperAdmin'); } catch (e) { return false; }
}

function wdsoModal(title, html) {
    var m = document.getElementById('wdso-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wdso-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1550; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:520px; max-height:94vh; overflow-y:auto; padding:18px; box-sizing:border-box;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">' +
        '<h3 style="margin:0; font-size:17px;">' + wdsoEsc(title) + '</h3>' +
        '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdsoClose()">✕</button></div>' + html + '</div>';
    m.style.display = 'flex';
}
function wdsoClose() { var m = document.getElementById('wdso-modal'); if (m) m.style.display = 'none'; }

// ---------- Main screen: find by ID + pending list ----------
function wdsoOpen() {
    wdsoModal('📦 Customer Orders',
        '<label style="font-size:12px; font-weight:bold;">Tracking ID</label>' +
        '<div style="display:flex; gap:6px; margin:4px 0 12px;"><input id="wdso-tid" type="text" placeholder="e.g. WD-4K7P2X" autocapitalize="characters" autocomplete="off" style="flex:1; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:15px; box-sizing:border-box; text-transform:uppercase;">' +
        '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:10px 16px;" onclick="wdsoFind()">Find</button></div>' +
        '<div style="font-weight:bold; font-size:13px; margin-bottom:6px;">Pending orders</div><div id="wdso-list"><div style="color:#64748b; font-size:12px; padding:10px 0;">Loading...</div></div>');
    var el = document.getElementById('wdso-tid');
    if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') wdsoFind(); });
    wdsoLoadList();
}

async function wdsoLoadList() {
    var sid = wdsoSid(), box = function () { return document.getElementById('wdso-list'); };
    try {
        var snap = await wdsoTimeout(firebase.database().ref('customerOrders/' + sid).once('value'), 15000);
        var all = snap.val() || {};
        wdso.orders = all;
        var rows = Object.keys(all).map(function (k) { return Object.assign({ tid: k }, all[k]); })
            .filter(function (o) { return o.status === 'pending'; })
            .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 30);
        if (!box()) return;
        box().innerHTML = rows.length === 0 ? '<div style="color:#166534; font-size:13px; padding:10px 0;">✅ No pending customer orders.</div>' :
            rows.map(function (o) {
                var n = Object.keys(o.items || {}).length;
                return '<div data-t="' + wdsoEsc(o.tid) + '" onclick="wdsoShow(this.dataset.t)" style="border:1px solid #e2e8f0; border-radius:8px; padding:9px 10px; margin-bottom:6px; cursor:pointer;">' +
                    '<div style="display:flex; justify-content:space-between; gap:8px;"><strong>' + wdsoEsc(o.tid) + '</strong><span style="font-size:11px; color:#64748b;">' + wdsoWhen(o.createdAt) + '</span></div>' +
                    '<div style="font-size:12px; color:#475569;">' + wdsoEsc(o.name) + ' · ' + n + ' item' + (n === 1 ? '' : 's') + '</div></div>';
            }).join('');
    } catch (e) {
        if (box()) box().innerHTML = '<div style="color:#b91c1c; font-size:12px;">Could not load orders: ' + wdsoEsc((e && (e.code || e.message)) || 'error') + '</div>';
    }
}

async function wdsoFind() {
    var raw = String((document.getElementById('wdso-tid') || {}).value || '').toUpperCase().replace(/\s+/g, '');
    if (!raw) { alert('Type the tracking ID.'); return; }
    var tid = raw.indexOf('WD-') === 0 ? raw : 'WD-' + raw.replace(/^WD/, '').replace(/^-/, '');
    if (/[.#$\[\]\/]/.test(tid)) { alert('That tracking ID does not look right.'); return; }
    try {
        var rec = (await wdsoTimeout(firebase.database().ref('customerOrders/' + wdsoSid() + '/' + tid).once('value'), 12000)).val();
        if (!rec) { alert('No order found with ID ' + tid + ' in this store.'); return; }
        wdso.orders[tid] = rec;
        wdsoShow(tid);
    } catch (e) { alert('Could not look it up: ' + ((e && (e.code || e.message)) || 'error')); }
}

// ---------- One order ----------
function wdsoShow(tid) {
    var o = wdso.orders[tid];
    if (!o) { wdsoOpen(); return; }
    var items = o.items || {};
    var rows = Object.keys(items).map(function (k) {
        return '<div style="display:flex; justify-content:space-between; gap:8px; font-size:14px; padding:5px 0; border-bottom:1px dashed #e2e8f0;"><span>' + wdsoEsc(items[k].name) + '</span><strong>× ' + wdsoEsc(items[k].qty) + '</strong></div>';
    }).join('');
    var wa = wdsoWa(o.phone), t = wdsoEsc(tid), pending = o.status === 'pending';
    wdsoModal('Order ' + tid,
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">' + wdsoChip(o.status) + '<span style="font-size:11px; color:#64748b;">' + wdsoWhen(o.createdAt) + '</span></div>' +
        '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:10px; font-size:13px;">' +
        '<div><strong>' + wdsoEsc(o.name) + '</strong></div>' +
        '<div style="margin-top:4px;"><a href="tel:' + wdsoEsc(o.phone) + '" style="color:#0369a1; font-weight:bold;">📞 ' + wdsoEsc(o.phone) + '</a>' +
        (wa ? ' &nbsp; <a href="https://wa.me/' + wdsoEsc(wa) + '" target="_blank" rel="noopener" style="color:#166534; font-weight:bold;">💬 WhatsApp</a>' : '') + '</div></div>' +
        '<div style="font-weight:bold; font-size:13px; margin-bottom:4px;">Goods ordered</div>' + rows +
        '<div style="background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:8px; border-radius:6px; font-size:12px; margin:12px 0;">Prices and stock are not applied here yet. Ring the goods up in the normal sale screen, then mark this order Completed.</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button data-t="' + t + '" onclick="wdsoPrint(this.dataset.t)" class="menu-btn" style="margin:0; flex:1; justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;">🖨 Print slip</button>' +
        (pending ? '<button data-t="' + t + '" onclick="wdsoSetStatus(this.dataset.t,\'completed\')" class="menu-btn btn-action-primary" style="margin:0; flex:1; justify-content:center; background:#16a34a;">✔ Mark completed</button>' : '') + '</div>' +
        (pending ? '<button data-t="' + t + '" onclick="wdsoSetStatus(this.dataset.t,\'cancelled\')" class="menu-btn" style="margin:8px 0 0; width:100%; justify-content:center; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;">✖ Cancel this order</button>' : '') +
        '<button class="menu-btn" style="margin:8px 0 0; width:100%; justify-content:center; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="wdsoOpen()">← Back to list</button>');
}

async function wdsoSetStatus(tid, status) {
    var o = wdso.orders[tid];
    if (!o || o.status !== 'pending') { alert('This order is no longer pending.'); wdsoOpen(); return; }
    if (!confirm((status === 'completed' ? 'Mark this order as completed (customer paid and collected)?' : 'Cancel this order?') + '\n\n' + tid + ' — ' + o.name)) return;
    try {
        var upd = { status: status, decidedAt: new Date().toISOString(), decidedBy: String((typeof currentUserRole !== 'undefined' && currentUserRole) || '') };
        await firebase.database().ref('customerOrders/' + wdsoSid() + '/' + tid).update(upd);
        wdso.orders[tid] = Object.assign({}, o, upd);
        wdsoShow(tid);
    } catch (e) { alert('Failed: ' + ((e && (e.code || e.message)) || 'error')); }
}

function wdsoPrint(tid) {
    var o = wdso.orders[tid];
    if (!o) return;
    var store = '';
    try { store = (document.getElementById('dashboard-store-title') || {}).textContent || wdsoSid(); } catch (e) { store = wdsoSid(); }
    var items = o.items || {};
    var rows = Object.keys(items).map(function (k) { return '<tr><td>' + wdsoEsc(items[k].name) + '</td><td style="text-align:right;">× ' + wdsoEsc(items[k].qty) + '</td></tr>'; }).join('');
    var w = window.open('', '_blank', 'width=380,height=600');
    if (!w) { alert('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return; }
    w.document.write('<html><head><title>Order ' + wdsoEsc(tid) + '</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial,sans-serif; font-size:13px; padding:12px; max-width:340px; margin:0 auto;} h2,h3{text-align:center; margin:4px 0;} table{width:100%; border-collapse:collapse;} td{padding:4px 0; border-bottom:1px dashed #999;} .c{text-align:center; color:#555; font-size:11px; margin-top:12px;}</style></head><body>' +
        '<h2>' + wdsoEsc(store) + '</h2><h3>Customer order slip</h3>' +
        '<p><strong>Tracking ID:</strong> ' + wdsoEsc(tid) + '<br><strong>Customer:</strong> ' + wdsoEsc(o.name) + '<br><strong>Phone:</strong> ' + wdsoEsc(o.phone) + '<br><strong>Date:</strong> ' + wdsoWhen(o.createdAt) + '</p>' +
        '<table>' + rows + '</table><p class="c">Order slip — prices not included</p></body></html>');
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
}

// ---------- Sidebar button (insert-only, idempotent) ----------
function wdsoShown(el) { return !!(el && el.getClientRects().length > 0); }
function wdsoFindShownButton(root, test) {
    var btns = root.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
        if (test((btns[i].textContent || '').trim().toLowerCase()) && wdsoShown(btns[i])) return btns[i];
    }
    return null;
}
function wdsoAttachSidebar() {
    var wrap = document.getElementById('dashboard-main-wrapper');
    var old = document.querySelectorAll('#wdso-sidebar-btn');
    if (!wrap || !wdsoStoreUser()) { old.forEach(function (b) { b.remove(); }); return; }
    var logout = wdsoFindShownButton(wrap, function (t) { return /logout$/.test(t); });
    if (!logout) return;
    // Sit before the Subscription button when it is there (the payments patch keeps that one right before Logout)
    var subs = document.getElementById('wdp-sidebar-btn');
    var anchor = subs && subs.parentNode === logout.parentNode ? subs : logout;
    if (old.length === 1 && anchor.previousElementSibling === old[0]) return;
    old.forEach(function (b) { b.remove(); });
    var b = document.createElement('button');
    b.id = 'wdso-sidebar-btn';
    b.className = 'menu-btn btn-subscription';
    b.textContent = '📦 Customer Orders';
    b.onclick = wdsoOpen;
    anchor.parentNode.insertBefore(b, anchor);
}

function wdsoAttach() { try { wdsoAttachSidebar(); } catch (e) { console.warn(e); } }
window.addEventListener('load', function () { setTimeout(wdsoAttach, 400); });
(function () {
    var obs = new MutationObserver(wdsoAttach);
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    else document.addEventListener('DOMContentLoaded', function () { obs.observe(document.body, { childList: true, subtree: true }); });
})();
setInterval(wdsoAttach, 3000);
