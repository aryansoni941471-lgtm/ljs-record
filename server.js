const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
require('dotenv').config();
const { db, supabase } = require('./supabase-db');

const app = express();
const PORT = process.env.PORT || 3001;

function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Multer Setup for Photo Uploads (local temp storage)
const storage = multer.memoryStorage(); // Use memory storage, upload to Supabase Storage
const upload = multer({ storage: storage });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve portal.html (Unified Login Page) on root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'portal.html'));
});

console.log('Connected to Supabase Cloud Database.');

// Initialize interest_ledger table for permanent audit tracking
db.run(`CREATE TABLE IF NOT EXISTS interest_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pawn_id INTEGER,
    customer_name TEXT,
    customer_phone TEXT,
    item_description TEXT,
    principal_amount REAL,
    interest_amount REAL,
    payment_date TEXT,
    payment_type TEXT,
    notes TEXT,
    created_at TEXT
)`);

// API Routes

// Staff Submission API (Queues entries for Admin Approval)
app.post('/api/staff/submit', (req, res) => {
    const { type, staff_name, data } = req.body;
    if (!type || !data) {
        return res.status(400).json({ error: 'Missing type or data payload' });
    }
    const createdAt = new Date().toISOString();
    db.run(
        `INSERT INTO pending_approvals (type, staff_name, data_json, status, created_at) VALUES (?, ?, ?, 'Pending', ?)`,
        [type, staff_name || 'Staff Counter', JSON.stringify(data), createdAt],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Submitted for Admin Approval! Database will update once approved.', id: this.lastID });
        }
    );
});

// Admin Pending Approvals List API
app.get('/api/admin/pending', (req, res) => {
    db.all("SELECT * FROM pending_approvals WHERE status = 'Pending' ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const formatted = rows.map(r => ({
            ...r,
            data: JSON.parse(r.data_json || '{}')
        }));
        res.json({ pending: formatted });
    });
});

// Admin Approve Action API
app.post('/api/admin/approve/:id', (req, res) => {
    const { id } = req.params;
    db.get("SELECT * FROM pending_approvals WHERE id = ? AND status = 'Pending'", [id], (err, row) => {
        if (err || !row) return res.status(404).json({ error: 'Pending request not found or already processed' });
        
        const data = JSON.parse(row.data_json || '{}');
        
        if (row.type === 'NEW_CUSTOMER') {
            const { name, phone, email, dob } = data;
            const username = phone ? phone.trim() : 'cust_' + Date.now();
            const password = Math.floor(100000 + Math.random() * 900000).toString();
            
            db.run(
                `INSERT INTO customers (name, phone, email, dob, username, password) VALUES (?, ?, ?, ?, ?, ?)`,
                [name, phone, email || null, dob || null, username, password],
                function (err2) {
                    if (err2) return res.status(500).json({ error: err2.message });
                    db.run("UPDATE pending_approvals SET status = 'Approved' WHERE id = ?", [id]);
                    res.json({ message: 'Customer approved & added to database successfully!' });
                }
            );
        } else if (row.type === 'ADD_PAWN') {
            const { customer_id, amount, description, interest_rate, item_weight_grams, item_metal_type, is_udhari } = data;
            const dateAdded = new Date().toISOString();
            db.run(
                `INSERT INTO pawn_records (customer_id, amount, description, date_added, interest_rate, status, item_weight_grams, item_metal_type, is_udhari) VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, ?)`,
                [customer_id, amount, description, dateAdded, interest_rate || 0, item_weight_grams || 0, item_metal_type || 'Gold', is_udhari ? 1 : 0],
                function (err2) {
                    if (err2) return res.status(500).json({ error: err2.message });
                    db.run("UPDATE pending_approvals SET status = 'Approved' WHERE id = ?", [id]);
                    res.json({ message: 'Pawn record approved & saved!' });
                }
            );
        } else if (row.type === 'RECEIVE_PAYMENT') {
            const { pawn_id, amount, payment_type } = data;
            const paymentDate = new Date().toISOString();
            db.run(
                `INSERT INTO pawn_payments (pawn_id, amount, payment_type, payment_date) VALUES (?, ?, ?, ?)`,
                [pawn_id, amount, payment_type, paymentDate],
                function (err2) {
                    if (err2) return res.status(500).json({ error: err2.message });
                    db.run("UPDATE pending_approvals SET status = 'Approved' WHERE id = ?", [id]);
                    res.json({ message: 'Payment approved & recorded!' });
                }
            );
        } else {
            db.run("UPDATE pending_approvals SET status = 'Approved' WHERE id = ?", [id]);
            res.json({ message: 'Approved successfully!' });
        }
    });
});

// Admin Reject Action API
app.post('/api/admin/reject/:id', (req, res) => {
    const { id } = req.params;
    db.run("UPDATE pending_approvals SET status = 'Rejected' WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Request rejected' });
    });
});

// Get all customers
app.get('/api/customers', (req, res) => {
    db.all('SELECT * FROM customers ORDER BY id DESC', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ customers: rows });
    });
});

