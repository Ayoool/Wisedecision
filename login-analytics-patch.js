// ==================== WISE DECISION LOGIN ANALYTICS PATCH (v1) ====================
// Load AFTER superadmin-patch.js and AFTER email-auth-patch.js.
//
// Records for every successful login:
//   stores/{storeId}/members/{uid}/lastLogin = { ip, city, country, ua, at }
//   loginLog/{uid}/{pushId} = { storeId, ip, city, country, ua, at }
//
// Adds a "Security" panel to the Super Admin dashboard.

console.log("Wise Decision login-analytics-patch.js — v1 loaded");

var wdlaLog = {};
var wdlaLoading = false;
var wdlaGeoCache = null;

function wdlaEl(id) { return document.getElementById(id); }
function wdlaEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function wdlaPretty(s) {
    if (!s) return '—';
    var d = new Date(s);
    if (isNaN(d)) return '—';
    return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function wdlaGetGeo() {
    if (wdlaGeoCache) return Promise.resolve(wdlaGeoCache);
    return new Promise(function (resolve) {
        fetch('https://ipwho.is/?fields=success,ip,city,region,country,country_code,connection')
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.success !== false) {
                    wdlaGeoCache = {
                        ip: j.ip || '',
                        city: j.city || '',
                        region: j.region || '',
                        country: j.country || '',
                        countryCode: j.country_code || '',
                        isp: (j.connection && j.connection.isp) || ''
                    };
                } else {
                    wdlaGeoCache = { ip: '', city: '', region: '', country: '', countryCode: '', isp: '' };
                }
                resolve(wdlaGeoCache);
            })
            .catch(function () {
                wdlaGeoCache = { ip: '', city: '', region: '', country: '', countryCode: '', isp: '' };
                resolve(wdlaGeoCache);
            });
    });
}

window.wdlaRecordLogin = async function (storeId, uid, email) {
    try {
        var geo = await wdlaGetGeo();
        var ua = navigator.userAgent || '';
        var nowIso = new Date().toISOString();

        var payload = {
            storeId: storeId || '',
            email: email || '',
            ip: geo.ip,
            city: geo.city,
            region: geo.region,
            country: geo.country,
            countryCode: geo.countryCode,
            isp: geo.isp,
            ua: ua,
            at: nowIso
        };

        var db = firebase.database();
        if (storeId && uid) {
            await db.ref('stores/' + storeId + '/members/' + uid + '/lastLogin').set(payload);
        }
        if (uid) {
            await db.ref('loginLog/' + uid).push(payload);
        }
    } catch (e) { /* silent */ }
};

function wdlaIsSuspicious(userLogs) {
    if (userLogs.length < 2) return false;
    var cutoff = Date.now() - 24 * 3600 * 1000;
    var recent = userLogs.filter(function (l) { return new Date(l.at).getTime() >= cutoff; });
    if (recent.length < 2) return false;

    var countries = {};
    recent.forEach(function (l) { if (l.country) countries[l.country] = true; });
    if (Object.keys(countries).length >= 2) return true;

    if (recent.length >= 2) {
        var first = recent[recent.length - 1];
        var last = recent[0];
        var dt = new Date(last.at) - new Date(first.at);
        if (first.country === last.country && first.city !== last.city && dt < 3600 * 1000) return true;
    }
    return false;
}

async function wdlaLoadLogs() {
    if (wdlaLoading) return;
    wdlaLoading = true;
    try {
        var snap = await firebase.database().ref('loginLog').once('value');
        wdlaLog = snap.val() || {};
    } catch (e) { wdlaLog = {}; }
    wdlaLoading = false;
}

