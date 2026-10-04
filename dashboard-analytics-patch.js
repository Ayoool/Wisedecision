/* ============================================================
   dashboard-analytics-patch.js
   Adds: revenue trend, top sellers, peak hours, slow movers.
   Reads from the same sales/transactions cache the app already uses.
   ============================================================ */
(function () {
    'use strict';

    var analyticsRange = 7; // default

    /* ---------- helpers ---------- */
    function formatNaira(n) {
        if (typeof n !== 'number' || isNaN(n)) n = 0;
        return '₦' + n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
    }

    function daysAgo(n) {
        var d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - n);
        return d;
    }

    function dayKey(d) {
        var dt = (d instanceof Date) ? d : new Date(d);
        if (isNaN(dt)) return null;
        var y = dt.getFullYear();
        var m = String(dt.getMonth() + 1).padStart(2, '0');
        var dd = String(dt.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + dd;
    }

    function todayKey() { return dayKey(new Date()); }

    /* ---------- figure out which sales cache the app already populates ---------- */
    function getAllTransactions() {
        // Try the most likely global caches first. Add/remove to match your app.
        var candidates = [
            window.salesCache,
            window.transactionsCache,
            window.allTransactions,
            window.salesHistoryCache,
            window.salesHistory
        ];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            if (!c) continue;
            if (Array.isArray(c)) return c;
            if (typeof c === 'object') {
                var out = [];
                Object.keys(c).forEach(function (k) {
                    var v = c[k];
                    if (v && typeof v === 'object') {
                        if (v.txId || v.total !== undefined || v.date || v.items) {
                            out.push(v);
                        } else {
                            // nested by branch
                            Object.keys(v).forEach(function (k2) {
                                var v2 = v[k2];
                                if (v2 && typeof v2 === 'object') out.push(v2);
                            });
                        }
                    }
                });
                if (out.length) return out;
            }
        }
        return [];
    }

    function txDate(tx) {
        if (!tx) return null;
        // common field names — try in order
        var raw = tx.date || tx.timestamp || tx.createdAt || tx.dateTime || tx.dateISO;
        if (!raw) return null;
        if (typeof raw === 'number') return new Date(raw);
        return new Date(raw);
    }

    function txTotal(tx) {
        if (!tx) return 0;
        var t = tx.grandTotal != null ? tx.grandTotal
              : tx.total != null ? tx.total
              : tx.amount != null ? tx.amount
              : tx.totalAmount != null ? tx.totalAmount
              : null;
        if (t != null) return Number(t) || 0;
        // fallback: sum items
        var items = tx.items || tx.cart || tx.products;
        if (Array.isArray(items)) {
            return items.reduce(function (s, it) {
                var q = Number(it.qty || it.quantity || 1);
                var p = Number(it.price || it.unitPrice || it.total / (q || 1) || 0);
                return s + q * p;
            }, 0);
        }
        return 0;
    }

    function isCompletedSale(tx) {
        if (!tx) return false;
        var s = (tx.status || '').toLowerCase();
        if (s === 'pending' || s === 'held' || s === 'cancelled' || s === 'void') return false;
        if (tx.voided === true) return false;
        return true;
    }

    function txItems(tx) {
        var items = tx.items || tx.cart || tx.products;
        return Array.isArray(items) ? items : [];
    }

    /* ---------- branch filter (respects the current branch if app has one) ---------- */
    function getActiveBranch() {
        return window.currentInventoryBranchFilter
            || window.currentBranchId
            || window.activeBranchId
            || null;
    }

    function txBranch(tx) {
        return tx.branch || tx.branchId || tx.branchName || null;
    }

    function filterByBranch(txs, branch) {
        if (!branch || branch === 'all') return txs;
        return txs.filter(function (t) { return txBranch(t) === branch; });
    }

    /* ---------- SVG trend chart ---------- */
    function drawTrendChart(series) {
        var svg = document.getElementById('analytics-trend-svg');
        var emptyNote = document.getElementById('analytics-empty-note');
        if (!svg) return;

        var hasData = series.some(function (p) { return p.value > 0; });
        if (!hasData) {
            svg.innerHTML = '';
            svg.style.display = 'none';
            if (emptyNote) emptyNote.style.display = 'block';
            return;
        }
        svg.style.display = 'block';
        if (emptyNote) emptyNote.style.display = 'none';

        var W = 700, H = 220;
        var padL = 55, padR = 15, padT = 20, padB = 35;
        var innerW = W - padL - padR;
        var innerH = H - padT - padB;

        var maxV = Math.max.apply(null, series.map(function (p) { return p.value; })) || 1;
        maxV = Math.ceil(maxV / 1000) * 1000 || 1000;

        var stepX = series.length > 1 ? innerW / (series.length - 1) : innerW;

        function xOf(i) { return padL + stepX * i; }
        function yOf(v) { return padT + innerH - (v / maxV) * innerH; }

        // gridlines
        var gridLines = '';
        var steps = 4;
        for (var g = 0; g <= steps; g++) {
            var yv = (maxV / steps) * g;
            var yy = yOf(yv);
            gridLines += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy + '" y2="' + yy + '" stroke="#e2e8f0" stroke-width="1" />';
            gridLines += '<text x="' + (padL - 6) + '" y="' + (yy + 3) + '" font-size="9" fill="#94a3b8" text-anchor="end">' + formatNaira(yv).replace('₦','') + '</text>';
        }

        // build line path
        var linePath = '';
        var areaPath = '';
        series.forEach(function (p, i) {
            var cmd = (i === 0) ? 'M' : 'L';
            linePath += cmd + xOf(i) + ' ' + yOf(p.value) + ' ';
            if (i === 0) areaPath = 'M' + xOf(0) + ' ' + (padT + innerH) + ' ';
            areaPath += 'L' + xOf(i) + ' ' + yOf(p.value) + ' ';
        });
        areaPath += 'L' + xOf(series.length - 1) + ' ' + (padT + innerH) + ' Z';

        // dots + x labels
        var dots = '';
        var xLabels = '';
        var labelEvery = Math.max(1, Math.round(series.length / 8));
        series.forEach(function (p, i) {
            var cx = xOf(i), cy = yOf(p.value);
            dots += '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="#0284c7"><title>' + p.label + ': ' + formatNaira(p.value) + '</title></circle>';
            if (i % labelEvery === 0 || i === series.length - 1) {
                xLabels += '<text x="' + cx + '" y="' + (H - 12) + '" font-size="9" fill="#64748b" text-anchor="middle">' + p.label + '</text>';
            }
        });

        var html =
            '<defs>' +
                '<linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">' +
                    '<stop offset="0%" stop-color="#14b8a6" stop-opacity="0.35"/>' +
                    '<stop offset="100%" stop-color="#14b8a6" stop-opacity="0.02"/>' +
                '</linearGradient>' +
            '</defs>' +
            gridLines +
            '<path d="' + areaPath + '" fill="url(#areaGrad)" stroke="none" />' +
            '<path d="' + linePath + '" fill="none" stroke="#0284c7" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />' +
            dots +
            xLabels;

        svg.innerHTML = html;
    }

    /* ---------- top sellers ---------- */
    function computeTopSellers(txs, limit) {
        var map = {};
        txs.forEach(function (tx) {
            txItems(tx).forEach(function (it) {
                var name = it.name || it.productName || it.item || it.title || 'Unknown';
                var qty = Number(it.qty || it.quantity || 0);
                if (!qty) return;
                if (!map[name]) map[name] = { name: name, qty: 0, revenue: 0 };
                map[name].qty += qty;
                var price = Number(it.price || it.unitPrice || 0);
                map[name].revenue += qty * price;
            });
        });
        var arr = Object.keys(map).map(function (k) { return map[k]; });
        arr.sort(function (a, b) { return b.qty - a.qty; });
        return arr.slice(0, limit || 5);
    }

    /* ---------- peak hours ---------- */
    function computePeakHours(txs) {
        var hours = new Array(24).fill(0);
        txs.forEach(function (tx) {
            var d = txDate(tx);
            if (!d || isNaN(d)) return;
            hours[d.getHours()] += 1;
        });
        return hours;
    }

    /* ---------- slow movers ---------- */
    function computeSlowMovers(activeTxs, allProducts, limit) {
        // collect item names that sold in the window
        var sold = {};
        activeTxs.forEach(function (tx) {
            txItems(tx).forEach(function (it) {
                var name = it.name || it.productName || it.item || it.title;
                if (name) sold[String(name).toLowerCase()] = true;
            });
        });

        // collect products from inventory cache
        var prods = [];
        if (allProducts && typeof allProducts === 'object') {
            Object.keys(allProducts).forEach(function (branchKey) {
                var branch = allProducts[branchKey];
                if (!branch || typeof branch !== 'object') return;
                Object.keys(branch).forEach(function (pid) {
                    var p = branch[pid];
                    if (!p) return;
                    var name = p.name || p.productName || pid;
                    prods.push({ name: name, branch: branchKey, stock: p.stock != null ? p.stock : p.qty });
                });
            });
        }

        // dedupe by lowercase name, keep max stock
        var dedupe = {};
        prods.forEach(function (p) {
            var k = String(p.name).toLowerCase();
            if (!dedupe[k]) dedupe[k] = p;
            else if ((p.stock || 0) > (dedupe[k].stock || 0)) dedupe[k].stock = p.stock;
        });

        var movers = Object.keys(dedupe)
            .filter(function (k) { return !sold[k]; })
            .map(function (k) { return dedupe[k]; })
            .sort(function (a, b) { return (b.stock || 0) - (a.stock || 0); })
            .slice(0, limit || 5);

        return movers;
    }

    /* ---------- render all four panels ---------- */
    function renderAnalytics() {
        var allTx = getAllTransactions().filter(isCompletedSale);
        var branch = getActiveBranch();
        allTx = filterByBranch(allTx, branch);

        var cutoff = daysAgo(analyticsRange - 1);
        var recent = allTx.filter(function (tx) {
            var d = txDate(tx);
            return d && !isNaN(d) && d >= cutoff;
        });

        /* --- trend series --- */
        var series = [];
        var totalRevenue = 0;
        for (var i = analyticsRange - 1; i >= 0; i--) {
            var day = daysAgo(i);
            var key = dayKey(day);
            var label = day.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
            var value = recent.reduce(function (sum, tx) {
                var k = dayKey(txDate(tx));
                return (k === key) ? sum + txTotal(tx) : sum;
            }, 0);
            series.push({ key: key, label: label, value: value });
            totalRevenue += value;
        }

        drawTrendChart(series);

        var totalEl = document.getElementById('analytics-total-revenue');
        var avgEl = document.getElementById('analytics-avg-revenue');
        if (totalEl) totalEl.textContent = formatNaira(totalRevenue);
        if (avgEl) avgEl.textContent = formatNaira(Math.round(totalRevenue / analyticsRange));

        /* --- top sellers --- */
        var topBox = document.getElementById('analytics-top-sellers');
        if (topBox) {
            var top = computeTopSellers(recent, 5);
            if (!top.length) {
                topBox.innerHTML = '<em>No sales in this range.</em>';
            } else {
                var maxQty = top[0].qty || 1;
                topBox.innerHTML = top.map(function (p) {
                    var pct = Math.round((p.qty / maxQty) * 100);
                    return '<div class="analytics-bar-row">' +
                        '<div class="analytics-bar-label" title="' + p.name + '">' + p.name + '</div>' +
                        '<div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:' + pct + '%"></div></div>' +
                        '<div class="analytics-bar-value">' + p.qty + ' sold · ' + formatNaira(p.revenue) + '</div>' +
                    '</div>';
                }).join('');
            }
        }

        /* --- peak hours --- */
        var peakBox = document.getElementById('analytics-peak-hours');
        if (peakBox) {
            var last30 = allTx.filter(function (tx) {
                var d = txDate(tx);
                return d && !isNaN(d) && d >= daysAgo(29);
            });
            var hours = computePeakHours(last30);
            var maxH = Math.max.apply(null, hours) || 1;
            var labels = ['12a','1a','2a','3a','4a','5a','6a','7a','8a','9a','10a','11a','12p','1p','2p','3p','4p','5p','6p','7p','8p','9p','10p','11p'];
            var html = '<div style="display:flex; flex-wrap:wrap; gap:2px;">';
            for (var h = 0; h < 24; h++) {
                var intensity = hours[h] / maxH;
                // interpolate from light to dark teal
                var bg = intensity === 0 ? '#f1f5f9'
                       : 'rgba(2,132,199,' + (0.15 + intensity * 0.85) + ')';
                var color = intensity > 0.4 ? '#fff' : '#334155';
                html += '<div class="analytics-heat-cell" style="background:' + bg + '; color:' + color + '" title="' + labels[h] + ' — ' + hours[h] + ' sales">' + labels[h] + '</div>';
            }
            html += '</div>';
            html += '<div style="font-size:11px; color:var(--text-muted); margin-top:8px;">Darker = more sales. Peak hour: <strong>' + (function () {
                var mi = 0; for (var k = 1; k < 24; k++) if (hours[k] > hours[mi]) mi = k; return labels[mi];
            })() + '</strong></div>';
            peakBox.innerHTML = html;
        }

        /* --- slow movers --- */
        var slowBox = document.getElementById('analytics-slow-movers');
        if (slowBox) {
            var invCache = window.inventoryCache || {};
            var movers = computeSlowMovers(last30 || recent, invCache, 5);
            if (!movers.length) {
                slowBox.innerHTML = '<em>Every product had at least one sale in the last 30 days. 🎉</em>';
            } else {
                slowBox.innerHTML = movers.map(function (p) {
                    return '<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9;">' +
                        '<span style="font-weight:600; color:#334155;">' + p.name + '</span>' +
                        '<span style="color:#b45309; font-weight:bold;">' + (p.stock != null ? p.stock : '?') + ' in stock · 0 sold</span>' +
                    '</div>';
                }).join('');
            }
        }

        /* --- toggle button state --- */
        var b7  = document.getElementById('analytics-range-7');
        var b30 = document.getElementById('analytics-range-30');
        if (b7 && b30) {
            b7.classList.toggle('active', analyticsRange === 7);
            b30.classList.toggle('active', analyticsRange === 30);
        }
    }

    /* ---------- public API ---------- */
    window.setAnalyticsRange = function (n) {
        analyticsRange = (n === 30) ? 30 : 7;
        renderAnalytics();
    };

    window.refreshDashboardAnalytics = renderAnalytics;

    /* ---------- inject template into the dashboard workspace on view switch ---------- */
    window.addEventListener('load', function () {
        var origSwitchView = window.switchView;
        if (typeof origSwitchView !== 'function') return;

        window.switchView = function (viewId) {
            var ret = origSwitchView.apply(this, arguments);
            if (viewId === 'main-dashboard-view') {
                // after the workspace renders, append the analytics block
                setTimeout(function () {
                    var workspace = document.getElementById('workspace-content');
                    var tpl = document.getElementById('dashboard-analytics-template');
                    if (!workspace || !tpl) return;
                    if (workspace.querySelector('#analytics-trend-svg')) {
                        // already injected — just refresh
                        renderAnalytics();
                        return;
                    }
                    var clone = tpl.cloneNode(true);
                    clone.style.display = 'block';
                    clone.removeAttribute('id');
                    workspace.appendChild(clone);
                    renderAnalytics();
                }, 60);
            }
            return ret;
        };

        // if the dashboard is already showing on load, inject immediately
        setTimeout(function () {
            var ws = document.getElementById('workspace-content');
            if (ws && ws.querySelector('h2') && /Store Overview/i.test(ws.textContent || '')) {
                window.switchView('main-dashboard-view');
            }
        }, 200);
    });
})();
