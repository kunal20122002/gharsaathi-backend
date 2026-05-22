const { query } = require('../config/db');

// ── SEEKER SHOWS INTEREST ─────────────────────────────
exports.showInterest = async (req, res) => {
  try {
    const { listing_id, message } = req.body;
    const seeker_id = req.user.id;

    const { rows: listing } = await query('SELECT lister_id FROM listings WHERE id=$1 AND is_active=TRUE', [listing_id]);
    if (!listing.length) return res.status(404).json({ error: 'Listing not found' });
    const lister_id = listing[0].lister_id;

    if (lister_id === seeker_id) return res.status(400).json({ error: 'You cannot show interest in your own listing' });

    const { rows: existing } = await query('SELECT id FROM interests WHERE listing_id=$1 AND seeker_id=$2', [listing_id, seeker_id]);
    if (existing.length) return res.status(409).json({ error: 'Interest already expressed' });

    const { rows } = await query(
      `INSERT INTO interests (listing_id, seeker_id, lister_id, seeker_msg)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [listing_id, seeker_id, lister_id, message]
    );

    res.status(201).json({ interest: rows[0], message: 'Interest sent! Lister will be notified.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send interest' });
  }
};

// ── LISTER RESPONDS ───────────────────────────────────
exports.respond = async (req, res) => {
  try {
    const { interest_id, response } = req.body; // 'matched' or 'rejected'
    const lister_id = req.user.id;

    const { rows } = await query('SELECT * FROM interests WHERE id=$1 AND lister_id=$2', [interest_id, lister_id]);
    if (!rows.length) return res.status(404).json({ error: 'Interest not found' });
    if (rows[0].lister_resp !== 'pending') return res.status(400).json({ error: 'Already responded' });

    const matched_at = response === 'matched' ? new Date() : null;
    await query(
      `UPDATE interests SET lister_resp=$1, lister_at=NOW(), matched_at=$2 WHERE id=$3`,
      [response, matched_at, interest_id]
    );

    if (response === 'matched') {
      return res.json({ matched: true, message: '🎉 Matched! Contact details are now unlocked for both parties.' });
    }
    res.json({ matched: false, message: 'Response recorded.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to respond' });
  }
};

// ── GET INTERESTS FOR LISTER ──────────────────────────
exports.getIncoming = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT i.*,
        u.full_name AS seeker_name, u.avatar_url, u.trust_score,
        u.occupation, u.linkedin_url,
        ul.non_smoker, ul.vegetarian, ul.early_sleeper, ul.work_from_home,
        v.status AS verified,
        l.title AS listing_title, l.city
      FROM interests i
      JOIN users u ON u.id = i.seeker_id
      LEFT JOIN user_lifestyle ul ON ul.user_id = i.seeker_id
      LEFT JOIN verifications v ON v.user_id = i.seeker_id
      JOIN listings l ON l.id = i.listing_id
      WHERE i.lister_id = $1
      ORDER BY i.created_at DESC`, [req.user.id]);
    res.json({ interests: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch interests' });
  }
};

// ── GET INTERESTS SENT BY SEEKER ──────────────────────
exports.getSent = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT i.*,
        l.title, l.city, l.locality, l.monthly_rent, l.flat_type,
        u.full_name AS lister_name
      FROM interests i
      JOIN listings l ON l.id = i.listing_id
      JOIN users u ON u.id = i.lister_id
      WHERE i.seeker_id = $1
      ORDER BY i.created_at DESC`, [req.user.id]);
    res.json({ interests: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sent interests' });
  }
};

// ── GET MATCHES (MUTUAL) ──────────────────────────────
exports.getMatches = async (req, res) => {
  try {
    const uid = req.user.id;
    const { rows } = await query(`
      SELECT i.*,
        l.title, l.city, l.locality, l.monthly_rent, l.address,
        seeker.full_name AS seeker_name, seeker.phone AS seeker_phone, seeker.email AS seeker_email,
        lister.full_name AS lister_name, lister.phone AS lister_phone, lister.email AS lister_email
      FROM interests i
      JOIN listings l ON l.id = i.listing_id
      JOIN users seeker ON seeker.id = i.seeker_id
      JOIN users lister ON lister.id = i.lister_id
      WHERE (i.seeker_id=$1 OR i.lister_id=$1) AND i.lister_resp='matched'
      ORDER BY i.matched_at DESC`, [uid]);
    res.json({ matches: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
};
