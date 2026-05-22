const { query } = require('../config/db');
const { createClient } = require('@supabase/supabase-js');

const supabase = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

exports.getProfile = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT u.id, u.full_name, u.email, u.phone, u.role, u.linkedin_url,
        u.occupation, u.bio, u.trust_score, u.avatar_url, u.created_at,
        u.phone_verified, u.email_verified,
        ul.*,
        v.status AS id_verified, v.id_type
      FROM users u
      LEFT JOIN user_lifestyle ul ON ul.user_id = u.id
      LEFT JOIN verifications v ON v.user_id = u.id
      WHERE u.id = $1`, [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const allowed = ['full_name', 'occupation', 'bio', 'linkedin_url'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'No valid fields' });

    const sets = fields.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await query(
      `UPDATE users SET ${sets}, updated_at=NOW() WHERE id=$1`,
      [req.user.id, ...fields.map(k => req.body[k])]
    );

    if (req.body.lifestyle) {
      const ls = req.body.lifestyle;
      const lsFields = ['non_smoker','vegetarian','early_sleeper','night_owl','work_from_home','has_pet','high_tidiness'];
      const lsSets = lsFields.filter(k => k in ls).map((k, i) => `${k} = $${i + 2}`).join(', ');
      if (lsSets) {
        await query(
          `UPDATE user_lifestyle SET ${lsSets} WHERE user_id=$1`,
          [req.user.id, ...lsFields.filter(k => k in ls).map(k => ls[k])]
        );
      }
    }

    res.json({ message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
};

exports.submitVerification = async (req, res) => {
  try {
    const { id_type, id_number } = req.body;
    const existing = await query('SELECT id FROM verifications WHERE user_id=$1', [req.user.id]);
    if (existing.rows.length) return res.status(409).json({ error: 'Verification already submitted' });

    await query(
      `INSERT INTO verifications (user_id, id_type, id_number) VALUES ($1,$2,$3)`,
      [req.user.id, id_type, id_number]
    );
    res.json({ message: 'Verification submitted. We\'ll review within 24 hours.' });
  } catch (err) {
    res.status(500).json({ error: 'Verification submission failed' });
  }
};

exports.uploadAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const sb = supabase();
    const path = `avatars/${req.user.id}-${Date.now()}`;
    const { error } = await sb.storage.from('user-avatars').upload(path, req.file.buffer, { contentType: req.file.mimetype });
    if (error) throw error;
    const { data } = sb.storage.from('user-avatars').getPublicUrl(path);
    await query('UPDATE users SET avatar_url=$1 WHERE id=$2', [data.publicUrl, req.user.id]);
    res.json({ avatar_url: data.publicUrl });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
};

exports.saveEmergencyContact = async (req, res) => {
  try {
    const { name, phone, relation } = req.body;
    await query(
      `INSERT INTO emergency_contacts (user_id, name, phone, relation)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id) DO UPDATE SET name=$2, phone=$3, relation=$4`,
      [req.user.id, name, phone, relation]
    );
    res.json({ message: 'Emergency contact saved' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save emergency contact' });
  }
};

exports.saveListings = async (req, res) => {
  try {
    const { listing_id } = req.body;
    await query(
      `INSERT INTO saved_listings (user_id, listing_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.user.id, listing_id]
    );
    res.json({ message: 'Saved' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save' });
  }
};

exports.getSavedListings = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT l.*, sl.created_at AS saved_at
      FROM saved_listings sl
      JOIN listings l ON l.id = sl.listing_id
      WHERE sl.user_id=$1 ORDER BY sl.created_at DESC`, [req.user.id]);
    res.json({ listings: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch saved listings' });
  }
};

exports.leaveReview = async (req, res) => {
  try {
    const { interest_id, reviewee_id, rating, comment } = req.body;
    await query(
      `INSERT INTO reviews (interest_id, reviewer_id, reviewee_id, rating, comment)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (interest_id, reviewer_id) DO NOTHING`,
      [interest_id, req.user.id, reviewee_id, rating, comment]
    );
    // Recalculate trust score
    await query('SELECT recalculate_trust_score($1)', [reviewee_id]);
    res.json({ message: 'Review submitted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit review' });
  }
};
