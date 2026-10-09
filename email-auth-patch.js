// ==================== WISE DECISION EMAIL AUTH PATCH (v1) ====================
// Load LAST, after auth-patch.js (defer).
//
// Login is now real Firebase Authentication email + password for owners, staff,
// and Super Admin. Existing data is untouched. Only HOW people sign in changes.
//
// Emergency switch, three ways:
//   1. localStorage.setItem('wd_email_auth_off','1')
//   2. Visit the app with  ?emailauth=off
//   3. localStorage.removeItem('wd_email_auth_off')   to re-enable

console.log("Wise Decision email-auth-patch.js v1 loaded");

var WDAE_FAKE_DOMAIN = 'wd.invalid';
var WDAE_SUPER_EMAIL_KEY = 'wd_super_email';

// ---------- Helpers ----------
function wdaeOff() {
    try {
        if (new URLSearchParams(location.search).get('emailauth') === 'off') return true;
        if (new URLSearchParams(location.search).get('emailauth') === 'on') return false;
        return localStorage.getItem('wd_email_auth_off') === '1';
    } catch (e) { return false; }
}
function wdaeEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wdaeLoadAuth() {
    if (typeof firebase !== 'undefined' && firebase.auth) return Promise.resolve();
    return new Promise(function (resolve, reject) {
        const s = document.createElement('script');
        s.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js';
        s.onload = resolve;
        s.onerror = function () { reject(new Error('Could not load Firebase Auth library')); };
        document.head.appendChild(s);
    });
}
async function wdaeSha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}
async function wdaeDerivedCreds(storeId, who, pin) {
    const idHash = await wdaeSha256Hex('wd-auth-id-v1|' + storeId + '|' + who + '|' + pin);
    const pwHash = await wdaeSha256Hex('wd-auth-pw-v1|' + storeId + '|' + who + '|' + pin);
    return { email: 'wd.' + idHash.slice(0, 40) + '@' + WDAE_FAKE_DOMAIN, password: pwHash };
}

// =====================================================================
// LOGIN SCREEN
// =====================================================================
function wdaeBuildLoginScreen() {
    const loginView = document.getElementById('login-view');
    if (!loginView) return;
    const card = loginView.querySelector('.auth-card');
    if (!card) return;
    card.innerHTML =
        '<div class="brand-title"><span class="big-w">W</span>ISE DECISION</div>' +
        '<div class="subtitle">Cloud Enterprise & POS Portal</div>' +

        '<div class="form-group">' +
            '<label>Email</label>' +
            '<input type="email" id="wdae-email" placeholder="you@example.com" autocapitalize="none" autocomplete="email">' +
        '</div>' +
        '<div class="form-group">' +
            '<label>Password</label>' +
            '<input type="password" id="wdae-password" placeholder="Your password" autocomplete="current-password">' +
        '</div>' +

        '<button class="menu-btn btn-action-primary" id="wdae-signin-btn">Sign in</button>' +

        '<div style="text-align:center; margin-top:10px;">' +
            '<a href="javascript:void(0)" id="wdae-forgot-link" style="font-size:12px; color:#0284c7; text-decoration:underline;">Forgot password?</a>' +
        '</div>' +

        '<div style="text-align:center; margin:16px 0 8px 0; color:#94a3b8; font-size:11px;">─── or ───</div>' +

        '<button class="menu-btn btn-secondary" id="wdae-setup-btn" style="font-size:12px;">First time? Set up email login</button>' +

        '<button class="menu-btn btn-secondary" id="wdae-register-btn" style="margin-top:10px; font-size:12px;">Register New Business</button>' +

        '<div id="wdae-login-msg" style="display:none; margin-top:12px; padding:10px; border-radius:8px; font-size:12px; text-align:center;"></div>';

    const emailEl = document.getElementById('wdae-email');
    const passEl = document.getElementById('wdae-password');
    const signinBtn = document.getElementById('wdae-signin-btn');
    const forgotLink = document.getElementById('wdae-forgot-link');
    const setupBtn = document.getElementById('wdae-setup-btn');
    const registerBtn = document.getElementById('wdae-register-btn');

    signinBtn.onclick = wdaeSignInWithEmail;
    forgotLink.onclick = wdaeForgotPassword;
    setupBtn.onclick = function () { wdaeOpenBindModal(); };
    registerBtn.onclick = function () { switchView('register-view'); };

    passEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') wdaeSignInWithEmail(); });
    emailEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') passEl.focus(); });

    try {
        const saved = localStorage.getItem('wdae_last_email');
        if (saved) emailEl.value = saved;
    } catch (e) {}
}

