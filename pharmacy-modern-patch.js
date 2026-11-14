// ==================== WISE DECISION PHARMACY MODERN REDESIGN (v1) ====================
// Load LAST (after batch-expiry-patch.js and every other patch).  Pharmacy stores only.
//
// A store is treated as a pharmacy when EITHER
//   * stores/{id}/storeType contains "pharm" or "chemist"   (new sign-ups), OR
//   * stores/{id}/modernUI is the text  pharmacy             (older stores such as medstar that have no storeType).
// Setting modernUI does not change anything else about the store.
//
// What it does
//   1. New look: dark sidebar with a bright accent, light page, rounded cards, 4 palettes (default Emerald).
//   2. Logo + business name at the top of the sidebar and on the Store Overview (stores/{id}/logo, businessName).
//   3. Store Overview: big sales card; the Inventory Health Alerts table becomes cards on phones
//      (the "Alert Warning Status" column is no longer cut off).
//   4. Categories: add / remove them (Categories page). They show in the product form's category field
//      and as filter chips on Inventory (the chips drive the app's own Category filter).
//   5. Inventory, POS, Settings, forms: same colours, rounded cards, fields and buttons.
//
// Data: stores/{id}/matCategories/{id} = { name } and stores/{id}/matTheme = 'emerald'|'amber'|'cobalt'|'mono'.
// Nothing existing is changed or deleted.

console.log("Wise Decision pharmacy-modern-patch.js — v1 loaded");

