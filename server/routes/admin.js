// נתיבי ניהול - גישה רק למנהל (async/MySQL)
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const { auth, adminOnly } = require('../middleware/auth');
const { updateMatchScore, runDailyUpdate } = require('../services/scraper');
const { recalcForMatch } = require('../services/scoring');
const {
  DEFAULT_DEPARTMENTS,
  departmentForDemoUser,
  parseDepartments,
  uniqueDepartments
} = require('../lib/departments');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

function randomPassword(len = 10) {
  return crypto.randomBytes(16).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, len);
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function pickField(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const found = keys.find(k => normalizeHeader(k) === target);
    if (found && String(row[found]).trim() !== '') return String(row[found]).trim();
  }
  return '';
}

function userExportRows(rows) {
  return rows.map(r => ({
    'שם מלא': r.name || '',
    'email (username)': r.email || '',
    password: '',
    'phone number': r.phone_number || '',
    'מחלקה': r.department || ''
  }));
}

function hashInt(input) {
  return crypto.createHash('sha256').update(String(input)).digest().readUInt32BE(0);
}

function buildDemoPrediction(match, userIndex) {
  const seed = hashInt(`${userIndex}:${match.id}`);
  const mode = seed % 3;
  let home = seed % 5;
  let away = Math.floor(seed / 5) % 5;

  if (mode === 0 && home <= away) home = Math.min(away + 1, 6);
  if (mode === 1 && away <= home) away = Math.min(home + 1, 6);
  if (mode === 2) away = home;

  return { home_score: home, away_score: away };
}

function buildDemoSpecial(userIndex) {
  const champions = ['ar', 'br', 'fr', 'es', 'pt', 'gb-eng', 'de', 'mx', 'us', 'nl'];
  const runnerUps = ['fr', 'ar', 'gb-eng', 'pt', 'br', 'nl', 'es', 'ca', 'mx', 'be'];
  const scorers = ['Mbappe', 'Vinicius Jr', 'Kane', 'Yamal', 'Ronaldo', 'Messi', 'Saka', 'Haaland', 'Neymar', 'Musiala'];
  const idx = (userIndex - 1) % champions.length;
  return {
    champion_code: champions[idx],
    runner_up_code: runnerUps[idx],
    top_scorer: scorers[idx]
  };
}

async function readDepartments(tx = db) {
  const row = await tx.one('SELECT `value` FROM settings WHERE `key` = ?', ['departments']);
  const departments = parseDepartments(row?.value);
  return departments.length ? departments : [...DEFAULT_DEPARTMENTS];
}

async function writeDepartments(tx, departments) {
  const clean = uniqueDepartments(departments);
  await tx.run(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    ['departments', JSON.stringify(clean)]
  );
  return clean;
}

router.use(auth(), adminOnly);

