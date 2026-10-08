// ==================== WISE DECISION SECURITY PATCH — PHASE 1 (v1) ====================
// Load LAST, after payments-patch.js (defer).
//
// PHASE 1 changes NOTHING about how people log in and does NOT touch your database rules, so nobody
// can be locked out. It quietly prepares everything the rules lock (Phase 3) will need:
//
//   * After any SUCCESSFUL normal login (admin or staff), the app also creates/signs in a protected
//     Firebase Authentication account for that person, in the background, and records them in
//     stores/<id>/members/<uid>. The account is made from the PIN itself — the PIN is never stored.
//   * After a SUCCESSFUL Super Admin login, the app asks ONCE per device for your Firebase admin email +
//     password, signs you in, and records you in admins/<uid> (the rules will use this list).
//   * Super Admin gets a "🔐 Security" button: which stores/staff are already protected, and when it is
//     safe to move to the next phase.
//
// Phase 2 (later): login uses the protected accounts and the plain-text PINs are deleted from the database.
// Phase 3 (last): the open rules are replaced by rules that let each store see only its own data.
//
// Emergency switch: type  localStorage.setItem('wd_auth_off','1')  in the browser console to turn this patch off.

console.log("Wise Decision auth-patch.js — Phase 1 v1 loaded");

var WDA_FAKE_DOMAIN = 'wd.invalid';          // ".invalid" can never receive email, so no reset mail can ever be sent
var WDA_SUPER_KEY = 'wd_super_email';
var wdaAuthPromise = null;
var wdaInFlight = {};
var wdaSkipSuperThisSession = false;

// ---------- Helpers (the pure ones are tested) ----------
function wdaEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdaOff() { try { return localStorage.getItem('wd_auth_off') === '1'; } catch (e) { return false; } }

async function wdaSha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}
// Email and password both come from (store, person, PIN). A different PIN gives a different account,
// so changing a PIN automatically retires the old one.
async function wdaCredentials(storeId, who, pin) {
    const idHash = await wdaSha256Hex('wd-auth-id-v1|' + storeId + '|' + who + '|' + pin);
    const pwHash = await wdaSha256Hex('wd-auth-pw-v1|' + storeId + '|' + who + '|' + pin);
    return { email: 'wd.' + idHash.slice(0, 40) + '@' + WDA_FAKE_DOMAIN, password: pwHash };
}
function wdaIsMissingAccountError(code) {
    return code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials' || code === 'auth/wrong-password';
}
function wdaPickStaff(staffObj, pin, role, branch) {
    // Mirrors the login: the staff member whose PIN matched; if several share a PIN, prefer the same role + branch
    let pick = null, last = null;
    Object.keys(staffObj || {}).forEach(function (k) {
        const s = staffObj[k] || {};
        if (String(s.pin) === String(pin)) {
            last = { key: k, s: s };
            if (s.role === role && (s.branchId || 'main') === branch) pick = { key: k, s: s };
        }
    });
    return pick || last;
}
function wdaSummarize(rows) {
    const out = { stores: rows.length, adminsDone: 0, staffTotal: 0, staffDone: 0, fullyDone: 0 };
    rows.forEach(function (r) {
        if (r.adminDone) out.adminsDone++;
        out.staffTotal += r.staffTotal;
        out.staffDone += r.staffDone;
        if (r.adminDone && r.staffDone >= r.staffTotal) out.fullyDone++;
    });
    return out;
}
function wdaStoreRow(id, name, status, members, staff) {
    const staffKeys = Object.keys(staff || {});
    const memberList = Object.keys(members || {}).map(function (u) { return members[u] || {}; });
    const doneKeys = {};
    let adminDone = false;
    memberList.forEach(function (m) { if (m.who === 'admin') adminDone = true; else if (m.who) doneKeys[m.who] = true; });
    const staffDone = staffKeys.filter(function (k) { return doneKeys[k]; }).length;
    return { id: id, name: name || id, status: status || 'active', adminDone: adminDone, staffTotal: staffKeys.length, staffDone: staffDone };
}

function wdaLoadAuth() {
    if (typeof firebase !== 'undefined' && firebase.auth) return Promise.resolve();
    if (wdaAuthPromise) return wdaAuthPromise;
    wdaAuthPromise = new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js';
        s.onload = function () { resolve(); };
        s.onerror = function () { wdaAuthPromise = null; reject(new Error('Could not load the Firebase sign-in library')); };
        document.head.appendChild(s);
    });
    return wdaAuthPromise;
}

