document.addEventListener('DOMContentLoaded', () => {
    const customerForm = document.getElementById('customerForm');
    const customerList = document.getElementById('customerList');
    const customerCount = document.getElementById('customerCount');
    const emptyState = document.getElementById('emptyState');
    const tableContainer = document.querySelector('.table-container');

    // Modal elements
    const addPawnModal = document.getElementById('addPawnModal');
    const viewPawnModal = document.getElementById('viewPawnModal');
    const paymentModal = document.getElementById('paymentModal');
    const cardReceiptModal = document.getElementById('cardReceiptModal');
    const closeAddPawn = document.getElementById('closeAddPawn');
    const closeViewPawn = document.getElementById('closeViewPawn');
    const closePayment = document.getElementById('closePayment');
    const closeCardReceipt = document.getElementById('closeCardReceipt');
    const addPawnForm = document.getElementById('addPawnForm');
    const paymentForm = document.getElementById('paymentForm');
    const cardReceiptForm = document.getElementById('cardReceiptForm');
    const meltForm = document.getElementById('meltForm');
    const savePrintCardBtn = document.getElementById('savePrintCardBtn');
    
    // Navigation & Rokad Elements
    const navDashboardBtn = document.getElementById('navDashboardBtn');
    const navRokadBtn = document.getElementById('navRokadBtn');
    const navAnalyticsBtn = document.getElementById('navAnalyticsBtn');
    const dashboardView = document.getElementById('dashboardView');
    const rokadView = document.getElementById('rokadView');
    const analyticsView = document.getElementById('analyticsView');
    
    // Analytics Elements
    const analyticsStartDate = document.getElementById('analyticsStartDate');
    const analyticsEndDate = document.getElementById('analyticsEndDate');
    const fetchAnalyticsBtn = document.getElementById('fetchAnalyticsBtn');
    const downloadAnalyticsBtn = document.getElementById('downloadAnalyticsBtn');
    const analyticsTotalJama = document.getElementById('analyticsTotalJama');
    const analyticsTotalNaame = document.getElementById('analyticsTotalNaame');
    const analyticsNetFlow = document.getElementById('analyticsNetFlow');
    let analyticsChartInstance = null;
    
    const rokadDateInput = document.getElementById('rokadDateInput');
    const fetchRokadBtn = document.getElementById('fetchRokadBtn');
    const downloadRokadBtn = document.getElementById('downloadRokadBtn');
    const rokadJamaList = document.getElementById('rokadJamaList');
    const rokadNaameList = document.getElementById('rokadNaameList');
    const rokadTotalJama = document.getElementById('rokadTotalJama');
    const rokadTotalNaame = document.getElementById('rokadTotalNaame');
    const rokadNetFlow = document.getElementById('rokadNetFlow');

    const pawnCustomerIdInput = document.getElementById('pawnCustomerId');
    const payPawnIdInput = document.getElementById('payPawnId');
    const viewPawnCustomerName = document.getElementById('viewPawnCustomerName');
    const pawnList = document.getElementById('pawnList');
    const paymentHistoryList = document.getElementById('paymentHistoryList');
    const pawnEmptyState = document.getElementById('pawnEmptyState');
    const pawnTable = document.getElementById('pawnTable');

    // Dashboard & Overdue
    const dashTotalPrincipal = document.getElementById('dashTotalPrincipal');
    const dashTotalInterest = document.getElementById('dashTotalInterest');
    const dashTotalReleased = document.getElementById('dashTotalReleased');
    const overdueList = document.getElementById('overdueList');
    const overdueCount = document.getElementById('overdueCount');
    const overdueEmptyState = document.getElementById('overdueEmptyState');
    const customerSearch = document.getElementById('customerSearch');
    
    // Risk & Rates
    const dashGoldRate = document.getElementById('dashGoldRate');
    const saveGoldRateBtn = document.getElementById('saveGoldRateBtn');
    const dashSilverRate = document.getElementById('dashSilverRate');
    const saveSilverRateBtn = document.getElementById('saveSilverRateBtn');
    const highRiskList = document.getElementById('highRiskList');
    const highRiskCount = document.getElementById('highRiskCount');
    const highRiskEmptyState = document.getElementById('highRiskEmptyState');

    // API Base URL
    const API_URL = '/api';

    let customers = [];
    let filteredCustomers = [];
    let currentRole = localStorage.getItem('user_role') || 'admin';

    // Role Switcher Element Refs
    const roleIndicator = document.getElementById('roleIndicator');
    const switchRoleBtn = document.getElementById('switchRoleBtn');
    const pendingApprovalsBox = document.getElementById('pendingApprovalsBox');
    const pendingApprovalsCount = document.getElementById('pendingApprovalsCount');
    const pendingApprovalsList = document.getElementById('pendingApprovalsList');
    const pendingApprovalsEmptyState = document.getElementById('pendingApprovalsEmptyState');
    const kpiCardsWrap = document.getElementById('kpiCardsWrap');

    function updateRoleUI() {
        if (roleIndicator) roleIndicator.textContent = currentRole === 'admin' ? '👑 Mode: Admin Owner' : '👨‍💼 Mode: Staff Counter';
        if (switchRoleBtn) switchRoleBtn.textContent = currentRole === 'admin' ? 'Switch to Staff' : 'Switch to Admin';

        const highRiskBox = document.querySelector('.high-risk-box');
        const overdueBox = document.querySelector('.overdue-box');
        const navInterestLedgerBtn = document.getElementById('navInterestLedgerBtn');

        if (currentRole === 'staff') {
            if (kpiCardsWrap) kpiCardsWrap.style.display = 'none';
            if (pendingApprovalsBox) pendingApprovalsBox.style.display = 'none';
            if (highRiskBox) highRiskBox.style.display = 'none';
            if (overdueBox) overdueBox.style.display = 'none';
            if (navInterestLedgerBtn) navInterestLedgerBtn.style.display = 'none';
            
            // Hide delete buttons in staff mode
            document.querySelectorAll('.delete-btn').forEach(btn => btn.style.display = 'none');
        } else {
            if (kpiCardsWrap) kpiCardsWrap.style.display = 'grid';
            if (pendingApprovalsBox) pendingApprovalsBox.style.display = 'block';
            if (highRiskBox) highRiskBox.style.display = 'block';
            if (overdueBox) overdueBox.style.display = 'block';
            if (navInterestLedgerBtn) navInterestLedgerBtn.style.display = 'inline-flex';

            // Show delete buttons in admin mode
            document.querySelectorAll('.delete-btn').forEach(btn => btn.style.display = 'inline-block');
            fetchPendingApprovals();
        }
    }

    if (switchRoleBtn) {
        switchRoleBtn.onclick = () => {
            if (currentRole === 'admin') {
                currentRole = 'staff';
                localStorage.setItem('user_role', 'staff');
                updateRoleUI();
                alert('👨‍💼 Switched to Staff Counter Mode!\nEntries will now go to Admin Approval Queue before updating database.');
            } else {
                const pin = prompt('🔑 Enter Master Security PIN to switch to Admin Owner Mode:');
                if (pin && pin.trim() === '121965') {
                    currentRole = 'admin';
                    localStorage.setItem('user_role', 'admin');
                    updateRoleUI();
                    alert('👑 Switched to Admin Owner Mode!');
                } else {
                    alert('❌ Incorrect Security PIN! Access denied.');
                }
            }
        };
    }

    // Fetch and render pending approvals for Admin
    async function fetchPendingApprovals() {
        if (currentRole !== 'admin' || !pendingApprovalsList) return;
        try {
            const res = await fetch(`${API_URL}/admin/pending`);
            const data = await res.json();
            const list = data.pending || [];

            if (pendingApprovalsCount) pendingApprovalsCount.textContent = list.length;

            if (list.length === 0) {
                if (pendingApprovalsEmptyState) pendingApprovalsEmptyState.style.display = 'block';
                if (pendingApprovalsList.parentElement) pendingApprovalsList.parentElement.style.display = 'none';
            } else {
                if (pendingApprovalsEmptyState) pendingApprovalsEmptyState.style.display = 'none';
                if (pendingApprovalsList.parentElement) pendingApprovalsList.parentElement.style.display = 'block';

                pendingApprovalsList.innerHTML = list.map(r => {
                    const d = r.data || {};
                    let desc = '';
                    let badge = '';

                    if (r.type === 'NEW_CUSTOMER') {
                        badge = '<span class="badge" style="background:#e0e7ff; color:#3730a3;">👤 New Customer</span>';
                        desc = `Name: <strong>${escapeHtml(d.name)}</strong> | Phone: ${escapeHtml(d.phone)}`;
                    } else if (r.type === 'ADD_PAWN') {
                        badge = '<span class="badge" style="background:#fef3c7; color:#92400e;">📦 New Gehna</span>';
                        desc = `Item: <strong>${escapeHtml(d.description)}</strong> | Amount: ₹${d.amount} | Weight: ${d.item_weight_grams || 0}g (${d.item_metal_type || 'Gold'})`;
                    } else if (r.type === 'RECEIVE_PAYMENT') {
                        badge = '<span class="badge" style="background:#dcfce7; color:#15803d;">💰 Receive Payment</span>';
                        desc = `Amount: <strong>₹${d.amount}</strong> | Type: ${escapeHtml(d.payment_type)}`;
                    }

                    return `
                    <tr>
                        <td style="vertical-align: top;"><small>${formatDate(r.created_at)}</small><br><strong>${escapeHtml(r.staff_name || 'Staff')}</strong></td>
                        <td style="vertical-align: top;">${badge}</td>
                        <td style="vertical-align: top; font-size:0.9rem;">${desc}</td>
                        <td style="vertical-align: top; text-align: right; min-width: 140px;">
                            <button class="btn-approve btn-primary" data-id="${r.id}" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; background: var(--success); width: auto;">✅ Approve</button>
                            <button class="btn-reject btn-primary" data-id="${r.id}" style="padding: 0.4rem 0.75rem; font-size: 0.8rem; background: var(--error); width: auto; margin-left: 0.3rem;">❌ Reject</button>
                        </td>
                    </tr>
                    `;
                }).join('');
            }
        } catch (err) {
            console.error('Error fetching pending approvals:', err);
        }
    }

    if (pendingApprovalsList) {
        pendingApprovalsList.addEventListener('click', async (e) => {
            if (e.target.classList.contains('btn-approve')) {
                const id = e.target.getAttribute('data-id');
                try {
                    const res = await fetch(`${API_URL}/admin/approve/${id}`, { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Approval failed');
                    alert('✅ ' + data.message);
                    fetchCustomers();
                    fetchDashboard();
                    fetchPendingApprovals();
                } catch (err) {
                    alert('❌ Error: ' + err.message);
                }
            }

            if (e.target.classList.contains('btn-reject')) {
                const id = e.target.getAttribute('data-id');
                try {
                    const res = await fetch(`${API_URL}/admin/reject/${id}`, { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Rejection failed');
                    alert('❌ Request rejected.');
                    fetchPendingApprovals();
                } catch (err) {
                    alert('❌ Error: ' + err.message);
                }
            }
        });
    }

    // Initialize UI by fetching from database
    fetchCustomers();
    fetchDashboard();
    updateRoleUI();

    // Set default date for Rokad
    if (rokadDateInput) rokadDateInput.valueAsDate = new Date();

    // Set default dates for Analytics (Last 30 days)
    if (analyticsStartDate && analyticsEndDate) {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        analyticsEndDate.valueAsDate = end;
        analyticsStartDate.valueAsDate = start;
    }

    // Helper function for mutually exclusive view switching
    function hideAllViews() {
        if (dashboardView) dashboardView.style.display = 'none';
        if (rokadView) rokadView.style.display = 'none';
        if (analyticsView) analyticsView.style.display = 'none';
        const khaataViewEl = document.getElementById('khaataView');
        if (khaataViewEl) khaataViewEl.style.display = 'none';
        const recoveryViewEl = document.getElementById('recoveryView');
        if (recoveryViewEl) recoveryViewEl.style.display = 'none';

        if (navDashboardBtn) navDashboardBtn.classList.remove('active-tab');
        if (navRokadBtn) navRokadBtn.classList.remove('active-tab');
        if (navAnalyticsBtn) navAnalyticsBtn.classList.remove('active-tab');
        const navKhaataBtnEl = document.getElementById('navKhaataBtn');
        if (navKhaataBtnEl) navKhaataBtnEl.classList.remove('active-tab');
        const navRecoveryBtnEl = document.getElementById('navRecoveryBtn');
        if (navRecoveryBtnEl) navRecoveryBtnEl.classList.remove('active-tab');
    }

    // Navigation Logic
    if (navDashboardBtn) {
        navDashboardBtn.addEventListener('click', () => {
            hideAllViews();
            dashboardView.style.display = 'block';
            navDashboardBtn.classList.add('active-tab');
        });
    }

    if (navRokadBtn) {
        navRokadBtn.addEventListener('click', () => {
            hideAllViews();
            rokadView.style.display = 'block';
            navRokadBtn.classList.add('active-tab');
            fetchRokad(rokadDateInput.value);
        });
    }
    
    if (navAnalyticsBtn) {
        navAnalyticsBtn.addEventListener('click', () => {
            hideAllViews();
            if (analyticsView) analyticsView.style.display = 'block';
            if (navAnalyticsBtn) navAnalyticsBtn.classList.add('active-tab');
            fetchAnalytics(analyticsStartDate.value, analyticsEndDate.value);
        });
    }

    const navKhaataBtn = document.getElementById('navKhaataBtn');
    const khaataView = document.getElementById('khaataView');
    if (navKhaataBtn && khaataView) {
        navKhaataBtn.addEventListener('click', () => {
            hideAllViews();
            khaataView.style.display = 'block';
            navKhaataBtn.classList.add('active-tab');
            
            const khaataCustomerSearch = document.getElementById('khaataCustomerSearch');
            if (khaataCustomerSearch) khaataCustomerSearch.focus();
        });
    }

    if (fetchRokadBtn) {
        fetchRokadBtn.addEventListener('click', () => {
            fetchRokad(rokadDateInput.value);
        });
    }

    if (fetchAnalyticsBtn) {
        fetchAnalyticsBtn.addEventListener('click', () => {
            fetchAnalytics(analyticsStartDate.value, analyticsEndDate.value);
        });
    }

    if (downloadRokadBtn) {
        downloadRokadBtn.addEventListener('click', () => {
            if (rokadDateInput.value) {
                window.location.href = `${API_URL}/reports/export?startDate=${rokadDateInput.value}&endDate=${rokadDateInput.value}`;
            }
        });
    }

    if (downloadAnalyticsBtn) {
        downloadAnalyticsBtn.addEventListener('click', () => {
            if (analyticsStartDate.value && analyticsEndDate.value) {
                window.location.href = `${API_URL}/reports/export?startDate=${analyticsStartDate.value}&endDate=${analyticsEndDate.value}`;
            }
        });
    }

    async function fetchAnalytics(startDate, endDate) {
        try {
            const response = await fetch(`${API_URL}/reports/analytics?startDate=${startDate}&endDate=${endDate}`);
            const data = await response.json();
            
            // Generate full date range array to ensure all days are plotted even if 0
            const start = new Date(startDate);
            const end = new Date(endDate);
            const labels = [];
            const jamaData = [];
            const naameData = [];
            let totalJama = 0;
            let totalNaame = 0;
            
            // Create maps for quick lookup
            const jamaMap = {};
            const naameMap = {};
            if (data.jama) data.jama.forEach(d => jamaMap[d.day] = d.total);
            if (data.naame) data.naame.forEach(d => naameMap[d.day] = d.total);

            // Loop through each day in range
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dayStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
                // Short date format for x-axis
                const displayDate = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                labels.push(displayDate);
                
                const j = jamaMap[dayStr] || 0;
                const n = naameMap[dayStr] || 0;
                
                jamaData.push(j);
                naameData.push(n);
                
                totalJama += j;
                totalNaame += n;
            }

            // Update Summary Cards
            if (analyticsTotalJama) analyticsTotalJama.innerText = '₹' + totalJama.toLocaleString('en-IN');
            if (analyticsTotalNaame) analyticsTotalNaame.innerText = '₹' + totalNaame.toLocaleString('en-IN');
            if (analyticsNetFlow) {
                const net = totalJama - totalNaame;
                analyticsNetFlow.innerText = (net >= 0 ? '+' : '') + '₹' + net.toLocaleString('en-IN');
                analyticsNetFlow.style.color = net >= 0 ? 'var(--success)' : 'var(--error)';
            }

            // Draw Chart
            const ctx = document.getElementById('analyticsChart');
            if (!ctx) return;

            if (analyticsChartInstance) {
                analyticsChartInstance.destroy();
            }

            analyticsChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'Money In (Jama)',
                            data: jamaData,
                            borderColor: '#10b981', // var(--success)
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: 'Money Out (Naame)',
                            data: naameData,
                            borderColor: '#ef4444', // var(--error)
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            borderWidth: 2,
                            tension: 0.3,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'index',
                        intersect: false,
                    },
                    plugins: {
                        legend: { position: 'top' },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
                                        label += '₹' + context.parsed.y.toLocaleString('en-IN');
                                    }
                                    return label;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return '₹' + value.toLocaleString('en-IN');
                                }
                            }
                        }
                    }
                }
            });

            // Populate Breakdown Table
            const tbody = document.getElementById('analyticsTableBody');
            if (tbody) {
                // We will populate in reverse order (newest first)
                let tableHtml = '';
                // labels, jamaData, naameData are arrays of the same length
                for (let i = labels.length - 1; i >= 0; i--) {
                    const jama = jamaData[i];
                    const naame = naameData[i];
                    if (jama === 0 && naame === 0) continue; // Skip empty days for cleaner table
                    
                    const net = jama - naame;
                    const netColor = net >= 0 ? 'var(--success)' : 'var(--error)';
                    const netPrefix = net > 0 ? '+' : '';
                    
                    tableHtml += `
                        <tr>
                            <td><strong>${labels[i]}</strong></td>
                            <td style="color: var(--success); text-align: right; font-weight: bold;">₹${jama.toLocaleString('en-IN')}</td>
                            <td style="color: var(--error); text-align: right; font-weight: bold;">₹${naame.toLocaleString('en-IN')}</td>
                            <td style="color: ${netColor}; text-align: right; font-weight: bold;">${netPrefix}₹${net.toLocaleString('en-IN')}</td>
                        </tr>
                    `;
                }
                
                if (!tableHtml) {
                    tableHtml = '<tr><td colspan="4" style="text-align: center; color: var(--text-secondary);">No transactions in this period.</td></tr>';
                }
                
                tbody.innerHTML = tableHtml;
            }

        } catch (error) {
            console.error('Error fetching analytics:', error);
        }
    }

    async function fetchRokad(dateStr) {
        if (!dateStr) return;
        try {
            rokadJamaList.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
            rokadNaameList.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
            
            const response = await fetch(`${API_URL}/reports/rokad?date=${dateStr}`);
            const data = await response.json();
            
            // Render Naame (Right / New Pawns)
            if (data.newPawns && data.newPawns.length > 0) {
                rokadNaameList.innerHTML = data.newPawns.map(p => `
                    <tr>
                        <td><strong>${escapeHtml(p.customer_name)}</strong></td>
                        <td>${escapeHtml(p.description)}</td>
                        <td style="text-align:right; font-weight:bold; color:var(--error);">₹${parseFloat(p.amount).toFixed(0)}</td>
                    </tr>
                `).join('');
            } else {
                rokadNaameList.innerHTML = '<tr><td colspan="3" style="text-align:center; color:gray;">No items kept today.</td></tr>';
            }
            rokadTotalNaame.innerText = '₹' + (data.totalNaame || 0).toLocaleString('en-IN');

            // Render Jama (Left / Released & Payments)
            let jamaRows = [];
            if (data.releasedPawns) {
                jamaRows = jamaRows.concat(data.releasedPawns.map(p => `
                    <tr>
                        <td><strong>${escapeHtml(p.customer_name)}</strong></td>
                        <td>${escapeHtml(p.description)} <br><span class="badge" style="background:#d1fae5; color:#059669; font-size:0.7rem;">Released (Interest: ₹${parseFloat(p.calculated_interest).toFixed(0)})</span></td>
                        <td style="text-align:right; font-weight:bold; color:var(--success);">₹${parseFloat(p.final_collection).toFixed(0)}</td>
                    </tr>
                `));
            }
            if (data.payments) {
                jamaRows = jamaRows.concat(data.payments.map(p => `
                    <tr>
                        <td><strong>${escapeHtml(p.customer_name)}</strong></td>
                        <td>${escapeHtml(p.payment_type || 'Partial Payment')} <br><span class="badge" style="background:#fef08a; color:#854d0e; font-size:0.7rem;">Note: Partial Payment</span></td>
                        <td style="text-align:right; font-weight:bold; color:var(--success);">₹${parseFloat(p.amount).toFixed(0)}</td>
                    </tr>
                `));
            }
            
            if (jamaRows.length > 0) {
                rokadJamaList.innerHTML = jamaRows.join('');
            } else {
                rokadJamaList.innerHTML = '<tr><td colspan="3" style="text-align:center; color:gray;">No collections today.</td></tr>';
            }
            rokadTotalJama.innerText = '₹' + (data.totalJama || 0).toLocaleString('en-IN');

            // Net Flow
            const netFlow = (data.totalJama || 0) - (data.totalNaame || 0);
            rokadNetFlow.innerText = (netFlow >= 0 ? '+' : '') + '₹' + netFlow.toLocaleString('en-IN');
            rokadNetFlow.style.color = netFlow >= 0 ? 'var(--success)' : 'var(--error)';

        } catch (error) {
            console.error('Error fetching rokad:', error);
            rokadJamaList.innerHTML = '<tr><td colspan="3" style="color:red;">Error loading data</td></tr>';
            rokadNaameList.innerHTML = '<tr><td colspan="3" style="color:red;">Error loading data</td></tr>';
        }
    }

    // Handle form submission
    customerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('name').value.trim();
        const phone = document.getElementById('phone').value.trim();
        const email = document.getElementById('email').value.trim();
        const dob = document.getElementById('dob').value;

        if (currentRole === 'staff') {
            try {
                const response = await fetch(`${API_URL}/staff/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'NEW_CUSTOMER',
                        staff_name: 'Staff Counter',
                        data: { name, phone, email, dob }
                    })
                });
                if (!response.ok) {
                    throw new Error(`Server Status ${response.status}: Kripya terminal me server (npm start) ko restart karein!`);
                }
                const data = await response.json();
                alert('🚨 ' + data.message);
                customerForm.reset();
                return;
            } catch (err) {
                console.error(err);
                alert(`⚠️ Error: ${err.message || 'Failed to submit entry.'}\n\nKripya terminal me Ctrl+C karke 'npm start' ko restart karein.`);
                return;
            }
        }

        // Use FormData to support file uploads
        const formData = new FormData();
        formData.append('name', name);
        formData.append('phone', phone);
        formData.append('email', email);
        formData.append('dob', dob);
        
        const aadharFile = document.getElementById('aadharPhoto').files[0];
        if (aadharFile) {
            formData.append('aadhar_photo', aadharFile);
        }

        try {
            // Save to database
            const response = await fetch(`${API_URL}/customers`, {
                method: 'POST',
                body: formData // No Content-Type header needed, browser sets multipart/form-data
            });

            if (!response.ok) throw new Error('Failed to save customer');
            const data = await response.json();
            
            // Re-fetch and update UI
            await fetchCustomers();
            
            // Reset form
            customerForm.reset();
            document.getElementById('name').focus();

            if (data.password) {
                if (confirm(`✅ Customer Added Successfully!\n\n📱 Phone: ${data.username}\n🔑 Secret 6-Digit PIN: ${data.password}\n\nDo you want to send login details to customer on WhatsApp?`)) {
                    sendCustomerCredentials(data.name || formData.get('name'), data.phone || formData.get('phone'), data.password);
                }
            }
        } catch (error) {
            console.error('Error adding customer:', error);
            alert('Failed to save customer record. Check console for details.');
        }
    });

    // Handle button clicks in customer table (using event delegation)
    customerList.addEventListener('click', async (e) => {
        // Delete Customer (Protected with PIN)
        if (e.target.classList.contains('delete-btn')) {
            const id = e.target.getAttribute('data-id');
            const pin = prompt('🔒 Is customer record ko delete karne ke liye Master Security PIN daalein:');
            
            if (pin === null) return; // User pressed Cancel
            if (!pin.trim()) {
                alert('⚠️ Security PIN daalna zaruri hai.');
                return;
            }

            try {
                const response = await fetch(`${API_URL}/customers/${id}`, {
                    method: 'DELETE',
                    headers: {
                        'x-delete-pin': pin.trim()
                    }
                });
                
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.error || 'Failed to delete customer record.');
                }
                
                alert('✅ Record safaltapoorvak delete ho gaya.');
                await fetchCustomers();
            } catch (error) {
                console.error('Error deleting customer:', error);
                alert(`❌ ${error.message}`);
            }
        }
        
        // Send Credentials on WhatsApp
        if (e.target.classList.contains('send-cred-btn')) {
            const name = e.target.getAttribute('data-name');
            const phone = e.target.getAttribute('data-phone');
            const pin = e.target.getAttribute('data-pin');
            
            fetch(`${API_URL}/system/common-qr`).then(res => res.json()).then(sysData => {
                let host = window.location.host;
                if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && sysData.server_ip && sysData.server_ip !== 'localhost') {
                    host = `${sysData.server_ip}:${sysData.port || 3001}`;
                }
                const portalUrl = `${window.location.protocol}//${host}/portal.html`;
                const msg = `Namaste ${name} Ji,\nYour *LJS Jewellers* Customer Portal Login Details:\n\n📱 Username: ${phone}\n🔑 Secret PIN: ${pin}\n\nPortal Link: ${portalUrl}\n\nYou can scan our Counter QR Code or use the link above to log in & view your live Gehna & Byaaj ledger.\n\nThank you!`;
                let cleanNumber = (phone || '').replace(/[^0-9]/g, '');
                if (cleanNumber.length === 10) cleanNumber = '91' + cleanNumber;
                window.open(`https://wa.me/${cleanNumber}?text=${encodeURIComponent(msg)}`, '_blank');
            }).catch(err => console.error(err));
            return;
        }

        // Open QR Passbook Modal
        if (e.target.classList.contains('qr-pass-btn')) {
            const id = e.target.getAttribute('data-id');
            openQrPassModal(id);
            return;
        }

        // Open Card Receipt Modal
        if (e.target.classList.contains('card-receipt-btn')) {
            const id = e.target.getAttribute('data-id');
            const name = e.target.getAttribute('data-name');
            const phone = e.target.getAttribute('data-phone');
            
            document.getElementById('cardCustomerId').value = id;
            document.getElementById('cardCustomerName').textContent = name;
            document.getElementById('cardCustomerPhone').textContent = phone;
            document.getElementById('cardDate').valueAsDate = new Date();
            document.getElementById('cardDescription').value = '';
            document.getElementById('cardWeight').value = '';
            document.getElementById('cardAmount').value = '';
            
            cardReceiptModal.style.display = 'block';
            return;
        }
        
        // Open Add Pawn Modal
        if (e.target.classList.contains('pawn-btn')) {
            const id = e.target.getAttribute('data-id');
            pawnCustomerIdInput.value = id;
            addPawnModal.style.display = 'block';
            return;
        }
        
        // Customer Name or Open Khaata Button Click
        if (e.target.classList.contains('customer-name-link') || e.target.classList.contains('view-khaata-btn')) {
            const id = e.target.getAttribute('data-id');
            openCustomerKhaata(id);
            return;
        }
    });

    // Handle Search
    customerSearch.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(term));
        renderCustomers();
    });

    // Close Modals
    closeAddPawn.onclick = () => addPawnModal.style.display = 'none';
    closeViewPawn.onclick = () => viewPawnModal.style.display = 'none';
    closePayment.onclick = () => paymentModal.style.display = 'none';
    closeCardReceipt.onclick = () => cardReceiptModal.style.display = 'none';
    const closeMeltModal = document.getElementById('closeMeltModal');
    const meltModal = document.getElementById('meltModal');
    const customerQrModal = document.getElementById('customerQrModal');
    const closeCustomerQr = document.getElementById('closeCustomerQr');
    const commonQrModal = document.getElementById('commonQrModal');
    const closeCommonQr = document.getElementById('closeCommonQr');
    if (closeMeltModal) closeMeltModal.onclick = () => meltModal.style.display = 'none';
    if (closeCustomerQr) closeCustomerQr.onclick = () => customerQrModal.style.display = 'none';
    if (closeCommonQr) closeCommonQr.onclick = () => commonQrModal.style.display = 'none';

    window.onclick = (event) => {
        if (event.target === addPawnModal) addPawnModal.style.display = 'none';
        if (event.target === viewPawnModal) viewPawnModal.style.display = 'none';
        if (event.target === paymentModal) paymentModal.style.display = 'none';
        if (event.target === cardReceiptModal) cardReceiptModal.style.display = 'none';
        if (meltModal && event.target === meltModal) meltModal.style.display = 'none';
        if (customerQrModal && event.target === customerQrModal) customerQrModal.style.display = 'none';
        if (commonQrModal && event.target === commonQrModal) commonQrModal.style.display = 'none';
        const quickKhaataModal = document.getElementById('quickKhaataModal');
        if (quickKhaataModal && event.target === quickKhaataModal) quickKhaataModal.style.display = 'none';
    };

    // Save Gold Rate
    saveGoldRateBtn.addEventListener('click', async () => {
        const rate = dashGoldRate.value;
        if (!rate) return;
        try {
            await fetch(`${API_URL}/settings/rate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'gold_rate', rate })
            });
            alert('Gold rate saved!');
            fetchDashboard();
        } catch (e) {
            console.error('Error saving gold rate', e);
        }
    });

    // Save Silver Rate
    saveSilverRateBtn.addEventListener('click', async () => {
        const rate = dashSilverRate.value;
        if (!rate) return;
        try {
            await fetch(`${API_URL}/settings/rate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'silver_rate', rate })
            });
            alert('Silver rate saved!');
            fetchDashboard();
        } catch (e) {
            console.error('Error saving silver rate', e);
        }
    });

    const pawnIsUdhari = document.getElementById('pawnIsUdhari');
    const pawnItemDetailsGroup = document.getElementById('pawnItemDetailsGroup');
    const pawnDescription = document.getElementById('pawnDescription');
    const itemWeight = document.getElementById('itemWeight');

    if (pawnIsUdhari) {
        pawnIsUdhari.addEventListener('change', (e) => {
            if (e.target.checked) {
                pawnItemDetailsGroup.style.display = 'none';
                pawnDescription.value = 'Unsecured Udhari';
                itemWeight.removeAttribute('required');
            } else {
                pawnItemDetailsGroup.style.display = 'block';
                pawnDescription.value = '';
                itemWeight.setAttribute('required', 'required');
            }
        });
    }

    // Handle Add Pawn form submission
    addPawnForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = pawnCustomerIdInput.value;

        if (currentRole === 'staff') {
            try {
                const amount = document.getElementById('pawnAmount').value;
                const description = document.getElementById('pawnDescription').value;
                const item_weight_grams = document.getElementById('itemWeight').value;
                const item_metal_type = document.getElementById('itemMetalType').value;
                const interest_rate = document.getElementById('pawnInterestRate').value;
                const is_udhari = pawnIsUdhari ? pawnIsUdhari.checked : false;

                const response = await fetch(`${API_URL}/staff/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'ADD_PAWN',
                        staff_name: 'Staff Counter',
                        data: { customer_id: id, amount, description, item_weight_grams, item_metal_type, interest_rate, is_udhari }
                    })
                });
                if (!response.ok) {
                    throw new Error(`Server Status ${response.status}: Kripya terminal me server (npm start) ko restart karein!`);
                }
                const data = await response.json();
                alert('🚨 ' + data.message);
                addPawnForm.reset();
                addPawnModal.style.display = 'none';
                return;
            } catch (err) {
                console.error(err);
                alert(`⚠️ Error: ${err.message || 'Failed to submit entry.'}\n\nKripya terminal me Ctrl+C karke 'npm start' ko restart karein.`);
                return;
            }
        }
        
        const formData = new FormData();
        formData.append('amount', document.getElementById('pawnAmount').value);
        formData.append('description', document.getElementById('pawnDescription').value);
        formData.append('item_weight_grams', document.getElementById('itemWeight').value);
        formData.append('item_metal_type', document.getElementById('itemMetalType').value);
        formData.append('interest_rate', document.getElementById('pawnInterestRate').value);
        const pawnLockerInput = document.getElementById('pawnLockerLocation');
        if (pawnLockerInput && pawnLockerInput.value) {
            formData.append('locker_location', pawnLockerInput.value.trim());
        }

        const itemFile = document.getElementById('itemPhoto').files[0];
        if (itemFile) {
            formData.append('item_photo', itemFile);
        }

        try {
            const response = await fetch(`${API_URL}/customers/${id}/pawn`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Failed to save pawn receipt');
            
            addPawnForm.reset();
            document.getElementById('pawnInterestRate').value = "2"; // reset default
            document.getElementById('itemWeight').value = "";
            addPawnModal.style.display = 'none';
            alert('Receipt saved successfully!');
            fetchDashboard(); // Update Dashboard stats
        } catch (error) {
            console.error('Error adding pawn:', error);
            alert('Failed to save receipt.');
        }
    });

    // Handle Card Receipt Save & Print
    savePrintCardBtn.addEventListener('click', async () => {
        const id = document.getElementById('cardCustomerId').value;
        const amount = document.getElementById('cardAmount').value;
        const description = document.getElementById('cardDescription').value;
        const interest_rate = document.getElementById('cardRate').value;
        const item_weight_grams = document.getElementById('cardWeight').value;
        const item_metal_type = document.getElementById('cardMetal').value;
        const date_added = document.getElementById('cardDate').value;

        if (!amount || !description || !date_added) {
            alert('Please fill the required fields (Date, Description, Amount).');
            return;
        }

        const formData = new FormData();
        formData.append('amount', amount);
        formData.append('description', description);
        formData.append('interest_rate', interest_rate);
        formData.append('item_weight_grams', item_weight_grams);
        formData.append('item_metal_type', item_metal_type);

        const cardLockerInput = document.getElementById('cardLockerLocation');
        if (cardLockerInput && cardLockerInput.value) {
            formData.append('locker_location', cardLockerInput.value.trim());
        }

        try {
            const response = await fetch(`${API_URL}/customers/${id}/pawn`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('Failed to save pawn receipt');
            
            // Print the card specifically
            document.body.classList.add('printing-card');
            window.print();
            document.body.classList.remove('printing-card');
            
            cardReceiptForm.reset();
            document.getElementById('cardRate').value = "2";
            cardReceiptModal.style.display = 'none';
            fetchDashboard(); // Update Dashboard stats
        } catch (error) {
            console.error('Error adding pawn via card:', error);
            alert('Failed to save receipt.');
        }
    });

    let currentKhaataCustomer = null;
    let currentKhaataPawns = [];

    // Helper to send customer credentials on WhatsApp
    function sendCustomerCredentials(name, phone, pin) {
        fetch(`${API_URL}/system/common-qr`).then(res => res.json()).then(sysData => {
            let host = window.location.host;
            if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && sysData.server_ip && sysData.server_ip !== 'localhost') {
                host = `${sysData.server_ip}:${sysData.port || 3001}`;
            }
            const portalUrl = `${window.location.protocol}//${host}/portal.html`;
            const msg = `Namaste ${name} Ji,\nYour *LJS Jewellers* Customer Portal Login Details:\n\n📱 Username: ${phone}\n🔑 Secret PIN: ${pin}\n\nPortal Link: ${portalUrl}\n\nYou can scan our Counter QR Code or use the link above to log in & view your live Gehna & Byaaj ledger.\n\nThank you!`;
            let cleanNumber = (phone || '').replace(/[^0-9]/g, '');
            if (cleanNumber.length === 10) cleanNumber = '91' + cleanNumber;
            window.open(`https://wa.me/${cleanNumber}?text=${encodeURIComponent(msg)}`, '_blank');
        }).catch(err => console.error(err));
    }

    // Open Customer Khaata Full Page View
    function openCustomerKhaata(customerId) {
        const customer = customers.find(c => c.id == customerId);
        if (!customer) return;

        currentKhaataCustomer = customer;

        // Switch to full-page Khaata View
        hideAllViews();
        if (khaataView) khaataView.style.display = 'block';
        if (navKhaataBtn) navKhaataBtn.classList.add('active-tab');

        // Show Khaata Content Area
        const noCustState = document.getElementById('khaataNoCustomerState');
        const custContentArea = document.getElementById('khaataContentArea');

        if (noCustState) noCustState.style.display = 'none';
        if (custContentArea) custContentArea.style.display = 'block';

        // Populate full customer header info
        const fullCustName = document.getElementById('fullKhaataCustomerName');
        const fullCustDetails = document.getElementById('fullKhaataCustomerDetails');
        const fullPinBadge = document.getElementById('fullKhaataLoginPinBadge');
        const fullKalamSearch = document.getElementById('fullKalamSearchInput');

        if (fullCustName) fullCustName.textContent = customer.name;
        if (fullCustDetails) fullCustDetails.textContent = `Phone: ${customer.phone || 'N/A'} | Email: ${customer.email || 'N/A'} | D.O.B: ${formatDate(customer.dob)}`;
        const score = customer.credit_score || 700;
        const scoreBadge = getScoreBadgeHtml(score);
        if (fullPinBadge) {
            fullPinBadge.innerHTML = `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700; font-family:sans-serif; font-size:0.8rem;">🔒 PIN Encrypted</span> &nbsp;<button id="resetCustomerPinBtn" class="btn-action" style="background:#fffbeb; color:#b45309; border:1px solid #fef3c7; font-weight:800; padding:0.25rem 0.6rem; border-radius:4px; cursor:pointer;" title="Reset Secret 6-Digit PIN">🔑 Reset PIN</button> &nbsp;&nbsp; ${scoreBadge}`;
            const resetBtn = document.getElementById('resetCustomerPinBtn');
            if (resetBtn) {
                resetBtn.onclick = async () => {
                    if (!confirm(`Generate a new Secret 6-Digit PIN for ${customer.name}?`)) return;
                    try {
                        const res = await fetch(`${API_URL}/customers/${customer.id}/reset-pin`, { method: 'POST' });
                        const resData = await res.json();
                        if (res.ok && resData.newPin) {
                            alert(`✅ New PIN for ${customer.name}: ${resData.newPin}`);
                            sendCustomerCredentials(customer.name, customer.phone, resData.newPin);
                        } else {
                            alert(resData.error || 'Failed to reset PIN.');
                        }
                    } catch (e) {
                        alert('Error resetting PIN.');
                    }
                };
            }
        }
        if (fullKalamSearch) fullKalamSearch.value = '';

        window.scrollTo({ top: 0, behavior: 'smooth' });
        fetchPawns(customerId);
    }

    // Full-Page Action Toolbar Event Listeners
    const fullKhaataAddPawnBtn = document.getElementById('fullKhaataAddPawnBtn');
    const fullKhaataQrBtn = document.getElementById('fullKhaataQrBtn');
    const fullKhaataCardBtn = document.getElementById('fullKhaataCardBtn');
    const fullKhaataWhatsappBtn = document.getElementById('fullKhaataWhatsappBtn');
    const backToDashBtn = document.getElementById('backToDashBtn');

    if (fullKhaataAddPawnBtn) {
        fullKhaataAddPawnBtn.onclick = () => {
            if (!currentKhaataCustomer) return;
            pawnCustomerIdInput.value = currentKhaataCustomer.id;
            addPawnModal.style.display = 'block';
        };
    }

    if (fullKhaataQrBtn) {
        fullKhaataQrBtn.onclick = () => {
            if (!currentKhaataCustomer) return;
            openQrPassModal(currentKhaataCustomer.id);
        };
    }

    if (fullKhaataCardBtn) {
        fullKhaataCardBtn.onclick = () => {
            if (!currentKhaataCustomer) return;
            document.getElementById('cardCustomerId').value = currentKhaataCustomer.id;
            document.getElementById('cardCustomerName').textContent = currentKhaataCustomer.name;
            document.getElementById('cardCustomerPhone').textContent = currentKhaataCustomer.phone || '';
            document.getElementById('cardDate').valueAsDate = new Date();
            document.getElementById('cardDescription').value = '';
            document.getElementById('cardWeight').value = '';
            document.getElementById('cardAmount').value = '';
            cardReceiptModal.style.display = 'block';
        };
    }

    if (fullKhaataWhatsappBtn) {
        fullKhaataWhatsappBtn.onclick = async () => {
            if (!currentKhaataCustomer) return;
            if (confirm(`Send Login Details to ${currentKhaataCustomer.name} on WhatsApp?\n\n(Note: PIN is encrypted for security. Click OK to reset & send a fresh 6-digit PIN on WhatsApp, or CANCEL to close)`)) {
                try {
                    const res = await fetch(`${API_URL}/customers/${currentKhaataCustomer.id}/reset-pin`, { method: 'POST' });
                    const resData = await res.json();
                    if (res.ok && resData.newPin) {
                        sendCustomerCredentials(currentKhaataCustomer.name, currentKhaataCustomer.phone, resData.newPin);
                    } else {
                        alert('Failed to generate PIN.');
                    }
                } catch (e) {
                    alert('Error generating PIN.');
                }
            }
        };
    }

    if (backToDashBtn) {
        backToDashBtn.onclick = () => {
            if (navDashboardBtn) navDashboardBtn.click();
        };
    }

    // Full-Page Kalam Search Filter listener inside Khaata View
    const fullKalamSearchInput = document.getElementById('fullKalamSearchInput');
    if (fullKalamSearchInput) {
        fullKalamSearchInput.oninput = (e) => {
            const term = e.target.value.toLowerCase().trim();
            if (!term) {
                renderPawnList(currentKhaataPawns, currentKhaataCustomer ? currentKhaataCustomer.id : null);
            } else {
                const filtered = currentKhaataPawns.filter(p => 
                    (p.description || '').toLowerCase().includes(term) ||
                    (p.amount || '').toString().includes(term) ||
                    (p.item_weight_grams || '').toString().includes(term) ||
                    (p.item_metal_type || '').toLowerCase().includes(term)
                );
                renderPawnList(filtered, currentKhaataCustomer ? currentKhaataCustomer.id : null);
            }
        };
    }

    // Top Search Bar inside Khaata View Banner
    const khaataCustomerSearch = document.getElementById('khaataCustomerSearch');
    const khaataCustomerDropdown = document.getElementById('khaataCustomerDropdown');

    if (khaataCustomerSearch && khaataCustomerDropdown) {
        khaataCustomerSearch.oninput = (e) => {
            const term = e.target.value.toLowerCase().trim();
            if (!term) {
                khaataCustomerDropdown.style.display = 'none';
                return;
            }
            const matching = customers.filter(c => c.name.toLowerCase().includes(term) || (c.phone || '').includes(term));
            if (matching.length === 0) {
                khaataCustomerDropdown.innerHTML = '<div style="padding: 0.75rem 1rem; color: var(--text-muted); font-size: 0.88rem;">No customer found</div>';
            } else {
                khaataCustomerDropdown.innerHTML = matching.map(c => `
                    <div class="khaata-search-item" data-id="${c.id}" style="padding: 0.65rem 1rem; border-bottom: 1px solid #f1f5f9; cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong style="color: var(--navy-header); font-size: 0.92rem;">${escapeHtml(c.name)}</strong>
                            <div style="font-size: 0.8rem; color: var(--text-muted);">📱 ${escapeHtml(c.phone)}</div>
                        </div>
                        <span style="font-size: 0.8rem; color: var(--accent-blue); font-weight: 700;">Open ➔</span>
                    </div>
                `).join('');
            }
            khaataCustomerDropdown.style.display = 'block';
        };

        khaataCustomerDropdown.onclick = (e) => {
            const item = e.target.closest('.khaata-search-item');
            if (item) {
                const id = item.getAttribute('data-id');
                khaataCustomerDropdown.style.display = 'none';
                khaataCustomerSearch.value = '';
                openCustomerKhaata(id);
            }
        };

        document.addEventListener('click', (e) => {
            if (!khaataCustomerSearch.contains(e.target) && !khaataCustomerDropdown.contains(e.target)) {
                khaataCustomerDropdown.style.display = 'none';
            }
        });
    }

    // Fetch and display pawns for a customer
    async function fetchPawns(customerId) {
        try {
            pawnList.innerHTML = '<tr><td colspan="8">Loading...</td></tr>';
            pawnEmptyState.style.display = 'none';
            pawnTable.parentElement.style.display = 'block';
            
            const response = await fetch(`${API_URL}/customers/${customerId}/pawn`);
            const data = await response.json();
            currentKhaataPawns = data.pawn_records || [];
            
            renderPawnList(currentKhaataPawns, customerId);
        } catch (error) {
            console.error('Error fetching pawns:', error);
            pawnList.innerHTML = '<tr><td colspan="8" style="color:red">Error loading data</td></tr>';
        }
    }

    function renderPawnList(pawns, customerId) {
        const totalKalamEl = document.getElementById('khaataTotalKalam') || document.getElementById('fullKhaataTotalKalam');
        const totalBakiEl = document.getElementById('khaataTotalBaki') || document.getElementById('fullKhaataTotalBaki');
        const fullTotalKalam = document.getElementById('fullKhaataTotalKalam');
        const fullTotalBaki = document.getElementById('fullKhaataTotalBaki');

        let grandTotalBaki = 0;
        let activeKalamCount = 0;

        if (pawns.length === 0) {
            pawnEmptyState.style.display = 'block';
            pawnTable.parentElement.style.display = 'none';
            if (totalKalamEl) totalKalamEl.textContent = '0';
            if (totalBakiEl) totalBakiEl.textContent = '₹0';
            if (fullTotalKalam) fullTotalKalam.textContent = '0';
            if (fullTotalBaki) fullTotalBaki.textContent = '₹0';
        } else {
            pawnEmptyState.style.display = 'none';
            pawnTable.parentElement.style.display = 'block';

            pawnList.innerHTML = pawns.map(p => {
                const interest = calculateInterest(p.amount, p.interest_rate, p.date_added, p.status, p.release_date);
                let totalJama = parseFloat(p.total_jama) || 0;
                const principalAmt = parseFloat(p.amount) || 0;
                
                // Baki = (Principal + Interest) - Total Jama
                let baki = (principalAmt + interest) - totalJama;
                if (p.status === 'Released') {
                    totalJama = principalAmt + interest;
                    baki = 0;
                }

                if (p.status === 'Active') {
                    grandTotalBaki += baki;
                    activeKalamCount++;
                }
                
                // Calculate Days Passed
                const startDate = new Date(p.date_added);
                const endDate = p.status === 'Released' && p.release_date ? new Date(p.release_date) : new Date();
                const diffDays = Math.ceil(Math.abs(endDate - startDate) / (1000 * 60 * 60 * 24));

                const statusColor = p.status === 'Active' ? 'var(--gold-primary)' : (p.status === 'Melted' ? '#ef4444' : (p.status === 'Renewed' ? '#3b82f6' : '#4CAF50'));
                
                let actionMenuItems = '';
                if (p.status === 'Active') {
                    actionMenuItems += `
                        <button class="dropdown-item release-pawn-btn" data-id="${p.id}" data-customer="${customerId}">
                            <span>🟢</span> Release Gehna
                        </button>
                        <button class="dropdown-item renew-pawn-btn" data-id="${p.id}" data-customer="${customerId}" data-principal="${p.amount}" data-desc="${escapeHtml(p.description)}" data-rate="${p.interest_rate || 2}" data-days="${diffDays}" data-date="${p.date_added}" data-interest="${interest.toFixed(0)}" data-locker="${escapeHtml(p.locker_location || 'Safe Vault')}">
                            <span>🔄</span> Renew / Byaaj Closing
                        </button>
                        <button class="dropdown-item pay-btn" data-id="${p.id}">
                            <span>💰</span> Collect Payment
                        </button>
                        <button class="dropdown-item melt-pawn-btn" data-id="${p.id}" data-customer="${customerId}">
                            <span>🔥</span> Melt Gehna
                        </button>
                        <div class="dropdown-divider"></div>
                    `;
                }

                actionMenuItems += `
                    <button class="dropdown-item whatsapp-pawn-btn" data-amount="${p.amount}" data-desc="${escapeHtml(p.description)}" data-date="${p.date_added}" data-jama="${totalJama.toFixed(0)}" data-interest="${interest.toFixed(0)}" data-baki="${baki.toFixed(0)}">
                        <span>💬</span> WhatsApp Bill
                    </button>
                    <button class="dropdown-item email-pawn-btn" data-id="${p.id}" data-customer="${customerId}">
                        <span>📧</span> Email Receipt
                    </button>
                    <button class="dropdown-item print-pawn-btn" data-customer="${escapeHtml(currentKhaataCustomer ? currentKhaataCustomer.name : '')}" data-phone="" data-amount="${p.amount}" data-desc="${escapeHtml(p.description)}" data-date="${p.date_added}" data-rate="${p.interest_rate || 0}">
                        <span>🖨️</span> Print Receipt
                    </button>
                `;

                const actionDropdownHtml = `
                    <div class="action-dropdown-wrap">
                        <button class="action-dots-btn" title="Actions" onclick="toggleRowDropdown(event, this)">⋮</button>
                        <div class="action-dropdown-menu">
                            ${actionMenuItems}
                        </div>
                    </div>
                `;

                let photoHtml = p.item_photo ? `<br><a href="${p.item_photo}" target="_blank"><img src="${p.item_photo}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;margin-top:8px;border: 1px solid var(--gold-primary);"></a>` : '';

                let badgeHtml = '';
                if (p.is_udhari == 1) badgeHtml = `<br><span class="badge" style="background:#e0f2fe; color:#0284c7; margin-top:5px; border: 1px solid #38bdf8;">Unsecured Udhari</span>`;

                // Risk calculation for UI
                const rateToUse = p.item_metal_type === 'Silver' ? window.currentSilverRate : window.currentGoldRate;
                const marketValue = (p.item_weight_grams || 0) * (rateToUse || 0);
                let riskHtml = '';
                if (p.status !== 'Released' && p.status !== 'Melted' && p.is_udhari != 1 && marketValue > 0 && baki > marketValue) {
                    riskHtml = `<br><span style="color: #ff4a4a; font-weight: bold; background: rgba(255,0,0,0.1); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">⚠️ Risk (Value: ₹${marketValue})</span>`;
                }
                
                const detailsStr = p.is_udhari == 1 ? `Rate: ${p.interest_rate || 0}% / month` : `Rate: ${p.interest_rate || 0}% / month<br>Weight: ${p.item_weight_grams || 0}g (${p.item_metal_type || 'Gold'})`;
                const lockerStr = p.locker_location || 'Safe Vault';

                return `
                <tr style="background: rgba(0,0,0,0.02);">
                    <td style="vertical-align: top;">${formatDate(p.date_added)}<br><small style="color: var(--gold-primary); font-weight: bold;">${diffDays} Din</small></td>
                    <td style="vertical-align: top;"><strong>${escapeHtml(p.description)}</strong>${badgeHtml}${photoHtml}<br><small style="color:var(--text-secondary)">${detailsStr}</small></td>
                    <td style="vertical-align: top;"><span class="badge" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; font-weight:bold;">🔐 ${escapeHtml(lockerStr)}</span></td>
                    <td style="vertical-align: top; color: var(--gold-primary); font-weight: bold; font-size: 1.1rem;">₹${p.amount}</td>
                    <td style="vertical-align: top; color: #ff9800; font-weight: bold;">₹${interest.toFixed(0)}</td>
                    <td style="vertical-align: top; color: #4CAF50; font-weight: bold;">₹${totalJama}</td>
                    <td style="vertical-align: top; color: #ff4a4a; font-weight: bold; font-size: 1.2rem;">₹${baki.toFixed(0)}${riskHtml}</td>
                    <td style="vertical-align: top;"><span class="badge" style="background: ${statusColor}20; color: ${statusColor};">${p.status || 'Active'}</span></td>
                    <td style="vertical-align: top; text-align: center;">
                        ${actionDropdownHtml}
                    </td>
                </tr>
            `}).join('');

            if (totalKalamEl) totalKalamEl.textContent = activeKalamCount;
            if (totalBakiEl) totalBakiEl.textContent = `₹${Math.round(grandTotalBaki).toLocaleString('en-IN')}`;
            if (fullTotalKalam) fullTotalKalam.textContent = activeKalamCount;
            if (fullTotalBaki) fullTotalBaki.textContent = `₹${Math.round(grandTotalBaki).toLocaleString('en-IN')}`;
        }
    }

    // Toggle 3-dots dropdown function
    window.toggleRowDropdown = function(event, btn) {
        event.stopPropagation();
        const dropdownMenu = btn.nextElementSibling;
        const isAlreadyOpen = dropdownMenu.classList.contains('show');
        
        document.querySelectorAll('.action-dropdown-menu.show').forEach(menu => {
            menu.classList.remove('show');
        });
        
        if (!isAlreadyOpen) {
            dropdownMenu.classList.add('show');
        }
    };

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.action-dropdown-wrap')) {
            document.querySelectorAll('.action-dropdown-menu.show').forEach(menu => {
                menu.classList.remove('show');
            });
        }
    });

    // Handle pawn release & email
    pawnList.addEventListener('click', async (e) => {
        // Auto-close dropdown when clicking an action item
        const dropdownItem = e.target.closest('.dropdown-item');
        if (dropdownItem) {
            const menu = dropdownItem.closest('.action-dropdown-menu');
            if (menu) menu.classList.remove('show');
        }

        // Release Pawn
        const releaseBtn = e.target.closest('.release-pawn-btn');
        if (releaseBtn) {
            const pawnId = releaseBtn.getAttribute('data-id');
            const customerId = releaseBtn.getAttribute('data-customer');
            
            if (confirm('Are you sure you want to mark this gehna as released/returned?')) {
                try {
                    const response = await fetch(`${API_URL}/customers/${customerId}/pawn/${pawnId}/release`, {
                        method: 'PUT'
                    });
                    if (!response.ok) throw new Error('Failed to release');
                    
                    fetchPawns(customerId); // refresh the list
                    fetchDashboard();

                } catch (error) {
                    console.error('Error releasing pawn:', error);
                    alert('Failed to release pawn record.');
                }
            }
        }
        
        // Melt Pawn Action
        const meltBtn = e.target.closest('.melt-pawn-btn');
        if (meltBtn) {
            const pawnId = meltBtn.getAttribute('data-id');
            const customerId = meltBtn.getAttribute('data-customer');
            document.getElementById('meltPawnId').value = pawnId;
            document.getElementById('meltCustomerId').value = customerId;
            document.getElementById('meltPureWeight').value = "";
            document.getElementById('meltNotes').value = "";
            meltModal.style.display = 'block';
        }

        // Renew Pawn Action (Byaaj Closing)
        const renewBtn = e.target.closest('.renew-pawn-btn');
        if (renewBtn) {
            const pawnId = renewBtn.getAttribute('data-id');
            const customerId = renewBtn.getAttribute('data-customer');
            const oldPrincipal = parseFloat(renewBtn.getAttribute('data-principal')) || 0;
            const oldInterest = parseFloat(renewBtn.getAttribute('data-interest')) || 0;
            const oldDesc = renewBtn.getAttribute('data-desc') || '';
            const oldDays = renewBtn.getAttribute('data-days') || '';
            const oldRate = renewBtn.getAttribute('data-rate') || '2';
            const oldLocker = renewBtn.getAttribute('data-locker') || 'Safe Vault';

            document.getElementById('renewPawnId').value = pawnId;
            document.getElementById('renewCustomerId').value = customerId;
            document.getElementById('renewOldDesc').textContent = oldDesc;
            document.getElementById('renewOldPrincipal').textContent = `₹${oldPrincipal.toLocaleString('en-IN')}`;
            document.getElementById('renewOldInterest').textContent = `₹${Math.round(oldInterest).toLocaleString('en-IN')}`;
            document.getElementById('renewOldDays').textContent = `${oldDays} Days`;

            document.getElementById('renewInterestCollected').value = Math.round(oldInterest);
            document.getElementById('renewPrincipalAdjustType').value = 'NONE';
            document.getElementById('renewAdjustAmount').value = 0;
            document.getElementById('renewNewPrincipalDisplay').textContent = `₹${oldPrincipal.toLocaleString('en-IN')}`;
            document.getElementById('renewInterestRate').value = oldRate;
            document.getElementById('renewLockerLocation').value = oldLocker;
            document.getElementById('renewNotes').value = `Byaaj Closing for ${oldDays} Days`;

            const renewModal = document.getElementById('renewPawnModal');
            if (renewModal) renewModal.style.display = 'block';
        }
        
        // Email Receipt
        const emailBtn = e.target.closest('.email-pawn-btn');
        if (emailBtn) {
            const pawnId = emailBtn.getAttribute('data-id');
            const customerId = emailBtn.getAttribute('data-customer');
            const originalText = emailBtn.innerHTML;
            
            try {
                emailBtn.innerHTML = 'Sending...';
                emailBtn.disabled = true;
                
                const response = await fetch(`${API_URL}/customers/${customerId}/pawn/${pawnId}/email`, {
                    method: 'POST'
                });

                
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to email receipt');
                }
                
                emailBtn.innerHTML = '✅ Sent!';
                setTimeout(() => {
                    emailBtn.innerHTML = originalText;
                    emailBtn.disabled = false;
                }, 3000);
            } catch (error) {
                console.error('Error emailing receipt:', error);
                alert(error.message);
                emailBtn.innerHTML = originalText;
                emailBtn.disabled = false;
            }
        }
        
        // WhatsApp Receipt
        const waBtn = e.target.closest('.whatsapp-pawn-btn');
        if (waBtn) {
            const amount = waBtn.getAttribute('data-amount');
            const desc = waBtn.getAttribute('data-desc');
            const date = formatDate(waBtn.getAttribute('data-date'));
            const jama = waBtn.getAttribute('data-jama');
            const baki = waBtn.getAttribute('data-baki');
            const interest = waBtn.getAttribute('data-interest');
            const originalText = waBtn.innerHTML;
            
            const number = window.prompt("Enter customer's WhatsApp number (e.g. 9876543210):");
            if (number !== null) {
                // Formatted Bill Text using safe characters (no emojis to prevent  errors)
                const text = encodeURIComponent(
`========================
   *LJS JEWELLERS*
========================
*PAWN (GEHAN) RECEIPT*

*Date:* ${date}
*Item:* ${desc}
*Kitna Liya (Principal):* ₹${amount}

*Jama (Deposit):* ₹${jama}
*Baki (Balance):* ₹${baki}
*Interest Due:* ₹${interest}
========================
_Thank you for choosing LJS Jewellers_`
                );
                
                let cleanNumber = number.trim().replace(/[^0-9]/g, '');
                
                // Auto add India country code if user just entered 10 digits
                if (cleanNumber.length === 10) {
                    cleanNumber = '91' + cleanNumber;
                }
                
                const waUrl = cleanNumber 
                    ? `https://wa.me/${cleanNumber}?text=${text}` 
                    : `https://wa.me/?text=${text}`;
                
                window.open(waUrl, '_blank');
                
                // Show visual feedback that WhatsApp was opened
                waBtn.innerHTML = '✅ Opened!';
                setTimeout(() => {
                    waBtn.innerHTML = originalText;
                }, 3000);
            }
        }
        
        // Print Receipt
        const printBtn = e.target.closest('.print-pawn-btn');
        if (printBtn) {
            const customer = printBtn.getAttribute('data-customer');
            const date = formatDate(printBtn.getAttribute('data-date'));
            const amount = printBtn.getAttribute('data-amount');
            const desc = printBtn.getAttribute('data-desc');
            const rate = printBtn.getAttribute('data-rate');
            const phone = document.querySelector('#customerTable td:nth-child(3)') ? document.querySelector('#customerTable td:nth-child(3)').innerText : ''; // Best effort
            
            document.getElementById('printDate').innerText = date;
            document.getElementById('printCustomer').innerText = customer;
            document.getElementById('printPhone').innerText = phone;
            document.getElementById('printDesc').innerText = desc;
            document.getElementById('printRate').innerText = rate + '% per month';
            document.getElementById('printAmount').innerText = '₹' + amount;
            
            window.print();
        }
        
        // Open Payment Modal
        const payBtn = e.target.closest('.pay-btn');
        if (payBtn) {
            const pawnId = payBtn.getAttribute('data-id');
            payPawnIdInput.value = pawnId;
            paymentModal.style.display = 'block';
            fetchPayments(pawnId);
        }
    });

    // Handle Payment form submission
    paymentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pawnId = payPawnIdInput.value;
        const amount = document.getElementById('payAmount').value;
        const payment_type = document.getElementById('payType').value;

        if (currentRole === 'staff') {
            try {
                const response = await fetch(`${API_URL}/staff/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'RECEIVE_PAYMENT',
                        staff_name: 'Staff Counter',
                        data: { pawn_id: pawnId, amount, payment_type }
                    })
                });
                const data = await response.json();
                alert('🚨 ' + data.message);
                document.getElementById('payAmount').value = '';
                paymentModal.style.display = 'none';
                return;
            } catch (err) {
                console.error(err);
                alert('Failed to submit payment.');
                return;
            }
        }

        try {
            const response = await fetch(`${API_URL}/pawns/${pawnId}/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, payment_type })
            });

            if (!response.ok) throw new Error('Failed to save payment');
            
            document.getElementById('payAmount').value = '';
            fetchPayments(pawnId); // Refresh history
            fetchDashboard(); // Refresh dash
        } catch (error) {
            console.error('Error adding payment:', error);
            alert('Failed to save payment.');
        }
    });

    async function fetchPayments(pawnId) {
        try {
            paymentHistoryList.innerHTML = '<tr><td colspan="3">Loading...</td></tr>';
            const response = await fetch(`${API_URL}/pawns/${pawnId}/payments`);
            const data = await response.json();
            
            if (!data.payments || data.payments.length === 0) {
                paymentHistoryList.innerHTML = '<tr><td colspan="3">No previous payments.</td></tr>';
            } else {
                paymentHistoryList.innerHTML = data.payments.map(p => `
                    <tr>
                        <td>${formatDate(p.payment_date)}</td>
                        <td>${escapeHtml(p.payment_type)}</td>
                        <td style="color:var(--gold-primary); font-weight:bold;">₹${p.amount}</td>
                    </tr>
                `).join('');
            }
        } catch (error) {
            console.error('Error fetching payments:', error);
            paymentHistoryList.innerHTML = '<tr><td colspan="3" style="color:red;">Error loading payments</td></tr>';
        }
    }

    // Interest Calculation Logic
    function calculateInterest(amount, rate, dateAdded, status, releaseDate) {
        rate = parseFloat(rate || 0);
        amount = parseFloat(amount || 0);
        if (rate === 0 || amount === 0) return 0;

        const start = new Date(dateAdded);
        const end = status === 'Released' && releaseDate ? new Date(releaseDate) : new Date();
        
        // Calculate total days difference
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        const months = Math.floor(diffDays / 30);
        const extraDays = diffDays % 30;
        
        let chargeableMonths = months;
        
        if (extraDays > 0 && extraDays <= 5) {
            chargeableMonths += 1; // 1-5 din extra = 1 full month interest
        } else if (extraDays > 5 && extraDays <= 15) {
            chargeableMonths += 0.5; // 5 din se jyada aur 15 din tak = half month interest
        } else if (extraDays > 15) {
            chargeableMonths += (extraDays / 30); // 15 din se jyada = day wise interest
        } else if (months === 0 && extraDays === 0) {
            chargeableMonths = 1; // 0 days (same day) = within 5 days = 1 full month interest
        }

        return amount * (rate / 100) * chargeableMonths;
    }

    async function fetchCustomers() {
        try {
            const response = await fetch(`${API_URL}/customers`);
            const data = await response.json();
            customers = data.customers || [];
            filteredCustomers = [...customers];
            renderCustomers();
        } catch (error) {
            console.error('Error fetching customers:', error);
        }
    }

    async function fetchDashboard() {
        try {
            const response = await fetch(`${API_URL}/reports/dashboard`);
            const data = await response.json();
            
            // Set Gold Rate
            window.currentGoldRate = data.goldRate || 0;
            if (data.goldRate) {
                dashGoldRate.value = data.goldRate;
            }
            
            // Set Silver Rate
            window.currentSilverRate = data.silverRate || 0;
            if (data.silverRate) {
                dashSilverRate.value = data.silverRate;
            }
            
            dashTotalPrincipal.innerText = '₹' + (data.totalActivePrincipal || 0).toLocaleString('en-IN');
            dashTotalInterest.innerText = '₹' + (data.totalInterestCollected || 0).toLocaleString('en-IN');
            dashTotalReleased.innerText = data.totalReleasedItems || 0;
            
            // Render High Risk Accounts
            const riskCountNum = data.highRiskAccounts ? data.highRiskAccounts.length : 0;
            highRiskCount.innerText = riskCountNum;
            if (riskCountNum === 0) {
                highRiskEmptyState.style.display = 'table-row';
                document.getElementById('highRiskTable').parentElement.style.display = 'none';
            } else {
                highRiskEmptyState.style.display = 'none';
                document.getElementById('highRiskTable').parentElement.style.display = 'block';
                
                highRiskList.innerHTML = data.highRiskAccounts.map(p => {
                    const number = (p.customer_phone || '').replace(/[^0-9]/g, '');
                    const waLink = number ? `https://wa.me/91${number}?text=${encodeURIComponent("⚠️ Alert from LJS Jewellers: The market value of your pawned item has dropped below your outstanding loan balance. Please visit the shop to clear your dues.")}` : '#';
                    return `
                    <tr>
                        <td><strong>${escapeHtml(p.customer_name)}</strong><br><small>${p.customer_phone}</small></td>
                        <td>${escapeHtml(p.description)}<br><small>${p.item_weight_grams}g</small></td>
                        <td style="color:#ff4a4a; font-weight:bold;">₹${p.baki.toFixed(0)}</td>
                        <td style="color:#ff9800; font-weight:bold;">₹${p.marketValue.toFixed(0)}</td>
                        <td>
                            <a href="${waLink}" target="_blank" class="pawn-btn" style="background:#ff4a4a; color:white; text-decoration:none; display:inline-block; padding:5px 10px; border-radius:4px;">💬 Alert</a>
                        </td>
                    </tr>
                `}).join('');
            }
            
            // Render Overdue Accounts
            const overdueCountNum = data.overdueAccounts ? data.overdueAccounts.length : 0;
            overdueCount.innerText = overdueCountNum;
            
            if (overdueCountNum === 0) {
                overdueEmptyState.style.display = 'block';
                document.getElementById('overdueTable').parentElement.style.display = 'none';
            } else {
                overdueEmptyState.style.display = 'none';
                document.getElementById('overdueTable').parentElement.style.display = 'block';
                
                overdueList.innerHTML = data.overdueAccounts.map(p => {
                    const number = (p.customer_phone || '').replace(/[^0-9]/g, '');
                    const waLink = number ? `https://wa.me/91${number}?text=${encodeURIComponent("Reminder: Your pawn interest is overdue. Please visit LJS Jewellers to clear the dues.")}` : '#';
                    return `
                    <tr>
                        <td><strong>${escapeHtml(p.customer_name)}</strong><br><small>${p.customer_phone}</small></td>
                        <td>${formatDate(p.date_added)}<br><small style="color:#d32f2f">Over 6 Months!</small></td>
                        <td style="color:var(--gold-primary); font-weight:bold;">₹${p.amount}</td>
                        <td>
                            <a href="${waLink}" target="_blank" class="pawn-btn" style="background:#25D366; color:white; text-decoration:none; display:inline-block; padding:5px 10px; border-radius:4px;">💬 Reminder</a>
                        </td>
                    </tr>
                `}).join('');
            }
        } catch (error) {
            console.error('Error fetching dashboard:', error);
        }
    }

    // Helper to get Credit Score Badge HTML
    function getScoreBadgeHtml(score) {
        score = parseInt(score || 700);
        let color = '#0284c7';
        let bg = '#e0f2fe';
        let label = 'Platinum Trust';
        
        if (score >= 800) {
            color = '#15803d'; bg = '#dcfce7'; label = 'Platinum Trust';
        } else if (score >= 700) {
            color = '#0369a1'; bg = '#e0f2fe'; label = 'Prime Trust';
        } else if (score >= 600) {
            color = '#b45309'; bg = '#fef3c7'; label = 'Average Trust';
        } else {
            color = '#b91c1c'; bg = '#fee2e2'; label = 'High Risk Alert';
        }

        return `<span class="badge" style="background: ${bg}; color: ${color}; font-weight: 800; font-size: 0.85rem; border: 1px solid ${color}40;" title="${label}">🎯 ${score} / 900</span>`;
    }

    function renderCustomers() {
        // Update count
        customerCount.textContent = filteredCustomers.length;

        // Toggle empty state vs table
        if (filteredCustomers.length === 0) {
            emptyState.style.display = 'block';
            tableContainer.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            tableContainer.style.display = 'block';
            
            // Render rows
            customerList.innerHTML = filteredCustomers.map(c => {
                let photoHtml = c.aadhar_photo ? `<a href="${c.aadhar_photo}" target="_blank"><img src="${c.aadhar_photo}" class="customer-avatar"></a>` : `<div class="customer-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.75rem;font-weight:700;">No Pic</div>`;
                const score = c.credit_score || 700;
                const scoreBadge = getScoreBadgeHtml(score);

                return `
                <tr>
                    <td>${photoHtml}</td>
                    <td><span class="customer-name-link" data-id="${c.id}" data-name="${escapeHtml(c.name)}" style="color:var(--accent-blue); font-weight:700; cursor:pointer;">${escapeHtml(c.name)}</span></td>
                    <td>${scoreBadge}</td>
                    <td><strong>${escapeHtml(c.phone)}</strong></td>
                    <td><span class="badge" style="background:#f3f4f6; color:#374151; font-weight:700; font-family:sans-serif; font-size:0.8rem;">🔒 Encrypted</span></td>
                    <td>${escapeHtml(c.email || 'N/A')}</td>
                    <td>${formatDate(c.dob)}</td>
                    <td>
                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                            <button class="btn-action view-khaata-btn" data-id="${c.id}" style="background: var(--accent-blue); color: white; border: none; font-weight: 700; padding: 0.45rem 0.9rem; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 0.35rem;">📖 Open Khaata</button>
                            <button class="btn-action btn-action-delete delete-btn" data-id="${c.id}" style="padding: 0.45rem 0.65rem; border-radius: var(--radius-sm);" title="Delete Customer">🗑️</button>
                        </div>
                    </td>
                </tr>
            `}).join('');
        }
    }

    // Helper to prevent XSS
    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe.toString()
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Helper to format date nicely
    function formatDate(dateStr) {
        if (!dateStr || dateStr === 'N/A') return 'N/A';
        try {
            const options = { year: 'numeric', month: 'short', day: 'numeric' };
            return new Date(dateStr).toLocaleDateString(undefined, options);
        } catch (e) {
            return dateStr;
        }
    }

    if (meltForm) {
        meltForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pawnId = document.getElementById('meltPawnId').value;
            const customerId = document.getElementById('meltCustomerId').value;
            const melt_pure_weight = document.getElementById('meltPureWeight').value;
            const melt_notes = document.getElementById('meltNotes').value;

            try {
                const response = await fetch(`${API_URL}/customers/${customerId}/pawn/${pawnId}/melt`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ melt_pure_weight, melt_notes })
                });

                if (!response.ok) throw new Error('Failed to melt');
                
                meltForm.reset();
                if (meltModal) meltModal.style.display = 'none';
                fetchPawns(customerId);
                fetchDashboard();
                alert('Gehna marked as Melted successfully!');
            } catch (error) {
                console.error('Error melting:', error);
                alert('Failed to mark as melted.');
            }
        });
    }

    // QR Passbook Logic
    const qrCustomerName = document.getElementById('qrCustomerName');
    const qrCustomerPhone = document.getElementById('qrCustomerPhone');
    const qrStatusBadge = document.getElementById('qrStatusBadge');
    const qrCodeContainer = document.getElementById('qrCodeContainer');
    const toggleQrStatusBtn = document.getElementById('toggleQrStatusBtn');
    const shareQrWaBtn = document.getElementById('shareQrWaBtn');
    const copyQrLinkBtn = document.getElementById('copyQrLinkBtn');

    let currentQrCustomer = null;

    async function openQrPassModal(customerId) {
        try {
            qrCodeContainer.innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted);">Loading QR...</p>';
            customerQrModal.style.display = 'block';

            const res = await fetch(`${API_URL}/customers/${customerId}/qr-pass`);
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Failed to fetch QR');

            currentQrCustomer = data;
            qrCustomerName.textContent = data.name;
            qrCustomerPhone.textContent = `📞 ${data.phone}`;

            updateQrStatusUI(data.qr_active);

            // Construct Pass URL
            let passHost = window.location.host;
            if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && data.server_ip && data.server_ip !== 'localhost') {
                passHost = `${data.server_ip}:${window.location.port || data.port || 3001}`;
            }
            const passUrl = `${window.location.protocol}//${passHost}/passbook.html?token=${data.qr_token}`;
            currentQrCustomer.passUrl = passUrl;

            // Render QR Code using QRCode.js with API fallback
            qrCodeContainer.innerHTML = '';
            let rendered = false;
            if (typeof QRCode !== 'undefined') {
                try {
                    new QRCode(qrCodeContainer, {
                        text: passUrl,
                        width: 180,
                        height: 180,
                        colorDark: "#0f172a",
                        colorLight: "#ffffff"
                    });
                    rendered = true;
                } catch(err) {
                    console.warn('QRCode JS error, using fallback:', err);
                }
            }
            if (!rendered) {
                qrCodeContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(passUrl)}" alt="QR Code" style="width:180px;height:180px;border-radius:8px;">`;
            }

        } catch (e) {
            console.error(e);
            alert('Could not load QR Pass.');
            customerQrModal.style.display = 'none';
        }
    }

    function updateQrStatusUI(isActive) {
        if (isActive === 1 || isActive === true) {
            qrStatusBadge.innerText = '🟢 Active Pass';
            qrStatusBadge.style.background = '#dcfce7';
            qrStatusBadge.style.color = '#15803d';

            toggleQrStatusBtn.innerText = '🔴 Deactivate QR Pass';
            toggleQrStatusBtn.style.background = 'var(--error)';
        } else {
            qrStatusBadge.innerText = '🔴 Deactivated Pass';
            qrStatusBadge.style.background = '#fee2e2';
            qrStatusBadge.style.color = '#991b1b';

            toggleQrStatusBtn.innerText = '🟢 Activate QR Pass';
            toggleQrStatusBtn.style.background = 'var(--success)';
        }
    }

    if (toggleQrStatusBtn) {
        toggleQrStatusBtn.addEventListener('click', async () => {
            if (!currentQrCustomer) return;
            const newStatus = currentQrCustomer.qr_active === 1 ? 0 : 1;

            try {
                const res = await fetch(`${API_URL}/customers/${currentQrCustomer.id}/qr-status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ qr_active: newStatus })
                });
                const data = await res.json();
                if (data.success) {
                    currentQrCustomer.qr_active = newStatus;
                    updateQrStatusUI(newStatus);
                    alert(newStatus === 1 ? 'QR Pass activated!' : 'QR Pass deactivated!');
                }
            } catch (e) {
                console.error(e);
                alert('Failed to update pass status');
            }
        });
    }

    if (shareQrWaBtn) {
        shareQrWaBtn.addEventListener('click', () => {
            if (!currentQrCustomer) return;
            const passUrl = currentQrCustomer.passUrl || `${window.location.origin}/passbook.html?token=${currentQrCustomer.qr_token}`;
            const msg = `Namaste ${currentQrCustomer.name} Ji,\nHere is your Live Digital Passbook link from *LJS Jewellers*:\n\n${passUrl}\n\nYou can click the link above anytime to view your Gehna, Byaaj & Payment ledger summary.\n\nThank you!`;
            let cleanNumber = (currentQrCustomer.phone || '').replace(/[^0-9]/g, '');
            if (cleanNumber.length === 10) cleanNumber = '91' + cleanNumber;
            window.open(`https://wa.me/${cleanNumber}?text=${encodeURIComponent(msg)}`, '_blank');
        });
    }

    if (copyQrLinkBtn) {
        copyQrLinkBtn.addEventListener('click', () => {
            if (!currentQrCustomer) return;
            const passUrl = currentQrCustomer.passUrl || `${window.location.origin}/passbook.html?token=${currentQrCustomer.qr_token}`;
            navigator.clipboard.writeText(passUrl).then(() => {
                const orig = copyQrLinkBtn.innerText;
                copyQrLinkBtn.innerText = '✅ Copied!';
                setTimeout(() => copyQrLinkBtn.innerText = orig, 2500);
            });
        });
    }

    // Common Counter QR Logic
    const commonQrBtn = document.getElementById('commonQrBtn');
    const commonQrContainer = document.getElementById('commonQrContainer');
    const printCommonQrBtn = document.getElementById('printCommonQrBtn');
    const copyCommonQrLinkBtn = document.getElementById('copyCommonQrLinkBtn');

    let currentCommonPortalUrl = '';

    if (commonQrBtn) {
        commonQrBtn.addEventListener('click', async () => {
            try {
                commonQrContainer.innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted);">Loading QR...</p>';
                commonQrModal.style.display = 'block';

                const res = await fetch(`${API_URL}/system/common-qr`);
                const sysData = await res.json();

                let host = window.location.host;
                if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && sysData.server_ip && sysData.server_ip !== 'localhost') {
                    host = `${sysData.server_ip}:${sysData.port || 3001}`;
                }
                currentCommonPortalUrl = `${window.location.protocol}//${host}/portal.html`;

                commonQrContainer.innerHTML = '';
                let rendered = false;
                if (typeof QRCode !== 'undefined') {
                    try {
                        new QRCode(commonQrContainer, {
                            text: currentCommonPortalUrl,
                            width: 180,
                            height: 180,
                            colorDark: "#0f172a",
                            colorLight: "#ffffff"
                        });
                        rendered = true;
                    } catch(e) {}
                }
                if (!rendered) {
                    commonQrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(currentCommonPortalUrl)}" alt="Common QR Code" style="width:180px;height:180px;border-radius:8px;">`;
                }
            } catch (err) {
                console.error(err);
                alert('Could not load Common QR.');
            }
        });
    }

    if (copyCommonQrLinkBtn) {
        copyCommonQrLinkBtn.addEventListener('click', () => {
            if (!currentCommonPortalUrl) return;
            navigator.clipboard.writeText(currentCommonPortalUrl).then(() => {
                const orig = copyCommonQrLinkBtn.innerText;
                copyCommonQrLinkBtn.innerText = '✅ Copied!';
                setTimeout(() => copyCommonQrLinkBtn.innerText = orig, 2500);
            });
        });
    }

    if (printCommonQrBtn) {
        printCommonQrBtn.addEventListener('click', () => {
            window.print();
        });
    }

    // -------------------------------------------------------------
    // ⏳ RECOVERY TIME HUB ENGINE (Oldest Accounts Target Engine)
    // -------------------------------------------------------------
    const navRecoveryBtn = document.getElementById('navRecoveryBtn');
    const recoveryView = document.getElementById('recoveryView');
    const recoveryTargetInput = document.getElementById('recoveryTargetInput');
    const calculateRecoveryBtn = document.getElementById('calculateRecoveryBtn');
    const downloadRecoveryBtn = document.getElementById('downloadRecoveryBtn');
    const recTargetDisplay = document.getElementById('recTargetDisplay');
    const recCalculatedDisplay = document.getElementById('recCalculatedDisplay');
    const recCountDisplay = document.getElementById('recCountDisplay');
    const recOldestDateDisplay = document.getElementById('recOldestDateDisplay');
    const recoveryList = document.getElementById('recoveryList');
    const recoveryEmptyState = document.getElementById('recoveryEmptyState');
    const recoveryTable = document.getElementById('recoveryTable');
    const recBadge = document.getElementById('recBadge');

    let currentRecoveryQueue = [];

    if (navRecoveryBtn && recoveryView) {
        navRecoveryBtn.addEventListener('click', () => {
            hideAllViews();
            recoveryView.style.display = 'block';
            navRecoveryBtn.classList.add('active-tab');
        });
    }

    if (calculateRecoveryBtn) {
        calculateRecoveryBtn.addEventListener('click', () => {
            const targetVal = parseFloat(recoveryTargetInput ? recoveryTargetInput.value : 0);
            if (!targetVal || targetVal <= 0) {
                alert('⚠️ Kripya recovery target amount (₹) enter karein!');
                return;
            }
            calculateRecoveryQueue(targetVal);
        });
    }

    async function calculateRecoveryQueue(targetAmount) {
        try {
            if (recoveryList) recoveryList.innerHTML = '<tr><td colspan="8" style="text-align:center;">Calculating Oldest Pawns Queue...</td></tr>';
            if (recoveryEmptyState) recoveryEmptyState.style.display = 'none';
            if (recoveryTable && recoveryTable.parentElement) recoveryTable.parentElement.style.display = 'block';

            const res = await fetch(`${API_URL}/recovery-pawns`);
            const data = await res.json();
            const allActivePawns = data.pawns || [];

            if (allActivePawns.length === 0) {
                if (recoveryEmptyState) recoveryEmptyState.style.display = 'block';
                if (recoveryTable && recoveryTable.parentElement) recoveryTable.parentElement.style.display = 'none';
                if (recTargetDisplay) recTargetDisplay.textContent = `₹${targetAmount.toLocaleString('en-IN')}`;
                if (recCalculatedDisplay) recCalculatedDisplay.textContent = '₹0';
                if (recCountDisplay) recCountDisplay.textContent = '0 Items';
                if (recOldestDateDisplay) recOldestDateDisplay.textContent = '-';
                if (recBadge) recBadge.textContent = '0 Queue';
                return;
            }

            // Calculate total recoverable for each active pawn & accumulate oldest first
            let totalAccumulated = 0;
            const queue = [];

            for (const p of allActivePawns) {
                const interest = calculateInterest(p.amount, p.interest_rate, p.date_added, 'Active');
                const totalJama = parseFloat(p.total_jama) || 0;
                const principalAmt = parseFloat(p.amount) || 0;
                const baki = (principalAmt + interest) - totalJama;

                if (baki > 0) {
                    queue.push({
                        ...p,
                        calculatedInterest: interest,
                        totalJama: totalJama,
                        totalRecoverable: baki
                    });
                    totalAccumulated += baki;
                    if (totalAccumulated >= targetAmount) {
                        break; // Target reached
                    }
                }
            }

            currentRecoveryQueue = queue;

            // Render stats
            if (recTargetDisplay) recTargetDisplay.textContent = `₹${targetAmount.toLocaleString('en-IN')}`;
            if (recCalculatedDisplay) recCalculatedDisplay.textContent = `₹${Math.round(totalAccumulated).toLocaleString('en-IN')}`;
            if (recCountDisplay) recCountDisplay.textContent = `${queue.length} Accounts`;
            if (recBadge) recBadge.textContent = `${queue.length} Selected`;

            if (queue.length > 0 && recOldestDateDisplay) {
                recOldestDateDisplay.textContent = formatDate(queue[0].date_added);
            }

            renderRecoveryTable(queue);

        } catch (err) {
            console.error('Error calculating recovery queue:', err);
            if (recoveryList) recoveryList.innerHTML = '<tr><td colspan="8" style="color:red; text-align:center;">Failed to calculate recovery queue.</td></tr>';
        }
    }

    function renderRecoveryTable(queue) {
        if (!recoveryList) return;
        if (queue.length === 0) {
            if (recoveryEmptyState) recoveryEmptyState.style.display = 'block';
            if (recoveryTable && recoveryTable.parentElement) recoveryTable.parentElement.style.display = 'none';
            return;
        }

        if (recoveryEmptyState) recoveryEmptyState.style.display = 'none';
        if (recoveryTable && recoveryTable.parentElement) recoveryTable.parentElement.style.display = 'block';

        recoveryList.innerHTML = queue.map(p => {
            const startDate = new Date(p.date_added);
            const diffDays = Math.ceil(Math.abs(new Date() - startDate) / (1000 * 60 * 60 * 24));
            const months = (diffDays / 30.4375).toFixed(1);
            const locker = p.locker_location || 'Safe Vault';

            let waMsg = `Namaste ${p.customer_name} Ji,\nLJS Jewellers se nivedan hai ki aapke Girvi Gehna (${p.description}) ki samay seema ${months} mahine ho chuki hai.\n\nTotal Due Amount: ₹${Math.round(p.totalRecoverable).toLocaleString('en-IN')}\n\nKripya dukan par aakar apna byaaj/hisab jama karein. Dhanyawad!`;
            let cleanPhone = (p.customer_phone || '').replace(/[^0-9]/g, '');
            if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
            const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;

            return `
            <tr>
                <td style="vertical-align: top;">
                    <strong>${formatDate(p.date_added)}</strong><br>
                    <span class="badge" style="background:#fee2e2; color:#991b1b; font-size:0.75rem; margin-top:3px; display:inline-block;">⏱️ ${months} Mo (${diffDays} Days)</span>
                </td>
                <td style="vertical-align: top;">
                    <strong style="color:var(--navy-header); font-size:0.95rem;">${escapeHtml(p.customer_name)}</strong><br>
                    <small style="color:var(--text-muted);">📱 ${escapeHtml(p.customer_phone)}</small>
                </td>
                <td style="vertical-align: top;">
                    <strong>${escapeHtml(p.description)}</strong><br>
                    <small style="color:var(--text-secondary);">${p.item_metal_type || 'Gold'} | ${p.item_weight_grams || 0}g</small>
                </td>
                <td style="vertical-align: top;">
                    <span class="badge" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; font-weight:700;">🔐 ${escapeHtml(locker)}</span>
                </td>
                <td style="vertical-align: top; font-weight: bold; color: var(--navy-header);">₹${p.amount}</td>
                <td style="vertical-align: top; font-weight: bold; color: #d97706;">₹${p.calculatedInterest.toFixed(0)}</td>
                <td style="vertical-align: top; font-weight: 800; color: #dc2626; font-size: 1.15rem;">₹${Math.round(p.totalRecoverable).toLocaleString('en-IN')}</td>
                <td style="vertical-align: top; text-align: right; min-width: 140px;">
                    <a href="${waUrl}" target="_blank" class="btn-primary" style="display:inline-flex; align-items:center; gap:4px; padding:0.4rem 0.75rem; font-size:0.8rem; background:#25D366; color:white; text-decoration:none; border-radius:var(--radius-pill); font-weight:700;">💬 Remind WA</a>
                    <button class="view-khaata-btn btn-primary" data-id="${p.customer_id}" style="padding:0.4rem 0.75rem; font-size:0.8rem; background:var(--accent-blue); color:white; width:auto; border-radius:var(--radius-pill); margin-top:4px;">📖 Khaata</button>
                </td>
            </tr>
            `;
        }).join('');
    }

    if (downloadRecoveryBtn) {
        downloadRecoveryBtn.addEventListener('click', () => {
            if (currentRecoveryQueue.length === 0) {
                alert('Pehle recovery queue calculate karein!');
                return;
            }
            let csv = 'Customer,Phone,Pawn Date,Age Days,Description,Locker Location,Principal,Interest,Total Recoverable\n';
            currentRecoveryQueue.forEach(p => {
                const diffDays = Math.ceil(Math.abs(new Date() - new Date(p.date_added)) / (1000 * 60 * 60 * 24));
                csv += `"${p.customer_name}","${p.customer_phone}","${p.date_added}",${diffDays},"${p.description}","${p.locker_location || 'Safe Vault'}",${p.amount},${p.calculatedInterest},${p.totalRecoverable}\n`;
            });

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('href', url);
            a.setAttribute('download', `Recovery_Target_Report_${new Date().toISOString().substring(0, 10)}.csv`);
            a.click();
        });
    }

    // -------------------------------------------------------------
    // 🔄 PAWN RENEWAL / BYAAJ CLOSING LOGIC
    // -------------------------------------------------------------
    const renewPawnForm = document.getElementById('renewPawnForm');
    const renewPawnModal = document.getElementById('renewPawnModal');
    const closeRenewModal = document.getElementById('closeRenewModal');
    const renewPrincipalAdjustType = document.getElementById('renewPrincipalAdjustType');
    const renewAdjustAmount = document.getElementById('renewAdjustAmount');
    const renewNewPrincipalDisplay = document.getElementById('renewNewPrincipalDisplay');

    if (closeRenewModal && renewPawnModal) closeRenewModal.onclick = () => renewPawnModal.style.display = 'none';

    function updateRenewNewPrincipal() {
        const oldPStr = (document.getElementById('renewOldPrincipal').textContent || '').replace(/[^0-9.]/g, '');
        const oldP = parseFloat(oldPStr) || 0;
        const type = renewPrincipalAdjustType ? renewPrincipalAdjustType.value : 'NONE';
        const adj = parseFloat(renewAdjustAmount ? renewAdjustAmount.value : 0) || 0;

        let newP = oldP;
        if (type === 'REDUCE') {
            newP = Math.max(0, oldP - adj);
        } else if (type === 'TOPUP') {
            newP = oldP + adj;
        }

        if (renewNewPrincipalDisplay) renewNewPrincipalDisplay.textContent = `₹${Math.round(newP).toLocaleString('en-IN')}`;
    }

    if (renewPrincipalAdjustType) renewPrincipalAdjustType.addEventListener('change', updateRenewNewPrincipal);
    if (renewAdjustAmount) renewAdjustAmount.addEventListener('input', updateRenewNewPrincipal);

    if (renewPawnForm) {
        renewPawnForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pawnId = document.getElementById('renewPawnId').value;
            const customerId = document.getElementById('renewCustomerId').value;
            const interest_collected = document.getElementById('renewInterestCollected').value;
            const new_interest_rate = document.getElementById('renewInterestRate').value;
            const new_locker_location = document.getElementById('renewLockerLocation').value;
            const notes = document.getElementById('renewNotes').value;

            const oldPStr = (document.getElementById('renewOldPrincipal').textContent || '').replace(/[^0-9.]/g, '');
            const oldP = parseFloat(oldPStr) || 0;
            const type = renewPrincipalAdjustType ? renewPrincipalAdjustType.value : 'NONE';
            const adj = parseFloat(renewAdjustAmount ? renewAdjustAmount.value : 0) || 0;

            let new_principal_amount = oldP;
            if (type === 'REDUCE') {
                new_principal_amount = Math.max(0, oldP - adj);
            } else if (type === 'TOPUP') {
                new_principal_amount = oldP + adj;
            }

            try {
                const response = await fetch(`${API_URL}/customers/${customerId}/pawn/${pawnId}/renew`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        interest_collected,
                        new_principal_amount,
                        new_interest_rate,
                        new_locker_location,
                        notes
                    })
                });

                if (!response.ok) throw new Error('Failed to renew pawn receipt.');

                const data = await response.json();
                alert('✅ ' + data.message);
                if (renewPawnModal) renewPawnModal.style.display = 'none';
                fetchPawns(customerId);
                fetchDashboard();
            } catch (err) {
                console.error('Error renewing pawn:', err);
                alert('❌ Failed to renew pawn. Check console for details.');
            }
        });
    }
});
