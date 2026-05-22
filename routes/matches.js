const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');

// ── EXPRESS INTEREST (seeker -> listing) ────────
router.post('/:listingId/interest', authenticate, async (req, res) => {
  const { listingId } = req.params;
  const seekerId = req.user.id;
  const { message } = req.body;

  try {
    const listing = await pool.query('SELECT * FROM listings WHERE id=$1 AND status=$2', [listingId,'active']);
    if (!listing.rows.length) return res.status(404).json({ error: 'Listing not found or inactive' });
    const listerId = listing.rows[0].lister_id;
    if (listerId === seekerId) return res.status(400).json({ error: 'Cannot express interest in own listing' });

    // Upsert match
    const { rows } = await pool.query(`
      INSERT INTO matches (listing_id,seeker_id,lister_id,seeker_liked,seeker_message)
      VALUES ($1,$2,$3,TRUE,$4)
      ON CONFLICT (listing_id,seeker_id) DO UPDATE
        SET seeker_liked=TRUE, seeker_message=COALESCE($4,matches.seeker_message), updated_at=NOW()
      RETURNING *
    `, [listingId, seekerId, listerId, message||null]);

    const match = rows[0];

    // Notify lister via socket
    const io = req.app.get('io');
    io.to(`user:${listerId}`).emit('new_interest', {
      matchId: match.id,
      listingId,
      seekerId,
      message: match.seeker_message
    });

    res.status(201).json({ message: 'Interest sent! 💌', match });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to send interest' }); }
});

// ── LISTER RESPONDS (like or pass) ──────────────
router.patch('/:matchId/respond', authenticate, async (req, res) => {
  const { decision } = req.body; // 'like' or 'pass'
  if (!['like','pass'].includes(decision)) return res.status(400).json({ error: 'Decision must be like or pass' });

  try {
    const { rows } = await pool.query('SELECT * FROM matches WHERE id=$1', [req.params.matchId]);
    if (!rows.length) return res.status(404).json({ error: 'Match not found' });
    const match = rows[0];
    if (match.lister_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    const listerLiked = decision === 'like';
    const status = !listerLiked ? 'rejected' : (match.seeker_liked ? 'matched' : 'pending');
    const matchedAt = (listerLiked && match.seeker_liked) ? new Date() : null;

    const { rows: updated } = await pool.query(`
      UPDATE matches SET lister_liked=$1, status=$2, matched_at=$3, updated_at=NOW()
      WHERE id=$4 RETURNING *
    `, [listerLiked, status, matchedAt, match.id]);

    const io = req.app.get('io');

    if (status === 'matched') {
      // 🎉 Mutual match! Notify both parties
      io.to(`user:${match.seeker_id}`).emit('mutual_match', { matchId: match.id, listingId: match.listing_id });
      io.to(`user:${match.lister_id}`).emit('mutual_match', { matchId: match.id, listingId: match.listing_id });
    } else if (status === 'rejected') {
      io.to(`user:${match.seeker_id}`).emit('match_rejected', { matchId: match.id });
    }

    res.json({ message: status === 'matched' ? '🎉 Mutual match! Contact unlocked.' : 'Response recorded.', match: updated[0] });
  } catch (e) { res.status(500).json({ error: 'Failed to respond' }); }
});

// ── GET MY MATCHES ───────────────────────────────
router.get('/my', authenticate, async (req, res) => {
  const { type = 'all' } = req.query; // all | matched | pending
  const userId = req.user.id;

  const where = type === 'matched' ? "AND m.is_matched=TRUE" :
                type === 'pending' ? "AND m.is_matched=FALSE AND m.status='pending'" : '';
  try {
    const { rows } = await pool.query(`
      SELECT m.*,
        l.title as listing_title, l.city, l.locality, l.monthly_rent, l.flat_type,
        seeker.full_name as seeker_name, seeker.profile_pic_url as seeker_pic, seeker.trust_score as seeker_trust,
        lister.full_name as lister_name, lister.profile_pic_url as lister_pic,
        (SELECT COUNT(*) FROM messages WHERE match_id=m.id AND is_read=FALSE AND sender_id!=$1) as unread_count
      FROM matches m
      JOIN listings l ON l.id=m.listing_id
      JOIN users seeker ON seeker.id=m.seeker_id
      JOIN users lister ON lister.id=m.lister_id
      WHERE (m.seeker_id=$1 OR m.lister_id=$1) ${where}
      ORDER BY m.updated_at DESC
    `, [userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch matches' }); }
});

module.exports = router;