// =====================================================================
// STORE USERS — silent migration after a successful normal login
// =====================================================================
async function wdaMigrateStoreUser(storeId, pin) {
    await wdaLoadAuth();
    const db = firebase.database(), auth = firebase.auth();
    const role = currentUserRole, branch = currentBranch;
    let who = 'admin', name = 'Admin';

    if (role !== 'Admin') {
        const snap = await db.ref('stores/' + storeId + '/staff').once('value');
        const pick = wdaPickStaff(snap.val(), pin, role, branch);
        if (!pick) return { skipped: 'no matching staff record' };
        who = pick.key;
        name = pick.s.name || '';
    }

    const cred = await wdaCredentials(storeId, who, pin);
    let user = null, created = false;
    try {
        user = (await auth.signInWithEmailAndPassword(cred.email, cred.password)).user;
    } catch (e) {
        if (!wdaIsMissingAccountError(e.code)) return { error: e.code || e.message };
        try { user = (await auth.createUserWithEmailAndPassword(cred.email, cred.password)).user; created = true; }
        catch (e2) { return { error: e2.code || e2.message }; }
    }

    const base = 'stores/' + storeId + '/members/';
    const updates = {};
    const record = { role: role, who: who, name: name, at: new Date().toISOString() };
    if (role !== 'Admin') record.branchId = branch;
    updates[base + user.uid] = record;

    // Retire older accounts of the same person (e.g. from before a PIN change)
    const existing = (await db.ref('stores/' + storeId + '/members').once('value')).val() || {};
    Object.keys(existing).forEach(function (uid) {
        if (uid !== user.uid && existing[uid] && existing[uid].who === who) updates[base + uid] = null;
    });

    await db.ref().update(updates);
    return { ok: true, created: created, who: who };
}

function wdaWatchLogin(storeId, pin) {
    if (wdaOff() || !storeId || !pin) return;
    const key = storeId;
    if (wdaInFlight[key]) return;                      // two wrappers for the same login → run once
    wdaInFlight[key] = true;
    let tries = 0;
    const timer = setInterval(async function () {
        tries++;
        if (tries > 60) { clearInterval(timer); wdaInFlight[key] = false; return; }
        const isSuper = storeId === 'superadmin';
        const loggedIn = isSuper ? (currentStoreId === 'SUPER_ADMIN' && currentUserRole === 'SuperAdmin') : (currentStoreId === storeId && !!currentUserRole);
        if (!loggedIn) return;
        clearInterval(timer);
        try {
            const r = isSuper ? await wdaBindSuperAdmin(pin) : await wdaMigrateStoreUser(storeId, pin);
            console.log('[auth-patch]', storeId, r);
        } catch (e) { console.warn('[auth-patch] skipped:', e && e.message); }
        wdaInFlight[key] = false;
    }, 500);
}

function wdaWrapLogin() {
    const prev = window.handleStoreLogin;
    if (typeof prev !== 'function' || prev.__wda) return;
    const wrapped = function () {
        let sid = '', pin = '';
        try { sid = (document.getElementById('store-id-input').value || '').trim().toLowerCase(); pin = (document.getElementById('staff-pin').value || '').trim(); } catch (e) {}
        const result = prev.apply(this, arguments);   // the normal login runs exactly as before
        try { wdaWatchLogin(sid, pin); } catch (e) { console.warn(e); }
        return result;
    };
    wrapped.__wda = true;
    window.handleStoreLogin = wrapped;
}

function wdaOnLogout() {
    try {
        if (typeof firebase === 'undefined' || !firebase.auth) return;
        const u = firebase.auth().currentUser;
        const superEmail = (localStorage.getItem(WDA_SUPER_KEY) || '').toLowerCase();
        if (u && !(u.email && u.email.toLowerCase() === superEmail)) firebase.auth().signOut();   // keep the owner's own session
    } catch (e) {}
}
function wdaWrapLogout() {
    const prev = window.logout;
    if (typeof prev !== 'function' || prev.__wda) return;
    const wrapped = function () { const r = prev.apply(this, arguments); wdaOnLogout(); return r; };
    wrapped.__wda = true;
    window.logout = wrapped;
}