function wdaeSetLoginMessage(text, ok) {
    const el = document.getElementById('wdae-login-msg');
    if (!el) return;
    if (!text) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.background = ok ? '#dcfce7' : '#fee2e2';
    el.style.color = ok ? '#166534' : '#991b1b';
    el.textContent = text;
}

// =====================================================================
// SIGN IN
// =====================================================================
async function wdaeSignInWithEmail() {
    if (wdaeOff()) return;
    const email = (document.getElementById('wdae-email').value || '').trim();
    const password = document.getElementById('wdae-password').value || '';
    if (!email || !password) { wdaeSetLoginMessage('Enter both your email and password.', false); return; }

    wdaeSetLoginMessage('Signing in...', true);
    const btn = document.getElementById('wdae-signin-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }

    try {
        await wdaeLoadAuth();
        const userCred = await firebase.auth().signInWithEmailAndPassword(email, password);
        try { localStorage.setItem('wdae_last_email', email); } catch (e) {}
        const user = userCred.user;
        const uid = user.uid;

        // Option B: email must be verified before access.
        if (!user.emailVerified) {
            wdaeShowVerifyPanel(email);
            return;
        }

        const memberships = await wdaeResolveAllMemberships(uid, email);

        if (memberships.length === 0) {
            await firebase.auth().signOut();
            wdaeSetLoginMessage('This account is not linked to a store yet. Ask your store owner to add you, or use "Set up email login".', false);
            return;
        }

        // If multiple memberships and a choice was made in the last 24h, use it.
        if (memberships.length > 1) {
            try {
                const last = JSON.parse(localStorage.getItem('wdae_last_store_' + uid) || 'null');
                if (last && last.storeId && (Date.now() - last.at) < 24 * 60 * 60 * 1000) {
                    const remembered = memberships.find(function (m) { return (m.storeId || 'SUPER_ADMIN') === last.storeId; });
                    if (remembered) {
                        wdaeSetLoginMessage('Welcome back!', true);
                        setTimeout(function () { wdaeCompleteLogin(remembered); }, 400);
                        return;
                    }
                }
            } catch (e) { /* ignore */ }
        }

        if (memberships.length === 1) {
            wdaeSetLoginMessage('Welcome!', true);
            setTimeout(function () { wdaeCompleteLogin(memberships[0]); }, 400);
            return;
        }

        wdaeSetLoginMessage('Choose a store to continue.', true);
        setTimeout(function () { wdaeChooseStore(memberships); }, 300);
    } catch (e) {
        const code = e && e.code || '';
        let msg = 'Sign in failed.';
        if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
            msg = 'Email or password is incorrect.';
        } else if (code === 'auth/too-many-requests') {
            msg = 'Too many attempts. Please wait a few minutes and try again.';
        } else if (code === 'auth/network-request-failed') {
            msg = 'No internet. Check your connection and try again.';
        } else {
            msg = 'Sign in failed: ' + (code || (e && e.message) || 'unknown error');
        }
        wdaeSetLoginMessage(msg, false);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
    }
}