// סיכום מצב המערכת
router.get('/overview', async (req, res) => {
  try {
    const users      = await db.one('SELECT COUNT(*) AS n FROM users WHERE is_admin = 0');
    const preds      = await db.one('SELECT COUNT(*) AS n FROM predictions');
    const matchesC   = await db.one('SELECT COUNT(*) AS n FROM matches');
    const finished   = await db.one("SELECT COUNT(*) AS n FROM matches WHERE status = 'finished'");
    res.json({
      users:        users.n,
      predictions:  preds.n,
      matches:      matchesC.n,
      finished:     finished.n
    });
  } catch (e) {
    console.error('admin/overview:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// רשימת משתמשים
router.get('/users', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT u.id, u.email, u.name, u.phone_number, u.department, u.is_admin, u.created_at,
        (SELECT COUNT(*) FROM predictions WHERE user_id = u.id) AS num_predictions
      FROM users u
      ORDER BY u.id DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error('admin/users:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// יצירת משתמש חדש ידנית
router.post('/users', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phoneNumber = String(req.body?.phone_number || '').trim();
    const department = String(req.body?.department || '').trim();
    const password = String(req.body?.password || '').trim() || randomPassword(10);

    if (!name || !email) {
      return res.status(400).json({ error: 'שם מלא ואימייל הם שדות חובה' });
    }
    const exists = await db.one('SELECT id FROM users WHERE email = ?', [email]);
    if (exists) return res.status(409).json({ error: 'אימייל זה כבר קיים במערכת' });

    const hash = bcrypt.hashSync(password, 10);
    const r = await db.run(
      `INSERT INTO users (email, name, phone_number, department, password_hash, password_changed, is_admin)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [email, name, phoneNumber || null, department || null, hash]
    );
    const user = await db.one(`
      SELECT u.id, u.email, u.name, u.phone_number, u.department, u.is_admin, u.created_at,
        (SELECT COUNT(*) FROM predictions WHERE user_id = u.id) AS num_predictions
      FROM users u
      WHERE u.id = ?
    `, [r.insertId]);
    res.json({ ok: true, user, password });
  } catch (e) {
    console.error('admin/create-user:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// רשימת מחלקות
router.get('/departments', async (req, res) => {
  try {
    const departments = await readDepartments();
    res.json({ departments });
  } catch (e) {
    console.error('admin/departments/get:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// שמירת מחלקות
router.post('/departments', async (req, res) => {
  try {
    const departments = parseDepartments(req.body?.departments ?? req.body);
    if (!departments.length) {
      return res.status(400).json({ error: 'יש להזין לפחות מחלקה אחת' });
    }
    const clean = await db.tx(async (t) => writeDepartments(t, departments));
    res.json({ ok: true, departments: clean });
  } catch (e) {
    console.error('admin/departments/set:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ייצוא משתמשים ל-CSV/XLSX
router.get('/users/export', async (req, res) => {
  try {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const rows = await db.query(`
      SELECT name, email, phone_number, department
      FROM users
      ORDER BY id ASC
    `);
    const data = userExportRows(rows);
    const headers = ['שם מלא', 'email (username)', 'password', 'phone number', 'מחלקה'];
    const ws = XLSX.utils.json_to_sheet(data, { header: headers });
    const baseName = `users-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(ws);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      return res.send(csv);
    }

    const bookType = format === 'xls' ? 'xls' : 'xlsx';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    const buf = XLSX.write(wb, { bookType, type: 'buffer' });
    res.setHeader(
      'Content-Type',
      bookType === 'xls'
        ? 'application/vnd.ms-excel'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.${bookType}"`);
    return res.send(buf);
  } catch (e) {
    console.error('admin/users/export:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ייבוא משתמשים מ-CSV/XLSX
router.post('/users/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'יש לבחור קובץ' });

    const filename = req.file.originalname || '';
    const lower = filename.toLowerCase();
    const workbook = lower.endsWith('.csv')
      ? XLSX.read(req.file.buffer.toString('utf8'), { type: 'string' })
      : XLSX.read(req.file.buffer, { type: 'buffer' });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'הקובץ ריק' });
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return res.status(400).json({ error: 'לא נמצאו שורות לייבוא' });

    const summary = { created: 0, updated: 0, skipped: 0 };
    const generated = [];

    await db.tx(async (t) => {
      for (const row of rows) {
        const name = pickField(row, ['שם מלא', 'full name', 'fullname', 'name']);
        const email = pickField(row, ['email (username)', 'email', 'username', 'אימייל']).toLowerCase();
        const password = pickField(row, ['password', 'סיסמה']);
        const phone = pickField(row, ['phone number', 'phone', 'phoone number', 'phone_number', 'טלפון']);
        const department = pickField(row, ['מחלקה', 'department', 'dept', 'division']);

        if (!name || !email) {
          summary.skipped += 1;
          continue;
        }

        const existing = await t.one('SELECT id, is_admin FROM users WHERE email = ?', [email]);
        const nextPassword = password || randomPassword(10);
        const passwordHash = bcrypt.hashSync(nextPassword, 10);

        if (existing) {
          if (password) {
            await t.run(
              'UPDATE users SET name = ?, phone_number = ?, department = ?, password_hash = ? WHERE id = ?',
              [name, phone || null, department || null, passwordHash, existing.id]
            );
          } else {
            await t.run(
              'UPDATE users SET name = ?, phone_number = ?, department = ? WHERE id = ?',
              [name, phone || null, department || null, existing.id]
            );
          }
          summary.updated += 1;
        } else {
          await t.run(
            'INSERT INTO users (email, name, phone_number, department, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, 0)',
            [email, name, phone || null, department || null, passwordHash]
          );
          summary.created += 1;
          if (!password) {
            generated.push({ name, email, password: nextPassword, phone_number: phone || '', department: department || '' });
          }
        }
      }
    });

    res.json({ ok: true, ...summary, generated });
  } catch (e) {
    console.error('admin/users/import:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// יצירת 10 משתמשי דמו עם ניחושים מלאים
router.post('/users/demo', async (req, res) => {
  try {
    const matches = await db.query('SELECT id FROM matches ORDER BY id ASC');
    const departments = await readDepartments();
    const generated = [];
    let predictionsInserted = 0;

    await db.tx(async (t) => {
      for (let i = 1; i <= 10; i += 1) {
        const suffix = String(i).padStart(2, '0');
        const name = `משתמש בדיקה ${suffix}`;
        const email = `demo${suffix}@company.local`;
        const phone = `050-555-${String(1000 + i).slice(-4)}`;
        const department = departmentForDemoUser(i, departments);
        const password = `Demo2026${suffix}!`;
        const passwordHash = bcrypt.hashSync(password, 10);

        await t.run(
          `INSERT INTO users (email, name, phone_number, department, password_hash, is_admin)
           VALUES (?, ?, ?, ?, ?, 0)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             phone_number = VALUES(phone_number),
             department = VALUES(department),
             password_hash = VALUES(password_hash),
             is_admin = 0`,
          [email, name, phone, department, passwordHash]
        );

        const user = await t.one('SELECT id FROM users WHERE email = ?', [email]);
        generated.push({ name, email, phone_number: phone, department, password });

        await t.run('DELETE FROM predictions WHERE user_id = ?', [user.id]);
        await t.run('DELETE FROM special_predictions WHERE user_id = ?', [user.id]);

        for (const match of matches) {
          const p = buildDemoPrediction(match, i);
          await t.run(
            `INSERT INTO predictions (user_id, match_id, home_score, away_score, points, submitted_at)
             VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE
               home_score = VALUES(home_score),
               away_score = VALUES(away_score),
               points = 0,
               submitted_at = CURRENT_TIMESTAMP`,
            [user.id, match.id, p.home_score, p.away_score]
          );
          predictionsInserted += 1;
        }

        const special = buildDemoSpecial(i);
        await t.run(
          `INSERT INTO special_predictions (user_id, champion_code, runner_up_code, top_scorer, submitted_at)
           VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON DUPLICATE KEY UPDATE
             champion_code = VALUES(champion_code),
             runner_up_code = VALUES(runner_up_code),
             top_scorer = VALUES(top_scorer),
             submitted_at = CURRENT_TIMESTAMP`,
          [user.id, special.champion_code, special.runner_up_code, special.top_scorer]
        );
      }
    });

    res.json({
      ok: true,
      users: generated.length,
      predictions: predictionsInserted,
      generated
    });
  } catch (e) {
    console.error('admin/users/demo:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// עדכון משתמש
router.patch('/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'משתמש לא תקין' });
    }

    const current = await db.one('SELECT id, is_admin FROM users WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'משתמש לא נמצא' });

    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phoneNumber = String(req.body?.phone_number || '').trim();
    const department = String(req.body?.department || '').trim();

    if (!name || !email) {
      return res.status(400).json({ error: 'שם מלא ואימייל הם שדות חובה' });
    }

    const duplicate = await db.one('SELECT id FROM users WHERE email = ? AND id <> ?', [email, id]);
    if (duplicate) {
      return res.status(409).json({ error: 'אימייל זה כבר קיים במערכת' });
    }

    await db.run(
      'UPDATE users SET name = ?, email = ?, phone_number = ?, department = ? WHERE id = ?',
      [name, email, phoneNumber || null, department || null, id]
    );

    const updated = await db.one(`
      SELECT u.id, u.email, u.name, u.phone_number, u.department, u.is_admin, u.created_at,
        (SELECT COUNT(*) FROM predictions WHERE user_id = u.id) AS num_predictions
      FROM users u
      WHERE u.id = ?
    `, [id]);

    res.json({ ok: true, user: updated });
  } catch (e) {
    console.error('admin/update-user:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// איפוס סיסמה למשתמש
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'משתמש לא תקין' });
    }

    const user = await db.one('SELECT id, email, name FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });

    const password = randomPassword(10);
    const hash = bcrypt.hashSync(password, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);

    res.json({ ok: true, password, email: user.email, name: user.name });
  } catch (e) {
    console.error('admin/reset-password:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// מחיקת משתמש
router.delete('/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'לא ניתן למחוק את עצמך' });
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('admin/delete-user:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// עדכון תוצאה ידני
router.post('/matches/:id/score', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { home_score, away_score, status } = req.body || {};
    if (!Number.isInteger(home_score) || !Number.isInteger(away_score)) {
      return res.status(400).json({ error: 'תוצאה לא תקינה' });
    }
    const ok = await updateMatchScore(id, home_score, away_score, status || 'finished');
    if (!ok) return res.status(404).json({ error: 'המשחק לא נמצא' });
    res.json({ ok: true });
  } catch (e) {
    console.error('admin/score:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ביטול תוצאה
router.delete('/matches/:id/score', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.run(`
      UPDATE matches
      SET home_score = NULL, away_score = NULL, status = 'scheduled', updated_at = NOW()
      WHERE id = ?
    `, [id]);
    await db.run('UPDATE predictions SET points = 0 WHERE match_id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('admin/clear-score:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// הוספת/עדכון משחק (לשלבי נוקאאוט)
router.post('/matches', async (req, res) => {
  try {
    const { id, stage, group_letter, home_code, away_code, kickoff, venue } = req.body || {};
    if (!home_code || !away_code || !kickoff) {
      return res.status(400).json({ error: 'חסרים שדות' });
    }
    // ממיר ISO ל-DATETIME של MySQL
    const k = new Date(kickoff).toISOString().slice(0, 19).replace('T', ' ');
    if (id) {
      await db.run(`
        UPDATE matches SET stage=?, group_letter=?, home_code=?, away_code=?, kickoff=?, venue=?
        WHERE id=?
      `, [stage || 'group', group_letter || null, home_code, away_code, k, venue || null, id]);
      return res.json({ ok: true, id });
    }
    // לנוקאאוט - מצא ID פנוי גבוה
    const last = await db.one('SELECT COALESCE(MAX(id), 0) AS m FROM matches');
    const newId = last.m + 1;
    await db.run(`
      INSERT INTO matches (id, stage, group_letter, home_code, away_code, kickoff, venue, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')
    `, [newId, stage || 'knockout', group_letter || null, home_code, away_code, k, venue || null]);
    res.json({ ok: true, id: newId });
  } catch (e) {
    console.error('admin/add-match:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// הפעלת סקרייפינג ידנית
router.post('/scrape-now', async (req, res) => {
  try {
    const result = await runDailyUpdate();
    res.json(result);
  } catch (e) {
    console.error('admin/scrape-now:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// הגדרות
router.get('/settings', async (req, res) => {
  try {
    const rows = await db.query('SELECT `key`, `value` FROM settings');
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json(obj);
  } catch (e) {
    console.error('admin/settings/get:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.post('/settings', async (req, res) => {
  try {
    await db.tx(async (t) => {
      for (const [k, v] of Object.entries(req.body || {})) {
        await t.run(
          'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ' +
          'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
          [k, String(v)]
        );
      }
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('admin/settings/set:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// חישוב מחדש של כל הניקוד
router.post('/recalculate', async (req, res) => {
  try {
    const matches = await db.query("SELECT id FROM matches WHERE status = 'finished'");
    let total = 0;
    for (const m of matches) total += await recalcForMatch(m.id);
    res.json({ ok: true, predictions_updated: total });
  } catch (e) {
    console.error('admin/recalculate:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// כל הניחושים של משתמש מסוים (לצפייה)
router.get('/users/:id/predictions', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const preds = await db.query(`
      SELECT p.*, m.home_code, m.away_code, m.kickoff, m.status,
        m.home_score AS actual_home, m.away_score AS actual_away
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      WHERE p.user_id = ?
      ORDER BY m.kickoff ASC
    `, [id]);
    const special = await db.one('SELECT * FROM special_predictions WHERE user_id = ?', [id]);
    res.json({ predictions: preds, special: special || null });
  } catch (e) {
    console.error('admin/user-preds:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
