const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { authenticate } = require('../middleware/auth');

// Use disk storage for Render/Railway free tier
// Replace with Supabase Storage for production
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  }
});

router.post('/', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  // Return URL — in production point to Supabase Storage URL
  const url = `${process.env.BACKEND_URL || 'http://localhost:5000'}/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

// Serve uploaded files
router.use('/files', require('express').static(path.join(__dirname, '../uploads')));

module.exports = router;