// =====================================================================
// EMAIL VERIFICATION PANEL
// =====================================================================
function wdaeShowVerifyPanel(email) {
    const card = document.querySelector('#login-view .auth-card');
    if (!card) return;
    card.innerHTML =
        '<div class="brand-title"><span class="big-w">W</span>ISE DECISION</div>' +
        '<div class="subtitle">Verify your email</div>' +

        '<p style="font-size:13px; color:#475569; margin:10px 0 14px;">' +
            'We sent a verification link to <strong>' + wdaeEsc(email) + '</strong>. ' +
            'Open the link in that email to activate your account, then come back here and sign in.' +
        '</p>' +

        '<button class="menu-btn btn-action-primary" id="wdae-verify-resend">Resend verification email</button>' +
        '<button class="menu-btn btn-secondary" id="wdae-verify-back" style="margin-top:10px;">Back to sign in</button>' +

        '<div id="wdae-login-msg" style="display:none; margin-top:12px; padding:10px; border-radius:8px; font-size:12px; text-align:center;"></div>';

    document.getElementById('wdae-verify-resend').onclick = async function () {
        try {
            await wdaeLoadAuth();
            const user = firebase.auth().currentUser;
            if (user) await user.sendEmailVerification();
            wdaeSetLoginMessage('Verification email sent again. Check your inbox and spam folder.', true);
        } catch (e) {
            wdaeSetLoginMessage('Could not resend: ' + (e && (e.code || e.message)), false);
        }
    };
    document.getElementById('wdae-verify-back').onclick = function () {
        firebase.auth().signOut().catch(function () {});
        wdaeBuildLoginScreen();
    };
}

// =====================================================================
// MEMBERSHIPS
// =====================================================================
async function wdaeResolveAllMemberships(uid, email) {
    const db = firebase.database();
    const memberships = [];

    try {
        const adminSnap = await db.ref('admins/' + uid).once('value');
        if (adminSnap.val() === true) {
            memberships.push({ kind: 'super', uid: uid, email: email });
        }
    } catch (e) { /* ignore */ }

    try {
        const storesSnap = await db.ref('stores').once('value');
        const stores = storesSnap.val() || {};
        Object.keys(stores).forEach(function (storeId) {
            const members = (stores[storeId] && stores[storeId].members) || {};
            const m = members[uid];
            if (m) {
                memberships.push({
                    kind: 'member',
                    uid: uid,
                    email: email,
                    storeId: storeId,
                    storeName: (stores[storeId] && stores[storeId].businessName) || storeId,
                    role: m.role || 'Admin',
                    branchId: m.branchId || 'main',
                    name: m.name || ''
                });
            }
        });
    } catch (e) { /* ignore */ }

    try {
        const storeIds = memberships.filter(function (m) { return m.kind === 'member'; }).map(function (m) { return m.storeId; });
        if (storeIds.length > 0) {
            await db.ref('userIndex/' + uid).set({ storeIds: storeIds });
        }
    } catch (e) { /* ignore */ }

    return memberships;
}

function wdaeChooseStore(memberships) {
    let m = document.getElementById('wdae-choose-store');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'wdae-choose-store';
    m.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; justify-content:center; align-items:center; z-index:1700; padding:16px; box-sizing:border-box; overflow-y:auto;';

    const rows = memberships.map(function (mem, i) {
        if (mem.kind === 'super') {
            return '<button data-idx="' + i + '" class="wdae-choose-btn menu-btn btn-action-primary" style="width:100%; justify-content:center; margin:0 0 8px; text-align:left;">' +
                '<span style="display:block; font-weight:bold;">👑 Master Control</span>' +
                '<span style="display:block; font-size:11px; font-weight:normal; color:#e2e8f0;">Super Admin dashboard</span>' +
            '</button>';
        }
        return '<button data-idx="' + i + '" class="wdae-choose-btn menu-btn" style="width:100%; justify-content:flex-start; margin:0 0 8px; background:#f8fafc; border:1px solid #e2e8f0; color:#0f172a; text-align:left;">' +
            '<span style="display:block; font-weight:bold;">' + wdaeEsc(mem.storeName) + '</span>' +
            '<span style="display:block; font-size:11px; font-weight:normal; color:#64748b;">' + wdaeEsc(mem.role) + ' · ' + wdaeEsc(mem.storeId) + '</span>' +
        '</button>';
    }).join('');

    m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:400px; padding:20px; box-sizing:border-box; max-height:92vh; overflow-y:auto;">' +
        '<h3 style="margin:0 0 4px; font-size:17px;">Choose where to go</h3>' +
        '<p style="font-size:12px; color:#64748b; margin:0 0 14px;">Your account is linked to more than one place. Pick one to continue.</p>' +
        rows +
        '<button id="wdae-choose-cancel" class="menu-btn" style="width:100%; margin-top:6px; background:#f1f5f9; border:1px solid #cbd5e1;">Cancel</button>' +
    '</div>';
    document.body.appendChild(m);

    m.querySelectorAll('.wdae-choose-btn').forEach(function (btn) {
        btn.onclick = function () {
            const idx = parseInt(btn.dataset.idx, 10);
            const mem = memberships[idx];
            m.remove();
            try {
                localStorage.setItem('wdae_last_store_' + mem.uid, JSON.stringify({ storeId: mem.storeId || 'SUPER_ADMIN', at: Date.now() }));
            } catch (e) {}
            wdaeCompleteLogin(mem);
        };
    });
    document.getElementById('wdae-choose-cancel').onclick = function () {
        m.remove();
        firebase.auth().signOut().catch(function () {});
        wdaeSetLoginMessage('Signed out. Enter your credentials to sign in again.', false);
    };
}

