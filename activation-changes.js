/* =====================================================================
   PART 1 of 2 — REPLACE registerBusinessAccount in script.js
   Delete everything from the line
     // ==================== REGISTER BUSINESS (with Email + Password) ====================
   down to (but NOT including)
     // [FIXED #2] Detach every real-time listener on logout...
   and paste this block in its place.
   ===================================================================== */

// ==================== REGISTER BUSINESS (with Email + Password + DB-validated Activation Code) ====================
function registerBusinessAccount() {
    const storeId = document.getElementById('reg-store-id').value.trim().toLowerCase();
    const businessName = document.getElementById('reg-store-name').value.trim();
    const phone = document.getElementById('reg-store-phone').value.trim();
    const address = document.getElementById('reg-store-address').value.trim();
    const adminEmail = document.getElementById('reg-admin-email').value.trim();
    const adminPassword = document.getElementById('reg-admin-password').value;
    const adminPin = document.getElementById('reg-admin-pin').value.trim();

    if (!storeId || !businessName || !adminEmail || !adminPassword || !adminPin) {
        alert("Store ID, Business Name, Admin Email, Password, and PIN are all required.");
        return;
    }
    if (adminPassword.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(adminEmail)) {
        alert("Please enter a valid email address.");
        return;
    }

    // Ask for the activation code
    const userEnteredCode = prompt("Enter the activation code you received from Wise Decision:");
    if (!userEnteredCode || userEnteredCode.trim() === '') {
        alert("Registration cancelled — an activation code is required.");
        return;
    }
    const codeToCheck = userEnteredCode.trim().toUpperCase();

    // Step 1: Validate the activation code against the database
    firebase.database().ref(`activationCodes/${codeToCheck}`).once('value').then(codeSnap => {
        if (!codeSnap.exists()) {
            alert("❌ Invalid activation code. Please contact Wise Decision Support.");
            return;
        }

        const codeData = codeSnap.val();

        if (codeData.status === 'used') {
            alert("❌ This activation code has already been used for another store. Please contact Wise Decision Support.");
            return;
        }
        if (codeData.status === 'revoked') {
            alert("❌ This activation code has been revoked. Please contact Wise Decision Support.");
            return;
        }
        if (codeData.expiresAt && new Date(codeData.expiresAt) < new Date()) {
            alert("❌ This activation code has expired. Please contact Wise Decision Support.");
            return;
        }

        // Step 2: Check if the Store ID is already taken
        return firebase.database().ref('stores/' + storeId).once('value').then(storeSnap => {
            if (storeSnap.exists()) {
                alert("Store ID already exists. Please choose another or login.");
                return;
            }

            // Step 3: Create the Firebase Auth account
            return firebase.auth().createUserWithEmailAndPassword(adminEmail, adminPassword)
                .then(userCredential => {
                    const uid = userCredential.user.uid;

                    userCredential.user.sendEmailVerification()
                        .then(() => console.log("Verification email sent to " + adminEmail))
                        .catch(err => console.warn("Could not send verification email:", err));

                    const storeData = {
                        businessName, phone, address, adminPin,
                        status: "active",
                        ownerUid: uid,
                        ownerEmail: adminEmail,
                        activationCode: codeToCheck,
                        createdAt: new Date().toISOString()
                    };

                    const updates = {};
                    updates[`stores/${storeId}`] = storeData;
                    updates[`admins/${uid}`] = true;
                    updates[`staff/${storeId}/main/${uid}`] = {
                        name: businessName + " (Owner)",
                        role: "Manager",
                        branchId: "main",
                        email: adminEmail
                    };
                    updates[`stores/${storeId}/branches/main`] = {
                        name: "Main", phone, address, isMain: true,
                        createdAt: new Date().toISOString()
                    };

                    // Mark the activation code as used
                    updates[`activationCodes/${codeToCheck}/status`] = 'used';
                    updates[`activationCodes/${codeToCheck}/usedByStore`] = storeId;
                    updates[`activationCodes/${codeToCheck}/usedByEmail`] = adminEmail;
                    updates[`activationCodes/${codeToCheck}/usedAt`] = new Date().toISOString();

                    return firebase.database().ref().update(updates);
                })
                .then(() => {
                    alert("🎉 Registration complete!\n\nCheck your email inbox (and Spam folder) for a verification link, then log in with your Email and Password.");
                    switchView('login-view');
                });
        });
    }).catch(error => {
        console.error("Registration error:", error);
        if (error.code === 'auth/email-already-in-use') {
            alert("This email is already registered to another account. Please use a different email.");
        } else if (error.code === 'auth/weak-password') {
            alert("Password is too weak. Please use at least 6 characters.");
        } else if (error.code === 'auth/invalid-email') {
            alert("Invalid email format. Please check the email address.");
        } else {
            alert("Registration failed: " + error.message);
        }
    });
}


