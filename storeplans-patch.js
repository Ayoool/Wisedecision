// ==================== STOREPLANS-PATCH-FIX (v2.1) ====================
// Drop-in fix for storeplans-patch.js v34. Load AFTER storeplans-patch.js (defer).
//
//   1. saveBranch wrapper is now null-safe.
//   2. wdnShallow URL-encodes each path segment.
//   3. The planLimits realtime listener is detached on logout.
//   4. Injects the "📋 Plans" button next to "Billing settings".

console.log("Wise Decision storeplans-patch-fix.js — v2.1 loaded");

(function () {
    'use strict';

    // ================================================================
    // Fix #2 — URL-encode shallow fetch paths
    // ================================================================
    if (typeof window.wdnShallow === 'function') {
        window.wdnShallow = async function (path) {
            var base = firebase.app().options.databaseURL;
            if (!base) throw new Error('databaseURL not configured');
            var segs = String(path || '').split('/').filter(function (s) { return s !== ''; });
            var url = base + '/' + segs.map(encodeURIComponent).join('/') + '.json?shallow=true';
            try {
                var u = firebase.auth && firebase.auth().currentUser;
                if (u) url += '&auth=' + encodeURIComponent(await u.getIdToken());
            } catch (e) { /* not signed in with Firebase Auth */ }
            var res = await fetch(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var j = await res.json();
            return j && typeof j === 'object' ? Object.keys(j) : [];
        };
    }

    // ================================================================
    // Fix #3 — no leaked planLimits listener
    // ================================================================
    var _limitsRef = null;

    window.wdnClearLimitsListener = function () {
        if (_limitsRef) {
            try { _limitsRef.off(); } catch (e) {}
            _limitsRef = null;
        }
    };

    if (typeof window.wdnLoadLimits === 'function') {
        window.wdnLoadLimits = function () {
            if (!currentStoreId || currentStoreId === 'SUPER_ADMIN') return;
            var sid = currentStoreId;

            // Detach any prior listener before attaching a new one
            if (_limitsRef) {
                try { _limitsRef.off(); } catch (e) {}
                _limitsRef = null;
            }

            try {
                var c = JSON.parse(localStorage.getItem('wd_limits_' + sid) || 'null');
                if (c && typeof c === 'object') wdnLimits = c;
            } catch (e) {}

            try {
                _limitsRef = firebase.database().ref('stores/' + sid + '/planLimits');
                _limitsRef.on('value', function (snap) {
                    if (sid !== currentStoreId) return;
                    wdnLimits = snap.val() || null;
                    try {
                        if (wdnLimits) localStorage.setItem('wd_limits_' + sid, JSON.stringify(wdnLimits));
                        else localStorage.removeItem('wd_limits_' + sid);
                    } catch (e) {}
                    if (typeof wdnShowPlanCard === 'function') wdnShowPlanCard();
                }, function () { /* offline: keep remembered limits */ });
            } catch (e) { /* no limits */ }
        };
    }

    // Wrap switchView: clear listener on the way back to login
    if (typeof window.switchView === 'function') {
        var _prevSwitch = window.switchView;
        window.switchView = function (viewId) {
            if (viewId === 'login-view') {
                try {
                    window.wdnClearLimitsListener();
                    wdnLimits = null;
                    wdnLoadedFor = null;
                } catch (e) {}
            }
            return _prevSwitch.apply(this, arguments);
        };
    }

    // ================================================================
    // Fix #1 — saveBranch wrapper must be null-safe
    // ================================================================
    var _origWdnWrap = window.wdnWrap;
    if (typeof _origWdnWrap === 'function') {
        window.wdnWrap = function (name, factory) {
            if (name === 'saveBranch') factory = _fixedSaveBranchFactory;
            return _origWdnWrap.call(this, name, factory);
        };
    }

    if (typeof window.saveBranch === 'function' && window.saveBranch.__wdn) {
        var _buggy = window.saveBranch;
        var _retried = false;
        var _safe = function () {
            try {
                return _buggy.apply(this, arguments);
            } catch (e) {
                if (_retried) throw e;
                if (!window.branchesCache) window.branchesCache = {};
                if (!document.getElementById('edit-branch-id')) {
                    var d = document.createElement('input');
                    d.type = 'hidden';
                    d.id = 'edit-branch-id';
                    d.value = '';
                    document.body.appendChild(d);
                }
                _retried = true;
                return _buggy.apply(this, arguments);
            }
        };
        _safe.__wdn = true;
        window.saveBranch = _safe;
    }

    function _fixedSaveBranchFactory(prev) {
        return function () {
            var editEl = document.getElementById('edit-branch-id');
            var isNew = !editEl || !editEl.value;
            if (wdnLimits && wdnNum(wdnLimits.maxBranches) > 0 && currentUserRole === 'Admin' && isNew) {
                var n = Object.keys(window.branchesCache || {}).length;
                if (wdnLimitReached(n, wdnLimits.maxBranches)) {
                    wdnBlock('branches', n, wdnLimits.maxBranches);
                    return;
                }
            }
            return prev.apply(this, arguments);
        };
    }

    // ================================================================
    // Fix #4 — Inject the "Plans" Button directly into the layout
    // ================================================================
    function injectPlansButton() {
        if (typeof currentUserRole === 'undefined' || currentUserRole !== 'SuperAdmin') return;
        if (document.getElementById('wdn-btn-plans')) return; // Already exists

        // Find the "Billing settings" button to anchor next to it
        const allButtons = Array.from(document.querySelectorAll('button, .menu-btn, a, div[onclick]'));
        const targetBtn = 
            allButtons.find(b => b.textContent.trim().includes('Billing settings')) ||
            allButtons.find(b => b.textContent.trim().includes('Reminders'));

        if (!targetBtn) return; // Wait for UI to load

        // Create the button
        const btn = document.createElement('button');
        btn.id = 'wdn-btn-plans';
        btn.className = targetBtn.className; // Match exact styling
        if (targetBtn.style.cssText) {
            btn.style.cssText = targetBtn.style.cssText;
        }
        btn.style.marginLeft = '6px';
        btn.textContent = '📋 Plans';
        
        btn.onclick = function(e) {
            e.preventDefault();
            // Check both global and window scopes
            if (typeof wdnOpenPlans === 'function') {
                wdnOpenPlans();
            } else if (typeof window.wdnOpenPlans === 'function') {
                window.wdnOpenPlans();
            } else {
                alert('The main plans code is missing!\n\nPlease make sure you uploaded "storeplans-patch.js" to GitHub and added it to your index.html BEFORE this file.');
            }
        };

        // Insert it right next to Billing settings
        if (targetBtn.parentNode) {
            targetBtn.parentNode.insertBefore(btn, targetBtn.nextSibling);
            console.log('[plans-button] Successfully injected next to:', targetBtn.textContent.trim());
        }
    }

    // Run immediately, then poll every 1 second to catch UI re-renders
    injectPlansButton();
    setInterval(injectPlansButton, 1000);

})();