function wdaeCompleteLogin(resolved) {
    if (resolved.kind === 'super') {
        currentStoreId = 'SUPER_ADMIN';
        currentUserRole = 'SuperAdmin';
        currentBranch = 'main';
        try {
            document.getElementById('dashboard-store-title').textContent = 'Wise Decision Master Control';
            document.getElementById('user-role-label').textContent = 'Logged in as Super Admin';
        } catch (e) {}
        if (typeof adjustSidebarForRole === 'function') adjustSidebarForRole('SuperAdmin');
        if (typeof loadSuperAdminDashboard === 'function') loadSuperAdminDashboard();
        if (typeof resetIdleTimer === 'function') resetIdleTimer();
        switchView('super-admin-view');
        return;
    }

    currentStoreId = resolved.storeId;
    currentUserRole = resolved.role;
    currentBranch = resolved.branchId || 'main';
    currentInventoryBranchFilter = currentBranch;

    try {
        const titleEl = document.getElementById('dashboard-store-title');
        const roleEl = document.getElementById('user-role-label');
        if (titleEl) titleEl.textContent = resolved.name || resolved.storeId;
        if (roleEl) roleEl.textContent = resolved.name ? (resolved.name + ' (' + resolved.role + ')') : resolved.role;
    } catch (e) {}

    if (typeof adjustSidebarForRole === 'function') adjustSidebarForRole(resolved.role);

    try {
        if (typeof loadBranchesCache === 'function') loadBranchesCache(function () {
            if (resolved.role === 'Accountant' || resolved.role === 'Cashier') switchView('accountant-view');
            else if (resolved.role === 'Standard Worker') switchView('pos-view');
            else switchView('main-dashboard-view');
        });
    } catch (e) { switchView('pos-view'); }

    try { if (typeof syncOfflineQueueToFirebase === 'function') syncOfflineQueueToFirebase(); } catch (e) {}
    try { if (typeof subscribeCustomersCache === 'function') subscribeCustomersCache(); } catch (e) {}
    try { if (typeof subscribeSuppliersCache === 'function') subscribeSuppliersCache(); } catch (e) {}
    try { if (typeof loadSuppliersCache === 'function') loadSuppliersCache(); } catch (e) {}
    try { if (typeof resetIdleTimer === 'function') resetIdleTimer(); } catch (e) {}
}

// =====================================================================
// FORGOT PASSWORD
// =====================================================================
async function wdaeForgotPassword() {
    const email = (document.getElementById('wdae-email').value || '').trim();
    if (!email) {
        wdaeSetLoginMessage('Type your email above first, then tap "Forgot password?".', false);
        return;
    }
    if (!confirm('Send a password-reset link to ' + email + '?')) return;
    try {
        await wdaeLoadAuth();
        await firebase.auth().sendPasswordResetEmail(email);
        wdaeSetLoginMessage('Reset email sent. Check your inbox (and spam folder).', true);
    } catch (e) {
        const code = e && e.code || '';
        if (code === 'auth/user-not-found') wdaeSetLoginMessage('No account found with that email.', false);
        else wdaeSetLoginMessage('Could not send reset email: ' + (code || e.message), false);
    }
}