// Add a new customer
app.post('/api/customers', upload.single('aadhar_photo'), async (req, res) => {
    const { name, phone, email, dob, username, password } = req.body;
    const dateAdded = new Date().toISOString();
    const finalUsername = (username && username.trim()) ? username.trim() : phone.trim();
    const finalPassword = (password && password.trim()) ? password.trim() : Math.floor(100000 + Math.random() * 900000).toString();
    const qrToken = 'ljs_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

    // Upload aadhar photo to Supabase Storage if provided
    let aadharPhoto = null;
    if (req.file) {
        const ext = path.extname(req.file.originalname) || '.jpg';
        const fileName = `aadhar_${Date.now()}${ext}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
            .from('uploads')
            .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
        if (!uploadErr) {
            const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(fileName);
            aadharPhoto = urlData.publicUrl;
        } else {
            console.error('Aadhar photo upload error:', uploadErr);
        }
    }

    db.run(
        `INSERT INTO customers (name, phone, email, dob, dateAdded, aadhar_photo, username, password, qr_token, qr_active, portal_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [name, phone, email, dob, dateAdded, aadharPhoto, finalUsername, finalPassword, qrToken],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({
                message: 'Customer added successfully',
                id: this.lastID,
                username: finalUsername,
                password: finalPassword
            });
        }
    );
});

// Delete a customer (Protected by Master Security PIN)
app.delete('/api/customers/:id', (req, res) => {
    const { id } = req.params;
    const providedPin = (req.headers['x-delete-pin'] || '').toString().trim();
    const expectedPin = String(process.env.ADMIN_PASS || '121965').trim();

    if (!providedPin || providedPin !== expectedPin) {
        return res.status(401).json({ error: 'Galat Security PIN! Record delete nahi hua.' });
    }

    db.run('DELETE FROM customers WHERE id = ?', id, function (err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Customer deleted successfully' });
    });
});

// Add a pawn receipt for a customer
app.post('/api/customers/:id/pawn', upload.single('item_photo'), async (req, res) => {
    const { id } = req.params;
    const { amount, description, interest_rate, item_weight_grams, item_metal_type, is_udhari } = req.body;
    const dateAdded = new Date().toISOString();
    const rate = interest_rate || 0;
    const weight = item_weight_grams || 0;
    const metal = item_metal_type || 'Gold';
    const udhariFlag = is_udhari === 'true' ? 1 : 0;

    // Upload item photo to Supabase Storage if provided
    let itemPhoto = null;
    if (req.file) {
        const ext = path.extname(req.file.originalname) || '.jpg';
        const fileName = `item_${Date.now()}${ext}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
            .from('uploads')
            .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
        if (!uploadErr) {
            const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(fileName);
            itemPhoto = urlData.publicUrl;
        } else {
            console.error('Item photo upload error:', uploadErr);
        }
    }

    db.run(
        `INSERT INTO pawn_records (customer_id, amount, description, date_added, interest_rate, status, item_photo, item_weight_grams, item_metal_type, is_udhari) VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?)`,
        [id, amount, description, dateAdded, rate, itemPhoto, weight, metal, udhariFlag],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({
                message: 'Pawn receipt added successfully',
                id: this.lastID
            });
        }
    );
});

// Get all pawn receipts for a customer
app.get('/api/customers/:id/pawn', (req, res) => {
    const { id } = req.params;
    db.all(`
        SELECT p.*,
               COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id), 0) as total_jama
        FROM pawn_records p 
        WHERE p.customer_id = ? 
        ORDER BY p.id DESC
    `, [id], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ pawn_records: rows });
    });
});

// Release a pawn receipt
app.put('/api/customers/:id/pawn/:pawnId/release', (req, res) => {
    const { pawnId } = req.params;
    const releaseDate = new Date().toISOString();

    db.get(
        `SELECT p.*, c.name as customer_name, c.phone as customer_phone 
         FROM pawn_records p 
         LEFT JOIN customers c ON p.customer_id = c.id 
         WHERE p.id = ?`,
        [pawnId],
        (pErr, pawn) => {
            db.run(
                `UPDATE pawn_records SET status = 'Released', release_date = ? WHERE id = ?`,
                [releaseDate, pawnId],
                function (err) {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }

                    if (pawn) {
                        const calculatedInterest = calcServerPawnInterest(pawn.amount, pawn.interest_rate, pawn.date_added, 'Released', releaseDate);
                        db.run(
                            `INSERT INTO interest_ledger (pawn_id, customer_name, customer_phone, item_description, principal_amount, interest_amount, payment_date, payment_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                pawn.id,
                                pawn.customer_name || 'Customer Record',
                                pawn.customer_phone || '',
                                pawn.description || '',
                                pawn.amount || 0,
                                calculatedInterest,
                                releaseDate,
                                'Release Interest Collection',
                                'Pawn Released'
                            ]
                        );
                    }

                    res.json({ message: 'Pawn released successfully' });
                }
            );
        }
    );
});

// Melt a pawn
app.put('/api/customers/:id/pawn/:pawnId/melt', (req, res) => {
    const { pawnId } = req.params;
    const { melt_pure_weight, melt_notes } = req.body;
    const meltDate = new Date().toISOString();

    db.run(
        `UPDATE pawn_records SET status = 'Melted', melt_date = ?, melt_pure_weight = ?, melt_notes = ? WHERE id = ?`,
        [meltDate, melt_pure_weight || 0, melt_notes || '', pawnId],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Pawn marked as melted' });
        }
    );
});

