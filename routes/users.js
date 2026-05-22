const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');

router.get('/me', authenticate, async (req, res) => {
  const { rows } = await pool.query('SELECT id,email,phone,full_name,gender,occupation,linkedin_url,bio,profile_pic_url,trust_score,is_verified,created_at FROM users WHERE id=$1', [req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

router.patch('/me', authenticate, async (req, res) => {
  const allowed = ['full_name','gender','occupation','linkedin_url','bio','profile_pic_url'];
  const sets=[],vals=[];
  Object.entries(req.body).forEach(([k,v])=>{ if(allowed.includes(k)){vals.push(v);sets.push(`${k}=$${vals.length}`);}});
  if(!sets.length) return res.status(400).json({error:'Nothing to update'});
  vals.push(req.user.id);
  const { rows } = await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING id,full_name,email,occupation,linkedin_url,bio,profile_pic_url,trust_score`, vals);
  res.json(rows[0]);
});

router.get('/:id/public', async (req, res) => {
  const { rows } = await pool.query('SELECT id,full_name,occupation,linkedin_url,profile_pic_url,trust_score,is_verified,created_at FROM users WHERE id=$1 AND is_active=TRUE', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  const user = rows[0];
  user.reviews = (await pool.query('SELECT r.*,u.full_name as reviewer_name FROM reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.reviewee_id=$1 ORDER BY r.created_at DESC LIMIT 5', [req.params.id])).rows;
  res.json(user);
});

router.post('/saved/:listingId', authenticate, async (req, res) => {
  await pool.query('INSERT INTO saved_listings VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, req.params.listingId]);
  res.json({ message: 'Saved ❤️' });
});

router.delete('/saved/:listingId', authenticate, async (req, res) => {
  await pool.query('DELETE FROM saved_listings WHERE user_id=$1 AND listing_id=$2', [req.user.id, req.params.listingId]);
  res.json({ message: 'Removed' });
});

router.get('/saved', authenticate, async (req, res) => {
  const { rows } = await pool.query('SELECT l.*, sl.saved_at FROM saved_listings sl JOIN listings l ON l.id=sl.listing_id WHERE sl.user_id=$1 ORDER BY sl.saved_at DESC', [req.user.id]);
  res.json(rows);
});

module.exports = router;
