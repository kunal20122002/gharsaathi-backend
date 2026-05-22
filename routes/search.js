const router = require('express').Router();
const pool   = require('../db/pool');

// Full-text + proximity search
router.get('/', async (req, res) => {
  const { q, city, max_rent, flat_type, gender, page=1 } = req.query;
  const limit = 12, offset = (page-1)*limit;

  try {
    let query, params;
    if (q) {
      query = `
        SELECT l.*, u.full_name as lister_name, u.trust_score,
          ts_rank(to_tsvector('english', l.city||' '||l.locality||' '||COALESCE(l.title,'')), plainto_tsquery($1)) as rank
        FROM listings l JOIN users u ON u.id=l.lister_id
        WHERE l.status='active'
          AND to_tsvector('english', l.city||' '||l.locality||' '||COALESCE(l.title,'')) @@ plainto_tsquery($1)
          ${max_rent ? `AND l.monthly_rent<=$2` : ''}
        ORDER BY rank DESC LIMIT ${limit} OFFSET ${offset}
      `;
      params = max_rent ? [q, max_rent] : [q];
    } else {
      query = `SELECT l.*, u.full_name as lister_name, u.trust_score FROM listings l JOIN users u ON u.id=l.lister_id WHERE l.status='active' ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      params = [];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Search failed' }); }
});

module.exports = router;
