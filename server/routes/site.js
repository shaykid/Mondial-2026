const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { coordsForTimezone } = require('../data/timezones');
const { seedFooterDocuments } = require('../lib/footer-content');
const { seedTranslations, normalizeLanguage, SUPPORTED_LANGUAGES } = require('../lib/translations');
const { getActiveTheme, getThemeNameOverrides } = require('../lib/themes');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

async function ensureWritableUploadDir(candidates) {
  let lastError = null;
  for (const dir of candidates) {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.access(dir, fs.constants.W_OK);
      return dir;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('no writable upload directory');
}

// ───────── גרסת ה-build הנוכחית (לזיהוי גרסה חדשה בצד הלקוח) ─────────
// מחזיר את build id מתוך dist/version.json שנכתב בכל בנייה. לעולם לא נשמר במטמון.
const VERSION_FILE = path.join(__dirname, '..', '..', 'client', 'dist', 'version.json');
router.get('/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  fs.readFile(VERSION_FILE, 'utf8', (err, data) => {
    if (err) return res.json({ build: null });
    try {
      const parsed = JSON.parse(data);
      res.json({ build: parsed.build || null });
    } catch {
      res.json({ build: null });
    }
  });
});

// ───────── אתר שומר שבת ─────────
// מחזיר אם כרגע שבת לפי מיקום הגולש (נגזר מאזור-הזמן שלו). זמני כניסה/יציאה מ-Hebcal.
const shabbatCache = new Map(); // `${tz}|${YYYY-MM-DD}` → { start, end, ts }

function ymdInTz(tz) {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()); // YYYY-MM-DD
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d, ymd: s };
}

