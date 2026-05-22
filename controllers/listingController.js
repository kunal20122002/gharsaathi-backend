const { query } = require('../config/db');

// ── CREATE LISTING ────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const u = req.user;
    const {
      title, flat_type, city, locality, address, pincode, floor,
      monthly_rent, security_deposit, rooms_available, existing_flatmates,
      gender_pref, available_from, min_stay_months, description, vacancy_reason,
      electricity_included, water_included,
      amenities = {},
      flatmate_note,
    } = req.body;

    const { rows } = await query(
      `INSERT INTO listings
        (lister_id, title, flat_type, city, locality, address, pincode, floor,
         monthly_rent, security_deposit, rooms_available, existing_flatmates,
         gender_pref, available_from, min_stay_months, description, vacancy_reason,
         electricity_included, water_included)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [u.id, title, flat_type, city, locality, address, pincode, floor,
       monthly_rent, security_deposit, rooms_available, existing_flatmates,
       gender_pref, available_from, min_stay_months, description, vacancy_reason,
       electricity_included, water_included]
    );
    const listing = rows[0];

    // Insert amenities
    await query(
      `INSERT INTO listing_amenities (listing_id, wifi, ac, washing_machine, furnished,
        gym, swimming_pool, parking, power_backup, gated_society, near_metro,
        pet_friendly, attached_bathroom, modular_kitchen, balcony)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [listing.id,
       amenities.wifi||false, amenities.ac||false, amenities.washing_machine||false,
       amenities.furnished||false, amenities.gym||false, amenities.swimming_pool||false,
       amenities.parking||false, amenities.power_backup||false, amenities.gated_society||false,
       amenities.near_metro||false, amenities.pet_friendly||false, amenities.attached_bathroom||false,
       amenities.modular_kitchen||false, amenities.balcony||false]
    );

    // Insert flatmate note
    if (flatmate_note?.note) {
      await query(
        `INSERT INTO flatmate_notes (listing_id, author_name, author_linkedin, note)
         VALUES ($1,$2,$3,$4)`,
        [listing.id, flatmate_note.author_name, flatmate_note.author_linkedin, flatmate_note.note]
      );
    }

    res.status(201).json({ listing });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create listing' });
  }
};

// ── SEARCH / LIST ─────────────────────────────────────
exports.search = async (req, res) => {
  try {
    const {
      city, locality, min_rent, max_rent, flat_type,
      gender_pref, pet_friendly, furnished, near_metro,
      page = 1, limit = 12
    } = req.query;

    const conditions = ['l.is_active = TRUE'];
    const params = [];
    let p = 1;

    if (city)        { conditions.push(`LOWER(l.city) LIKE LOWER($${p++})`);     params.push(`%${city}%`); }
    if (locality)    { conditions.push(`LOWER(l.locality) LIKE LOWER($${p++})`); params.push(`%${locality}%`); }
    if (min_rent)    { conditions.push(`l.monthly_rent >= $${p++}`);              params.push(min_rent); }
    if (max_rent)    { conditions.push(`l.monthly_rent <= $${p++}`);              params.push(max_rent); }
    if (flat_type)   { conditions.push(`l.flat_type = $${p++}`);                  params.push(flat_type); }
    if (gender_pref) { conditions.push(`l.gender_pref IN ('any', $${p++})`);      params.push(gender_pref); }

    if (pet_friendly === 'true') conditions.push(`la.pet_friendly = TRUE`);
    if (furnished    === 'true') conditions.push(`la.furnished = TRUE`);
    if (near_metro   === 'true') conditions.push(`la.near_metro = TRUE`);

    const where = conditions.join(' AND ');
    const offset = (Number(page) - 1) * Number(limit);

    const sql = `
      SELECT
        l.*, la.*,
        u.full_name, u.trust_score, u.linkedin_url, u.avatar_url,
        fn.author_name AS note_author, fn.note AS flatmate_note,
        v.status AS verification_status,
        (SELECT url FROM listing_photos WHERE listing_id = l.id AND is_primary = TRUE LIMIT 1) AS primary_photo
      FROM listings l
      LEFT JOIN listing_amenities la ON la.listing_id = l.id
      LEFT JOIN users u ON u.id = l.lister_id
      LEFT JOIN flatmate_notes fn ON fn.listing_id = l.id
      LEFT JOIN verifications v ON v.user_id = l.lister_id AND v.status = 'verified'
      WHERE ${where}
      ORDER BY l.is_urgent DESC, l.created_at DESC
      LIMIT $${p++} OFFSET $${p++}`;

    params.push(limit, offset);
    const { rows } = await query(sql, params);

    // total count
    const countSql = `
      SELECT COUNT(*) FROM listings l
      LEFT JOIN listing_amenities la ON la.listing_id = l.id
      WHERE ${where}`;
    const countParams = params.slice(0, params.length - 2);
    const { rows: countRows } = await query(countSql, countParams);

    res.json({
      listings: rows,
      total: parseInt(countRows[0].count),
      page: Number(page),
      pages: Math.ceil(countRows[0].count / limit)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
};

// ── GET SINGLE ────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await query(`
      SELECT l.*, la.*,
        u.full_name, u.trust_score, u.linkedin_url, u.avatar_url, u.occupation,
        fn.author_name AS note_author, fn.author_linkedin AS note_author_linkedin, fn.note AS flatmate_note,
        v.status AS verification_status
      FROM listings l
      LEFT JOIN listing_amenities la ON la.listing_id = l.id
      LEFT JOIN users u ON u.id = l.lister_id
      LEFT JOIN flatmate_notes fn ON fn.listing_id = l.id
      LEFT JOIN verifications v ON v.user_id = l.lister_id
      WHERE l.id = $1`, [id]);

    if (!rows.length) return res.status(404).json({ error: 'Listing not found' });

    const { rows: photos } = await query(
      'SELECT * FROM listing_photos WHERE listing_id=$1 ORDER BY sort_order', [id]
    );

    await query('UPDATE listings SET views_count = views_count + 1 WHERE id=$1', [id]);
    res.json({ listing: rows[0], photos });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch listing' });
  }
};

// ── UPDATE ────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await query('SELECT lister_id FROM listings WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].lister_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    const fields = req.body;
    const allowed = ['title','description','monthly_rent','security_deposit','available_from','is_active','is_urgent','vacancy_reason'];
    const updates = Object.keys(fields).filter(k => allowed.includes(k));
    if (!updates.length) return res.status(400).json({ error: 'No valid fields' });

    const sets = updates.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const vals = updates.map(k => fields[k]);
    await query(`UPDATE listings SET ${sets}, updated_at=NOW() WHERE id=$1`, [id, ...vals]);

    res.json({ message: 'Listing updated' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
};

// ── DELETE ────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await query('SELECT lister_id FROM listings WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].lister_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    await query('UPDATE listings SET is_active=FALSE WHERE id=$1', [id]);
    res.json({ message: 'Listing deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
};

// ── MY LISTINGS ───────────────────────────────────────
exports.myListings = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT l.*, fn.note AS flatmate_note,
        (SELECT COUNT(*) FROM interests WHERE listing_id = l.id) AS interest_count,
        (SELECT COUNT(*) FROM interests WHERE listing_id = l.id AND lister_resp = 'matched') AS match_count
       FROM listings l
       LEFT JOIN flatmate_notes fn ON fn.listing_id = l.id
       WHERE l.lister_id = $1 ORDER BY l.created_at DESC`,
      [req.user.id]
    );
    res.json({ listings: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch listings' });
  }
};
