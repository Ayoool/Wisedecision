// ==================== WISE DECISION MATERIALS CREDIT BOOK (feature 1 of 6) ====================
// Load AFTER materials-dashboard-patch.js.
//
// A credit / debt book for building-materials stores: who took goods on credit, how much they
// still owe, part-payments, due dates, and a WhatsApp reminder in one tap.
//
//   * Stored separately at  stores/{storeId}/matCredit/{id}  — nothing existing is touched.
//   * A "Credit Book" card appears on the Materials Dashboard (under the quick buttons).
//   * A "Credit Book" button is added to the sidebar. To make it show, add 'credit' to the
//     keep: [...] list of the 'materials' and 'hardware' entries in vertical-first-patch.js.
//   * This is its own ledger. It is not tied to the POS checkout (enter the credit sale here).

console.log("Wise Decision materials-credit-patch.js — v1 loaded");

(function () {
    // ---------- helpers ----------
    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function num(n) { return Number(n) || 0; }
    function money(n) { return window.formatMoney ? window.formatMoney(n) : ('₦' + num(n).toLocaleString()); }
    function pad(n) { return String(n).padStart(2, '0'); }
    function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function $(id) { return document.getElementById(id); }
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function ref(path) { return firebase.database().ref('stores/' + sid() + '/matCredit' + (path ? '/' + path : '')); }
    function who() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
    function fmtDate(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString(); }

    var cache = [];
    var tab = 'owing';
    var query = '';

    // ---------- styles ----------
    function addStyles() {
        if ($('wcr-styles')) return;
        var st = document.createElement('style');
        st.id = 'wcr-styles';
        st.textContent =
        '.wcr{max-width:720px;margin:0 auto;color:#0f172a;}' +
        '.wcr *{box-sizing:border-box;}' +
        '.wcr h2{margin:0 0 2px 0;font-size:20px;}' +
        '.wcr-sub{font-size:12px;color:#64748b;margin-bottom:12px;}' +
        '.wcr-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;}' +
        '.wcr-tile{background:#fff;border:1px solid #e8eef5;border-radius:12px;padding:10px 12px;}' +
        '.wcr-tile small{display:block;font-size:10px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.3px;}' +
        '.wcr-tile b{display:block;font-size:15px;margin-top:3px;}' +
        '.wcr-add{width:100%;border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:800;color:#fff;background:linear-gradient(135deg,#f97316 0%,#c2410c 100%);box-shadow:0 8px 18px rgba(234,88,12,.28);cursor:pointer;margin-bottom:10px;}' +
        '.wcr-search{width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:12px;font-size:16px;margin-bottom:8px;background:#fff;}' +
        '.wcr-tabs{display:flex;gap:6px;margin-bottom:10px;}' +
        '.wcr-tabs button{flex:1;padding:9px;border:1px solid #e2e8f0;background:#fff;border-radius:10px;font-size:13px;font-weight:700;color:#475569;cursor:pointer;}' +
        '.wcr-tabs button.on{background:#ea580c;border-color:#ea580c;color:#fff;}' +
        '.wcr-card{background:#fff;border:1px solid #e8eef5;border-left:4px solid #f97316;border-radius:14px;padding:12px 14px;margin-bottom:8px;cursor:pointer;}' +
        '.wcr-card.late{border-left-color:#ef4444;}' +
        '.wcr-card.done{border-left-color:#22c55e;opacity:.85;}' +
        '.wcr-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;}' +
        '.wcr-name{font-weight:800;font-size:15px;}' +
        '.wcr-note{font-size:12px;color:#64748b;margin-top:2px;}' +
        '.wcr-bal{text-align:right;font-weight:800;font-size:16px;color:#c2410c;white-space:nowrap;}' +
        '.wcr-card.done .wcr-bal{color:#16a34a;}' +
        '.wcr-meta{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:11px;color:#64748b;}' +
        '.wcr-badge{font-size:10px;font-weight:800;padding:3px 8px;border-radius:99px;background:#fff7ed;color:#c2410c;}' +
        '.wcr-badge.late{background:#fee2e2;color:#b91c1c;}' +
        '.wcr-badge.ok{background:#dcfce7;color:#166534;}' +
        '.wcr-bar{height:6px;background:#f1f5f9;border-radius:99px;margin-top:8px;overflow:hidden;}' +
        '.wcr-bar i{display:block;height:100%;background:#22c55e;}' +
        '.wcr-empty{text-align:center;color:#94a3b8;padding:30px 10px;font-size:13px;}';
        document.head.appendChild(st);
    }

    // ---------- data ----------
    async function loadAll() {
        var snap = await ref().once('value');
        var arr = [];
        snap.forEach(function (c) {
            var v = c.val();
            if (!v) return;
            v.id = c.key;
            var pays = v.payments ? Object.keys(v.payments).map(function (k) { return Object.assign({ id: k }, v.payments[k]); }) : [];
            pays.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
            v.pays = pays;
            v.paid = pays.reduce(function (s, p) { return s + num(p.amount); }, 0);
            v.balance = Math.max(0, num(v.total) - v.paid);
            arr.push(v);
        });
        return arr;
    }
    function isLate(c) { return c.balance > 0 && c.dueDate && c.dueDate < dayKey(new Date()); }

    function totals(list) {
        var t = { owed: 0, people: 0, overdue: 0, overdueCount: 0 };
        list.forEach(function (c) {
            if (c.balance > 0) { t.owed += c.balance; t.people++; }
            if (isLate(c)) { t.overdue += c.balance; t.overdueCount++; }
        });
        return t;
    }

    // ---------- the Credit Book page ----------
    window.wcrShowCreditBook = async function () {
        var ws = $('workspace-content');
        if (!ws) return;
        addStyles();
        ws.innerHTML =
        '<div class="wcr">' +
            '<h2>🧾 Credit Book</h2>' +
            '<div class="wcr-sub">Who owes you, how much, and when it is due.</div>' +
            '<div class="wcr-tiles">' +
                '<div class="wcr-tile"><small>Owed to you</small><b id="wcr-t-owed">₦0</b></div>' +
                '<div class="wcr-tile"><small>Debtors</small><b id="wcr-t-people">0</b></div>' +
                '<div class="wcr-tile"><small>Overdue</small><b id="wcr-t-over" style="color:#b91c1c;">₦0</b></div>' +
            '</div>' +
            '<button class="wcr-add" onclick="wcrOpenAdd()">➕ New Credit Sale</button>' +
            '<input id="wcr-search" class="wcr-search" placeholder="Search name, phone or item…" oninput="wcrSearch(this.value)">' +
            '<div class="wcr-tabs" id="wcr-tabs"></div>' +
            '<div id="wcr-list"><div class="wcr-empty">Loading…</div></div>' +
        '</div>';
        $('wcr-search').value = query;
        try { cache = await loadAll(); } catch (e) { var l = $('wcr-list'); if (l) l.innerHTML = '<div class="wcr-empty">Could not load: ' + esc(e.message) + '</div>'; return; }
        renderList();
    };

    window.wcrSearch = function (v) { query = String(v || ''); renderList(); };
    window.wcrTab = function (t) { tab = t; renderList(); };

    function renderList() {
        var listEl = $('wcr-list');
        if (!listEl) return;
        var t = totals(cache);
        var set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
        set('wcr-t-owed', money(t.owed));
        set('wcr-t-people', String(t.people));
        set('wcr-t-over', money(t.overdue));

        var tabsEl = $('wcr-tabs');
        if (tabsEl) {
            var tabs = [['owing', 'Owing'], ['cleared', 'Cleared'], ['all', 'All']];
            tabsEl.innerHTML = tabs.map(function (x) {
                return '<button class="' + (tab === x[0] ? 'on' : '') + '" onclick="wcrTab(\'' + x[0] + '\')">' + x[1] + '</button>';
            }).join('');
        }

        var q = query.toLowerCase().trim();
        var rows = cache.filter(function (c) {
            if (tab === 'owing' && !(c.balance > 0)) return false;
            if (tab === 'cleared' && c.balance > 0) return false;
            if (!q) return true;
            return (String(c.customer || '') + ' ' + String(c.phone || '') + ' ' + String(c.note || '')).toLowerCase().indexOf(q) !== -1;
        });
        rows.sort(function (a, b) {
            if (isLate(a) !== isLate(b)) return isLate(a) ? -1 : 1;
            return b.balance - a.balance;
        });

        if (rows.length === 0) {
            listEl.innerHTML = '<div class="wcr-empty">' + (cache.length === 0 ? 'No credit sales yet. Tap “New Credit Sale” to add the first one.' : 'Nothing here.') + '</div>';
            return;
        }
        listEl.innerHTML = rows.map(function (c) {
            var late = isLate(c), done = !(c.balance > 0);
            var pct = num(c.total) > 0 ? Math.min(100, Math.round((c.paid / num(c.total)) * 100)) : 0;
            var badge = done ? '<span class="wcr-badge ok">Cleared</span>'
                : (late ? '<span class="wcr-badge late">Overdue · ' + esc(fmtDate(c.dueDate)) + '</span>'
                : (c.dueDate ? '<span class="wcr-badge">Due ' + esc(fmtDate(c.dueDate)) + '</span>' : '<span class="wcr-badge">No due date</span>'));
            return '<div class="wcr-card' + (late ? ' late' : '') + (done ? ' done' : '') + '" onclick="wcrOpen(\'' + esc(c.id) + '\')">' +
                '<div class="wcr-top"><div><div class="wcr-name">' + esc(c.customer) + '</div>' +
                    (c.note ? '<div class="wcr-note">' + esc(c.note) + '</div>' : '') + '</div>' +
                    '<div class="wcr-bal">' + (done ? '✓ ' + money(c.total) : money(c.balance)) + '</div></div>' +
                '<div class="wcr-bar"><i style="width:' + pct + '%"></i></div>' +
                '<div class="wcr-meta"><span>Paid ' + money(c.paid) + ' of ' + money(c.total) + '</span>' + badge + '</div>' +
            '</div>';
        }).join('');
    }

    // ---------- modal shell ----------
    var INP = 'width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;';
    var LBL = 'display:block;font-size:11px;font-weight:800;color:#334155;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.4px;';
    function openModal(inner) {
        var m = $('wcr-modal'); if (m) m.remove();
        m = document.createElement('div');
        m.id = 'wcr-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:1800;display:flex;justify-content:center;align-items:flex-end;';
        m.innerHTML = '<div style="background:#f8fafc;color:#0f172a;width:100%;max-width:520px;max-height:94vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:18px 16px 22px;box-sizing:border-box;">' + inner + '</div>';
        m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
        document.body.appendChild(m);
    }
    window.wcrClose = function () { var m = $('wcr-modal'); if (m) m.remove(); };
    function head(title) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><h3 style="margin:0;font-size:18px;">' + title + '</h3>' +
               '<button onclick="wcrClose()" style="border:none;background:#e2e8f0;border-radius:99px;width:34px;height:34px;font-size:16px;cursor:pointer;">✕</button></div>';
    }
    function errBox() { return '<div id="wcr-err" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px;border-radius:10px;font-size:13px;margin-top:12px;"></div>'; }
    function fail(m) { var e = $('wcr-err'); if (e) { e.textContent = m; e.style.display = 'block'; } }

    // ---------- new credit sale ----------
    window.wcrOpenAdd = function () {
        openModal(
            head('➕ New Credit Sale') +
            '<div style="font-size:12px;color:#64748b;">Record goods a customer took and has not fully paid for.</div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;">' +
                '<label style="' + LBL + '">Customer name</label><input id="wcr-c-name" style="' + INP + '" placeholder="e.g. Mr. Okafor">' +
                '<label style="' + LBL + '">Phone (for WhatsApp reminders)</label><input id="wcr-c-phone" type="tel" inputmode="tel" style="' + INP + '" placeholder="08012345678">' +
                '<label style="' + LBL + '">What they took</label><input id="wcr-c-note" style="' + INP + '" placeholder="e.g. 20 roofing sheets + 2 bags nails">' +
            '</div>' +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;">' +
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
                    '<div><label style="' + LBL + '">Total amount</label><input id="wcr-c-total" type="number" min="0" inputmode="decimal" style="' + INP + '" placeholder="₦"></div>' +
                    '<div><label style="' + LBL + '">Paid now (optional)</label><input id="wcr-c-dep" type="number" min="0" inputmode="decimal" style="' + INP + '" placeholder="₦0"></div>' +
                '</div>' +
                '<label style="' + LBL + '">Promised to pay by (optional)</label><input id="wcr-c-due" type="date" style="' + INP + '">' +
            '</div>' +
            errBox() +
            '<button onclick="wcrSaveAdd()" style="width:100%;margin-top:14px;padding:15px;border:none;border-radius:14px;font-size:16px;font-weight:800;color:#fff;background:linear-gradient(135deg,#f97316 0%,#c2410c 100%);cursor:pointer;">Save Credit Sale</button>'
        );
    };

    window.wcrSaveAdd = async function () {
        var name = ($('wcr-c-name').value || '').trim();
        var total = num($('wcr-c-total').value);
        var dep = num($('wcr-c-dep').value);
        if (!name) return fail('Enter the customer name.');
        if (total <= 0) return fail('Enter the total amount.');
        if (dep < 0 || dep > total) return fail('"Paid now" cannot be more than the total.');
        try {
            var node = ref().push();
            var nowIso = new Date().toISOString();
            await node.set({
                customer: name,
                phone: ($('wcr-c-phone').value || '').trim(),
                note: ($('wcr-c-note').value || '').trim(),
                total: total,
                dueDate: $('wcr-c-due').value || '',
                createdAt: nowIso,
                createdBy: who()
            });
            if (dep > 0) await node.child('payments').push({ amount: dep, date: nowIso, by: who(), note: 'Paid at time of sale' });
            wcrClose();
            await refresh();
        } catch (e) { fail('Could not save: ' + (e.message || e)); }
    };

    async function refresh() {
        try { cache = await loadAll(); } catch (e) { return; }
        if ($('wcr-list')) renderList();
        var card = $('wcr-dash-card'); if (card) fillDashCard(card);
    }

    // ---------- debtor details + payment ----------
    window.wcrOpen = function (id) {
        var c = cache.filter(function (x) { return x.id === id; })[0];
        if (!c) return;
        var late = isLate(c), owing = c.balance > 0;
        var pays = c.pays.length === 0 ? '<div style="font-size:12px;color:#94a3b8;padding:6px 0;">No payments yet.</div>'
            : c.pays.map(function (p) {
                return '<div style="display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">' +
                    '<div>' + esc(fmtDate(p.date)) + '<span style="display:block;font-size:11px;color:#64748b;">' + esc(p.note || '') + (p.by ? ' · ' + esc(p.by) : '') + '</span></div>' +
                    '<strong style="color:#16a34a;">' + money(p.amount) + '</strong></div>';
            }).join('');
        openModal(
            head(esc(c.customer)) +
            (c.phone ? '<div style="font-size:13px;color:#475569;">📞 ' + esc(c.phone) + '</div>' : '') +
            (c.note ? '<div style="font-size:13px;color:#64748b;margin-top:2px;">' + esc(c.note) + '</div>' : '') +
            '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;">' +
                '<div class="wcr-tile"><small>Total</small><b>' + money(c.total) + '</b></div>' +
                '<div class="wcr-tile"><small>Paid</small><b style="color:#16a34a;">' + money(c.paid) + '</b></div>' +
                '<div class="wcr-tile"><small>Balance</small><b style="color:' + (owing ? '#c2410c' : '#16a34a') + ';">' + money(c.balance) + '</b></div>' +
            '</div>' +
            (c.dueDate ? '<div style="margin-top:8px;font-size:12px;color:' + (late ? '#b91c1c' : '#64748b') + ';font-weight:700;">' + (late ? '⚠️ Overdue — was due ' : 'Due ') + esc(fmtDate(c.dueDate)) + '</div>' : '') +
            '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:10px 14px;margin-top:12px;"><div style="font-weight:800;font-size:13px;margin-bottom:2px;">Payments</div>' + pays + '</div>' +
            (owing
                ? '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:12px;">' +
                    '<label style="' + LBL + '">Record a payment</label>' +
                    '<input id="wcr-p-amt" type="number" min="0" inputmode="decimal" style="' + INP + '" placeholder="₦ amount (balance ' + money(c.balance) + ')">' +
                    '<input id="wcr-p-note" style="' + INP + 'margin-top:8px;" placeholder="Note (optional) e.g. bank transfer">' +
                    errBox() +
                    '<button onclick="wcrSavePay(\'' + esc(c.id) + '\')" style="width:100%;margin-top:10px;padding:14px;border:none;border-radius:12px;font-size:15px;font-weight:800;color:#fff;background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);cursor:pointer;">Save Payment</button>' +
                  '</div>' +
                  '<button onclick="wcrRemind(\'' + esc(c.id) + '\')" style="width:100%;margin-top:10px;padding:13px;border:1px solid #bbf7d0;border-radius:12px;font-size:14px;font-weight:800;color:#15803d;background:#f0fdf4;cursor:pointer;">💬 Send WhatsApp reminder</button>'
                : '<div style="text-align:center;margin-top:12px;font-weight:800;color:#16a34a;">✅ Fully paid</div>')
        );
    };

    window.wcrSavePay = async function (id) {
        var c = cache.filter(function (x) { return x.id === id; })[0];
        if (!c) return;
        var amt = num($('wcr-p-amt').value);
        if (amt <= 0) return fail('Enter the amount paid.');
        if (amt > c.balance) return fail('That is more than the balance of ' + money(c.balance) + '.');
        try {
            await ref(id + '/payments').push({ amount: amt, date: new Date().toISOString(), by: who(), note: ($('wcr-p-note').value || '').trim() });
            wcrClose();
            await refresh();
            var again = cache.filter(function (x) { return x.id === id; })[0];
            if (again && again.balance <= 0) alert('✅ ' + again.customer + ' has cleared the full balance.');
        } catch (e) { fail('Could not save: ' + (e.message || e)); }
    };

    // ---------- WhatsApp reminder ----------
    function waNumber(p) {
        var d = String(p || '').replace(/\D/g, '');
        if (!d) return '';
        if (d.indexOf('234') === 0) return d;
        if (d.charAt(0) === '0') return '234' + d.slice(1);
        return d;
    }
    window.wcrRemind = function (id) {
        var c = cache.filter(function (x) { return x.id === id; })[0];
        if (!c) return;
        var store = (typeof currentStoreName !== 'undefined' && currentStoreName) ? currentStoreName : 'our store';
        var msg = 'Hello ' + c.customer + ', this is a friendly reminder from ' + store + '. ' +
                  'You have an outstanding balance of ' + money(c.balance) + (c.note ? ' for ' + c.note : '') +
                  (c.dueDate ? ', due ' + fmtDate(c.dueDate) : '') + '. Kindly make payment when you can. Thank you!';
        var n = waNumber(c.phone);
        var url = 'https://wa.me/' + (n ? n : '') + '?text=' + encodeURIComponent(msg);
        window.open(url, '_blank');
    };

    // ---------- dashboard card + sidebar button ----------
    function fillDashCard(card) {
        var t = totals(cache);
        card.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
                '<div><div style="font-size:11px;font-weight:800;color:#9a3412;text-transform:uppercase;letter-spacing:.4px;">🧾 Credit Book</div>' +
                '<div style="font-size:18px;font-weight:800;color:#c2410c;margin-top:2px;">' + money(t.owed) + ' <span style="font-size:12px;font-weight:600;color:#9a3412;">owed to you</span></div>' +
                '<div style="font-size:11px;color:#9a3412;margin-top:2px;">' + t.people + ' debtor' + (t.people === 1 ? '' : 's') + (t.overdueCount ? ' · <b style="color:#b91c1c;">' + t.overdueCount + ' overdue</b>' : '') + '</div></div>' +
                '<div style="font-size:22px;">›</div>' +
            '</div>';
    }

    function injectDashCard() {
        if (!isMat() || !sid()) return;
        var grid = document.querySelector('.wdd-actions');
        if (!grid || $('wcr-dash-card')) return;
        var card = document.createElement('div');
        card.id = 'wcr-dash-card';
        card.style.cssText = 'background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;border-radius:14px;padding:12px 14px;margin-bottom:12px;cursor:pointer;';
        card.onclick = function () { wcrShowCreditBook(); };
        card.innerHTML = '<div style="font-size:13px;color:#9a3412;">Loading Credit Book…</div>';
        grid.parentNode.insertBefore(card, grid.nextSibling);
        loadAll().then(function (a) { cache = a; fillDashCard(card); }).catch(function () {
            card.innerHTML = '<div style="font-size:13px;font-weight:700;color:#9a3412;">🧾 Open Credit Book ›</div>';
        });
    }

    function injectSidebarBtn() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar');
        if (!side) return;
        var existing = $('wcr-sidebar-btn');
        var admin = (typeof currentUserRole !== 'undefined') && currentUserRole === 'Admin' && sid() && sid() !== 'SUPER_ADMIN';
        if (!isMat() || !admin) { if (existing) existing.remove(); return; }
        if (existing) return;
        var anchor = $('wdm-sidebar-wastage-btn') || $('wdm-sidebar-newsale-btn') || $('wdm-sidebar-materials-btn');
        if (!anchor) return;
        var b = document.createElement('button');
        b.id = 'wcr-sidebar-btn';
        b.className = 'menu-btn';
        b.textContent = '🧾 Credit Book';
        b.onclick = function () { wcrShowCreditBook(); };
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }

    function addSidebarCss() {
        if ($('wcr-sidebar-css')) return;
        var st = document.createElement('style');
        st.id = 'wcr-sidebar-css';
        st.textContent = 'body.wdd-mat #dashboard-main-wrapper .sidebar #wcr-sidebar-btn{background:#ecfdf5 !important;color:#047857 !important;border-color:#a7f3d0 !important;border-left-color:#10b981 !important;}';
        document.head.appendChild(st);
    }

    function attach() {
        try { addSidebarCss(); injectSidebarBtn(); injectDashCard(); } catch (e) { console.warn('[credit-patch]', e); }
    }

    window.addEventListener('load', function () {
        setTimeout(attach, 1400);
        var obs = new MutationObserver(function () { attach(); });
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    });
})();
