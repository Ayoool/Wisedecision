// ==================== WISE DECISION ACTIVATION CODES PATCH (v27) ====================
// Load AFTER superadmin-patch.js (last), with `defer`.
//
//   * Each new customer gets their OWN single-use activation code (WD-XXXXX-XXXXX)
//   * A code can be revoked before it is used, expires after a number of days,
//     and only the code's fingerprint (a hash) is stored — never the code itself
//   * Registering with a valid code starts the store on a free trial automatically
//   * The old shared code stops working
//   * Super Admin gets a 🎟 Activation codes screen to make, send and cancel codes
//
// NOTE: with the database rules still open this is enforced by the app only. It becomes
// fully enforced by the database itself when the rules are locked (the next security step).

console.log("Wise Decision activation-patch.js — v29 loaded");

// ---------- Helpers (pure ones are tested) ----------
var WDA_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I so codes are easy to read out

function wdaNum(n) { return Number(n) || 0; }
function wdaEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wdaPad(n) { return String(n).padStart(2, '0'); }
function wdaLocalDateStr(d) { d = d || new Date(); return `${d.getFullYear()}-${wdaPad(d.getMonth() + 1)}-${wdaPad(d.getDate())}`; }
function wdaAddDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${wdaPad(t.getUTCMonth() + 1)}-${wdaPad(t.getUTCDate())}`;
}
function wdaPrettyDate(iso) {
    const t = new Date(iso);
    return isNaN(t) ? '—' : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function wdaWaNumber(phone) {
    let p = String(String(phone || '').split(/[,;/|]/)[0] || '').replace(/[^\d+]/g, '');
    if (!p) return '';
    if (p.charAt(0) === '+') p = p.slice(1);
    else if (p.indexOf('00') === 0) p = p.slice(2);
    else if (p.charAt(0) === '0') p = '234' + p.slice(1);
    else if (/^\d{10}$/.test(p)) p = '234' + p;
    return p;
}

function wdaGenerateCode() {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += WDA_ALPHABET[bytes[i] % 32];   // 256 is a multiple of 32, so no bias
    return `WD-${s.slice(0, 5)}-${s.slice(5)}`;
}
function wdaNormalize(code) { return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
async function wdaHash(code) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('wd-activation|' + wdaNormalize(code)));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function wdaCodeStatus(rec, nowMs) {
    if (!rec) return 'invalid';
    if (rec.status === 'revoked') return 'revoked';
    if (rec.status === 'used') return 'used';
    if (rec.expiresAt && new Date(rec.expiresAt).getTime() < nowMs) return 'expired';
    return 'unused';
}

// A store that registered with a trial code gets a billing record (fee + trial end date).
function wdaTrialBillingFor(rec, usedAtIso) {
    const days = wdaNum(rec && rec.trialDays);
    if (!rec || days <= 0 || !usedAtIso) return null;
    return { monthlyFee: wdaNum(rec.monthlyFee), dueDate: wdaAddDays(wdaLocalDateStr(new Date(usedAtIso)), days), trial: true, notes: 'Free trial' };
}

// Which used codes still need a billing record? (super admin can always write it, even after the rules are locked)
function wdaPlanTrialSync(codes, billing) {
    const updates = {};
    Object.keys(codes || {}).forEach(h => {
        const rec = codes[h];
        if (!rec || rec.status !== 'used' || !rec.usedBy) return;
        if (billing && billing[rec.usedBy]) return;
        const b = wdaTrialBillingFor(rec, rec.usedAt);
        if (b) updates[`billing/${rec.usedBy}`] = b;
    });
    return updates;
}

// Slow down code guessing on this device: 5 wrong tries -> 10 minute pause
function wdaLockState(fails, lastFailMs, nowMs) {
    const LIMIT = 5, PAUSE = 10 * 60 * 1000;
    if (fails >= LIMIT && nowMs - lastFailMs < PAUSE) return Math.ceil((PAUSE - (nowMs - lastFailMs)) / 60000);
    return 0;
}
function wdaAttemptLockMinutes() {
    try { return wdaLockState(parseInt(localStorage.getItem('wda_fails')) || 0, parseInt(localStorage.getItem('wda_last')) || 0, Date.now()); } catch (e) { return 0; }
}
function wdaNoteFail() {
    try {
        const last = parseInt(localStorage.getItem('wda_last')) || 0;
        let fails = parseInt(localStorage.getItem('wda_fails')) || 0;
        if (Date.now() - last > 10 * 60 * 1000) fails = 0;   // old failures expire
        localStorage.setItem('wda_fails', String(fails + 1));
        localStorage.setItem('wda_last', String(Date.now()));
    } catch (e) {}
}
function wdaClearFails() { try { localStorage.removeItem('wda_fails'); localStorage.removeItem('wda_last'); } catch (e) {} }

function wdaBusy(msg) { if (typeof wdShowLoader === 'function') wdShowLoader(msg); }
function wdaIdle() { if (typeof wdHideLoader === 'function') wdHideLoader(); }

// =====================================================================
// REGISTRATION with a single-use code
// =====================================================================
async function registerBusinessAccount() {
    const storeId = document.getElementById('reg-store-id').value.trim().toLowerCase();
    const businessName = document.getElementById('reg-store-name').value.trim();
    const phone = document.getElementById('reg-store-phone').value.trim();
    const address = document.getElementById('reg-store-address').value.trim();
    const adminPin = document.getElementById('reg-admin-pin').value.trim();

    if (!storeId || !businessName || !adminPin) {
        alert("Store ID, Business Name, and Admin PIN are required.");
        return;
    }
    if (!/^[a-z0-9_-]+$/.test(storeId)) {
        alert("Store ID can only contain lowercase letters, numbers, dash and underscore (no spaces).");
        return;
    }
    if (storeId === 'superadmin') {
        alert("That Store ID is reserved. Please choose another.");
        return;
    }
    if (adminPin.length < 4) {
        alert("The Admin PIN must be at least 4 characters. 6 or more is safer.");
        return;
    }

    const wait = wdaAttemptLockMinutes();
    if (wait > 0) {
        alert(`Too many wrong codes. Please wait about ${wait} minute${wait === 1 ? '' : 's'} and try again.`);
        return;
    }

    const entered = prompt("Enter the activation code you received to register this store:");
    if (entered === null) return;
    if (wdaNormalize(entered).length !== 12 || wdaNormalize(entered).indexOf('WD') !== 0) {
        wdaNoteFail();
        alert("That doesn't look like a valid activation code. It looks like WD-ABCDE-FGHJK.");
        return;
    }

    wdaBusy('Checking your code...');
    let hash = null, claimed = false;
    const db = firebase.database();
    try {
        hash = await wdaHash(entered);
        const codeRef = db.ref(`activationCodes/${hash}`);
        const rec = (await codeRef.once('value')).val();
        const state = wdaCodeStatus(rec, Date.now());

        if (state !== 'unused') {
            wdaNoteFail();
            wdaIdle();
            alert(({
                invalid: "Invalid activation code. Please check it and try again, or contact Wise Decision support.",
                used: "This activation code has already been used.",
                revoked: "This activation code has been cancelled. Please contact Wise Decision support.",
                expired: "This activation code has expired. Please ask Wise Decision support for a new one."
            })[state]);
            return;
        }

        const existing = await db.ref(`stores/${storeId}/businessName`).once('value');
        if (existing.exists()) {
            wdaIdle();
            alert("Store ID already exists. Please choose another or login.");
            return;
        }

        // Claim the code so it can never be used twice, even by two people at the same moment
        const claim = await codeRef.child('status').transaction(cur => (cur === 'unused' ? 'used' : (cur === null ? cur : undefined)));
        if (!claim.committed || claim.snapshot.val() !== 'used') {
            wdaIdle();
            alert("This activation code was just used by someone else.");
            return;
        }
        claimed = true;

        // Re-check the Store ID now that the code is ours (someone could have registered it in the meantime)
        const again = await db.ref(`stores/${storeId}/businessName`).once('value');
        if (again.exists()) {
            await codeRef.child('status').set('unused');
            claimed = false;
            wdaIdle();
            alert("Store ID already exists. Please choose another or login. Your code is still valid.");
            return;
        }

        const nowIso = new Date().toISOString();
        // Leaf-by-leaf writes: can never overwrite an existing store's data
        await db.ref().update({
            [`stores/${storeId}/businessName`]: businessName,
            [`stores/${storeId}/phone`]: phone,
            [`stores/${storeId}/address`]: address,
            [`stores/${storeId}/adminPin`]: adminPin,
            [`stores/${storeId}/status`]: 'active',
            [`stores/${storeId}/createdAt`]: nowIso,
            [`stores/${storeId}/branches/main`]: { name: 'Main', phone, address, isMain: true, createdAt: nowIso },
            [`activationCodes/${hash}/usedBy`]: storeId,
            [`activationCodes/${hash}/usedAt`]: nowIso
        });
        claimed = false;   // registration succeeded — the code stays used
        wdaClearFails();

        // Start the free trial (if this code carries one). Super Admin's dashboard also creates it if this write is refused.
        const trial = wdaTrialBillingFor(rec, nowIso);
        if (trial) { try { await db.ref(`billing/${storeId}`).set(trial); } catch (e) { console.warn("Trial billing will be created by Super Admin:", e.message); } }

        wdaIdle();
        alert("Business registered successfully! You can now log in." + (trial ? `\n\nYour free trial runs until ${wdaPrettyDate(trial.dueDate)}.` : ''));
        switchView('login-view');
    } catch (e) {
        console.error("Registration error:", e);
        if (claimed && hash) { try { await db.ref(`activationCodes/${hash}/status`).set('unused'); } catch (_) {} }
        wdaIdle();
        alert("Registration failed: " + e.message + "\n\nYour activation code was not used up — you can try again.");
    }
}

// =====================================================================
// SUPER ADMIN: make / send / cancel codes
// =====================================================================
function wdaModal(title, html) {
    let m = document.getElementById('wda-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'wda-modal';
        m.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); justify-content:center; align-items:center; z-index:1350; padding:16px; box-sizing:border-box;';
        document.body.appendChild(m);
    }
    m.innerHTML = `<div style="background:#fff; color:#0f172a; border-radius:12px; width:100%; max-width:500px; max-height:92vh; overflow-y:auto; padding:18px; box-sizing:border-box;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">
            <h3 style="margin:0; font-size:17px;">${wdaEsc(title)}</h3>
            <button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdaCloseModal()">✕</button>
        </div>${html}</div>`;
    m.style.display = 'flex';
}
function wdaCloseModal() { const m = document.getElementById('wda-modal'); if (m) m.style.display = 'none'; }

var wdaLastGenerated = null;

async function wdaOpenCodes() {
    if (currentUserRole !== 'SuperAdmin') return;
    wdaModal('🎟 Activation codes', '<div style="text-align:center; color:#64748b; padding:20px;">Loading...</div>');
    try {
        const snap = await firebase.database().ref('activationCodes').once('value');
        const codes = snap.val() || {};
        const now = Date.now();
        const list = Object.keys(codes).map(h => Object.assign({ hash: h, state: wdaCodeStatus(codes[h], now) }, codes[h]))
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

        const badge = st => ({
            unused: '<span style="background:#dcfce7; color:#166534;">UNUSED</span>',
            used: '<span style="background:#e0f2fe; color:#075985;">USED</span>',
            revoked: '<span style="background:#fee2e2; color:#991b1b;">CANCELLED</span>',
            expired: '<span style="background:#fef3c7; color:#92400e;">EXPIRED</span>'
        })[st] + '';

        const rows = list.length === 0
            ? '<div style="text-align:center; color:#64748b; padding:14px;">No codes yet.</div>'
            : list.map(c => `<div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                    <strong style="font-size:13px;">${wdaEsc(c.label || 'No label')}</strong>
                    <span style="font-size:10px; font-weight:bold; padding:2px 8px; border-radius:10px;">${badge(c.state)}</span>
                </div>
                <div style="font-size:11px; color:#64748b; margin:4px 0;">
                    Made ${wdaPrettyDate(c.createdAt)} · ${wdaNum(c.trialDays) > 0 ? wdaNum(c.trialDays) + '-day free trial' : 'no trial'}${wdaNum(c.monthlyFee) ? ' · ₦' + wdaNum(c.monthlyFee).toLocaleString() + '/month' : ''}
                    ${c.state === 'unused' && c.expiresAt ? `<br>Valid until ${wdaPrettyDate(c.expiresAt)}` : ''}
                    ${c.state === 'used' ? `<br>Used by <strong>${wdaEsc(c.usedBy || '?')}</strong> on ${wdaPrettyDate(c.usedAt)}` : ''}
                </div>
                <div style="display:flex; gap:6px;">
                    ${c.state === 'unused' ? `<button data-h="${wdaEsc(c.hash)}" onclick="wdaRevoke(this.dataset.h)" style="padding:5px 10px; font-size:11px; border-radius:6px; cursor:pointer; background:#fef2f2; border:1px solid #fecaca; color:#991b1b;">Cancel code</button>` : ''}
                    ${c.state !== 'unused' ? `<button data-h="${wdaEsc(c.hash)}" onclick="wdaDeleteCode(this.dataset.h)" style="padding:5px 10px; font-size:11px; border-radius:6px; cursor:pointer; background:#f8fafc; border:1px solid #cbd5e1;">Remove from list</button>` : ''}
                </div></div>`).join('');

        wdaModal('🎟 Activation codes', `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:14px;">
                <div style="font-weight:bold; font-size:13px; margin-bottom:8px;">Make a new code</div>
                <input id="wda-label" type="text" placeholder="Who is it for? e.g. Medstar Pharmacy (Ade)" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:8px; box-sizing:border-box;">
                <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:8px;">
                    <div><label style="font-size:11px; font-weight:bold;">Free trial (days)</label><input id="wda-trial" type="number" min="0" value="14" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;"></div>
                    <div><label style="font-size:11px; font-weight:bold;">Monthly fee (₦)</label><input id="wda-fee" type="number" min="0" placeholder="optional" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;"></div>
                    <div><label style="font-size:11px; font-weight:bold;">Code valid (days)</label><input id="wda-valid" type="number" min="1" value="30" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;"></div>
                </div>
                <input id="wda-phone" type="text" placeholder="Customer's WhatsApp number (optional)" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:8px; box-sizing:border-box;">
                <button class="menu-btn btn-action-primary" style="justify-content:center; margin:0;" onclick="wdaGenerate()">Generate code</button>
                <div id="wda-result"></div>
            </div>
            <div style="font-weight:bold; font-size:13px; margin-bottom:6px;">Codes</div>${rows}`);
    } catch (e) {
        wdaModal('🎟 Activation codes', `<div style="color:#b91c1c; padding:12px;">Could not load: ${wdaEsc(e.message)}</div>`);
    }
}

async function wdaGenerate() {
    const label = document.getElementById('wda-label').value.trim();
    const trialDays = Math.max(0, parseInt(document.getElementById('wda-trial').value) || 0);
    const fee = Math.max(0, parseFloat(document.getElementById('wda-fee').value) || 0);
    const validDays = Math.max(1, parseInt(document.getElementById('wda-valid').value) || 30);
    const phone = document.getElementById('wda-phone').value.trim();
    if (!label) { alert("Please say who this code is for, so you can recognise it later."); return; }

    const code = wdaGenerateCode();
    const hash = await wdaHash(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + validDays * 86400000).toISOString();
    try {
        await firebase.database().ref(`activationCodes/${hash}`).set({
            label, status: 'unused', trialDays, monthlyFee: fee, createdAt: now.toISOString(), expiresAt
        });
    } catch (e) { alert("Could not save the code: " + e.message); return; }

    wdaLastGenerated = { code, label, trialDays, expiresAt, phone };
    document.getElementById('wda-result').innerHTML = `
        <div style="margin-top:12px; background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:12px; text-align:center;">
            <div style="font-size:11px; color:#166534; font-weight:bold;">CODE FOR ${wdaEsc(label.toUpperCase())}</div>
            <div style="font-size:24px; font-weight:800; letter-spacing:2px; margin:6px 0; user-select:all;">${wdaEsc(code)}</div>
            <div style="font-size:11px; color:#b45309; margin-bottom:8px;">⚠ Copy or send it now — it is not stored anywhere and cannot be shown again.</div>
            <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
                <button onclick="wdaCopyCode()" style="padding:7px 12px; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#fff; font-weight:bold;">📋 Copy</button>
                <button onclick="wdaSendCode()" style="padding:7px 12px; border-radius:6px; cursor:pointer; border:1px solid #86efac; background:#dcfce7; color:#166534; font-weight:bold;">📲 Send on WhatsApp</button>
            </div>
        </div>`;
}

function wdaRegisterUrl() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'app.html?action=register'; }

function wdaCodeMessage(g) {
    return `Hello ${g.label}, welcome to Wise Decision POS! 🎉\n\nYour activation code: ${g.code}\n(It works once and is valid until ${wdaPrettyDate(g.expiresAt)}.)\n\nRegister your business here:\n${wdaRegisterUrl()}\n` +
        (g.trialDays > 0 ? `\nYou get a ${g.trialDays}-day free trial to try everything.` : '') +
        `\n\nAfter registering, log in with your Store ID and the PIN you choose.`;
}
function wdaCopyCode() {
    if (!wdaLastGenerated) return;
    const text = wdaCodeMessage(wdaLastGenerated);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => alert("Copied the code and instructions."), () => prompt("Copy this:", text));
    else prompt("Copy this:", text);
}
function wdaSendCode() {
    if (!wdaLastGenerated) return;
    const g = wdaLastGenerated;
    const number = wdaWaNumber(g.phone);
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(wdaCodeMessage(g))}`, '_blank');
}

