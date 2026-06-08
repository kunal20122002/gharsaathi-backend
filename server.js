require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const app    = express();
const server = http.createServer(app);

// ── CORS ──────────────────────────────────────────────
// Allow your Vercel frontend + localhost for dev
const allowedOrigins = [
  'https://gharsaathi-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];
// Also allow any *.vercel.app preview deployments
app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    callback(new Error('CORS: Origin not allowed — ' + origin));
  },
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// ── SOCKET.IO ─────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin) || (origin && origin.endsWith('.vercel.app')))
        return cb(null, true);
      cb(new Error('Socket CORS blocked'));
    },
    methods: ['GET','POST'],
    credentials: true,
  }
});
app.set('io', io);

// ── SECURITY & LOGGING ────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── RATE LIMITING ─────────────────────────────────────
// Global limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use(globalLimiter);

// Stricter limiter for auth endpoints (prevent brute-force / signup spam)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // max 20 login/register attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Please wait 15 minutes.' }
});

// ── HEALTH CHECK ─────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  time: new Date(),
  env: process.env.NODE_ENV || 'development'
}));
app.get('/', (req, res) => res.json({
  message: '🏠 GharSaathi API is live!',
  version: '1.0.0-beta'
}));

// ── API ROUTES ────────────────────────────────────────
app.use('/api/auth',     authLimiter, require('./routes/auth'));   // auth gets stricter limit
app.use('/api/users',    require('./routes/users'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/matches',  require('./routes/matches'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/upload',   require('./routes/upload'));
app.use('/api/search',   require('./routes/search'));
app.use('/api/reviews',  require('./routes/reviews'));
app.use('/api/admin',    require('./routes/admin'));

// ── 404 ───────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// ── ERROR HANDLER ─────────────────────────────────────
app.use((err, req, res, next) => {
  // CORS errors
  if (err.message && err.message.startsWith('CORS')) {
    return res.status(403).json({ error: err.message });
  }
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── SOCKET.IO REAL-TIME ───────────────────────────────
try {
  const { verifySocketToken } = require('./middleware/auth');
  io.use(verifySocketToken);
  io.on('connection', (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);
    console.log(`Socket connected: user ${userId}`);

    socket.on('join_chat', (matchId) => socket.join(`match:${matchId}`));

    socket.on('send_message', async ({ matchId, content }) => {
      if (!content?.trim()) return;
      try {
        const db = require('./db/pool');
        const { rows } = await db.query(
          'SELECT * FROM matches WHERE id=$1 AND (seeker_id=$2 OR lister_id=$2) AND is_matched=TRUE',
          [matchId, userId]
        );
        if (!rows.length) return socket.emit('error', 'Not authorized for this chat');
        const msg = await db.query(
          'INSERT INTO messages (match_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *',
          [matchId, userId, content.trim()]
        );
        io.to(`match:${matchId}`).emit('new_message', msg.rows[0]);
      } catch (e) {
        console.error('Socket message error:', e.message);
        socket.emit('error', 'Failed to send message');
      }
    });

    socket.on('disconnect', () => console.log(`Socket disconnected: user ${userId}`));
  });
} catch(e) {
  console.log('Socket.IO auth middleware skipped:', e.message);
}

// ── START ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🏠 GharSaathi running on http://${HOST}:${PORT}`);
  console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = { app, server };
