// נתיבי אימות (async/MySQL)
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { auth, signToken } = require('../middleware/auth');
const { normalizeLanguage } = require('../lib/translations');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});
let authColumnsReady = false;

async function isSiteGuessGroupsEnabled() {
  const row = await db.one('SELECT `value` FROM settings WHERE `key` = ?', ['site_guess_groups_enabled']);
  return String(row?.value || 'false').trim().toLowerCase() === 'true';
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

async function ensureAuthColumns() {
  if (authColumnsReady) return;
  const phoneLoginCol = await db.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'password_changed'
  `);
  if (!phoneLoginCol?.n) {
    await db.query('ALTER TABLE users ADD COLUMN password_changed TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
  }
  const preferredLanguageCol = await db.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'preferred_language'
  `);
  if (!preferredLanguageCol?.n) {
    await db.query("ALTER TABLE users ADD COLUMN preferred_language VARCHAR(8) NOT NULL DEFAULT 'he' AFTER phone_number");
  }
  authColumnsReady = true;
}

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
async function sanitize(user) {
  const siteGuessGroupsEnabled = await isSiteGuessGroupsEnabled();
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone_number: user.phone_number || '',
    preferred_language: normalizeLanguage(user.preferred_language),
    profile_image_url: user.profile_image_url || '',
    department: user.department || '',
    isAdmin: !!user.is_admin,
    role: user.is_admin ? 'admin' : (user.role || 'user'),
    isGuest: !!user.is_guest,
    canGuessGroups: siteGuessGroupsEnabled && (!!user.is_admin || !!user.can_guess_groups),
    createdAt: user.created_at
  };
}