// Add partial payment
app.post('/api/pawns/:pawnId/payments', (req, res) => {
    const { pawnId } = req.params;
    const { amount, payment_type } = req.body;
    const paymentDate = new Date().toISOString();

    db.get(
        `SELECT p.*, c.name as customer_name, c.phone as customer_phone 
         FROM pawn_records p 
         LEFT JOIN customers c ON p.customer_id = c.id 
         WHERE p.id = ?`,
        [pawnId],
        (pErr, pawn) => {
            db.run(
                `INSERT INTO pawn_payments (pawn_id, amount, payment_type, payment_date) VALUES (?, ?, ?, ?)`,
                [pawnId, amount, payment_type, paymentDate],
                function (err) {
                    if (err) {
                        res.status(500).json({ error: err.message });
                        return;
                    }

                    if (pawn) {
                        db.run(
                            `INSERT INTO interest_ledger (pawn_id, customer_name, customer_phone, item_description, principal_amount, interest_amount, payment_date, payment_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                pawnId,
                                pawn.customer_name || 'Customer Record',
                                pawn.customer_phone || '',
                                pawn.description || '',
                                pawn.amount || 0,
                                parseFloat(amount || 0),
                                paymentDate,
                                payment_type || 'Partial Interest Payment',
                                'Partial Payment Received'
                            ]
                        );
                    }

                    res.json({ message: 'Payment added successfully', id: this.lastID });
                }
            );
        }
    );
});

// Get partial payments for a pawn
app.get('/api/pawns/:pawnId/payments', (req, res) => {
    const { pawnId } = req.params;
    db.all('SELECT * FROM pawn_payments WHERE pawn_id = ? ORDER BY id DESC', [pawnId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ payments: rows });
    });
});

// Get Dashboard Analytics
app.get('/api/reports/dashboard', async (req, res) => {
    try {
        const data = {
            totalActivePrincipal: 0,
            totalInterestCollected: 0,
            totalReleasedItems: 0,
            overdueAccounts: [],
            highRiskAccounts: [],
            goldRate: 0,
            silverRate: 0
        };

        // Helper to promisify db.get
        const dbGet = (sql, params) => new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
        });
        const dbAll = (sql, params) => new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
        });

        // 1. Total Active Principal
        const principalRow = await dbGet(`SELECT SUM(amount) as total FROM pawn_records WHERE status = 'Active'`, []);
        if (principalRow && principalRow.total) data.totalActivePrincipal = principalRow.total;

        // 2. Total Released Items
        const releasedRow = await dbGet(`SELECT COUNT(*) as count FROM pawn_records WHERE status = 'Released'`, []);
        if (releasedRow && releasedRow.count) data.totalReleasedItems = releasedRow.count;

        // 3. Overdue Accounts (> 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const isoSixMonthsAgo = sixMonthsAgo.toISOString();
        const overdueRows = await dbAll(`
            SELECT p.*, c.name as customer_name, c.phone as customer_phone 
            FROM pawn_records p 
            JOIN customers c ON p.customer_id = c.id 
            WHERE p.status = 'Active' AND p.date_added < ?
        `, [isoSixMonthsAgo]);
        data.overdueAccounts = overdueRows;

        // 4. Total Interest Collected (from released items)
        const releasedRows = await dbAll(`SELECT * FROM pawn_records WHERE status = 'Released'`, []);
        let releasedInterest = 0;
        releasedRows.forEach(p => {
            releasedInterest += calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, 'Released', p.release_date);
        });
        data.totalInterestCollected = Math.round(releasedInterest);

        // 5. Gold & Silver Rates
        const rateRows = await dbAll(`SELECT key, value FROM settings WHERE key IN ('gold_rate', 'silver_rate')`, []);
        rateRows.forEach(r => {
            if (r.key === 'gold_rate') data.goldRate = parseFloat(r.value);
            if (r.key === 'silver_rate') data.silverRate = parseFloat(r.value);
        });

        // 6. High Risk Accounts
        const highRiskRows = await dbAll(`
            SELECT p.*, c.name as customer_name, c.phone as customer_phone,
                   COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id), 0) as total_jama
            FROM pawn_records p 
            JOIN customers c ON p.customer_id = c.id 
            WHERE p.status = 'Active' AND p.item_weight_grams > 0
        `, []);
        highRiskRows.forEach(p => {
            const interest = calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, p.status, p.release_date);
            const baki = (parseFloat(p.amount) + interest) - parseFloat(p.total_jama);
            const metalType = (p.item_metal_type || 'Gold').trim();
            const rateToUse = metalType === 'Silver' ? data.silverRate : data.goldRate;
            const marketValue = parseFloat(p.item_weight_grams) * rateToUse;
            if (rateToUse > 0 && baki > marketValue) {
                p.baki = baki;
                p.marketValue = marketValue;
                data.highRiskAccounts.push(p);
            }
        });

        res.json(data);
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get Daily Rokad
app.get('/api/reports/rokad', (req, res) => {
    const dateParam = req.query.date;
    if (!dateParam) {
        return res.status(400).json({ error: 'Date parameter is required' });
    }

    const data = {
        date: dateParam,
        newPawns: [], // Right Side (Naame)
        releasedPawns: [], // Left Side (Jama)
        payments: [], // Left Side (Jama)
        totalNaame: 0,
        totalJama: 0
    };

    db.serialize(() => {
        // 1. New Pawns (Naame)
        db.all(`
            SELECT p.*, c.name as customer_name 
            FROM pawn_records p 
            JOIN customers c ON p.customer_id = c.id 
            WHERE p.date_added LIKE ?
        `, [dateParam + '%'], (err, rows) => {
            if (rows) {
                data.newPawns = rows;
                data.totalNaame = rows.reduce((sum, row) => sum + parseFloat(row.amount), 0);
            }

            // 2. Released Pawns (Jama)
            db.all(`
                SELECT p.*, c.name as customer_name,
                COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id AND payment_date NOT LIKE ?), 0) as total_jama_before
                FROM pawn_records p 
                JOIN customers c ON p.customer_id = c.id 
                WHERE p.status = 'Released' AND p.release_date LIKE ?
            `, [dateParam + '%', dateParam + '%'], (err, releasedRows) => {
                if (releasedRows) {
                    releasedRows.forEach(p => {
                        // Calculate interest dynamically using calcServerPawnInterest
                        const interest = calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, 'Released', p.release_date);
                        
                        const principal = parseFloat(p.amount);
                        const totalJamaBefore = parseFloat(p.total_jama_before);
                        // Final collection on release day = (Principal + Interest) - what was paid BEFORE today
                        const finalCollection = (principal + interest) - totalJamaBefore;
                        
                        p.calculated_interest = interest;
                        p.final_collection = finalCollection > 0 ? finalCollection : 0;
                        data.totalJama += p.final_collection;
                        data.releasedPawns.push(p);
                    });
                }

                // 3. Partial Payments (Jama)
                db.all(`
                    SELECT pp.*, p.description, c.name as customer_name
                    FROM pawn_payments pp
                    JOIN pawn_records p ON pp.pawn_id = p.id
                    JOIN customers c ON p.customer_id = c.id
                    WHERE pp.payment_date LIKE ?
                `, [dateParam + '%'], (err, paymentRows) => {
                    if (paymentRows) {
                        data.payments = paymentRows;
                        data.totalJama += paymentRows.reduce((sum, row) => sum + parseFloat(row.amount), 0);
                    }
                    
                    res.json(data);
                });
            });
        });
    });
});

// Get Advanced Analytics
app.get('/api/reports/analytics', (req, res) => {
    const { startDate, endDate } = req.query;
    
    // Default to last 30 days if no dates provided
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date();
    if (!startDate) start.setDate(start.getDate() - 30);
    
    // Ensure the time portion covers full days
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const isoStart = start.toISOString();
    const isoEnd = end.toISOString();

    const results = {
        jama: [],
        naame: []
    };

    db.serialize(() => {
        // Naame: Money going out (New pawns)
        // Group by day of date_added
        db.all(`
            SELECT substr(date_added, 1, 10) as day, SUM(amount) as total 
            FROM pawn_records 
            WHERE date_added BETWEEN ? AND ?
            GROUP BY day
        `, [isoStart, isoEnd], (err, naameRows) => {
            if (naameRows) results.naame = naameRows;

            // Jama: Money coming in (Partial Payments + Released Items)
            // 1. Partial Payments
            db.all(`
                SELECT substr(payment_date, 1, 10) as day, SUM(amount) as total 
                FROM pawn_payments 
                WHERE payment_date BETWEEN ? AND ?
                GROUP BY day
            `, [isoStart, isoEnd], (err, paymentRows) => {
                
                // 2. Released Items (Need to calculate principal + interest minus partial payments BEFORE release date)
                db.all(`
                    SELECT p.*,
                    COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id AND payment_date < p.release_date), 0) as total_jama_before
                    FROM pawn_records p 
                    WHERE p.status = 'Released' AND p.release_date BETWEEN ? AND ?
                `, [isoStart, isoEnd], (err, releasedRows) => {
                    
                    let jamaMap = {};
                    if (paymentRows) {
                        paymentRows.forEach(r => jamaMap[r.day] = (jamaMap[r.day] || 0) + parseFloat(r.total));
                    }
                    
                    if (releasedRows) {
                        releasedRows.forEach(p => {
                            const day = p.release_date.substring(0, 10);
                            
                            // Calculate interest dynamically using calcServerPawnInterest
                            const interest = calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, 'Released', p.release_date);
                            
                            const principal = parseFloat(p.amount);
                            const totalJamaBefore = parseFloat(p.total_jama_before);
                            const finalCollection = (principal + interest) - totalJamaBefore;
                            
                            if (finalCollection > 0) {
                                jamaMap[day] = (jamaMap[day] || 0) + finalCollection;
                            }
                        });
                    }
                    
                    // Convert jamaMap to array
                    results.jama = Object.keys(jamaMap).map(day => ({ day, total: jamaMap[day] }));
                    
                    res.json(results);
                });
            });
        });
    });
});

// Export Data to CSV
app.get('/api/reports/export', (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).send("Dates are required");

    // Ensure the time portion covers full days
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    const isoStart = start.toISOString();
    const isoEnd = end.toISOString();

    const csvRows = [];
    
    // Helper to format date as DD-MM-YYYY so Excel doesn't show ###
    const formatDate = (isoString) => {
        if (!isoString) return '';
        const d = new Date(isoString);
        return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    };

    // Helper to escape ALL CSV fields properly
    const escapeCsv = (str) => `"${String(str || '').replace(/"/g, '""')}"`;

    // CSV Header (Added some spaces inside strings to encourage Excel to widen columns)
    csvRows.push(['Date', 'Customer Name', 'Description Details', 'Transaction Type', 'Money Flow', 'Amount (Rs)'].map(escapeCsv).join(','));

    db.serialize(() => {
        // 1. New Pawns (Naame)
        db.all(`SELECT p.*, c.name as customer_name FROM pawn_records p JOIN customers c ON p.customer_id = c.id WHERE p.date_added BETWEEN ? AND ?`, [isoStart, isoEnd], (err, newPawns) => {
            if (newPawns) {
                newPawns.forEach(p => {
                    csvRows.push([
                        formatDate(p.date_added), 
                        p.customer_name, 
                        p.description, 
                        'New Pawn Given', 
                        'Naame (Out)', 
                        parseFloat(p.amount).toFixed(2)
                    ].map(escapeCsv).join(','));
                });
            }

            // 2. Partial Payments (Jama)
            db.all(`SELECT py.*, c.name as customer_name FROM pawn_payments py JOIN pawn_records p ON py.pawn_id = p.id JOIN customers c ON p.customer_id = c.id WHERE py.payment_date BETWEEN ? AND ?`, [isoStart, isoEnd], (err, payments) => {
                if (payments) {
                    payments.forEach(py => {
                        csvRows.push([
                            formatDate(py.payment_date), 
                            py.customer_name, 
                            'Partial Payment', 
                            'Payment Received', 
                            'Jama (In)', 
                            parseFloat(py.amount).toFixed(2)
                        ].map(escapeCsv).join(','));
                    });
                }

                // 3. Released Items (Jama)
                db.all(`SELECT p.*, c.name as customer_name,
                        COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id AND payment_date < p.release_date), 0) as total_jama_before
                        FROM pawn_records p JOIN customers c ON p.customer_id = c.id 
                        WHERE p.status = 'Released' AND p.release_date BETWEEN ? AND ?`, [isoStart, isoEnd], (err, releasedPawns) => {
                    
                    if (releasedPawns) {
                        releasedPawns.forEach(p => {
                            // Calculate interest dynamically using calcServerPawnInterest
                            const interest = calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, 'Released', p.release_date);
                            
                            const principal = parseFloat(p.amount);
                            const totalJamaBefore = parseFloat(p.total_jama_before);
                            const finalCollection = (principal + interest) - totalJamaBefore;
                            
                            if (finalCollection > 0) {
                                csvRows.push([
                                    formatDate(p.release_date), 
                                    p.customer_name, 
                                    p.description, 
                                    'Item Released', 
                                    'Jama (In)', 
                                    finalCollection.toFixed(2)
                                ].map(escapeCsv).join(','));
                            }
                        });
                    }

                    // Sort rows by Date (The first column is Date in DD-MM-YYYY format now, we need to sort by actual date object or reverse to YYYY-MM-DD for sorting)
                    // Better to sort by extracting date part
                    const parseDateStr = (str) => {
                        const parts = str.replace(/"/g, '').split('-');
                        if(parts.length === 3) return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
                        return 0;
                    };

                    const header = csvRows.shift();
                    csvRows.sort((a, b) => parseDateStr(a.split(',')[0]) - parseDateStr(b.split(',')[0]));
                    csvRows.unshift(header);

                    // Add BOM to make Excel read UTF-8 properly (fixes some congestion/encoding issues)
                    const bom = '\uFEFF';
                    const csvString = bom + csvRows.join('\n');
                    
                    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                    res.setHeader('Content-Disposition', `attachment; filename=ljs_report_${startDate}_to_${endDate}.csv`);
                    res.status(200).send(csvString);
                });
            });
        });
    });
});