// =====================================================================
// FIRST-TIME EMAIL BINDING
// =====================================================================
function wdaeOpenBindModal(prefillStoreId) {
    let m = document.getElementById('wdae-bind-modal');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'wdae-bind-modal';
    m.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); display:flex; justify-content:center; align-items:center; z-index:1700; padding:16px; box-sizing:border-box; overflow-y:auto;';
    const field = 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; margin:4px 0 12px; box-sizing:border-box; font-size:14px;';
    m.innerHTML = '<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:440px; padding:20px; box-sizing:border-box; max-height:92vh; overflow-y:auto;">' +
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:8px;">' +
            '<h3 style="margin:0; font-size:17px;">Set up email login</h3>' +
            '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="document.getElementById(\'wdae-bind-modal\').remove()">✕</button>' +
        '</div>' +
        '<p style="font-size:12px; color:#64748b; margin:0 0 14px;">Use this once to link an email to your existing account. After this, you can log in with your email and password.</p>' +

        '<label style="font-size:12px; font-weight:bold;">Store ID</label>' +
        '<input id="wdae-b-store" type="text" placeholder="e.g. medstar" autocapitalize="none" value="' + wdaeEsc(prefillStoreId || '') + '" style="' + field + '">' +

        '<label style="font-size:12px; font-weight:bold;">Your current PIN</label>' +
        '<input id="wdae-b-pin" type="password" placeholder="The PIN you use today" style="' + field + '">' +

        '<label style="font-size:12px; font-weight:bold;">Your name (for records)</label>' +
        '<input id="wdae-b-name" type="text" placeholder="e.g. Emmanuel Ayoola" style="' + field + '">' +

        '<label style="font-size:12px; font-weight:bold;">Your email</label>' +
        '<input id="wdae-b-email" type="email" placeholder="you@example.com" autocapitalize="none" style="' + field + '">' +

        '<label style="font-size:12px; font-weight:bold;">Choose a password (at least 6 characters)</label>' +
        '<input id="wdae-b-pass" type="password" placeholder="Password" style="' + field + '">' +

        '<label style="font-size:12px; font-weight:bold;">Confirm password</label>' +
        '<input id="wdae-b-pass2" type="password" placeholder="Repeat password" style="' + field + '">' +

        '<div id="wdae-b-msg" style="display:none; padding:10px; border-radius:8px; font-size:12px; margin-bottom:12px;"></div>' +

        '<div style="display:flex; gap:8px;">' +
            '<button id="wdae-b-ok" class="menu-btn btn-action-primary" style="flex:1; justify-content:center; margin:0;">Create my email login</button>' +
            '<button class="menu-btn" style="width:auto; margin:0; background:#f1f5f9; border:1px solid #cbd5e1;" onclick="document.getElementById(\'wdae-bind-modal\').remove()">Cancel</button>' +
        '</div>' +
    '</div>';
    document.body.appendChild(m);
    document.getElementById('wdae-b-ok').onclick = wdaeSubmitBinding;
}

function wdaeBindMessage(text, ok) {
    const el = document.getElementById('wdae-b-msg');
    if (!el) return;
    el.style.display = 'block';
    el.style.background = ok ? '#dcfce7' : '#fee2e2';
    el.style.color = ok ? '#166534' : '#991b1b';
    el.textContent = text;
}