// =====================================================================
// SUPER ADMIN — bind your Firebase account (asked once per device)
// =====================================================================
function wdaAskSuperCreds(prefillEmail) {
    return new Promise(function (resolve) {
        let m = document.getElementById('wda-super-modal');
        if (m) m.remove();
        m = document.createElement('div');
        m.id = 'wda-super-modal';
        m.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; justify-content:center; align-items:center; z-index:1600; padding:16px; box-sizing:border-box;';
        const field = 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; margin:4px 0 10px; box-sizing:border-box; font-size:14px;';
        m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:420px; padding:18px; box-sizing:border-box;">' +
            '<h3 style="margin:0 0 6px; font-size:17px;">🔐 Secure Super Admin mode</h3>' +
            '<p style="font-size:12px; color:#64748b; margin:0 0 12px;">One-time step on this device. Sign in with the email and password of your Firebase admin account. This lets the database be locked safely later. Nothing here is saved except your email.</p>' +
            '<label style="font-size:12px; font-weight:bold;">Firebase admin email</label><input id="wda-sm-email" type="email" value="' + wdaEsc(prefillEmail) + '" autocapitalize="none" style="' + field + '">' +
            '<label style="font-size:12px; font-weight:bold;">Password</label><input id="wda-sm-pass" type="password" style="' + field + '">' +
            '<div style="display:flex; gap:8px;"><button id="wda-sm-ok" class="menu-btn btn-action-primary" style="justify-content:center; margin:0; flex:1;">Sign in</button>' +
            '<button id="wda-sm-skip" class="menu-btn" style="margin:0; width:auto; background:#f1f5f9; border:1px solid #cbd5e1;">Not now</button></div></div>';
        document.body.appendChild(m);
        const done = function (v) { m.remove(); resolve(v); };
        document.getElementById('wda-sm-ok').onclick = function () {
            const email = document.getElementById('wda-sm-email').value.trim(), password = document.getElementById('wda-sm-pass').value;
            if (!email || !password) { alert('Enter both the email and the password.'); return; }
            done({ email: email, password: password });
        };
        document.getElementById('wda-sm-skip').onclick = function () { done(null); };
    });
}

async function wdaBindSuperAdmin(typedPin) {
    await wdaLoadAuth();
    const auth = firebase.auth(), db = firebase.database();
    const saved = (function () { try { return localStorage.getItem(WDA_SUPER_KEY) || ''; } catch (e) { return ''; } })();
    const cur = auth.currentUser;
    if (cur && cur.email && saved && cur.email.toLowerCase() === saved.toLowerCase()) {
        await db.ref('admins/' + cur.uid).set(true);
        return { ok: true, already: true };
    }
    if (saved && String(typedPin).length >= 6) {          // if your master PIN happens to be the same as your Firebase password
        try {
            const u = (await auth.signInWithEmailAndPassword(saved, typedPin)).user;
            await db.ref('admins/' + u.uid).set(true);
            return { ok: true };
        } catch (e) { /* fall through to the form */ }
    }
    if (wdaSkipSuperThisSession) return { skipped: true };
    const creds = await wdaAskSuperCreds(saved);
    if (!creds) { wdaSkipSuperThisSession = true; return { skipped: true }; }
    try {
        const u = (await auth.signInWithEmailAndPassword(creds.email, creds.password)).user;
        try { localStorage.setItem(WDA_SUPER_KEY, creds.email); } catch (e) {}
        await db.ref('admins/' + u.uid).set(true);
        alert('✅ Super Admin mode secured on this device.');
        return { ok: true };
    } catch (e) {
        wdaSkipSuperThisSession = true;
        alert('Could not sign in: ' + (e.code || e.message) + '\n\nCheck the email and password. You can try again at your next login. Nothing was changed.');
        return { error: e.code || e.message };
    }
}

