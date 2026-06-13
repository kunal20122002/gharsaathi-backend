const router  = require('express').Router();
const multer  = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { authenticate } = require('../middleware/auth');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG, PNG, WebP allowed'));
  }
});

router.post('/', authenticate, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const bucket = 'gharsaathi-uploads';
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  // Log env vars so you can confirm in Railway logs
  console.log('=== UPLOAD DEBUG ===');
  console.log('BUCKET:', JSON.stringify(bucket));
  console.log('SUPABASE_URL set:', !!supabaseUrl);
  console.log('SERVICE_KEY set:', !!supabaseKey);
  console.log('User ID:', req.user?.id);
  console.log('File mimetype:', req.file.mimetype);
  console.log('File size:', req.file.size);

  if (!bucket || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Missing storage env vars on server' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const ext      = req.file.originalname.split('.').pop().toLowerCase();
    const filename = `photos/${req.user.id}-${Date.now()}.${ext}`;

    console.log('Uploading to:', bucket, '/', filename);

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filename, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return res.status(500).json({ error: 'Upload failed: ' + error.message });
    }

    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filename);

    console.log('Upload success, URL:', urlData.publicUrl);
    res.json({ url: urlData.publicUrl, filename });

  } catch (e) {
    console.error('Upload catch error:', e);
    res.status(500).json({ error: 'Upload failed: ' + e.message });
  }
});

module.exports = router;
