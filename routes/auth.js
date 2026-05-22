const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { body, validationResult } = require('express-validator');
const pool    = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const signAccess  = (u) => jwt.sign({ id:u.id, email:u.email, role:u.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
const signRefresh = (u) => jwt.sign({ id:u.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' });

// ── REGISTER ────────────────────────────────────
router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('phone').matches(/^\+91[6-9]\d{9}$/),
  body('password').isLength({ min: 8 }),
  body('full_name').trim().notEmpty(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const { email, phone, password, full_name, gender, occupation } = req.body;
    try {
      const exists = await pool.query('SELECT id FROM users WHERE email=$1 OR phone=$2', [email, phone]);
      if (exists.rows.length) return res.status(409).json({ error: 'Email or phone already registered' });

      const hash = await bcrypt.hash(password, 12);
      const { rows } = await pool.query(
        'INSERT INTO users (email,phone,password_hash,full_name,gender,occupation) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,email,full_name,role',
        [email, phone, hash, full_name, gender || null, occupation || null]
      );
      const user = rows[0];
      const access  = signAccess(user);
      const refresh = signRefresh(user);
      const rHash   = crypto.createHash('sha256').update(refresh).digest('hex');
      const exp     = new Date(Date.now() + 30*24*60*60*1000);
      await pool.query('INSERT INTO refresh_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,$3)', [user.id, rHash, exp]);

      // Send OTP (stub — wire Fast2SMS here)
      await sendOTP(phone);

      res.status(201).json({ message: 'Account created! Please verify your phone.', access_token: access, refresh_token: refresh, user });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// ── LOGIN ───────────────────────────────────────
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const { email, password } = req.body;
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE email=$1 AND is_active=TRUE', [email]);
      if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

      const user = rows[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });

      const access  = signAccess(user);
      const refresh = signRefresh(user);
      const rHash   = crypto.createHash('sha256').update(refresh).digest('hex');
      const exp     = new Date(Date.now() + 30*24*60*60*1000);
      await pool.query('INSERT INTO refresh_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,$3)', [user.id, rHash, exp]);

      const { password_hash, ...safe } = user;
      res.json({ access_token: access, refresh_token: refresh, user: safe });
    } catch (e) {
      res.status(500).json({ error: 'Login failed' });
    }
  }
);

// ── REFRESH TOKEN ───────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'Refresh token required' });
  try {
    const payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    const { rows } = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token_hash=$1 AND user_id=$2 AND revoked=FALSE AND expires_at>NOW()',
      [hash, payload.id]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid refresh token' });

    const user = await pool.query('SELECT id,email,role FROM users WHERE id=$1', [payload.id]);
    const access = signAccess(user.rows[0]);
    res.json({ access_token: access });
  } catch (e) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// ── LOGOUT ──────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
    await pool.query('UPDATE refresh_tokens SET revoked=TRUE WHERE token_hash=$1', [hash]);
  }
  res.json({ message: 'Logged out' });
});

// ── VERIFY PHONE OTP ────────────────────────────
router.post('/verify-otp', authenticate, async (req, res) => {
  const { otp } = req.body;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM otp_codes WHERE phone=(SELECT phone FROM users WHERE id=$1) AND code=$2 AND used=FALSE AND expires_at>NOW()',
      [req.user.id, otp]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' });
    await pool.query('UPDATE otp_codes SET used=TRUE WHERE id=$1', [rows[0].id]);
    await pool.query('UPDATE users SET is_verified=TRUE WHERE id=$1', [req.user.id]);
    res.json({ message: 'Phone verified! ✅' });
  } catch (e) { res.status(500).json({ error: 'OTP verification failed' }); }
});

// ── RESEND OTP ──────────────────────────────────
router.post('/resend-otp', authenticate, async (req, res) => {
  const { rows } = await pool.query('SELECT phone FROM users WHERE id=$1', [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  await sendOTP(rows[0].phone);
  res.json({ message: 'OTP sent!' });
});

// ── OTP HELPER ──────────────────────────────────
async function sendOTP(phone) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const exp  = new Date(Date.now() + 10*60*1000); // 10 min
  await pool.query('INSERT INTO otp_codes (phone,code,expires_at) VALUES ($1,$2,$3)', [phone, code, exp]);

  if (process.env.FAST2SMS_API_KEY && process.env.FAST2SMS_API_KEY !== 'your_fast2sms_key') {
    try {
      const https = require('https');
      const body = JSON.stringify({
        route: 'q',
        message: `Your GharSaathi OTP is ${code}. Valid for 10 minutes. -GharSaathi`,
        language: 'english',
        flash: 0,
        numbers: phone.replace('+91','')
      });
      const options = {
        hostname: 'www.fast2sms.com',
        path: '/dev/bulkV2',
        method: 'POST',
        headers: {
          authorization: process.env.FAST2SMS_API_KEY,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const reqHttp = https.request(options);
      reqHttp.write(body);
      reqHttp.end();
    } catch (e) { console.error('SMS failed:', e.message); }
  } else {
    // Dev mode: log OTP
    console.log(`📱 OTP for ${phone}: ${code}`);
  }
}

module.exports = router;