async function wdaeSubmitBinding() {
    const storeId = (document.getElementById('wdae-b-store').value || '').trim().toLowerCase();
    const pin = (document.getElementById('wdae-b-pin').value || '').trim();
    const name = (document.getElementById('wdae-b-name').value || '').trim();
    const email = (document.getElementById('wdae-b-email').value || '').trim();
    const password = document.getElementById('wdae-b-pass').value || '';
    const password2 = document.getElementById('wdae-b-pass2').value || '';

    if (!storeId || !pin || !email || !password) { wdaeBindMessage('Fill in store, PIN, email, and password.', false); return; }
    if (password.length < 6) { wdaeBindMessage('Password must be at least 6 characters.', false); return; }
    if (password !== password2) { wdaeBindMessage("Passwords don't match.", false); return; }

    const btn = document.getElementById('wdae-b-ok');
    if (btn) { btn.disabled = true; btn.textContent = 'Working...'; }

    try {
        await wdaeLoadAuth();
        const auth = firebase.auth();
        const db = firebase.database();

        const adminPinSnap = await db.ref('stores/' + storeId + '/adminPin').once('value');
        const staffSnap = await db.ref('stores/' + storeId + '/staff').once('value');

        if (!adminPinSnap.exists() && !staffSnap.exists()) {
            wdaeBindMessage('Store ID not found.', false);
            return;
        }

        let role = null, who = null, branchId = 'main', record = {};

        if (adminPinSnap.exists() && String(adminPinSnap.val()) === pin) {
            role = 'Admin'; who = 'admin'; record = { role: 'Admin', who: 'admin', name: name || 'Admin' };
        } else {
            const staff = staffSnap.val() || {};
            const keys = Object.keys(staff);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (String(staff[k].pin) === pin) {
                    role = staff[k].role; who = k; branchId = staff[k].branchId || 'main';
                    record = { role: role, who: k, name: name || staff[k].name || '', branchId: branchId };
                    break;
                }
            }
        }
        if (!role) { wdaeBindMessage('That PIN does not match this store.', false); return; }

        let user;
        try {
            user = (await auth.createUserWithEmailAndPassword(email, password)).user;
        } catch (e) {
            if (e.code === 'auth/email-already-in-use') {
                try {
                    user = (await auth.signInWithEmailAndPassword(email, password)).user;
                } catch (e2) {
                    wdaeBindMessage('That email already has an account, and the password you typed does not match it.', false);
                    return;
                }
            } else {
                throw e;
            }
        }

        // Send verification email right away.
        try { await user.sendEmailVerification(); } catch (e) { /* non-fatal */ }

        record.at = new Date().toISOString();
        await db.ref('stores/' + storeId + '/members/' + user.uid).set(record);
        await db.ref('userIndex/' + user.uid).set({ storeIds: [storeId] });

        // If this was a PIN-only staff member, retire their PIN field.
        if (who && who !== 'admin') {
            try { await db.ref('stores/' + storeId + '/staff/' + who + '/pin').remove(); } catch (e) {}
        }

        wdaeBindMessage('Almost done. We sent a verification link to ' + email + '. Click it, then come back and sign in.', true);
        setTimeout(function () {
            const m = document.getElementById('wdae-bind-modal');
            if (m) m.remove();
            const emailEl = document.getElementById('wdae-email');
            if (emailEl) emailEl.value = email;
            wdaeShowVerifyPanel(email);
        }, 1200);
    } catch (e) {
        wdaeBindMessage('Could not set up: ' + (e && (e.code || e.message) || 'unknown error'), false);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Create my email login'; }
    }
}

// =====================================================================
// CHANGE MY PASSWORD
// =====================================================================
async function wdaeChangeMyPassword() {
    if (wdaeOff()) return;
    try {
        await wdaeLoadAuth();
        const user = firebase.auth().currentUser;
        if (!user) { alert('You are not signed in with a real email account.'); return; }
        const newPass = prompt('Enter your new password (at least 6 characters):');
        if (newPass === null) return;
        if (newPass.length < 6) { alert('Password must be at least 6 characters.'); return; }
        const confirm2 = prompt('Re-enter the new password to confirm:');
        if (confirm2 !== newPass) { alert("Passwords didn't match. Nothing changed."); return; }
        await user.updatePassword(newPass);
        alert('Password updated. Use the new one next time you sign in.');
    } catch (e) {
        if (e && e.code === 'auth/requires-recent-login') {
            alert('For security, please sign out, sign back in, and then change your password.');
        } else {
            alert('Could not update password: ' + (e && (e.code || e.message)));
        }
    }
}