// GET Permanent Interest Ledger
app.get('/api/reports/interest-ledger', (req, res) => {
    db.all(`SELECT * FROM interest_ledger ORDER BY payment_date DESC`, [], (err, ledgerRows) => {
        const ledger = ledgerRows || [];
        
        // Fetch existing released pawns & payments to merge if any are not in ledger yet
        db.all(`SELECT p.*, c.name as customer_name, c.phone as customer_phone FROM pawn_records p LEFT JOIN customers c ON p.customer_id = c.id WHERE p.status = 'Released'`, [], (pErr, releasedRows) => {
            db.all(`SELECT pp.*, p.amount as principal_amount, p.description as item_description, c.name as customer_name, c.phone as customer_phone FROM pawn_payments pp LEFT JOIN pawn_records p ON pp.pawn_id = p.id LEFT JOIN customers c ON p.customer_id = c.id`, [], (pmtErr, paymentRows) => {
                
                const ledgerPawnIds = new Set(ledger.map(l => l.pawn_id));
                const mergedLedger = [...ledger];

                // Backfill released pawns if not in ledger
                if (releasedRows) {
                    releasedRows.forEach(p => {
                        if (!ledgerPawnIds.has(p.id)) {
                            const interest = calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, 'Released', p.release_date);
                            mergedLedger.push({
                                id: 'rel_' + p.id,
                                pawn_id: p.id,
                                customer_name: p.customer_name || 'Customer Record',
                                customer_phone: p.customer_phone || '',
                                item_description: p.description || '',
                                principal_amount: p.amount || 0,
                                interest_amount: interest,
                                payment_date: p.release_date || p.date_added,
                                payment_type: 'Release Interest Collection',
                                notes: 'Pawn Released'
                            });
                        }
                    });
                }

                // Backfill partial payments if not in ledger
                if (paymentRows) {
                    paymentRows.forEach(pm => {
                        const existsInLedger = ledger.some(l => l.pawn_id === pm.pawn_id && l.payment_date === pm.payment_date);
                        if (!existsInLedger) {
                            mergedLedger.push({
                                id: 'pmt_' + pm.id,
                                pawn_id: pm.pawn_id,
                                customer_name: pm.customer_name || 'Customer Record',
                                customer_phone: pm.customer_phone || '',
                                item_description: pm.item_description || '',
                                principal_amount: pm.principal_amount || 0,
                                interest_amount: parseFloat(pm.amount || 0),
                                payment_date: pm.payment_date,
                                payment_type: pm.payment_type || 'Partial Interest Payment',
                                notes: 'Partial Payment Received'
                            });
                        }
                    });
                }

                // Sort merged ledger descending by date
                mergedLedger.sort((a, b) => new Date(b.payment_date || 0) - new Date(a.payment_date || 0));

                const now = new Date();
                const todayStr = now.toISOString().substring(0, 10);
                const monthStr = now.toISOString().substring(0, 7);

                let totalAllTime = 0;
                let totalMonth = 0;
                let totalToday = 0;

                mergedLedger.forEach(item => {
                    const amt = parseFloat(item.interest_amount || 0);
                    totalAllTime += amt;
                    if (item.payment_date) {
                        const dStr = item.payment_date.substring(0, 10);
                        if (dStr === todayStr) totalToday += amt;
                        if (dStr.substring(0, 7) === monthStr) totalMonth += amt;
                    }
                });

                res.json({
                    totalAllTime: Math.round(totalAllTime),
                    totalMonth: Math.round(totalMonth),
                    totalToday: Math.round(totalToday),
                    ledger: mergedLedger
                });
            });
        });
    });
});