// הרשמה
router.post('/register', async (req, res) => {
  try {
    await ensureAuthColumns();
    const { email, name, password, phone_number, department, preferred_language } = req.body || {};
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
      `INSERT INTO users (email, name, phone_number, preferred_language, department, password_hash, password_changed, is_admin) VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
      [lower, name.trim(), (phone_number || '').trim() || null, normalizeLanguage(preferred_language), (department || '').trim() || null, hash]
    );
    const user = await db.one('SELECT * FROM users WHERE id = ?', [r.insertId]);
    const token = signToken(user);
    res.json({ token, user: await sanitize(user) });
  } catch (e) {
    console.error('register:', e);
    res.status(500).json({ error: 'שגיאת שרת בהרשמה' });
  }
});

// כניסה
router.post('/login', async (req, res) => {
  try {
    await ensureAuthColumns();
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'אימייל וסיסמה נדרשים' });
    const user = await db.one('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    }
    const byPasswordHash = bcrypt.compareSync(password, user.password_hash);
    const byPhoneFirstLogin = !Number(user.password_changed || 0)
      && normalizePhone(password) !== ''
      && normalizePhone(password) === normalizePhone(user.phone_number);
    if (!byPasswordHash && !byPhoneFirstLogin) {
      return res.status(401).json({ error: 'אימייל או סיסמה שגויים' });
    }
    const token = signToken(user);
    res.json({ token, user: await sanitize(user) });
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
    res.json({ user: await sanitize(user), token: signToken(user) });
  } catch (e) {
    console.error('me:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// שינוי סיסמה
router.post('/change-password', auth(), async (req, res) => {
  try {
    await ensureAuthColumns();
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
    await db.run('UPDATE users SET password_hash = ?, password_changed = 1 WHERE id = ?', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('change-password:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// עדכון פרופיל בסיסי (טלפון + תמונת פרופיל)
router.post('/profile', auth(), upload.single('profile_image'), async (req, res) => {
  try {
    await ensureAuthColumns();
    await ensureProfileImageColumn();
    const phone = String(req.body?.phone_number || '').trim();
    const preferredLanguage = normalizeLanguage(req.body?.preferred_language);
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
      const rootDir = path.join(__dirname, '..', '..', 'data', 'profile_images');
      const baseDir = path.join(rootDir, username);
      await fs.promises.mkdir(rootDir, { recursive: true });
      await fs.promises.mkdir(baseDir, { recursive: true });
      const fileName = `${Date.now()}${safeExt}`;
      const fullPath = path.join(baseDir, fileName);
      await fs.promises.writeFile(fullPath, req.file.buffer);

      // keep only the newest profile image for this user
      const files = await fs.promises.readdir(baseDir);
      await Promise.all(
        files
          .filter((f) => f !== fileName)
          .map((f) => fs.promises.unlink(path.join(baseDir, f)).catch(() => null))
      );

      profileImageUrl = `/data/profile_images/${username}/${fileName}`;
    }

    await db.run(
      'UPDATE users SET phone_number = ?, preferred_language = ?, profile_image_url = ? WHERE id = ?',
      [phone || null, preferredLanguage, profileImageUrl, req.user.id]
    );
    const updatedUser = await db.one('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ ok: true, user: await sanitize(updatedUser) });
  } catch (e) {
    console.error('profile-update:', e);
    const msg = e.code === 'EACCES'
      ? `אין הרשאת כתיבה לתיקיית התמונות בשרת (${e.path || 'data/profile_images'})`
      : e.message;
    res.status(500).json({ error: `שגיאת שרת: ${msg}` });
  }
});

// ────────── זרימת "אורח" (התחל לשחק לפני הרשמה) ──────────

// יצירת משתמש אורח זמני והחזרת token כדי שיוכל לשמור ניחושים מיד
router.post('/guest-start', async (req, res) => {
  try {
    await ensureAuthColumns();
    // ניקוי אורחים נטושים (לא הושלמה הרשמה תוך יומיים) כדי שלא יצטברו
    await db.run("DELETE FROM users WHERE is_guest = 1 AND created_at < (NOW() - INTERVAL 2 DAY)").catch(() => {});
    const lang = normalizeLanguage(req.body?.preferred_language);
    const placeholder = `guest_${Date.now()}_${crypto.randomBytes(5).toString('hex')}@guest.local`;
    const hash = bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), 10);
    const r = await db.run(
      `INSERT INTO users (email, name, preferred_language, password_hash, password_changed, is_admin, role, is_guest)
       VALUES (?, ?, ?, ?, 0, 0, 'user', 1)`,
      [placeholder, 'אורח', lang, hash]
    );
    const user = await db.one('SELECT * FROM users WHERE id = ?', [r.insertId]);
    res.json({ token: signToken(user), user: await sanitize(user) });
  } catch (e) {
    console.error('guest-start:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// בדיקה אם אימייל כבר רשום (משתמש אמיתי שאינו אורח)
router.post('/guest-check-email', auth(), async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.json({ exists: false });
    const u = await db.one('SELECT id, is_guest FROM users WHERE email = ?', [email]);
    res.json({ exists: !!(u && !u.is_guest && u.id !== req.user.id) });
  } catch (e) {
    console.error('guest-check-email:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// השלמת הרשמה של אורח: אימייל + טלפון.
// אם האימייל כבר שייך למשתמש קיים — מאמתים מול הטלפון וממזגים את הניחושים.
router.post('/guest-finalize', auth(), async (req, res) => {
  try {
    await ensureAuthColumns();
    const guestId = req.user.id;
    const guest = await db.one('SELECT * FROM users WHERE id = ?', [guestId]);
    if (!guest) return res.status(404).json({ error: 'משתמש לא נמצא' });

    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone_number || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'יש להזין כתובת אימייל תקינה' });
    }
    if (normalizePhone(phone).length < 6) {
      return res.status(400).json({ error: 'יש להזין מספר טלפון תקין' });
    }

    const existing = await db.one('SELECT * FROM users WHERE email = ? AND id <> ?', [email, guestId]);

    if (existing && !existing.is_guest) {
      // אימייל קיים: מאמתים מול הטלפון של החשבון הקיים לפני מיזוג
      if (!normalizePhone(existing.phone_number) || normalizePhone(existing.phone_number) !== normalizePhone(phone)) {
        return res.status(409).json({
          error: 'האימייל כבר רשום במערכת. אנא התחבר עם האימייל ומספר הטלפון שלך.',
          needLogin: true
        });
      }
      // מיזוג ניחושי האורח לחשבון הקיים (קיימים אצל המשתמש נשמרים)
      await db.tx(async (t) => {
        await t.run('UPDATE IGNORE predictions SET user_id = ? WHERE user_id = ?', [existing.id, guestId]);
        const exSpecial = await t.one('SELECT user_id FROM special_predictions WHERE user_id = ?', [existing.id]);
        if (!exSpecial) {
          await t.run('UPDATE special_predictions SET user_id = ? WHERE user_id = ?', [existing.id, guestId]);
        }
        await t.run('DELETE FROM users WHERE id = ?', [guestId]); // שאריות (התנגשויות) נמחקות ב-CASCADE
      });
      return res.json({ merged: true, token: signToken(existing), user: await sanitize(existing) });
    }

    // אין התנגשות: הופכים את האורח למשתמש רשום (ללא סיסמה — התחברות עתידית עם הטלפון)
    const displayName = (guest.name && guest.name !== 'אורח') ? guest.name : email.split('@')[0];
    await db.run(
      'UPDATE users SET email = ?, name = ?, phone_number = ?, is_guest = 0 WHERE id = ?',
      [email, displayName, phone, guestId]
    );
    const updated = await db.one('SELECT * FROM users WHERE id = ?', [guestId]);
    res.json({ token: signToken(updated), user: await sanitize(updated) });
  } catch (e) {
    console.error('guest-finalize:', e);
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'האימייל כבר רשום במערכת. אנא התחבר.', needLogin: true });
    }
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
