/**
 * LJS JEWELLERS - ADMIN AI COPILOT (SMART ASSISTANT)
 * Safe, read-only financial query engine & conversational intelligence.
 */

function formatInr(val) {
    return '₹' + Math.round(Number(val || 0)).toLocaleString('en-IN');
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
        return dateStr;
    }
}

function getDaysAndMonths(startDateStr) {
    if (!startDateStr) return { days: 0, months: 0 };
    const start = new Date(startDateStr);
    const now = new Date();
    const diffTime = Math.max(0, now - start);
    const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const months = (days / 30).toFixed(1);
    return { days, months: parseFloat(months) };
}

async function processAdminAssistantQuery({ prompt, db, calculateInterest }) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return {
            success: false,
            message: 'Kripya apna sawal ya hisab prompt likhein (jaise: "Ramesh ka hisab", "Aaj ka rokad", "6 mahine se purani girvi").'
        };
    }

    const rawPrompt = prompt.trim();
    const cleanLower = rawPrompt.toLowerCase();

    // Helper to fetch all rows asynchronously from SQLite / Supabase wrapper
    const queryAll = (sql, params = []) => {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    };

    try {
        // Load core data snapshots for safe read-only intelligence
        const [customers, pawns, payments, settings] = await Promise.all([
            queryAll('SELECT * FROM customers ORDER BY id DESC'),
            queryAll('SELECT * FROM pawn_records'),
            queryAll('SELECT * FROM pawn_payments'),
            queryAll('SELECT * FROM settings')
        ]);

        const settingsMap = {};
        (settings || []).forEach(s => { settingsMap[s.key] = s.value; });
        const goldRate = parseFloat(settingsMap['gold_rate'] || 6500);
        const silverRate = parseFloat(settingsMap['silver_rate'] || 85);

        // Group pawns by customer
        const pawnsByCustomer = {};
        (pawns || []).forEach(p => {
            if (!pawnsByCustomer[p.customer_id]) pawnsByCustomer[p.customer_id] = [];
            pawnsByCustomer[p.customer_id].push(p);
        });

        // Group payments by pawn
        const paymentsByPawn = {};
        (payments || []).forEach(pay => {
            if (!paymentsByPawn[pay.pawn_id]) paymentsByPawn[pay.pawn_id] = [];
            paymentsByPawn[pay.pawn_id].push(pay);
        });

        // -------------------------------------------------------------
        // CHECK 1: DIRECT CUSTOMER MATCH (NAME OR PHONE NUMBER)
        // Check if query directly mentions any existing customer
        // -------------------------------------------------------------
        const phoneMatch = cleanLower.match(/\b\d{10}\b/) || cleanLower.match(/\b\d{4,9}\b/);
        let matchedCustomer = null;

        if (phoneMatch) {
            matchedCustomer = customers.find(c => (c.phone || '').includes(phoneMatch[0]));
        }

        if (!matchedCustomer) {
            // Find by matching customer name in prompt
            // Sort customer names by longest first to avoid partial conflicts (e.g. 'Aryan soni' before 'Aryan')
            const sortedCustomers = [...customers].sort((a, b) => (b.name || '').length - (a.name || '').length);
            
            for (const cust of sortedCustomers) {
                const cName = (cust.name || '').toLowerCase().trim();
                if (!cName || cName.length < 2) continue;

                // Check full name match
                if (cleanLower.includes(cName)) {
                    matchedCustomer = cust;
                    break;
                }

                // Check first name match (e.g. "ankit", "bhavishya", "kamal")
                const parts = cName.split(/\s+/);
                const firstName = parts[0];
                if (firstName && firstName.length >= 3 && cleanLower.split(/\s+/).includes(firstName)) {
                    matchedCustomer = cust;
                    break;
                }
            }
        }

        // If customer found and not asking explicitly for global portfolio or rokad
        const isExplicitGlobal = /aaj ka rokad|today collection|total market|portfolio|all customers|sabka hisab/i.test(cleanLower);
        if (matchedCustomer && !isExplicitGlobal) {
            const primaryCustomer = matchedCustomer;
            const custPawns = pawnsByCustomer[primaryCustomer.id] || [];
            const activeCustPawns = custPawns.filter(p => p.status === 'Active');
            const releasedCustPawns = custPawns.filter(p => p.status === 'Released');

            let totalActiveLoan = 0;
            let totalAccruedInterest = 0;
            let totalPaidInterest = 0;

            const pawnDetails = activeCustPawns.map(p => {
                const principal = parseFloat(p.amount || 0);
                const rate = parseFloat(p.monthly_interest_rate || p.interest_rate || 0);
                const interest = calculateInterest(principal, rate, p.date_added, 'Active', null);
                
                // Only count payments made after the last cycle reset (p.date_added)
                const pDate = p.date_added ? new Date(p.date_added) : new Date(0);
                const activeCyclePayments = (paymentsByPawn[p.id] || []).filter(pay => {
                    if (!pay.payment_date) return false;
                    return new Date(pay.payment_date) > pDate;
                });
                const paid = activeCyclePayments.reduce((sum, pay) => sum + parseFloat(pay.amount || 0), 0);
                const netDue = Math.max(0, interest - paid);
                
                totalActiveLoan += principal;
                totalAccruedInterest += interest;
                totalPaidInterest += paid;

                const { days, months } = getDaysAndMonths(p.date_added);

                return {
                    pawnId: p.id,
                    description: p.description || 'Gehna / Jewellery',
                    principal,
                    rate,
                    dateAdded: p.date_added,
                    days,
                    months,
                    interest,
                    paid,
                    netDue,
                    totalPawnDue: principal + netDue,
                    purity: p.purity || 'N/A',
                    weight: p.gross_weight || p.item_weight_grams || p.weight || 'N/A',
                    photo: p.item_photo || null
                };
            });

            const netTotalCustomerDue = totalActiveLoan + Math.max(0, totalAccruedInterest - totalPaidInterest);

            let summaryText = `👤 **Customer Hisab: ${primaryCustomer.name}**\n`;
            summaryText += `📞 Phone: ${primaryCustomer.phone || 'N/A'} | 🏠 Address: ${primaryCustomer.address || 'N/A'}\n\n`;
            summaryText += `💰 **Total Active Principal:** ${formatInr(totalActiveLoan)}\n`;
            summaryText += `📈 **Current Due Interest:** ${formatInr(Math.max(0, totalAccruedInterest - totalPaidInterest))}\n`;
            summaryText += `🔴 **Total Net Payable Till Today:** ${formatInr(netTotalCustomerDue)}\n\n`;
            
            if (activeCustPawns.length === 0) {
                summaryText += `✅ Is customer ka koi active girvi record nahi hai. (Pehle ${releasedCustPawns.length} girvi chhudwayi ja chuki hain).\n`;
            } else {
                summaryText += `**Active Pledged Items (${activeCustPawns.length}):**\n`;
                pawnDetails.forEach((pd, i) => {
                    summaryText += `${i + 1}. **${pd.description}**\n`;
                    summaryText += `   • Loan: ${formatInr(pd.principal)} @ ${pd.rate}%/mo\n`;
                    summaryText += `   • Duration: ${pd.months} Months (${pd.days} Days)\n`;
                    summaryText += `   • Interest Due: ${formatInr(pd.netDue)} | Total: ${formatInr(pd.totalPawnDue)}\n`;
                });
            }

            return {
                success: true,
                intent: 'customer_lookup',
                summary: summaryText,
                customer: {
                    id: primaryCustomer.id,
                    name: primaryCustomer.name,
                    phone: primaryCustomer.phone,
                    address: primaryCustomer.address,
                    totalActiveLoan,
                    totalDueInterest: Math.max(0, totalAccruedInterest - totalPaidInterest),
                    netTotalCustomerDue,
                    activePawnsCount: activeCustPawns.length,
                    releasedPawnsCount: releasedCustPawns.length,
                    pawnDetails
                },
                cards: [
                    {
                        type: 'customer_profile_card',
                        customer: primaryCustomer,
                        totalActiveLoan,
                        netTotalCustomerDue,
                        pawnDetails
                    }
                ],
                quickActions: [
                    { label: `👁️ Open ${primaryCustomer.name}'s Profile`, action: 'open_customer', customerId: primaryCustomer.id },
                    { label: `💬 WhatsApp Hisab Slip`, action: 'whatsapp_customer', phone: primaryCustomer.phone, name: primaryCustomer.name, totalDue: netTotalCustomerDue }
                ]
            };
        }

        // -------------------------------------------------------------
        // INTENT 2: ROKAD / DAILY CASHFLOW SUMMARY
        // Keywords: rokad, cashbook, aaj ka hisab, today, collection, jama, naame
        // -------------------------------------------------------------
        const isRokadQuery = /rokad|cashbook|aaj ka (hisab|collection|jama)|today collection|collection kitna|aaj kitna aaya/i.test(cleanLower);
        if (isRokadQuery) {
            const todayStr = new Date().toISOString().split('T')[0];
            const targetDate = todayStr;

            const todayNewPawns = pawns.filter(p => (p.date_added || '').startsWith(targetDate));
            const todayReleasedPawns = pawns.filter(p => p.status === 'Released' && (p.release_date || '').startsWith(targetDate));
            const todayPayments = payments.filter(pay => (pay.payment_date || '').startsWith(targetDate));

            let totalNaame = todayNewPawns.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
            let totalJamaFromPayments = todayPayments.reduce((sum, pay) => sum + parseFloat(pay.amount || 0), 0);
            
            let totalJamaFromReleases = 0;
            const releasedDetails = todayReleasedPawns.map(p => {
                const interest = calculateInterest(p.amount, p.monthly_interest_rate || p.interest_rate, p.date_added, 'Released', p.release_date);
                const principal = parseFloat(p.amount || 0);
                const prevPayments = (paymentsByPawn[p.id] || [])
                    .filter(pay => !(pay.payment_date || '').startsWith(targetDate))
                    .reduce((s, pay) => s + parseFloat(pay.amount || 0), 0);
                const finalAmt = Math.max(0, (principal + interest) - prevPayments);
                totalJamaFromReleases += finalAmt;
                const cust = customers.find(c => c.id === p.customer_id);
                return {
                    pawnId: p.id,
                    customerName: cust ? cust.name : 'Unknown',
                    item: p.description,
                    principal,
                    interest,
                    finalAmt
                };
            });

            const totalJama = totalJamaFromPayments + totalJamaFromReleases;
            const netCashFlow = totalJama - totalNaame;

            let summaryText = `📊 **Aaj Ka Rokad (Cashbook) Summary (${formatDate(todayStr)})**\n\n`;
            summaryText += `🟢 **Total Jama (Inflow):** ${formatInr(totalJama)}\n`;
            summaryText += `   • Byaj/Partial Payments: ${formatInr(totalJamaFromPayments)} (${todayPayments.length} entries)\n`;
            summaryText += `   • Released Pawns Collection: ${formatInr(totalJamaFromReleases)} (${todayReleasedPawns.length} items)\n\n`;
            summaryText += `🔴 **Total Naame (Outflow - Nayi Girvi):** ${formatInr(totalNaame)} (${todayNewPawns.length} new pawns)\n\n`;
            summaryText += `💎 **Net Cash Flow Today:** ${netCashFlow >= 0 ? '+' : ''}${formatInr(netCashFlow)} (${netCashFlow >= 0 ? 'Surplus Inflow' : 'Net Disbursed'})\n`;

            return {
                success: true,
                intent: 'rokad_summary',
                summary: summaryText,
                cards: [
                    {
                        type: 'rokad_stat',
                        totalJama,
                        totalNaame,
                        netCashFlow,
                        paymentsCount: todayPayments.length,
                        newPawnsCount: todayNewPawns.length,
                        releasedCount: todayReleasedPawns.length,
                        date: todayStr
                    }
                ],
                quickActions: [
                    { label: '📖 Open Full Rokad Tab', action: 'navigate_tab', tab: 'rokad' },
                    { label: '🔄 Refresh Today Summary', action: 'send_prompt', prompt: 'Aaj ka rokad summary' }
                ]
            };
        }

        // -------------------------------------------------------------
        // INTENT 3: OVERDUE / DEFAULTERS / PENDING INTEREST
        // Keywords: overdue, defaulter, baki byaj, 6 mahine, 3 mahine, 1 saal, purani girvi, nahi diya
        // -------------------------------------------------------------
        const isOverdueQuery = /overdue|defaulter|baki byaj|purani girvi|nahi diya|pending byaj|warning|6 mahine|3 mahine|1 saal|saal bhar/i.test(cleanLower);
        if (isOverdueQuery) {
            let thresholdMonths = 6;
            if (/3 mahine|3 months/i.test(cleanLower)) thresholdMonths = 3;
            if (/1 saal|12 mahine|1 year/i.test(cleanLower)) thresholdMonths = 12;

            const activePawns = pawns.filter(p => p.status === 'Active');
            const overdueList = [];

            activePawns.forEach(p => {
                const { days, months } = getDaysAndMonths(p.date_added);
                if (months >= thresholdMonths) {
                    const cust = customers.find(c => c.id === p.customer_id);
                    const rate = parseFloat(p.monthly_interest_rate || p.interest_rate || 0);
                    const principal = parseFloat(p.amount || 0);
                    const accruedInterest = calculateInterest(principal, rate, p.date_added, 'Active', null);
                    
                    const pDate = p.date_added ? new Date(p.date_added) : new Date(0);
                    const paidTillNow = (paymentsByPawn[p.id] || [])
                        .filter(pay => pay.payment_date && new Date(pay.payment_date) > pDate)
                        .reduce((sum, pay) => sum + parseFloat(pay.amount || 0), 0);
                    const netDueInterest = Math.max(0, accruedInterest - paidTillNow);
                    const totalDue = principal + netDueInterest;

                    overdueList.push({
                        pawnId: p.id,
                        customerId: p.customer_id,
                        customerName: cust ? cust.name : 'Unknown',
                        phone: cust ? cust.phone : '',
                        item: p.description || 'Jewellery',
                        principal,
                        interestRate: rate,
                        accruedInterest,
                        paidTillNow,
                        netDueInterest,
                        totalDue,
                        months,
                        days,
                        dateAdded: p.date_added
                    });
                }
            });

            // Sort by highest overdue months and then total due amount
            overdueList.sort((a, b) => b.months - a.months || b.totalDue - a.totalDue);

            let totalRiskAmount = overdueList.reduce((sum, item) => sum + item.principal, 0);
            let totalUnpaidInterest = overdueList.reduce((sum, item) => sum + item.netDueInterest, 0);

            let summaryText = `🚨 **${thresholdMonths}+ Mahine Purani Overdue Girvi List (${overdueList.length} Records)**\n\n`;
            summaryText += `💰 **Total Principal at Risk:** ${formatInr(totalRiskAmount)}\n`;
            summaryText += `📈 **Total Unpaid Interest Due:** ${formatInr(totalUnpaidInterest)}\n\n`;

            if (overdueList.length === 0) {
                summaryText += `✅ Badhai ho! Koi bhi active girvi ${thresholdMonths} mahine se overdue nahi hai.`;
            } else {
                summaryText += `**Top Overdue Accounts:**\n`;
                overdueList.slice(0, 5).forEach((item, idx) => {
                    summaryText += `${idx + 1}. **${item.customerName}** (${item.phone || 'No Phone'})\n`;
                    summaryText += `   • Item: ${item.item} | Principal: ${formatInr(item.principal)} | Byaj: ${formatInr(item.netDueInterest)}\n`;
                    summaryText += `   • Overdue Duration: **${item.months} Months** (${item.days} Din Purani)\n`;
                });
            }

            return {
                success: true,
                intent: 'overdue_list',
                summary: summaryText,
                cards: overdueList.slice(0, 10).map(item => ({
                    type: 'overdue_card',
                    ...item
                })),
                quickActions: [
                    { label: '⏳ Open Recovery Hub', action: 'navigate_tab', tab: 'recovery' },
                    { label: '🚨 Check 12+ Months (Critical)', action: 'send_prompt', prompt: '1 saal purani overdue girvi' }
                ]
            };
        }

        // -------------------------------------------------------------
        // INTENT 4: PORTFOLIO / BUSINESS HEALTH SNAPSHOT
        // Keywords: portfolio, total market, total paisa, kitna laga hai, overview, health, summary dukaan
        // -------------------------------------------------------------
        const isPortfolioQuery = /portfolio|total market|kitna paisa|paisa laga hai|market me|business health|total girvi|summary|overall hisab|top (borrower|customer|loan)/i.test(cleanLower);
        if (isPortfolioQuery) {
            const activePawns = pawns.filter(p => p.status === 'Active');
            const releasedPawns = pawns.filter(p => p.status === 'Released');
            
            const totalActivePrincipal = activePawns.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
            const totalReleasedPrincipal = releasedPawns.reduce((s, p) => s + parseFloat(p.amount || 0), 0);

            // Active customers with at least 1 active pawn
            const activeCustomerIds = new Set(activePawns.map(p => p.customer_id));

            // Estimated monthly interest revenue across all active pawns
            let estMonthlyInterest = 0;
            let totalGoldItems = 0;
            let totalSilverItems = 0;

            activePawns.forEach(p => {
                const amt = parseFloat(p.amount || 0);
                const rate = parseFloat(p.monthly_interest_rate || p.interest_rate || 0);
                estMonthlyInterest += amt * (rate / 100);

                const desc = (p.description || '').toLowerCase();
                if (desc.includes('silver') || desc.includes('chandi') || desc.includes('payal') || desc.includes('kade')) {
                    totalSilverItems++;
                } else {
                    totalGoldItems++;
                }
            });

            // Top 5 borrowers
            const customerLoanTotals = {};
            activePawns.forEach(p => {
                customerLoanTotals[p.customer_id] = (customerLoanTotals[p.customer_id] || 0) + parseFloat(p.amount || 0);
            });

            const topBorrowers = Object.keys(customerLoanTotals)
                .map(custId => {
                    const cust = customers.find(c => c.id === parseInt(custId));
                    return {
                        customerId: parseInt(custId),
                        name: cust ? cust.name : 'Unknown',
                        phone: cust ? cust.phone : '',
                        totalLoan: customerLoanTotals[custId]
                    };
                })
                .sort((a, b) => b.totalLoan - a.totalLoan)
                .slice(0, 5);

            let summaryText = `💎 **LJS Jewellers - Business & Portfolio Health Snapshot**\n\n`;
            summaryText += `💰 **Active Market Capital (Lending):** ${formatInr(totalActivePrincipal)}\n`;
            summaryText += `📈 **Estimated Monthly Interest Income:** ${formatInr(estMonthlyInterest)} / Month\n`;
            summaryText += `👥 **Active Borrowers:** ${activeCustomerIds.size} Customers (${activePawns.length} Active Girvi)\n`;
            summaryText += `📦 **Item Breakdown:** ${totalGoldItems} Gold Items | ${totalSilverItems} Silver Items\n`;
            summaryText += `⚡ **Live Metal Rates:** Gold ₹${goldRate}/g | Silver ₹${silverRate}/g\n\n`;
            
            summaryText += `👑 **Top 5 Highest Borrowers:**\n`;
            topBorrowers.forEach((b, idx) => {
                summaryText += `${idx + 1}. **${b.name}** (${b.phone || 'No phone'}): ${formatInr(b.totalLoan)}\n`;
            });

            return {
                success: true,
                intent: 'portfolio_health',
                summary: summaryText,
                cards: [
                    {
                        type: 'portfolio_stat',
                        totalActivePrincipal,
                        totalReleasedPrincipal,
                        activeCustomersCount: activeCustomerIds.size,
                        activePawnsCount: activePawns.length,
                        estMonthlyInterest,
                        totalGoldItems,
                        totalSilverItems,
                        goldRate,
                        silverRate,
                        topBorrowers
                    }
                ],
                quickActions: [
                    { label: '📊 View Analytics Charts', action: 'navigate_tab', tab: 'analytics' },
                    { label: '🚨 Check Overdue Accounts', action: 'send_prompt', prompt: '6 mahine se purani overdue girvi' }
                ]
            };
        }

        // -------------------------------------------------------------
        // INTENT 5: METAL RATES & VALUATION CALCULATOR
        // Keywords: rate, bhav, 22k, 24k, 18k, gram, gm, valuation, kimat
        // -------------------------------------------------------------
        const isRateQuery = /gold rate|silver rate|aaj ka (bhav|rate)|metal rate|valuation|purity|22k|18k|24k/i.test(cleanLower);
        if (isRateQuery) {
            const weightMatch = cleanLower.match(/(\d+(\.\d+)?)\s*(gram|g|gm|tola)/i);
            const weight = weightMatch ? parseFloat(weightMatch[1]) : null;
            const isSilver = /silver|chandi/i.test(cleanLower);

            let valuationBlock = '';
            if (weight && weight > 0) {
                const baseRate = isSilver ? silverRate : goldRate;
                let purityMultiplier = 1.0;
                if (/18k|18 carat/i.test(cleanLower)) purityMultiplier = 0.75;
                else if (/20k|20 carat/i.test(cleanLower)) purityMultiplier = 0.833;
                else if (/22k|22 carat|916/i.test(cleanLower)) purityMultiplier = 0.916;
                else if (/24k|24 carat|999/i.test(cleanLower)) purityMultiplier = 1.0;

                const effectiveRate = baseRate * purityMultiplier;
                const marketValue = Math.round(weight * effectiveRate);
                const safeLoan75 = Math.round(marketValue * 0.75);

                valuationBlock = `\n\n⚖️ **Estimated Valuation for ${weight}g (${isSilver ? 'Silver' : 'Gold'}):**\n` +
                    `• Market Value: **${formatInr(marketValue)}**\n` +
                    `• Max Safe Loan (75% LTV): **${formatInr(safeLoan75)}**`;
            }

            let summaryText = `⚡ **Live Metal Rates (Dukaan Rates):**\n` +
                `• 🪙 **Gold Rate:** ₹${goldRate} / gram (₹${goldRate * 10} / 10g)\n` +
                `• 🥈 **Silver Rate:** ₹${silverRate} / gram (₹${silverRate * 1000} / 1kg)` +
                valuationBlock;

            return {
                success: true,
                intent: 'rate_calculator',
                summary: summaryText,
                cards: [
                    {
                        type: 'rates_card',
                        goldRate,
                        silverRate
                    }
                ],
                quickActions: [
                    { label: '💰 Portfolio Market Value', action: 'send_prompt', prompt: 'Total market me kitna paisa laga hai' }
                ]
            };
        }

        // -------------------------------------------------------------
        // INTENT 6: ITEM / GENERAL SEARCH
        // Search by item description (e.g. "haar", "chain", "ring")
        // -------------------------------------------------------------
        const cleanSearchTerm = cleanLower.replace(/\b(ka|ki|ke|ko|se|hisab|batao|dikhao|check|girvi|balance|details|karo|bhai|ji|admin|please)\b/gi, '').trim();
        const matchedPawns = cleanSearchTerm.length >= 3 ? pawns.filter(p => {
            const desc = (p.description || '').toLowerCase();
            return desc.includes(cleanSearchTerm);
        }) : [];

        if (matchedPawns.length > 0) {
            let summaryText = `🔍 **Item Search Results for "${rawPrompt}" (${matchedPawns.length} Records Found):**\n\n`;
            matchedPawns.slice(0, 6).forEach((p, idx) => {
                const cust = customers.find(c => c.id === p.customer_id);
                const statusBadge = p.status === 'Active' ? '🟢 Active' : '⚪ ' + p.status;
                summaryText += `${idx + 1}. **${p.description}** (${statusBadge})\n`;
                summaryText += `   • Customer: **${cust ? cust.name : 'Unknown'}** (${cust ? cust.phone : 'N/A'})\n`;
                summaryText += `   • Loan: ${formatInr(p.amount)} | Date: ${formatDate(p.date_added)}\n`;
            });

            return {
                success: true,
                intent: 'item_search',
                summary: summaryText,
                cards: matchedPawns.slice(0, 6).map(p => {
                    const cust = customers.find(c => c.id === p.customer_id);
                    return {
                        type: 'item_card',
                        pawn: p,
                        customer: cust
                    };
                }),
                quickActions: [
                    { label: '📊 View Portfolio', action: 'send_prompt', prompt: 'Portfolio summary' }
                ]
            };
        }

        // -------------------------------------------------------------
        // DEFAULT FALLBACK: SMART HELP GUIDANCE
        // -------------------------------------------------------------
        return {
            success: true,
            intent: 'general_help',
            summary: `🤖 **AI Munimji - Main aapki kaise madad kar sakta hu?**\n\nAap niche diye gaye prompts type ya bol sakte hain:\n\n` +
                `1. **Customer Hisab:** *"ankit ka hisab"*, *"bhavishya ka hisab"*, *"9216953892 ka balance"*\n` +
                `2. **Daily Rokad:** *"Aaj ka rokad summary"* ya *"Today collection"*\n` +
                `3. **Overdue / Defaulters:** *"6 mahine se purani overdue girvi"*\n` +
                `4. **Business Snapshot:** *"Total market me kitna paisa laga hai?"*\n` +
                `5. **Gold/Silver Rates:** *"Aaj ka gold rate"* ya *"15g 22k gold valuation"*`,
            cards: [],
            quickActions: [
                { label: '📊 Aaj Ka Rokad', action: 'send_prompt', prompt: 'Aaj ka rokad summary' },
                { label: '🚨 6+ Mahine Overdue', action: 'send_prompt', prompt: '6 mahine se purani girvi' },
                { label: '💎 Portfolio Snapshot', action: 'send_prompt', prompt: 'Total market me kitna paisa laga hai' },
                { label: '🪙 Metal Rates', action: 'send_prompt', prompt: 'Aaj ka gold rate' }
            ]
        };

    } catch (err) {
        console.error('Error in processAdminAssistantQuery:', err);
        return {
            success: false,
            message: 'Server error processing AI assistant query: ' + err.message
        };
    }
}

module.exports = {
    processAdminAssistantQuery
};
