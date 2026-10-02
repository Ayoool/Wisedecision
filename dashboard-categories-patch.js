// ==================== WISE DECISION REPORT CHART & CATEGORIES PATCH (v3) ====================
// Load LAST (after all the other patches), with defer.
//
// v3: Faster chart loading.
//     - Daily-sales query results are cached in memory for 60 seconds, so
//       toggling 7/30 days and re-opening Reports within that window is
//       instant instead of re-querying Firebase each time.
//     - Only the fields actually needed (date, totalAmount, branchId) are
//       read from each transaction; other heavy fields are ignored.
//     - A "refresh" behaviour is exposed via WDBC.refreshChart(true) for
//       manual cache-busting (e.g. from the Console).
//
// v2: Chart moved from the Dashboard to the Reports view, above the Net
//     Profit card. It respects the Reports date picker and branch filter.
//
//   B. Sales chart on Reports — pure SVG, no library, no cost.
//   J. Category Management inside Inventory — Admin-only "Manage Categories"
//      button next to "+ Add New Product".

console.log("Wise Decision dashboard-categories-patch.js - v3 loaded (fast cache)");

// =====================================================================
// B. SALES CHART ON REPORTS
// =====================================================================

var wdbcChartRange = 7;
var wdbcDailyCache = {};
var wdbcDailyCacheTtl = 60 * 1000; // 60 seconds

function wdbcTodayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Cached loader. Cache key includes today's date so tomorrow's first load is
// always fresh. `force` bypasses the cache (used by WDBC.refreshChart(true)).
function wdbcLoadDailySales(branchId, range, force, callback) {
    var cacheKey = branchId + '|' + range + '|' + wdbcTodayKey();
    var cached = wdbcDailyCache[cacheKey];
    if (!force && cached && (Date.now() - cached.at) < wdbcDailyCacheTtl) {
        callback(cached.days, true);   // true = served from cache
        return;
    }

    var since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (range - 1));
    var sinceIso = since.toISOString();

    firebase.database().ref('stores/' + currentStoreId + '/transactions')
        .orderByChild('date').startAt(sinceIso).once('value').then(function (snap) {
            var byDay = {};
            var cursor = new Date(since);
            for (var i = 0; i < range; i++) {
                var key = wdbcDayKey(cursor);
                byDay[key] = { date: key, label: wdbcDayLabel(cursor), total: 0 };
                cursor.setDate(cursor.getDate() + 1);
            }
            snap.forEach(function (child) {
                var tx = child.val();
                if (branchId !== 'all' && (tx.branchId || 'main') !== branchId) return;
                if (!tx.date) return;
                var d = new Date(tx.date);
                var key = wdbcDayKey(d);
                if (byDay[key]) byDay[key].total += (Number(tx.totalAmount) || 0);
            });
            var days = Object.keys(byDay).map(function (k) { return byDay[k]; });
            wdbcDailyCache[cacheKey] = { at: Date.now(), days: days };
            callback(days, false);
        }).catch(function (err) {
            console.warn('wdbcLoadDailySales failed:', err);
            callback([], false);
        });
}

function wdbcDayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function wdbcDayLabel(d) {
    var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return names[d.getDay()] + ' ' + d.getDate();
}

function wdbcRenderChart(days, fromCache) {
    var container = document.getElementById('wdbc-chart-area');
    if (!container) return;
    if (!days || days.length === 0) {
        container.innerHTML = '<div style="color:#64748b; font-size:12px; padding:20px; text-align:center;">No sales in this period.</div>';
        return;
    }

    var maxTotal = 0, totalAll = 0, bestDay = days[0];
    days.forEach(function (d) {
        if (d.total > maxTotal) { maxTotal = d.total; bestDay = d; }
        totalAll += d.total;
    });

    var W = 100;
    var H = 40;
    var padTop = 4, padBottom = 6;
    var chartW = W;
    var chartH = H - padTop - padBottom;
    var barGap = 0.6;
    var barW = Math.max(0.6, (chartW / days.length) - barGap);
    var yScale = maxTotal > 0 ? (chartH / maxTotal) : 0;

    var barsSvg = '';
    days.forEach(function (d, i) {
        var x = i * (chartW / days.length) + barGap / 2;
        var h = d.total * yScale;
        var y = padTop + (chartH - h);
        var isBest = (d === bestDay && maxTotal > 0);
        var fill = isBest ? '#16a34a' : '#60a5fa';
        barsSvg += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) + '" height="' + h.toFixed(2) +
            '" rx="0.4" fill="' + fill + '">' +
            '<title>' + wdbcEsc(d.label) + ': ' + wdbcMoney(d.total) + '</title></rect>';
    });

    var labelStep = days.length <= 7 ? 1 : (days.length <= 14 ? 2 : 5);
    var labelsSvg = '';
    days.forEach(function (d, i) {
        if (i % labelStep !== 0 && i !== days.length - 1) return;
        var x = i * (chartW / days.length) + (chartW / days.length) / 2;
        labelsSvg += '<text x="' + x.toFixed(2) + '" y="' + (H - 1) + '" font-size="2.2" text-anchor="middle" fill="#64748b">' +
            wdbcEsc(d.label.split(' ')[0]) + '</text>';
    });

    var summary = 'Total: ' + wdbcMoney(totalAll);
    if (maxTotal > 0) summary += ' | Best day: ' + wdbcMoney(maxTotal) + ' (' + bestDay.label + ')';
    if (fromCache) summary += ' | cached';

    container.innerHTML =
        '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%; height:120px; display:block;">' +
        '<line x1="0" y1="' + (padTop + chartH).toFixed(2) + '" x2="' + W + '" y2="' + (padTop + chartH).toFixed(2) + '" stroke="#cbd5e1" stroke-width="0.3"/>' +
        barsSvg + labelsSvg + '</svg>' +
        '<div style="font-size:11px; color:#475569; margin-top:6px;">' + wdbcEsc(summary) + '</div>';
}

function wdbcEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wdbcMoney(n) { return String.fromCharCode(8358) + (Number(n) || 0).toLocaleString(); }

function wdbcInjectChartCard() {
    var netProfit = document.getElementById('net-profit-display');
    var dateFilter = document.getElementById('sales-date-filter');
    if (!netProfit || !dateFilter) return;

    var existing = document.getElementById('wdbc-chart-card');
    if (existing) {
        wdbcRefreshChart(false);
        return;
    }

    var insertAnchor = netProfit.closest('div');
    while (insertAnchor && !insertAnchor.querySelector('h3')) {
        insertAnchor = insertAnchor.parentElement;
        if (!insertAnchor || insertAnchor.id === 'workspace-content') break;
    }
    if (!insertAnchor || !insertAnchor.parentElement) return;

    var card = document.createElement('div');
    card.id = 'wdbc-chart-card';
    card.style.cssText = 'background:#ffffff; border:1px solid #eef2f7; padding:18px; border-radius:12px; box-shadow:0 6px 18px rgba(15,23,42,0.06); margin-bottom:20px;';
    card.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px;">' +
            '<div style="font-weight:600; font-size:11px; color:#166534; letter-spacing:0.5px; text-transform:uppercase;">Daily Sales Trend</div>' +
            '<div style="display:flex; gap:6px;">' +
                '<button id="wdbc-range-7" type="button" style="padding:4px 10px; font-size:11px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#0284c7; color:#fff;">7 days</button>' +
                '<button id="wdbc-range-30" type="button" style="padding:4px 10px; font-size:11px; font-weight:bold; border-radius:6px; cursor:pointer; border:1px solid #cbd5e1; background:#e2e8f0; color:#1e293b;">30 days</button>' +
            '</div>' +
        '</div>' +
        '<div id="wdbc-chart-area" style="min-height:100px;"><div style="color:#64748b; font-size:12px; padding:20px; text-align:center;">Loading chart...</div></div>';

    insertAnchor.parentElement.insertBefore(card, insertAnchor);

    document.getElementById('wdbc-range-7').onclick = function () { wdbcSetRange(7); };
    document.getElementById('wdbc-range-30').onclick = function () { wdbcSetRange(30); };

    wdbcRefreshChart(false);
}

function wdbcSetRange(n) {
    wdbcChartRange = n;
    var b7 = document.getElementById('wdbc-range-7');
    var b30 = document.getElementById('wdbc-range-30');
    if (b7 && b30) {
        if (n === 7) { b7.style.background = '#0284c7'; b7.style.color = '#fff'; b30.style.background = '#e2e8f0'; b30.style.color = '#1e293b'; }
        else { b30.style.background = '#0284c7'; b30.style.color = '#fff'; b7.style.background = '#e2e8f0'; b7.style.color = '#1e293b'; }
    }
    wdbcRefreshChart(false);
}

function wdbcRefreshChart(force) {
    if (!currentStoreId) return;
    if (force) wdbcDailyCache = {};
    var area = document.getElementById('wdbc-chart-area');
    if (area) area.innerHTML = '<div style="color:#64748b; font-size:12px; padding:20px; text-align:center;">Loading chart...</div>';
    var branchId = (typeof currentReportBranchFilter !== 'undefined' && currentReportBranchFilter)
        ? currentReportBranchFilter
        : ((typeof currentBranch !== 'undefined' && currentBranch) ? currentBranch : 'main');
    wdbcLoadDailySales(branchId, wdbcChartRange, force, function (days, fromCache) {
        wdbcRenderChart(days, fromCache);
    });
}

