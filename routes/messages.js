const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ── GET MESSAGES FOR A MATCH ─────────────────────
router.get('/:matchId', authenticate, async (req, res) => {
  const { matchId } = req.params;
  const userId = req.user.id;
  try {
    const match = await pool.query(
      'SELECT * FROM matches WHERE id=$1 AND (seeker_id=$2 OR lister_id=$2) AND is_matched=TRUE',
      [matchId, userId]
    );
    if (!match.rows.length) return res.status(403).json({ error: 'Access denied — no mutual match yet' });

    const { rows } = await pool.query(
      'SELECT m.*, u.full_name as sender_name, u.profile_pic_url as sender_pic FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.match_id=$1 ORDER BY m.created_at ASC',
      [matchId]
    );
    // Mark as read
    await pool.query('UPDATE messages SET is_read=TRUE WHERE match_id=$1 AND sender_id!=$2', [matchId, userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch messages' }); }
});

// ── SEND MESSAGE (REST fallback if socket fails) ─
router.post('/:matchId', authenticate, async (req, res) => {
  const { content } = req.body;
  const userId = req.user.id;
  if (!content?.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

  try {
    const match = await pool.query(
      'SELECT * FROM matches WHERE id=$1 AND (seeker_id=$2 OR lister_id=$2) AND is_matched=TRUE',
      [req.params.matchId, userId]
    );
    if (!match.rows.length) return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      'INSERT INTO messages (match_id,sender_id,content) VALUES ($1,$2,$3) RETURNING *',
      [req.params.matchId, userId, content.trim()]
    );
    const io = req.app.get('io');
    io.to(`match:${req.params.matchId}`).emit('new_message', rows[0]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to send message' }); }
});

module.exports = router;
