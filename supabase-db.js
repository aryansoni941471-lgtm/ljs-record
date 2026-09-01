const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';

let supabase = null;
if (supabaseUrl && supabaseKey) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
    } catch (e) {
        console.error('Supabase client init error:', e.message);
    }
} else {
    console.error('CRITICAL: SUPABASE_URL or SUPABASE_KEY missing in environment variables.');
}

const db = {
    serialize: function(cb) {
        if (cb) cb();
    },

    all: async function(sql, params = [], cb) {
        if (typeof params === 'function') {
            cb = params;
            params = [];
        }
        try {
            const rows = await handleQuery(sql, params);
            if (cb) cb(null, rows || []);
        } catch (err) {
            console.error('Supabase DB Error (all):', err, 'SQL:', sql);
            if (cb) cb(err, []);
        }
    },

    get: async function(sql, params = [], cb) {
        if (typeof params === 'function') {
            cb = params;
            params = [];
        }
        try {
            const rows = await handleQuery(sql, params);
            const row = (rows && rows.length > 0) ? rows[0] : null;
            if (cb) cb(null, row);
        } catch (err) {
            console.error('Supabase DB Error (get):', err, 'SQL:', sql);
            if (cb) cb(err, null);
        }
    },

    run: async function(sql, params = [], cb) {
        if (typeof params === 'function') {
            cb = params;
            params = [];
        }
        try {
            const result = await handleRun(sql, params);
            const context = { lastID: result.lastID || 0, changes: result.changes || 1 };
            if (cb) cb.call(context, null);
        } catch (err) {
            console.error('Supabase DB Error (run):', err, 'SQL:', sql);
            if (cb) cb.call({ lastID: 0, changes: 0 }, err);
        }
    }
};

