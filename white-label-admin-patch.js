// ==================== WISE DECISION: "BRAND A CUSTOMER" (Super Admin) ====================
// Load with the other patches (defer, near the end). Adds a button "🏷️ Brand a customer" to the Super Admin
// header (next to "Activation codes"). It opens a small form:
//     business name  ·  link id  ·  tagline  ·  colour  ·  optional logo
// Saving writes  brands/<id>  in Firebase. You then copy the customer's link (or send it on WhatsApp).
// No code editing and no extra files for each new customer.
//
// The same sheet lists every branded customer so you can copy their link, edit them or remove them.
// Only the Super Admin screen shows any of this. White-label-patch.js (loaded in the <head>) reads brands/<id>.
//
// ONE-TIME SETUP in Firebase Console -> Realtime Database -> Rules: add this next to your other top-level entries
//     "brands": { ".read": true, ".write": "auth != null" },
// (.read must be true because the login screen is shown before anyone signs in.)

console.log("Wise Decision white-label-admin-patch.js — v1 loaded");

(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    var HIDE = ['register new business', 'order goods', 'renew or pay subscription'];

    // ---------- small helpers (kept simple so they are easy to test) ----------
    function validId(id) { return /^[a-z0-9_-]{2,30}$/.test(String(id || '')); }
    function cleanId(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30); }
    function suggestId(name) {                      // "YUM YUM NIG ENTERPRISES" -> "yumyum"
        var w = String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        return cleanId(w.slice(0, 2).join(''));
    }
    function shade(hex, amt) {                      // darker colour for the background
        var h = String(hex || '').replace('#', '');
        if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
        if (!/^[0-9a-f]{6}$/i.test(h)) return '#134e4a';
        var n = parseInt(h, 16), f = function (v) { return Math.max(0, Math.min(255, Math.round(v * (1 + amt)))); };
        return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
    }
    function linkFor(id) { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'app.html?brand=' + id; }
    window.__wlbTest = { validId: validId, cleanId: cleanId, suggestId: suggestId, shade: shade, readImage: function () { return readImage.apply(null, arguments); }, readBg: function () { return readBg.apply(null, arguments); } };

    function ref(p) { return firebase.database().ref(p); }
    function msg(t, bad) { var m = $('wlb-msg'); if (!m) return; m.textContent = t || ''; m.style.display = t ? 'block' : 'none'; m.style.background = bad ? '#fef2f2' : '#f0fdf4'; m.style.color = bad ? '#991b1b' : '#166534'; m.style.borderColor = bad ? '#fecaca' : '#bbf7d0'; }

    // shrink a picked picture so it stays small enough to keep in Firebase and to load fast on a phone
    function readImage(file, o, cb) {
        var fr = new FileReader();
        fr.onload = function () {
            var img = new Image();
            img.onload = function () {
                function draw(maxSide) {
                    var k = Math.min(1, maxSide / Math.max(img.width, img.height));
                    var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    return c;
                }
                var c = draw(o.max);
                var out = o.png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', o.q);
                if (o.png && out.length > o.limit) out = c.toDataURL('image/jpeg', 0.85);                      // heavy PNG logo: use JPEG instead
                if (!o.png && out.length > o.limit) out = draw(Math.round(o.max * 0.8)).toDataURL('image/jpeg', 0.55);   // heavy photo: smaller + lighter
                cb(out.length > o.limit * 1.4 ? null : out);
            };
            img.onerror = function () { cb(null); };
            img.src = fr.result;
        };
        fr.onerror = function () { cb(null); };
        fr.readAsDataURL(file);
    }
    function readLogo(file, cb) { readImage(file, { png: true, max: 240, limit: 90000 }, cb); }
    function readBg(file, cb) { readImage(file, { png: false, max: 1000, q: 0.72, limit: 200000 }, cb); }

    // ---------- the sheet ----------
    var logoData = '', bgData = '', editing = null, rows = {};
    var IN = 'width:100%;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;color:#0f172a;';
    var LB = 'display:block;font-size:11px;font-weight:800;color:#334155;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.4px;';

    window.wlbOpen = function () {
        var m = $('wlb-modal'); if (m) m.remove();
        logoData = ''; bgData = ''; editing = null;
        m = document.createElement('div');
        m.id = 'wlb-modal';
        m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:2600;display:flex;justify-content:center;align-items:flex-end;';
        m.innerHTML =
            '<div style="background:#f8fafc;color:#0f172a;width:100%;max-width:520px;max-height:94vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:18px 16px 24px;box-sizing:border-box;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;"><h3 style="margin:0;font-size:18px;color:#0f172a;">🏷️ Brand a customer</h3><button onclick="wlbClose()" style="border:none;background:#e2e8f0;border-radius:99px;width:34px;height:34px;font-size:16px;cursor:pointer;">✕</button></div>' +
                '<div style="font-size:12px;color:#64748b;margin-top:4px;">For a customer who does not want Wise Decision to show. He gets his own link.</div>' +
                '<div style="background:#fff;border:1px solid #e8eef5;border-radius:14px;padding:2px 14px 14px;margin-top:10px;">' +
                    '<label style="' + LB + '">Business name</label><input id="wlb-name" style="' + IN + '" placeholder="e.g. YUM YUM NIG ENTERPRISES" oninput="wlbName()">' +
                    '<label style="' + LB + '">Link id (letters and numbers)</label><input id="wlb-id" style="' + IN + '" placeholder="e.g. yumyum" autocapitalize="none" oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_-]/g,\'\')">' +
                    '<label style="' + LB + '">Line under the name</label><input id="wlb-tag" style="' + IN + '" value="Staff & Admin Login">' +
                    '<div style="display:grid;grid-template-columns:90px 1fr;gap:12px;align-items:end;"><div><label style="' + LB + '">Colour</label><input id="wlb-color" type="color" value="#ea580c" style="width:100%;height:46px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:3px;"></div>' +
                    '<div><label style="' + LB + '">Logo (optional)</label><input id="wlb-logo" type="file" accept="image/*" onchange="wlbLogo(this)" style="font-size:13px;width:100%;"></div></div>' +
                    '<div id="wlb-logo-note" style="font-size:11px;color:#64748b;margin-top:6px;"></div>' +
                    '<label style="' + LB + '">Background picture (optional)</label><input id="wlb-bg" type="file" accept="image/*" onchange="wlbBg(this)" style="font-size:13px;width:100%;">' +
                    '<div id="wlb-bg-note" style="font-size:11px;color:#64748b;margin-top:6px;">A shop or product photo works well. It sits behind the login card.</div>' +
                    '<label id="wlb-bg-clear-row" style="display:none;font-size:13px;margin-top:8px;"><input id="wlb-bg-clear" type="checkbox" style="margin-right:6px;">Remove his current background picture</label>' +
                '</div>' +
                '<div id="wlb-msg" style="display:none;border:1px solid;border-radius:10px;padding:10px;font-size:13px;margin-top:12px;"></div>' +
                '<button id="wlb-save" onclick="wlbSave()" style="width:100%;margin-top:14px;padding:15px;border:none;border-radius:14px;font-size:16px;font-weight:800;color:#fff;background:#ea580c;cursor:pointer;">Save and get his link</button>' +
                '<div id="wlb-done"></div>' +
                '<div style="font-size:13px;font-weight:800;margin:20px 0 6px;">Branded customers</div><div id="wlb-list" style="font-size:13px;color:#64748b;">Loading…</div>' +
            '</div>';
        document.body.appendChild(m);
        loadList();
    };
    window.wlbClose = function () { var m = $('wlb-modal'); if (m) m.remove(); };
    window.wlbName = function () {
        var n = $('wlb-name'), i = $('wlb-id');
        if (i && !editing && !i.getAttribute('data-touched')) i.value = suggestId(n.value);
    };
    window.wlbLogo = function (inp) {
        var f = inp.files && inp.files[0]; var note = $('wlb-logo-note');
        if (!f) { logoData = ''; if (note) note.textContent = ''; return; }
        readLogo(f, function (d) {
            if (!d) { logoData = ''; if (note) note.textContent = 'That picture could not be used. Try a smaller one.'; return; }
            logoData = d; if (note) note.innerHTML = 'Logo ready: <img src="' + d + '" style="height:28px;vertical-align:middle;border-radius:6px;margin-left:6px;">';
        });
    };

    window.wlbBg = function (inp) {
        var f = inp.files && inp.files[0]; var note = $('wlb-bg-note');
        if (!f) { bgData = ''; if (note) note.textContent = 'A shop or product photo works well. It sits behind the login card.'; return; }
        if (note) note.textContent = 'Preparing the picture…';
        readBg(f, function (d) {
            if (!d) { bgData = ''; if (note) note.textContent = 'That picture could not be used. Try a smaller or different one.'; return; }
            bgData = d; if (note) note.innerHTML = 'Picture ready (' + Math.round(d.length / 1024) + ' KB): <img src="' + d + '" style="height:36px;vertical-align:middle;border-radius:6px;margin-left:6px;">';
        });
    };

    window.wlbSave = function () {
        var name = ($('wlb-name').value || '').trim();
        var id = cleanId($('wlb-id').value);
        if (!name) return msg('Type the business name.', true);
        if (!validId(id)) return msg('The link id needs 2 to 30 letters or numbers.', true);
        var color = $('wlb-color').value || '#ea580c';
        var rec = { name: name, tagline: ($('wlb-tag').value || '').trim() || 'Staff & Admin Login', logo: logoData || (rows[id] && rows[id].logo) || '', bg: (($('wlb-bg-clear') && $('wlb-bg-clear').checked) ? '' : (bgData || (rows[id] && rows[id].bg) || '')), color: color, color2: shade(color, -0.4), hide: HIDE, updatedAt: new Date().toISOString() };
        var btn = $('wlb-save'); btn.disabled = true; btn.textContent = 'Saving…';
        ref('brands/' + id).set(rec).then(function () {
            rows[id] = rec; msg('');
            var link = linkFor(id);
            $('wlb-done').innerHTML =
                '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:12px 14px;margin-top:14px;">' +
                    '<div style="font-weight:800;color:#166534;">✅ Saved. His link:</div>' +
                    '<div style="font-size:13px;word-break:break-all;margin:6px 0 10px;color:#0f172a;">' + esc(link) + '</div>' +
                    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;"><button data-l="' + esc(link) + '" onclick="wlbCopy(this.dataset.l)" style="padding:12px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;font-weight:800;cursor:pointer;">Copy link</button>' +
                    '<button data-i="' + esc(id) + '" onclick="wlbShare(this.dataset.i)" style="padding:12px;border:1px solid #bbf7d0;border-radius:12px;background:#dcfce7;color:#166534;font-weight:800;cursor:pointer;">💬 WhatsApp</button></div>' +
                    '<div style="font-size:11px;color:#64748b;margin-top:8px;">Tip: do not open his link on your own phone, or your phone will show his branding too. (To undo: add ?brand=off to the link.)</div>' +
                '</div>';
            loadList();
        }).catch(function (e) {
            msg('Could not save: ' + (e && e.message ? e.message : e) + (/permission/i.test(String(e && e.message || e)) ? '  → The "brands" rule has not been added in Firebase yet (see the setup note).' : ''), true);
        }).then(function () { btn.disabled = false; btn.textContent = 'Save and get his link'; });
    };

    window.wlbCopy = function (l) {
        function done() { msg('Link copied.'); }
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(l).then(done, function () { prompt('Copy this link', l); });
        else prompt('Copy this link', l);
    };
    window.wlbShare = function (id) {
        var r = rows[id] || {};
        var text = 'Hello, this is your ' + (r.name || 'business') + ' login link. Open it and tap Add to Home Screen:\n' + linkFor(id);
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    };
    window.wlbEdit = function (id) {
        var r = rows[id]; if (!r) return;
        editing = id; logoData = ''; bgData = '';
        $('wlb-name').value = r.name || ''; $('wlb-id').value = id; $('wlb-id').setAttribute('data-touched', '1'); $('wlb-id').readOnly = true;
        $('wlb-tag').value = r.tagline || ''; $('wlb-color').value = /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#ea580c';
        $('wlb-logo-note').textContent = r.logo ? 'Keeps his current logo unless you pick a new one.' : '';
        $('wlb-bg-clear-row').style.display = r.bg ? 'block' : 'none'; if ($('wlb-bg-clear')) $('wlb-bg-clear').checked = false;
        $('wlb-bg-note').textContent = r.bg ? 'He has a background picture. Pick a new one to replace it, or tick the box below to remove it.' : 'A shop or product photo works well. It sits behind the login card.';
        $('wlb-done').innerHTML = ''; msg('Editing ' + id + '. Tap Save when done.');
        $('wlb-name').scrollIntoView && $('wlb-name').scrollIntoView({ block: 'center' });
    };
    window.wlbDelete = function (id) {
        if (!confirm('Remove the branding for "' + id + '"?\n\nHis phone goes back to the normal Wise Decision screen. His store and data are not touched.')) return;
        ref('brands/' + id).remove().then(function () { delete rows[id]; loadList(); msg('Removed.'); }).catch(function (e) { msg('Could not remove: ' + (e.message || e), true); });
    };
    function loadList() {
        var box = $('wlb-list'); if (!box) return;
        ref('brands').once('value').then(function (s) {
            rows = s.val() || {};
            var ids = Object.keys(rows);
            if (!ids.length) { box.innerHTML = 'None yet.'; return; }
            box.innerHTML = ids.map(function (id) {
                var r = rows[id] || {};
                return '<div style="display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e8eef5;border-radius:12px;padding:10px 12px;margin-bottom:6px;">' +
                    '<span style="width:14px;height:14px;border-radius:50%;background:' + esc(/^#[0-9a-f]{3,8}$/i.test(r.color || '') ? r.color : '#999') + ';flex-shrink:0;"></span>' +
                    '<div style="flex:1;min-width:0;"><div style="font-weight:800;color:#0f172a;">' + esc(r.name || id) + '</div><div style="font-size:11px;color:#64748b;">' + esc(id) + '</div></div>' +
                    '<button data-l="' + esc(linkFor(id)) + '" onclick="wlbCopy(this.dataset.l)" style="border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 10px;font-weight:700;font-size:12px;cursor:pointer;">Link</button>' +
                    '<button data-i="' + esc(id) + '" onclick="wlbEdit(this.dataset.i)" style="border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 10px;font-weight:700;font-size:12px;cursor:pointer;">Edit</button>' +
                    '<button data-i="' + esc(id) + '" onclick="wlbDelete(this.dataset.i)" style="border:1px solid #fecaca;background:#fff;color:#b91c1c;border-radius:8px;padding:7px 10px;font-weight:700;font-size:12px;cursor:pointer;">✕</button></div>';
            }).join('');
        }).catch(function (e) { box.textContent = 'Could not load the list: ' + (e.message || e); });
    }

    // ---------- the button in the Super Admin header ----------
    function inject() {
        var v = $('super-admin-view'); if (!v || $('wlb-btn')) return;
        var anchor = null;
        v.querySelectorAll('button').forEach(function (b) { if (!anchor && /activation codes/i.test(b.textContent || '')) anchor = b; });
        if (!anchor) return;
        var b = document.createElement('button');
        b.id = 'wlb-btn'; b.className = 'menu-btn'; b.textContent = '🏷️ Brand a customer';
        b.style.cssText = 'width:auto;margin:0;background:#ea580c;color:#fff;';
        b.onclick = function () { window.wlbOpen(); };
        anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }
    setInterval(inject, 1500);
    window.addEventListener('load', function () { setTimeout(inject, 800); });
})();