async function wdaRevoke(hash) {
    if (!confirm("Cancel this code? It will stop working immediately.")) return;
    try {
        await firebase.database().ref(`activationCodes/${hash}/status`).transaction(cur => (cur === 'unused' ? 'revoked' : (cur === null ? cur : undefined)));
        wdaOpenCodes();
    } catch (e) { alert("Failed: " + e.message); }
}
async function wdaDeleteCode(hash) {
    if (!confirm("Remove this code from the list? (Stores registered with it are not affected.)")) return;
    try { await firebase.database().ref(`activationCodes/${hash}`).remove(); wdaOpenCodes(); } catch (e) { alert("Failed: " + e.message); }
}

// Button in the Super Admin header. Added by a small timer that keeps checking, so it appears
// no matter which order the script files load in (and after every refresh of the dashboard).
function wdaAttach() {
    if (currentUserRole !== 'SuperAdmin') return;
    if (!document.getElementById('wda-open-btn')) {
        const anchor = document.querySelector('#super-admin-view button[onclick="changeSuperAdminMasterPin()"]');
        if (anchor && anchor.parentElement) {
            const b = document.createElement('button');
            b.id = 'wda-open-btn';
            b.className = 'menu-btn';
            b.style.cssText = 'width:auto; margin:0; background:#7c3aed; color:#fff;';
            b.textContent = '🎟 Activation codes';
            b.onclick = wdaOpenCodes;
            anchor.parentElement.insertBefore(b, anchor);
        }
    }
    // Trial sync piggybacks on the Super Admin list reload (wrapped once)
    if (typeof window.wdsReload === 'function' && !window.wdsReload.__wdaWrapped) {
        const prev = window.wdsReload;
        const wrapped = async function () {
            try { await wdaSyncTrials(); } catch (e) { console.warn("Trial sync skipped:", e.message); }
            return prev.apply(this, arguments);
        };
        wrapped.__wdaWrapped = true;
        window.wdsReload = wrapped;
    }
}
setInterval(function () { try { wdaAttach(); } catch (e) { console.warn(e); } }, 1200);

// Keep trials in step: any used code whose store has no billing yet gets one (runs when the Super Admin list reloads)
var wdaLastTrialSync = 0;
async function wdaSyncTrials() {
    if (currentUserRole !== 'SuperAdmin' || Date.now() - wdaLastTrialSync < 60000) return false;
    wdaLastTrialSync = Date.now();
    const [codeSnap, billSnap] = await Promise.all([firebase.database().ref('activationCodes').once('value'), firebase.database().ref('billing').once('value')]);
    const updates = wdaPlanTrialSync(codeSnap.val() || {}, billSnap.val() || {});
    if (Object.keys(updates).length === 0) return false;
    await firebase.database().ref().update(updates);
    return true;
}
