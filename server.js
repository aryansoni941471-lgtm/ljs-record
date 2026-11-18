const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();
const { db, supabase, fixAllSequences } = require('./supabase-db');

// ============================================
// SECURITY #1: BRUTE-FORCE PROTECTION (In-Memory, Vercel-safe)
// ============================================
const loginAttempts = new Map(); // key: ip -> { count, lockedUntil }

function checkBruteForce(ip) {
    const now = Date.now();
    const rec = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    if (rec.lockedUntil > now) {
        const mins = Math.ceil((rec.lockedUntil - now) / 60000);
        return { blocked: true, mins };
    }
    return { blocked: false };
}

function recordFailedLogin(ip) {
    const rec = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    rec.count += 1;
    if (rec.count >= 5) {
        rec.lockedUntil = Date.now() + 15 * 60 * 1000; // 15 min lockout
        rec.count = 0;
        console.warn(`[Security] IP ${ip} locked for 15 min after 5 failed login attempts.`);
    }
    loginAttempts.set(ip, rec);
}

function clearFailedLogin(ip) {
    loginAttempts.delete(ip);
}

// Session & Auth Token Configuration
const AUTH_SECRET = process.env.AUTH_SECRET || 'ljs_jewellers_secret_key_2026';

function generateAuthToken(role) {
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours validity
    const payload = `${role}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    return `${Buffer.from(payload).toString('base64')}.${signature}`;
}

function verifyAuthToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    try {
        const [payloadB64, signature] = token.split('.');
        const payload = Buffer.from(payloadB64, 'base64').toString('utf8');
        const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
        if (signature !== expectedSig) return null;
        const [role, expiresAtStr] = payload.split(':');
        const expiresAt = parseInt(expiresAtStr, 10);
        if (Date.now() > expiresAt) return null;
        return { role, expiresAt };
    } catch(e) {
        return null;
    }
}

// --- Security: Visual CAPTCHA Generator & Verifier ---
function generateCaptchaSvg() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let text = '';
    for (let i = 0; i < 5; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const width = 160;
    const height = 48;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="background:#0f172a; border-radius:8px; border:1px solid #d4af37; user-select:none;">`;
    
    // Background noise lines
    for (let i = 0; i < 4; i++) {
        const x1 = Math.floor(Math.random() * width);
        const y1 = Math.floor(Math.random() * height);
        const x2 = Math.floor(Math.random() * width);
        const y2 = Math.floor(Math.random() * height);
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(212,175,55,0.3)" stroke-width="1.5" />`;
    }
    
    // Wavy rotated characters with contrasting colors
    const colors = ['#f59e0b', '#fbbf24', '#d4af37', '#38bdf8', '#a78bfa'];
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const x = 20 + i * 26;
        const y = 32 + (Math.random() * 6 - 3);
        const rot = Math.floor(Math.random() * 24 - 12);
        const col = colors[i % colors.length];
        svg += `<text x="${x}" y="${y}" fill="${col}" font-size="24" font-family="'Courier New', monospace" font-weight="900" transform="rotate(${rot} ${x} ${y})">${char}</text>`;
    }
    svg += '</svg>';

    const exp = Date.now() + 10 * 60 * 1000; // 10 minutes
    const tokenData = `${exp}:${text.toUpperCase()}`;
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update(tokenData).digest('hex');
    const token = `${exp}:${sig}`;

    return { svg, token, text };
}

function verifyCaptcha(token, inputCode) {
    if (!token || !inputCode) return false;
    const parts = token.split(':');
    if (parts.length !== 2) return false;
    const [expStr, sig] = parts;
    const exp = parseInt(expStr, 10);
    if (isNaN(exp) || Date.now() > exp) return false;

    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(`${exp}:${String(inputCode).trim().toUpperCase()}`).digest('hex');
    return sig === expectedSig;
}

// --- Security: Stateless MFA (Multi-Factor Authentication) Challenge Tokens ---
function signMfaChallenge({ customerId, otp, phone, email, name }) {
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
    const otpHash = crypto.createHmac('sha256', AUTH_SECRET).update(`${customerId}:${otp}:${expiresAt}`).digest('hex');
    const payload = JSON.stringify({
        cid: customerId,
        exp: expiresAt,
        h: otpHash,
        p: phone ? phone.slice(-4) : '',
        e: email ? email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '',
        n: name
    });
    const b64 = Buffer.from(payload).toString('base64url');
    const sig = crypto.createHmac('sha256', AUTH_SECRET).update(b64).digest('base64url');
    return `${b64}.${sig}`;
}

function verifyMfaChallenge(mfaToken, inputOtp) {
    if (!mfaToken || typeof mfaToken !== 'string') return { valid: false, error: 'Missing security token. Please log in again.' };
    const parts = mfaToken.split('.');
    if (parts.length !== 2) return { valid: false, error: 'Invalid security token format.' };

    const [b64, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(b64).digest('base64url');
    if (sig !== expectedSig) {
        return { valid: false, error: 'Security token signature mismatch. Please log in again.' };
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    } catch (e) {
        return { valid: false, error: 'Malformed security token. Please log in again.' };
    }

    if (!payload.cid || !payload.exp || !payload.h) {
        return { valid: false, error: 'Incomplete security token data.' };
    }

    if (Date.now() > payload.exp) {
        return { valid: false, error: 'OTP has expired. Please click Resend OTP or log in again.' };
    }

    const expectedHash = crypto.createHmac('sha256', AUTH_SECRET).update(`${payload.cid}:${String(inputOtp).trim()}:${payload.exp}`).digest('hex');
    if (payload.h !== expectedHash) {
        return { valid: false, error: 'Incorrect OTP code. Please enter the correct 6-digit code.' };
    }

    return { valid: true, customerId: payload.cid, payload };
}


// Password security helpers
function isBcryptHash(str) {
    return typeof str === 'string' && (str.startsWith('$2a$') || str.startsWith('$2b$') || str.startsWith('$2y$'));
}

function hashPassword(password) {
    if (!password) return '';
    if (isBcryptHash(password)) return password;
    return bcrypt.hashSync(password.toString().trim(), 10);
}

function verifyPassword(inputPassword, storedPassword) {
    if (!inputPassword || !storedPassword) return false;
    const cleanInput = inputPassword.toString().trim();
    if (isBcryptHash(storedPassword)) {
        return bcrypt.compareSync(cleanInput, storedPassword);
    }
    return cleanInput === storedPassword.toString().trim();
}

function migrateLegacyPasswords() {
    db.all('SELECT id, password FROM customers', [], (err, rows) => {
        if (err || !rows) return;
        rows.forEach(cust => {
            if (cust.password && !isBcryptHash(cust.password)) {
                const hashed = hashPassword(cust.password);
                db.run('UPDATE customers SET password = ? WHERE id = ?', [hashed, cust.id]);
            }
        });
    });
}

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

// ============================================
// SECURITY #3: HELMET — HTTP Security Headers
// ============================================
app.use(helmet({
    contentSecurityPolicy: false,       // Disabled: app uses inline scripts/styles
    crossOriginEmbedderPolicy: false,   // Disabled: needed for external fonts/images
}));

// ============================================
// SECURITY #2: RATE LIMITING
// ============================================
// General API: 150 requests per minute per IP
app.use('/api/', rateLimit({
    windowMs: 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please slow down and try again in a minute.' }
}));

// Auth endpoints: max 10 attempts per 15 minutes per IP
const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many login attempts. Please try again after 15 minutes.' }
});
app.use('/api/auth/login', authRateLimit);
app.use('/api/portal/login', authRateLimit);
app.use('/api/portal/verify-otp', authRateLimit);
app.use('/api/portal/resend-otp', authRateLimit);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve Landing Page (index.html) on root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Direct Page Route Aliases
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/portal', (req, res) => {
    res.sendFile(path.join(__dirname, 'portal.html'));
});

app.get('/passbook', (req, res) => {
    res.sendFile(path.join(__dirname, 'passbook.html'));
});

app.get('/ledger', (req, res) => {
    res.sendFile(path.join(__dirname, 'interest-ledger.html'));
});

// ============================================
// AUTHENTICATION & ACCESS CONTROL ENDPOINTS
// ============================================

// POST /api/auth/login - Staff & Admin Authentication
app.post('/api/auth/login', (req, res) => {
    // SECURITY: Brute-force check
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    const bf = checkBruteForce(ip);
    if (bf.blocked) {
        console.warn(`[Security] Blocked login attempt from ${ip} — locked for ${bf.mins} more min.`);
        return res.status(429).json({
            success: false,
            error: `Too many failed attempts. Try again in ${bf.mins} minute${bf.mins > 1 ? 's' : ''}.`
        });
    }

    const { pin, username, password, role } = req.body;
    const adminPass = String(process.env.ADMIN_PASS || '121965').trim();
    const staffPin = String(process.env.STAFF_PIN || '1234').trim();
    const configuredAdmin = String(process.env.ADMIN_USER || 'jitendra').trim().toLowerCase();

    // 1. PIN-based Login (Touch/Keypad & Quick Entry)
    if (pin !== undefined && pin !== null && String(pin).trim() !== '') {
        const cleanPin = String(pin).trim();
        if (cleanPin === adminPass) {
            clearFailedLogin(ip);
            const token = generateAuthToken('admin');
            return res.json({ success: true, role: 'admin', name: 'Admin Owner', token });
        }
        if (cleanPin === staffPin) {
            clearFailedLogin(ip);
            const token = generateAuthToken('staff');
            return res.json({ success: true, role: 'staff', name: 'Staff Counter', token });
        }
        // Wrong PIN — record failure
        recordFailedLogin(ip);
        const rec = loginAttempts.get(ip) || { count: 0 };
        const remaining = Math.max(0, 5 - (rec.count || 0));
        return res.status(401).json({
            success: false,
            error: remaining > 0
                ? `Incorrect Security PIN! ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining before lockout.`
                : 'Too many failed attempts. Account locked for 15 minutes.'
        });
    }

    // 2. Username/Password Login
    if (username && password) {
        const cleanUser = String(username).trim().toLowerCase();
        const cleanPass = String(password).trim();

        if (['admin', 'jitendra', 'owner', configuredAdmin].includes(cleanUser) && cleanPass === adminPass) {
            clearFailedLogin(ip);
            const token = generateAuthToken('admin');
            return res.json({ success: true, role: 'admin', name: 'Admin Owner', token });
        }
        if (cleanUser === 'staff' && cleanPass === staffPin) {
            clearFailedLogin(ip);
            const token = generateAuthToken('staff');
            return res.json({ success: true, role: 'staff', name: 'Staff Counter', token });
        }
        // Wrong credentials — record failure
        recordFailedLogin(ip);
        const rec2 = loginAttempts.get(ip) || { count: 0 };
        const remaining2 = Math.max(0, 5 - (rec2.count || 0));
        return res.status(401).json({
            success: false,
            error: remaining2 > 0
                ? `Invalid credentials. ${remaining2} attempt${remaining2 !== 1 ? 's' : ''} remaining before lockout.`
                : 'Too many failed attempts. Account locked for 15 minutes.'
        });
    }

    return res.status(400).json({
        success: false,
        error: 'Please enter a valid security PIN or credentials.'
    });
});

// POST /api/auth/verify - Validate Active Token/Session
app.post('/api/auth/verify', (req, res) => {
    const authHeader = req.headers.authorization;
    let token = req.body && req.body.token;
    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }
    const verified = verifyAuthToken(token);
    if (!verified) {
        return res.status(401).json({ success: false, valid: false, error: 'Session expired or invalid.' });
    }
    return res.json({ success: true, valid: true, role: verified.role, expiresAt: verified.expiresAt });
});

// ============================================
// LIVE METAL RATES & HOMEPAGE TICKER ENDPOINT
// ============================================

