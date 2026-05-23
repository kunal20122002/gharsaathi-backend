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

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});
app.set('io', io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15*60*1000,
  max: 100,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

// ── HEALTH CHECK ─────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
app.get('/', (req, res) => res.json({ message: '🏠 GharSaathi API is live!', version: '1.0.0' }));

// ── API ROUTES ────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
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
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── SOCKET.IO ─────────────────────────────────────────
try {
  const { verifySocketToken } = require('./middleware/auth');
  io.use(verifySocketToken);
  io.on('connection', (socket) => {
    const userId = socket.user.id;
    socket.join(`user:${userId}`);
    socket.on('join_chat', (matchId) => socket.join(`match:${matchId}`));
    socket.on('send_message', async ({ matchId, content }) => {
      try {
        const db = require('./db/pool');
        const { rows } = await db.query(
          'SELECT * FROM matches WHERE id=$1 AND (seeker_id=$2 OR lister_id=$2) AND is_matched=TRUE',
          [matchId, userId]
        );
        if (!rows.length) return socket.emit('error', 'Not authorized');
        const msg = await db.query(
          'INSERT INTO messages (match_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *',
          [matchId, userId, content.trim()]
        );
        io.to(`match:${matchId}`).emit('new_message', msg.rows[0]);
      } catch (e) { socket.emit('error', 'Failed to send message'); }
    });
    socket.on('disconnect', () => console.log(`Disconnected: ${userId}`));
  });
} catch(e) {
  console.log('Socket.IO auth skipped:', e.message);
}

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`🏠 GharSaathi running on port ${PORT}`);
});

module.exports = { app, server };
