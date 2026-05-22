require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_URL || '*', methods: ['GET','POST'] }
});
app.set('io', io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: [process.env.FRONTEND_URL || 'http://localhost:3000', /\.vercel\.app$/], credentials: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15*60*1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: { error: 'Too many requests. Please try again later.' }
});
app.use('/api/', limiter);

app.use('/api/auth',     require('./routes/auth'));
app.use('/api/users',    require('./routes/users'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/matches',  require('./routes/matches'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/upload',   require('./routes/upload'));
app.use('/api/search',   require('./routes/search'));
app.use('/api/reviews',  require('./routes/reviews'));
app.use('/api/admin',    require('./routes/admin'));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));
}

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// ── SOCKET.IO ──────────────────────────────────
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

  socket.on('mark_read', async ({ matchId }) => {
    const db = require('./db/pool');
    await db.query('UPDATE messages SET is_read=TRUE WHERE match_id=$1 AND sender_id!=$2', [matchId, userId]);
    socket.to(`match:${matchId}`).emit('messages_read', { matchId, readBy: userId });
  });

  socket.on('disconnect', () => console.log(`Disconnected: ${userId}`));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🏠 GharSaathi running on port ${PORT}`));
module.exports = { app, server };
