const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

router.use(authenticate, requireAdmin);

router.get('/stats', async (req, res) => {
  const [users, listings, matches, pending_verif] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM users'),
    pool.query("SELECT COUNT(*) FROM listings WHERE status='active'"),
    pool.query('SELECT COUNT(*) FROM matches WHERE is_matched=TRUE'),
    pool.query("SELECT COUNT(*) FROM verifications WHERE status='pending'")
  ]);
  res.json({
    total_users:    parseInt(users.rows[0].count),
    active_listings:parseInt(listings.rows[0].count),
    total_matches:  parseInt(matches.rows[0].count),
    pending_verif:  parseInt(pending_verif.rows[0].count)
  });
});

router.get('/verifications', async (req, res) => {
  const { rows } = await pool.query("SELECT v.*,u.full_name,u.email,u.phone FROM verifications v JOIN users u ON u.id=v.user_id WHERE v.status='pending' ORDER BY v.created_at ASC");
  res.json(rows);
});

router.patch('/verifications/:id', async (req, res) => {
  const { status } = req.body;
  if (!['approved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const { rows } = await pool.query(
    'UPDATE verifications SET status=$1,reviewed_by=$2,reviewed_at=NOW() WHERE id=$3 RETURNING *',
    [status, req.user.id, req.params.id]
  );
  if (status==='approved') {
    await pool.query('UPDATE users SET is_verified=TRUE, trust_score=compute_trust_score(id) WHERE id=$1', [rows[0].user_id]);
  }
  res.json(rows[0]);
});

router.get('/reports', async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM reports WHERE status='open' ORDER BY created_at DESC");
  res.json(rows);
});

router.patch('/listings/:id/status', async (req, res) => {
  const { status } = req.body;
  const { rows } = await pool.query('UPDATE listings SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
  res.json(rows[0]);
});

module.exports = router;