(function () {
    'use strict';

    // ---------- helpers ----------
    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function sid() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function db() { return firebase.database(); }
    function who() { return (typeof currentStaffName !== 'undefined' && currentStaffName) || 'Admin'; }
    function full() {
        if (typeof window.wdFullAccess === 'function') return window.wdFullAccess();
        var r = (typeof currentUserRole !== 'undefined' && currentUserRole) ? String(currentUserRole).toLowerCase() : '';
        return r === 'admin' || r === 'manager';
    }

    // ---------- is this a pharmacy? ----------
    var flag = { on: false, for: null };
    function detect() {
        var s = sid();
        if (!s || s === 'SUPER_ADMIN') { flag.on = false; flag.for = null; return; }
        if (flag.for === s) return;
        flag.for = s; flag.on = false;
        var get = function (p) { return db().ref('stores/' + s + '/' + p).once('value').then(function (x) { return x.val(); }).catch(function () { return null; }); };
        Promise.all([get('storeType'), get('modernUI')]).then(function (r) {
            var t = String(r[0] || '').toLowerCase(), u = String(r[1] || '').toLowerCase();
            var hw = /hardware|materials/.test(t);
            flag.on = !hw && (/pharm|chemist/.test(t) || u === 'pharmacy');
            tick();
        });
    }

    // ---------- palettes ----------
    var THEMES = {
        emerald: { n: 'Emerald',          a: '#0c1a16', b: '#34d399' },
        cobalt:  { n: 'Cobalt',           a: '#0d1424', b: '#60a5fa' },
        amber:   { n: 'Graphite & Amber', a: '#15171c', b: '#f5b301' },
        mono:    { n: 'Black & White',    a: '#0a0a0a', b: '#ffffff' }
    };
    var theme = 'emerald', themeFor = null;
    function applyTheme(t) { if (!THEMES[t]) t = 'emerald'; theme = t; if (document.body) document.body.setAttribute('data-wmp-theme', t); }
    function loadTheme() {
        var s = sid(); if (!s || themeFor === s) return; themeFor = s;
        try { var t = localStorage.getItem('wmp-theme-' + s); if (t) applyTheme(t); } catch (e) { /* ignore */ }
        try {
            db().ref('stores/' + s + '/matTheme').once('value').then(function (x) {
                var v = x.val(); if (v && THEMES[v]) { applyTheme(v); try { localStorage.setItem('wmp-theme-' + s, v); } catch (e) { /* ignore */ } }
            }).catch(function () { /* local copy still works */ });
        } catch (e) { /* ignore */ }
    }
    window.wmpSetTheme = function (t) {
        applyTheme(t);
        var s = sid();
        try { localStorage.setItem('wmp-theme-' + s, t); } catch (e) { /* ignore */ }
        try { db().ref('stores/' + s + '/matTheme').set(t).catch(function () { /* ignore */ }); } catch (e) { /* ignore */ }
        paintThemeModal();
    };
    window.wmpOpenTheme = function () {
        var m = $('wmp-theme-modal'); if (m) m.remove();
        m = document.createElement('div');
        m.id = 'wmp-theme-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(10,12,16,.6);z-index:1900;display:flex;justify-content:center;align-items:flex-end;';
        m.innerHTML = '<div class="wmp-sheet"><div class="wmp-sheet-h"><b>Appearance</b><button onclick="document.getElementById(\'wmp-theme-modal\').remove()">✕</button></div>' +
            '<div class="wmp-sheet-s">Pick the colours for your pharmacy. It is saved for everyone who uses this store.</div><div id="wmp-themes"></div></div>';
        m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
        document.body.appendChild(m);
        paintThemeModal();
    };
    function paintThemeModal() {
        var box = $('wmp-themes'); if (!box) return;
        box.innerHTML = Object.keys(THEMES).map(function (k) {
            var t = THEMES[k];
            return '<button class="wmp-sw' + (k === theme ? ' on' : '') + '" onclick="wmpSetTheme(\'' + k + '\')">' +
                '<span class="wmp-sw-c"><i style="background:' + t.a + '"></i><i style="background:' + t.b + ';border:1px solid #d1d5db"></i></span>' +
                '<span class="wmp-sw-n">' + esc(t.n) + '</span><span class="wmp-sw-k">' + (k === theme ? '✓' : '') + '</span></button>';
        }).join('');
    }

    // ---------- brand (logo + name) ----------
    var brand = { logo: '', name: '', for: null };
    function initial() { var n = (brand.name || (typeof currentStoreName !== 'undefined' ? currentStoreName : '') || 'S').trim(); return esc(n.charAt(0).toUpperCase() || 'S'); }
    function brandName() { return brand.name || (typeof currentStoreName !== 'undefined' ? currentStoreName : '') || 'Your pharmacy'; }
    function logoHtml(cls) { return brand.logo ? '<img class="' + cls + '" src="' + esc(brand.logo) + '" alt="">' : '<div class="' + cls + ' ph">' + initial() + '</div>'; }
    function loadBrand() {
        var s = sid(); if (!s || brand.for === s) return; brand.for = s;
        Promise.all([
            db().ref('stores/' + s + '/logo').once('value').then(function (x) { return x.val(); }).catch(function () { return null; }),
            db().ref('stores/' + s + '/businessName').once('value').then(function (x) { return x.val(); }).catch(function () { return null; })
        ]).then(function (r) {
            brand.logo = (typeof r[0] === 'string' && /^(data:image|https?:)/i.test(r[0])) ? r[0] : '';
            brand.name = String(r[1] || '');
            var old = $('wmp-brand'); if (old) old.remove();
            var sl = $('wmp-side-logo'); if (sl) sl.remove();
            tick();
        });
    }
    function paintSideLogo() {
        var title = $('dashboard-store-title'); if (!title) return;
        var key = brand.logo ? 'i' + brand.logo.length : 'p' + initial();
        var old = $('wmp-side-logo');
        if (old && old.getAttribute('data-k') === key) return;
        if (old) old.remove();
        var el;
        if (brand.logo) { el = document.createElement('img'); el.src = brand.logo; el.alt = ''; }
        else { el = document.createElement('div'); el.className = 'ph'; el.textContent = initial(); }
        el.id = 'wmp-side-logo'; el.setAttribute('data-k', key);
        title.parentNode.insertBefore(el, title);
    }
    function injectBrand() {
        var ws = $('workspace-content'); if (!ws || $('wmp-brand')) return;
        var h2 = ws.querySelector('h2');
        if (!h2 || (h2.textContent || '').indexOf('Store Overview') === -1) return;
        var now = new Date(), h = now.getHours();
        var hi = h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
        var first = (typeof currentStaffName !== 'undefined' && currentStaffName) ? ', ' + esc(String(currentStaffName).split(' ')[0]) : '';
        var d = document.createElement('div');
        d.id = 'wmp-brand';
        d.innerHTML = '<div class="wmp-brandrow">' + logoHtml('wmp-logo') + '<div class="wmp-bn">' + esc(brandName()) + '</div>' +
            '<button class="wmp-ib" title="Appearance" onclick="wmpOpenTheme()">🎨</button></div>' +
            '<div class="wmp-greet">' + hi + first + '</div>' +
            '<div class="wmp-date">' + esc(now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })) + '</div>';
        h2.parentNode.insertBefore(d, h2);
    }
    function markHero() {
        var amt = $('dash-today-sales');
        if (amt && amt.parentElement && !amt.parentElement.classList.contains('wmp-hero')) amt.parentElement.classList.add('wmp-hero');
    }

    // ---------- categories ----------
    var cats = [], prodCats = {}, catsFor = null, catsLoading = false, invSel = '';
    function loadCats() {
        var s = sid(); if (!s) return Promise.resolve();
        return db().ref('stores/' + s + '/matCategories').once('value').then(function (snap) {
            var a = []; snap.forEach(function (c) { var v = c.val(); if (v && v.name) a.push({ id: c.key, name: String(v.name) }); });
            a.sort(function (x, y) { return x.name.localeCompare(y.name); });
            cats = a;
            return db().ref('stores/' + s + '/inventory').once('value').catch(function () { return null; });
        }).then(function (snap) {
            var inv = (snap && snap.val()) || {};
            prodCats = {};
            Object.keys(inv).forEach(function (b) {
                Object.keys(inv[b] || {}).forEach(function (id) {
                    var p = inv[b][id]; if (!p || typeof p !== 'object') return;
                    var c = String(p.category || '').trim(); if (c) prodCats[c] = (prodCats[c] || 0) + 1;
                });
            });
            catsFor = s;
        });
    }
    function managedHas(name) { var k = name.toLowerCase(); return cats.some(function (c) { return c.name.toLowerCase() === k; }); }
    function allCatNames() {
        var out = cats.map(function (c) { return c.name; });
        Object.keys(prodCats).forEach(function (n) { if (!managedHas(n) && out.indexOf(n) === -1) out.push(n); });
        out.sort(function (a, b) { return a.localeCompare(b); });
        return out;
    }
    function countFor(name) { var k = name.toLowerCase(), n = 0; Object.keys(prodCats).forEach(function (c) { if (c.toLowerCase() === k) n += prodCats[c]; }); return n; }
    function catErr(m) { var e = $('wmp-cat-err'); if (e) { e.textContent = m; e.style.display = m ? 'block' : 'none'; } }

    window.wmpShowCategories = function () {
        if (!full()) return;
        var ws = $('workspace-content'); if (!ws) return;
        ws.innerHTML =
            '<div class="wmp-wrap"><div class="wmp-title">Categories</div>' +
            '<div class="wmp-sub">The groups your products belong to (tablets, syrups, injections…). Add the ones you sell, remove the ones you don’t.</div>' +
            '<div class="wmp-add"><input id="wmp-cat-in" placeholder="New category name…" maxlength="40" onkeydown="if(event.key===\'Enter\')wmpAddCat()"><button onclick="wmpAddCat()">Add</button></div>' +
            '<div id="wmp-cat-err" class="wmp-err" style="display:none"></div>' +
            '<div id="wmp-cat-list"><div class="wmp-empty">Loading…</div></div></div>';
        loadCats().then(paintCats).catch(function (e) { var l = $('wmp-cat-list'); if (l) l.innerHTML = '<div class="wmp-empty">Could not load: ' + esc(e.message || e) + '</div>'; });
    };
    function paintCats() {
        var el = $('wmp-cat-list'); if (!el) return;
        var rows = cats.map(function (c) { return { id: c.id, name: c.name, managed: true }; });
        Object.keys(prodCats).forEach(function (n) { if (!managedHas(n)) rows.push({ id: '', name: n, managed: false }); });
        rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
        if (!rows.length) { el.innerHTML = '<div class="wmp-empty">No categories yet. Type a name above and tap Add.</div>'; return; }
        el.innerHTML = rows.map(function (r) {
            var n = countFor(r.name);
            return '<div class="wmp-catrow"><div><div class="wmp-cn">' + esc(r.name) + '</div><div class="wmp-cs">' + n + ' product' + (n === 1 ? '' : 's') + (r.managed ? '' : ' · found on your products') + '</div></div>' +
                (r.managed
                    ? '<button class="wmp-rm" data-id="' + esc(r.id) + '" data-n="' + esc(r.name) + '" onclick="wmpRemoveCat(this.dataset.id,this.dataset.n)">Remove</button>'
                    : '<button class="wmp-sv" data-n="' + esc(r.name) + '" onclick="wmpSaveCat(this.dataset.n)">Save to list</button>') + '</div>';
        }).join('');
    }
    function pushCat(name) { return db().ref('stores/' + sid() + '/matCategories').push({ name: name, createdAt: new Date().toISOString(), createdBy: who() }); }
    function afterCatChange() {
        return loadCats().then(function () {
            paintCats();
            var bar = $('wmp-inv-bar'); if (bar) bar.remove();
            var dl = $('wmp-cat-dl'); if (dl) dl.remove();
            injectInvBar(); hookCategoryField();
        });
    }
    window.wmpAddCat = function () {
        var inp = $('wmp-cat-in'); if (!inp) return;
        var name = (inp.value || '').trim().replace(/\s+/g, ' ');
        if (!name) return catErr('Type the category name.');
        if (managedHas(name)) return catErr('“' + name + '” is already in your list.');
        catErr('');
        pushCat(name).then(function () { inp.value = ''; return afterCatChange(); }).catch(function (e) { catErr('Could not save: ' + (e.message || e)); });
    };
    window.wmpSaveCat = function (name) {
        if (!name || managedHas(name)) return;
        pushCat(name).then(afterCatChange).catch(function (e) { catErr('Could not save: ' + (e.message || e)); });
    };
    window.wmpRemoveCat = function (id, name) {
        var n = countFor(name);
        if (!confirm('Remove “' + name + '” from your list?' + (n ? '\n\n' + n + ' product' + (n === 1 ? ' still uses' : 's still use') + ' it. They keep the label until you edit them.' : ''))) return;
        db().ref('stores/' + sid() + '/matCategories/' + id).remove().then(afterCatChange).catch(function (e) { catErr('Could not remove: ' + (e.message || e)); });
    };
    window.wmpNewCat = function (fromForm) {
        if (!full()) { alert('Only the owner or manager can add categories.'); return; }
        var name = (prompt('New category name') || '').trim().replace(/\s+/g, ' ');
        if (!name) return;
        var go = managedHas(name) ? Promise.resolve() : pushCat(name);
        go.then(afterCatChange).then(function () {
            if (fromForm) { var el = $('inv-category'); if (el) el.value = name; }
        }).catch(function (e) { alert('Could not save: ' + (e.message || e)); });
    };

    // product form: category field uses YOUR categories
    function hookCategoryField() {
        var el = $('inv-category'); if (!el || catsFor !== sid()) return;
        var dl = $('wmp-cat-dl');
        if (!dl) { dl = document.createElement('datalist'); dl.id = 'wmp-cat-dl'; document.body.appendChild(dl); }
        dl.innerHTML = allCatNames().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
        if (el.getAttribute('list') !== 'wmp-cat-dl') el.setAttribute('list', 'wmp-cat-dl');
        if (full() && !$('wmp-newcat')) {
            var b = document.createElement('button');
            b.type = 'button'; b.id = 'wmp-newcat'; b.className = 'wmp-newcat'; b.textContent = '＋ New category';
            b.onclick = function () { wmpNewCat(true); };
            el.parentNode.insertBefore(b, el.nextSibling);
        }
    }

    // inventory chips: drive the app's own Category filter
    function injectInvBar() {
        var v = $('inventory-view'); if (!v || catsFor !== sid()) return;
        var names = allCatNames();
        var sig = names.join('|') + '#' + invSel;
        var old = $('wmp-inv-bar');
        if (old && old.getAttribute('data-sig') === sig) return;
        if (old) old.remove();
        var bar = document.createElement('div');
        bar.id = 'wmp-inv-bar'; bar.setAttribute('data-sig', sig);
        bar.innerHTML = '<div class="wmp-chips"><button class="' + (invSel ? '' : 'on') + '" data-c="" onclick="wmpPickCat(this.dataset.c)">All</button>' +
            names.map(function (n) { return '<button class="' + (invSel === n ? 'on' : '') + '" data-c="' + esc(n) + '" onclick="wmpPickCat(this.dataset.c)">' + esc(n) + ' <em>' + countFor(n) + '</em></button>'; }).join('') +
            (full() ? '<button class="wmp-manage" onclick="wmpNewCat(false)">＋ New</button><button class="wmp-manage" onclick="wmpShowCategories()">🏷️ Manage / delete</button>' : '') + '</div>';
        v.insertBefore(bar, v.firstChild);
    }
    window.wmpPickCat = function (c) {
        invSel = c || '';
        var native = $('inventory-category-filter');
        if (native) {
            var want = invSel.toLowerCase(), val = invSel ? null : 'all';
            if (invSel) Array.prototype.forEach.call(native.options, function (o) {
                if (String(o.value).toLowerCase() === want || String(o.textContent).trim().toLowerCase() === want) val = o.value;
            });
            if (val === null) { alert('No products in “' + invSel + '” yet.'); invSel = ''; val = 'all'; }
            native.value = val;
            if (typeof window.onInventoryCategoryFilterChange === 'function') { try { window.onInventoryCategoryFilterChange(); } catch (e) { /* ignore */ } }
        }
        var b = $('wmp-inv-bar'); if (b) b.remove();
        injectInvBar();
    };

    // ---------- sidebar buttons ----------
    function injectSidebarBtns() {
        var side = document.querySelector('#dashboard-main-wrapper .sidebar'); if (!side) return;
        var defs = [['wmp-sb-cats', '🏷️ Categories', function () { wmpShowCategories(); }], ['wmp-sb-theme', '🎨 Appearance', function () { wmpOpenTheme(); }]];
        if (!full()) { defs.forEach(function (d) { var e = $(d[0]); if (e) e.remove(); }); return; }
        var anchor = null;
        side.querySelectorAll('button').forEach(function (b) { if (!anchor && (b.textContent || '').indexOf('Inventory') !== -1) anchor = b; });
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
        if ($('wmp-css')) return;
        var P = 'body.wmp ';
        var WS = P + '#workspace-content#workspace-content';
        var MD = P + '[id$="-modal"]';
        var SB = P + '#dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper#dashboard-main-wrapper .sidebar';
        var both = function (r) { return WS + ' ' + r + ',' + MD + ' ' + r; };
        var BTN = ['btn-action-primary', 'btn-dash', 'btn-pos', 'btn-inv', 'btn-acc', 'btn-rep', 'btn-exp', 'btn-staff', 'btn-cust', 'btn-supplier', 'btn-transfer', 'btn-branch', 'btn-sec', 'btn-subscription'];
        var prim = BTN.map(function (c) { return both('.menu-btn.' + c); }).join(',');
        var primH = BTN.map(function (c) { return both('.menu-btn.' + c + ':hover'); }).join(',');
        var TXT = ['input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([readonly])', 'select', 'textarea'];
        var fld = TXT.map(function (t) { return both(t); }).join(',');
        var fldF = TXT.map(function (t) { return both(t + ':focus'); }).join(',');

        var css =
        // palettes
        'body.wmp{--wx-side:#0c1a16;--wx-side-ink:#e8eef0;--wx-side-acc:#34d399;--wx-acc:#10b981;--wx-acc-ink:#ffffff;--wx-soft:#d1fae5;--wx-bg:#f1f6f4;--wx-surf:#ffffff;--wx-ink:#0f1a16;--wx-mut:#64748b;--wx-line:#dbe7e2;--wx-hero:linear-gradient(135deg,#0c1a16 0%,#14412f 100%);}' +
        'body.wmp[data-wmp-theme=cobalt]{--wx-side:#0d1424;--wx-side-acc:#60a5fa;--wx-acc:#2563eb;--wx-soft:#dbeafe;--wx-bg:#f2f5fa;--wx-ink:#0d1424;--wx-line:#dde4f0;--wx-hero:linear-gradient(135deg,#0d1424 0%,#1a2c58 100%);}' +
        'body.wmp[data-wmp-theme=amber]{--wx-side:#15171c;--wx-side-acc:#f5b301;--wx-acc:#f5b301;--wx-acc-ink:#1a1300;--wx-soft:#fff4cc;--wx-bg:#f4f3ef;--wx-ink:#14161a;--wx-line:#e7e4dc;--wx-hero:linear-gradient(135deg,#15171c 0%,#2b2f38 100%);}' +
        'body.wmp[data-wmp-theme=mono]{--wx-side:#0a0a0a;--wx-side-acc:#ffffff;--wx-acc:#111111;--wx-soft:#ececec;--wx-bg:#f5f5f5;--wx-ink:#0a0a0a;--wx-line:#e4e4e4;--wx-hero:linear-gradient(135deg,#0a0a0a 0%,#2a2a2a 100%);}' +

        // sidebar (also the phone drawer)
        SB + '{background:var(--wx-side) !important;border-right:none !important;box-shadow:none !important;}' +
        SB + ' #dashboard-store-title{color:#fff !important;font-weight:900 !important;}' +
        SB + ' #user-role-label{color:#9aa1ad !important;font-weight:600 !important;}' +
        SB + ' #branch-badge-container span,' + SB + ' #branch-badge-container select{background:rgba(255,255,255,.08) !important;color:var(--wx-side-ink) !important;border:1px solid rgba(255,255,255,.14) !important;border-radius:10px !important;}' +
        SB + ' .menu-btn{background:transparent !important;color:var(--wx-side-ink) !important;border:none !important;border-radius:12px !important;padding:12px 14px !important;margin:0 0 4px 0 !important;font-size:14px !important;font-weight:700 !important;text-align:left !important;box-shadow:none !important;transform:none !important;}' +
        SB + ' .menu-btn:hover{background:rgba(255,255,255,.08) !important;color:#fff !important;}' +
        SB + ' .menu-btn.wds-on,' + SB + ' .menu-btn.active{background:rgba(255,255,255,.1) !important;color:#fff !important;box-shadow:inset 3px 0 0 var(--wx-side-acc) !important;}' +
        SB + ' .btn-logout{background:transparent !important;color:#fca5a5 !important;border:1px solid rgba(252,165,165,.3) !important;margin-top:10px !important;}' +
        '#wmp-side-logo{display:block;width:46px;height:46px;border-radius:14px;object-fit:cover;background:#fff;margin:0 0 8px 0;}' +
        '#wmp-side-logo.ph{display:flex;align-items:center;justify-content:center;background:var(--wx-side-acc);color:var(--wx-side);font-weight:900;font-size:20px;}' +

        // page, headings, cards, tables, buttons, fields
        P + '.main-content-area,' + P + '.dashboard-layout{background:var(--wx-bg) !important;}' +
        WS + ' h2,' + WS + ' h3{color:var(--wx-ink) !important;font-weight:800 !important;letter-spacing:-.3px;}' +
        P + '.security-card,' + P + '.card,' + P + '.alert-card-box{border-radius:20px !important;border:1px solid var(--wx-line) !important;background:var(--wx-surf) !important;box-shadow:0 1px 2px rgba(20,22,26,.04) !important;}' +
        WS + ' table th{background:transparent !important;color:var(--wx-mut) !important;font-size:11px !important;text-transform:uppercase;letter-spacing:.7px;font-weight:800 !important;border-bottom:1px solid var(--wx-line) !important;}' +
        WS + ' table td{border-bottom:1px solid var(--wx-line) !important;font-weight:600 !important;}' +
        WS + ' table tbody tr:hover td{background:var(--wx-soft) !important;}' +
        prim + '{background:var(--wx-acc) !important;border:1px solid var(--wx-acc) !important;color:var(--wx-acc-ink) !important;box-shadow:none !important;border-radius:12px !important;font-weight:800 !important;}' +
        primH + '{filter:brightness(.93) !important;background:var(--wx-acc) !important;}' +
        both('.menu-btn.btn-logout') + '{background:var(--wx-surf) !important;border:1px solid var(--wx-line) !important;color:var(--wx-ink) !important;box-shadow:none !important;border-radius:12px !important;}' +
        fld + '{border:1px solid var(--wx-line) !important;border-radius:12px !important;background:var(--wx-surf) !important;color:var(--wx-ink) !important;font-weight:600 !important;}' +
        fldF + '{border-color:var(--wx-acc) !important;box-shadow:0 0 0 3px var(--wx-soft) !important;outline:none !important;}' +
        MD + ' > div{border:none !important;border-radius:22px !important;box-shadow:0 24px 60px rgba(10,12,16,.35) !important;}' +

        // printed receipts / waybills keep their original look
        ['#printable-receipt-box', '#printable-debt-receipt-box', '#printable-refund-receipt-box', '#printable-waybill-box'].map(function (b) { return WS + ' ' + b + ' table th'; }).join(',') +
            '{color:#000 !important;text-transform:none !important;letter-spacing:0 !important;font-size:12px !important;font-weight:700 !important;padding:4px 2px !important;border-bottom:1px solid #000 !important;background:none !important;}' +
        ['#printable-receipt-box', '#printable-debt-receipt-box', '#printable-refund-receipt-box', '#printable-waybill-box'].map(function (b) { return WS + ' ' + b + ' table td'; }).join(',') +
            '{border-bottom:none !important;font-weight:400 !important;padding:3px 2px !important;background:none !important;}' +

        // POS
        P + '#pos-view h2,' + P + '#pos-view h3{color:var(--wx-ink) !important;font-weight:800 !important;}' +
        P + '#pos-view input:not([type=checkbox]):not([type=radio]),' + P + '#pos-view select{border:1px solid var(--wx-line) !important;border-radius:14px !important;background:var(--wx-surf) !important;padding:12px 14px !important;font-size:15px !important;}' +
        P + '#pos-view button{border-radius:14px !important;font-weight:800 !important;}' +
        P + '#pos-view .btn-action-primary{background:var(--wx-acc) !important;color:var(--wx-acc-ink) !important;border:none !important;box-shadow:0 8px 20px -8px var(--wx-acc) !important;padding-top:15px !important;padding-bottom:15px !important;}' +

        // Store Overview
        '.wmp-hero{background:var(--wx-hero) !important;border:none !important;border-radius:26px !important;padding:24px !important;box-shadow:none !important;}' +
        '.wmp-hero div{color:#cbd2dc !important;}' +
        '.wmp-hero #dash-today-sales{color:#fff !important;font-size:42px !important;letter-spacing:-1.5px;}' +
        '#wmp-brand{margin-bottom:14px;}' +
        '.wmp-brandrow{display:flex;align-items:center;gap:12px;margin-bottom:12px;}' +
        '.wmp-logo{width:54px;height:54px;border-radius:17px;object-fit:cover;background:#fff;border:1px solid var(--wx-line);flex-shrink:0;}' +
        '.wmp-logo.ph{display:flex;align-items:center;justify-content:center;background:var(--wx-side);color:var(--wx-side-acc);font-weight:900;font-size:24px;border:none;}' +
        '.wmp-bn{flex:1;min-width:0;font-size:18px;font-weight:900;letter-spacing:-.4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--wx-ink);}' +
        '.wmp-ib{width:42px;height:42px;border-radius:14px;border:1px solid var(--wx-line);background:var(--wx-surf);font-size:17px;cursor:pointer;flex-shrink:0;}' +
        '.wmp-greet{font-size:28px;font-weight:900;letter-spacing:-1px;line-height:1.1;color:var(--wx-ink);}' +
        '.wmp-date{font-size:13px;color:var(--wx-mut);font-weight:600;margin-top:4px;}' +

        // alerts + inventory: cards on phones
        '@media (max-width:767px){' +
            P + '.alert-card-box table,' + P + '.alert-card-box tbody{display:block !important;width:100% !important;}' +
            P + '.alert-card-box thead{display:none !important;}' +
            P + '.alert-card-box tbody tr{display:grid !important;grid-template-columns:1fr 1fr;gap:3px 10px;background:var(--wx-surf);border:1px solid var(--wx-line);border-radius:16px;padding:12px 14px;margin:0 0 8px;}' +
            P + '.alert-card-box tbody tr td{display:block !important;border:none !important;padding:0 !important;background:transparent !important;font-size:12px;}' +
            P + '.alert-card-box tbody tr td:nth-child(1){grid-column:1/-1;font-size:14px;font-weight:800 !important;color:var(--wx-ink);}' +
            P + '.alert-card-box tbody tr td:nth-child(3):before{content:"Stock: ";color:var(--wx-mut);font-weight:600;}' +
            P + '.alert-card-box tbody tr td:nth-child(4):before{content:"Expires: ";color:var(--wx-mut);font-weight:600;}' +
            P + '.alert-card-box tbody tr td:nth-child(5){grid-column:1/-1;margin-top:4px;}' +
            P + '#inventory-view table,' + P + '#inventory-view tbody{display:block !important;width:100% !important;}' +
            P + '#inventory-view thead{display:none !important;}' +
            P + '#inventory-view tbody tr{display:flex !important;flex-wrap:wrap;align-items:center;gap:4px 12px;background:var(--wx-surf);border:1px solid var(--wx-line);border-radius:18px;padding:14px;margin:0 0 10px;}' +
            P + '#inventory-view tbody tr td{display:block !important;border:none !important;padding:2px 0 !important;background:transparent !important;font-size:13px;}' +
            P + '#inventory-view tbody tr td:first-child{flex:1 1 100%;font-size:16px;font-weight:800 !important;color:var(--wx-ink);}' +
        '}' +

        // settings
        P + '#settings-view .card,' + P + '#settings-view [style*="border-radius"]{border-radius:18px !important;}' +
        P + '#settings-view label{color:var(--wx-mut) !important;font-size:11px !important;text-transform:uppercase;letter-spacing:.6px;font-weight:800 !important;}' +

        // categories page, chips, theme sheet
        '.wmp-wrap{max-width:1100px;margin:0 auto;color:var(--wx-ink);}.wmp-wrap *{box-sizing:border-box;}' +
        '.wmp-title{font-size:26px;font-weight:900;letter-spacing:-.6px;}' +
        '.wmp-sub{font-size:13px;color:var(--wx-mut);margin:4px 0 16px;font-weight:600;}' +
        '.wmp-add{display:flex;gap:8px;margin-bottom:10px;}.wmp-add input{flex:1;min-width:0;padding:14px;font-size:16px;}' +
        '.wmp-add button{border:none;border-radius:12px;padding:0 22px;font-weight:800;font-size:15px;background:var(--wx-acc);color:var(--wx-acc-ink);cursor:pointer;}' +
        '.wmp-err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px;border-radius:12px;font-size:13px;margin-bottom:10px;}' +
        '.wmp-catrow{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--wx-surf);border:1px solid var(--wx-line);border-radius:16px;padding:14px 16px;margin-bottom:8px;}' +
        '.wmp-cn{font-weight:800;font-size:15px;}.wmp-cs{font-size:12px;color:var(--wx-mut);margin-top:2px;font-weight:600;}' +
        '.wmp-rm,.wmp-sv{border:1px solid var(--wx-line);background:var(--wx-surf);border-radius:10px;padding:9px 14px;font-weight:800;font-size:13px;cursor:pointer;}' +
        '.wmp-rm{color:#b91c1c;border-color:#fecaca;}.wmp-sv{background:var(--wx-soft);border-color:transparent;color:var(--wx-ink);}' +
        '.wmp-empty{text-align:center;color:var(--wx-mut);padding:34px 10px;font-size:14px;font-weight:600;}' +
        '#wmp-inv-bar{margin:0 0 12px;}.wmp-chips{display:flex;gap:8px;overflow-x:auto;padding:2px 0 6px;-webkit-overflow-scrolling:touch;}' +
        '.wmp-chips button{flex-shrink:0;border:1px solid var(--wx-line);background:var(--wx-surf);color:var(--wx-ink);border-radius:99px;padding:9px 15px;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap;}' +
        '.wmp-chips button em{font-style:normal;font-size:11px;color:var(--wx-mut);margin-left:4px;}' +
        '.wmp-chips button.on{background:var(--wx-ink);border-color:var(--wx-ink);color:#fff;}.wmp-chips button.on em{color:rgba(255,255,255,.7);}' +
        '.wmp-chips button.wmp-manage{background:var(--wx-soft);border-color:transparent;}' +
        '.wmp-newcat{display:inline-block;margin:6px 0 0;border:1px dashed var(--wx-acc);background:var(--wx-soft);color:var(--wx-ink);border-radius:10px;padding:8px 12px;font-size:13px;font-weight:800;cursor:pointer;}' +
        '.wmp-sheet{background:var(--wx-surf);color:var(--wx-ink);width:100%;max-width:480px;border-radius:24px 24px 0 0;padding:20px 18px 26px;}' +
        '.wmp-sheet-h{display:flex;justify-content:space-between;align-items:center;font-size:19px;}' +
        '.wmp-sheet-h button{border:none;background:var(--wx-bg);border-radius:99px;width:34px;height:34px;font-size:15px;cursor:pointer;}' +
        '.wmp-sheet-s{font-size:12px;color:var(--wx-mut);margin:4px 0 14px;font-weight:600;}' +
        '.wmp-sw{display:flex;align-items:center;gap:12px;width:100%;border:1.5px solid var(--wx-line);background:var(--wx-surf);border-radius:16px;padding:12px 14px;margin-bottom:8px;cursor:pointer;text-align:left;}' +
        '.wmp-sw.on{border-color:var(--wx-ink);}.wmp-sw-c{display:flex;}.wmp-sw-c i{display:block;width:30px;height:30px;border-radius:50%;}.wmp-sw-c i+i{margin-left:-8px;}' +
        '.wmp-sw-n{flex:1;font-weight:800;font-size:15px;color:var(--wx-ink);}.wmp-sw-k{font-weight:900;color:var(--wx-ink);}';

        var st = document.createElement('style');
        st.id = 'wmp-css';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // ---------- keep everything applied ----------
    function cleanup() {
        ['wmp-side-logo', 'wmp-brand', 'wmp-sb-cats', 'wmp-sb-theme', 'wmp-inv-bar', 'wmp-newcat'].forEach(function (i) { var e = $(i); if (e) e.remove(); });
        var h = document.querySelector('.wmp-hero'); if (h) h.classList.remove('wmp-hero');
    }
    function tick() {
        try {
            if (!document.body) return;
            detect();
            var on = flag.on;
            if (document.body.classList.contains('wmp') !== on) { document.body.classList.toggle('wmp', on); if (!on) cleanup(); }
            if (!on) return;
            addCss();
            var mine = $('wmp-css');
            if (mine && document.head.lastElementChild !== mine) document.head.appendChild(mine);   // stay last so we win ties
            loadTheme(); loadBrand(); paintSideLogo(); injectSidebarBtns(); injectBrand(); markHero();
            var s = sid();
            if (s && catsFor !== s && !catsLoading) {
                catsLoading = true;
                loadCats().catch(function () { catsFor = s; }).then(function () { catsLoading = false; tick(); });
            }
            injectInvBar(); hookCategoryField();
        } catch (e) { console.warn('[pharmacy-modern]', e); }
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