(function wdbcHookSwitchView() {
    var prev = window.switchView;
    if (typeof prev !== 'function' || prev.__wdbc) return;
    var wrapped = function (viewId) {
        var result = prev.apply(this, arguments);
        if (viewId === 'reports-view') {
            setTimeout(function () { try { wdbcInjectChartCard(); } catch (e) { console.warn(e); } }, 200);
            setTimeout(function () { try { wdbcInjectChartCard(); } catch (e) {} }, 800);
        }
        return result;
    };
    wrapped.__wdbc = true;
    window.switchView = wrapped;
})();

(function wdbcHookReportsBranchFilter() {
    var prev = window.onReportsBranchFilterChange;
    if (typeof prev !== 'function' || prev.__wdbc) return;
    var wrapped = function () {
        var result = prev.apply(this, arguments);
        setTimeout(function () { try { wdbcRefreshChart(false); } catch (e) {} }, 300);
        return result;
    };
    wrapped.__wdbc = true;
    window.onReportsBranchFilterChange = wrapped;
})();

(function wdbcWatchDom() {
    var scheduled = false;
    function fire() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            try {
                if (document.getElementById('net-profit-display') && document.getElementById('sales-date-filter')) {
                    wdbcInjectChartCard();
                }
            } catch (e) {}
        });
    }
    if (document.body) {
        fire();
        new MutationObserver(fire).observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', fire);
    }
})();

// =====================================================================
// J. CATEGORY MANAGEMENT (button inside Inventory)
// =====================================================================

function wdbcEnsureCategoriesNode(callback) {
    var ref = firebase.database().ref('stores/' + currentStoreId + '/categories');
    ref.once('value').then(function (snap) {
        var existing = snap.val() || {};
        firebase.database().ref('stores/' + currentStoreId + '/inventory').once('value').then(function (invSnap) {
            var inUse = {};
            invSnap.forEach(function (branchChild) {
                branchChild.forEach(function (prodChild) {
                    var it = prodChild.val() || {};
                    var c = (it.category || '').trim();
                    if (c) inUse[c] = true;
                });
            });
            var updates = {};
            Object.keys(inUse).forEach(function (c) {
                if (!existing[c]) updates[c] = { name: c, createdAt: new Date().toISOString(), migrated: true };
            });
            if (Object.keys(updates).length === 0) {
                callback(existing);
            } else {
                ref.update(updates).then(function () { callback(Object.assign({}, existing, updates)); });
            }
        });
    }).catch(function (err) {
        console.warn('wdbcEnsureCategoriesNode failed:', err);
        callback({});
    });
}

function wdbcOpenCategoryManager() {
    if (currentUserRole !== 'Admin') {
        alert('Only the Admin can manage categories.');
        return;
    }
    if (!currentStoreId) return;

    var modal = document.getElementById('wdbc-cat-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'wdbc-cat-modal';
        modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.65); backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px); justify-content:center; align-items:center; z-index:1600; padding:20px; box-sizing:border-box;';
        document.body.appendChild(modal);
    }
    modal.innerHTML =
        '<div style="background:#fff; color:#0f172a; border-radius:14px; width:100%; max-width:560px; max-height:90vh; overflow-y:auto; padding:20px; box-sizing:border-box; border:1px solid #eef2f7; box-shadow:0 20px 45px rgba(15,23,42,0.25);">' +
            '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">' +
                '<h3 style="margin:0; font-size:17px;">Manage Categories</h3>' +
                '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 12px;" onclick="wdbcCloseCategoryManager()">Close</button>' +
            '</div>' +
            '<div style="font-size:12px; color:#64748b; margin-bottom:14px;">Rename a category to update every product using it, or delete one and choose what happens to its products.</div>' +
            '<div id="wdbc-cat-add-row" style="display:flex; gap:8px; margin-bottom:14px;">' +
                '<input id="wdbc-new-cat-name" type="text" placeholder="New category name" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:8px; box-sizing:border-box;">' +
                '<button class="menu-btn btn-action-primary" style="width:auto; margin:0; padding:8px 14px;" onclick="wdbcAddCategory()">Add</button>' +
            '</div>' +
            '<div id="wdbc-cat-list" style="background:#fff; border:1px solid #eef2f7; border-radius:10px; overflow-x:auto;">' +
                '<div style="padding:15px; text-align:center; color:#64748b;">Loading categories...</div>' +
            '</div>' +
        '</div>';
    modal.style.display = 'flex';

    wdbcRenderCategoryList();
}