// Email Transporter Setup (moved to global scope for reuse)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Email a pawn receipt
app.post('/api/customers/:id/pawn/:pawnId/email', (req, res) => {
    const { id, pawnId } = req.params;
    
    // Fetch customer and pawn record
    db.get('SELECT * FROM customers WHERE id = ?', [id], (err, customer) => {
        if (err || !customer) return res.status(500).json({ error: 'Customer not found' });
        if (!customer.email || customer.email === 'N/A') return res.status(400).json({ error: 'Customer email is missing' });
        
        db.get('SELECT * FROM pawn_records WHERE id = ? AND customer_id = ?', [pawnId, id], (err, pawn) => {
            if (err || !pawn) return res.status(500).json({ error: 'Pawn record not found' });
            
            const dateStr = new Date(pawn.date_added).toLocaleDateString();
            
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: customer.email,
                subject: 'Your Pawn Receipt - LJS Jewellers',
                html: `
                <div style="font-family: 'Arial', sans-serif; max-width: 600px; margin: 0 auto; background-color: #fcfbf7; border: 2px solid #d4af37; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
                    <div style="background-color: #111; color: #d4af37; text-align: center; padding: 30px 20px;">
                        <h1 style="margin: 0; font-size: 28px; letter-spacing: 2px; text-transform: uppercase;">LJS Jewellers</h1>
                        <p style="margin: 5px 0 0 0; font-size: 14px; color: #a0a0a0; letter-spacing: 1px;">Trusted Since Generations</p>
                    </div>
                    
                    <div style="padding: 30px;">
                        <h2 style="color: #333; margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 10px;">Pawn Receipt</h2>
                        
                        <p style="font-size: 16px; color: #555;">Dear <strong>${customer.name}</strong>,</p>
                        <p style="font-size: 15px; color: #555; line-height: 1.5;">Thank you for trusting LJS Jewellers. Below are the details of your recent transaction:</p>
                        
                        <div style="background-color: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 25px 0;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 8px 0; color: #777; width: 40%;"><strong>Date:</strong></td>
                                    <td style="padding: 8px 0; color: #333; text-align: right;">${dateStr}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #777;"><strong>Item Description:</strong></td>
                                    <td style="padding: 8px 0; color: #333; text-align: right;">${pawn.description}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 8px 0; color: #777;"><strong>Interest Rate:</strong></td>
                                    <td style="padding: 8px 0; color: #333; text-align: right;">${pawn.interest_rate || 0}% per month</td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px 0 8px 0; color: #333; font-size: 18px; border-top: 2px dashed #eee;"><strong>Amount Given:</strong></td>
                                    <td style="padding: 12px 0 8px 0; color: #d4af37; text-align: right; font-size: 20px; font-weight: bold;">₹${pawn.amount}</td>
                                </tr>
                            </table>
                        </div>
                        
                        <div style="background-color: #f9f9f9; padding: 15px; border-left: 4px solid #d4af37; border-radius: 4px;">
                            <p style="margin: 0; font-size: 13px; color: #666; line-height: 1.4;">
                                <strong>Note:</strong> Minimum 1 month interest applies if returned within 1-5 days. Half month interest applies if returned within 6-15 days. Day-wise interest applies thereafter.
                            </p>
                        </div>
                    </div>
                    
                    <div style="background-color: #111; color: #a0a0a0; text-align: center; padding: 15px; font-size: 12px;">
                        <p style="margin: 0;">&copy; ${new Date().getFullYear()} LJS Jewellers. All rights reserved.</p>
                        <p style="margin: 5px 0 0 0;">This is an automatically generated electronic receipt.</p>
                    </div>
                </div>
                `
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Email error:', error);
                    return res.status(500).json({ error: String(error) });
                }
                res.json({ message: 'Receipt emailed successfully' });
            });
        });
    });
});

