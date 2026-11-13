// ==================== WISE DECISION MATERIALS MODERN REDESIGN (v1) ====================
// Load LAST (after materials-simple-theme-patch.js and every other materials patch).
//
// For building-materials / hardware stores only (body.wdd-mat). Adds:
//   1. A new look: dark graphite sidebar, warm light pages, one bold accent colour.
//      4 palettes the owner can switch (Graphite & Amber, Emerald, Cobalt, Mono) - saved per store.
//   2. A new dashboard with the BUSINESS LOGO + name in the header (and a small logo in the sidebar).
//   3. Common Materials is removed (button + popup).
//   4. Categories you control: add / remove them on a Categories page. They appear in the
//      product form (category field) and as filter chips on the Inventory screen.
//   5. New look for Inventory (cards on phones), POS / Sale and Settings screens.
//
// Data: stores/{storeId}/matCategories/{id} = { name }   and   stores/{storeId}/matTheme = 'amber'|...
// Logo : read from stores/{storeId}/logo (the same field Business Settings saves).
//
// Sidebar buttons "Categories" / "Appearance" only show if 'categories' and 'appearance' are added to the
// keep: [...] list of 'materials' and 'hardware' in vertical-first-patch.js. They are ALSO on the dashboard
// and on the Inventory screen, so nothing depends on it.

console.log("Wise Decision materials-modern-patch.js — v1 loaded");

