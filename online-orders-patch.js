// online-orders-patch.js
window.addEventListener('load', function() {
    // Wait a moment for the main app to load
    setTimeout(() => {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        // 1. Add "Online Orders" button to the sidebar
        const logoutBtn = sidebar.querySelector('.btn-logout');
        const onlineOrdersBtn = document.createElement('button');
        onlineOrdersBtn.className = 'menu-btn btn-action-primary';
        onlineOrdersBtn.style = 'background: #f59e0b; color: #fff; margin-bottom: 10px; border: none;';
        onlineOrdersBtn.innerHTML = '🛍️ Online Orders';
        onlineOrdersBtn.onclick = openOnlineOrdersView;
        
        if (logoutBtn) {
            sidebar.insertBefore(onlineOrdersBtn, logoutBtn);
        } else {
            sidebar.appendChild(onlineOrdersBtn);
        }

        // 2. Inject the Modal for Viewing the Order
        const modalHTML = `
            <div id="online-order-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 2000; justify-content: center; align-items: center;">
                <div style="background: #fff; padding: 25px; border-radius: 12px; width: 100%; max-width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;">
                        <h3 style="margin: 0; color: #1e293b;">Order Details</h3>
                        <button onclick="document.getElementById('online-order-modal').style.display='none'" style="background: none; border: none; font-size: 20px; cursor: pointer; color: #64748b;">✕</button>
                    </div>
                    
                    <div id="oo-customer-info" style="background: #f8fafc; padding: 10px; border-radius: 8px; margin-bottom: 15px; font-size: 13px; color: #475569;">
                        <!-- Customer info goes here -->
                    </div>

                    <div style="max-height: 200px; overflow-y: auto; margin-bottom: 15px;">
                        <table style="width: 100%; font-size: 13px; text-align: left;">
                            <thead>
                                <tr style="border-bottom: 1px solid #eee; color: #64748b;">
                                    <th style="padding: 5px 0;">Item</th>
                                    <th style="padding: 5px 0; text-align: center;">Qty</th>
                                    <th style="padding: 5px 0; text-align: right;">Total</th>
                                </tr>
                            </thead>
                            <tbody id="oo-items-list">
                                <!-- Items go here -->
                            </tbody>
                        </table>
                    </div>

                    <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 16px; border-top: 2px solid #eee; padding-top: 10px; margin-bottom: 20px;">
                        <span>Total Amount:</span>
                        <span id="oo-total-amount" style="color: #16a34a;">₦0</span>
                    </div>

                    <div style="display: flex; gap: 10px;">
                        <button id="oo-complete-btn" style="flex: 1; background: #16a34a; color: white; padding: 12px; border-radius: 8px; border: none; font-weight: bold; cursor: pointer;">Accept Payment & Print</button>
                        <button id="oo-cancel-btn" style="flex: 1; background: #ef4444; color: white; padding: 12px; border-radius: 8px; border: none; font-weight: bold; cursor: pointer;">Reject Order</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

    }, 1000); // Wait 1 second for app to initialize
});

// 3. The function that asks for the Tracking ID
function openOnlineOrdersView() {
    const trackingId = prompt("Enter Customer Tracking ID (e.g. ORD-1234):");
    if (!trackingId) return;

    const cleanId = trackingId.trim().toUpperCase();
    const storeId = window.currentStoreId || localStorage.getItem('activeStoreId'); // Adjust based on your app's variable

    if (!storeId) {
        alert("Error: Cannot determine current store ID.");
        return;
    }

    // Fetch the order from Firebase
    firebase.database().ref(`online_orders/${storeId}/${cleanId}`).once('value').then(snapshot => {
        const order = snapshot.val();
        
        if (!order) {
            alert("Order not found! Please check the Tracking ID.");
            return;
        }

        if (order.status === 'completed') {
            alert("This order has already been processed and paid for.");
            return;
        }

        // Populate the modal with order details
        document.getElementById('oo-customer-info').innerHTML = `
            <strong>Tracking ID:</strong> ${order.trackingId}<br>
            <strong>Customer:</strong> ${order.customerName}<br>
            <strong>Phone:</strong> ${order.customerPhone}
        `;

        const tbody = document.getElementById('oo-items-list');
        tbody.innerHTML = '';
        let total = 0;

        order.items.forEach(item => {
            let lineTotal = item.price * item.qty;
            total += lineTotal;
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 8px 0;">${item.name}</td>
                    <td style="padding: 8px 0; text-align: center;">${item.qty}</td>
                    <td style="padding: 8px 0; text-align: right;">₦${lineTotal.toLocaleString()}</td>
                </tr>
            `;
        });

        document.getElementById('oo-total-amount').innerText = `₦${total.toLocaleString()}`;

        // Show the modal
        document.getElementById('online-order-modal').style.display = 'flex';

        // Handle the "Accept Payment" button click
        document.getElementById('oo-complete-btn').onclick = function() {
            if (confirm("Confirm payment collected and print receipt?")) {
                // Mark as completed in Firebase
                firebase.database().ref(`online_orders/${storeId}/${cleanId}/status`).set('completed')
                .then(() => {
                    document.getElementById('online-order-modal').style.display = 'none';
                    
                    // Trigger your existing receipt print logic!
                    // Note: You might need to adjust these variables based on what your print function expects
                    if (typeof window.printCustomReceipt === 'function') {
                        window.printCustomReceipt(order.items, total, "Online Pickup");
                    } else {
                        alert("Payment recorded! Please use the standard POS receipt to print if needed.");
                        // Fallback: manually inject into cart if you want to use the existing POS flow
                    }
                });
            }
        };

        // Handle Reject button
        document.getElementById('oo-cancel-btn').onclick = function() {
            if (confirm("Are you sure you want to reject this order?")) {
                firebase.database().ref(`online_orders/${storeId}/${cleanId}/status`).set('rejected').then(() => {
                    document.getElementById('online-order-modal').style.display = 'none';
                    alert("Order rejected.");
                });
            }
        };

    }).catch(err => {
        alert("Database Error: " + err.message);
    });
}
