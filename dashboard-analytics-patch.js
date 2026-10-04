/* ============================================================
   dashboard-analytics-patch.js  v3
   Renders the analytics block inside the REPORTS view
   (not the dashboard). Reads sales directly from Firebase.
   ============================================================ */
(function () {
    'use strict';

    var analyticsRange = 7;
    var cachedTx = null;
    var cacheStamp = 0;

    /* ---------- helpers ---------- */
    function formatNaira(n) {
        if (typeof n !== 'number' || isNaN(n)) n = 0;
        return '₦' + n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
    }
    function daysAgo(n) {
        var d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - n); return d;
    }
    function dayKey(d) {
        var dt = (d instanceof Date) ? d : new Date(d);
        if (isNaN(dt)) return null;
        return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
    }

    function getContext() {
        var storeId =
            window.currentStoreId ||
            window.storeId ||
            window.activeStoreId ||
            (function(){ try { return localStorage.getItem('storeId') || localStorage.getItem('currentStoreId'); } catch(e){ return null; } })();

        var branch =
            window.currentBranchId ||
            window.currentInventoryBranchFilter ||
            window.activeBranchId ||
            (function(){ try { return localStorage.getItem('branchId') || localStorage.getItem('currentBranchId'); } catch(e){ return null; } })();

        return { storeId: storeId, branch: branch };
    }

    function loadAllSales(callback) {
        var now = Date.now();
        if (cachedTx && (now - cacheStamp) < 30000) {
            callback(cachedTx);
            return;
        }
        var ctx = getContext();
        if (!ctx.storeId) { callback([]); return; }
        if (typeof firebase === 'undefined' || !firebase.database) {
            setTimeout(function () { loadAllSales(callback); }, 400);
            return;
        }

        firebase.database().ref('sales/' + ctx.storeId).once('value').then(function (snap) {
            var val = snap.val() || {};
            var out = [];
            Object.keys(val).forEach(function (k1) {
                var v1 = val[k1];
                if (!v1 || typeof v1 !== 'object') return;
                var looksLikeTx = (v1.total !== undefined || v1.grandTotal !== undefined || v1.items || v1.date || v1.createdAt);
                if (looksLikeTx) {
                    v1.__branch = v1.branch || v1.branchId || k1;
                    out.push(v1);
                } else {
                    Object.keys(v1).forEach(function (k2) {
                        var v2 = v1[k2];
                        if (!v2 || typeof v2 !== 'object') return;
                        v2.__branch = v2.branch || v2.branchId || k1;
                        out.push(v2);
                    });
                }
            });
            cachedTx = out;
            cacheStamp = Date.now();
            callback(out);
        }).catch(function (err) {
            console.error('[analytics] firebase read failed', err);
            callback([]);
        });
    }

    function txDate(tx) {
        var raw = tx.date || tx.timestamp || tx.createdAt || tx.dateTime || tx.dateISO || tx.time;
        if (raw == null) return null;
        if (typeof raw === 'number') return new Date(raw < 1e12 ? raw * 1000 : raw);
        return new Date(raw);
    }
    function txTotal(tx) {
        var t = tx.grandTotal != null ? tx.grandTotal
              : tx.total != null ? tx.total
              : tx.amount != null ? tx.amount
              : tx.totalAmount != null ? tx.totalAmount
              : null;
        if (t != null) return Number(t) || 0;
        var items = tx.items || tx.cart || tx.products;
        if (Array.isArray(items)) {
            return items.reduce(function (s, it) {
                var q = Number(it.qty || it.quantity || 1);
                var p = Number(it.price || it.unitPrice || (it.total && q ? it.total/q : 0) || 0);
                return s + q * p;
            }, 0);
        }
        return 0;
    }
    function isCompleted(tx) {
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
        var innerW = W - padL - padR, innerH = H - padT - padB;
        var maxV = Math.max.apply(null, series.map(function (p) { return p.value; })) || 1;
        maxV = Math.ceil(maxV / 1000) * 1000 || 1000;
        var stepX = series.length > 1 ? innerW / (series.length - 1) : innerW;
        function xOf(i) { return padL + stepX * i; }
        function yOf(v) { return padT + innerH - (v / maxV) * innerH; }

        var grid = '', steps = 4;
        for (var g = 0; g <= steps; g++) {
            var yv = (maxV / steps) * g, yy = yOf(yv);
            grid += '<line x1="' + padL + '" x2="' + (W-padR) + '" y1="' + yy + '" y2="' + yy + '" stroke="#e2e8f0" />';
            grid += '<text x="' + (padL-6) + '" y="' + (yy+3) + '" font-size="9" fill="#94a3b8" text-anchor="end">' + Math.round(yv) + '</text>';
        }

        var linePath = '', areaPath = '';
        series.forEach(function (p, i) {
            var cmd = (i === 0) ? 'M' : 'L';
            linePath += cmd + xOf(i) + ' ' + yOf(p.value) + ' ';
            if (i === 0) areaPath = 'M' + xOf(0) + ' ' + (padT + innerH) + ' ';
            areaPath += 'L' + xOf(i) + ' ' + yOf(p.value) + ' ';
        });
        areaPath += 'L' + xOf(series.length-1) + ' ' + (padT + innerH) + ' Z';

        var dots = '', xLabels = '';
        var every = Math.max(1, Math.round(series.length / 8));
        series.forEach(function (p, i) {
            dots += '<circle cx="' + xOf(i) + '" cy="' + yOf(p.value) + '" r="3" fill="#0284c7"><title>' + p.label + ': ' + formatNaira(p.value) + '</title></circle>';
            if (i % every === 0 || i === series.length - 1) {
                xLabels += '<text x="' + xOf(i) + '" y="' + (H-12) + '" font-size="9" fill="#64748b" text-anchor="middle">' + p.label + '</text>';
            }
        });

        svg.innerHTML =
            '<defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#14b8a6" stop-opacity="0.35"/>' +
            '<stop offset="100%" stop-color="#14b8a6" stop-opacity="0.02"/>' +
            '</linearGradient></defs>' +
            grid +
            '<path d="' + areaPath + '" fill="url(#areaGrad)" stroke="none"/>' +
            '<path d="' + linePath + '" fill="none" stroke="#0284c7" stroke-width="2" stroke-linejoin="round"/>' +
            dots + xLabels;
    }

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
        return Object.keys(map).map(function (k) { return map[k]; })
            .sort(function (a, b) { return b.qty - a.qty; })
            .slice(0, limit || 5);
    }

    function computePeakHours(txs) {
        var h = new Array(24).fill(0);
        txs.forEach(function (tx) {
            var d = txDate(tx);
            if (d && !isNaN(d)) h[d.getHours()]++;
        });
        return h;
    }

    function computeSlowMovers(activeTxs, invCache, limit) {
        var sold = {};
        activeTxs.forEach(function (tx) {
            txItems(tx).forEach(function (it) {
                var n = it.name || it.productName || it.item || it.title;
                if (n) sold[String(n).toLowerCase()] = true;
            });
        });
        var prods = [];
        if (invCache && typeof invCache === 'object') {
            Object.keys(invCache).forEach(function (branchKey) {
                var b = invCache[branchKey];
                if (!b || typeof b !== 'object') return;
                Object.keys(b).forEach(function (pid) {
                    var p = b[pid];
                    if (!p) return;
                    prods.push({ name: p.name || p.productName || pid, stock: p.stock != null ? p.stock : p.qty });
                });
            });
        }
        var dedupe = {};
        prods.forEach(function (p) {
            var k = String(p.name).toLowerCase();
            if (!dedupe[k]) dedupe[k] = p;
            else if ((p.stock||0) > (dedupe[k].stock||0)) dedupe[k].stock = p.stock;
        });
        return Object.keys(dedupe).filter(function (k) { return !sold[k]; })
            .map(function (k) { return dedupe[k]; })
            .sort(function (a,b) { return (b.stock||0) - (a.stock||0); })
            .slice(0, limit || 5);
    }

    function renderAnalytics() {
        loadAllSales(function (allTx) {
            allTx = allTx.filter(isCompleted);

            var ctx = getContext();
            if (ctx.branch && ctx.branch !== 'all') {
                allTx = allTx.filter(function (tx) {
                    return (tx.__branch || tx.branch || tx.branchId) === ctx.branch;
                });
            }

            var cutoff = daysAgo(analyticsRange - 1).getTime();
            var recent = allTx.filter(function (tx) {
                var d = txDate(tx);
                return d && !isNaN(d) && d.getTime() >= cutoff;
            });

            var series = [], totalRevenue = 0;
            for (var i = analyticsRange - 1; i >= 0; i--) {
                var day = daysAgo(i);
                var key = dayKey(day);
                var label = day.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
                var value = recent.reduce(function (sum, tx) {
                    return (dayKey(txDate(tx)) === key) ? sum + txTotal(tx) : sum;
                }, 0);
                series.push({ key: key, label: label, value: value });
                totalRevenue += value;
            }
            drawTrendChart(series);

            var totalEl = document.getElementById('analytics-total-revenue');
            var avgEl = document.getElementById('analytics-avg-revenue');
            if (totalEl) totalEl.textContent = formatNaira(totalRevenue);
            if (avgEl) avgEl.textContent = formatNaira(Math.round(totalRevenue / analyticsRange));

            var topBox = document.getElementById('analytics-top-sellers');
            if (topBox) {
                var top = computeTopSellers(recent, 5);
                if (!top.length) topBox.innerHTML = '<em>No sales in this range.</em>';
                else {
                    var maxQty = top[0].qty || 1;
                    topBox.innerHTML = top.map(function (p) {
                        var pct = Math.round((p.qty / maxQty) * 100);
                        return '<div class="analytics-bar-row">' +
                            '<div class="analytics-bar-label" title="' + p.name + '">' + p.name + '</div>' +
                            '<div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:' + pct + '%"></div></div>' +
                            '<div class="analytics-bar-value">' + p.qty + ' · ' + formatNaira(p.revenue) + '</div>' +
                        '</div>';
                    }).join('');
                }
            }

            var peakBox = document.getElementById('analytics-peak-hours');
            if (peakBox) {
                var last30Cut = daysAgo(29).getTime();
                var last30 = allTx.filter(function (tx) {
                    var d = txDate(tx);
                    return d && !isNaN(d) && d.getTime() >= last30Cut;
                });
                var hours = computePeakHours(last30);
                var maxH = Math.max.apply(null, hours) || 1;
                var labels = ['12a','1a','2a','3a','4a','5a','6a','7a','8a','9a','10a','11a','12p','1p','2p','3p','4p','5p','6p','7p','8p','9p','10p','11p'];
                var html = '<div style="display:flex; flex-wrap:wrap; gap:2px;">';
                for (var h = 0; h < 24; h++) {
                    var intensity = hours[h] / maxH;
                    var bg = intensity === 0 ? '#f1f5f9' : 'rgba(2,132,199,' + (0.15 + intensity * 0.85) + ')';
                    var color = intensity > 0.4 ? '#fff' : '#334155';
                    html += '<div class="analytics-heat-cell" style="background:' + bg + '; color:' + color + '" title="' + labels[h] + ' — ' + hours[h] + ' sales">' + labels[h] + '</div>';
                }
                html += '</div>';
                var peakIdx = 0; for (var k = 1; k < 24; k++) if (hours[k] > hours[peakIdx]) peakIdx = k;
                html += '<div style="font-size:11px; color:var(--text-muted); margin-top:8px;">Darker = more sales. Peak hour: <strong>' + labels[peakIdx] + '</strong></div>';
                peakBox.innerHTML = html;
            }

            var slowBox = document.getElementById('analytics-slow-movers');
            if (slowBox) {
                var inv = window.inventoryCache || {};
                var movers = computeSlowMovers(last30, inv, 5);
                if (!movers.length) slowBox.innerHTML = '<em>Every product had at least one sale in the last 30 days. 🎉</em>';
                else slowBox.innerHTML = movers.map(function (p) {
                    return '<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f1f5f9;">' +
                        '<span style="font-weight:600; color:#334155;">' + p.name + '</span>' +
                        '<span style="color:#b45309; font-weight:bold;">' + (p.stock != null ? p.stock : '?') + ' in stock · 0 sold</span>' +
                    '</div>';
                }).join('');
            }

            var b7  = document.getElementById('analytics-range-7');
            var b30 = document.getElementById('analytics-range-30');
            if (b7 && b30) {
                b7.classList.toggle('active',  analyticsRange === 7);
                b30.classList.toggle('active', analyticsRange === 30);
            }
        });
    }

    window.setAnalyticsRange = function (n) {
        analyticsRange = (n === 30) ? 30 : 7;
        cachedTx = null;
        renderAnalytics();
    };
    window.refreshDashboardAnalytics = renderAnalytics;

    /* ---------- inject template into REPORTS view on switch ---------- */
    window.addEventListener('load', function () {
        var orig = window.switchView;
        if (typeof orig === 'function') {
            window.switchView = function (viewId) {
                var ret = orig.apply(this, arguments);
                if (viewId === 'reports-view') {
                    setTimeout(function () {
                        var host = document.getElementById('workspace-content');
                        var tpl = document.getElementById('dashboard-analytics-template');
                        if (!host || !tpl) return;
                        if (host.querySelector('#analytics-trend-svg')) { renderAnalytics(); return; }

                        var clone = tpl.cloneNode(true);
                        clone.id = 'analytics-injected';
                        clone.style.display = 'block';
                        clone.style.marginTop = '24px';

                        // Insert right after the reports header (before the filter bar)
                        // so it sits at the top of the Reports screen.
                        var reportsRoot = host.querySelector('div'); // the padding wrapper
                        var anchor = reportsRoot ? reportsRoot.querySelector('div[style*="margin-bottom: 20px"][style*="display: flex"]') : null;

                        if (anchor && anchor.parentNode) {
                            anchor.parentNode.insertBefore(clone, anchor);
                        } else if (reportsRoot) {
                            reportsRoot.insertBefore(clone, reportsRoot.firstChild);
                        } else {
                            host.appendChild(clone);
                        }

                        renderAnalytics();
                    }, 80);
                }
                return ret;
            };
        }
    });
})();