async function handleQuery(sql, params) {
    if (!supabase) {
        console.error('Supabase client is not initialized. Please set SUPABASE_URL and SUPABASE_KEY.');
        return [];
    }
    const cleanSql = sql.trim().replace(/\s+/g, ' ');

    // 1. SELECT * FROM customers ORDER BY id DESC
    if (/SELECT \* FROM customers ORDER BY id DESC/i.test(cleanSql)) {
        const { data, error } = await supabase.from('customers').select('*').order('id', { ascending: false });
        if (error) throw error;
        return data.map(normalizeCustomer);
    }

    // 2. SELECT * FROM customers WHERE id = ?
    if (/SELECT \* FROM customers WHERE id = \?/i.test(cleanSql)) {
        const { data, error } = await supabase.from('customers').select('*').eq('id', params[0]);
        if (error) throw error;
        return (data || []).map(normalizeCustomer);
    }

    // 3. SELECT * FROM customers WHERE username = ? AND password = ?
    if (/SELECT \* FROM customers WHERE username = \? AND password = \?/i.test(cleanSql)) {
        const { data, error } = await supabase.from('customers').select('*').eq('username', params[0]).eq('password', params[1]);
        if (error) throw error;
        return (data || []).map(normalizeCustomer);
    }

    // 4. SELECT * FROM customers WHERE qr_token = ?
    if (/SELECT \* FROM customers WHERE qr_token = \?/i.test(cleanSql)) {
        const { data, error } = await supabase.from('customers').select('*').eq('qr_token', params[0]);
        if (error) throw error;
        return (data || []).map(normalizeCustomer);
    }

    // 5. SELECT id, phone, username, password FROM customers WHERE username IS NULL OR password IS NULL
    if (/SELECT id, phone, username, password FROM customers/i.test(cleanSql)) {
        const { data, error } = await supabase.from('customers').select('id, phone, username, password').or('username.is.null,password.is.null');
        if (error) throw error;
        return data || [];
    }

    // 6. SELECT * FROM pending_approvals WHERE status = 'Pending' ORDER BY id DESC
    if (/SELECT \* FROM pending_approvals WHERE status = 'Pending'/i.test(cleanSql)) {
        const { data, error } = await supabase.from('pending_approvals').select('*').eq('status', 'Pending').order('id', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    // 7. SELECT * FROM pending_approvals WHERE id = ? AND status = 'Pending'
    if (/SELECT \* FROM pending_approvals WHERE id = \?/i.test(cleanSql)) {
        const { data, error } = await supabase.from('pending_approvals').select('*').eq('id', params[0]).eq('status', 'Pending');
        if (error) throw error;
        return data || [];
    }

    // 8. SELECT * FROM settings
    if (/SELECT \* FROM settings/i.test(cleanSql) && !cleanSql.includes('WHERE')) {
        const { data, error } = await supabase.from('settings').select('*');
        if (error) throw error;
        return data || [];
    }

    // 9. SELECT key, value FROM settings WHERE key IN
    if (/SELECT key, value FROM settings WHERE key IN/i.test(cleanSql)) {
        const { data, error } = await supabase.from('settings').select('key, value').in('key', ['gold_rate', 'silver_rate']);
        if (error) throw error;
        return data || [];
    }

    // 10. Get pawn records with total_jama for a customer
    if (/FROM pawn_records p WHERE p\.customer_id = \?/i.test(cleanSql)) {
        const custId = params[0];
        const { data: pawns, error } = await supabase.from('pawn_records').select('*').eq('customer_id', custId).order('id', { ascending: false });
        if (error) throw error;
        
        // Fetch total_jama for each pawn
        const pawnIds = (pawns || []).map(p => p.id);
        let paymentsMap = {};
        if (pawnIds.length > 0) {
            const { data: pmts } = await supabase.from('pawn_payments').select('pawn_id, amount').in('pawn_id', pawnIds);
            (pmts || []).forEach(pm => {
                paymentsMap[pm.pawn_id] = (paymentsMap[pm.pawn_id] || 0) + parseFloat(pm.amount || 0);
            });
        }

        return (pawns || []).map(p => ({
            ...p,
            total_jama: paymentsMap[p.id] || 0
        }));
    }

    // 11. SELECT * FROM pawn_payments WHERE pawn_id = ? ORDER BY id DESC
    if (/SELECT \* FROM pawn_payments WHERE pawn_id = \?/i.test(cleanSql)) {
        const { data, error } = await supabase.from('pawn_payments').select('*').eq('pawn_id', params[0]).order('id', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    // 12. Dashboard SUM(amount) Active principal
    if (/SELECT SUM\(amount\) as total FROM pawn_records WHERE status = 'Active'/i.test(cleanSql)) {
        const { data, error } = await supabase.from('pawn_records').select('amount').eq('status', 'Active');
        if (error) throw error;
        const total = (data || []).reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
        return [{ total }];
    }

    // 13. Dashboard COUNT(*) Released
    if (/SELECT COUNT\(\*\) as count FROM pawn_records WHERE status = 'Released'/i.test(cleanSql)) {
        const { count, error } = await supabase.from('pawn_records').select('*', { count: 'exact', head: true }).eq('status', 'Released');
        if (error) throw error;
        return [{ count: count || 0 }];
    }

    // 14. Dashboard Overdue Accounts (status = 'Active' AND date_added < ?)
    if (/FROM pawn_records p JOIN customers c ON p\.customer_id = c\.id WHERE p\.status = 'Active' AND p\.date_added < \?/i.test(cleanSql)) {
        const cutoffDate = params[0];
        const { data: pawns, error } = await supabase.from('pawn_records').select('*, customers(name, phone)').eq('status', 'Active').lt('date_added', cutoffDate);
        if (error) throw error;
        return (pawns || []).map(p => ({
            ...p,
            customer_name: p.customers?.name || '',
            customer_phone: p.customers?.phone || ''
        }));
    }

    // 15. Dashboard Released Items for Interest Calculation
    if (/SELECT \* FROM pawn_records WHERE status = 'Released'/i.test(cleanSql)) {
        const { data, error } = await supabase.from('pawn_records').select('*').eq('status', 'Released');
        if (error) throw error;
        return data || [];
    }

    // 15b. All Pawn Records
    if (/SELECT \* FROM pawn_records$/i.test(cleanSql) || cleanSql === 'SELECT * FROM pawn_records') {
        const { data, error } = await supabase.from('pawn_records').select('*');
        if (error) throw error;
        return data || [];
    }

    // 16. Dashboard SUM(amount) payments
    if (/SELECT SUM\(amount\) as total FROM pawn_payments/i.test(cleanSql) && !cleanSql.includes('WHERE')) {
        const { data, error } = await supabase.from('pawn_payments').select('amount');
        if (error) throw error;
        const total = (data || []).reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
        return [{ total }];
    }

    // 17. Dashboard High Risk Accounts (JOIN pawn_records & customers)
    if (/WHERE p\.status = 'Active' AND p\.item_weight_grams > 0/i.test(cleanSql)) {
        const { data: pawns, error } = await supabase.from('pawn_records').select('*, customers(name, phone)').eq('status', 'Active').gt('item_weight_grams', 0);
        if (error) throw error;

        const pawnIds = (pawns || []).map(p => p.id);
        let paymentsMap = {};
        if (pawnIds.length > 0) {
            const { data: pmts } = await supabase.from('pawn_payments').select('pawn_id, amount').in('pawn_id', pawnIds);
            (pmts || []).forEach(pm => {
                paymentsMap[pm.pawn_id] = (paymentsMap[pm.pawn_id] || 0) + parseFloat(pm.amount || 0);
            });
        }

        return (pawns || []).map(p => ({
            ...p,
            customer_name: p.customers?.name || '',
            customer_phone: p.customers?.phone || '',
            total_jama: paymentsMap[p.id] || 0
        }));
    }

    // 17b. Recovery Time Pawns (Active pawns sorted date_added ASC)
    if (/WHERE p\.status = 'Active' ORDER BY p\.date_added ASC/i.test(cleanSql)) {
        const { data: pawns, error } = await supabase.from('pawn_records').select('*, customers(name, phone)').eq('status', 'Active').order('date_added', { ascending: true });
        if (error) throw error;

        const pawnIds = (pawns || []).map(p => p.id);
        let paymentsMap = {};
        if (pawnIds.length > 0) {
            const { data: pmts } = await supabase.from('pawn_payments').select('pawn_id, amount').in('pawn_id', pawnIds);
            (pmts || []).forEach(pm => {
                paymentsMap[pm.pawn_id] = (paymentsMap[pm.pawn_id] || 0) + parseFloat(pm.amount || 0);
            });
        }

        return (pawns || []).map(p => ({
            ...p,
            customer_name: p.customers?.name || '',
            customer_phone: p.customers?.phone || '',
            total_jama: paymentsMap[p.id] || 0
        }));
    }

    // 18. Daily Rokad - New Pawns (date_added LIKE ?)
    if (/WHERE p\.date_added LIKE \?/i.test(cleanSql)) {
        const datePrefix = params[0].replace('%', '');
        const { data: pawns, error } = await supabase.from('pawn_records').select('*, customers(name)').like('date_added', `${datePrefix}%`);
        if (error) throw error;
        return (pawns || []).map(p => ({
            ...p,
            customer_name: p.customers?.name || ''
        }));
    }

    // 19. Daily Rokad - Released Pawns
    if (/WHERE p\.status = 'Released' AND p\.release_date LIKE \?/i.test(cleanSql)) {
        const rawDateParam = params[1] !== undefined ? params[1] : (params[0] || '');
        const datePrefix = String(rawDateParam).replace(/%/g, '');
        const { data: pawns, error } = await supabase.from('pawn_records').select('*, customers(name)').eq('status', 'Released').like('release_date', `${datePrefix}%`);
        if (error) throw error;

        const pawnIds = (pawns || []).map(p => p.id);
        let paymentsBeforeMap = {};
        if (pawnIds.length > 0) {
            const { data: pmts } = await supabase.from('pawn_payments').select('pawn_id, amount, payment_date').in('pawn_id', pawnIds);
            (pmts || []).forEach(pm => {
                if (!pm.payment_date.startsWith(datePrefix)) {
                    paymentsBeforeMap[pm.pawn_id] = (paymentsBeforeMap[pm.pawn_id] || 0) + parseFloat(pm.amount || 0);
                }
            });
        }

        return (pawns || []).map(p => ({
            ...p,
            customer_name: p.customers?.name || '',
            total_jama_before: paymentsBeforeMap[p.id] || 0
        }));
    }

    // 20. Daily Rokad - Partial Payments today (WHERE pp.payment_date LIKE ?)
    if (/WHERE pp\.payment_date LIKE \?/i.test(cleanSql)) {
        const datePrefix = params[0].replace('%', '');
        const { data: pmts, error } = await supabase.from('pawn_payments').select('*, pawn_records(description, customers(name))').like('payment_date', `${datePrefix}%`);
        if (error) throw error;
        return (pmts || []).map(pm => ({
            ...pm,
            description: pm.pawn_records?.description || '',
            customer_name: pm.pawn_records?.customers?.name || ''
        }));
    }

    // 21. Analytics - Naame: pawn_records grouped by day BETWEEN
    if (/SELECT substr\(date_added, 1, 10\) as day.*FROM pawn_records.*BETWEEN/i.test(cleanSql)) {
        const { data, error } = await supabase.from('pawn_records').select('date_added, amount').gte('date_added', params[0]).lte('date_added', params[1]);
        if (error) throw error;
        const grouped = {};
        (data || []).forEach(r => {
            const day = r.date_added.substring(0, 10);
            grouped[day] = (grouped[day] || 0) + parseFloat(r.amount || 0);
        });
        return Object.keys(grouped).map(day => ({ day, total: grouped[day] }));
    }

    // 22. Analytics - Jama: pawn_payments grouped by day BETWEEN
    if (/SELECT substr\(payment_date, 1, 10\) as day.*FROM pawn_payments.*BETWEEN/i.test(cleanSql)) {
        const { data, error } = await supabase.from('pawn_payments').select('payment_date, amount').gte('payment_date', params[0]).lte('payment_date', params[1]);
        if (error) throw error;
        const grouped = {};
        (data || []).forEach(r => {
            const day = r.payment_date.substring(0, 10);
            grouped[day] = (grouped[day] || 0) + parseFloat(r.amount || 0);
        });
        return Object.keys(grouped).map(day => ({ day, total: grouped[day] }));
    }

    // 23. Analytics - Released Items in date range with total_jama_before
    if (/FROM pawn_records p WHERE p\.status = 'Released' AND p\.release_date BETWEEN/i.test(cleanSql)) {
        const { data: pawns, error } = await supabase.from('pawn_records').select('*').eq('status', 'Released').gte('release_date', params[0]).lte('release_date', params[1]);
        if (error) throw error;
        const pawnIds = (pawns || []).map(p => p.id);
        let paymentsBeforeMap = {};
        if (pawnIds.length > 0) {
            const { data: pmts } = await supabase.from('pawn_payments').select('pawn_id, amount, payment_date').in('pawn_id', pawnIds);
            (pmts || []).forEach(pm => {
                const releaseDate = (pawns.find(p => p.id === pm.pawn_id) || {}).release_date || '';
                if (pm.payment_date < releaseDate) {
                    paymentsBeforeMap[pm.pawn_id] = (paymentsBeforeMap[pm.pawn_id] || 0) + parseFloat(pm.amount || 0);
                }
            });
        }
        return (pawns || []).map(p => ({ ...p, total_jama_before: paymentsBeforeMap[p.id] || 0 }));
    }

    // 24. Export CSV - New Pawns JOIN customers BETWEEN
    if (/SELECT p\.\*, c\.name as customer_name FROM pawn_records p JOIN customers c.*p\.date_added BETWEEN/i.test(cleanSql)) {
        const { data: pawns, error } = await supabase.from('pawn_records').select('*, customers(name)').gte('date_added', params[0]).lte('date_added', params[1]);
        if (error) throw error;
        return (pawns || []).map(p => ({ ...p, customer_name: p.customers?.name || '' }));
    }

    // 25. Export CSV - Payments JOIN pawn_records JOIN customers BETWEEN
    if (/SELECT py\.\*, c\.name as customer_name FROM pawn_payments py.*py\.payment_date BETWEEN/i.test(cleanSql)) {
        const { data: pmts, error } = await supabase.from('pawn_payments').select('*, pawn_records(*, customers(name))').gte('payment_date', params[0]).lte('payment_date', params[1]);
        if (error) throw error;
        return (pmts || []).map(pm => ({ ...pm, customer_name: pm.pawn_records?.customers?.name || '' }));
    }

    // 27. SELECT * FROM interest_ledger ORDER BY payment_date DESC
    if (/FROM interest_ledger/i.test(cleanSql)) {
        try {
            const { data, error } = await supabase.from('interest_ledger').select('*').order('payment_date', { ascending: false });
            if (error) return [];
            return data || [];
        } catch (e) {
            return [];
        }
    }

    // 28. Interest Ledger Backfill - pawn_records JOIN customers for Released
    if (/FROM pawn_records p.*LEFT JOIN customers c.*status = 'Released'/i.test(cleanSql)) {
        try {
            const { data: pawns, error } = await supabase.from('pawn_records').select('*, customers(name, phone)').eq('status', 'Released');
            if (error) throw error;
            return (pawns || []).map(p => ({
                ...p,
                customer_name: p.customers?.name || '',
                customer_phone: p.customers?.phone || ''
            }));
        } catch (e) {
            return [];
        }
    }

    // 29. Interest Ledger Backfill - pawn_payments JOIN pawn_records JOIN customers
    if (/FROM pawn_payments pp LEFT JOIN pawn_records p/i.test(cleanSql)) {
        try {
            const { data: pmts, error } = await supabase.from('pawn_payments').select('*, pawn_records(*, customers(name, phone))');
            if (error) throw error;
            return (pmts || []).map(pm => ({
                ...pm,
                principal_amount: pm.pawn_records?.amount || 0,
                item_description: pm.pawn_records?.description || '',
                customer_name: pm.pawn_records?.customers?.name || '',
                customer_phone: pm.pawn_records?.customers?.phone || ''
            }));
        } catch (e) {
            return [];
        }
    }

    // 28. Export CSV - Released Pawns JOIN customers BETWEEN with total_jama_before
    if (/FROM pawn_records p JOIN customers c.*p\.status = 'Released' AND p\.release_date BETWEEN/i.test(cleanSql)) {
        const { data: pawns, error } = await supabase.from('pawn_records').select('*, customers(name)').eq('status', 'Released').gte('release_date', params[0]).lte('release_date', params[1]);
        if (error) throw error;
        const pawnIds = (pawns || []).map(p => p.id);
        let paymentsBeforeMap = {};
        if (pawnIds.length > 0) {
            const { data: pmts } = await supabase.from('pawn_payments').select('pawn_id, amount, payment_date').in('pawn_id', pawnIds);
            (pmts || []).forEach(pm => {
                const releaseDate = (pawns.find(p => p.id === pm.pawn_id) || {}).release_date || '';
                if (pm.payment_date < releaseDate) {
                    paymentsBeforeMap[pm.pawn_id] = (paymentsBeforeMap[pm.pawn_id] || 0) + parseFloat(pm.amount || 0);
                }
            });
        }
        return (pawns || []).map(p => ({ ...p, customer_name: p.customers?.name || '', total_jama_before: paymentsBeforeMap[p.id] || 0 }));
    }

    // 27. Passbook - pawn_records WHERE customer_id = ? ORDER BY id DESC (simple, no JOIN)
    if (/SELECT \* FROM pawn_records WHERE customer_id = \? ORDER BY id DESC/i.test(cleanSql)) {
        const { data, error } = await supabase.from('pawn_records').select('*').eq('customer_id', params[0]).order('id', { ascending: false });
        if (error) throw error;
        return data || [];
    }

    // 28. Passbook - pawn_payments WHERE pawn_id IN (id1,id2,...)
    if (/SELECT \* FROM pawn_payments WHERE pawn_id IN \(/i.test(cleanSql)) {
        const inMatch = cleanSql.match(/IN \(([^)]+)\)/i);
        if (inMatch) {
            const ids = inMatch[1].split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
            if (ids.length > 0) {
                const { data, error } = await supabase.from('pawn_payments').select('*').in('pawn_id', ids);
                if (error) throw error;
                return data || [];
            }
        }
        return [];
    }

    // 29. Birthday Cron - customers WHERE dob LIKE ?
    if (/SELECT \* FROM customers WHERE dob LIKE \?/i.test(cleanSql)) {
        const pattern = (params[0] || '').replace(/%/g, '');
        const { data, error } = await supabase.from('customers').select('*').like('dob', `%${pattern}`);
        if (error) throw error;
        return (data || []).map(normalizeCustomer);
    }

    // 32. Single Pawn Record with Customer JOIN (WHERE p.id = ? AND p.customer_id = ?)
    if (/FROM pawn_records p.*JOIN customers c.*WHERE p\.id = \?/i.test(cleanSql)) {
        const pawnId = params[0];
        const { data: pawns, error } = await supabase.from('pawn_records').select('*, customers(name, phone)').eq('id', pawnId);
        if (error) throw error;
        return (pawns || []).map(p => ({
            ...p,
            customer_name: p.customers?.name || '',
            customer_phone: p.customers?.phone || ''
        }));
    }

    // 30. Portal Login - customer lookup by username / phone
    if (/SELECT \* FROM customers WHERE.*username.*OR.*phone/i.test(cleanSql)) {
        const username = params[0];
        const phoneClean = params[2] || username;
        const { data, error } = await supabase.from('customers').select('*').or(`username.eq.${username},phone.eq.${username},phone.eq.${phoneClean}`);
        if (error) throw error;
        return (data || []).map(normalizeCustomer);
    }

    // 31. Pawn record by id AND customer_id
    if (/SELECT \* FROM pawn_records WHERE id = \? AND customer_id = \?/i.test(cleanSql)) {
        const { data, error } = await supabase.from('pawn_records').select('*').eq('id', params[0]).eq('customer_id', params[1]);
        if (error) throw error;
        return data || [];
    }

    // Fallback
    return [];

}

async function handleRun(sql, params) {
    if (!supabase) {
        console.error('Supabase client is not initialized. Please set SUPABASE_URL and SUPABASE_KEY.');
        return { lastID: 0, changes: 0 };
    }
    const cleanSql = sql.trim().replace(/\s+/g, ' ');

    // 0. CREATE TABLE
    if (/CREATE TABLE/i.test(cleanSql)) {
        return { lastID: 0, changes: 0 };
    }

async function safeInsert(tableName, record) {
    let { data, error } = await supabase.from(tableName).insert(record).select('id').single();
    if (error && (error.code === '23505' || (error.message && (error.message.includes('unique constraint') || error.message.includes('primary key'))))) {
        console.log(`Primary key sequence collision on ${tableName}. Auto-repairing ID sequence fallback...`);
        const { data: maxRow } = await supabase.from(tableName).select('id').order('id', { ascending: false }).limit(1);
        const nextId = (maxRow && maxRow.length > 0 && maxRow[0].id ? parseInt(maxRow[0].id) : 0) + 1;
        record.id = nextId;
        const res = await supabase.from(tableName).insert(record).select('id').single();
        if (res.error) throw res.error;
        return res.data;
    }
    if (error) throw error;
    return data;
}

    // 1. INSERT INTO customers
    if (/INSERT INTO customers/i.test(cleanSql)) {
        // Parse columns from SQL dynamically
        const colMatch = cleanSql.match(/INSERT INTO customers\s*\(([^)]+)\)/i);
        const newCust = { qr_active: 1, portal_active: 1 };
        if (colMatch) {
            const cols = colMatch[1].split(',').map(c => c.trim());
            cols.forEach((col, idx) => {
                // Normalize dateAdded -> dateadded for Supabase (lowercase)
                const key = col === 'dateAdded' ? 'dateadded' : col;
                newCust[key] = params[idx] !== undefined ? params[idx] : null;
            });
        } else {
            // Fallback
            newCust.name = params[0];
            newCust.phone = params[1];
            newCust.email = params[2] || null;
            newCust.dob = params[3] || null;
            newCust.dateadded = params[4] || new Date().toISOString();
            newCust.aadhar_photo = params[5] || null;
            newCust.username = params[6];
            newCust.password = params[7];
            newCust.qr_token = params[8];
        }
        const data = await safeInsert('customers', newCust);
        return { lastID: data.id, changes: 1 };
    }

    // 2. INSERT INTO pawn_records
    if (/INSERT INTO pawn_records/i.test(cleanSql)) {
        // Parse columns from SQL to build correct record object
        // SQL: INSERT INTO pawn_records (col1, col2, ...) VALUES (?, ?, ...)
        // status is hardcoded as 'Active' in the SQL, so it's NOT in params
        const colMatch = cleanSql.match(/INSERT INTO pawn_records\s*\(([^)]+)\)/i);
        const record = { status: 'Active' };
        if (colMatch) {
            const cols = colMatch[1].split(',').map(c => c.trim());
            // Remove 'status' from cols since it's hardcoded in SQL VALUES
            const colsWithoutStatus = cols.filter(c => c !== 'status');
            colsWithoutStatus.forEach((col, idx) => {
                record[col] = params[idx] !== undefined ? params[idx] : null;
            });
        } else {
            // Fallback: assume standard 10-param order
            record.customer_id = params[0];
            record.amount = params[1];
            record.description = params[2];
            record.date_added = params[3];
            record.interest_rate = params[4];
            record.item_photo = params[5] || null;
            record.item_weight_grams = params[6] || 0;
            record.item_metal_type = params[7] || 'Gold';
            record.is_udhari = params[8] || 0;
        }
        const data = await safeInsert('pawn_records', record);
        return { lastID: data.id, changes: 1 };
    }

    // 3. INSERT INTO pawn_payments
    if (/INSERT INTO pawn_payments/i.test(cleanSql)) {
        const record = {
            pawn_id: params[0],
            amount: params[1],
            payment_type: params[2],
            payment_date: params[3]
        };
        const data = await safeInsert('pawn_payments', record);
        return { lastID: data.id, changes: 1 };
    }

    // 4. INSERT INTO pending_approvals
    if (/INSERT INTO pending_approvals/i.test(cleanSql)) {
        const record = {
            type: params[0],
            staff_name: params[1] || 'Staff Counter',
            data_json: params[2],
            status: 'Pending',
            created_at: params[3]
        };
        const data = await safeInsert('pending_approvals', record);
        return { lastID: data.id, changes: 1 };
    }

    // 5. UPDATE pending_approvals SET status = ? WHERE id = ?
    //    OR UPDATE pending_approvals SET status = 'Approved'/'Rejected' WHERE id = ? (hardcoded)
    if (/UPDATE pending_approvals SET status/i.test(cleanSql)) {
        let status, id;
        // Case A: status is a parameter -> SET status = ? WHERE id = ?
        if (/SET status = \?/i.test(cleanSql)) {
            status = params[0];
            id = params[1];
        }
        // Case B: status is hardcoded -> SET status = 'Approved' WHERE id = ?
        else {
            const statusMatch = cleanSql.match(/SET status = '([^']+)'/i);
            status = statusMatch ? statusMatch[1] : null;
            id = params[0];
        }
        if (!status || !id) return { lastID: 0, changes: 0 };
        const { error } = await supabase.from('pending_approvals').update({ status }).eq('id', id);
        if (error) throw error;
        return { lastID: 0, changes: 1 };
    }

    // 6. UPDATE customers SET ... WHERE id = ?
    if (/UPDATE customers SET/i.test(cleanSql)) {
        const setMatch = cleanSql.match(/UPDATE customers SET (.+) WHERE id = \?/i);
        if (setMatch) {
            const setClause = setMatch[1];
            const updates = {};
            let paramIdx = 0;

            const assignments = setClause.split(',');
            assignments.forEach(assign => {
                const parts = assign.split('=').map(s => s.trim());
                if (parts.length === 2) {
                    const col = parts[0];
                    const val = parts[1];
                    if (val === '?') {
                        updates[col] = params[paramIdx++];
                    } else {
                        let literalVal = val.replace(/^'|'$/g, '');
                        if (!isNaN(parseFloat(literalVal)) && isFinite(literalVal)) {
                            literalVal = Number(literalVal);
                        }
                        updates[col] = literalVal;
                    }
                }
            });

            const id = params[params.length - 1];
            const { error } = await supabase.from('customers').update(updates).eq('id', id);
            if (error) throw error;
            return { lastID: 0, changes: 1 };
        }
    }

    // 7. DELETE FROM customers WHERE id = ?
    if (/DELETE FROM customers WHERE id = \?/i.test(cleanSql)) {
        const { error } = await supabase.from('customers').delete().eq('id', params[0]);
        if (error) throw error;
        return { lastID: 0, changes: 1 };
    }

    // 8. UPDATE pawn_records SET status = 'Released' OR status = 'Renewed'
    if (/UPDATE pawn_records SET status = '(Released|Renewed)'/i.test(cleanSql)) {
        const statusMatch = cleanSql.match(/SET status = '([^']+)'/i);
        const status = statusMatch ? statusMatch[1] : 'Released';
        const { error } = await supabase.from('pawn_records').update({ status, release_date: params[0] }).eq('id', params[1]);
        if (error) throw error;
        return { lastID: 0, changes: 1 };
    }

    // 9. UPDATE pawn_records SET status = 'Melted'
    if (/UPDATE pawn_records SET status = 'Melted'/i.test(cleanSql)) {
        const { error } = await supabase.from('pawn_records').update({
            status: 'Melted',
            melt_date: params[0],
            melt_pure_weight: params[1],
            melt_notes: params[2]
        }).eq('id', params[3]);
        if (error) throw error;
        return { lastID: 0, changes: 1 };
    }

    // 10. INSERT INTO settings (key, value) ON CONFLICT
    if (/INSERT INTO settings/i.test(cleanSql)) {
        const key = params[0];
        const value = params[1];
        const { error } = await supabase.from('settings').upsert({ key, value });
        if (error) throw error;
        return { lastID: 0, changes: 1 };
    }

    // 13. INSERT INTO interest_ledger
    if (/INSERT INTO interest_ledger/i.test(cleanSql)) {
        const record = {
            pawn_id: params[0] || null,
            customer_name: params[1] || 'Customer Record',
            customer_phone: params[2] || '',
            item_description: params[3] || '',
            principal_amount: parseFloat(params[4] || 0),
            interest_amount: parseFloat(params[5] || 0),
            payment_date: params[6] || new Date().toISOString(),
            payment_type: params[7] || 'Interest Payment',
            notes: params[8] || ''
        };
        try {
            const { data, error } = await supabase.from('interest_ledger').insert(record).select('id').single();
            if (error) {
                console.error('Supabase interest_ledger insert note:', error.message);
                return { lastID: 0, changes: 0 };
            }
            return { lastID: data?.id || 0, changes: 1 };
        } catch(e) {
            return { lastID: 0, changes: 0 };
        }
    }

    console.log('Unrecognized run command:', cleanSql);
    return { lastID: 0, changes: 0 };
}

function normalizeCustomer(c) {
    if (!c) return null;
    return {
        ...c,
        dateAdded: c.dateAdded || c.dateadded
    };
}

module.exports = { db, supabase };