/* =====================================================================
   PART 2 of 2 — ADD this block to script.js
   Paste it directly after the deleteBusinessAccount(...) function and
   before the "DASHBOARD METRICS & ALERTS" section.
   ===================================================================== */

// ==================== ACTIVATION CODE MANAGEMENT (Super Admin) ====================
function openGenerateCodeModal() {
    if (currentUserRole !== 'SuperAdmin') {
        alert("Access Restricted: Only the Super Admin can generate activation codes.");
        return;
    }
    document.getElementById('gen-code-customer-name').value = '';
    document.getElementById('gen-code-notes').value = '';
    document.getElementById('gen-code-expiry-days').value = '';
    document.getElementById('generate-code-modal').style.display = 'flex';
    loadActivationCodesList();
}

function closeGenerateCodeModal() {
    document.getElementById('generate-code-modal').style.display = 'none';
}

function generateActivationCode() {
    if (currentUserRole !== 'SuperAdmin') return;

    const customerName = document.getElementById('gen-code-customer-name').value.trim();
    const notes = document.getElementById('gen-code-notes').value.trim();
    const expiryDays = parseInt(document.getElementById('gen-code-expiry-days').value) || 0;

    if (!customerName) {
        alert("Please enter a customer name so you can track this code.");
        return;
    }

    // Generate a random, memorable code: WD-XXXX-XXXX
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let part1 = '', part2 = '';
    for (let i = 0; i < 4; i++) part1 += chars.charAt(Math.floor(Math.random() * chars.length));
    for (let i = 0; i < 4; i++) part2 += chars.charAt(Math.floor(Math.random() * chars.length));
    const code = 'WD-' + part1 + '-' + part2;

    const expiresAt = expiryDays > 0
        ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

    const codeData = {
        code,
        customerName,
        notes,
        status: 'unused',
        createdAt: new Date().toISOString(),
        expiresAt,
        usedByStore: null,
        usedAt: null
    };

    firebase.database().ref(`activationCodes/${code}`).set(codeData).then(() => {
        navigator.clipboard.writeText(code).then(() => {
            alert(`✅ Code generated and copied to clipboard:\n\n${code}\n\nFor: ${customerName}\n\nSend this to your customer.`);
        }).catch(() => {
            alert(`✅ Code generated:\n\n${code}\n\nFor: ${customerName}\n\n(Copy it manually — clipboard access was denied.)`);
        });
        document.getElementById('gen-code-customer-name').value = '';
        document.getElementById('gen-code-notes').value = '';
        document.getElementById('gen-code-expiry-days').value = '';
        loadActivationCodesList();
    }).catch(err => {
        alert("Failed to generate code: " + err.message);
    });
}

function loadActivationCodesList() {
    firebase.database().ref('activationCodes').once('value').then(snapshot => {
        const tbody = document.getElementById('activation-codes-body');
        if (!tbody) return;

        const rows = [];
        snapshot.forEach(child => {
            const c = child.val();
            rows.push({ code: child.key, ...c });
        });
        rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        const rowsHtml = rows.map(c => {
            const statusColor = c.status === 'unused' ? '#166534' : (c.status === 'used' ? '#64748b' : '#991b1b');
            const statusLabel = c.status === 'unused' ? '✅ Available' : (c.status === 'used' ? '🔒 Used' : '⛔ Revoked');
            const usedNote = c.usedByStore ? `<br><small style="color:var(--text-muted);">→ ${escapeHtml(c.usedByStore)}</small>` : '';
            const safeCode = escapeJsAttr(c.code);
            const actionBtn = c.status === 'unused'
                ? `<button class="menu-btn btn-logout" style="padding:3px 8px; font-size:11px; width:auto; display:inline-block;" onclick="revokeActivationCode('${safeCode}')">Revoke</button>`
                : '';
            return `
                <tr>
                    <td><strong style="font-family:monospace;">${escapeHtml(c.code)}</strong>${usedNote}</td>
                    <td>${escapeHtml(c.customerName) || '—'}</td>
                    <td style="color:${statusColor}; font-weight:bold; font-size:12px;">${statusLabel}</td>
                    <td>${actionBtn}</td>
                </tr>
            `;
        });

        tbody.innerHTML = rows.length === 0
            ? `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:15px;">No codes generated yet.</td></tr>`
            : rowsHtml.join('');
    });
}

function revokeActivationCode(code) {
    if (!confirm(`Revoke code ${code}? It will no longer be usable for registration.`)) return;
    firebase.database().ref(`activationCodes/${code}`).update({
        status: 'revoked',
        revokedAt: new Date().toISOString()
    }).then(() => {
        loadActivationCodesList();
    });
}
