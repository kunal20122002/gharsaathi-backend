const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { query } = require('../config/db');

const signAccess  = (id) => jwt.sign({ userId: id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const signRefresh = (id) => jwt.sign({ userId: id }, process.env.REFRESH_TOKEN_SECRET, { expiresIn: '30d' });

exports.register = async (req, res) => {
  try {
    const { full_name, email, phone, password, role = 'seeker' } = req.body;
    const exists = await query('SELECT id FROM users WHERE email=$1 OR phone=$2', [email, phone]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email or phone already registered' });
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (full_name, email, phone, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, full_name, email, phone, role`,
      [full_name, email, phone, hash, role]
    );
    const user = rows[0];
    await query('INSERT INTO user_lifestyle (user_id) VALUES ($1)', [user.id]);
    const accessToken = signAccess(user.id);
    const refreshToken = signRefresh(user.id);
    await query('INSERT INTO refresh_tokens (user_id, token) VALUES ($1,$2)', [user.id, refreshToken]);
    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    if (user.is_banned) return res.status(403).json({ error: 'Account suspended' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    const accessToken = signAccess(user.id);
    const refreshToken = signRefresh(user.id);
    await query('INSERT INTO refresh_tokens (user_id, token) VALUES ($1,$2)', [user.id, refreshToken]);
    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, accessToken, refreshToken });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
};

exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const { rows } = await query('SELECT * FROM refresh_tokens WHERE token=$1 AND expires_at > NOW()', [refreshToken]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid or expired refresh token' });
    const newAccess = signAccess(decoded.userId);
    const newRefresh = signRefresh(decoded.userId);
    await query('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken]);
    await query('INSERT INTO refresh_tokens (user_id, token) VALUES ($1,$2)', [decoded.userId, newRefresh]);
    res.json({ accessToken: newAccess, refreshToken: newRefresh });
  } catch (err) {
    res.status(401).json({ error: 'Token refresh failed' });
  }
};

exports.sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await query('DELETE FROM otps WHERE phone=$1', [phone]);
    await query('INSERT INTO otps (phone, code) VALUES ($1,$2)', [phone, code]);
    console.log(`[DEV] OTP for ${phone}: ${code}`);
    res.json({ message: 'OTP sent', ...(process.env.NODE_ENV === 'development' && { dev_otp: code }) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send OTP' });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { phone, code } = req.body;
    const { rows } = await query("SELECT * FROM otps WHERE phone=$1 AND code=$2 AND expires_at > NOW() AND used=FALSE", [phone, code]);
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired OTP' });
    await query('UPDATE otps SET used=TRUE WHERE id=$1', [rows[0].id]);
    await query('UPDATE users SET phone_verified=TRUE WHERE phone=$1', [phone]);
    res.json({ message: 'Phone verified successfully' });
  } catch (err) {
    res.status(500).json({ error: 'OTP verification failed' });
  }
};

exports.logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) await query('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken]);
  res.json({ message: 'Logged out' });
};