function wdbcCloseCategoryManager() {
    var modal = document.getElementById('wdbc-cat-modal');
    if (modal) modal.style.display = 'none';
}

function wdbcRenderCategoryList() {
    var list = document.getElementById('wdbc-cat-list');
    if (!list) return;
    list.innerHTML = '<div style="padding:15px; text-align:center; color:#64748b;">Loading categories...</div>';

    wdbcEnsureCategoriesNode(function (cats) {
        firebase.database().ref('stores/' + currentStoreId + '/inventory').once('value').then(function (invSnap) {
            var counts = {};
            invSnap.forEach(function (branchChild) {
                branchChild.forEach(function (prodChild) {
                    var it = prodChild.val() || {};
                    var c = (it.category || '').trim();
                    if (c) counts[c] = (counts[c] || 0) + 1;
                });
            });

            var names = Object.keys(cats).sort(function (a, b) { return a.localeCompare(b); });
            if (names.length === 0) {
                list.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b;">No categories yet. Add one above.</div>';
                return;
            }

            var rows = names.map(function (c) {
                var count = counts[c] || 0;
                var safe = wdbcEsc(c).replace(/'/g, '&#39;');
                return '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px dashed #e2e8f0;">' +
                    '<div style="flex:1;">' +
                        '<strong>' + wdbcEsc(c) + '</strong>' +
                        '<br><small style="color:#64748b;">' + count + ' product' + (count === 1 ? '' : 's') + ' using this</small>' +
                    '</div>' +
                    '<button class="menu-btn" style="width:auto; margin:0; padding:6px 10px; font-size:11px; background:#f0f9ff; border:1px solid #bae6fd; color:#0369a1;" onclick="wdbcRenameCategory(\'' + safe + '\')">Rename</button>' +
                    '<button class="menu-btn btn-logout" style="width:auto; margin:0; padding:6px 10px; font-size:11px;" onclick="wdbcDeleteCategory(\'' + safe + '\')">Delete</button>' +
                '</div>';
            }).join('');
            list.innerHTML = rows;
        });
    });
}

function wdbcAddCategory() {
    var input = document.getElementById('wdbc-new-cat-name');
    if (!input) return;
    var name = input.value.trim();
    if (!name) { alert('Enter a category name.'); return; }
    var ref = firebase.database().ref('stores/' + currentStoreId + '/categories');
    ref.once('value').then(function (snap) {
        var existing = snap.val() || {};
        if (existing[name]) { alert('That category already exists.'); return; }
        ref.child(name).set({ name: name, createdAt: new Date().toISOString() }).then(function () {
            input.value = '';
            wdbcRenderCategoryList();
        }).catch(function (e) { alert('Failed to add: ' + e.message); });
    });
}

function wdbcRenameCategory(oldName) {
    var newName = prompt('Rename "' + oldName + '" to:', oldName);
    if (newName === null) return;
    newName = newName.trim();
    if (!newName || newName === oldName) return;

    var catRef = firebase.database().ref('stores/' + currentStoreId + '/categories');
    catRef.once('value').then(function (snap) {
        var existing = snap.val() || {};
        if (existing[newName]) { alert('A category with that name already exists.'); return; }

        catRef.child(oldName).once('value').then(function (oldSnap) {
            var oldData = oldSnap.val() || { name: oldName };
            var updates = {};
            updates[newName] = Object.assign({}, oldData, { name: newName, renamedFrom: oldName, renamedAt: new Date().toISOString() });
            updates[oldName] = null;
            catRef.update(updates).then(function () {
                firebase.database().ref('stores/' + currentStoreId + '/inventory').once('value').then(function (invSnap) {
                    var prodUpdates = {};
                    invSnap.forEach(function (branchChild) {
                        var branchId = branchChild.key;
                        branchChild.forEach(function (prodChild) {
                            var it = prodChild.val() || {};
                            if ((it.category || '').trim() === oldName) {
                                prodUpdates['inventory/' + branchId + '/' + prodChild.key + '/category'] = newName;
                            }
                        });
                    });
                    if (Object.keys(prodUpdates).length === 0) {
                        wdbcRenderCategoryList();
                        return;
                    }
                    firebase.database().ref('stores/' + currentStoreId).update(prodUpdates).then(function () {
                        wdbcRenderCategoryList();
                    }).catch(function (e) { alert('Renamed category but failed to update some products: ' + e.message); });
                });
            }).catch(function (e) { alert('Rename failed: ' + e.message); });
        });
    });
}

function wdbcDeleteCategory(name) {
    firebase.database().ref('stores/' + currentStoreId + '/inventory').once('value').then(function (invSnap) {
        var count = 0;
        invSnap.forEach(function (branchChild) {
            branchChild.forEach(function (prodChild) {
                var it = prodChild.val() || {};
                if ((it.category || '').trim() === name) count++;
            });
        });

        if (count === 0) {
            if (!confirm('Delete "' + name + '"? No products are using it.')) return;
            wdbcRemoveCategoryRecord(name);
            return;
        }

        var action = prompt(count + ' product(s) are using "' + name + '".\n\nType:\n  MOVE   to move them to another category first\n  CLEAR  to leave those products uncategorised\n  CANCEL to do nothing', 'MOVE');
        if (action === null) return;
        action = action.trim().toUpperCase();

        if (action === 'CANCEL' || action === '') return;
        if (action === 'CLEAR') {
            if (!confirm('Clear the category from ' + count + ' product(s) and delete "' + name + '"?')) return;
            wdbcReassignProducts(name, '', function () { wdbcRemoveCategoryRecord(name); });
        } else if (action === 'MOVE') {
            wdbcEnsureCategoriesNode(function (cats) {
                var others = Object.keys(cats).filter(function (c) { return c !== name; });
                if (others.length === 0) {
                    alert('No other categories to move products to. Add one first, or use CLEAR.');
                    return;
                }
                var target = prompt('Move products to which category?\n\nOptions: ' + others.join(', '), others[0]);
                if (!target || !cats[target]) { alert('Invalid category. Nothing changed.'); return; }
                wdbcReassignProducts(name, target, function () { wdbcRemoveCategoryRecord(name); });
            });
        } else {
            alert('Unrecognised action. Nothing changed.');
        }
    });
}

function wdbcReassignProducts(fromCategory, toCategory, done) {
    firebase.database().ref('stores/' + currentStoreId + '/inventory').once('value').then(function (invSnap) {
        var updates = {};
        invSnap.forEach(function (branchChild) {
            var branchId = branchChild.key;
            branchChild.forEach(function (prodChild) {
                var it = prodChild.val() || {};
                if ((it.category || '').trim() === fromCategory) {
                    updates['inventory/' + branchId + '/' + prodChild.key + '/category'] = toCategory;
                }
            });
        });
        if (Object.keys(updates).length === 0) { done(); return; }
        firebase.database().ref('stores/' + currentStoreId).update(updates).then(done).catch(function (e) {
            alert('Could not update products: ' + e.message);
        });
    });
}

function wdbcRemoveCategoryRecord(name) {
    firebase.database().ref('stores/' + currentStoreId + '/categories/' + name).remove().then(function () {
        wdbcRenderCategoryList();
    }).catch(function (e) { alert('Delete failed: ' + e.message); });
}

function wdbcInjectCategoryButton() {
    if (currentUserRole !== 'Admin') return;
    var addBtn = document.getElementById('add-product-trigger-btn');
    if (!addBtn) return;
    if (document.getElementById('wdbc-manage-cats-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'wdbc-manage-cats-btn';
    btn.className = 'menu-btn btn-action-primary btn-inv';
    btn.style.cssText = 'width:auto; margin:0 8px 0 0; padding:8px 16px; background:#f0f9ff; border:1px solid #bae6fd; color:#0369a1;';
    btn.textContent = 'Manage Categories';
    btn.onclick = wdbcOpenCategoryManager;
    addBtn.parentElement.insertBefore(btn, addBtn);
}

(function wdbcHookSwitchViewForCats() {
    var prev = window.switchView;
    if (typeof prev !== 'function' || prev.__wdbc2) return;
    var wrapped = function (viewId) {
        var result = prev.apply(this, arguments);
        if (viewId === 'inventory-view') {
            setTimeout(function () { try { wdbcInjectCategoryButton(); } catch (e) {} }, 120);
        }
        return result;
    };
    wrapped.__wdbc2 = true;
    window.switchView = wrapped;
})();

(function wdbcWatchDomForCats() {
    var scheduled = false;
    function fire() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
            scheduled = false;
            try { wdbcInjectCategoryButton(); } catch (e) {}
        });
    }
    if (document.body) {
        fire();
        new MutationObserver(fire).observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', fire);
    }
})();

window.WDBC = {
    setRange: wdbcSetRange,
    refreshChart: wdbcRefreshChart,
    openCategoryManager: wdbcOpenCategoryManager
};
