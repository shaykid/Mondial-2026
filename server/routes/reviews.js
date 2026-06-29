// נתיבי ריביו קולי על משחק — הקלטה → תמלול → פרסום → צפייה/האזנה
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { transcribeAudioBuffer } = require('../services/transcribe');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 } // ~16MB מספיק להקלטה קולית קצרה
});

const AUDIO_EXTS = ['.webm', '.ogg', '.m4a', '.mp3', '.wav'];

async function getSetting(key, def) {
  const r = await db.one('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  return r ? r.value : def;
}

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

// נעילה: כמו בניחושים — אי אפשר לפרסם ריביו אחרי שהמשחק ננעל
async function matchLockMs(match) {
  const lockHours = Number(await getSetting('lock_hours_before', 1));
  const ko = new Date(match.kickoff + (String(match.kickoff).endsWith('Z') ? '' : 'Z')).getTime();
  return ko - lockHours * 60 * 60 * 1000;
}

function absDataPath(url) {
  // url בצורת /data/match_reviews/xxx.webm → נתיב מוחלט בדיסק
  const rel = String(url || '').replace(/^\/+/, '');
  if (!rel.startsWith('data/')) return null;
  return path.join(__dirname, '..', '..', rel);
}

// ───────── תמלול: שמירת האודיו + החזרת טקסט מתומלל ─────────
router.post('/transcribe', auth(), upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'לא התקבלה הקלטה' });

    let ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!AUDIO_EXTS.includes(ext)) ext = '.webm';

    const dir = await ensureWritableUploadDir([
      path.join(__dirname, '..', '..', 'data', 'match_reviews'),
      path.join(__dirname, '..', '..', 'data', 'profile_images', 'match_reviews')
    ]);
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    await fs.promises.writeFile(path.join(dir, fileName), req.file.buffer);
    const audioUrl = dir.includes(`${path.sep}profile_images${path.sep}`)
      ? `/data/profile_images/match_reviews/${fileName}`
      : `/data/match_reviews/${fileName}`;

    let transcript = '';
    let warning = null;
    try {
      transcript = await transcribeAudioBuffer(req.file.buffer, fileName);
    } catch (e) {
      // האודיו נשמר; מחזירים טקסט ריק + אזהרה כדי שהמשתמש יוכל לכתוב ידנית
      console.error('reviews/transcribe:', e.message);
      warning = e.code === 'NO_API_KEY' || e.code === 'NO_LIB'
        ? 'התמלול אינו זמין כרגע — ניתן לכתוב את הריביו ידנית'
        : 'התמלול נכשל — ניתן לכתוב את הריביו ידנית';
    }

    res.json({ audio_url: audioUrl, transcript, warning });
  } catch (e) {
    console.error('reviews/transcribe fatal:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── פרסום ריביו ─────────
router.post('/', auth(), async (req, res) => {
  try {
    const matchId = Number(req.body?.match_id);
    const body = String(req.body?.body || '').trim();
    const audioUrl = req.body?.audio_url ? String(req.body.audio_url) : null;
    const transcript = req.body?.transcript ? String(req.body.transcript) : null;
    const includePrediction = req.body?.include_prediction ? 1 : 0;

    if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'משחק לא תקין' });
    if (!body) return res.status(400).json({ error: 'הריביו ריק' });

    const match = await db.one('SELECT id, kickoff FROM matches WHERE id = ?', [matchId]);
    if (!match) return res.status(404).json({ error: 'משחק לא נמצא' });
    if (Date.now() >= await matchLockMs(match)) {
      return res.status(403).json({ error: 'מאוחר מדי — המשחק ננעל' });
    }

    let predHome = null;
    let predAway = null;
    if (includePrediction) {
      const pr = await db.one(
        'SELECT home_score, away_score FROM predictions WHERE user_id = ? AND match_id = ?',
        [req.user.id, matchId]
      );
      if (pr) {
        predHome = pr.home_score;
        predAway = pr.away_score;
      }
    }

    await db.run(`
      INSERT INTO match_reviews
        (user_id, match_id, audio_url, transcript, body, include_prediction, pred_home, pred_away, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published')
      ON DUPLICATE KEY UPDATE
        audio_url          = VALUES(audio_url),
        transcript         = VALUES(transcript),
        body               = VALUES(body),
        include_prediction = VALUES(include_prediction),
        pred_home          = VALUES(pred_home),
        pred_away          = VALUES(pred_away),
        status             = 'published',
        updated_at         = CURRENT_TIMESTAMP
    `, [req.user.id, matchId, audioUrl, transcript, body, includePrediction, predHome, predAway]);

    res.json({ ok: true });
  } catch (e) {
    console.error('reviews/create:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── ריביוים של משחק (מפורסמים) ─────────
router.get('/match/:id', auth(), async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'משחק לא תקין' });
    const rows = await db.query(`
      SELECT r.id, r.user_id, r.body, r.audio_url, r.include_prediction,
             r.pred_home, r.pred_away, r.created_at,
             u.name AS user_name, u.profile_image_url
      FROM match_reviews r
      JOIN users u ON u.id = r.user_id
      WHERE r.match_id = ? AND r.status = 'published'
      ORDER BY r.created_at DESC
    `, [matchId]);
    res.json(rows);
  } catch (e) {
    console.error('reviews/match:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── הריביוים שלי ─────────
router.get('/mine', auth(), async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT r.id, r.match_id, r.body, r.audio_url, r.include_prediction,
             r.pred_home, r.pred_away, r.created_at,
             m.home_code, m.away_code, m.kickoff, m.status AS match_status
      FROM match_reviews r
      JOIN matches m ON m.id = r.match_id
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (e) {
    console.error('reviews/mine:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── עריכת טקסט ריביו (בעלים או מנהל) ─────────
router.patch('/:id', auth(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = String(req.body?.body || '').trim();
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'מזהה לא תקין' });
    if (!body) return res.status(400).json({ error: 'הריביו ריק' });

    const row = await db.one('SELECT user_id FROM match_reviews WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'ריביו לא נמצא' });
    if (row.user_id !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'אין הרשאה' });
    }

    await db.run('UPDATE match_reviews SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [body, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('reviews/patch:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── מחיקת ריביו (בעלים או מנהל) + מחיקת קובץ האודיו ─────────
router.delete('/:id', auth(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'מזהה לא תקין' });

    const row = await db.one('SELECT user_id, audio_url FROM match_reviews WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'ריביו לא נמצא' });
    if (row.user_id !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'אין הרשאה' });
    }

    await db.run('DELETE FROM match_reviews WHERE id = ?', [id]);
    const abs = absDataPath(row.audio_url);
    if (abs) { try { await fs.promises.unlink(abs); } catch (e) { /* כבר נמחק */ } }
    res.json({ ok: true });
  } catch (e) {
    console.error('reviews/delete:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