// =====================================================================
// ADD STAFF
// =====================================================================
function wdaeInstallAddStaffWrapper() {
    if (wdaeOff()) return;
    const prevAddStaff = window.addStaffMember;
    if (typeof prevAddStaff !== 'function') { console.warn('[email-auth-patch] addStaffMember not found'); return; }
    if (prevAddStaff.__wdae) return;

    const wrapped = async function () {
        if (wdaeOff()) return prevAddStaff.apply(this, arguments);

        const nameEl = document.getElementById('staff-name-input');
        const pinEl = document.getElementById('staff-pin-input');
        const roleEl = document.getElementById('staff-role-input');
        const branchEl = document.getElementById('staff-branch-input');

        const name = (nameEl && nameEl.value || '').trim();
        const pin = (pinEl && pinEl.value || '').trim();
        const role = (roleEl && roleEl.value) || 'Standard Worker';
        const branchId = (branchEl && branchEl.value) || 'main';

        let email = '';
        const emailEl = document.getElementById('staff-email-input');
        if (emailEl) email = (emailEl.value || '').trim();
        if (!email) email = (prompt("Enter the staff member's email address:") || '').trim();

        if (!name || !email || !pin) {
            alert('Staff name, email, and a temporary password are required.');
            return;
        }
        if (pin.length < 6) {
            alert('The temporary password must be at least 6 characters.');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            alert('That email address does not look valid.');
            return;
        }

        if (!confirm(
            'Add staff member:\n\n' +
            'Name: ' + name + '\n' +
            'Email: ' + email + '\n' +
            'Role: ' + role + '\n' +
            'Temporary password: the one you typed\n\n' +
            'They will get a verification email, then log in with ' + email + '.'
        )) return;

        try {
            await wdaeLoadAuth();
            const db = firebase.database();

            const secondaryName = 'wdae-staff-create-' + Date.now();
            const secondary = firebase.initializeApp(firebase.app().options, secondaryName);
            const secondaryAuth = secondary.auth();

            let newUser;
            try {
                newUser = (await secondaryAuth.createUserWithEmailAndPassword(email, pin)).user;
            } catch (e) {
                if (e.code === 'auth/email-already-in-use') {
                    alert('That email already has an account. Ask the staff member to log in with it, or use a different email.');
                    await secondary.delete().catch(function () {});
                    return;
                }
                await secondary.delete().catch(function () {});
                throw e;
            }

            try { await newUser.sendEmailVerification(); } catch (e) { /* non-fatal */ }

            await db.ref('stores/' + currentStoreId + '/staff/' + newUser.uid).set({
                name: name,
                email: email,
                role: role,
                branchId: branchId,
                createdAt: new Date().toISOString()
            });

            await db.ref('stores/' + currentStoreId + '/members/' + newUser.uid).set({
                role: role,
                who: newUser.uid,
                name: name,
                branchId: branchId,
                at: new Date().toISOString()
            });
            await db.ref('userIndex/' + newUser.uid).set({ storeIds: [currentStoreId] });

            await secondaryAuth.signOut().catch(function () {});
            await secondary.delete().catch(function () {});

            if (nameEl) nameEl.value = '';
            if (pinEl) pinEl.value = '';
            if (emailEl) emailEl.value = '';

            alert(
                'Staff added.\n\n' +
                'A verification email was sent to ' + email + '.\n' +
                'Tell them to click the link, then sign in with that email and the temporary password you typed.'
            );

            try { if (typeof loadStaffTable === 'function') loadStaffTable(); } catch (e) {}
        } catch (e) {
            const code = e && e.code || '';
            if (code === 'auth/weak-password') alert('The temporary password is too weak. Use at least 6 characters.');
            else if (code === 'auth/invalid-email') alert('Firebase rejected the email as invalid.');
            else alert('Could not add staff: ' + (code || (e && e.message) || 'unknown error'));
        }
    };

    wrapped.__wdae = true;
    window.addStaffMember = wrapped;
    console.log('[email-auth-patch] addStaffMember wrapper installed');
}