// GET /api/rates - Public Metal Rates Endpoint for Website & Calculator
app.get('/api/rates', (req, res) => {
    db.all(`SELECT key, value FROM settings WHERE key IN ('gold_rate', 'silver_rate', 'rates_updated_at')`, [], (err, rows) => {
        let goldRate = 7200; // default ₹7,200/g = ₹72,000/10g
        let silverRate = 92;  // default ₹92/g = ₹92,000/1kg
        let updatedAt = new Date().toISOString();

        if (!err && rows && rows.length > 0) {
            rows.forEach(r => {
                if (r.key === 'gold_rate' && parseFloat(r.value)) goldRate = parseFloat(r.value);
                if (r.key === 'silver_rate' && parseFloat(r.value)) silverRate = parseFloat(r.value);
                if (r.key === 'rates_updated_at' && r.value) updatedAt = r.value;
            });
        }

        const gold24k = goldRate;
        const gold22k = Math.round(goldRate * 0.916);
        const gold18k = Math.round(goldRate * 0.750);

        res.json({
            success: true,
            gold_rate: goldRate,
            silver_rate: silverRate,
            gold_rate_24k: gold24k,
            gold_rate_22k: gold22k,
            gold_rate_18k: gold18k,
            silver_rate_10g: Math.round(silverRate * 10),
            silver_rate_kg: Math.round(silverRate * 1000),
            updated_at: updatedAt
        });
    });
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

// Auto-release any paid-off pawns (amount <= 0)
db.run(`UPDATE pawn_records SET status = 'Released', release_date = '${new Date().toISOString()}' WHERE amount <= 0 AND status = 'Active'`);

// Ensure pawn_records has is_portal_visible column in local SQLite
if (!process.env.VERCEL) {
    try {
        db.run('ALTER TABLE pawn_records ADD COLUMN is_portal_visible INTEGER DEFAULT 1', () => {});
    } catch (e) {}
}

// Standard Pawn Interest Calculation Function (Matches shop rules: minimum 1 full month, slab based)
function calculateInterest(amount, rate, dateAdded, status, releaseDate) {
    rate = parseFloat(rate || 0);
    amount = parseFloat(amount || 0);
    if (rate === 0 || amount === 0) return 0;

    const start = new Date(dateAdded);
    const end = status === 'Released' && releaseDate ? new Date(releaseDate) : new Date();
    
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    const months = Math.floor(diffDays / 30);
    const extraDays = diffDays % 30;
    
    let chargeableMonths = months;
    
    if (extraDays > 0 && extraDays <= 5) {
        chargeableMonths += 1; // 1-5 din extra = 1 full month interest
    } else if (extraDays > 5 && extraDays <= 15) {
        chargeableMonths += 0.5; // 5-15 din = half month interest
    } else if (extraDays > 15) {
        chargeableMonths += (extraDays / 30); // >15 din = day-wise interest
    } else if (months === 0 && extraDays === 0) {
        chargeableMonths = 1; // same day = 1 full month interest
    }

    return Math.round(amount * (rate / 100) * chargeableMonths);
}

// Run legacy password migration once database initializes
setTimeout(migrateLegacyPasswords, 2000);

// ============================================
// EMAIL NOTIFICATION SERVICE & RECEIPT HELPERS
// ============================================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function formatCurrency(val) {
    return '₹' + Number(val || 0).toLocaleString('en-IN');
}

function formatReceiptDate(dateStr) {
    try {
        const d = dateStr ? new Date(dateStr) : new Date();
        return d.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch(e) {
        return new Date().toLocaleString('en-IN');
    }
}

// 1. Send Payment Transaction Approval Receipt Email
async function sendPaymentApprovalEmail({
    customerEmail,
    customerName,
    customerPhone,
    itemDescription,
    amount,
    paymentType,
    utrNumber,
    actualInterest,
    extraTowardsPrincipal,
    newPrincipal,
    isReleased,
    approvalDate
}) {
    if (!customerEmail || !customerEmail.includes('@') || customerEmail === 'N/A') {
        console.log(`[Email] Customer email missing or invalid (${customerEmail}), skipping transaction email.`);
        return false;
    }
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log('[Email] EMAIL_USER or EMAIL_PASS not configured in .env, skipping email.');
        return false;
    }

    const receiptNo = 'LJS-TXN-' + Date.now().toString().slice(-6);
    const dateFormatted = formatReceiptDate(approvalDate);
    const paidAmt = parseFloat(amount || 0);
    const byaajAmt = parseFloat(actualInterest || 0);
    const moolAmt = parseFloat(extraTowardsPrincipal || 0);
    const bakiMool = parseFloat(newPrincipal || 0);

    const statusBadge = isReleased
        ? `<div style="background-color: #d1fae5; color: #065f46; border: 1px solid #10b981; padding: 12px 16px; border-radius: 8px; font-weight: bold; text-align: center; margin: 16px 0;">
             🎉 LOAN FULLY SETTLED &bull; GEHNA RELEASED (गहना छूट गया)
           </div>`
        : `<div style="background-color: #eff6ff; color: #1e40af; border: 1px solid #3b82f6; padding: 12px 16px; border-radius: 8px; font-weight: bold; text-align: center; margin: 16px 0;">
             ✅ TRANSACTION APPROVED &amp; VERIFIED (भुगतान स्वीकृत)
           </div>`;

    const statusRow = isReleased
        ? `<tr>
             <td style="padding: 10px 0; color: #475569; font-size: 14px;"><strong>Account Status:</strong></td>
             <td style="padding: 10px 0; color: #059669; text-align: right; font-weight: bold; font-size: 15px;">Loan Fully Cleared (Closed)</td>
           </tr>`
        : `<tr>
             <td style="padding: 10px 0; color: #475569; font-size: 14px;"><strong>Remaining Principal (बाकी मूल):</strong></td>
             <td style="padding: 10px 0; color: #dc2626; text-align: right; font-weight: bold; font-size: 16px;">${formatCurrency(bakiMool)}</td>
           </tr>`;

    const mailOptions = {
        from: `"LJS Jewellers" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: `Payment Approved - Receipt #${receiptNo} | LJS Jewellers`,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
            
            <!-- Luxury Header -->
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 28px 24px; text-align: center; border-bottom: 3px solid #d4af37;">
              <div style="display: inline-block; background: linear-gradient(135deg, #d4af37, #f59e0b); color: #0f172a; width: 44px; height: 44px; line-height: 44px; border-radius: 10px; font-size: 22px; font-weight: bold; margin-bottom: 8px;">✨</div>
              <h1 style="margin: 0; font-size: 24px; letter-spacing: 1.5px; font-weight: 800; color: #ffffff; text-transform: uppercase;">LJS JEWELLERS</h1>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #d4af37; letter-spacing: 2px; text-transform: uppercase; font-weight: 600;">Gold &amp; Silver Pawn Brokerage &bull; Official Receipt</p>
            </div>

            <!-- Main Content -->
            <div style="padding: 26px 24px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 16px;">
                <div>
                  <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: bold;">Receipt No.</span>
                  <div style="font-size: 15px; font-weight: 800; color: #0f172a;">${receiptNo}</div>
                </div>
                <div style="text-align: right;">
                  <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: bold;">Approval Date</span>
                  <div style="font-size: 13px; font-weight: 600; color: #334155;">${dateFormatted}</div>
                </div>
              </div>

              ${statusBadge}

              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 16px 0 20px 0;">
                Namaste <strong>${customerName}</strong> ji, aapka transaction approve aur verify ho gaya hai. Niche aapke transaction aur khate ka pura vivaran (receipt breakdown) diya gaya hai:
              </p>

              <!-- Payment Breakdown Card -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin-bottom: 22px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Customer Name:</td>
                    <td style="padding: 8px 0; color: #0f172a; text-align: right; font-weight: 700; font-size: 14px;">${customerName} ${customerPhone ? `(${customerPhone})` : ''}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Item Pledged (गिरवी गहना):</td>
                    <td style="padding: 8px 0; color: #0f172a; text-align: right; font-weight: 600; font-size: 14px;">${itemDescription}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Payment Mode:</td>
                    <td style="padding: 8px 0; color: #0f172a; text-align: right; font-weight: 600; font-size: 13px;">
                      ${paymentType} ${utrNumber ? `<br><span style="font-size: 11px; color: #64748b;">(UTR: ${utrNumber})</span>` : ''}
                    </td>
                  </tr>
                  
                  <tr style="border-top: 1px dashed #cbd5e1;">
                    <td style="padding: 12px 0 6px 0; color: #0f172a; font-size: 15px; font-weight: 700;">Amount Paid (कुल जमा राशि):</td>
                    <td style="padding: 12px 0 6px 0; color: #059669; text-align: right; font-size: 18px; font-weight: 800;">${formatCurrency(paidAmt)}</td>
                  </tr>

                  <tr>
                    <td style="padding: 4px 0 4px 12px; color: #64748b; font-size: 12px;">&bull; Byaaj me jama (Interest Settled):</td>
                    <td style="padding: 4px 0 4px 0; color: #b45309; text-align: right; font-size: 13px; font-weight: 600;">${formatCurrency(byaajAmt)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0 8px 12px; color: #64748b; font-size: 12px;">&bull; Mool me jama (Principal Paid):</td>
                    <td style="padding: 4px 0 8px 0; color: #2563eb; text-align: right; font-size: 13px; font-weight: 600;">${formatCurrency(moolAmt)}</td>
                  </tr>

                  <tr style="border-top: 1px solid #cbd5e1;">
                    ${statusRow}
                  </tr>
                </table>
              </div>

              <!-- Notice Box -->
              <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 12px; color: #92400e; line-height: 1.5;">
                  <strong>Note:</strong> Aapka payment interest ledger aur passbook me update ho gaya hai. Loan date approval ki date se reset ho chuki hai. Aap apne online Customer Portal par login karke passbook aur live balance check kar sakte hain.
                </p>
              </div>

              <div style="text-align: center; margin-top: 24px;">
                <a href="http://localhost:3001/portal.html" style="display: inline-block; background: linear-gradient(135deg, #0f172a, #1e293b); color: #d4af37; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: bold; font-size: 13px; border: 1px solid #d4af37;">
                  View Online Passbook &rarr;
                </a>
              </div>
            </div>

            <!-- Footer -->
            <div style="background-color: #0f172a; color: #94a3b8; text-align: center; padding: 18px 20px; font-size: 11px; border-top: 1px solid #334155;">
              <p style="margin: 0; color: #cbd5e1; font-weight: 600;">LJS Jewellers (Laxmi Narayan Jewellers)</p>
              <p style="margin: 4px 0 0 0;">This is an automated system-generated electronic receipt sent upon transaction approval.</p>
              <p style="margin: 6px 0 0 0; color: #64748b;">&copy; ${new Date().getFullYear()} LJS Jewellers. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
        `
    };

    return new Promise((resolve) => {
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error(`[Email Error] Failed to send payment receipt to ${customerEmail}:`, error.message);
                return resolve(false);
            }
            console.log(`[Email Success] Payment approval receipt sent to ${customerEmail} (ID: ${info.messageId})`);
            resolve(true);
        });
    });
}

// 2. Send Pawn Creation Approval Receipt Email
async function sendPawnCreationEmail({
    customerEmail,
    customerName,
    customerPhone,
    description,
    amount,
    interestRate,
    itemWeightGrams,
    itemMetalType,
    dateAdded
}) {
    const cleanEmail = (customerEmail || '').trim();
    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.toUpperCase() === 'N/A') {
        console.log(`[Email] Skipping pawn creation email - invalid or missing email (${customerEmail})`);
        return false;
    }
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log('[Email] EMAIL_USER or EMAIL_PASS not configured in .env, skipping email.');
        return false;
    }

    const receiptNo = 'LJS-PAWN-' + Date.now().toString().slice(-6);
    const dateFormatted = formatReceiptDate(dateAdded);
    const loanAmt = parseFloat(amount || 0);
    const rate = parseFloat(interestRate || 0);

    const mailOptions = {
        from: `"LJS Jewellers" <${process.env.EMAIL_USER}>`,
        to: cleanEmail,
        subject: `New Pawn Receipt #${receiptNo} - Approved | LJS Jewellers`,
        html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 28px 24px; text-align: center; border-bottom: 3px solid #d4af37;">
              <div style="display: inline-block; background: linear-gradient(135deg, #d4af37, #f59e0b); color: #0f172a; width: 44px; height: 44px; line-height: 44px; border-radius: 10px; font-size: 22px; font-weight: bold; margin-bottom: 8px;">🪙</div>
              <h1 style="margin: 0; font-size: 24px; letter-spacing: 1.5px; font-weight: 800; color: #ffffff; text-transform: uppercase;">LJS JEWELLERS</h1>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #d4af37; letter-spacing: 2px; text-transform: uppercase; font-weight: 600;">Gold &amp; Silver Pawn Loan Receipt</p>
            </div>
            <div style="padding: 26px 24px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 16px;">
                <div>
                  <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: bold;">Receipt No.</span>
                  <div style="font-size: 15px; font-weight: 800; color: #0f172a;">${receiptNo}</div>
                </div>
                <div style="text-align: right;">
                  <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: bold;">Date</span>
                  <div style="font-size: 13px; font-weight: 600; color: #334155;">${dateFormatted}</div>
                </div>
              </div>

              <div style="background-color: #f0fdf4; color: #166534; border: 1px solid #86efac; padding: 12px 16px; border-radius: 8px; font-weight: bold; text-align: center; margin: 16px 0;">
                ✅ GIRVI RECORD APPROVED &amp; SAFELY STORED (गिरवी रसीद स्वीकृत)
              </div>

              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 16px 0 20px 0;">
                Dear <strong>${customerName}</strong>, aapka naya girvi record safal roop se darz kar liya gaya hai:
              </p>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin-bottom: 22px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Item Pledged:</td>
                    <td style="padding: 8px 0; color: #0f172a; text-align: right; font-weight: 700; font-size: 14px;">${description}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Metal &amp; Weight:</td>
                    <td style="padding: 8px 0; color: #0f172a; text-align: right; font-weight: 600; font-size: 14px;">${itemMetalType || 'Gold'} &bull; ${itemWeightGrams ? itemWeightGrams + 'g' : 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #64748b; font-size: 13px;">Interest Rate:</td>
                    <td style="padding: 8px 0; color: #0f172a; text-align: right; font-weight: 600; font-size: 14px;">${rate}% / Month</td>
                  </tr>
                  <tr style="border-top: 1px dashed #cbd5e1;">
                    <td style="padding: 12px 0 6px 0; color: #0f172a; font-size: 15px; font-weight: 700;">Loan Amount Given:</td>
                    <td style="padding: 12px 0 6px 0; color: #d4af37; text-align: right; font-size: 18px; font-weight: 800;">${formatCurrency(loanAmt)}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 12px; color: #92400e; line-height: 1.4;">
                  <strong>Rule:</strong> Minimum 1 month interest applies if returned within 1-5 days. Half month interest applies if returned within 6-15 days. Day-wise interest applies thereafter.
                </p>
              </div>
            </div>
            <div style="background-color: #0f172a; color: #94a3b8; text-align: center; padding: 18px 20px; font-size: 11px;">
              <p style="margin: 0; color: #cbd5e1;">LJS Jewellers &bull; Trusted Since Generations</p>
            </div>
          </div>
        </body>
        </html>
        `
    };

    return new Promise((resolve) => {
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error(`[Email Error] Failed to send pawn receipt to ${cleanEmail}:`, error.message);
                return resolve(false);
            }
            console.log(`[Email Success] Pawn creation receipt sent to ${cleanEmail} (ID: ${info.messageId})`);
            resolve(true);
        });
    });
}

// 3. Send Customer Account Welcome & Credentials Email
async function sendCustomerWelcomeEmail({
    customerEmail,
    customerName,
    phone,
    username,
    password
}) {
    if (!customerEmail || !customerEmail.includes('@') || customerEmail === 'N/A') return false;
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return false;

    const mailOptions = {
        from: `"LJS Jewellers" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: `Welcome to LJS Jewellers - Your Customer Portal Login`,
        html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 28px 24px; text-align: center; border-bottom: 3px solid #d4af37;">
              <h1 style="margin: 0; font-size: 24px; letter-spacing: 1.5px; font-weight: 800; color: #ffffff;">LJS JEWELLERS</h1>
              <p style="margin: 4px 0 0 0; font-size: 12px; color: #d4af37; letter-spacing: 2px;">Welcome to Digital Customer Portal</p>
            </div>
            <div style="padding: 26px 24px;">
              <p style="font-size: 15px; line-height: 1.6; color: #334155;">
                Namaste <strong>${customerName}</strong> ji, LJS Jewellers me aapka swagat hai! Aapka customer account approve aur create ho chuka hai.
              </p>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #0f172a; font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Aapke Login Credentials:</h3>
                <p style="margin: 8px 0; font-size: 14px;"><strong>Username / Mobile:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${username || phone}</code></p>
                <p style="margin: 8px 0; font-size: 14px;"><strong>Portal Security PIN:</strong> <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 16px; font-weight: bold; color: #2563eb;">${password}</code></p>
              </div>
              <p style="font-size: 13px; color: #64748b;">
                Aap is PIN ke dwara apne customer portal par login karke apni passbook, active loan, interest breakdown, aur online payment kar sakte hain.
              </p>
              <div style="text-align: center; margin-top: 24px;">
                <a href="http://localhost:3001/portal.html" style="display: inline-block; background: linear-gradient(135deg, #0f172a, #1e293b); color: #d4af37; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-weight: bold; font-size: 13px; border: 1px solid #d4af37;">
                  Login to Customer Portal &rarr;
                </a>
              </div>
            </div>
          </div>
        </body>
        </html>
        `
    };

    return new Promise((resolve) => {
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error(`[Email Error] Failed to send welcome email to ${customerEmail}:`, error.message);
                return resolve(false);
            }
            console.log(`[Email Success] Welcome email sent to ${customerEmail}`);
            resolve(true);
        });
    });
}

// Send Customer MFA Login OTP Email
async function sendCustomerOtpEmail({ customerEmail, customerName, otp, expiresInMinutes = 10 }) {
    if (!customerEmail || !customerEmail.includes('@') || customerEmail === 'N/A') return false;
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log(`[MFA] Email credentials not configured, skipping OTP email. OTP was: ${otp}`);
        return false;
    }

    const mailOptions = {
        from: `"LJS Jewellers Security" <${process.env.EMAIL_USER}>`,
        to: customerEmail,
        subject: `🔐 Your Login OTP Code: ${otp} - LJS Jewellers Customer Portal`,
        html: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b;">
          <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
            <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 26px 20px; text-align: center; border-bottom: 3px solid #d4af37;">
              <h1 style="margin: 0; font-size: 22px; letter-spacing: 1.5px; font-weight: 800; color: #ffffff;">LJS JEWELLERS</h1>
              <p style="margin: 4px 0 0 0; font-size: 11px; color: #d4af37; letter-spacing: 2px; text-transform: uppercase;">Customer Portal Security Verification</p>
            </div>
            <div style="padding: 26px 22px; text-align: center;">
              <p style="font-size: 15px; line-height: 1.5; color: #334155; margin-bottom: 8px;">
                Namaste <strong>${customerName}</strong> ji,
              </p>
              <p style="font-size: 14px; color: #64748b; margin-top: 0;">
                Use the One-Time Password (OTP) below to securely login to your Customer Portal:
              </p>
              
              <div style="margin: 24px auto; max-width: 280px; background: #fffbeb; border: 2px dashed #d4af37; border-radius: 12px; padding: 14px 20px;">
                <div style="font-size: 11px; color: #b45309; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">Your 6-Digit OTP</div>
                <div style="font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #0f172a; font-family: 'Courier New', monospace;">${otp}</div>
              </div>

              <p style="font-size: 12px; color: #dc2626; font-weight: 600; margin: 12px 0;">
                ⏱️ This OTP code is valid for ${expiresInMinutes} minutes only.
              </p>
              <p style="font-size: 12px; color: #94a3b8; margin: 18px 0 0 0; line-height: 1.5;">
                ⚠️ <em>Security Warning:</em> Do not share this OTP with anyone, including LJS Jewellers staff. If you did not attempt to login, please ignore this email or contact us immediately.
              </p>
            </div>
            <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 20px; text-align: center; font-size: 11px; color: #94a3b8;">
              &copy; ${new Date().getFullYear()} LJS Jewellers. All rights reserved. Secure Digital Ledger Portal.
            </div>
          </div>
        </body>
        </html>
        `
    };

    return new Promise((resolve) => {
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error(`[MFA Email Error] Failed to send OTP to ${customerEmail}:`, error.message);
                return resolve(false);
            }
            console.log(`[MFA Email Success] OTP sent to ${customerEmail}`);
            resolve(true);
        });
    });
}

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
            const rawPassword = Math.floor(100000 + Math.random() * 900000).toString();
            const passwordHash = hashPassword(rawPassword);
            
            db.run(
                `INSERT INTO customers (name, phone, email, dob, username, password) VALUES (?, ?, ?, ?, ?, ?)`,
                [name, phone, email || null, dob || null, username, passwordHash],
                function (err2) {
                    if (err2) return res.status(500).json({ error: err2.message });
                    db.run("UPDATE pending_approvals SET status = 'Approved' WHERE id = ?", [id]);
                    
                    if (email && email.includes('@')) {
                        sendCustomerWelcomeEmail({
                            customerEmail: email,
                            customerName: name,
                            phone: phone,
                            username: username,
                            password: rawPassword
                        }).catch(e => console.error('Welcome email error:', e));
                    }

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

                    db.get("SELECT * FROM customers WHERE id = ?", [customer_id], (cErr, cust) => {
                        if (cErr) {
                            console.error('[Email] Error fetching customer for pawn email:', cErr);
                        } else if (!cust) {
                            console.log(`[Email] Customer not found for id=${customer_id}, skipping email.`);
                        } else if (!cust.email || !cust.email.includes('@')) {
                            console.log(`[Email] Customer email missing/invalid (${cust.email}), skipping pawn email.`);
                        } else {
                            console.log(`[Email] Sending pawn approval receipt to ${cust.email}...`);
                            sendPawnCreationEmail({
                                customerEmail: cust.email,
                                customerName: cust.name,
                                customerPhone: cust.phone,
                                description,
                                amount,
                                interestRate: interest_rate || 0,
                                itemWeightGrams: item_weight_grams || 0,
                                itemMetalType: item_metal_type || 'Gold',
                                dateAdded
                            }).then(sent => {
                                console.log(`[Email] Pawn creation email ${sent ? 'sent ✅' : 'FAILED ❌'} to ${cust.email}`);
                            }).catch(e => console.error('[Email] Pawn creation email error:', e));
                        }
                    });

                    res.json({ message: 'Pawn record approved & saved!' });
                }
            );
        } else if (row.type === 'RECEIVE_PAYMENT') {
            const { pawn_id, customer_id, amount, payment_type, utr_number, notes } = data;
            const paymentDate = new Date().toISOString();
            const paidAmt = parseFloat(amount || 0);

            db.get(
                `SELECT p.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email 
                 FROM pawn_records p 
                 LEFT JOIN customers c ON p.customer_id = c.id 
                 WHERE p.id = ?`,
                [pawn_id],
                (pErr, pawn) => {
                    db.run(
                        `INSERT INTO pawn_payments (pawn_id, amount, payment_type, payment_date) VALUES (?, ?, ?, ?)`,
                        [pawn_id, paidAmt, payment_type || 'Online UPI Payment', paymentDate],
                        function (err2) {
                            if (err2) return res.status(500).json({ error: err2.message });

                            let newPrincipal = 0;
                            let actualInterest = 0;
                            let extraTowardsPrincipal = 0;

                            if (pawn) {
                                // 1. Calculate interest up to today using standard shop rule
                                const calculatedInterest = calculateInterest(pawn.amount, pawn.interest_rate, pawn.date_added, pawn.status, null);

                                // Actual interest collected is only up to the due interest, rest goes to principal
                                actualInterest = Math.min(paidAmt, calculatedInterest);
                                extraTowardsPrincipal = Math.max(0, paidAmt - calculatedInterest);
                                newPrincipal = Math.max(0, Math.round(pawn.amount - extraTowardsPrincipal));

                                const ledgerNote = extraTowardsPrincipal > 0 
                                    ? `Byaaj: ₹${actualInterest}, Mool Jama: ₹${extraTowardsPrincipal}`
                                    : (payment_type || 'Online UPI Payment');

                                db.run(
                                    `INSERT INTO interest_ledger (pawn_id, customer_name, customer_phone, item_description, principal_amount, interest_amount, payment_date, payment_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [
                                        pawn_id,
                                        pawn.customer_name || 'Customer Record',
                                        pawn.customer_phone || '',
                                        pawn.description || '',
                                        pawn.amount || 0,
                                        actualInterest,
                                        paymentDate,
                                        payment_type || 'Online UPI Payment',
                                        ledgerNote
                                    ]
                                );

                                // If loan is fully cleared (newPrincipal <= 0), auto-release gehna!
                                if (newPrincipal <= 0) {
                                    db.run(
                                        `UPDATE pawn_records SET status = 'Released', release_date = ?, amount = 0 WHERE id = ?`,
                                        [paymentDate, pawn_id]
                                    );
                                } else if (paidAmt >= calculatedInterest) {
                                    db.run(
                                        `UPDATE pawn_records SET date_added = ?, amount = ? WHERE id = ?`,
                                        [paymentDate, newPrincipal, pawn_id]
                                    );
                                }

                                // Auto-send Payment Approval Receipt Email to Customer
                                const sendReceipt = (email, name, phone) => {
                                    if (email && email.includes('@') && email !== 'N/A') {
                                        sendPaymentApprovalEmail({
                                            customerEmail: email,
                                            customerName: name || 'Customer',
                                            customerPhone: phone || '',
                                            itemDescription: pawn.description || 'Pledged Item',
                                            amount: paidAmt,
                                            paymentType: payment_type || 'Online UPI Payment',
                                            utrNumber: utr_number || data.utr || null,
                                            actualInterest: actualInterest,
                                            extraTowardsPrincipal: extraTowardsPrincipal,
                                            newPrincipal: newPrincipal,
                                            isReleased: newPrincipal <= 0,
                                            approvalDate: paymentDate
                                        }).catch(e => console.error('Payment receipt email error:', e));
                                    }
                                };

                                if (pawn.customer_email) {
                                    sendReceipt(pawn.customer_email, pawn.customer_name, pawn.customer_phone);
                                } else if (pawn.customer_id || customer_id) {
                                    const targetCustId = pawn.customer_id || customer_id;
                                    db.get("SELECT * FROM customers WHERE id = ?", [targetCustId], (cErr, cust) => {
                                        if (!cErr && cust) {
                                            sendReceipt(cust.email, cust.name, cust.phone);
                                        }
                                    });
                                }
                            }

                            db.run("UPDATE pending_approvals SET status = 'Approved' WHERE id = ?", [id]);
                            res.json({ message: (pawn && newPrincipal <= 0) ? 'Loan fully cleared! Gehna marked as Released & receipt emailed to customer.' : 'Payment approved & receipt emailed to customer!' });
                        }
                    );
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

// Get all customers with calculated credit score
app.get('/api/customers', (req, res) => {
    db.all('SELECT * FROM customers ORDER BY id DESC', [], (err, customers) => {
        if (err) {
            console.error('Error fetching customers:', err);
            return res.status(500).json({ error: err.message });
        }
        if (!customers || customers.length === 0) {
            return res.json({ customers: [] });
        }

        db.all('SELECT * FROM pawn_records', [], (err, pawns) => {
            const pawnsByCustomer = {};
            (pawns || []).forEach(p => {
                if (!pawnsByCustomer[p.customer_id]) pawnsByCustomer[p.customer_id] = [];
                pawnsByCustomer[p.customer_id].push(p);
            });

            const now = new Date();
            const formatted = (customers || []).map(c => {
                const customerPawns = pawnsByCustomer[c.id] || [];
                let releasedCount = 0;
                let overdueCount = 0;
                let meltedCount = 0;
                let activeNormalCount = 0;

                customerPawns.forEach(p => {
                    if (p.status === 'Released' || p.status === 'Renewed') {
                        releasedCount++;
                    } else if (p.status === 'Melted') {
                        meltedCount++;
                    } else if (p.status === 'Active') {
                        const startDate = new Date(p.date_added);
                        const diffDays = Math.ceil(Math.abs(now - startDate) / (1000 * 60 * 60 * 24));
                        if (diffDays > 180) overdueCount++;
                        else activeNormalCount++;
                    }
                });

                let score = 700 + (releasedCount * 30) + (activeNormalCount * 10) - (overdueCount * 50) - (meltedCount * 150);
                score = Math.min(900, Math.max(300, score));

                return {
                    ...c,
                    password: '[PROTECTED]',
                    credit_score: score
                };
            });

            res.json({ customers: formatted });
        });
    });
});

// Add a new customer
app.post('/api/customers', upload.single('aadhar_photo'), async (req, res) => {
    const { name, phone, email, dob, username, password } = req.body;
    const dateAdded = new Date().toISOString();
    const finalUsername = (username && username.trim()) ? username.trim() : phone.trim();
    const finalPassword = (password && password.trim()) ? password.trim() : Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPassword = hashPassword(finalPassword);
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
        [name, phone, email, dob, dateAdded, aadharPhoto, finalUsername, hashedPassword, qrToken],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (email && email.trim() && email.includes('@')) {
                sendCustomerWelcomeEmail({
                    customerEmail: email.trim(),
                    customerName: name,
                    phone: phone,
                    username: finalUsername,
                    password: finalPassword
                }).catch(e => console.error('[Email] Customer welcome email error:', e));
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

// Reset Customer PIN API Endpoint
app.post('/api/customers/:id/reset-pin', (req, res) => {
    const { id } = req.params;
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedPassword = hashPassword(newPin);
    db.run('UPDATE customers SET password = ? WHERE id = ?', [hashedPassword, id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'PIN reset successfully', newPin: newPin });
    });
});

// Delete a customer (Protected by Master Security PIN)
app.delete('/api/customers/:id', (req, res) => {
    const { id } = req.params;
    const providedPin = (req.headers['x-delete-pin'] || '').toString().trim();
    const expectedPin = String(process.env.ADMIN_PASS || '121965').trim();

    if (!providedPin || providedPin !== expectedPin) {
        return res.status(401).json({ error: 'Galat Security PIN! Record delete nahi hua.' });
    }

    db.run('DELETE FROM customers WHERE id = ?', [id], function (err) {
        if (err) {
            console.error('[Delete] Customer delete error:', err);
            res.status(500).json({ error: err.message || 'Delete failed' });
            return;
        }
        console.log(`[Delete] Customer id=${id} deleted successfully.`);
        res.json({ message: 'Customer deleted successfully' });
    });
});

// Add a pawn receipt for a customer
app.post('/api/customers/:id/pawn', upload.single('item_photo'), async (req, res) => {
    const { id } = req.params;
    const { amount, description, interest_rate, item_weight_grams, item_metal_type, is_udhari, locker_location, is_portal_visible } = req.body;
    const dateAdded = new Date().toISOString();
    const rate = interest_rate || 0;
    const weight = item_weight_grams || 0;
    const metal = item_metal_type || 'Gold';
    const udhariFlag = is_udhari === 'true' ? 1 : 0;
    const locker = (locker_location && locker_location.trim()) ? locker_location.trim() : 'Safe Vault';
    const portalVisible = (is_portal_visible === 0 || is_portal_visible === '0' || is_portal_visible === false || is_portal_visible === 'false') ? 0 : 1;

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
        `INSERT INTO pawn_records (customer_id, amount, description, date_added, interest_rate, status, item_photo, item_weight_grams, item_metal_type, is_udhari, locker_location, is_portal_visible) VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?)`,
        [id, amount, description, dateAdded, rate, itemPhoto, weight, metal, udhariFlag, locker, portalVisible],
        function (err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            const newPawnId = this.lastID;

            // Send Pawn Creation Receipt Email to Customer
            db.get('SELECT * FROM customers WHERE id = ?', [id], (cErr, cust) => {
                const targetEmail = (cust && cust.email) ? cust.email.trim() : '';
                if (!cErr && targetEmail && targetEmail.includes('@') && targetEmail.toUpperCase() !== 'N/A') {
                    console.log(`[Email] Sending pawn creation receipt to ${targetEmail}...`);
                    sendPawnCreationEmail({
                        customerEmail: targetEmail,
                        customerName: cust.name,
                        customerPhone: cust.phone,
                        description: description,
                        amount: amount,
                        interestRate: rate,
                        itemWeightGrams: weight,
                        itemMetalType: metal,
                        dateAdded: dateAdded
                    }).then(sent => {
                        if (sent) console.log(`[Email] Pawn receipt sent successfully to ${targetEmail}`);
                    }).catch(e => console.error('[Email] Pawn creation email error:', e));
                } else {
                    console.log(`[Email] Skipping pawn email - customer email missing or invalid (id=${id}, email=${cust ? cust.email : 'not found'})`);
                }
            });

            res.json({
                message: 'Pawn receipt added successfully',
                id: newPawnId
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

// Toggle/update pawn portal visibility
app.put('/api/pawns/:pawnId/portal-visibility', (req, res) => {
    const { pawnId } = req.params;
    const { is_portal_visible } = req.body;
    const visibleVal = (is_portal_visible === 0 || is_portal_visible === '0' || is_portal_visible === false || is_portal_visible === 'false') ? 0 : 1;

    db.run('UPDATE pawn_records SET is_portal_visible = ? WHERE id = ?', [visibleVal, pawnId], function(err) {
        if (err) {
            console.error('[Pawn Visibility] Update error:', err);
            return res.status(500).json({ error: err.message });
        }
        console.log(`[Pawn Visibility] Pawn id=${pawnId} portal visibility updated to ${visibleVal}`);
        res.json({ message: 'Portal visibility updated successfully', is_portal_visible: visibleVal });
    });
});

// Get all active pawns for Recovery Time calculation (sorted oldest date_added first)
app.get('/api/recovery-pawns', (req, res) => {
    db.all(`
        SELECT p.*, c.name as customer_name, c.phone as customer_phone,
               COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id), 0) as total_jama
        FROM pawn_records p
        JOIN customers c ON p.customer_id = c.id
        WHERE p.status = 'Active'
        ORDER BY p.date_added ASC
    `, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ pawns: rows || [] });
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

// Renew a pawn receipt (Byaaj Closing & Auto Issue Fresh Receipt)
app.post('/api/customers/:id/pawn/:pawnId/renew', (req, res) => {
    const { id: customerId, pawnId } = req.params;
    const {
        interest_collected,
        new_principal_amount,
        new_interest_rate,
        new_locker_location,
        notes
    } = req.body;

    const renewDate = new Date().toISOString();

    db.get(
        `SELECT p.*, c.name as customer_name, c.phone as customer_phone 
         FROM pawn_records p 
         LEFT JOIN customers c ON p.customer_id = c.id 
         WHERE p.id = ? AND p.customer_id = ?`,
        [pawnId, customerId],
        (pErr, oldPawn) => {
            if (pErr || !oldPawn) {
                return res.status(404).json({ error: 'Original pawn receipt not found' });
            }

            const settledInterest = parseFloat(interest_collected) || 0;
            const newPrincipal = parseFloat(new_principal_amount) || oldPawn.amount;
            const newRate = parseFloat(new_interest_rate) || oldPawn.interest_rate || 2;
            const locker = (new_locker_location && new_locker_location.trim()) ? new_locker_location.trim() : (oldPawn.locker_location || 'Safe Vault');
            const renewNotes = notes || `Renewed on ${new Date().toLocaleDateString('en-IN')}`;

            // 1. Update Old Pawn to 'Renewed' status
            db.run(
                `UPDATE pawn_records SET status = 'Renewed', release_date = ? WHERE id = ?`,
                [renewDate, pawnId],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    // 2. Record interest collection payment
                    if (settledInterest > 0) {
                        db.run(
                            `INSERT INTO pawn_payments (pawn_id, amount, payment_type, payment_date) VALUES (?, ?, ?, ?)`,
                            [pawnId, settledInterest, 'Byaaj Closing Interest Settlement', renewDate]
                        );

                        db.run(
                            `INSERT INTO interest_ledger (pawn_id, customer_name, customer_phone, item_description, principal_amount, interest_amount, payment_date, payment_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                oldPawn.id,
                                oldPawn.customer_name || 'Customer Record',
                                oldPawn.customer_phone || '',
                                oldPawn.description || '',
                                oldPawn.amount || 0,
                                settledInterest,
                                renewDate,
                                'Byaaj Closing Interest Collection',
                                renewNotes
                            ]
                        );
                    }

                    // 3. Issue new Active Pawn Receipt starting today
                    const newDescription = oldPawn.description.includes('(Renewed)') 
                        ? oldPawn.description 
                        : `${oldPawn.description} (Renewed)`;
                    const renewVisibility = (oldPawn.is_portal_visible === 0 || oldPawn.is_portal_visible === '0' || oldPawn.is_portal_visible === false) ? 0 : 1;

                    db.run(
                        `INSERT INTO pawn_records (customer_id, amount, description, date_added, interest_rate, status, item_photo, item_weight_grams, item_metal_type, is_udhari, locker_location, is_portal_visible) VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?)`,
                        [
                            customerId,
                            newPrincipal,
                            newDescription,
                            renewDate,
                            newRate,
                            oldPawn.item_photo || null,
                            oldPawn.item_weight_grams || 0,
                            oldPawn.item_metal_type || 'Gold',
                            oldPawn.is_udhari || 0,
                            locker,
                            renewVisibility
                        ],
                        function (insErr) {
                            if (insErr) return res.status(500).json({ error: insErr.message });
                            
                            const newId = this.lastID;
                            
                            // Send Pawn Renewal Receipt Email
                            db.get('SELECT * FROM customers WHERE id = ?', [customerId], (cErr, cust) => {
                                const targetEmail = (cust && cust.email) ? cust.email.trim() : '';
                                if (!cErr && targetEmail && targetEmail.includes('@') && targetEmail.toUpperCase() !== 'N/A') {
                                    console.log(`[Email] Sending renewed pawn receipt to ${targetEmail}...`);
                                    sendPawnCreationEmail({
                                        customerEmail: targetEmail,
                                        customerName: cust.name,
                                        customerPhone: cust.phone,
                                        description: newDescription,
                                        amount: newPrincipal,
                                        interestRate: newRate,
                                        itemWeightGrams: oldPawn.item_weight_grams || 0,
                                        itemMetalType: oldPawn.item_metal_type || 'Gold',
                                        dateAdded: renewDate
                                    }).catch(e => console.error('[Email] Pawn renew email error:', e));
                                }
                            });

                            res.json({
                                message: 'Pawn successfully renewed! Fresh receipt created.',
                                newPawnId: newId
                            });
                        }
                    );
                }
            );
        }
    );
});