// Save Metal Rate Setting
app.post('/api/settings/rate', (req, res) => {
    const { key, rate } = req.body;
    db.run(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
        [key, rate, rate],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Rate updated successfully' });
        }
    );
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});

// ============================================
// BIRTHDAY EMAIL AUTOMATION (CRON JOB)
// ============================================

// Run every day at 8:00 AM ('0 8 * * *')
// For testing purposes, you can change it to '* * * * *' (every minute)
cron.schedule('0 8 * * *', () => {
    console.log('Running daily birthday check...');
    
    // Get today's month and day (MM-DD format)
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `-${month}-${day}`; // Matches the end of 'YYYY-MM-DD'

    db.all('SELECT * FROM customers WHERE dob LIKE ?', [`%${todayStr}`], (err, rows) => {
        if (err) {
            console.error('Error fetching birthdays:', err.message);
            return;
        }

        if (rows.length === 0) {
            console.log('No birthdays today.');
            return;
        }

        console.log(`Found ${rows.length} birthdays today!`);

        rows.forEach(customer => {
            if (customer.email && customer.email !== 'N/A') {
                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: customer.email,
                    subject: 'Happy Birthday from LJS Jewellers! 🎉',
                    html: `
                        <div style="font-family: Arial, sans-serif; text-align: center; padding: 20px; background-color: #fdfbf7;">
                            <h1 style="color: #d4af37;">Happy Birthday, ${customer.name}! 🎂</h1>
                            <p style="font-size: 16px; color: #333;">
                                Wishing you a very joyous and sparkling birthday. <br>
                                May your year ahead be as shining and beautiful as you are!
                            </p>
                            <br>
                            <p style="font-size: 14px; color: #777;">
                                Warm Regards,<br>
                                <strong>LJS Jewellers</strong>
                            </p>
                        </div>
                    `
                };

                transporter.sendMail(mailOptions, (error, info) => {
                    if (error) {
                        console.error(`Error sending email to ${customer.email}:`, error);
                    } else {
                        console.log(`Birthday email sent to ${customer.email}: ` + info.response);
                    }
                });
            } else {
                console.log(`No email address for ${customer.name}, skipped.`);
            }
        });
    });
});

