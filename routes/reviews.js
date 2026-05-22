const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

router.post('/',
  authenticate,
  body('match_id').isUUID(),
  body('reviewee_id').isUUID(),
  body('rating').isInt({min:1,max:5}),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { match_id, reviewee_id, rating, comment } = req.body;
    try {
      const match = await pool.query(
        'SELECT * FROM matches WHERE id=$1 AND (seeker_id=$2 OR lister_id=$2) AND is_matched=TRUE',
        [match_id, req.user.id]
      );
      if (!match.rows.length) return res.status(403).json({ error: 'Can only review after a match' });
      const { rows } = await pool.query(
        'INSERT INTO reviews (match_id,reviewer_id,reviewee_id,rating,comment) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING *',
        [match_id, req.user.id, reviewee_id, rating, comment||null]
      );
      // Update trust score
      await pool.query('UPDATE users SET trust_score=compute_trust_score(id) WHERE id=$1', [reviewee_id]);
      res.status(201).json(rows[0]);
    } catch (e) { res.status(500).json({ error: 'Failed to submit review' }); }
  }
);

router.get('/user/:userId', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT r.*, u.full_name as reviewer_name, u.profile_pic_url FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.reviewee_id=$1 ORDER BY r.created_at DESC',
    [req.params.userId]
  );
  res.json(rows);
});

module.exports = router;