// =====================================================================
// UPGRADE PIN-ONLY STAFF TO EMAIL LOGIN
// =====================================================================
async function wdaeUpgradePinOnlyStaff(staffKey) {
    if (wdaeOff()) return;
    try {
        await wdaeLoadAuth();
        const db = firebase.database();

        const snap = await db.ref('stores/' + currentStoreId + '/staff/' + staffKey).once('value');
        const staff = snap.val();
        if (!staff) { alert('Staff record not found.'); return; }

        const email = (prompt('Enter ' + (staff.name || 'this staff') + '\'s email address:') || '').trim();
        if (!email) return;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('That email address does not look valid.'); return; }

        const tempPassword = prompt('Set a temporary password (at least 6 characters). ' + (staff.name || 'They') + ' will change it after first login:', '');
        if (!tempPassword) return;
        if (tempPassword.length < 6) { alert('Password must be at least 6 characters.'); return; }

        const secondaryName = 'wdae-upgrade-' + Date.now();
        const secondary = firebase.initializeApp(firebase.app().options, secondaryName);
        const secondaryAuth = secondary.auth();

        let newUser;
        try {
            newUser = (await secondaryAuth.createUserWithEmailAndPassword(email, tempPassword)).user;
        } catch (e) {
            if (e.code === 'auth/email-already-in-use') {
                alert('That email already has an account. Use the "Set up email login" flow instead, or pick a different email.');
                await secondary.delete().catch(function () {});
                return;
            }
            await secondary.delete().catch(function () {});
            throw e;
        }

        try { await newUser.sendEmailVerification(); } catch (e) { /* non-fatal */ }

        await db.ref('stores/' + currentStoreId + '/staff/' + newUser.uid).set({
            name: staff.name || '',
            email: email,
            role: staff.role || 'Standard Worker',
            branchId: staff.branchId || 'main',
            createdAt: new Date().toISOString()
        });
        await db.ref('stores/' + currentStoreId + '/members/' + newUser.uid).set({
            role: staff.role || 'Standard Worker',
            who: newUser.uid,
            name: staff.name || '',
            branchId: staff.branchId || 'main',
            at: new Date().toISOString()
        });
        await db.ref('userIndex/' + newUser.uid).set({ storeIds: [currentStoreId] });

        await db.ref('stores/' + currentStoreId + '/staff/' + staffKey).remove();

        await secondaryAuth.signOut().catch(function () {});
        await secondary.delete().catch(function () {});

        alert(
            'Upgraded.\n\n' +
            'A verification email was sent to ' + email + '.\n' +
            'Tell ' + (staff.name || 'them') + ' to click the link, then log in with that email and the temporary password.'
        );

        try { if (typeof loadStaffTable === 'function') loadStaffTable(); } catch (e) {}
    } catch (e) {
        alert('Could not upgrade: ' + (e && (e.code || e.message) || 'unknown error'));
    }
}

// =====================================================================
// DELETE STAFF
// =====================================================================
function wdaeInstallDeleteStaffWrapper() {
    if (wdaeOff()) return;
    const prevDelete = window.deleteStaff;
    if (typeof prevDelete !== 'function' || prevDelete.__wdae) return;

    const wrapped = async function (staffId) {
        if (wdaeOff()) return prevDelete.apply(this, arguments);

        if (!confirm('Remove this staff member? They will not be able to log in again.')) return;

        try {
            await wdaeLoadAuth();
            const db = firebase.database();

            await db.ref('stores/' + currentStoreId + '/staff/' + staffId).remove();
            await db.ref('stores/' + currentStoreId + '/members/' + staffId).remove();
            await db.ref('userIndex/' + staffId).remove();

            alert('Staff removed. Their login has been revoked.\n\n(Their Firebase Auth account still exists but can no longer access any store. To fully purge it, use Firebase Console → Authentication → Users.)');

            try { if (typeof loadStaffTable === 'function') loadStaffTable(); } catch (e) {}
        } catch (e) {
            alert('Could not remove staff: ' + (e && (e.code || e.message) || 'unknown error'));
        }
    };

    wrapped.__wdae = true;
    window.deleteStaff = wrapped;
    console.log('[email-auth-patch] deleteStaff wrapper installed');
}

function wdaeInstallStaffHooks() {
    try { wdaeInstallAddStaffWrapper(); } catch (e) { console.warn(e); }
    try { wdaeInstallDeleteStaffWrapper(); } catch (e) { console.warn(e); }
}

// =====================================================================
// INSTALL
// =====================================================================
function wdaeInstall() {
    if (wdaeOff()) { console.log('[email-auth-patch] disabled on this device'); return; }
    wdaeBuildLoginScreen();
    wdaeInstallStaffHooks();
    console.log('[email-auth-patch] email login active');
}

wdaeInstall();
window.addEventListener('load', wdaeInstall);
