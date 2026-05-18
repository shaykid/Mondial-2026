// נתיבי אימות (async/MySQL)
const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { auth, signToken } = require('../middleware/auth');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

async function ensureProfileImageColumn() {
  const col = await db.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'profile_image_url'
  `);
  if (!col?.n) {
    await db.query('ALTER TABLE users ADD COLUMN profile_image_url VARCHAR(500) NULL AFTER phone_number');
  }
}

// helper - אל תשלח החוצה password_hash
function sanitize(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone_number: user.phone_number || '',
    profile_image_url: user.profile_image_url || '',
    department: user.department || '',
    isAdmin: !!user.is_admin,
    createdAt: user.created_at
  };
}

// הרשמה
router.post('/register', async (req, res) => {
  try {
    const { email, name, password, phone_number, department } = req.body || {};
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'כל השדות נדרשים' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
    }
    const lower = email.toLowerCase();
    const exists = await db.one('SELECT id FROM users WHERE email = ?', [lower]);
    if (exists) return res.status(409).json({ error: 'אימייל זה כבר קיים במערכת' });

    const hash = bcrypt.hashSync(password, 10);
    const r = await db.run(
      `INSERT INTO users (email, name, phone_number, department, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, 0)`,
      [lower, name.trim(), (phone_number || '').trim() || null, (department || '').trim() || null, hash]
    );
    const user = await db.one('SELECT * FROM users WHERE id = ?', [r.insertId]);
    const token = signToken(user);
    res.json({ token, user: sanitize(user) });
  } catch (e) {
    console.error('register:', e);
    res.status(500).json({ error: 'שגיאת שרת בהרשמה' });
  }
});

// כניסה
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'אימייל וסיסמה נדרשים' });
    const user = await db.one('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    }
    const token = signToken(user);
    res.json({ token, user: sanitize(user) });
  } catch (e) {
    console.error('login:', e);
    res.status(500).json({ error: 'שגיאת שרת בכניסה' });
  }
});

// פרטי המשתמש המחובר
router.get('/me', auth(), async (req, res) => {
  try {
    const user = await db.one('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
    res.json({ user: sanitize(user) });
  } catch (e) {
    console.error('me:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// שינוי סיסמה
router.post('/change-password', auth(), async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'יש להזין סיסמה נוכחית וסיסמה חדשה' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'הסיסמה החדשה חייבת להכיל לפחות 6 תווים' });
    }
    const user = await db.one('SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'הסיסמה הנוכחית שגויה' });
    }
    const hash = bcrypt.hashSync(new_password, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('change-password:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// עדכון פרופיל בסיסי (טלפון + תמונת פרופיל)
router.post('/profile', auth(), upload.single('profile_image'), async (req, res) => {
  try {
    await ensureProfileImageColumn();
    const phone = String(req.body?.phone_number || '').trim();
    const user = await db.one('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });

    let profileImageUrl = user.profile_image_url || null;
    if (req.file) {
      const username = String(user.email || `user-${user.id}`)
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '_');
      const ext = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      const baseDir = path.join(__dirname, '..', '..', 'data', 'profile_images', username);
      await fs.promises.mkdir(baseDir, { recursive: true });
      const fileName = `${Date.now()}${safeExt}`;
      const fullPath = path.join(baseDir, fileName);
      await fs.promises.writeFile(fullPath, req.file.buffer);
      profileImageUrl = `/data/profile_images/${username}/${fileName}`;
    }

    await db.run(
      'UPDATE users SET phone_number = ?, profile_image_url = ? WHERE id = ?',
      [phone || null, profileImageUrl, req.user.id]
    );
    const updatedUser = await db.one('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ ok: true, user: sanitize(updatedUser) });
  } catch (e) {
    console.error('profile-update:', e);
    res.status(500).json({ error: `שגיאת שרת: ${e.message}` });
  }
});

module.exports = router;