// Helper for interest calculation on server
function calcServerPawnInterest(amount, rate, dateAdded, status, releaseDate) {
    rate = parseFloat(rate || 0);
    amount = parseFloat(amount || 0);
    if (rate === 0 || amount === 0) return 0;

    const start = new Date(dateAdded);
    const end = status === 'Released' && releaseDate ? new Date(releaseDate) : new Date();
    
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 0;

    const months = Math.floor(diffDays / 30);
    const extraDays = diffDays % 30;
    
    let chargeableMonths = months;
    if (extraDays >= 1 && extraDays <= 15) {
        chargeableMonths += 0.5; // 1-15 extra days = half month interest
    } else if (extraDays > 15) {
        chargeableMonths += (extraDays / 30); // >15 extra days = day-wise interest
    }

    return amount * (rate / 100) * chargeableMonths;
}

// GET Customer QR Pass Details
app.get('/api/customers/:id/qr-pass', (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM customers WHERE id = ?', [id], (err, customer) => {
        if (err || !customer) {
            console.error('Customer fetch error:', err);
            return res.status(404).json({ error: 'Customer not found' });
        }
        let token = customer.qr_token;
        if (!token) {
            token = 'ljs_' + customer.id + '_' + Math.random().toString(36).substring(2, 10);
            db.run('UPDATE customers SET qr_token = ?, qr_active = 1 WHERE id = ?', [token, customer.id], (uErr) => {
                if (uErr) console.error('Error saving qr_token:', uErr);
            });
        }
        const active = (customer.qr_active !== undefined && customer.qr_active !== null) ? customer.qr_active : 1;
        const serverIp = getLocalIpAddress();
        res.json({
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            qr_token: token,
            qr_active: active,
            server_ip: serverIp,
            port: PORT || 3001
        });
    });
});

// PUT Toggle Customer QR Pass Status (Activate/Deactivate)
app.put('/api/customers/:id/qr-status', (req, res) => {
    const { id } = req.params;
    const { qr_active } = req.body; // 1 or 0
    const newStatus = (qr_active === 1 || qr_active === true) ? 1 : 0;
    db.run('UPDATE customers SET qr_active = ? WHERE id = ?', [newStatus, id], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, qr_active: newStatus });
    });
});

// GET Public Passbook Ledger by Token
app.get('/api/passbook/:token', (req, res) => {
    const { token } = req.params;
    db.get('SELECT * FROM customers WHERE qr_token = ?', [token], (err, customer) => {
        if (err || !customer) {
            return res.status(404).json({ active: false, error: 'Passbook link invalid or expired' });
        }
        if (customer.qr_active === 0) {
            return res.json({
                active: false,
                customer: { name: customer.name },
                message: 'This passbook has been deactivated by LJS Jewellers.'
            });
        }
        // Fetch pawns for this customer
        db.all('SELECT * FROM pawn_records WHERE customer_id = ? ORDER BY id DESC', [customer.id], (err, pawns) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            const pawnIds = (pawns || []).map(p => p.id);
            if (pawnIds.length === 0) {
                return res.json({
                    active: true,
                    customer: { name: customer.name, phone: customer.phone },
                    pawns: [],
                    totalPrincipal: 0,
                    totalInterest: 0,
                    totalJama: 0,
                    netBalance: 0
                });
            }
            db.all(`SELECT * FROM pawn_payments WHERE pawn_id IN (${pawnIds.join(',')})`, [], (err, payments) => {
                const paymentsByPawn = {};
                (payments || []).forEach(pm => {
                    if (!paymentsByPawn[pm.pawn_id]) paymentsByPawn[pm.pawn_id] = 0;
                    paymentsByPawn[pm.pawn_id] += pm.amount;
                });

                let totalPrincipal = 0;
                let totalInterest = 0;
                let totalJama = 0;

                const formattedPawns = pawns.map(p => {
                    const interest = calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, p.status, p.release_date);
                    const paid = paymentsByPawn[p.id] || 0;
                    const baki = (p.amount + interest) - paid;

                    if (p.status === 'Active') {
                        totalPrincipal += p.amount;
                        totalInterest += interest;
                        totalJama += paid;
                    }

                    return {
                        id: p.id,
                        description: p.description,
                        amount: p.amount,
                        interest_rate: p.interest_rate,
                        calculated_interest: Math.round(interest),
                        paid: Math.round(paid),
                        baki: Math.max(0, Math.round(baki)),
                        status: p.status,
                        date_added: p.date_added,
                        item_metal_type: p.item_metal_type || 'Gold',
                        item_weight_grams: p.item_weight_grams || 0,
                        item_photo: p.item_photo,
                        is_udhari: p.is_udhari
                    };
                });

                const netBalance = Math.round((totalPrincipal + totalInterest) - totalJama);

                res.json({
                    active: true,
                    customer: {
                        name: customer.name,
                        phone: customer.phone
                    },
                    pawns: formattedPawns,
                    totalPrincipal: Math.round(totalPrincipal),
                    totalInterest: Math.round(totalInterest),
                    totalJama: Math.round(totalJama),
                    netBalance: Math.max(0, netBalance)
                });
            });
        });
    });
});