async function wdlaRenderPanel() {
    var holder = wdlaEl('wdla-panel');
    if (!holder) return;

    holder.innerHTML = '<div style="text-align:center; color:#94a3b8; font-size:12px; padding:20px;">Loading security data…</div>';
    await wdlaLoadLogs();

    var all = [];
    Object.keys(wdlaLog).forEach(function (uid) {
        var userLogs = wdlaLog[uid] || {};
        var arr = Object.keys(userLogs).map(function (k) { return Object.assign({ _uid: uid }, userLogs[k]); })
            .sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
        all.push({ uid: uid, logs: arr, suspicious: wdlaIsSuspicious(arr) });
    });
    all.sort(function (a, b) {
        var ta = (a.logs[0] && a.logs[0].at) || '';
        var tb = (b.logs[0] && b.logs[0].at) || '';
        return String(tb).localeCompare(String(ta));
    });

    var flat = [];
    all.forEach(function (u) { u.logs.slice(0, 5).forEach(function (l) { flat.push(l); }); });
    flat.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    flat = flat.slice(0, 20);

    var suspiciousCount = all.filter(function (u) { return u.suspicious; }).length;

    var rows = flat.map(function (l) {
        var loc = [l.city, l.country].filter(Boolean).join(', ') || 'Location unknown';
        return '<div style="padding:10px 0; border-bottom:1px solid #f1f5f9; font-size:12px;">' +
            '<div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">' +
                '<div>' +
                    '<div style="font-weight:bold;">' + wdlaEsc(l.email || l._uid || 'Unknown user') + '</div>' +
                    '<div style="color:#64748b; margin-top:2px;">' + wdlaEsc(loc) + (l.isp ? ' · ' + wdlaEsc(l.isp) : '') + '</div>' +
                '</div>' +
                '<div style="text-align:right; color:#64748b;">' +
                    '<div>' + wdlaPretty(l.at) + '</div>' +
                    '<div style="font-size:10px; margin-top:2px;">' + wdlaEsc(l.ip || '—') + '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');

    holder.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">' +
            '<div style="font-size:13px; color:#334155;">' +
                'Recent logins · <strong>' + all.length + '</strong> user' + (all.length === 1 ? '' : 's') +
                (suspiciousCount > 0 ? ' · <span style="color:#b91c1c; font-weight:bold;">⚠️ ' + suspiciousCount + ' suspicious</span>' : '') +
            '</div>' +
            '<button onclick="wdlaRenderPanel()" style="padding:6px 12px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; font-size:12px; cursor:pointer;">🔄 Refresh</button>' +
        '</div>' +
        (suspiciousCount > 0
            ? '<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:12px; margin-bottom:12px; font-size:12px; color:#991b1b;">' +
                '<strong>⚠️ ' + suspiciousCount + ' account' + (suspiciousCount === 1 ? '' : 's') + ' logged in from multiple locations recently.</strong><br>' +
                'Review the logins below. If any look unfamiliar, change that account\'s password.' +
              '</div>'
            : '') +
        '<div>' + (rows || '<div style="text-align:center; color:#94a3b8; padding:20px;">No login records yet.</div>') + '</div>';
}

function wdlaInjectPanel() {
    var btns = document.querySelectorAll('button');
    var anchor = null;
    for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || '').trim();
        if (t.indexOf('Security') !== -1) { anchor = btns[i]; break; }
    }
    if (!anchor) return;
    if (wdlaEl('wdla-panel')) return;

    var card = anchor;
    for (var k = 0; k < 6 && card.parentElement; k++) {
        card = card.parentElement;
        var style = (card.getAttribute && card.getAttribute('style')) || '';
        if (style.indexOf('border-radius') !== -1 && style.indexOf('box-shadow') !== -1) break;
    }
    if (!card || !card.parentElement) return;

    var panel = document.createElement('div');
    panel.id = 'wdla-panel';
    panel.style.cssText = 'background:#fff; border-radius:12px; padding:16px; margin:16px 0; box-shadow: 0 4px 14px rgba(15,23,42,0.06);';
    panel.innerHTML = '<div style="text-align:center; color:#94a3b8; font-size:12px; padding:20px;">Loading security data…</div>';
    card.parentElement.insertBefore(panel, card.nextSibling);
    wdlaRenderPanel();
}

window.addEventListener('load', function () {
    setTimeout(wdlaInjectPanel, 1800);
    setInterval(wdlaInjectPanel, 3000);
});
