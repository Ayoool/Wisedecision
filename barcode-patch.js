// ==================== WISE DECISION BARCODE SCANNING PATCH (v1) ====================
// Load LAST in app.html (after modern-polish-patch.js).
//
// For the normal POS Sales + Inventory screens (pharmacy / retail / grocery):
//   - "Barcode" field on Add / Edit Product (type it, scan it, use the camera, or Generate one)
//   - POS Sales: USB / Bluetooth scanner guns add the item to the cart automatically
//   - POS Sales: "Scan with camera" button (continuous scanning, works on iPhone + Android)
//   - Unknown barcode in POS: pick the product once and it is linked for good
//   - Inventory: scan a barcode to jump straight to that product
//
// Data: stores/<storeId>/inventory/<branch>/<productId>/barcode = "6154000123456"

(function () {
    'use strict';
    if (window.__wdsBarcodeLoaded) return;
    window.__wdsBarcodeLoaded = true;
    console.log('Wise Decision barcode-patch.js — v1 loaded');

    // ---------- small helpers ----------
    function q(sel) { return document.querySelector(sel); }
    function ws(sel) { return document.querySelector('#workspace-content ' + sel); } // only the LIVE screen, not the hidden templates
    function byId(id) { return document.getElementById(id); }
    function isOpen(id) { var e = byId(id); return !!e && e.style.display === 'flex'; }
    function mk(tag, css, text) {
        var e = document.createElement(tag);
        if (css) e.style.cssText = css;
        if (text != null) e.textContent = text;
        return e;
    }
    function nameOf(it) { return (it && (it.name || it.productName)) || 'Item'; }
    function cache() { return (typeof inventoryCache !== 'undefined' && inventoryCache) ? inventoryCache : {}; }
    function role() { return (typeof currentUserRole !== 'undefined') ? currentUserRole : ''; }
    function branchNow() { return (typeof currentBranch !== 'undefined' && currentBranch) ? currentBranch : 'main'; }
    function storeId() { return (typeof currentStoreId !== 'undefined') ? currentStoreId : null; }
    function invBranchFilter() { return (typeof currentInventoryBranchFilter !== 'undefined') ? currentInventoryBranchFilter : 'main'; }

    // ---------- toast + beep ----------
    function toast(msg, bad) {
        var t = byId('wds-toast');
        if (!t) {
            t = mk('div', 'position:fixed; left:50%; bottom:24px; transform:translateX(-50%); z-index:3500; padding:10px 16px; border-radius:10px; color:#fff; font-size:13px; font-weight:bold; max-width:90%; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,0.25); display:none;');
            t.id = 'wds-toast';
            document.body.appendChild(t);
        }
        t.style.background = bad ? '#b91c1c' : '#166534';
        t.textContent = msg;
        t.style.display = 'block';
        clearTimeout(t._h);
        t._h = setTimeout(function () { t.style.display = 'none'; }, 2400);
    }

    function beep(ok) {
        try {
            var C = window.AudioContext || window.webkitAudioContext;
            if (C) {
                var ctx = beep.ctx || (beep.ctx = new C());
                var o = ctx.createOscillator(), g = ctx.createGain();
                o.connect(g); g.connect(ctx.destination);
                o.frequency.value = ok ? 1000 : 300;
                g.gain.value = 0.08;
                o.start();
                o.stop(ctx.currentTime + (ok ? 0.09 : 0.25));
            }
        } catch (e) { /* sound is optional */ }
        try { if (navigator.vibrate) navigator.vibrate(ok ? 40 : [80, 60, 80]); } catch (e2) { /* optional */ }
    }

    // ---------- barcode lookup ----------
    // Digits-only codes ignore leading zeros so a UPC-A (12 digits) matches the same EAN-13 (13 digits).
    function normCode(c) {
        c = String(c == null ? '' : c).trim().toUpperCase().replace(/\s+/g, '');
        if (/^\d+$/.test(c)) c = c.replace(/^0+/, '');
        return c;
    }

    function findIn(branch, code) {
        var n = normCode(code);
        if (!n) return null;
        var items = cache()[branch] || {};
        var ids = Object.keys(items);
        for (var i = 0; i < ids.length; i++) {
            var it = items[ids[i]];
            if (it && it.barcode && normCode(it.barcode) === n) return { id: ids[i], item: it, branch: branch };
        }
        return null;
    }

    function find(code, branch) {
        if (branch && branch !== 'all') return findIn(branch, code);
        var all = cache(), keys = Object.keys(all);
        for (var i = 0; i < keys.length; i++) {
            var hit = findIn(keys[i], code);
            if (hit) return hit;
        }
        return null;
    }

    function writeBarcode(branch, id, code) {
        if (!storeId()) return Promise.resolve();
        var ref = firebase.database().ref('stores/' + storeId() + '/inventory/' + branch + '/' + id);
        return ref.update({ barcode: code || null }).then(function () {
            var items = cache()[branch];
            if (items && items[id]) {
                if (code) items[id].barcode = code; else delete items[id].barcode;
            }
        }).catch(function (e) { toast('Could not save barcode: ' + e.message, true); });
    }

    // In-store EAN-13 (starts with 20) for products that have no printed barcode.
    function generateCode(branch) {
        for (var tries = 0; tries < 30; tries++) {
            var base = '20';
            for (var i = 0; i < 10; i++) base += Math.floor(Math.random() * 10);
            var sum = 0;
            for (var j = 0; j < 12; j++) sum += Number(base[j]) * (j % 2 === 0 ? 1 : 3);
            var code = base + ((10 - (sum % 10)) % 10);
            if (!find(code, branch)) return code;
        }
        return '20' + String(Date.now()).slice(-10) + '0';
    }

    // ---------- adding a scanned product to the POS cart ----------
    function addScanned(found) {
        var id = found.id, item = found.item, name = nameOf(item);
        var sel = ws('#pos-product-select'), qty = ws('#pos-qty'), price = ws('#pos-custom-price'), search = ws('#pos-search-input');
        if (!sel || !qty) return { ok: false, msg: 'Open POS Sales first' };

        // make sure the product is selectable in the dropdown (it may be filtered out or not loaded yet)
        var present = false;
        for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === id) { present = true; break; } }
        if (!present && search && search.value) {
            search.value = '';
            if (typeof filterPosInventory === 'function') filterPosInventory();
            for (var k = 0; k < sel.options.length; k++) { if (sel.options[k].value === id) { present = true; break; } }
        }
        if (!present) {
            var opt = document.createElement('option');
            opt.value = id; opt.textContent = name;
            sel.appendChild(opt);
        }
        sel.value = id;
        if (typeof onPosProductChange === 'function') onPosProductChange();

        // products sold by weight: the cashier must type the weight
        if (item.soldByWeight) {
            qty.value = '';
            qty.focus();
            return { ok: true, msg: name + ' — enter the weight, then tap Add to Cart', manual: true };
        }

        qty.value = 1;
        var unit = (typeof currentSaleUnit !== 'undefined') ? currentSaleUnit : 'Piece';
        var cType = (typeof currentCustomerType !== 'undefined') ? currentCustomerType : 'Retail';
        var priceNow = price ? parseFloat(price.value) : NaN;
        var upp = Number(item.unitsPerPack) || 1;
        var stock = Number(item.stock !== undefined ? item.stock : (item.stockQty || 0)) || 0;
        var needNow = unit === 'Piece' ? 1 : upp;
        var inCartAll = currentCart.filter(function (l) { return l.id === id; })
            .reduce(function (s, l) { return s + (Number(l.piecesNeeded) || 0); }, 0);

        if (inCartAll + needNow > stock) {
            return { ok: false, msg: 'Out of stock: ' + name + ' (only ' + Math.max(0, stock - inCartAll) + ' left)' };
        }

        // same product already in the cart with the same unit/price -> just add 1 more to that line
        var line = null;
        for (var c = 0; c < currentCart.length; c++) {
            var l = currentCart[c];
            if (l.id === id && l.saleUnit === unit && l.customerType === cType && !isNaN(priceNow) && Math.abs(Number(l.price) - priceNow) < 0.001) { line = l; break; }
        }
        if (line) {
            var nextQty = Math.round((line.qty + 1) * 100) / 100;
            line.qty = nextQty;
            line.piecesNeeded = Math.round((unit === 'Piece' ? nextQty : nextQty * upp) * 100) / 100;
            line.total = Math.round(nextQty * line.price * 100) / 100;
            if (typeof renderCart === 'function') renderCart();
            return { ok: true, msg: '✓ ' + name + ' × ' + nextQty };
        }

        var before = currentCart.length;
        addToCart();
        if (currentCart.length > before) return { ok: true, msg: '✓ ' + name + ' added' };
        return { ok: false, msg: 'Could not add ' + name };
    }

    // ---------- "link this barcode to a product" popup ----------
    function openLinkModal(code) {
        if (byId('wds-link')) return;
        var branch = branchNow();
        var items = cache()[branch] || {};

        var ov = mk('div', 'position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:3200; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box;');
        ov.id = 'wds-link';
        var box = mk('div', 'background:#fff; border-radius:14px; padding:18px; width:100%; max-width:420px; max-height:88vh; overflow-y:auto; box-shadow:0 20px 45px rgba(15,23,42,0.35);');
        box.appendChild(mk('h3', 'margin:0 0 6px 0; font-size:16px; color:#0f172a;', 'Barcode not linked yet'));
        box.appendChild(mk('div', 'font-family:monospace; font-size:14px; background:#f1f5f9; border-radius:8px; padding:8px; margin-bottom:10px; word-break:break-all;', code));
        box.appendChild(mk('div', 'font-size:12px; color:#475569; margin-bottom:8px;', 'Search the product this barcode belongs to. It is saved once, then scanning adds it automatically.'));
        var input = mk('input', 'width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; box-sizing:border-box; margin-bottom:8px;');
        input.type = 'text'; input.placeholder = 'Type product name...';
        box.appendChild(input);
        var list = mk('div', 'max-height:240px; overflow-y:auto; border:1px solid #eef2f7; border-radius:8px; margin-bottom:10px;');
        box.appendChild(list);
        var cancel = mk('button', 'width:100%; padding:10px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:8px; font-weight:bold; cursor:pointer;', 'Cancel');
        box.appendChild(cancel);
        ov.appendChild(box);
        document.body.appendChild(ov);

        function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
        cancel.onclick = close;

        function render() {
            var term = input.value.toLowerCase().trim();
            list.innerHTML = '';
            var shown = 0;
            Object.keys(items).forEach(function (id) {
                var it = items[id];
                if (!it || shown >= 8) return;
                var nm = nameOf(it);
                if (term && nm.toLowerCase().indexOf(term) === -1) return;
                shown++;
                var row = mk('div', 'padding:10px; border-bottom:1px solid #f1f5f9; cursor:pointer; font-size:13px;');
                row.appendChild(mk('strong', '', nm));
                if (it.barcode) row.appendChild(mk('div', 'font-size:11px; color:#b45309;', 'Already has a barcode (' + it.barcode + ')'));
                row.onclick = function () {
                    if (it.barcode && normCode(it.barcode) !== normCode(code)) {
                        if (!confirm('"' + nm + '" already has barcode ' + it.barcode + '.\nReplace it with ' + code + '?')) return;
                    }
                    writeBarcode(branch, id, code).then(function () {
                        close();
                        var res = addScanned({ id: id, item: cache()[branch][id] || it, branch: branch });
                        toast(res.msg, !res.ok);
                        beep(res.ok);
                    });
                };
                list.appendChild(row);
            });
            if (!shown) list.appendChild(mk('div', 'padding:12px; font-size:12px; color:#64748b; text-align:center;', 'No matching products.'));
        }
        input.oninput = render;
        render();
        setTimeout(function () { input.focus(); }, 100);
    }

    // ---------- core: what happens when a code is scanned ----------
    function scanContext() {
        if (!storeId()) return null;
        if (byId('wds-link')) return null;
        if (isOpen('product-form-modal')) return 'form';
        var blockers = ['split-modal', 'held-carts-modal', 'quick-restock-modal', 'restock-history-modal', 'manual-lookup-modal', 'debt-payment-modal', 'customer-profile-modal', 'customer-form-modal', 'refund-modal', 'pending-order-details-modal', 'transfer-modal'];
        for (var i = 0; i < blockers.length; i++) { if (isOpen(blockers[i])) return null; }
        if (ws('#pos-product-select')) return 'pos';
        if (ws('#inventory-search-input')) return 'inventory';
        return null;
    }

    function handleCode(raw) {
        var code = String(raw || '').trim();
        if (!code) return { ok: false };
        var ctx = scanContext();

        if (ctx === 'form') {
            var f = byId('inv-barcode');
            if (f) { f.value = code; refreshNote(); }
            toast('Barcode captured: ' + code);
            beep(true);
            return { ok: true, msg: 'Captured ' + code };
        }

        if (ctx === 'pos') {
            var found = findIn(branchNow(), code);
            if (found) {
                var res = addScanned(found);
                toast(res.msg, !res.ok);
                beep(res.ok);
                return res;
            }
            beep(false);
            if (role() === 'Standard Worker') {
                var m = 'Not in inventory: ' + code + ' — ask a manager to link it';
                toast(m, true);
                return { ok: false, msg: m };
            }
            closeCamera();
            openLinkModal(code);
            return { ok: false, msg: 'Not linked: ' + code, linking: true };
        }

        if (ctx === 'inventory') {
            var hit = find(code, invBranchFilter());
            var s = ws('#inventory-search-input');
            if (hit && s) {
                s.value = nameOf(hit.item);
                if (typeof filterInventoryTable === 'function') filterInventoryTable();
                toast('Found: ' + nameOf(hit.item));
                beep(true);
                return { ok: true, msg: nameOf(hit.item) };
            }
            toast('No product has barcode ' + code, true);
            beep(false);
            return { ok: false, msg: 'No product has barcode ' + code };
        }

        return { ok: false, ignored: true };
    }

    // ---------- scanner gun (acts like a very fast keyboard that ends with Enter) ----------
    var buf = '', times = [];
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
        var now = Date.now();

        if (e.key === 'Enter') {
            var code = buf, n = times.length;
            var avg = n > 1 ? (times[n - 1] - times[0]) / (n - 1) : 999;
            var fast = code.length >= 4 && avg < 50;
            var t = e.target;
            buf = ''; times = [];

            // typed or pasted by hand in the POS search box and it matches a known barcode
            if (!fast && t && t.id === 'pos-search-input' && scanContext() === 'pos') {
                var typed = (t.value || '').trim();
                if (typed.length >= 4 && findIn(branchNow(), typed)) { code = typed; fast = true; }
            }
            if (!fast) return;
            if (!scanContext()) return;

            e.preventDefault();
            e.stopPropagation();

            // the scanner typed the digits into whatever field had focus: take them back out
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && typeof t.value === 'string' && t.value.slice(-code.length) === code) {
                t.value = t.value.slice(0, t.value.length - code.length);
                t.dispatchEvent(new Event('input', { bubbles: true }));
            }
            handleCode(code);
            return;
        }

        if (e.key === 'Shift' || e.key === 'CapsLock') return;
        if (e.key && e.key.length === 1) {
            if (times.length && now - times[times.length - 1] > 150) { buf = ''; times = []; }
            buf += e.key;
            times.push(now);
        } else {
            buf = ''; times = [];
        }
    }, true);

    // ---------- camera scanning ----------
    var cam = { overlay: null, video: null, stream: null, timer: null, reader: null };
    var zxPromise = null;

    function loadZXing() {
        if (window.ZXing) return Promise.resolve();
        if (zxPromise) return zxPromise;
        var urls = [
            'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
            'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js'
        ];
        zxPromise = new Promise(function (resolve, reject) {
            var i = 0;
            (function next() {
                if (i >= urls.length) { zxPromise = null; return reject(new Error('Could not load the scanner library. Check your internet connection.')); }
                var s = document.createElement('script');
                s.src = urls[i++];
                s.onload = function () { window.ZXing ? resolve() : next(); };
                s.onerror = next;
                document.head.appendChild(s);
            })();
        });
        return zxPromise;
    }

    function closeCamera() {
        if (cam.timer) { clearInterval(cam.timer); cam.timer = null; }
        if (cam.reader) { try { cam.reader.reset(); } catch (e) { /* ignore */ } cam.reader = null; }
        if (cam.stream) { try { cam.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e2) { /* ignore */ } cam.stream = null; }
        if (cam.video && cam.video.srcObject) { try { cam.video.srcObject = null; } catch (e3) { /* ignore */ } }
        if (cam.overlay && cam.overlay.parentNode) cam.overlay.parentNode.removeChild(cam.overlay);
        cam.overlay = null; cam.video = null;
    }

    function startCamera(video, onRaw) {
        if ('BarcodeDetector' in window) {
            // Android / Chrome: built-in detector (fast)
            return Promise.resolve().then(function () {
                return window.BarcodeDetector.getSupportedFormats ? window.BarcodeDetector.getSupportedFormats() : [];
            }).then(function (supported) {
                var wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'].filter(function (f) { return !supported.length || supported.indexOf(f) !== -1; });
                var detector = new window.BarcodeDetector(wanted.length ? { formats: wanted } : undefined);
                return navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then(function (stream) {
                    cam.stream = stream;
                    video.srcObject = stream;
                    return video.play();
                }).then(function () {
                    var busy = false;
                    cam.timer = setInterval(function () {
                        if (busy || video.readyState < 2) return;
                        busy = true;
                        detector.detect(video).then(function (r) {
                            busy = false;
                            if (r && r.length) onRaw(r[0].rawValue);
                        }).catch(function () { busy = false; });
                    }, 200);
                });
            });
        }

        // iPhone / Safari: ZXing library
        return loadZXing().then(function () {
            var hints = new Map();
            hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
                ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
                ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.ITF, ZXing.BarcodeFormat.QR_CODE
            ]);
            hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
            var reader = new ZXing.BrowserMultiFormatReader(hints, 200);
            cam.reader = reader;
            var cb = function (result) { if (result) onRaw(result.getText()); };
            if (typeof reader.decodeFromConstraints === 'function') {
                return reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video, cb);
            }
            return reader.decodeFromVideoDevice(undefined, video, cb);
        });
    }

    // opts: { title, continuous, showCart, onCode(code) -> {ok,msg} }
    function openCamera(opts) {
        closeCamera();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            toast('This browser cannot open the camera here.', true);
            return;
        }

        var ov = mk('div', 'position:fixed; inset:0; background:#000; z-index:3000; display:flex; flex-direction:column;');
        ov.id = 'wds-cam';
        var video = mk('video', 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover;');
        video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.setAttribute('autoplay', '');
        video.muted = true;
        ov.appendChild(video);

        var bar = mk('div', 'position:relative; z-index:2; display:flex; justify-content:space-between; align-items:center; padding:14px 16px; padding-top:calc(14px + env(safe-area-inset-top, 0px)); background:linear-gradient(#000c, #0000); color:#fff;');
        bar.appendChild(mk('div', 'font-weight:bold; font-size:15px;', opts.title || 'Scan barcode'));
        var done = mk('button', 'padding:8px 16px; border:none; border-radius:8px; background:#fff; color:#0f172a; font-weight:bold; font-size:14px;', opts.continuous ? 'Done' : 'Cancel');
        done.onclick = closeCamera;
        bar.appendChild(done);
        ov.appendChild(bar);

        var frame = mk('div', 'position:absolute; z-index:1; left:50%; top:45%; width:78%; max-width:360px; height:150px; transform:translate(-50%,-50%); border:3px solid #22c55e; border-radius:14px; box-shadow:0 0 0 9999px rgba(0,0,0,0.35);');
        ov.appendChild(frame);

        var status = mk('div', 'position:absolute; z-index:2; left:0; right:0; bottom:0; padding:16px; padding-bottom:calc(16px + env(safe-area-inset-bottom, 0px)); background:linear-gradient(#0000, #000c); color:#fff; text-align:center; font-size:14px; font-weight:bold;', 'Point the camera at the barcode');
        ov.appendChild(status);

        document.body.appendChild(ov);
        cam.overlay = ov; cam.video = video;

        function setStatus(msg, bad) {
            var extra = '';
            if (opts.showCart && typeof currentCart !== 'undefined') {
                var total = currentCart.reduce(function (s, l) { return s + (Number(l.total) || 0); }, 0);
                extra = '\nCart: ' + currentCart.length + ' line(s) · ₦' + total.toLocaleString();
            }
            status.style.whiteSpace = 'pre-line';
            status.style.color = bad ? '#fca5a5' : '#86efac';
            status.textContent = msg + extra;
        }

        var last = null, lastSeen = 0;
        function onRaw(code) {
            if (!cam.overlay) return;
            var now = Date.now();
            // holding the same barcode in view must not add it again and again
            if (code === last && now - lastSeen < 800) { lastSeen = now; return; }
            last = code; lastSeen = now;
            var res = opts.onCode(code) || {};
            if (cam.overlay) setStatus(res.msg || code, res.ok === false);
            frame.style.borderColor = res.ok === false ? '#ef4444' : '#22c55e';
            if (!opts.continuous && res.ok !== false) closeCamera();
        }

        startCamera(video, onRaw).catch(function (err) {
            var m = (err && err.name === 'NotAllowedError')
                ? 'Camera blocked. Allow camera access for this site in your phone settings, then try again.'
                : ('Camera error: ' + ((err && err.message) || err));
            if (cam.overlay) setStatus(m, true);
        });
    }

    function openPosCamera() {
        openCamera({
            title: 'Scan items for the cart',
            continuous: true,
            showCart: true,
            onCode: function (code) { return handleCode(code); }
        });
    }

    function openFormCamera() {
        openCamera({
            title: 'Scan the product barcode',
            continuous: false,
            onCode: function (code) {
                var f = byId('inv-barcode');
                if (f) { f.value = code; refreshNote(); }
                beep(true);
                return { ok: true, msg: 'Captured ' + code };
            }
        });
    }

    // ---------- product form: barcode field ----------
    function formBranch() {
        var editId = (byId('edit-product-id') || {}).value || '';
        if (editId) return (byId('edit-product-branch') || {}).value || invBranchFilter();
        return invBranchFilter();
    }

    function refreshNote() {
        var f = byId('inv-barcode'), note = byId('wds-bc-note');
        if (!f || !note) return;
        var code = f.value.trim();
        if (!code) { note.textContent = ''; return; }
        var branch = formBranch();
        var editId = (byId('edit-product-id') || {}).value || '';
        var dup = branch !== 'all' ? findIn(branch, code) : null;
        if (dup && dup.id !== editId) {
            note.style.color = '#b91c1c';
            note.textContent = '⚠ Already used by "' + nameOf(dup.item) + '"';
        } else {
            note.style.color = '#166534';
            note.textContent = '✓ Barcode is free to use';
        }
    }

    function ensureUI() {
        // POS bar (screen is rebuilt every time you open POS Sales, so check often)
        var s = ws('#pos-search-input');
        if (s && !byId('wds-pos-bar')) {
            var grp = s.closest ? s.closest('.form-group') : s.parentNode;
            if (grp && grp.parentNode) {
                var bar = mk('div', 'display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; padding:10px; border:1px dashed #86efac; background:#f0fdf4; border-radius:10px;');
                bar.id = 'wds-pos-bar';
                var btn = mk('button', 'width:auto; margin:0; padding:8px 14px; font-size:13px; font-weight:bold; border:none; border-radius:8px; background:#16a34a; color:#fff; cursor:pointer;', '📷 Scan with camera');
                btn.type = 'button';
                btn.onclick = openPosCamera;
                bar.appendChild(btn);
                bar.appendChild(mk('span', 'font-size:12px; font-weight:bold; color:#166534;', 'Scanner gun ready — just scan a product'));
                grp.parentNode.insertBefore(bar, grp);
            }
        }

        // Barcode field in Add / Edit Product
        var nameInput = byId('inv-name');
        if (nameInput && !byId('wds-barcode-group')) {
            var nameGrp = nameInput.closest ? nameInput.closest('.form-group') : nameInput.parentNode;
            if (nameGrp && nameGrp.parentNode) {
                var g = mk('div', 'margin-bottom:12px;');
                g.id = 'wds-barcode-group';
                g.appendChild(mk('label', 'display:block; font-size:12px; font-weight:bold; color:#475569; margin-bottom:4px;', '🏷 Barcode (optional)'));
                var row = mk('div', 'display:flex; gap:6px;');
                var inp = mk('input', 'flex:1; min-width:0; padding:8px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px; font-family:monospace; box-sizing:border-box;');
                inp.type = 'text'; inp.id = 'inv-barcode'; inp.placeholder = 'Scan, type, or Generate'; inp.autocomplete = 'off';
                inp.oninput = refreshNote;
                var cbtn = mk('button', 'width:auto; margin:0; padding:8px 10px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:8px; font-size:14px; cursor:pointer;', '📷');
                cbtn.type = 'button'; cbtn.title = 'Scan with camera';
                cbtn.onclick = openFormCamera;
                var gbtn = mk('button', 'width:auto; margin:0; padding:8px 10px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:8px; font-size:12px; font-weight:bold; cursor:pointer;', 'Generate');
                gbtn.type = 'button'; gbtn.title = 'Make an in-store barcode for products without one';
                gbtn.onclick = function () {
                    var br = formBranch();
                    inp.value = generateCode(br === 'all' ? branchNow() : br);
                    refreshNote();
                };
                row.appendChild(inp); row.appendChild(cbtn); row.appendChild(gbtn);
                g.appendChild(row);
                var note = mk('div', 'font-size:11px; margin-top:4px; min-height:14px;');
                note.id = 'wds-bc-note';
                g.appendChild(note);
                nameGrp.parentNode.insertBefore(g, nameGrp.nextSibling);
            }
        }
    }

    // keep the injected pieces present (screens get rebuilt by switchView and other patches)
    setInterval(ensureUI, 800);
    window.addEventListener('load', ensureUI);
    document.addEventListener('DOMContentLoaded', ensureUI);

    // ---------- hook into the existing product functions ----------
    var origEdit = window.editProduct;
    if (typeof origEdit === 'function') {
        window.editProduct = function (branchId, id) {
            ensureUI();
            var r = origEdit.apply(this, arguments);
            var f = byId('inv-barcode');
            var item = (cache()[branchId] || {})[id];
            if (f) { f.value = (item && item.barcode) || ''; f.dataset.loaded = id; refreshNote(); }
            return r;
        };
    }

    var origReset = window.resetInventoryForm;
    if (typeof origReset === 'function') {
        window.resetInventoryForm = function () {
            var r = origReset.apply(this, arguments);
            var f = byId('inv-barcode');
            if (f) { f.value = ''; delete f.dataset.loaded; refreshNote(); }
            return r;
        };
    }

    function attachToNewProduct(branch, name, code) {
        var tries = 0;
        var want = name.toLowerCase().replace(/\s+/g, ' ').trim();
        (function tick() {
            tries++;
            var items = cache()[branch] || {}, hit = null;
            Object.keys(items).forEach(function (id) {
                var it = items[id];
                if (it && nameOf(it).toLowerCase().replace(/\s+/g, ' ').trim() === want && !it.barcode) hit = id;
            });
            if (hit) { writeBarcode(branch, hit, code); return; }
            if (tries < 12) setTimeout(tick, 600);
        })();
    }

    var origSave = window.saveProduct;
    if (typeof origSave === 'function') {
        window.saveProduct = function () {
            var f = byId('inv-barcode');
            var code = f ? f.value.trim() : '';
            var editId = (byId('edit-product-id') || {}).value || '';
            var branch = formBranch();
            var name = ((byId('inv-name') || {}).value || '').trim();

            if (code && branch !== 'all') {
                var dup = findIn(branch, code);
                if (dup && dup.id !== editId) {
                    alert('This barcode is already used by "' + nameOf(dup.item) + '". Each product needs its own barcode.');
                    return;
                }
            }

            var result = origSave.apply(this, arguments);

            if (f && name && branch !== 'all') {
                if (editId) {
                    // only clear a barcode if this form actually loaded it
                    if (code || f.dataset.loaded === editId) writeBarcode(branch, editId, code);
                } else if (code) {
                    attachToNewProduct(branch, name, code);
                }
            }
            return result;
        };
    }

    window.wdsScan = handleCode; // handy for testing in the console: wdsScan('6154000123456')
})();
