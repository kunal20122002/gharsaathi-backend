const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { body, query, validationResult } = require('express-validator');

// ── GET ALL LISTINGS (with search/filter) ──────
router.get('/', optionalAuth, async (req, res) => {
  const { city, locality, min_rent, max_rent, flat_type, gender, page=1, limit=12 } = req.query;
  const offset = (page-1) * limit;
  const params = []; const where = ["l.status='active'"];

  if (city)      { params.push(`%${city.toLowerCase()}%`);     where.push(`LOWER(l.city) LIKE $${params.length}`); }
  if (locality)  { params.push(`%${locality.toLowerCase()}%`); where.push(`LOWER(l.locality) LIKE $${params.length}`); }
  if (min_rent)  { params.push(min_rent);  where.push(`l.monthly_rent >= $${params.length}`); }
  if (max_rent)  { params.push(max_rent);  where.push(`l.monthly_rent <= $${params.length}`); }
  if (flat_type) { params.push(flat_type); where.push(`l.flat_type = $${params.length}`); }
  if (gender)    { params.push(gender);    where.push(`(l.preferred_gender = $${params.length} OR l.preferred_gender='any')`); }

  const whereStr = where.join(' AND ');
  params.push(limit, offset);

  try {
    const { rows } = await pool.query(`
      SELECT l.*,
        u.full_name as lister_name, u.profile_pic_url, u.is_verified as lister_verified,
        u.linkedin_url, u.trust_score,
        (SELECT url FROM listing_photos WHERE listing_id=l.id AND is_primary=TRUE LIMIT 1) as primary_photo,
        (SELECT note_text FROM flatmate_notes WHERE listing_id=l.id LIMIT 1) as flatmate_note,
        (SELECT author_name FROM flatmate_notes WHERE listing_id=l.id LIMIT 1) as note_author,
        (SELECT COUNT(*) FROM matches WHERE listing_id=l.id AND seeker_liked=TRUE) as interest_count
      FROM listings l
      JOIN users u ON u.id=l.lister_id
      WHERE ${whereStr}
      ORDER BY l.is_urgent DESC, l.created_at DESC
      LIMIT $${params.length-1} OFFSET $${params.length}
    `, params);

    const count = await pool.query(`SELECT COUNT(*) FROM listings l WHERE ${whereStr}`, params.slice(0,-2));
    res.json({ listings: rows, total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch listings' }); }
});

// ── GET SINGLE LISTING ──────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.*,
        u.full_name as lister_name, u.profile_pic_url, u.linkedin_url,
        u.is_verified as lister_verified, u.trust_score, u.occupation as lister_occupation
      FROM listings l JOIN users u ON u.id=l.lister_id
      WHERE l.id=$1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });

    const listing = rows[0];
    listing.photos = (await pool.query('SELECT * FROM listing_photos WHERE listing_id=$1 ORDER BY sort_order', [listing.id])).rows;
    listing.flatmate_notes = (await pool.query('SELECT * FROM flatmate_notes WHERE listing_id=$1', [listing.id])).rows;

    // Increment view count
    await pool.query('UPDATE listings SET views_count=views_count+1 WHERE id=$1', [listing.id]);

    res.json(listing);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch listing' }); }
});

// ── CREATE LISTING ──────────────────────────────
router.post('/',
  authenticate,
  body('title').trim().notEmpty(),
  body('city').trim().notEmpty(),
  body('locality').trim().notEmpty(),
  body('flat_type').isIn(['1bhk','2bhk','3bhk','4bhk','studio','other']),
  body('monthly_rent').isInt({ min: 1000 }),
  body('security_deposit').isInt({ min: 0 }),
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const {
      title, description, city, locality, address_line, pincode,
      flat_type, rooms_available, existing_flatmates, monthly_rent,
      security_deposit, utility_charges, available_from, min_stay_months,
      vacancy_reason, house_rules, preferred_gender, preferred_occupation,
      amenities, is_urgent,
      // flatmate note
      flatmate_note_text, flatmate_note_author, flatmate_note_linkedin
    } = req.body;

    try {
      const { rows } = await pool.query(`
        INSERT INTO listings (
          lister_id,title,description,city,locality,address_line,pincode,
          flat_type,rooms_available,existing_flatmates,monthly_rent,
          security_deposit,utility_charges,available_from,min_stay_months,
          vacancy_reason,house_rules,preferred_gender,preferred_occupation,
          amenities,is_urgent,status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'active')
        RETURNING *
      `, [
        req.user.id, title, description, city.toLowerCase(), locality.toLowerCase(),
        address_line, pincode, flat_type, rooms_available||1, existing_flatmates||0,
        monthly_rent, security_deposit, utility_charges||0, available_from||null,
        min_stay_months||3, vacancy_reason, house_rules, preferred_gender||'any',
        preferred_occupation, JSON.stringify(amenities||{}), is_urgent||false
      ]);

      const listing = rows[0];

      // Save flatmate note
      if (flatmate_note_text?.trim()) {
        await pool.query(
          'INSERT INTO flatmate_notes (listing_id,author_name,author_linkedin,note_text) VALUES ($1,$2,$3,$4)',
          [listing.id, flatmate_note_author||'Outgoing Flatmate', flatmate_note_linkedin||null, flatmate_note_text.trim()]
        );
      }

      res.status(201).json({ message: 'Listing created!', listing });
    } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create listing' }); }
  }
);

// ── UPDATE LISTING ──────────────────────────────
router.patch('/:id', authenticate, async (req, res) => {
  const { rows } = await pool.query('SELECT lister_id FROM listings WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  if (rows[0].lister_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });

  const allowed = ['title','description','monthly_rent','status','is_urgent','amenities','house_rules','preferred_gender','rooms_available'];
  const sets = [], vals = [];
  Object.entries(req.body).forEach(([k,v]) => {
    if (allowed.includes(k)) { vals.push(v); sets.push(`${k}=$${vals.length}`); }
  });
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(req.params.id);
  const { rows: updated } = await pool.query(`UPDATE listings SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals);
  res.json(updated[0]);
});

// ── DELETE LISTING ──────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const { rows } = await pool.query('SELECT lister_id FROM listings WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  if (rows[0].lister_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Not authorized' });
  await pool.query('DELETE FROM listings WHERE id=$1', [req.params.id]);
  res.json({ message: 'Listing deleted' });
});

// ── ADD PHOTO ───────────────────────────────────
router.post('/:id/photos', authenticate, async (req, res) => {
  const { url, caption, is_primary } = req.body;
  if (!url) return res.status(400).json({ error: 'Photo URL required' });
  if (is_primary) await pool.query('UPDATE listing_photos SET is_primary=FALSE WHERE listing_id=$1', [req.params.id]);
  const { rows } = await pool.query(
    'INSERT INTO listing_photos (listing_id,url,caption,is_primary) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, url, caption||null, is_primary||false]
  );
  res.status(201).json(rows[0]);
});

module.exports = router;
