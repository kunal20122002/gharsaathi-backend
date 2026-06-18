const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate } = require('../middleware/auth');
// ── UPSERT SEEKER PROFILE ──────────────────────
router.post('/seeker-profile', authenticate, async (req, res) => {
  const {
    looking_in_cities, looking_in_locality, max_budget,
    looking_reason, stay_duration_min, lifestyle_tags,
    reference_name, reference_phone
  } = req.body;

  if (!max_budget) return res.status(400).json({ error: 'Budget is required' });

  try {
    const { rows } = await pool.query(`
      INSERT INTO seeker_profiles (
        user_id, looking_in_cities, looking_in_locality, max_budget,
        looking_reason, stay_duration_min, lifestyle_tags,
        reference_name, reference_phone, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
      ON CONFLICT (user_id) DO UPDATE SET
        looking_in_cities   = EXCLUDED.looking_in_cities,
        looking_in_locality = EXCLUDED.looking_in_locality,
        max_budget          = EXCLUDED.max_budget,
        looking_reason      = EXCLUDED.looking_reason,
        stay_duration_min   = EXCLUDED.stay_duration_min,
        lifestyle_tags      = EXCLUDED.lifestyle_tags,
        reference_name      = EXCLUDED.reference_name,
        reference_phone     = EXCLUDED.reference_phone,
        is_active           = true,
        updated_at          = NOW()
      RETURNING *
    `, [
      req.user.id,
      looking_in_cities || [],
      looking_in_locality || null,
      parseInt(max_budget),
      looking_reason || null,
      stay_duration_min || 3,
      lifestyle_tags || [],
      reference_name || null,
      reference_phone || null
    ]);

    res.status(201).json({ message: 'Seeker profile saved!', profile: rows[0] });
  } catch (e) {
    console.error('Seeker profile error:', e);
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

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