// GET Common Counter QR URL
app.get('/api/system/common-qr', (req, res) => {
    const serverIp = getLocalIpAddress();
    const port = PORT || 3001;
    res.json({
        server_ip: serverIp,
        port: port,
        portal_url: `http://${serverIp}:${port}/portal.html`
    });
});

// POST Customer Portal Login
app.post('/api/portal/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Please enter Username/Phone and Password/PIN.' });
    }

    const cleanInput = username.trim();
    const cleanPwd = password.trim();
    const phoneClean = cleanInput.replace(/[^0-9]/g, '');

    // Check Admin Login (Support 'jitendra' / '121965' or env variables)
    const adminUser = String(process.env.ADMIN_USER || 'jitendra').trim().toLowerCase();
    const adminPass = String(process.env.ADMIN_PASS || process.env.DELETE_PIN || '121965').trim();
    if (cleanInput.toLowerCase() === adminUser && String(cleanPwd).trim() === adminPass) {
        return res.json({
            role: 'admin',
            message: 'Admin login successful'
        });
    }

    db.get(
        'SELECT * FROM customers WHERE (username = ? OR phone = ? OR REPLACE(phone, " ", "") = ? OR REPLACE(phone, "-", "") = ?) AND password = ?',
        [cleanInput, cleanInput, phoneClean, phoneClean, cleanPwd],
        (err, customer) => {
            if (err) {
                console.error('Portal Login Error:', err);
                return res.status(500).json({ error: 'Database query error.' });
            }
            if (!customer) {
                return res.status(401).json({ error: 'Invalid Username/Phone or Password/PIN.' });
            }

            if (customer.portal_active === 0) {
                return res.status(403).json({
                    active: false,
                    error: 'Your Portal Access has been deactivated by LJS Jewellers.'
                });
            }

            // Fetch pawns & payments for customer
            db.all('SELECT * FROM pawn_records WHERE customer_id = ? ORDER BY id DESC', [customer.id], (err, pawns) => {
                if (err) return res.status(500).json({ error: err.message });
                const pawnIds = (pawns || []).map(p => p.id);
                if (pawnIds.length === 0) {
                    return res.json({
                        active: true,
                        customer: { id: customer.id, name: customer.name, phone: customer.phone, username: customer.username },
                        pawns: [],
                        totalPrincipal: 0,
                        totalInterest: 0,
                        totalJama: 0,
                        netBalance: 0
                    });
                }

                db.all(`SELECT * FROM pawn_payments WHERE pawn_id IN (${pawnIds.join(',')})`, [], (err, payments) => {
                    const paymentsByPawn = {};
                    const paymentsListByPawn = {};
                    (payments || []).forEach(pm => {
                        if (!paymentsByPawn[pm.pawn_id]) paymentsByPawn[pm.pawn_id] = 0;
                        paymentsByPawn[pm.pawn_id] += pm.amount;

                        if (!paymentsListByPawn[pm.pawn_id]) paymentsListByPawn[pm.pawn_id] = [];
                        paymentsListByPawn[pm.pawn_id].push({
                            id: pm.id,
                            amount: pm.amount,
                            payment_type: pm.payment_type || 'Jama',
                            payment_date: pm.payment_date
                        });
                    });

                    let totalPrincipal = 0;
                    let totalInterest = 0;
                    let totalJama = 0;

                    const formattedPawns = pawns.map(p => {
                        const interest = calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, p.status, p.release_date);
                        const paid = paymentsByPawn[p.id] || 0;
                        const baki = (p.amount + interest) - paid;

                        if (p.status === 'Active') {
                            totalPrincipal += p.amount;
                            totalInterest += interest;
                            totalJama += paid;
                        }

                        return {
                            id: p.id,
                            description: p.description,
                            amount: p.amount,
                            interest_rate: p.interest_rate,
                            calculated_interest: Math.round(interest),
                            paid: Math.round(paid),
                            baki: Math.max(0, Math.round(baki)),
                            status: p.status,
                            date_added: p.date_added,
                            item_metal_type: p.item_metal_type || 'Gold',
                            item_weight_grams: p.item_weight_grams || 0,
                            item_photo: p.item_photo,
                            is_udhari: p.is_udhari,
                            payments: paymentsListByPawn[p.id] || []
                        };
                    });

                    const netBalance = Math.round((totalPrincipal + totalInterest) - totalJama);

                    res.json({
                        role: 'customer',
                        active: true,
                        customer: {
                            id: customer.id,
                            name: customer.name,
                            phone: customer.phone,
                            username: customer.username
                        },
                        pawns: formattedPawns,
                        totalPrincipal: Math.round(totalPrincipal),
                        totalInterest: Math.round(totalInterest),
                        totalJama: Math.round(totalJama),
                        netBalance: Math.max(0, netBalance)
                    });
                });
            });
        }
    );
});

// PUT Toggle Customer Portal Access (Activate/Deactivate)
app.put('/api/customers/:id/portal-status', (req, res) => {
    const { id } = req.params;
    const { portal_active } = req.body;
    const status = (portal_active === 1 || portal_active === true) ? 1 : 0;
    db.run('UPDATE customers SET portal_active = ? WHERE id = ?', [status, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, portal_active: status });
    });
});

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        const ip = getLocalIpAddress();
        console.log(`Server is running locally at http://localhost:${PORT}`);
        console.log(`Mobile/Network access URL: http://${ip}:${PORT}`);
    });
}

module.exports = app;

