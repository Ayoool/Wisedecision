// customer-shop-patch.js
document.addEventListener("DOMContentLoaded", function() {
    
    // 1. Inject the Customer Shop View HTML into the body once
    if (!document.getElementById('customer-shop-view')) {
        const shopHTML = `
            <style>
                #customer-shop-view { background: #f8fafc; min-height: 100vh; padding-bottom: 80px; position: absolute; top: 0; left: 0; width: 100%; z-index: 1000; overflow-y: auto; }
                .shop-header { background: #0284c7; color: white; padding: 15px 20px; text-align: center; position: sticky; top: 0; z-index: 100; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
                .shop-header h2 { margin: 0; font-size: 18px; }
                .back-btn { background: rgba(255,255,255,0.2); border: none; color: white; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: bold; }
                .shop-container { max-width: 800px; margin: 20px auto; padding: 0 15px; }
                .store-lookup-box { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center; margin-bottom: 20px; }
                .store-lookup-box input { width: 100%; max-width: 300px; padding: 12px; border: 2px solid #cbd5e1; border-radius: 8px; font-size: 16px; margin-bottom: 10px; text-align: center; text-transform: lowercase; }
                .store-lookup-box button { background: #0284c7; color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; width: 100%; max-width: 300px; }
                .search-bar { width: 100%; padding: 12px 15px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 15px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.02); }
                .shop-product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
                .shop-product-card { background: white; border-radius: 12px; padding: 12px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 8px rgba(0,0,0,0.02); }
                .shop-product-card h3 { font-size: 14px; margin: 0 0 5px 0; color: #1e293b; line-height: 1.2; }
                .shop-product-card p { font-size: 14px; color: #166534; font-weight: bold; margin: 0 0 10px 0; }
                .out-of-stock-label { color: #ef4444; font-size: 11px; font-weight: bold; margin-bottom: 5px; display: block; }
                .add-to-cart-btn { background: #ecfdf5; color: #0f766e; border: 1px solid #a7f3d0; padding: 8px; border-radius: 8px; font-weight: bold; cursor: pointer; }
                .add-to-cart-btn:disabled { background: #f1f5f9; color: #94a3b8; border-color: #e2e8f0; cursor: not-allowed; }
                .floating-cart-btn { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); width: calc(100% - 40px); max-width: 500px; background: #16a34a; color: white; padding: 16px; border-radius: 12px; text-align: center; font-weight: bold; font-size: 16px; box-shadow: 0 10px 25px rgba(22,163,74,0.3); border: none; cursor: pointer; z-index: 100; display: none; }
                .customer-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 2000; justify-content: center; align-items: flex-end; }
                .customer-modal-content { background: white; width: 100%; max-width: 600px; border-radius: 20px 20px 0 0; padding: 20px; max-height: 90vh; overflow-y: auto; }
            </style>
            <div id="customer-shop-view" class="view-section" style="display: none;">
                <div class="shop-header">
                    <button class="back-btn" onclick="document.getElementById('customer-shop-view').style.display='none';">← Back</button>
                    <h2 id="shop-store-title">Customer Ordering</h2>
                    <div style="width: 50px;"></div>
                </div>
                <div class="shop-container">
                    <div class="store-lookup-box" id="store-lookup-box">
                        <h3 style="margin-bottom: 10px; color: #1e293b;">Welcome!</h3>
                        <p style="font-size: 13px; color: #64748b; margin-bottom: 15px;">Enter the Store ID you want to shop from</p>
                        <input type="text" id="customer-store-input" placeholder="Store ID...">
                        <button onclick="loadCustomerStore()">Load Inventory 🔍</button>
                        <p id="lookup-error" style="color: #ef4444; font-size: 12px; margin-top: 10px; display: none;">Store not found. Please check the ID.</p>
                    </div>
                    <div id="customer-shop-inventory" style="display: none;">
                        <input type="text" class="search-bar" id="customer-search-input" placeholder="🔍 Search for a product..." oninput="filterCustomerProducts()">
                        <div class="shop-product-grid" id="customer-product-grid"></div>
                    </div>
                </div>
                <button class="floating-cart-btn" id="customer-cart-btn" onclick="openCustomerCart()">View Cart (0) - ₦0</button>
            </div>

            <!-- Cart Modal -->
            <div class="customer-modal" id="customer-cart-modal">
                <div class="customer-modal-content">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px;">
                        <h2 style="font-size: 18px; color: #1e293b; margin: 0;">Your Order</h2>
                        <button style="background: none; border: none; font-size: 20px; font-weight: bold; color: #64748b; cursor: pointer;" onclick="closeCustomerCart()">✕</button>
                    </div>
                    <div id="customer-cart-items" style="margin-bottom: 20px; max-height: 30vh; overflow-y: auto;"></div>
                    <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 16px; margin-bottom: 20px; padding-top: 10px; border-top: 1px solid #e2e8f0;">
                        <span>Total:</span>
                        <span id="customer-cart-total" style="color: #16a34a;">₦0</span>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; font-size: 12px; font-weight: bold; color: #475569; margin-bottom: 5px;">Your Name *</label>
                        <input type="text" id="customer-name-input" placeholder="e.g. John Doe" style="width: 100%; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px;">
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; font-size: 12px; font-weight: bold; color: #475569; margin-bottom: 5px;">Phone Number *</label>
                        <input type="tel" id="customer-phone-input" placeholder="e.g. 08012345678" style="width: 100%; padding: 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px;">
                    </div>
                    <button style="width: 100%; background: #0284c7; color: white; padding: 15px; border-radius: 10px; font-weight: bold; font-size: 16px; border: none; cursor: pointer; margin-top: 15px;" onclick="submitCustomerOrder()">Generate Tracking ID 🚀</button>
                </div>
            </div>

            <!-- Success Modal -->
            <div class="customer-modal" id="customer-success-modal">
                <div class="customer-modal-content" style="text-align: center; padding: 30px 20px;">
                    <div style="font-size: 50px; color: #16a34a; margin-bottom: 15px;">✅</div>
                    <h2 style="color: #1e293b; margin-bottom: 10px;">Order Reserved!</h2>
                    <p style="color: #64748b; font-size: 14px;">Please show this Tracking ID to the cashier when you arrive to collect your items.</p>
                    <div style="background: #f8fafc; border: 2px dashed #cbd5e1; padding: 20px; border-radius: 12px; margin: 20px 0;">
                        <div style="font-size: 12px; color: #64748b; margin-bottom: 5px; text-transform: uppercase;">Your Tracking ID</div>
                        <div id="customer-display-tracking-id" style="font-size: 28px; font-weight: 900; color: #0284c7; letter-spacing: 2px;">ORD-0000</div>
                    </div>
                    <p style="font-size: 13px; color: #ef4444; font-weight: bold;">Note: Payment will be made at the store.</p>
                    <button style="width: 100%; background: #64748b; color: white; padding: 15px; border-radius: 10px; font-weight: bold; font-size: 16px; border: none; cursor: pointer; margin-top: 20px;" onclick="window.location.reload()">Order Again</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', shopHTML);
    }

    // 2. Watchdog: Keep checking for the login box to inject the button
    let attempts = 0;
    const injectInterval = setInterval(() => {
        // Find the login card by looking for the Sign in button
        const authCard = document.querySelector('.auth-card') || document.body;
        const signInBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Sign in'));

        if (signInBtn && !document.getElementById('customer-shop-btn-injected')) {
            const shopBtn = document.createElement('button');
            shopBtn.id = 'customer-shop-btn-injected';
            shopBtn.className = 'menu-btn';
            // Styled to match your exact green outline button
            shopBtn.style = 'margin-top: 15px; background: #fef3c7; color: #b45309; border: 1px solid #fde68a; width: 100%; font-weight: bold; border-radius: 10px; padding: 15px; cursor: pointer; font-size: 14px;';
            shopBtn.innerHTML = '🛒 Shop as a Customer (Order Ahead)';
            
            shopBtn.onclick = function() {
                document.getElementById('customer-shop-view').style.display = 'block';
            };

            // Inject it right below the "Register New Business" button
            const regBtn = Array.from(document.querySelectorAll('button, a')).find(el => el.innerText.includes('Register New Business'));
            if (regBtn && regBtn.parentNode) {
                regBtn.parentNode.insertBefore(shopBtn, regBtn.nextSibling);
            } else {
                signInBtn.parentNode.insertBefore(shopBtn, signInBtn.nextSibling);
            }
        }

        attempts++;
        if (attempts > 30) clearInterval(injectInterval); // Stop checking after 15 seconds
    }, 500);
});

// --- CUSTOMER SHOP LOGIC ---
let customerShopStoreId = null;
let customerShopProducts = {};
let customerCart = [];

function loadCustomerStore() {
    const storeIdInput = document.getElementById('customer-store-input').value.trim().toLowerCase();
    const errorMsg = document.getElementById('lookup-error');
    
    if (!storeIdInput) { errorMsg.innerText = "Please enter a Store ID."; errorMsg.style.display = 'block'; return; }
    errorMsg.style.display = 'none';
    
    firebase.database().ref('stores/' + storeIdInput).once('value').then(snapshot => {
        const store = snapshot.val();
        document.getElementById('shop-store-title').innerText = store ? (store.businessName || store.name || storeIdInput.toUpperCase()) : storeIdInput.toUpperCase();
    });

    firebase.database().ref('inventory/' + storeIdInput).on('value', snapshot => {
        const data = snapshot.val();
        if (data) {
            customerShopStoreId = storeIdInput;
            const branchId = data['main'] ? 'main' : Object.keys(data)[0];
            if (branchId && data[branchId]) {
                customerShopProducts = data[branchId];
                document.getElementById('store-lookup-box').style.display = 'none';
                document.getElementById('customer-shop-inventory').style.display = 'block';
                renderCustomerProducts();
            } else { errorMsg.innerText = "This store has no inventory set up yet."; errorMsg.style.display = 'block'; }
        } else { errorMsg.innerText = "Store not found. Please check the ID and try again."; errorMsg.style.display = 'block'; }
    });
}

function renderCustomerProducts() {
    const grid = document.getElementById('customer-product-grid');
    grid.innerHTML = '';
    let count = 0;
    for (let id in customerShopProducts) {
        let p = customerShopProducts[id];
        let name = p.name || p.productName || 'Unknown Product';
        let price = p.price || p.retailPrice || 0;
        let stock = p.stock || 0;
        
        if (price > 0) {
            count++;
            let isOutOfStock = stock <= 0;
            grid.innerHTML += `
                <div class="shop-product-card" data-name="${name.toLowerCase()}">
                    <div>
                        <h3>${name}</h3>
                        <p>₦${Number(price).toLocaleString()}</p>
                        ${isOutOfStock ? '<span class="out-of-stock-label">❌ Out of Stock</span>' : ''}
                    </div>
                    <button class="add-to-cart-btn" ${isOutOfStock ? 'disabled' : ''} onclick="addCustomerToCart('${id}')">
                        ${isOutOfStock ? 'Unavailable' : 'Add to Cart'}
                    </button>
                </div>
            `;
        }
    }
    if (count === 0) { grid.innerHTML = "<p style='text-align:center; color:#64748b; grid-column: 1 / -1;'>No products available.</p>"; }
}

function filterCustomerProducts() {
    let query = document.getElementById('customer-search-input').value.toLowerCase();
    document.querySelectorAll('.shop-product-card').forEach(card => {
        card.style.display = card.getAttribute('data-name').includes(query) ? 'flex' : 'none';
    });
}

function addCustomerToCart(id) {
    let p = customerShopProducts[id];
    let existing = customerCart.find(item => item.id === id);
    if (existing) {
        if (existing.qty + 1 > (p.stock || 0)) { alert("Not enough stock."); return; }
        existing.qty += 1;
    } else {
        customerCart.push({ id: id, name: p.name || p.productName, price: p.price || p.retailPrice || 0, qty: 1 });
    }
    updateCustomerCartUI();
}

function updateCustomerCartUI() {
    let total = 0; let count = 0;
    customerCart.forEach(item => { total += (item.price * item.qty); count += item.qty; });

    let btn = document.getElementById('customer-cart-btn');
    if (count > 0) { btn.style.display = 'block'; btn.innerText = `View Cart (${count} items) - ₦${total.toLocaleString()}`; } else { btn.style.display = 'none'; }
    document.getElementById('customer-cart-total').innerText = `₦${total.toLocaleString()}`;

    let cartItemsDiv = document.getElementById('customer-cart-items');
    cartItemsDiv.innerHTML = customerCart.length === 0 ? "<p style='text-align:center; color:#64748b;'>Cart is empty.</p>" : '';
    customerCart.forEach(item => {
        cartItemsDiv.innerHTML += `<div style="display:flex; justify-content:space-between; margin-bottom:10px; font-size:14px;"><span>${item.qty}x ${item.name}</span><span>₦${(item.price * item.qty).toLocaleString()}</span></div>`;
    });
}

function openCustomerCart() { document.getElementById('customer-cart-modal').style.display = 'flex'; }
function closeCustomerCart() { document.getElementById('customer-cart-modal').style.display = 'none'; }

function submitCustomerOrder() {
    let name = document.getElementById('customer-name-input').value.trim();
    let phone = document.getElementById('customer-phone-input').value.trim();

    if (!name || !phone) { alert("Please enter your Name and Phone Number."); return; }
    if (customerCart.length === 0) { alert("Your cart is empty."); return; }

    let trackingId = 'ORD-' + Math.floor(1000 + Math.random() * 9000);
    let total = 0;
    customerCart.forEach(item => { total += (item.price * item.qty); });

    let orderData = { trackingId: trackingId, customerName: name, customerPhone: phone, items: customerCart, totalAmount: total, status: 'pending', createdAt: new Date().toISOString() };

    firebase.database().ref('online_orders/' + customerShopStoreId + '/' + trackingId).set(orderData)
    .then(() => {
        document.getElementById('customer-cart-modal').style.display = 'none';
        document.getElementById('customer-display-tracking-id').innerText = trackingId;
        document.getElementById('customer-success-modal').style.display = 'flex';
    })
    .catch(error => { alert("Error saving order: " + error.message); });
}
