// נתיבי אימות (async/MySQL)
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { auth, signToken } = require('../middleware/auth');

const router = express.Router();

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
router.post('/profile', auth(), async (req, res) => {
  try {
    const phone = String(req.body?.phone_number || '').trim();
    const image = String(req.body?.profile_image_url || '').trim();
    if (image && !/^https?:\/\/.+/i.test(image)) {
      return res.status(400).json({ error: 'קישור תמונה חייב להתחיל ב-http/https' });
    }
    await db.run(
      'UPDATE users SET phone_number = ?, profile_image_url = ? WHERE id = ?',
      [phone || null, image || null, req.user.id]
    );
    const user = await db.one('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ ok: true, user: sanitize(user) });
  } catch (e) {
    console.error('profile-update:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