// Add partial payment
app.post('/api/pawns/:pawnId/payments', (req, res) => {
    const { pawnId } = req.params;
    const { amount, payment_type } = req.body;
    const paymentDate = new Date().toISOString();

    db.get(
        `SELECT p.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email 
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
                        const paidAmt = parseFloat(amount || 0);

                        // 1. Calculate interest up to today using standard shop rule
                        const calculatedInterest = calculateInterest(pawn.amount, pawn.interest_rate, pawn.date_added, pawn.status, null);

                        const actualInterest = Math.min(paidAmt, calculatedInterest);
                        const extraTowardsPrincipal = Math.max(0, paidAmt - calculatedInterest);
                        const newPrincipal = Math.max(0, Math.round(pawn.amount - extraTowardsPrincipal));

                        const ledgerNote = extraTowardsPrincipal > 0 
                            ? `Byaaj: ₹${actualInterest}, Mool Jama: ₹${extraTowardsPrincipal}`
                            : (payment_type || 'Payment Received & Date Reset');

                        db.run(
                            `INSERT INTO interest_ledger (pawn_id, customer_name, customer_phone, item_description, principal_amount, interest_amount, payment_date, payment_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                pawnId,
                                pawn.customer_name || 'Customer Record',
                                pawn.customer_phone || '',
                                pawn.description || '',
                                pawn.amount || 0,
                                actualInterest,
                                paymentDate,
                                payment_type || 'Partial Interest Payment',
                                ledgerNote
                            ]
                        );

                        // If loan is fully cleared (newPrincipal <= 0), auto-release gehna!
                        if (newPrincipal <= 0) {
                            db.run(
                                `UPDATE pawn_records SET status = 'Released', release_date = ?, amount = 0 WHERE id = ?`,
                                [paymentDate, pawnId]
                            );
                        } else if (paidAmt >= calculatedInterest) {
                            db.run(
                                `UPDATE pawn_records SET date_added = ?, amount = ? WHERE id = ?`,
                                [paymentDate, newPrincipal, pawnId]
                            );
                        }

                        // Send Receipt Email to Customer
                        const sendReceipt = (email, name, phone) => {
                            if (email && email.includes('@') && email !== 'N/A') {
                                sendPaymentApprovalEmail({
                                    customerEmail: email,
                                    customerName: name || 'Customer',
                                    customerPhone: phone || '',
                                    itemDescription: pawn.description || 'Pledged Item',
                                    amount: paidAmt,
                                    paymentType: payment_type || 'Cash / Counter Payment',
                                    utrNumber: null,
                                    actualInterest: actualInterest,
                                    extraTowardsPrincipal: extraTowardsPrincipal,
                                    newPrincipal: newPrincipal,
                                    isReleased: newPrincipal <= 0,
                                    approvalDate: paymentDate
                                }).catch(e => console.error('Payment receipt email error:', e));
                            }
                        };

                        if (pawn.customer_email) {
                            sendReceipt(pawn.customer_email, pawn.customer_name, pawn.customer_phone);
                        } else if (pawn.customer_id) {
                            db.get("SELECT * FROM customers WHERE id = ?", [pawn.customer_id], (cErr, cust) => {
                                if (!cErr && cust) {
                                    sendReceipt(cust.email, cust.name, cust.phone);
                                }
                            });
                        }
                    }

                    res.json({ message: 'Payment added successfully & record updated', id: this.lastID });
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

        // 4. Total Interest Collected (Released Items Interest + Ledger Collected Interest)
        const releasedPawns = await dbAll(`SELECT * FROM pawn_records WHERE status = 'Released'`, []);
        let releasedInterestTotal = 0;
        releasedPawns.forEach(p => {
            const interest = calculateInterest(p.amount, p.interest_rate, p.date_added, 'Released', p.release_date);
            releasedInterestTotal += interest;
        });

        const ledgerRows = await dbAll(`SELECT SUM(interest_amount) as total FROM interest_ledger`, []);
        const ledgerTotal = parseFloat((ledgerRows[0] && ledgerRows[0].total) || 0);

        data.totalInterestCollected = Math.round(releasedInterestTotal + ledgerTotal);

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
                data.totalNaame = rows.reduce((sum, row) => sum + parseFloat(row.amount || 0), 0);
            }

            // 2. Released Pawns (Jama)
            db.all(`
                SELECT p.*, c.name as customer_name,
                COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id AND payment_date NOT LIKE ?), 0) as total_jama_before,
                COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id AND payment_date LIKE ?), 0) as total_jama_today,
                (SELECT payment_type FROM pawn_payments WHERE pawn_id = p.id AND payment_date LIKE ? ORDER BY id DESC LIMIT 1) as today_payment_type
                FROM pawn_records p 
                JOIN customers c ON p.customer_id = c.id 
                WHERE p.status = 'Released' AND p.release_date LIKE ?
            `, [dateParam + '%', dateParam + '%', dateParam + '%', dateParam + '%'], (err, releasedRows) => {
                const releasedPawnIds = new Set();
                if (releasedRows) {
                    releasedRows.forEach(p => {
                        releasedPawnIds.add(p.id);
                        // Calculate interest dynamically using calcServerPawnInterest
                        const interest = calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, 'Released', p.release_date);
                        
                        const principal = parseFloat(p.amount || 0);
                        const totalJamaBefore = parseFloat(p.total_jama_before || 0);
                        const totalJamaToday = parseFloat(p.total_jama_today || 0);
                        
                        // Final collection: if payment recorded today, that's what was collected; otherwise (principal + interest) - previous payments
                        const finalCollection = totalJamaToday > 0 ? totalJamaToday : Math.max(0, (principal + interest) - totalJamaBefore);
                        
                        p.calculated_interest = interest;
                        p.final_collection = finalCollection > 0 ? finalCollection : 0;
                        p.payment_type = p.today_payment_type || null;
                        data.totalJama += p.final_collection;
                        data.releasedPawns.push(p);
                    });
                }

                // 3. Partial Payments (Jama) - Exclude payments for pawns released today so they don't get double counted
                db.all(`
                    SELECT pp.*, p.description, p.status as pawn_status, p.release_date, c.name as customer_name
                    FROM pawn_payments pp
                    JOIN pawn_records p ON pp.pawn_id = p.id
                    JOIN customers c ON p.customer_id = c.id
                    WHERE pp.payment_date LIKE ?
                `, [dateParam + '%'], (err, paymentRows) => {
                    if (paymentRows) {
                        const genuinePartialPayments = paymentRows.filter(row => !releasedPawnIds.has(row.pawn_id));
                        data.payments = genuinePartialPayments;
                        data.totalJama += genuinePartialPayments.reduce((sum, row) => sum + parseFloat(row.amount || 0), 0);
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
                    COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id AND payment_date < p.release_date AND substr(payment_date, 1, 10) != substr(p.release_date, 1, 10)), 0) as total_jama_before,
                    COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id AND substr(payment_date, 1, 10) = substr(p.release_date, 1, 10)), 0) as total_jama_today
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
                            const totalJamaBefore = parseFloat(p.total_jama_before || 0);
                            const totalJamaToday = parseFloat(p.total_jama_today || 0);
                            const finalCollection = totalJamaToday > 0 ? totalJamaToday : Math.max(0, (principal + interest) - totalJamaBefore);
                            
                            // Subtract totalJamaToday if it was already grouped into paymentRows for this day
                            const netAddition = totalJamaToday > 0 ? 0 : finalCollection;
                            if (netAddition > 0) {
                                jamaMap[day] = (jamaMap[day] || 0) + netAddition;
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

            // 2. Partial Payments (Jama) - only include payments for pawns not released on the same day
            db.all(`SELECT py.*, c.name as customer_name, p.status as pawn_status, p.release_date
                    FROM pawn_payments py 
                    JOIN pawn_records p ON py.pawn_id = p.id 
                    JOIN customers c ON p.customer_id = c.id 
                    WHERE py.payment_date BETWEEN ? AND ?`, [isoStart, isoEnd], (err, payments) => {
                if (payments) {
                    payments.forEach(py => {
                        const payDay = formatDate(py.payment_date);
                        const relDay = formatDate(py.release_date);
                        if (py.pawn_status === 'Released' && payDay === relDay) {
                            return; // Skip duplicate, accounted in Released Items
                        }
                        csvRows.push([
                            formatDate(py.payment_date), 
                            py.customer_name, 
                            py.payment_type ? `Partial Payment (${py.payment_type})` : 'Partial Payment', 
                            'Payment Received', 
                            'Jama (In)', 
                            parseFloat(py.amount).toFixed(2)
                        ].map(escapeCsv).join(','));
                    });
                }

                // 3. Released Items (Jama)
                db.all(`SELECT p.*, c.name as customer_name,
                        COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id AND payment_date < p.release_date AND substr(payment_date, 1, 10) != substr(p.release_date, 1, 10)), 0) as total_jama_before,
                        COALESCE((SELECT SUM(amount) FROM pawn_payments WHERE pawn_id = p.id AND substr(payment_date, 1, 10) = substr(p.release_date, 1, 10)), 0) as total_jama_today,
                        (SELECT payment_type FROM pawn_payments WHERE pawn_id = p.id AND substr(payment_date, 1, 10) = substr(p.release_date, 1, 10) ORDER BY id DESC LIMIT 1) as today_payment_type
                        FROM pawn_records p JOIN customers c ON p.customer_id = c.id 
                        WHERE p.status = 'Released' AND p.release_date BETWEEN ? AND ?`, [isoStart, isoEnd], (err, releasedPawns) => {
                    
                    if (releasedPawns) {
                        releasedPawns.forEach(p => {
                            // Calculate interest dynamically using calcServerPawnInterest
                            const interest = calcServerPawnInterest(p.amount, p.interest_rate, p.date_added, 'Released', p.release_date);
                            
                            const principal = parseFloat(p.amount);
                            const totalJamaBefore = parseFloat(p.total_jama_before || 0);
                            const totalJamaToday = parseFloat(p.total_jama_today || 0);
                            const finalCollection = totalJamaToday > 0 ? totalJamaToday : Math.max(0, (principal + interest) - totalJamaBefore);
                            
                            const descDetails = p.today_payment_type ? `${p.description} [${p.today_payment_type}]` : `${p.description} (Released)`;

                            if (finalCollection > 0) {
                                csvRows.push([
                                    formatDate(p.release_date), 
                                    p.customer_name, 
                                    descDetails, 
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
    const now = new Date().toISOString();
    db.run(
        `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
        [key, rate, rate],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            // Also update timestamp in settings
            db.run(
                `INSERT INTO settings (key, value) VALUES ('rates_updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = ?`,
                [now, now],
                () => {}
            );
            res.json({ message: 'Rate updated successfully', key, rate, updated_at: now });
        }
    );
});

// ============================================
// BIRTHDAY EMAIL AUTOMATION (CRON JOB)
// ============================================

// Run every day at 8:00 AM ('0 8 * * *')
// Skipped on Vercel/serverless (no persistent background jobs)
if (!process.env.VERCEL) {
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
} // end if (!process.env.VERCEL) — cron not supported on serverless

// Helper for interest calculation on server
// calcServerPawnInterest is an alias for calculateInterest (defined at top of file)
const calcServerPawnInterest = calculateInterest;

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
        // Fetch visible pawns for this customer
        db.all('SELECT * FROM pawn_records WHERE customer_id = ? AND (is_portal_visible = 1 OR is_portal_visible IS NULL) ORDER BY id DESC', [customer.id], (err, pawns) => {
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
                const paymentsListByPawn = {};
                (payments || []).forEach(pm => {
                    if (!paymentsListByPawn[pm.pawn_id]) paymentsListByPawn[pm.pawn_id] = [];
                    paymentsListByPawn[pm.pawn_id].push(pm);
                });

                let totalPrincipal = 0;
                let totalInterest = 0;
                let totalJama = 0;

                const formattedPawns = pawns.map(p => {
                    const interest = calculateInterest(p.amount, p.interest_rate, p.date_added, p.status, p.release_date);
                    const pList = paymentsListByPawn[p.id] || [];
                    const pDate = new Date(p.date_added);

                    // Only count payments in the current cycle (after last date reset)
                    // Using > (strictly greater than) - same-day payments already reflected in reduced principal
                    let paidInCycle = 0;
                    pList.forEach(pm => {
                        const payDate = new Date(pm.payment_date);
                        if (p.status === 'Released' || payDate > pDate) {
                            paidInCycle += parseFloat(pm.amount || 0);
                        }
                    });

                    let baki = Math.max(0, Math.round((p.amount + interest) - paidInCycle));
                    if (p.status === 'Released' || p.amount <= 0) baki = 0;

                    if (p.status === 'Active') {
                        totalPrincipal += p.amount;
                        totalInterest += interest;
                        totalJama += paidInCycle;
                    }

                    return {
                        id: p.id,
                        description: p.description,
                        amount: p.amount,
                        interest_rate: p.interest_rate,
                        calculated_interest: Math.round(interest),
                        paid: Math.round(paidInCycle),
                        baki: baki,
                        status: p.status,
                        date_added: p.date_added,
                        item_metal_type: p.item_metal_type || 'Gold',
                        item_weight_grams: p.item_weight_grams || 0,
                        item_photo: p.item_photo,
                        is_udhari: p.is_udhari
                    };
                });

                const netBalance = Math.max(0, Math.round((totalPrincipal + totalInterest) - totalJama));

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
                    netBalance: netBalance
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

// GET Generate Security Captcha
app.get('/api/portal/captcha', (req, res) => {
    const captcha = generateCaptchaSvg();
    res.json({
        token: captcha.token,
        svg: captcha.svg
    });
});

// Helper: Format and return customer portal data (pawns, bills, totals)
function returnCustomerPortalData(customer, res) {
    db.all('SELECT * FROM pawn_records WHERE customer_id = ? AND (is_portal_visible = 1 OR is_portal_visible IS NULL) ORDER BY id DESC', [customer.id], (err, pawns) => {
        if (err) return res.status(500).json({ error: err.message });
        const pawnIds = (pawns || []).map(p => p.id);
        if (pawnIds.length === 0) {
            db.all('SELECT * FROM bills WHERE customer_phone = ? OR customer_id = ? ORDER BY id DESC', [customer.phone, customer.id], (bErr, billRows) => {
                const customerBills = (billRows || []).map(parseBillItems);
                return res.json({
                    role: 'customer',
                    active: true,
                    customer: { id: customer.id, name: customer.name, phone: customer.phone, username: customer.username },
                    pawns: [],
                    bills: customerBills,
                    totalPrincipal: 0,
                    totalInterest: 0,
                    totalJama: 0,
                    netBalance: 0
                });
            });
            return;
        }

        db.all(`SELECT * FROM pawn_payments WHERE pawn_id IN (${pawnIds.join(',')})`, [], (err, payments) => {
            const paymentsListByPawn = {};
            (payments || []).forEach(pm => {
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
                const interest = calculateInterest(p.amount, p.interest_rate, p.date_added, p.status, p.release_date);
                const pList = paymentsListByPawn[p.id] || [];
                const pDate = new Date(p.date_added);

                // Only count payments made in the current active cycle (since last reset)
                let paidInCycle = 0;
                pList.forEach(pm => {
                    const payDate = new Date(pm.payment_date);
                    if (p.status === 'Released' || payDate > pDate) {
                        paidInCycle += parseFloat(pm.amount || 0);
                    }
                });

                let baki = Math.max(0, Math.round((p.amount + interest) - paidInCycle));
                if (p.status === 'Released' || p.amount <= 0) {
                    baki = 0;
                }

                if (p.status === 'Active') {
                    totalPrincipal += p.amount;
                    totalInterest += interest;
                    totalJama += paidInCycle;
                }

                return {
                    id: p.id,
                    description: p.description,
                    amount: p.amount,
                    interest_rate: p.interest_rate,
                    calculated_interest: Math.round(interest),
                    paid: Math.round(paidInCycle),
                    baki: baki,
                    status: p.status,
                    date_added: p.date_added,
                    item_metal_type: p.item_metal_type || 'Gold',
                    item_weight_grams: p.item_weight_grams || 0,
                    item_photo: p.item_photo,
                    is_udhari: p.is_udhari,
                    payments: pList
                };
            });

            const netBalance = Math.round((totalPrincipal + totalInterest) - totalJama);

            // Also fetch customer bills
            db.all('SELECT * FROM bills WHERE customer_phone = ? OR customer_id = ? ORDER BY id DESC', [customer.phone, customer.id], (bErr, billRows) => {
                const customerBills = (billRows || []).map(parseBillItems);
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
                    bills: customerBills,
                    totalPrincipal: Math.round(totalPrincipal),
                    totalInterest: Math.round(totalInterest),
                    totalJama: Math.round(totalJama),
                    netBalance: Math.max(0, netBalance)
                });
            });
        });
    });
}

// POST Customer Portal Login (Step 1: Credentials & CAPTCHA -> Issues MFA Challenge)
app.post('/api/portal/login', (req, res) => {
    // SECURITY: Brute-force check
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    const bf = checkBruteForce(ip);
    if (bf.blocked) {
        return res.status(429).json({
            error: `Too many failed attempts. Try again in ${bf.mins} minute${bf.mins > 1 ? 's' : ''}.`
        });
    }

    const { username, password, captchaToken, captchaAnswer } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Please enter Username/Phone and Password/PIN.' });
    }

    const cleanInput = username.trim();
    const cleanPwd = password.trim();

    // Check Admin Login (Support 'admin', 'jitendra', env variables)
    const configuredAdmin = String(process.env.ADMIN_USER || 'jitendra').trim().toLowerCase();
    const validAdminUsers = [configuredAdmin, 'admin', 'jitendra', 'owner'];
    const adminPass = String(process.env.ADMIN_PASS || process.env.DELETE_PIN || '121965').trim();

    if (validAdminUsers.includes(cleanInput.toLowerCase()) && String(cleanPwd).trim() === adminPass) {
        clearFailedLogin(ip);
        return res.json({
            role: 'admin',
            message: 'Admin login successful'
        });
    }

    // Verify CAPTCHA for Customer Login
    if (!captchaToken || !captchaAnswer || !verifyCaptcha(captchaToken, captchaAnswer)) {
        return res.status(400).json({ error: 'Incorrect security CAPTCHA. Please enter the characters shown in the box.', reloadCaptcha: true });
    }

    const phoneClean = cleanInput.replace(/[^0-9]/g, '');

    db.all(
        'SELECT * FROM customers WHERE username = ? OR phone = ? OR REPLACE(phone, " ", "") = ? OR REPLACE(phone, "-", "") = ?',
        [cleanInput, cleanInput, phoneClean, phoneClean],
        (err, customers) => {
            if (err) {
                console.error('Portal Login Error:', err);
                return res.status(500).json({ error: 'Database query error.' });
            }
            if (!customers || customers.length === 0) {
                recordFailedLogin(ip);
                return res.status(401).json({ error: 'Invalid Username/Phone or Password/PIN.', reloadCaptcha: true });
            }

            const customer = customers.find(c => verifyPassword(cleanPwd, c.password));
            if (!customer) {
                recordFailedLogin(ip);
                return res.status(401).json({ error: 'Invalid Username/Phone or Password/PIN.', reloadCaptcha: true });
            }

            // Auto-upgrade legacy plain text password to bcrypt hash in DB
            if (!isBcryptHash(customer.password)) {
                const newHash = hashPassword(cleanPwd);
                db.run('UPDATE customers SET password = ? WHERE id = ?', [newHash, customer.id]);
            }

            if (customer.portal_active === 0) {
                return res.status(403).json({
                    active: false,
                    error: 'Your Portal Access has been deactivated by LJS Jewellers.'
                });
            }

            // Step 1 Success: Generate 6-Digit MFA OTP
            clearFailedLogin(ip); // Clear brute-force counter on successful credentials
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            console.log(`[Customer MFA OTP] Generated code for ${customer.name} (${customer.phone}): ${otp}`);

            const mfaToken = signMfaChallenge({
                customerId: customer.id,
                otp: otp,
                phone: customer.phone,
                email: customer.email,
                name: customer.name
            });

            // Send OTP email if customer email is present
            if (customer.email && customer.email.includes('@') && customer.email !== 'N/A') {
                sendCustomerOtpEmail({
                    customerEmail: customer.email,
                    customerName: customer.name,
                    otp: otp,
                    expiresInMinutes: 10
                }).catch(e => console.error('[MFA Email Send Error]:', e));
            }

            let maskedContact = '';
            if (customer.phone) {
                const last4 = customer.phone.slice(-4);
                maskedContact = `📱 ******${last4}`;
            }
            if (customer.email && customer.email.includes('@')) {
                const maskedEmail = customer.email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
                maskedContact = maskedContact ? `📧 ${maskedEmail} | ${maskedContact}` : `📧 ${maskedEmail}`;
            }

            res.json({
                mfaRequired: true,
                mfaToken: mfaToken,
                maskedContact: maskedContact || 'your registered contact (Phone/Email)',
                message: 'A 6-digit OTP has been sent to your registered contact.'
            });
        }
    );
});

// POST Customer Portal MFA Verify (Step 2: 6-Digit OTP Verification)
app.post('/api/portal/verify-otp', (req, res) => {
    const { mfaToken, otp } = req.body;
    if (!mfaToken || !otp) {
        return res.status(400).json({ error: 'Please enter the 6-digit OTP code.' });
    }

    const verification = verifyMfaChallenge(mfaToken, otp);
    if (!verification.valid) {
        return res.status(400).json({ error: verification.error || 'Invalid OTP code. Please try again.' });
    }

    const customerId = verification.customerId;
    db.get('SELECT * FROM customers WHERE id = ?', [customerId], (err, customer) => {
        if (err || !customer) {
            return res.status(404).json({ error: 'Customer record not found. Please log in again.' });
        }

        if (customer.portal_active === 0) {
            return res.status(403).json({
                active: false,
                error: 'Your Portal Access has been deactivated by LJS Jewellers.'
            });
        }

        console.log(`[MFA Success] Customer ${customer.name} (id=${customer.id}) verified successfully.`);
        returnCustomerPortalData(customer, res);
    });
});

// POST Resend Customer Portal MFA OTP
app.post('/api/portal/resend-otp', (req, res) => {
    const { mfaToken } = req.body;
    if (!mfaToken) {
        return res.status(400).json({ error: 'Missing security token. Please log in again.' });
    }

    let payload;
    try {
        const parts = mfaToken.split('.');
        const b64 = parts[0];
        const sig = parts[1];
        const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(b64).digest('base64url');
        if (sig !== expectedSig) {
            return res.status(400).json({ error: 'Invalid security token.' });
        }
        payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    } catch (e) {
        return res.status(400).json({ error: 'Malformed security token.' });
    }

    if (!payload.cid) {
        return res.status(400).json({ error: 'Invalid token data.' });
    }

    db.get('SELECT * FROM customers WHERE id = ?', [payload.cid], (err, customer) => {
        if (err || !customer) {
            return res.status(404).json({ error: 'Customer record not found.' });
        }

        const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(`[Customer MFA] Resent OTP for ${customer.name} (${customer.phone}): ${newOtp}`);

        const newMfaToken = signMfaChallenge({
            customerId: customer.id,
            otp: newOtp,
            phone: customer.phone,
            email: customer.email,
            name: customer.name
        });

        if (customer.email && customer.email.includes('@') && customer.email !== 'N/A') {
            sendCustomerOtpEmail({
                customerEmail: customer.email,
                customerName: customer.name,
                otp: newOtp,
                expiresInMinutes: 10
            }).catch(e => console.error('[MFA Resend Email Error]:', e));
        }

        let maskedContact = '';
        if (customer.phone) {
            const last4 = customer.phone.slice(-4);
            maskedContact = `📱 ******${last4}`;
        }
        if (customer.email && customer.email.includes('@')) {
            const maskedEmail = customer.email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
            maskedContact = maskedContact ? `📧 ${maskedEmail} | ${maskedContact}` : `📧 ${maskedEmail}`;
        }

        res.json({
            message: 'A new 6-digit OTP has been sent successfully.',
            mfaToken: newMfaToken,
            maskedContact: maskedContact || 'your registered contact'
        });
    });
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

// -------------------------------------------------------------
// ONLINE PAYMENT ENDPOINTS (PhonePe PG + Manual UPI QR with UTR)
// -------------------------------------------------------------

// 1. Submit Manual UPI QR Payment with UTR for Admin Approval
app.post('/api/payments/submit-utr', (req, res) => {
    const { pawn_id, customer_id, customer_name, customer_phone, amount, utr_number, notes } = req.body;
    
    if (!pawn_id || !amount || !utr_number) {
        return res.status(400).json({ error: 'Pawn ID, amount, and 12-digit UTR/Txn number are required.' });
    }

    const cleanUtr = String(utr_number).trim();
    const dataJson = JSON.stringify({
        pawn_id: parseInt(pawn_id),
        customer_id: customer_id ? parseInt(customer_id) : null,
        amount: parseFloat(amount),
        payment_type: `Online UPI (UTR: ${cleanUtr})`,
        utr_number: cleanUtr,
        notes: notes || 'Submitted from Customer Portal UPI QR'
    });

    const staffName = customer_name ? `${customer_name} (Portal UTR: ${cleanUtr})` : `Customer (Portal UTR: ${cleanUtr})`;
    const createdAt = new Date().toISOString();

    db.run(
        `INSERT INTO pending_approvals (type, staff_name, data_json, status, created_at) VALUES (?, ?, ?, 'Pending', ?)`,
        ['RECEIVE_PAYMENT', staffName, dataJson, createdAt],
        function (err) {
            if (err) {
                console.error('Error recording UTR payment request:', err);
                return res.status(500).json({ error: 'Failed to submit payment request' });
            }
            res.json({
                success: true,
                message: 'Aapka UTR payment submit ho gaya hai! Dukan owner dwara verify hone ke baad byaaj ledger me update ho jayega.',
                approval_id: this.lastID
            });
        }
    );
});

// 2. Initiate PhonePe Payment Gateway
app.post('/api/phonepe/initiate-payment', async (req, res) => {
    try {
        const { pawn_id, customer_id, amount, customer_phone } = req.body;
        const numAmount = parseFloat(amount || 0);

        if (!pawn_id || numAmount <= 0) {
            return res.status(400).json({ error: 'Valid Pawn ID and amount required.' });
        }

        const merchantId = process.env.PHONEPE_MERCHANT_ID || 'PGTESTPAYUAT';
        const saltKey = process.env.PHONEPE_SALT_KEY || '099eb0cd-02cf-4e2a-8aca-3e6c6aff0399';
        const saltIndex = process.env.PHONEPE_SALT_INDEX || '1';
        const envMode = (process.env.PHONEPE_ENV || 'SANDBOX').toUpperCase();

        const hostUrl = `${req.protocol}://${req.get('host')}`;
        const txnId = 'LJS_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

        const payload = {
            merchantId: merchantId,
            merchantTransactionId: txnId,
            merchantUserId: customer_id ? 'CUST_' + customer_id : 'GUEST_' + Date.now(),
            amount: Math.round(numAmount * 100),
            redirectUrl: `${hostUrl}/api/phonepe/callback?txnId=${txnId}&pawnId=${pawn_id}&amt=${numAmount}`,
            redirectMode: 'POST',
            callbackUrl: `${hostUrl}/api/phonepe/callback?txnId=${txnId}&pawnId=${pawn_id}&amt=${numAmount}`,
            mobileNumber: (customer_phone || '').replace(/[^0-9]/g, '').slice(-10) || '9999999999',
            paymentInstrument: { type: 'PAY_PAGE' }
        };

        const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
        const endpoint = '/pg/v1/pay';
        const checksumStr = base64Payload + endpoint + saltKey;
        const sha256Hash = crypto.createHash('sha256').update(checksumStr).digest('hex');
        const xVerify = sha256Hash + '###' + saltIndex;

        const apiUrl = envMode === 'PRODUCTION'
            ? 'https://api.phonepe.com/apis/hermes/pg/v1/pay'
            : 'https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay';

        const phonepeRes = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-VERIFY': xVerify
            },
            body: JSON.stringify({ request: base64Payload })
        });

        const data = await phonepeRes.json();

        if (data.success && data.data && data.data.instrumentResponse && data.data.instrumentResponse.redirectInfo) {
            const redirectUrl = data.data.instrumentResponse.redirectInfo.url;
            res.json({ success: true, redirectUrl, txnId });
        } else {
            console.error('PhonePe API Error Response:', data);
            res.status(400).json({ error: data.message || 'PhonePe payment initiation failed', data });
        }
    } catch (err) {
        console.error('PhonePe Initiate Error:', err);
        res.status(500).json({ error: 'Server error while initiating PhonePe payment: ' + err.message });
    }
});

// 3. PhonePe Payment Callback & Status Verification
app.all('/api/phonepe/callback', async (req, res) => {
    try {
        const txnId = req.query.txnId || req.body?.merchantTransactionId;
        const pawnId = req.query.pawnId;
        const amt = parseFloat(req.query.amt || 0);

        if (!txnId) {
            return res.redirect('/portal.html?payment=failed&reason=invalid_transaction');
        }

        const merchantId = process.env.PHONEPE_MERCHANT_ID || 'PGTESTPAYUAT';
        const saltKey = process.env.PHONEPE_SALT_KEY || '099eb0cd-02cf-4e2a-8aca-3e6c6aff0399';
        const saltIndex = process.env.PHONEPE_SALT_INDEX || '1';
        const envMode = (process.env.PHONEPE_ENV || 'SANDBOX').toUpperCase();

        const endpoint = `/pg/v1/status/${merchantId}/${txnId}`;
        const checksumStr = endpoint + saltKey;
        const sha256Hash = crypto.createHash('sha256').update(checksumStr).digest('hex');
        const xVerify = sha256Hash + '###' + saltIndex;

        const apiUrl = envMode === 'PRODUCTION'
            ? `https://api.phonepe.com/apis/hermes${endpoint}`
            : `https://api-preprod.phonepe.com/apis/pg-sandbox${endpoint}`;

        const statusRes = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-VERIFY': xVerify,
                'X-MERCHANT-ID': merchantId
            }
        });

        const statusData = await statusRes.json();

        if (statusData.code === 'PAYMENT_SUCCESS' || (statusData.success && statusData.data?.responseCode === 'SUCCESS')) {
            const paymentDate = new Date().toISOString();
            const finalAmount = amt || (statusData.data?.amount ? statusData.data.amount / 100 : 0);

            if (pawnId && finalAmount > 0) {
                db.run(
                    `INSERT INTO pawn_payments (pawn_id, amount, payment_type, payment_date) VALUES (?, ?, ?, ?)`,
                    [pawnId, finalAmount, `PhonePe PG Online (Txn: ${txnId})`, paymentDate],
                    (err) => {
                        if (err) console.error('Error inserting PhonePe payment:', err);
                    }
                );
            }
            return res.redirect(`/portal.html?payment=success&txn=${txnId}&amt=${finalAmount}`);
        } else {
            console.warn('PhonePe Payment Verification Failed/Pending:', statusData);
            return res.redirect(`/portal.html?payment=failed&txn=${txnId}&reason=${encodeURIComponent(statusData.message || 'Payment not completed')}`);
        }
    } catch (err) {
        console.error('PhonePe Callback Error:', err);
        return res.redirect('/portal.html?payment=failed&reason=server_error');
    }
});

// ============================================
// JEWELLERY BILLING & INVOICING APIS (GST & NORMAL)
// ============================================

function parseBillItems(bill) {
    if (!bill) return null;
    let items = [];
    try {
        items = typeof bill.items === 'string' ? JSON.parse(bill.items) : (bill.items || []);
    } catch(e) {
        items = [];
    }
    return {
        ...bill,
        items
    };
}

// 1. GET /api/bills - Fetch all bills with optional filtering
app.get('/api/bills', (req, res) => {
    const { type, phone, customer_id, search } = req.query;
    db.all('SELECT * FROM bills ORDER BY id DESC', [], (err, rows) => {
        if (err) {
            console.error('Error fetching bills:', err);
            return res.status(500).json({ success: false, error: 'Database error fetching bills.' });
        }
        let list = (rows || []).map(parseBillItems);
        
        if (type && (type === 'gst' || type === 'normal')) {
            list = list.filter(b => (b.bill_type || '').toLowerCase() === type.toLowerCase());
        }
        if (phone) {
            const pClean = phone.replace(/[^0-9]/g, '');
            list = list.filter(b => (b.customer_phone || '').replace(/[^0-9]/g, '').includes(pClean));
        }
        if (customer_id) {
            list = list.filter(b => String(b.customer_id) === String(customer_id));
        }
        if (search) {
            const s = search.toLowerCase().trim();
            list = list.filter(b => 
                (b.bill_no || '').toLowerCase().includes(s) ||
                (b.customer_name || '').toLowerCase().includes(s) ||
                (b.customer_phone || '').includes(s)
            );
        }
        res.json({ success: true, bills: list });
    });
});

// 2. GET /api/bills/:id - Fetch single bill
app.get('/api/bills/:id', (req, res) => {
    const id = req.params.id;
    db.all('SELECT * FROM bills WHERE id = ?', [id], (err, rows) => {
        if (err || !rows || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Bill not found.' });
        }
        res.json({ success: true, bill: parseBillItems(rows[0]) });
    });
});

// 3. POST /api/bills - Create new GST or Normal Bill
app.post('/api/bills', (req, res) => {
    try {
        const {
            bill_type = 'normal', // 'gst' or 'normal'
            customer_name,
            customer_phone,
            customer_address = '',
            customer_gstin = '',
            customer_pan = '',
            bill_date,
            items = [],
            discount = 0,
            payment_mode = 'Cash',
            payment_status = 'Paid',
            paid_amount,
            notes = ''
        } = req.body;

        if (!customer_name || !customer_name.trim()) {
            return res.status(400).json({ success: false, error: 'Customer name is required.' });
        }
        if (!customer_phone || !customer_phone.trim()) {
            return res.status(400).json({ success: false, error: 'Customer phone is required.' });
        }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one item must be added to the bill.' });
        }

        const isGst = String(bill_type).toLowerCase() === 'gst';
        const dateStr = bill_date || new Date().toISOString().split('T')[0];
        const year = new Date(dateStr).getFullYear();

        // Calculate items and totals
        let subtotal = 0;
        let makingTotal = 0;
        const processedItems = items.map((it, idx) => {
            const grossWt = parseFloat(it.gross_weight || it.net_weight || 0);
            const netWt = parseFloat(it.net_weight || grossWt || 0);
            const rate = parseFloat(it.rate_per_gram || it.rate || 0);
            let making = parseFloat(it.making_charges || 0);
            if (it.making_charge_type === 'per_gram') {
                making = making * netWt;
            }
            const metalVal = Math.round(netWt * rate * 100) / 100;
            const itemTotal = Math.round((metalVal + making) * 100) / 100;

            subtotal += metalVal;
            makingTotal += making;

            return {
                s_no: idx + 1,
                item_name: it.item_name || it.description || 'Jewellery Item',
                metal_type: it.metal_type || 'Gold',
                purity: it.purity || '22K 916',
                hsn_code: it.hsn_code || '7113',
                gross_weight: grossWt,
                net_weight: netWt,
                rate_per_gram: rate,
                making_charge_type: it.making_charge_type || 'fixed',
                making_charges: Math.round(making * 100) / 100,
                item_total: itemTotal
            };
        });

        subtotal = Math.round(subtotal * 100) / 100;
        makingTotal = Math.round(makingTotal * 100) / 100;
        const discountVal = Math.max(0, parseFloat(discount || 0));
        const taxableAmount = Math.max(0, Math.round((subtotal + makingTotal - discountVal) * 100) / 100);

        let gstRate = 0;
        let cgstAmount = 0;
        let sgstAmount = 0;
        let totalGst = 0;

        if (isGst) {
            gstRate = 3.0; // 3% Jewellery GST
            cgstAmount = Math.round((taxableAmount * 0.015) * 100) / 100; // 1.5% CGST
            sgstAmount = Math.round((taxableAmount * 0.015) * 100) / 100; // 1.5% SGST
            totalGst = Math.round((cgstAmount + sgstAmount) * 100) / 100;
        }

        const unroundedGrand = taxableAmount + totalGst;
        const grandTotal = Math.round(unroundedGrand);
        const roundOff = Math.round((grandTotal - unroundedGrand) * 100) / 100;

        const paid = paid_amount !== undefined ? parseFloat(paid_amount) : grandTotal;
        const balance = Math.max(0, grandTotal - paid);

        // Fetch last bill to assign serial bill_no
        db.all('SELECT bill_no FROM bills ORDER BY id DESC LIMIT 100', [], (err, existingBills) => {
            const prefix = isGst ? `LJS-GST-${year}-` : `LJS-RET-${year}-`;
            let maxSerial = 0;
            (existingBills || []).forEach(b => {
                if (b.bill_no && b.bill_no.startsWith(prefix)) {
                    const num = parseInt(b.bill_no.replace(prefix, ''), 10);
                    if (!isNaN(num) && num > maxSerial) maxSerial = num;
                }
            });
            const nextSerial = String(maxSerial + 1).padStart(4, '0');
            const billNo = `${prefix}${nextSerial}`;

            // Check if customer exists in customers table to link customer_id
            const pClean = customer_phone.trim().replace(/[^0-9]/g, '');
            db.all('SELECT id FROM customers WHERE phone = ? OR REPLACE(phone, " ", "") = ? OR REPLACE(phone, "-", "") = ? LIMIT 1',
                [customer_phone.trim(), pClean, pClean],
                (cErr, custRows) => {
                    const customerId = (custRows && custRows.length > 0) ? custRows[0].id : null;

                    const insertSql = `
                        INSERT INTO bills (
                            bill_no, bill_type, customer_id, customer_name, customer_phone,
                            customer_address, customer_gstin, customer_pan, bill_date, items,
                            subtotal, making_total, discount, taxable_amount, gst_rate,
                            cgst_amount, sgst_amount, total_gst, grand_total, round_off,
                            payment_mode, payment_status, paid_amount, balance_amount, notes, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    const params = [
                        billNo,
                        isGst ? 'gst' : 'normal',
                        customerId,
                        customer_name.trim(),
                        customer_phone.trim(),
                        customer_address.trim(),
                        customer_gstin.trim(),
                        customer_pan.trim(),
                        dateStr,
                        JSON.stringify(processedItems),
                        subtotal,
                        makingTotal,
                        discountVal,
                        taxableAmount,
                        gstRate,
                        cgstAmount,
                        sgstAmount,
                        totalGst,
                        grandTotal,
                        roundOff,
                        payment_mode,
                        payment_status,
                        paid,
                        balance,
                        notes.trim(),
                        new Date().toISOString()
                    ];

                    db.run(insertSql, params, function(insertErr) {
                        if (insertErr) {
                            console.error('Error inserting bill:', insertErr);
                            return res.status(500).json({ success: false, error: 'Failed to save bill in database.' });
                        }
                        const billId = this.lastID || 0;
                        res.json({
                            success: true,
                            message: `${isGst ? 'GST Tax Invoice' : 'Retail Bill'} generated successfully!`,
                            bill: {
                                id: billId,
                                bill_no: billNo,
                                bill_type: isGst ? 'gst' : 'normal',
                                customer_id: customerId,
                                customer_name: customer_name.trim(),
                                customer_phone: customer_phone.trim(),
                                customer_address: customer_address.trim(),
                                customer_gstin: customer_gstin.trim(),
                                customer_pan: customer_pan.trim(),
                                bill_date: dateStr,
                                items: processedItems,
                                subtotal,
                                making_total: makingTotal,
                                discount: discountVal,
                                taxable_amount: taxableAmount,
                                gst_rate: gstRate,
                                cgst_amount: cgstAmount,
                                sgst_amount: sgstAmount,
                                total_gst: totalGst,
                                grand_total: grandTotal,
                                round_off: roundOff,
                                payment_mode,
                                payment_status,
                                paid_amount: paid,
                                balance_amount: balance,
                                notes: notes.trim()
                            }
                        });
                    });
                }
            );
        });
    } catch (e) {
        console.error('Error in POST /api/bills:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. DELETE /api/bills/:id - Delete bill
app.delete('/api/bills/:id', (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM bills WHERE id = ?', [id], (err) => {
        if (err) {
            console.error('Error deleting bill:', err);
            return res.status(500).json({ success: false, error: 'Database error deleting bill.' });
        }
        res.json({ success: true, message: 'Bill deleted successfully.' });
    });
});

// 5. GET /api/portal/bills - Fetch customer bills for Portal
app.get('/api/portal/bills', (req, res) => {
    const { phone, customer_id } = req.query;
    if (!phone && !customer_id) {
        return res.status(400).json({ success: false, error: 'Phone number or Customer ID required.' });
    }
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    db.all('SELECT * FROM bills ORDER BY id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        const list = (rows || []).map(parseBillItems).filter(b => {
            const bPhone = (b.customer_phone || '').replace(/[^0-9]/g, '');
            const matchPhone = cleanPhone && bPhone && (bPhone === cleanPhone || bPhone.endsWith(cleanPhone) || cleanPhone.endsWith(bPhone));
            const matchId = customer_id && String(b.customer_id) === String(customer_id);
            return matchPhone || matchId;
        });
        res.json({ success: true, bills: list });
    });
});

// ============================================
// ADMIN AI COPILOT / SMART ASSISTANT ENDPOINT
// ============================================
const { processAdminAssistantQuery } = require('./admin-assistant');

app.post('/api/admin/assistant', async (req, res) => {
    try {
        const { prompt } = req.body;
        const result = await processAdminAssistantQuery({
            prompt,
            db,
            calculateInterest
        });
        res.json(result);
    } catch (err) {
        console.error('Admin Assistant API Error:', err);
        res.status(500).json({ success: false, message: 'Server error processing AI assistant query.' });
    }
});


if (require.main === module) {
    app.listen(PORT, '0.0.0.0', async () => {
        const ip = getLocalIpAddress();
        console.log(`Server is running locally at http://localhost:${PORT}`);
        console.log(`Mobile/Network access URL: http://${ip}:${PORT}`);
        // Fix Supabase PK sequences at startup to prevent collision errors
        if (fixAllSequences) {
            await fixAllSequences();
            console.log('[Startup] Supabase ID sequences verified/repaired.');
        }
    });
}

module.exports = app;