(function () {
    'use strict';

    // ---------- helpers ----------
    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function num(n) { return Number(n) || 0; }
    function money(n) { n = Math.round(num(n)); return window.formatMoney ? window.formatMoney(n) : '₦' + n.toLocaleString(); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function isMat() { return (typeof wdmIsMaterialsStore === 'function') && wdmIsMaterialsStore(); }
    function full() { return (typeof window.wdFullAccess === 'function') ? window.wdFullAccess() : (typeof currentUserRole !== 'undefined' && String(currentUserRole).toLowerCase() === 'admin'); }
    function db() { return firebase.database(); }
    function branchId() { return (typeof currentBranch !== 'undefined' && currentBranch) ? currentBranch : 'main'; }
    function who() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
    function timeout(p, ms) {
        return new Promise(function (res, rej) {
            var t = setTimeout(function () { rej(new Error('The connection is slow. Please try again.')); }, ms);
            p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
        });
    }

    // ---------- palettes ----------
    var THEMES = {
        amber:   { n: 'Graphite & Amber', a: '#15171c', b: '#f5b301' },
        emerald: { n: 'Emerald',          a: '#0c1a16', b: '#34d399' },
        cobalt:  { n: 'Cobalt',           a: '#0d1424', b: '#60a5fa' },
        mono:    { n: 'Black & White',    a: '#0a0a0a', b: '#ffffff' }
    };
    var theme = 'amber';
    var themeFor = null;

    function applyTheme(t) {
        if (!THEMES[t]) t = 'amber';
        theme = t;
        if (document.body) document.body.setAttribute('data-wmx-theme', t);
    }
    function loadTheme() {
        var s = sid();
        if (!s || s === 'SUPER_ADMIN' || themeFor === s) return;
        themeFor = s;
        try { var t = localStorage.getItem('wmx-theme-' + s); if (t) applyTheme(t); } catch (e) { /* ignore */ }
        try {
            db().ref('stores/' + s + '/matTheme').once('value').then(function (x) {
                var v = x.val();
                if (v && THEMES[v]) { applyTheme(v); try { localStorage.setItem('wmx-theme-' + s, v); } catch (e) { /* ignore */ } }
            }).catch(function () { /* rules may not allow: local copy still works */ });
        } catch (e) { /* ignore */ }
    }
    window.wmxSetTheme = function (t) {
        applyTheme(t);
        var s = sid();
        try { localStorage.setItem('wmx-theme-' + s, t); } catch (e) { /* ignore */ }
        try { db().ref('stores/' + s + '/matTheme').set(t).catch(function () { /* ignore */ }); } catch (e) { /* ignore */ }
        paintThemeModal();
    };
    window.wmxOpenTheme = function () {
        var m = $('wmx-theme-modal'); if (m) m.remove();
        m = document.createElement('div');
        m.id = 'wmx-theme-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(10,12,16,.6);z-index:1900;display:flex;justify-content:center;align-items:flex-end;';
        m.innerHTML = '<div class="wmx-sheet"><div class="wmx-sheet-h"><b>Appearance</b><button onclick="document.getElementById(\'wmx-theme-modal\').remove()">✕</button></div>' +
            '<div class="wmx-sheet-s">Pick the colours for your store. It is saved for everyone who uses this store.</div><div id="wmx-themes"></div></div>';
        m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
        document.body.appendChild(m);
        paintThemeModal();
    };
    function paintThemeModal() {
        var box = $('wmx-themes'); if (!box) return;
        box.innerHTML = Object.keys(THEMES).map(function (k) {
            var t = THEMES[k];
            return '<button class="wmx-sw' + (k === theme ? ' on' : '') + '" onclick="wmxSetTheme(\'' + k + '\')">' +
                '<span class="wmx-sw-c"><i style="background:' + t.a + '"></i><i style="background:' + t.b + ';border:1px solid #d1d5db"></i></span>' +
                '<span class="wmx-sw-n">' + esc(t.n) + '</span><span class="wmx-sw-k">' + (k === theme ? '✓' : '') + '</span></button>';
        }).join('');
    }

    // ---------- brand (logo + name) ----------
    var brand = { logo: '', name: '', for: null };
    async function loadBrand() {
        var s = sid();
        if (!s || s === 'SUPER_ADMIN' || brand.for === s) return;
        brand.for = s;
        try {
            var r = await Promise.all([
                db().ref('stores/' + s + '/logo').once('value'),
                db().ref('stores/' + s + '/businessName').once('value')
            ]);
            var l = r[0].val();
            brand.logo = (typeof l === 'string' && /^(data:image|https?:)/i.test(l)) ? l : '';
            brand.name = String(r[1].val() || (typeof currentStoreName !== 'undefined' ? currentStoreName : '') || '');
        } catch (e) { brand.name = (typeof currentStoreName !== 'undefined' && currentStoreName) ? String(currentStoreName) : ''; }
        paintSideLogo();
        var h = $('wmx-brand'); if (h) h.innerHTML = brandHtml();
    }
    function initial() { var n = (brand.name || (typeof currentStoreName !== 'undefined' ? currentStoreName : '') || 'S').trim(); return esc(n.charAt(0).toUpperCase() || 'S'); }
    function brandHtml() {
        var name = brand.name || (typeof currentStoreName !== 'undefined' ? currentStoreName : '') || 'Your store';
        return (brand.logo ? '<img class="wmx-logo" src="' + esc(brand.logo) + '" alt="">' : '<div class="wmx-logo ph">' + initial() + '</div>') +
            '<div class="wmx-bn">' + esc(name) + '</div>';
    }
    function paintSideLogo() {
        var title = $('dashboard-store-title');
        var old = $('wmx-side-logo');
        if (!title || !isMat()) { if (old) old.remove(); return; }
        var key = brand.logo ? 'i' + brand.logo.length : 'p' + initial();
        if (old && old.getAttribute('data-k') === key) return;
        if (old) old.remove();
        var el;
        if (brand.logo) { el = document.createElement('img'); el.src = brand.logo; el.alt = ''; }
        else { el = document.createElement('div'); el.className = 'ph'; el.textContent = initial(); }
        el.id = 'wmx-side-logo'; el.setAttribute('data-k', key);
        title.parentNode.insertBefore(el, title);
    }

    // ---------- categories ----------
    var cats = [];         // managed: { id, name }
    var prodCats = {};     // category name -> number of products
    var nameCat = {};      // product name (lowercase) -> category
    var invSel = '';       // selected chip on Inventory
    var catsFor = null;

    async function loadCats() {
        var s = sid(); if (!s) return;
        var snap = await db().ref('stores/' + s + '/matCategories').once('value');
        var a = [];
        snap.forEach(function (c) { var v = c.val(); if (v && v.name) a.push({ id: c.key, name: String(v.name) }); });
        a.sort(function (x, y) { return x.name.localeCompare(y.name); });
        cats = a;
        var inv = {};
        try { inv = (await db().ref('stores/' + s + '/inventory').once('value')).val() || {}; } catch (e) { inv = {}; }
        prodCats = {}; nameCat = {};
        Object.keys(inv).forEach(function (b) {
            Object.keys(inv[b] || {}).forEach(function (id) {
                var p = inv[b][id]; if (!p || typeof p !== 'object') return;
                var c = String(p.category || '').trim(); if (!c) return;
                var nm = String(p.name || p.productName || '').toLowerCase().trim();
                prodCats[c] = (prodCats[c] || 0) + 1;
                if (nm) nameCat[nm] = c;
            });
        });
        catsFor = s;
    }
    function managedHas(name) { var k = name.toLowerCase(); return cats.some(function (c) { return c.name.toLowerCase() === k; }); }
    function allCatNames() {
        var out = cats.map(function (c) { return c.name; });
        Object.keys(prodCats).forEach(function (n) { if (!managedHas(n) && out.indexOf(n) === -1) out.push(n); });
        out.sort(function (a, b) { return a.localeCompare(b); });
        return out;
    }
    function countFor(name) {
        var k = name.toLowerCase(), n = 0;
        Object.keys(prodCats).forEach(function (c) { if (c.toLowerCase() === k) n += prodCats[c]; });
        return n;
    }

    window.wmxShowCategories = async function () {
        if (!full()) return;
        var ws = $('workspace-content'); if (!ws) return;
        ws.innerHTML =
            '<div class="wmx-wrap">' +
                '<div class="wmx-title">Categories</div>' +
                '<div class="wmx-sub">The groups your products belong to (roofing, boards, paint…). Add the ones you sell, remove the ones you don’t.</div>' +
                '<div class="wmx-add"><input id="wmx-cat-in" placeholder="New category name…" maxlength="40" onkeydown="if(event.key===\'Enter\')wmxAddCat()"><button onclick="wmxAddCat()">Add</button></div>' +
                '<div id="wmx-cat-err" class="wmx-err" style="display:none"></div>' +
                '<div id="wmx-cat-list"><div class="wmx-empty">Loading…</div></div>' +
            '</div>';
        try { await loadCats(); } catch (e) { var l = $('wmx-cat-list'); if (l) l.innerHTML = '<div class="wmx-empty">Could not load: ' + esc(e.message) + '</div>'; return; }
        paintCats();
    };
    function catErr(m) { var e = $('wmx-cat-err'); if (e) { e.textContent = m; e.style.display = m ? 'block' : 'none'; } }
    function paintCats() {
        var el = $('wmx-cat-list'); if (!el) return;
        var rows = [];
        cats.forEach(function (c) { rows.push({ id: c.id, name: c.name, managed: true }); });
        Object.keys(prodCats).forEach(function (n) { if (!managedHas(n)) rows.push({ id: '', name: n, managed: false }); });
        rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
        if (rows.length === 0) { el.innerHTML = '<div class="wmx-empty">No categories yet. Type a name above and tap Add.</div>'; return; }
        el.innerHTML = rows.map(function (r) {
            var n = countFor(r.name);
            return '<div class="wmx-catrow"><div><div class="wmx-cn">' + esc(r.name) + '</div><div class="wmx-cs">' + n + ' product' + (n === 1 ? '' : 's') + (r.managed ? '' : ' · found on your products') + '</div></div>' +
                (r.managed
                    ? '<button class="wmx-rm" data-id="' + esc(r.id) + '" data-n="' + esc(r.name) + '" onclick="wmxRemoveCat(this.dataset.id,this.dataset.n)">Remove</button>'
                    : '<button class="wmx-sv" data-n="' + esc(r.name) + '" onclick="wmxSaveCat(this.dataset.n)">Save to list</button>') +
                '</div>';
        }).join('');
    }
    window.wmxAddCat = async function () {
        var inp = $('wmx-cat-in'); if (!inp) return;
        var name = (inp.value || '').trim().replace(/\s+/g, ' ');
        if (!name) return catErr('Type the category name.');
        if (managedHas(name)) return catErr('“' + name + '” is already in your list.');
        catErr('');
        try {
            await db().ref('stores/' + sid() + '/matCategories').push({ name: name, createdAt: new Date().toISOString(), createdBy: who() });
            inp.value = '';
            await loadCats(); paintCats(); refreshCatUI();
        } catch (e) { catErr('Could not save: ' + (e.message || e)); }
    };
    window.wmxSaveCat = async function (name) {
        if (!name || managedHas(name)) return;
        try {
            await db().ref('stores/' + sid() + '/matCategories').push({ name: name, createdAt: new Date().toISOString(), createdBy: who() });
            await loadCats(); paintCats(); refreshCatUI();
        } catch (e) { catErr('Could not save: ' + (e.message || e)); }
    };
    window.wmxRemoveCat = async function (id, name) {
        var n = countFor(name);
        var msg = 'Remove “' + name + '” from your list?' + (n ? '\n\n' + n + ' product' + (n === 1 ? ' still uses' : 's still use') + ' it. They keep the label until you edit them.' : '');
        if (!confirm(msg)) return;
        try {
            await db().ref('stores/' + sid() + '/matCategories/' + id).remove();
            if (invSel && invSel.toLowerCase() === name.toLowerCase()) invSel = '';
            await loadCats(); paintCats(); refreshCatUI();
        } catch (e) { catErr('Could not remove: ' + (e.message || e)); }
    };
    function setFormCat(name) {
        var m = $('product-form-modal');
        var el = m && m.querySelector('select[id*="categ" i], input[id*="categ" i]');
        if (!el) return;
        if (el.tagName === 'SELECT') {
            var has = Array.prototype.some.call(el.options, function (o) { return o.value === name; });
            if (!has) { var o = document.createElement('option'); o.value = name; o.textContent = name; el.appendChild(o); }
        }
        el.value = name;
    }
    window.wmxNewCat = async function (fromForm) {
        if (!full()) { alert('Only the owner or manager can add categories.'); return; }
        var name = (prompt('New category name') || '').trim().replace(/\s+/g, ' ');
        if (!name) return;
        try {
            if (!managedHas(name)) {
                await db().ref('stores/' + sid() + '/matCategories').push({ name: name, createdAt: new Date().toISOString(), createdBy: who() });
                await loadCats();
            }
            refreshCatUI();
            if (fromForm) { hookCategoryField(); setFormCat(name); }
            injectInvBar();
            if ($('wmx-cat-list')) paintCats();
        } catch (e) { alert('Could not save: ' + (e.message || e)); }
    };
    function refreshCatUI() {
        var bar = $('wmx-inv-bar'); if (bar) bar.remove();
        var m = $('product-form-modal');
        if (m) { var el = m.querySelector('select[data-wmx]'); if (el) el.removeAttribute('data-wmx'); }
    }

    // product form: make the category field use YOUR categories
    function hookCategoryField() {
        var m = $('product-form-modal'); if (!m || catsFor !== sid()) return;
        var el = m.querySelector('select[id*="categ" i], input[id*="categ" i]');
        if (!el) return;
        var names = allCatNames();
        if (full() && !m.querySelector('.wmx-newcat')) {
            var nb = document.createElement('button');
            nb.type = 'button'; nb.className = 'wmx-newcat'; nb.textContent = '＋ New category';
            nb.onclick = function () { wmxNewCat(true); };
            el.parentNode.insertBefore(nb, el.nextSibling);
        }
        if (el.tagName === 'SELECT') {
            var sig = names.join('|');
            if (el.getAttribute('data-wmx') === sig) return;
            var cur = el.value;
            var list = names.slice();
            if (cur && list.indexOf(cur) === -1) list.push(cur);
            el.innerHTML = '<option value="">No category</option>' + list.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
            el.value = cur;
            el.setAttribute('data-wmx', sig);
        } else {
            var dl = $('wmx-cat-dl');
            if (!dl) { dl = document.createElement('datalist'); dl.id = 'wmx-cat-dl'; document.body.appendChild(dl); }
            dl.innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
            if (el.getAttribute('list') !== 'wmx-cat-dl') el.setAttribute('list', 'wmx-cat-dl');
        }
    }

    // inventory: category chips + search-friendly filter
    function injectInvBar() {
        var v = $('inventory-view'); if (!v || catsFor !== sid()) return;
        var names = allCatNames();
        var old = $('wmx-inv-bar');
        var sig = names.join('|') + '#' + invSel;
        if (old && old.getAttribute('data-sig') === sig) return;
        if (old) old.remove();
        var bar = document.createElement('div');
        bar.id = 'wmx-inv-bar';
        bar.setAttribute('data-sig', sig);
        var total = 0; Object.keys(prodCats).forEach(function (k) { total += prodCats[k]; });
        bar.innerHTML =
            '<div class="wmx-chips">' +
                '<button class="' + (invSel ? '' : 'on') + '" data-c="" onclick="wmxPickCat(this.dataset.c)">All</button>' +
                names.map(function (n) { return '<button class="' + (invSel === n ? 'on' : '') + '" data-c="' + esc(n) + '" onclick="wmxPickCat(this.dataset.c)">' + esc(n) + ' <em>' + countFor(n) + '</em></button>'; }).join('') +
                (full() ? '<button class="wmx-manage" onclick="wmxNewCat(false)">＋ New</button><button class="wmx-manage" onclick="wmxShowCategories()">🏷️ Manage / delete</button>' : '') +
            '</div>';
        v.insertBefore(bar, v.firstChild);
        applyInvFilter();
    }
    window.wmxPickCat = function (c) { invSel = c || ''; var b = $('wmx-inv-bar'); if (b) b.remove(); injectInvBar(); };
    function applyInvFilter() {
        var v = $('inventory-view'); if (!v) return;
        var rows = v.querySelectorAll('tbody tr');
        if (!invSel) { rows.forEach(function (r) { if (r.getAttribute('data-wmx-h')) { r.style.removeProperty('display'); r.removeAttribute('data-wmx-h'); } }); return; }
        var k = invSel.toLowerCase();
        var names = Object.keys(nameCat).filter(function (n) { return String(nameCat[n]).toLowerCase() === k; });
        rows.forEach(function (r) {
            var t = (r.textContent || '').toLowerCase();
            var ok = names.some(function (n) { return t.indexOf(n) !== -1; });
            if (ok) { if (r.getAttribute('data-wmx-h')) { r.style.removeProperty('display'); r.removeAttribute('data-wmx-h'); } }
            else { r.style.setProperty('display', 'none', 'important'); r.setAttribute('data-wmx-h', '1'); }
        });
    }

    // Common Materials is gone
    var wmxNoop = function () { /* Common Materials removed for materials stores */ };
    window.wdpOpenQuickAddModal = wmxNoop;

    // ---------- dashboard ----------
    var timer = null, loading = false;

    function setActive(btn) {
        document.querySelectorAll('#dashboard-main-wrapper .sidebar .menu-btn.wds-on').forEach(function (x) { x.classList.remove('wds-on'); });
        if (btn) btn.classList.add('wds-on');
    }
    function act(icon, label, onclick, ok) {
        if (ok === false) return '';
        return '<button class="wmx-act" onclick="' + onclick + '"><span>' + icon + '</span>' + label + '</button>';
    }

    window.wdmShowMaterialsDashboard = function () {
        if (typeof window.wdFullAccess === 'function' && !window.wdFullAccess()) {
            if (typeof switchView === 'function') switchView('pos-view');
            return;
        }
        var ws = $('workspace-content'); if (!ws) return;
        var now = new Date();
        var h = now.getHours();
        var hi = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
        var first = (typeof currentStaffName !== 'undefined' && currentStaffName) ? ', ' + esc(String(currentStaffName).split(' ')[0]) : '';
        var fn = function (n) { return typeof window[n] === 'function'; };
        ws.innerHTML =
        '<div class="wmx-wrap" id="wmx">' +
            '<div class="wmx-head">' +
                '<div class="wmx-brand" id="wmx-brand">' + brandHtml() + '</div>' +
                '<div class="wmx-headr">' +
                    '<span class="wmx-upd" id="wmx-upd"></span>' +
                    '<button class="wmx-ib" title="Appearance" onclick="wmxOpenTheme()">🎨</button>' +
                    '<button class="wmx-ib" id="wmx-refresh" title="Refresh" onclick="wmxRefresh()"><span class="wmx-spin">↻</span></button>' +
                '</div>' +
            '</div>' +
            '<div class="wmx-greet">' + hi + first + '</div>' +
            '<div class="wmx-date">' + esc(now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</div>' +
            '<div class="wmx-hero">' +
                '<div class="wmx-hero-l"><div class="wmx-hl">Sales today</div><div class="wmx-ha" id="wmx-today">₦0</div><div class="wmx-hs" id="wmx-today-sub">Loading…</div>' +
                    '<button class="wmx-cta" onclick="switchView(\'pos-view\')">＋ New sale</button></div>' +
                '<div class="wmx-bars" id="wmx-bars"></div>' +
            '</div>' +
            '<div class="wmx-tiles">' +
                '<div class="wmx-tile" onclick="switchView(\'reports-view\')"><div class="wmx-tl">This month</div><div class="wmx-tv" id="wmx-month">₦0</div></div>' +
                '<div class="wmx-tile" onclick="wmxOwed()"><div class="wmx-tl">Owed to you</div><div class="wmx-tv" id="wmx-owed">₦0</div><div class="wmx-ts" id="wmx-owed-s"></div></div>' +
                '<div class="wmx-tile" onclick="wmxLow()"><div class="wmx-tl">Low stock</div><div class="wmx-tv" id="wmx-low">0</div><div class="wmx-ts">items to reorder</div></div>' +
            '</div>' +
            '<div class="wmx-acts">' +
                act('📦', 'Stock', "switchView('inventory-view')") +
                act('🏷️', 'Categories', 'wmxShowCategories()') +
                act('🧾', 'Credit book', 'wcrShowCreditBook()', fn('wcrShowCreditBook')) +
                act('📄', 'Quotes', 'wcqShowQuotes()', fn('wcqShowQuotes')) +
                act('📋', 'Reorder', 'wrqShowReorder()', fn('wrqShowReorder')) +
                act('🔨', 'Wastage', 'wdmShowWastageLog()', fn('wdmShowWastageLog')) +
                act('🚚', 'Suppliers', "switchView('suppliers-view')") +
                act('🎨', 'Appearance', 'wmxOpenTheme()') +
            '</div>' +
            '<div class="wmx-card"><div class="wmx-ch"><b>Recent sales</b><button class="wmx-link" onclick="switchView(\'reports-view\')">View all ›</button></div><div id="wmx-recent"><div class="wmx-empty">Loading…</div></div></div>' +
        '</div>';
        setActive($('wdm-sidebar-materials-btn'));
        loadBrand();
        load();
        if (timer) clearInterval(timer);
        timer = setInterval(function () { if ($('wmx') && !document.hidden) load(); else if (!$('wmx')) { clearInterval(timer); timer = null; } }, 60000);
    };
    var wmxDashFn = window.wdmShowMaterialsDashboard;
    window.wmxRefresh = function () { load(); };
    window.wmxOwed = function () { if (typeof wcrShowCreditBook === 'function') wcrShowCreditBook(); else switchView('customers-view'); };
    window.wmxLow = function () { if (typeof wrqShowReorder === 'function') wrqShowReorder(); else switchView('inventory-view'); };
    window.wmxOpenSale = function (id) { if (id && typeof viewPastReceipt === 'function') viewPastReceipt(id); };

    function busy(on) { var b = $('wmx-refresh'); if (b) { b.classList.toggle('wmx-busy', !!on); b.disabled = !!on; } }

    async function load() {
        if (loading || !$('wmx') || !sid()) return;
        loading = true; busy(true);
        try {
            var s = sid(), base = 'stores/' + s, branch = branchId();
            var now = new Date();
            var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            var weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
            var from = new Date(Math.min(monthStart.getTime(), weekStart.getTime())); from.setHours(0, 0, 0, 0);

            var r = await timeout(Promise.all([
                db().ref(base + '/transactions').orderByChild('date').startAt(from.toISOString()).once('value'),
                db().ref(base + '/transactions').orderByChild('date').limitToLast(40).once('value'),
                db().ref(base + '/inventory/' + branch).once('value'),
                db().ref(base + '/matCredit').once('value').catch(function () { return null; })
            ]), 25000);

            var todayKey = now.toDateString();
            var days = [];
            for (var i = 6; i >= 0; i--) {
                var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
                days.push({ key: d.toDateString(), label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2), total: 0, today: i === 0 });
            }
            var sToday = 0, nToday = 0, costToday = 0, haveCost = false, month = 0;
            r[0].forEach(function (c) {
                var tx = c.val();
                if (!tx || !tx.date || (tx.branchId || 'main') !== branch) return;
                var d = new Date(tx.date); if (isNaN(d)) return;
                var net = num(tx.totalAmount) - num(tx.refundedAmount);
                var dk = d.toDateString();
                if (dk === todayKey) {
                    sToday += net; nToday++;
                    (tx.items || []).forEach(function (it) { if (it && it.lineCost !== undefined && it.lineCost !== null) { haveCost = true; costToday += num(it.lineCost); } });
                }
                if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) month += net;
                days.forEach(function (x) { if (x.key === dk) x.total += net; });
            });
            var recent = [];
            r[1].forEach(function (c) { var tx = c.val(); if (tx && tx.date && (tx.branchId || 'main') === branch) recent.push(tx); });
            recent.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
            recent = recent.slice(0, 10);

            var low = 0;
            r[2].forEach(function (c) {
                var p = c.val(); if (!p || typeof p !== 'object') return;
                var stock = num(p.stock !== undefined ? p.stock : p.stockQty);
                var thr = (p.lowStockThreshold !== null && p.lowStockThreshold !== undefined) ? Number(p.lowStockThreshold) : 5;
                if (stock <= thr) low++;
            });
            var owed = 0, owedN = 0;
            if (r[3]) r[3].forEach(function (c) {
                var x = c.val(); if (!x) return;
                var paid = 0; Object.keys(x.payments || {}).forEach(function (k) { paid += num(x.payments[k].amount); });
                var bal = num(x.total) - paid; if (bal > 0) { owed += bal; owedN++; }
            });

            if (!$('wmx')) return;
            var set = function (id, v) { var e = $(id); if (e) e.textContent = v; };
            set('wmx-today', money(sToday));
            var sub = nToday + ' sale' + (nToday === 1 ? '' : 's') + (nToday ? ' · avg ' + money(sToday / nToday) : '');
            if (full() && haveCost && nToday) sub += ' · profit ' + money(sToday - costToday);
            set('wmx-today-sub', nToday ? sub : 'No sales yet today');
            set('wmx-month', money(month));
            set('wmx-owed', money(owed));
            set('wmx-owed-s', owedN ? owedN + ' customer' + (owedN === 1 ? '' : 's') : 'nobody owes you');
            set('wmx-low', String(low));

            var max = Math.max.apply(null, days.map(function (x) { return x.total; }).concat([1]));
            var bars = $('wmx-bars');
            if (bars) bars.innerHTML = days.map(function (x) {
                return '<div class="wmx-bar' + (x.today ? ' t' : '') + '" title="' + esc(money(x.total)) + '"><i style="height:' + Math.max(6, Math.round((x.total / max) * 100)) + '%"></i><small>' + esc(x.label) + '</small></div>';
            }).join('');

            var rec = $('wmx-recent');
            if (rec) rec.innerHTML = recent.length === 0 ? '<div class="wmx-empty">No sales yet. Tap “New sale” to make the first one.</div>' :
                recent.map(function (tx) {
                    var off = tx.refundStatus === 'Refunded' || tx.refundStatus === 'Partially Refunded';
                    var lab = tx.refundStatus === 'Refunded' ? 'Refunded' : (tx.refundStatus === 'Partially Refunded' ? 'Part refund' : 'Paid');
                    var d = new Date(tx.date);
                    var cust = (tx.customerName && tx.customerName !== 'Walk-In Customer') ? tx.customerName : 'Walk-in';
                    var items = Array.isArray(tx.items) ? tx.items.filter(function (i) { return i && i.id !== '__delivery__'; }) : [];
                    var firstItem = items[0] ? items[0].name + (items.length > 1 ? ' +' + (items.length - 1) + ' more' : '') : '';
                    return '<div class="wmx-row" data-t="' + esc(tx.txId || '') + '" onclick="wmxOpenSale(this.dataset.t)">' +
                        '<div class="wmx-dot"></div>' +
                        '<div class="wmx-rm"><div class="wmx-rt">' + esc(firstItem || tx.txId || 'Sale') + '</div><div class="wmx-rs">' + esc(cust) + ' · ' + esc(d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) + '</div></div>' +
                        '<div class="wmx-ra"><div class="wmx-rv">' + esc(money(num(tx.totalAmount))) + '</div><span class="wmx-pill' + (off ? ' off' : '') + '">' + lab + '</span></div></div>';
                }).join('');
            set('wmx-upd', 'Updated ' + new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));
        } catch (e) {
            var rec2 = $('wmx-recent');
            if (rec2) rec2.innerHTML = '<div class="wmx-empty" style="color:#b91c1c;">Could not load: ' + esc(e.message || e) + '<br><button class="wmx-link" style="margin-top:8px" onclick="wmxRefresh()">Try again</button></div>';
            var s2 = $('wmx-today-sub'); if (s2) s2.textContent = 'Could not load';
        } finally { loading = false; busy(false); }
    }

    // ---------- sidebar buttons ----------
    function injectSidebarBtns() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar'); if (!side) return;
        var admin = full() && sid() && sid() !== 'SUPER_ADMIN';
        var defs = [['wmx-sb-cats', '🏷️ Categories', function () { wmxShowCategories(); }], ['wmx-sb-theme', '🎨 Appearance', function () { wmxOpenTheme(); }]];
        if (!isMat() || !admin) { defs.forEach(function (d) { var e = $(d[0]); if (e) e.remove(); }); return; }
        var anchor = $('wrq-sidebar-btn') || $('wcq-sidebar-btn') || $('wcr-sidebar-btn') || $('wdm-sidebar-wastage-btn') || $('wdm-sidebar-newsale-btn') || $('wdm-sidebar-materials-btn');
        if (!anchor) return;
        defs.forEach(function (d) {
            if ($(d[0])) return;
            var b = document.createElement('button');
            b.id = d[0]; b.className = 'menu-btn'; b.textContent = d[1]; b.onclick = d[2];
            anchor.parentNode.insertBefore(b, anchor.nextSibling);
            anchor = b;
        });
    }

    // ---------- CSS ----------
    function addCss() {
        if ($('wmx-css')) return;
        var P = 'body.wdd-mat.wmx ';
        var WS = P + '#workspace-content#workspace-content';
        var MD = P + '[id$="-modal"]';
        var SB = P + '#dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper .sidebar';
        var both = function (r) { return WS + ' ' + r + ',' + MD + ' ' + r; };
        var BTN = ['btn-action-primary', 'btn-dash', 'btn-pos', 'btn-inv', 'btn-acc', 'btn-rep', 'btn-exp', 'btn-staff', 'btn-cust', 'btn-supplier', 'btn-transfer', 'btn-branch', 'btn-sec', 'btn-subscription'];
        var primSel = BTN.map(function (c) { return both('.menu-btn.' + c); }).join(',');
        var primHov = BTN.map(function (c) { return both('.menu-btn.' + c + ':hover'); }).join(',');
        var TXT = ['input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([readonly])', 'select', 'textarea'];
        var fld = TXT.map(function (t) { return both(t); }).join(',');
        var fldF = TXT.map(function (t) { return both(t + ':focus'); }).join(',');
        var SET = ['#settings-view', '#business-settings-view', '#settings-modal', '#business-settings-modal', '#subscription-view'];
        var setSel = function (r) { return SET.map(function (s) { return P + s + ' ' + r; }).join(','); };

        var css = '' +
        // ----- palettes -----
        'body.wmx{--wx-side:#15171c;--wx-side-ink:#e8eaee;--wx-side-acc:#f5b301;--wx-acc:#f5b301;--wx-acc-ink:#1a1300;--wx-soft:#fff4cc;--wx-bg:#f4f3ef;--wx-surf:#ffffff;--wx-ink:#14161a;--wx-mut:#6b7280;--wx-line:#e7e4dc;--wx-hero:linear-gradient(135deg,#15171c 0%,#2b2f38 100%);}' +
        'body.wmx[data-wmx-theme=emerald]{--wx-side:#0c1a16;--wx-side-acc:#34d399;--wx-acc:#10b981;--wx-acc-ink:#ffffff;--wx-soft:#d1fae5;--wx-bg:#f1f6f4;--wx-ink:#0f1a16;--wx-line:#dbe7e2;--wx-hero:linear-gradient(135deg,#0c1a16 0%,#14412f 100%);}' +
        'body.wmx[data-wmx-theme=cobalt]{--wx-side:#0d1424;--wx-side-acc:#60a5fa;--wx-acc:#2563eb;--wx-acc-ink:#ffffff;--wx-soft:#dbeafe;--wx-bg:#f2f5fa;--wx-ink:#0d1424;--wx-line:#dde4f0;--wx-hero:linear-gradient(135deg,#0d1424 0%,#1a2c58 100%);}' +
        'body.wmx[data-wmx-theme=mono]{--wx-side:#0a0a0a;--wx-side-acc:#ffffff;--wx-acc:#111111;--wx-acc-ink:#ffffff;--wx-soft:#ececec;--wx-bg:#f5f5f5;--wx-ink:#0a0a0a;--wx-line:#e4e4e4;--wx-hero:linear-gradient(135deg,#0a0a0a 0%,#2a2a2a 100%);}' +

        // ----- remove Common Materials -----
        '#wdd-sb-common,#wdp-quick-sale-btn,#wdp-quick-modal{display:none !important;}' +

        // ----- sidebar -----
        SB + '{background:var(--wx-side) !important;border-right:none !important;box-shadow:none !important;}' +
        SB + ' #dashboard-store-title{color:#fff !important;font-weight:900 !important;letter-spacing:.2px;}' +
        SB + ' #user-role-label{color:#9aa1ad !important;font-weight:600 !important;}' +
        SB + ' #branch-badge-container span,' + SB + ' #branch-badge-container select,' + SB + ' #branch-badge-container label{background:rgba(255,255,255,.07) !important;color:var(--wx-side-ink) !important;border:1px solid rgba(255,255,255,.12) !important;border-radius:10px !important;}' +
        SB + ' .menu-btn,' + SB + ' .menu-btn.wds-on{background:transparent !important;color:var(--wx-side-ink) !important;border:none !important;border-radius:12px !important;padding:12px 14px !important;margin:0 0 4px 0 !important;font-size:14px !important;font-weight:700 !important;text-align:left !important;box-shadow:none !important;transform:none !important;}' +
        SB + ' .menu-btn:hover{background:rgba(255,255,255,.08) !important;color:#fff !important;border:none !important;}' +
        SB + ' .menu-btn.wds-on{background:rgba(255,255,255,.1) !important;color:#fff !important;box-shadow:inset 3px 0 0 var(--wx-side-acc) !important;}' +
        SB + ' .menu-btn .wds-ic{filter:brightness(0) invert(1) !important;opacity:.85;}' +
        SB + ' .btn-logout{background:transparent !important;color:#fca5a5 !important;border:1px solid rgba(252,165,165,.3) !important;margin-top:10px !important;}' +
        SB + ' .btn-logout:hover{background:rgba(252,165,165,.12) !important;}' +
        '#wmx-side-logo{display:block;width:46px;height:46px;border-radius:14px;object-fit:cover;background:#fff;margin:0 0 8px 0;flex-shrink:0;}' +
        '#wmx-side-logo.ph{display:flex;align-items:center;justify-content:center;background:var(--wx-side-acc);color:var(--wx-side);font-weight:900;font-size:20px;}' +
        '@media (max-width:767px){' + SB + '{border-bottom:1px solid rgba(255,255,255,.08) !important;}#wmx-side-logo{width:34px;height:34px;margin:0;border-radius:10px;font-size:15px;}' + SB + ' .menu-btn{margin:0 !important;white-space:nowrap !important;}' + SB + ' .menu-btn.wds-on{box-shadow:inset 0 -3px 0 var(--wx-side-acc) !important;}}' +

        // ----- page surface, headings, cards, tables, buttons, fields -----
        P + '.main-content-area,' + P + '.dashboard-layout{background:var(--wx-bg) !important;}' +
        WS + ' h2,' + WS + ' h3{color:var(--wx-ink) !important;font-weight:800 !important;letter-spacing:-.3px;}' +
        P + '.security-card{border-radius:18px !important;border:1px solid var(--wx-line) !important;background:var(--wx-surf) !important;box-shadow:0 1px 2px rgba(20,22,26,.04) !important;}' +
        WS + ' table th{background:transparent !important;color:var(--wx-mut) !important;font-size:11px !important;text-transform:uppercase;letter-spacing:.7px;font-weight:800 !important;border-bottom:1px solid var(--wx-line) !important;}' +
        WS + ' table td{border-bottom:1px solid var(--wx-line) !important;font-weight:600 !important;}' +
        WS + ' table tbody tr:hover td{background:var(--wx-soft) !important;}' +
        primSel + '{background:var(--wx-acc) !important;border:1px solid var(--wx-acc) !important;color:var(--wx-acc-ink) !important;box-shadow:none !important;border-radius:12px !important;font-weight:800 !important;}' +
        primHov + '{filter:brightness(.93) !important;background:var(--wx-acc) !important;}' +
        both('.menu-btn.btn-logout') + '{background:var(--wx-surf) !important;border:1px solid var(--wx-line) !important;color:var(--wx-ink) !important;box-shadow:none !important;border-radius:12px !important;}' +
        fld + '{border:1px solid var(--wx-line) !important;border-radius:12px !important;background:var(--wx-surf) !important;color:var(--wx-ink) !important;font-weight:600 !important;}' +
        fldF + '{border-color:var(--wx-acc) !important;box-shadow:0 0 0 3px var(--wx-soft) !important;outline:none !important;}' +
        MD + ' > div{border:none !important;border-radius:22px !important;box-shadow:0 24px 60px rgba(10,12,16,.35) !important;}' +

        // earlier materials pages (credit / quotes / reorder) follow the new accent
        P + '.wcr-add,' + P + '.wcq-add{background:var(--wx-acc) !important;color:var(--wx-acc-ink) !important;box-shadow:none !important;border-radius:14px !important;}' +
        P + '.wcr-tabs button.on,' + P + '.wcq-tabs button.on{background:var(--wx-acc) !important;border-color:var(--wx-acc) !important;color:var(--wx-acc-ink) !important;}' +
        P + '.wcr-card,' + P + '.wcq-card{border-left-color:var(--wx-acc) !important;border-radius:16px !important;}' +

        // ----- POS / sale -----
        P + '#pos-view{background:transparent !important;}' +
        P + '#pos-view h2,' + P + '#pos-view h3{color:var(--wx-ink) !important;font-weight:800 !important;}' +
        P + '#pos-view input:not([type=checkbox]):not([type=radio]),' + P + '#pos-view select{border:1px solid var(--wx-line) !important;border-radius:14px !important;background:var(--wx-surf) !important;padding:12px 14px !important;font-size:15px !important;}' +
        P + '#pos-view table th{background:transparent !important;color:var(--wx-mut) !important;font-size:11px !important;text-transform:uppercase;letter-spacing:.7px;}' +
        P + '#pos-view .menu-btn,' + P + '#pos-view button{border-radius:14px !important;font-weight:800 !important;}' +
        P + '#pos-view .btn-action-primary,' + P + '#pos-view button[class*="pay"],' + P + '#pos-view button[id*="pay"],' + P + '#pos-view button[id*="checkout"]{background:var(--wx-acc) !important;color:var(--wx-acc-ink) !important;border:none !important;box-shadow:0 8px 20px -8px var(--wx-acc) !important;padding-top:15px !important;padding-bottom:15px !important;font-size:16px !important;}' +
        P + '#wdm-delivery-box{background:var(--wx-soft) !important;border:1px solid var(--wx-line) !important;border-radius:14px !important;}' +
        P + '#wdm-delivery-box label{color:var(--wx-ink) !important;}' +

        // ----- inventory -----
        '#wmx-inv-bar{margin:0 0 12px;}' +
        '.wmx-chips{display:flex;gap:8px;overflow-x:auto;padding:2px 0 6px;-webkit-overflow-scrolling:touch;}' +
        '.wmx-chips button{flex-shrink:0;border:1px solid var(--wx-line);background:var(--wx-surf);color:var(--wx-ink);border-radius:99px;padding:9px 15px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;}' +
        '.wmx-chips button em{font-style:normal;font-size:11px;color:var(--wx-mut);margin-left:4px;}' +
        '.wmx-chips button.on{background:var(--wx-ink);border-color:var(--wx-ink);color:#fff;}' +
        '.wmx-chips button.on em{color:rgba(255,255,255,.7);}' +
        '.wmx-chips button.wmx-manage{background:var(--wx-soft);border-color:transparent;}' +
        '.wmx-newcat{display:inline-block;margin:6px 0 0;border:1px dashed var(--wx-acc);background:var(--wx-soft);color:var(--wx-ink);border-radius:10px;padding:8px 12px;font-size:13px;font-weight:800;cursor:pointer;}' +
        P + '#inventory-view table{border-collapse:separate !important;border-spacing:0 !important;}' +
        P + '#inventory-view table td,' + P + '#inventory-view table th{padding:14px 12px !important;}' +
        '@media (max-width:767px){' +
            P + '#inventory-view table,' + P + '#inventory-view tbody{display:block !important;width:100% !important;}' +
            P + '#inventory-view thead{display:none !important;}' +
            P + '#inventory-view tbody tr{display:flex !important;flex-wrap:wrap;align-items:center;gap:4px 12px;background:var(--wx-surf);border:1px solid var(--wx-line);border-radius:18px;padding:14px;margin:0 0 10px;box-shadow:0 1px 2px rgba(20,22,26,.04);}' +
            P + '#inventory-view tbody tr td{display:block !important;border:none !important;padding:2px 0 !important;background:transparent !important;font-size:13px;}' +
            P + '#inventory-view tbody tr td:first-child{flex:1 1 100%;font-size:16px;font-weight:800 !important;color:var(--wx-ink);}' +
        '}' +

        // ----- settings -----
        setSel('h2,') + setSel('h3') + '{color:var(--wx-ink) !important;font-weight:800 !important;}' +
        setSel('.security-card,') + setSel('[style*="border-radius"]') + '{border-radius:18px !important;}' +
        setSel('.security-card') + '{background:var(--wx-surf) !important;border:1px solid var(--wx-line) !important;box-shadow:0 1px 2px rgba(20,22,26,.04) !important;padding:18px !important;}' +
        setSel('label') + '{color:var(--wx-mut) !important;font-size:11px !important;text-transform:uppercase;letter-spacing:.6px;font-weight:800 !important;}' +
        setSel('button') + '{border-radius:12px !important;font-weight:800 !important;}' +

        // ----- shared page bits (Categories, theme sheet) -----
        '.wmx-wrap{max-width:1100px;margin:0 auto;color:var(--wx-ink);}' +
        '.wmx-wrap *{box-sizing:border-box;}' +
        '.wmx-title{font-size:26px;font-weight:900;letter-spacing:-.6px;}' +
        '.wmx-sub{font-size:13px;color:var(--wx-mut);margin:4px 0 16px;font-weight:600;}' +
        '.wmx-add{display:flex;gap:8px;margin-bottom:10px;}' +
        '.wmx-add input{flex:1;min-width:0;padding:14px;font-size:16px;}' +
        '.wmx-add button{border:none;border-radius:12px;padding:0 22px;font-weight:800;font-size:15px;background:var(--wx-acc);color:var(--wx-acc-ink);cursor:pointer;}' +
        '.wmx-err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px;border-radius:12px;font-size:13px;margin-bottom:10px;}' +
        '.wmx-catrow{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--wx-surf);border:1px solid var(--wx-line);border-radius:16px;padding:14px 16px;margin-bottom:8px;}' +
        '.wmx-cn{font-weight:800;font-size:15px;}.wmx-cs{font-size:12px;color:var(--wx-mut);margin-top:2px;font-weight:600;}' +
        '.wmx-rm,.wmx-sv{border:1px solid var(--wx-line);background:var(--wx-surf);border-radius:10px;padding:9px 14px;font-weight:800;font-size:13px;cursor:pointer;}' +
        '.wmx-rm{color:#b91c1c;border-color:#fecaca;}.wmx-sv{background:var(--wx-soft);border-color:transparent;color:var(--wx-ink);}' +
        '.wmx-empty{text-align:center;color:var(--wx-mut);padding:34px 10px;font-size:14px;font-weight:600;}' +
        '.wmx-sheet{background:var(--wx-surf);color:var(--wx-ink);width:100%;max-width:480px;border-radius:24px 24px 0 0;padding:20px 18px 26px;}' +
        '.wmx-sheet-h{display:flex;justify-content:space-between;align-items:center;font-size:19px;}' +
        '.wmx-sheet-h button{border:none;background:var(--wx-bg);border-radius:99px;width:34px;height:34px;font-size:15px;cursor:pointer;}' +
        '.wmx-sheet-s{font-size:12px;color:var(--wx-mut);margin:4px 0 14px;font-weight:600;}' +
        '.wmx-sw{display:flex;align-items:center;gap:12px;width:100%;border:1.5px solid var(--wx-line);background:var(--wx-surf);border-radius:16px;padding:12px 14px;margin-bottom:8px;cursor:pointer;text-align:left;}' +
        '.wmx-sw.on{border-color:var(--wx-ink);}' +
        '.wmx-sw-c{display:flex;}.wmx-sw-c i{display:block;width:30px;height:30px;border-radius:50%;}.wmx-sw-c i+i{margin-left:-8px;}' +
        '.wmx-sw-n{flex:1;font-weight:800;font-size:15px;color:var(--wx-ink);}.wmx-sw-k{font-weight:900;color:var(--wx-ink);}' +

        // ----- dashboard -----
        '.wmx-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;}' +
        '.wmx-brand{display:flex;align-items:center;gap:12px;min-width:0;}' +
        '.wmx-logo{width:56px;height:56px;border-radius:18px;object-fit:cover;background:#fff;border:1px solid var(--wx-line);flex-shrink:0;}' +
        '.wmx-logo.ph{display:flex;align-items:center;justify-content:center;background:var(--wx-side);color:var(--wx-side-acc);font-weight:900;font-size:24px;border:none;}' +
        '.wmx-bn{font-size:18px;font-weight:900;letter-spacing:-.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.wmx-headr{display:flex;align-items:center;gap:8px;flex-shrink:0;}' +
        '.wmx-upd{font-size:11px;color:var(--wx-mut);font-weight:700;}' +
        '.wmx-ib{width:42px;height:42px;border-radius:14px;border:1px solid var(--wx-line);background:var(--wx-surf);font-size:17px;cursor:pointer;color:var(--wx-ink);}' +
        '.wmx-spin{display:inline-block;}.wmx-busy .wmx-spin{animation:wmx-rot .8s linear infinite;}@keyframes wmx-rot{to{transform:rotate(360deg);}}' +
        '.wmx-greet{font-size:30px;font-weight:900;letter-spacing:-1px;line-height:1.1;}' +
        '.wmx-date{font-size:13px;color:var(--wx-mut);font-weight:600;margin:4px 0 16px;}' +
        '.wmx-hero{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;align-items:flex-end;background:var(--wx-hero);color:#fff;border-radius:28px;padding:28px;margin-bottom:14px;position:relative;overflow:hidden;}' +
        '.wmx-hero::after{content:"";position:absolute;right:-60px;top:-80px;width:240px;height:240px;border-radius:50%;background:var(--wx-side-acc);opacity:.14;filter:blur(30px);}' +
        '.wmx-hero-l{position:relative;z-index:2;}' +
        '.wmx-hl{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#aab2bf;}' +
        '.wmx-ha{font-size:48px;font-weight:900;letter-spacing:-2px;line-height:1.1;margin:6px 0;color:#fff;}' +
        '.wmx-hs{font-size:13px;color:#cbd2dc;font-weight:600;}' +
        '.wmx-cta{margin-top:16px;border:none;border-radius:14px;padding:13px 22px;font-size:15px;font-weight:900;background:var(--wx-side-acc);color:var(--wx-side);cursor:pointer;}' +
        '.wmx-bars{display:flex;align-items:flex-end;gap:7px;height:96px;flex:0 1 280px;min-width:200px;position:relative;z-index:2;}' +
        '.wmx-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;}' +
        '.wmx-bar i{display:block;width:100%;border-radius:7px;background:rgba(255,255,255,.18);min-height:5px;}' +
        '.wmx-bar.t i{background:var(--wx-side-acc);}' +
        '.wmx-bar small{font-size:10px;color:#9aa3b0;margin-top:7px;font-weight:800;}' +
        '.wmx-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:14px;}' +
        '.wmx-tile{background:var(--wx-surf);border:1px solid var(--wx-line);border-radius:22px;padding:18px;cursor:pointer;transition:transform .15s;}' +
        '.wmx-tile:hover{transform:translateY(-2px);}' +
        '.wmx-tile::before{content:"";display:block;width:26px;height:4px;border-radius:4px;background:var(--wx-acc);margin-bottom:12px;}' +
        '.wmx-tl{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--wx-mut);}' +
        '.wmx-tv{font-size:28px;font-weight:900;letter-spacing:-1px;margin-top:6px;}' +
        '.wmx-ts{font-size:12px;color:var(--wx-mut);font-weight:600;margin-top:2px;}' +
        '.wmx-acts{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:14px;}' +
        '.wmx-act{display:flex;flex-direction:column;align-items:flex-start;gap:10px;background:var(--wx-surf);border:1px solid var(--wx-line);border-radius:20px;padding:14px;font-size:14px;font-weight:800;color:var(--wx-ink);cursor:pointer;text-align:left;}' +
        '.wmx-act span{display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:12px;background:var(--wx-soft);font-size:18px;}' +
        '.wmx-act:hover{border-color:var(--wx-ink);}' +
        '.wmx-card{background:var(--wx-surf);border:1px solid var(--wx-line);border-radius:24px;padding:6px 20px 12px;}' +
        '.wmx-ch{display:flex;justify-content:space-between;align-items:center;padding:16px 0 10px;font-size:17px;}' +
        '.wmx-link{background:none;border:none;color:var(--wx-ink);font-weight:800;font-size:13px;cursor:pointer;padding:0;text-decoration:underline;}' +
        '.wmx-row{display:flex;align-items:center;gap:12px;padding:13px 0;border-top:1px solid var(--wx-line);cursor:pointer;}' +
        '.wmx-dot{width:10px;height:10px;border-radius:50%;background:var(--wx-acc);flex-shrink:0;}' +
        '.wmx-rm{flex:1;min-width:0;}' +
        '.wmx-rt{font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.wmx-rs{font-size:12px;color:var(--wx-mut);margin-top:2px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.wmx-ra{text-align:right;flex-shrink:0;}.wmx-rv{font-weight:900;font-size:16px;}' +
        '.wmx-pill{display:inline-block;font-size:10px;font-weight:800;padding:3px 10px;border-radius:99px;background:#dcfce7;color:#166534;margin-top:4px;}' +
        '.wmx-pill.off{background:#fee2e2;color:#991b1b;}' +
        '@media (max-width:600px){.wmx-ha{font-size:40px;}.wmx-greet{font-size:26px;}.wmx-hero{padding:22px;border-radius:24px;}.wmx-bars{flex:1 1 100%;}}';

        var st = document.createElement('style');
        st.id = 'wmx-css';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // ---------- keep everything applied ----------
    var catsLoading = false;
    function tick() {
        try {
            if (!document.body) return;
            var on = isMat();
            if (document.body.classList.contains('wmx') !== on) document.body.classList.toggle('wmx', on);
            if (!on) return;
            addCss();
            // Nothing may override us: if another patch replaced our functions, put ours back;
            // and keep our <style> as the LAST one in <head> so it wins every tie.
            if (window.wdmShowMaterialsDashboard !== wmxDashFn) window.wdmShowMaterialsDashboard = wmxDashFn;
            if (window.wdpOpenQuickAddModal !== wmxNoop) window.wdpOpenQuickAddModal = wmxNoop;
            var mine = $('wmx-css');
            if (mine && document.head.lastElementChild !== mine) document.head.appendChild(mine);
            loadTheme();
            loadBrand();
            paintSideLogo();
            injectSidebarBtns();
            var s = sid();
            if (s && s !== 'SUPER_ADMIN' && catsFor !== s && !catsLoading) {
                catsLoading = true;
                loadCats().catch(function () { catsFor = s; }).then(function () { catsLoading = false; tick(); });
            }
            injectInvBar();
            hookCategoryField();
            if (invSel) applyInvFilter();
            var q = $('wdp-quick-modal'); if (q) q.remove();
        } catch (e) { console.warn('[materials-modern]', e); }
    }
    var pending = false;
    function schedule() { if (pending) return; pending = true; setTimeout(function () { pending = false; tick(); }, 150); }

    window.addEventListener('load', function () {
        setTimeout(tick, 1800);
        var obs = new MutationObserver(schedule);
        if (document.body) obs.observe(document.body, { childList: true, subtree: true });
        setInterval(tick, 4000);
    });
})();
