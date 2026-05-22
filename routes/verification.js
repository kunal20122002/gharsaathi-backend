// backend/routes/verification.js
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const crypto  = require('crypto');
const { query } = require('../config/db');
const { supabase } = require('../config/db');
const { auth } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Hash doc number for dedup (without storing plaintext)
const hashDoc = (num) => crypto.createHash('sha256').update(num.toLowerCase().replace(/\s/g,'')).digest('hex');

// ─────────────────────────────────────────────────────────────────
// POST /api/verify/submit
// Submit ID document for verification
// ─────────────────────────────────────────────────────────────────
router.post('/submit', auth,
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back',  maxCount: 1 },
    { name: 'selfie',maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { doc_type, doc_number } = req.body;
      if (!doc_type || !doc_number) {
        return res.status(400).json({ error: 'doc_type and doc_number are required' });
      }

      const validTypes = ['aadhaar','pan','passport','voter_id','driving_licence'];
      if (!validTypes.includes(doc_type)) {
        return res.status(400).json({ error: 'Invalid document type' });
      }

      // Check for duplicate doc number across platform
      const docHash = hashDoc(doc_number);
      const dupCheck = await query(
        'SELECT id FROM user_verifications WHERE doc_number_hash=$1 AND status=$2 AND user_id != $3',
        [docHash, 'verified', req.user.id]
      );
      if (dupCheck.rows.length) {
        return res.status(409).json({ error: 'This ID document is already registered to another account' });
      }

      // Upload files to Supabase storage
      const uploadFile = async (file, suffix) => {
        if (!file) return null;
        const path = `verifications/${req.user.id}/${doc_type}_${suffix}_${Date.now()}`;
        const { error } = await supabase.storage
          .from(process.env.STORAGE_BUCKET)
          .upload(path, file.buffer, { contentType: file.mimetype });
        if (error) throw error;
        return supabase.storage.from(process.env.STORAGE_BUCKET).getPublicUrl(path).data.publicUrl;
      };

      const frontUrl  = await uploadFile(req.files?.front?.[0],  'front');
      const backUrl   = await uploadFile(req.files?.back?.[0],   'back');
      const selfieUrl = await uploadFile(req.files?.selfie?.[0], 'selfie');

      // Invalidate old pending verifications
      await query(
        `UPDATE user_verifications SET status='expired' WHERE user_id=$1 AND status='pending'`,
        [req.user.id]
      );

      // Create verification record
      const result = await query(
        `INSERT INTO user_verifications
           (user_id, doc_type, doc_number, doc_number_hash, front_url, back_url, selfie_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, status, created_at`,
        [req.user.id, doc_type, '***MASKED***', docHash, frontUrl, backUrl, selfieUrl]
      );

      // In production: trigger admin review / DigiLocker API
      // For MVP: auto-approve after 2 hours (simulate)
      if (process.env.NODE_ENV !== 'production') {
        // Dev auto-approve
        await query(
          `UPDATE user_verifications SET status='verified', verified_at=NOW() WHERE id=$1`,
          [result.rows[0].id]
        );
        await query(`SELECT recalculate_trust_score($1)`, [req.user.id]);
      }

      res.status(201).json({
        verification: result.rows[0],
        message: process.env.NODE_ENV !== 'production'
          ? 'Auto-approved in dev mode! Trust score updated.'
          : 'Documents submitted! Verification takes up to 2 hours.'
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Verification submission failed' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────
// GET /api/verify/status
// Get current verification status
// ─────────────────────────────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, doc_type, status, verified_at, rejected_reason, created_at
       FROM user_verifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`,
      [req.user.id]
    );
    const userRes = await query('SELECT trust_score FROM users WHERE id=$1', [req.user.id]);
    res.json({ verifications: result.rows, trust_score: userRes.rows[0]?.trust_score });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/verify/linkedin
// Add LinkedIn URL (simple — no OAuth needed for MVP)
// ─────────────────────────────────────────────────────────────────
router.post('/linkedin', auth, async (req, res) => {
  try {
    const { linkedin_url } = req.body;
    if (!linkedin_url || !linkedin_url.includes('linkedin.com/in/')) {
      return res.status(400).json({ error: 'Valid LinkedIn profile URL required' });
    }
    await query('UPDATE users SET linkedin_url=$1 WHERE id=$2', [linkedin_url, req.user.id]);
    await query('SELECT recalculate_trust_score($1)', [req.user.id]);
    res.json({ success: true, message: 'LinkedIn added! Trust score updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add LinkedIn' });
  }
});

// ─────────────────────────────────────────────────────────────────
// ADMIN: PUT /api/verify/:verificationId/review
// Admin manually approves/rejects a verification
// ─────────────────────────────────────────────────────────────────
router.put('/:verificationId/review', auth, async (req, res) => {
  try {
    if (!['admin','moderator'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { action, reason } = req.body;
    const verRes = await query('SELECT user_id FROM user_verifications WHERE id=$1', [req.params.verificationId]);
    if (!verRes.rows.length) return res.status(404).json({ error: 'Not found' });

    await query(
      `UPDATE user_verifications SET status=$1, verified_at=CASE WHEN $1='verified' THEN NOW() ELSE NULL END,
       rejected_reason=$2 WHERE id=$3`,
      [action === 'approve' ? 'verified' : 'rejected', reason||null, req.params.verificationId]
    );

    await query('SELECT recalculate_trust_score($1)', [verRes.rows[0].user_id]);

    // Notify user
    await query(
      `INSERT INTO notifications (user_id, type, title, body)
       VALUES ($1, 'verification', $2, $3)`,
      [
        verRes.rows[0].user_id,
        action === 'approve' ? '✅ ID Verified! Trust score updated.' : '❌ Verification rejected',
        action === 'approve'
          ? 'Your identity has been verified. Your trust score has been updated!'
          : `Verification rejected: ${reason || 'Document unclear'}. Please resubmit.`
      ]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Review failed' });
  }
});

module.exports = router;
