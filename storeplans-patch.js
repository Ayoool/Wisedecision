// ==================== STOREPLANS-PATCH-FIX (v1) ====================
// Drop-in fix for storeplans-patch.js v34. Load AFTER storeplans-patch.js (defer).
//
//   1. saveBranch wrapper is now null-safe (no throw when #edit-branch-id is
//      missing or branchesCache hasn't been populated yet).
//   2. wdnShallow URL-encodes each path segment (branch/store keys with spaces,
//      %, etc. no longer break the shallow count).
//   3. The planLimits realtime listener is detached on logout / store switch,
//      so it no longer leaks across login sessions.

console.log("Wise Decision storeplans-patch-fix.js — v1 loaded");

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

            // Detach any prior listener before attaching a new one (this is the fix)
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
    //
    // Two install paths, because we don't know whether the base file's
    // 1200ms wdnAttach timer has fired yet:
    //   (a) If it hasn't fired yet, override wdnWrap so the fixed factory is
    //       installed instead of the buggy one.
    //   (b) If it has already fired, wrap the buggy wrapper with a try/catch
    //       that repairs the guard's two inputs and retries once.
    // ================================================================

    // (a) Future installs: substitute the fixed factory
    var _origWdnWrap = window.wdnWrap;
    if (typeof _origWdnWrap === 'function') {
        window.wdnWrap = function (name, factory) {
            if (name === 'saveBranch') factory = _fixedSaveBranchFactory;
            return _origWdnWrap.call(this, name, factory);
        };
    }

    // (b) Install already happened: wrap the buggy wrapper with a safety net
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
        _safe.__wdn = true;                // keep wdnWrap from re-wrapping us
        window.saveBranch = _safe;
    }

    // Same limit semantics as the original, but with proper null guards
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
})();