router.get('/shabbat', auth(false), async (req, res) => {
  try {
    const row = await db.one("SELECT `value` FROM settings WHERE `key` = 'shabbat_mode'");
    // ברירת מחדל: פעיל (TRUE) כל עוד לא כובה במפורש
    const enabled = row == null ? true : ['1', 'true', 'on', 'yes'].includes(String(row.value).toLowerCase());
    if (!enabled) return res.json({ enabled: false, active: false });

    let tz = String(req.query.tz || '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_+\-]*\/[A-Za-z0-9_+\-/]+$/.test(tz)) tz = 'Asia/Jerusalem';

    const { y, m, d, ymd } = ymdInTz(tz);
    const cacheKey = `${tz}|${ymd}`;
    let win = shabbatCache.get(cacheKey);
    if (!win || Date.now() - win.ts > 6 * 3600 * 1000) {
      const [lat, lng] = coordsForTimezone(tz);
      const url = `https://www.hebcal.com/shabbat?cfg=json&latitude=${lat}&longitude=${lng}`
        + `&tzid=${encodeURIComponent(tz)}&b=18&gy=${y}&gm=${m}&gd=${d}`;
      const { data } = await axios.get(url, { timeout: 12000 });
      const items = (data && data.items) || [];
      const candles = items.find((i) => i.category === 'candles');
      const havdalah = items.find((i) => i.category === 'havdalah');
      win = { start: candles ? candles.date : null, end: havdalah ? havdalah.date : null, ts: Date.now() };
      shabbatCache.set(cacheKey, win);
    }

    const now = Date.now();
    const startMs = win.start ? Date.parse(win.start) : null;
    const endMs = win.end ? Date.parse(win.end) : null;
    const active = !!(startMs && endMs && now >= startMs && now <= endMs);
    return res.json({ enabled: true, active, start: win.start, end: win.end, tz });
  } catch (e) {
    console.error('site/shabbat:', e.message);
    // אם Hebcal לא זמין — לא חוסמים את האתר
    return res.json({ enabled: true, active: false, error: 'unavailable' });
  }
});

router.get('/footer-docs', auth(false), async (req, res) => {
  try {
    await db.tx(async (t) => seedFooterDocuments(t));
    const rows = await db.query(`
      SELECT id, doc_key, label, file_url, file_type, sort_order
      FROM footer_documents
      ORDER BY sort_order ASC, id ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error('site/footer-docs:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.get('/translations', auth(false), async (req, res) => {
  try {
    await db.tx(async (t) => seedTranslations(t));
    const language = normalizeLanguage(String(req.query.lang || 'he').toLowerCase());
    const rows = await db.query(`
      SELECT translation_key, translation_value
      FROM translations
      WHERE language_code = ?
      ORDER BY translation_key ASC
    `, [language]);
    const items = Object.fromEntries(rows.map((row) => [row.translation_key, row.translation_value]));

    // דריסת שמות (תפריט / שם אפליקציה) לפי ערכת הנושא הפעילה
    const overrides = getThemeNameOverrides();
    for (const [key, byLang] of Object.entries(overrides)) {
      const val = byLang && (byLang[language] || byLang.he || byLang.en);
      if (val) items[key] = val;
    }

    res.json({ language, supported_languages: SUPPORTED_LANGUAGES, items });
  } catch (e) {
    console.error('site/translations:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// קונפיגורציית ערכת הנושא הפעילה (צבעים / נכסים / תמונות תגים)
router.get('/theme', auth(false), async (req, res) => {
  try {
    res.json(getActiveTheme());
  } catch (e) {
    console.error('site/theme:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.get('/scoring', auth(false), async (req, res) => {
  try {
    const keys = [
      'scoring_exact',
      'scoring_result',
      'scoring_goal_diff',
      'scoring_champion',
      'scoring_runner_up',
      'scoring_top_scorer',
      'lock_hours_before'
    ];
    const rows = await db.query(`
      SELECT \`key\`, \`value\`
      FROM settings
      WHERE \`key\` IN (${keys.map(() => '?').join(', ')})
    `, keys);
    const values = Object.fromEntries(rows.map((row) => [row.key, Number(row.value || 0)]));
    res.json({
      exact: values.scoring_exact || 5,
      result: values.scoring_result || 3,
      goalDiff: values.scoring_goal_diff || 1,
      champion: values.scoring_champion || 20,
      runnerUp: values.scoring_runner_up || 10,
      topScorer: values.scoring_top_scorer || 15,
      // שעות נעילה לפני פתיחת המשחק (0 הוא ערך תקין — נעילה בעת פתיחת המשחק)
      lockHoursBefore: values.lock_hours_before ?? 1
    });
  } catch (e) {
    console.error('site/scoring:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.post('/contact', auth(false), upload.single('image'), async (req, res) => {
  try {
    await db.tx(async (t) => seedFooterDocuments(t));
    const name = String(req.body?.name || req.user?.name || '').trim();
    const phone = String(req.body?.phone_number || '').trim();
    const message = String(req.body?.message || '').trim();

    if (!name || !message) {
      return res.status(400).json({ error: 'יש להזין שם והודעה' });
    }

    let imageUrl = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      const rootDir = await ensureWritableUploadDir([
        path.join(__dirname, '..', '..', 'data', 'contact_messages'),
        path.join(__dirname, '..', '..', 'data', 'profile_images', 'contact_messages')
      ]);
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`;
      const fullPath = path.join(rootDir, fileName);
      await fs.promises.writeFile(fullPath, req.file.buffer);
      imageUrl = rootDir.includes(`${path.sep}profile_images${path.sep}`)
        ? `/data/profile_images/contact_messages/${fileName}`
        : `/data/contact_messages/${fileName}`;
    }

    await db.run(`
      INSERT INTO contact_messages (user_id, name, phone_number, message, image_url)
      VALUES (?, ?, ?, ?, ?)
    `, [req.user?.id || null, name, phone || null, message, imageUrl]);

    res.json({ ok: true });
  } catch (e) {
    console.error('site/contact:', e);
    res.status(500).json({ error: 'שליחת הפנייה נכשלה' });
  }
});

module.exports = router;