// =====================================================================
// SUPER ADMIN — "🔐 Security" status screen
// =====================================================================
function wdaModal(title, html) {
    let m = document.getElementById('wda-status-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wda-status-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1550; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:560px; max-height:94vh; overflow-y:auto; padding:18px; box-sizing:border-box;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;"><h3 style="margin:0; font-size:17px;">' + wdaEsc(title) + '</h3>' +
        '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="document.getElementById(\'wda-status-modal\').style.display=\'none\'">✕</button></div>' + html + '</div>';
    m.style.display = 'flex';
}

async function wdaOpenStatus() {
    if (currentUserRole !== 'SuperAdmin') return;
    wdaModal('🔐 Security status', '<div style="text-align:center; color:#64748b; padding:24px;">Checking every store...</div>');
    try {
        await wdaLoadAuth();
        const db = firebase.database();
        const ids = typeof wdsListStoreIds === 'function' ? await wdsListStoreIds() : [];
        const rows = await Promise.all(ids.map(async function (id) {
            const r = db.ref('stores/' + id);
            const res = await Promise.all([r.child('businessName').once('value'), r.child('status').once('value'), r.child('members').once('value'), r.child('staff').once('value')]);
            return wdaStoreRow(id, res[0].val(), res[1].val(), res[2].val(), res[3].val());
        }));
        rows.sort(function (a, b) { return (a.adminDone && a.staffDone >= a.staffTotal ? 1 : 0) - (b.adminDone && b.staffDone >= b.staffTotal ? 1 : 0) || String(a.name).localeCompare(String(b.name)); });
        const sum = wdaSummarize(rows);

        const cu = firebase.auth().currentUser;
        let bound = false;
        if (cu) { try { bound = (await db.ref('admins/' + cu.uid).once('value')).val() === true; } catch (e) {} }

        const chip = function (ok, text) { return '<span style="background:' + (ok ? '#dcfce7' : '#fef3c7') + '; color:' + (ok ? '#166534' : '#92400e') + '; font-size:11px; font-weight:bold; padding:2px 8px; border-radius:10px;">' + text + '</span>'; };
        const body =
            '<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; font-size:13px; margin-bottom:12px; line-height:1.7;">' +
            'Your Super Admin account: ' + chip(bound, bound ? 'SECURED' : 'NOT YET') + '<br>' +
            'Stores fully protected: <strong>' + sum.fullyDone + ' of ' + sum.stores + '</strong><br>' +
            'Store owners protected: <strong>' + sum.adminsDone + ' of ' + sum.stores + '</strong> · Staff protected: <strong>' + sum.staffDone + ' of ' + sum.staffTotal + '</strong></div>' +
            '<div style="font-size:12px; color:#64748b; margin-bottom:10px;">A person becomes protected the first time they log in normally after this update. When every active store shows a full tick, it is safe to move to the next phase.</div>' +
            (rows.length ? rows.map(function (r) {
                const full = r.adminDone && r.staffDone >= r.staffTotal;
                return '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 0; border-top:1px solid #e2e8f0; font-size:13px;">' +
                    '<div><strong>' + wdaEsc(r.name) + '</strong>' + (r.status === 'suspended' ? ' <small style="color:#991b1b;">(locked)</small>' : '') + '<br><small style="color:#64748b;">' + wdaEsc(r.id) + '</small></div>' +
                    '<div style="text-align:right; font-size:12px;">Owner ' + chip(r.adminDone, r.adminDone ? '✓' : 'waiting') + '<br>Staff ' + chip(r.staffDone >= r.staffTotal, r.staffDone + '/' + r.staffTotal) + (full ? ' ✅' : '') + '</div></div>';
            }).join('') : '<div style="text-align:center; color:#64748b; padding:16px;">No stores found.</div>');
        wdaModal('🔐 Security status', body);
    } catch (e) {
        wdaModal('🔐 Security status', '<div style="color:#b91c1c; padding:12px;">Could not load: ' + wdaEsc(e.message) + '</div>');
    }
}

function wdaAttach() {
    if (currentUserRole !== 'SuperAdmin') return;
    const bar = document.getElementById('wds-extra-toolbar');
    if (bar && !document.getElementById('wda-btn-security')) {
        const b = document.createElement('button');
        b.id = 'wda-btn-security';
        b.className = 'menu-btn';
        b.style.cssText = 'width:auto; margin:0; padding:8px 12px; font-size:12px; font-weight:bold; background:#eef2ff; border:1px solid #c7d2fe; color:#3730a3;';
        b.textContent = '🔐 Security';
        b.onclick = wdaOpenStatus;
        bar.appendChild(b);
    }
}
setInterval(function () { try { wdaAttach(); } catch (e) { console.warn(e); } }, 1500);

// Wrap the login/logout once now, and once more after the page finishes loading (in case another file replaced them)
wdaWrapLogin(); wdaWrapLogout();
window.addEventListener('load', function () { wdaWrapLogin(); wdaWrapLogout(); });
