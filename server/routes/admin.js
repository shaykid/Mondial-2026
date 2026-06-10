// נתיבי ניהול - גישה רק למנהל (async/MySQL)
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { updateMatchScore, runDailyUpdate } = require('../services/scraper');
const { recalcForMatch, loadBadgeConfig, DEFAULT_BADGE_CONFIG } = require('../services/scoring');
const { seedScheduleItems } = require('../lib/schedule-items');
const { seedFooterDocuments } = require('../lib/footer-content');
const {
  DEFAULT_DEPARTMENTS,
  departmentForDemoUser,
  parseDepartments,
  uniqueDepartments
} = require('../lib/departments');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

async function ensureWritableDir(candidates) {
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
  throw lastError || new Error('no writable directory');
}

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

function mysqlCliBaseArgs() {
  const args = ['--default-character-set=utf8mb4'];
  if (db.config.socketPath) args.push(`--socket=${db.config.socketPath}`);
  else {
    args.push(`--host=${db.config.host || '127.0.0.1'}`);
    args.push(`--port=${Number(db.config.port) || 3306}`);
  }
  args.push(`--user=${db.config.user}`);
  return args;
}

function mysqlCliEnv() {
  return {
    ...process.env,
    MYSQL_PWD: db.config.password || ''
  };
}

async function listSiteTables() {
  const rows = await db.query('SHOW TABLES');
  return rows.map((row) => Object.values(row)[0]).filter(Boolean).sort();
}

function runCommandCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: mysqlCliEnv(),
      stdio: ['ignore', 'pipe', 'pipe']
      ,...options
    });

    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(stdout));
      reject(new Error(Buffer.concat(stderr).toString('utf8') || `${command} exited with code ${code}`));
    });
  });
}

function runMysqlImport(sqlBuffer) {
  return new Promise((resolve, reject) => {
    const child = spawn('mysql', [...mysqlCliBaseArgs(), db.config.database], {
      env: mysqlCliEnv(),
      stdio: ['pipe', 'ignore', 'pipe']
    });

    const stderr = [];

    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(Buffer.concat(stderr).toString('utf8') || `mysql exited with code ${code}`));
    });

    child.stdin.end(sqlBuffer);
  });
}

async function createBackupArchive(sqlBuffer) {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mondial-backup-'));
  const exportRoot = path.join(tmpRoot, 'export');
  const archivePath = path.join(tmpRoot, 'site-backup.tar.gz');
  const dataDir = path.join(__dirname, '..', '..', 'data');
  const docsDir = path.join(__dirname, '..', '..', 'docs');
  await fs.promises.mkdir(exportRoot, { recursive: true });
  await fs.promises.writeFile(path.join(exportRoot, 'db.sql'), sqlBuffer);
  if (fs.existsSync(dataDir)) {
    await runCommandCapture('cp', ['-a', dataDir, path.join(exportRoot, 'data')]);
  }
  if (fs.existsSync(docsDir)) {
    await runCommandCapture('cp', ['-a', docsDir, path.join(exportRoot, 'docs')]);
  }
  await runCommandCapture(
    'tar',
    ['-czf', archivePath, 'db.sql', ...(fs.existsSync(path.join(exportRoot, 'data')) ? ['data'] : []), ...(fs.existsSync(path.join(exportRoot, 'docs')) ? ['docs'] : [])],
    { cwd: exportRoot }
  );
  const archive = await fs.promises.readFile(archivePath);
  await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  return archive;
}

async function importBackupArchive(buffer) {
  const tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mondial-import-'));
  const archivePath = path.join(tmpRoot, 'backup.tar.gz');
  const extractDir = path.join(tmpRoot, 'extract');
  const liveDataDir = path.join(__dirname, '..', '..', 'data');
  const liveDocsDir = path.join(__dirname, '..', '..', 'docs');
  await fs.promises.mkdir(extractDir, { recursive: true });
  await fs.promises.writeFile(archivePath, buffer);
  await runCommandCapture('tar', ['-xzf', archivePath, '-C', extractDir]);

  const sqlPath = path.join(extractDir, 'db.sql');
  if (!fs.existsSync(sqlPath)) {
    throw new Error('db.sql not found in backup archive');
  }

  const sqlBuffer = await fs.promises.readFile(sqlPath);
  await runMysqlImport(sqlBuffer);

  const extractedDataDir = path.join(extractDir, 'data');
  if (fs.existsSync(extractedDataDir)) {
    await fs.promises.mkdir(liveDataDir, { recursive: true });
    const entries = await fs.promises.readdir(liveDataDir);
    await Promise.all(entries.map((entry) => fs.promises.rm(path.join(liveDataDir, entry), { recursive: true, force: true })));
    await runCommandCapture('cp', ['-a', `${extractedDataDir}/.`, liveDataDir]);
  }

  const extractedDocsDir = path.join(extractDir, 'docs');
  if (fs.existsSync(extractedDocsDir)) {
    await fs.promises.mkdir(liveDocsDir, { recursive: true });
    const entries = await fs.promises.readdir(liveDocsDir);
    await Promise.all(entries.map((entry) => fs.promises.rm(path.join(liveDocsDir, entry), { recursive: true, force: true })));
    await runCommandCapture('cp', ['-a', `${extractedDocsDir}/.`, liveDocsDir]);
  }

  await fs.promises.rm(tmpRoot, { recursive: true, force: true });
}

function normalizeNullable(value) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

async function readSettingsMap(keys) {
  if (!Array.isArray(keys) || !keys.length) return {};
  const placeholders = keys.map(() => '?').join(', ');
  const rows = await db.query(`SELECT \`key\`, \`value\` FROM settings WHERE \`key\` IN (${placeholders})`, keys);
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

function buildTransportConfig(settings) {
  const security = String(settings.smtp_security || 'STARTTLS').trim().toUpperCase();
  const port = Number(settings.smtp_port || 587);
  const secure = security === 'SSL' || security === 'SMTPS' || port === 465;
  return {
    host: String(settings.smtp_server || '').trim(),
    port,
    secure,
    requireTLS: security === 'STARTTLS',
    auth: {
      user: String(settings.smtp_user || '').trim(),
      pass: String(settings.smtp_password || '')
    }
  };
}

// שליחה דרך חשבון Gmail באמצעות "סיסמת אפליקציה" (smtp.gmail.com) — ללא OAuth2.
function buildGmailTransportConfig(settings) {
  return {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: String(settings.gmail_app_user || '').trim(),
      pass: String(settings.gmail_app_password || '')
    }
  };
}

function resolveUserDeliveryMode(settings) {
  return String(settings.email_user_delivery_mode || 'smtp').trim().toLowerCase() === 'gmail' ? 'gmail' : 'smtp';
}

function assertSmtpSettings(settings) {
  if (!settings.smtp_server || !settings.smtp_user || !settings.smtp_password) {
    throw new Error('יש להגדיר תחילה פרטי SMTP בלשונית ההגדרות');
  }
}

function assertGmailSettings(settings) {
  if (!String(settings.gmail_app_user || '').trim() || !String(settings.gmail_app_password || '').trim()) {
    throw new Error('יש להגדיר כתובת Gmail וסיסמת אפליקציה בלשונית ההגדרות');
  }
}

function buildEmailHtml(body, extraLines) {
  const bodyHtml = String(body || '')
    .split(/\r?\n/)
    .map((line) => `<div>${line || '&nbsp;'}</div>`)
    .join('');
  const extraHtml = extraLines.length
    ? `<hr style="margin:18px 0;border:none;border-top:1px solid #d9d9d9" /><div>${extraLines.map((line) => `<div>${line}</div>`).join('')}</div>`
    : '';
  return `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">${bodyHtml}${extraHtml}</div>`;
}

async function replaceScheduleAsset(itemId, fieldName, file, suffix) {
  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
  const rootDir = path.join(__dirname, '..', '..', 'data', 'schedule_items');
  const baseDir = path.join(rootDir, `item-${itemId}`);
  await fs.promises.mkdir(rootDir, { recursive: true });
  await fs.promises.mkdir(baseDir, { recursive: true });
  const fileName = `${suffix}-${Date.now()}${safeExt}`;
  const fullPath = path.join(baseDir, fileName);
  await fs.promises.writeFile(fullPath, file.buffer);

  const files = await fs.promises.readdir(baseDir);
  await Promise.all(
    files
      .filter((name) => name.startsWith(`${suffix}-`) && name !== fileName)
      .map((name) => fs.promises.unlink(path.join(baseDir, name)).catch(() => null))
  );

  return `/data/schedule_items/item-${itemId}/${fileName}`;
}

async function appendEmailSendLog(entry) {
  const logsDir = await ensureWritableDir([
    path.join(__dirname, '..', '..', 'data', 'logs'),
    path.join(__dirname, '..', '..', 'server', 'data', 'logs'),
    path.join(__dirname, '..', '..', 'data', 'profile_images', 'logs')
  ]);
  const monthKey = new Date().toISOString().slice(0, 7);
  const logPath = path.join(logsDir, `email-sends-${monthKey}.log`);
  await fs.promises.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function removeScheduleAssets(itemId) {
  const baseDir = path.join(__dirname, '..', '..', 'data', 'schedule_items', `item-${itemId}`);
  await fs.promises.rm(baseDir, { recursive: true, force: true }).catch(() => null);
}

async function fetchScheduleItems(tx = db) {
  return tx.query(`
    SELECT
      s.*,
      u.id AS winner_id,
      u.name AS winner_name,
      u.email AS winner_email,
      u.profile_image_url AS winner_profile_image_url
    FROM schedule_items s
    LEFT JOIN users u ON u.id = s.winner_user_id
    ORDER BY s.sort_order ASC, s.start_at ASC, s.id ASC
  `);
}

async function replaceFooterDocAsset(docKey, file, prevUrl) {
  const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf';
  const safeExt = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.pdf';
  const rootDir = path.join(__dirname, '..', '..', 'data', 'footer_docs');
  await fs.promises.mkdir(rootDir, { recursive: true });
  // שם קובץ ייחודי (חותמת זמן) כדי שכתובת ה-URL תשתנה בכל העלאה ותעקוף את קאש הדפדפן,
  // כך שהקישור בפוטר יפתח תמיד את ה-PDF החדש ולא גרסה ישנה שמורה.
  const storedName = `${docKey}-${Date.now()}${safeExt}`;
  const fullPath = path.join(rootDir, storedName);
  await fs.promises.writeFile(fullPath, file.buffer);
  // ניקוי הקובץ הקודם (אם קיים תחת התיקייה שלנו ואינו אחד מקובצי ברירת המחדל)
  if (prevUrl) {
    const prevName = path.basename(String(prevUrl).split('?')[0]);
    if (prevName && prevName !== storedName && prevName.startsWith(`${docKey}-`)) {
      await fs.promises.rm(path.join(rootDir, prevName), { force: true }).catch(() => {});
    }
  }
  return {
    url: `/data/footer_docs/${storedName}`,
    type: safeExt === '.pdf' ? 'pdf' : 'image',
    name: file.originalname || storedName
  };
}

// מנהל מערכת מלא (admin) ניגש להכל. מנהל-משנה (manager) מוגבל לניהול משתמשים ומשחקים בלבד.
const MANAGER_GET = [/^\/overview$/, /^\/departments$/];
const MANAGER_ANY = [/^\/users(\/.*)?$/, /^\/matches(\/.*)?$/, /^\/scrape-now$/, /^\/recalculate$/];

function adminGate(req, res, next) {
  if (req.user && req.user.isAdmin) return next();
  if (req.user && req.user.role === 'manager') {
    const p = req.path; // נתיב יחסי לנקודת ההרכבה (/api/admin)
    const allowed = MANAGER_ANY.some(rx => rx.test(p))
      || (req.method === 'GET' && MANAGER_GET.some(rx => rx.test(p)));
    if (allowed) return next();
  }
  return res.status(403).json({ error: 'גישה זו מוגבלת למנהלי מערכת' });
}

// מנהל-משנה אינו רשאי לפעול על מנהלים / מנהלי-משנה אחרים (הגנת הרשאות)
async function ensureCanManageTarget(req, res, targetId) {
  if (req.user.isAdmin) return true;
  const target = await db.one('SELECT is_admin, role FROM users WHERE id = ?', [targetId]);
  const targetRole = target?.is_admin ? 'admin' : (target?.role || 'user');
  if (targetRole !== 'user') {
    res.status(403).json({ error: 'אין הרשאה לפעול על משתמש זה' });
    return false;
  }
  return true;
}

router.use(auth(), adminGate);

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
      SELECT u.id, u.email, u.name, u.phone_number, u.department, u.is_admin, u.can_guess_groups, u.role, u.created_at,
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

    // רק מנהל מערכת מלא רשאי לקבוע תפקיד; אחרת ברירת המחדל היא משתמש רגיל
    let role = 'user';
    if (req.user.isAdmin && ['user', 'manager', 'admin'].includes(String(req.body?.role || ''))) {
      role = String(req.body.role);
    }

    const hash = bcrypt.hashSync(password, 10);
    const r = await db.run(
      `INSERT INTO users (email, name, phone_number, department, password_hash, password_changed, is_admin, role)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [email, name, phoneNumber || null, department || null, hash, role === 'admin' ? 1 : 0, role]
    );
    const user = await db.one(`
      SELECT u.id, u.email, u.name, u.phone_number, u.department, u.is_admin, u.can_guess_groups, u.role, u.created_at,
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

router.get('/schedule-items', async (req, res) => {
  try {
    await db.tx(async (t) => seedScheduleItems(t));
    const rows = await fetchScheduleItems();
    res.json(rows);
  } catch (e) {
    console.error('admin/schedule-items/get:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.post('/schedule-items/structure', async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!rows || !rows.length) {
      return res.status(400).json({ error: 'יש לשלוח לפחות שורה אחת ללוז' });
    }

    const normalized = [];
    const titleSet = new Set();

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const id = Number.parseInt(row.id, 10);
      const title = String(row.title || '').trim();
      const dateLabel = String(row.date_label || '').trim();
      const description = String(row.description || '').trim();
      const startAt = String(row.start_at || '').trim();
      const endAt = String(row.end_at || '').trim();
      const sortOrderRaw = row.sort_order === '' || row.sort_order == null ? index + 1 : row.sort_order;
      const sortOrder = Number.parseInt(sortOrderRaw, 10);
      const prizeSlot = row.prize_slot === '' || row.prize_slot == null ? null : Number.parseInt(row.prize_slot, 10);
      const winnerUserId = row.winner_user_id === '' || row.winner_user_id == null ? null : Number.parseInt(row.winner_user_id, 10);
      const popupEnabled = !!row.popup_enabled;
      const popupTitle = normalizeNullable(row.popup_title);

      if (!title || !dateLabel || !description || !startAt || !endAt || !Number.isInteger(sortOrder)) {
        return res.status(400).json({ error: `יש למלא את כל השדות החובה בשורה ${index + 1}` });
      }
      if (titleSet.has(title)) {
        return res.status(400).json({ error: `נמצאה כותרת כפולה בלוז: ${title}` });
      }
      if (prizeSlot != null && (!Number.isInteger(prizeSlot) || prizeSlot < 1 || prizeSlot > 3)) {
        return res.status(400).json({ error: `ערך פרס לא תקין בשורה ${index + 1}` });
      }
      if (winnerUserId != null && !Number.isInteger(winnerUserId)) {
        return res.status(400).json({ error: `זוכה לא תקין בשורה ${index + 1}` });
      }

      titleSet.add(title);
      normalized.push({
        id: Number.isInteger(id) && id > 0 ? id : null,
        title,
        dateLabel,
        description,
        startAt: startAt.length === 10 ? `${startAt} 00:00:00` : startAt.replace('T', ' ') + ':00',
        endAt: endAt.length === 10 ? `${endAt} 23:59:59` : endAt.replace('T', ' ') + ':00',
        sortOrder,
        prizeSlot,
        winnerUserId,
        popupEnabled,
        popupTitle
      });
    }

    const deletedIds = [];
    await db.tx(async (t) => {
      await seedScheduleItems(t);
      const currentRows = await t.query('SELECT id FROM schedule_items');
      const existingIds = new Set(currentRows.map((row) => row.id));
      const incomingIds = new Set(normalized.map((row) => row.id).filter(Boolean));

      for (const row of normalized) {
        if (row.id && existingIds.has(row.id)) {
          await t.run(`
            UPDATE schedule_items
            SET title = ?, date_label = ?, description = ?, start_at = ?, end_at = ?, sort_order = ?,
                prize_slot = ?, winner_user_id = ?, popup_enabled = ?, popup_title = ?
            WHERE id = ?
          `, [
            row.title,
            row.dateLabel,
            row.description,
            row.startAt,
            row.endAt,
            row.sortOrder,
            row.prizeSlot,
            row.winnerUserId,
            row.popupEnabled ? 1 : 0,
            row.popupTitle,
            row.id
          ]);
        } else {
          const result = await t.run(`
            INSERT INTO schedule_items (
              title, date_label, description, start_at, end_at, sort_order, prize_slot,
              winner_user_id, popup_enabled, popup_title
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            row.title,
            row.dateLabel,
            row.description,
            row.startAt,
            row.endAt,
            row.sortOrder,
            row.prizeSlot,
            row.winnerUserId,
            row.popupEnabled ? 1 : 0,
            row.popupTitle
          ]);
          row.id = result?.lastID || result?.insertId || row.id;
        }
      }

      for (const currentId of existingIds) {
        if (!incomingIds.has(currentId)) {
          await t.run('DELETE FROM schedule_items WHERE id = ?', [currentId]);
          deletedIds.push(currentId);
        }
      }
    });

    await Promise.all(deletedIds.map((id) => removeScheduleAssets(id)));
    const updatedRows = await fetchScheduleItems();
    res.json({ ok: true, items: updatedRows });
  } catch (e) {
    console.error('admin/schedule-items/structure:', e);
    res.status(500).json({ error: 'שמירת מבנה הלוז נכשלה' });
  }
});

router.get('/footer-docs', async (req, res) => {
  try {
    await db.tx(async (t) => seedFooterDocuments(t));
    const docs = await db.query(`
      SELECT id, doc_key, label, file_url, file_name, file_type, sort_order
      FROM footer_documents
      ORDER BY sort_order ASC, id ASC
    `);
    const contacts = await db.query(`
      SELECT c.*, u.name AS user_name, u.email AS user_email
      FROM contact_messages c
      LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.created_at DESC, c.id DESC
    `);
    res.json({ docs, contacts });
  } catch (e) {
    console.error('admin/footer-docs/get:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.post('/contact-messages/:id/handle', async (req, res) => {
  try {
    await db.tx(async (t) => seedFooterDocuments(t));
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'פנייה לא תקינה' });
    }
    const current = await db.one('SELECT id FROM contact_messages WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'הפנייה לא נמצאה' });
    await db.run('UPDATE contact_messages SET handled_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('admin/contact-messages/handle:', e);
    res.status(500).json({ error: 'עדכון הפנייה נכשל' });
  }
});

router.delete('/contact-messages/:id', async (req, res) => {
  try {
    await db.tx(async (t) => seedFooterDocuments(t));
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'פנייה לא תקינה' });
    }
    const current = await db.one('SELECT id, image_url FROM contact_messages WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'הפנייה לא נמצאה' });
    await db.run('DELETE FROM contact_messages WHERE id = ?', [id]);

    if (current.image_url) {
      const relative = current.image_url.replace(/^\/data\//, '');
      const fullPath = path.join(__dirname, '..', '..', 'data', relative);
      await fs.promises.unlink(fullPath).catch(() => null);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('admin/contact-messages/delete:', e);
    res.status(500).json({ error: 'מחיקת הפנייה נכשלה' });
  }
});

router.post('/footer-docs/:key', upload.single('file'), async (req, res) => {
  try {
    await db.tx(async (t) => seedFooterDocuments(t));
    const key = String(req.params.key || '').trim();
    const doc = await db.one('SELECT * FROM footer_documents WHERE doc_key = ?', [key]);
    if (!doc) return res.status(404).json({ error: 'מסמך לא נמצא' });

    const label = String(req.body?.label || '').trim() || doc.label;
    let fileUrl = doc.file_url || null;
    let fileType = doc.file_type || 'pdf';
    let fileName = doc.file_name || null;

    if (req.file) {
      const uploaded = await replaceFooterDocAsset(key, req.file, doc.file_url);
      fileUrl = uploaded.url;
      fileType = uploaded.type;
      fileName = uploaded.name;
    }

    await db.run(
      'UPDATE footer_documents SET label = ?, file_url = ?, file_name = ?, file_type = ? WHERE doc_key = ?',
      [label, fileUrl, fileName, fileType, key]
    );

    const updated = await db.one(`
      SELECT id, doc_key, label, file_url, file_name, file_type, sort_order
      FROM footer_documents
      WHERE doc_key = ?
    `, [key]);
    res.json({ ok: true, doc: updated });
  } catch (e) {
    console.error('admin/footer-docs/save:', e);
    res.status(500).json({ error: 'שמירת מסמך נכשלה' });
  }
});

router.post('/schedule-items/:id', upload.fields([
  { name: 'prize_image', maxCount: 1 },
  { name: 'popup_image', maxCount: 1 }
]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'שורה לא תקינה' });
    }

    const current = await db.one('SELECT * FROM schedule_items WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'שורת לוז לא נמצאה' });

    const title = String(req.body?.title || '').trim();
    const dateLabel = String(req.body?.date_label || '').trim();
    const description = String(req.body?.description || '').trim();
    const startAt = String(req.body?.start_at || '').trim();
    const endAt = String(req.body?.end_at || '').trim();
    const sortOrder = Number.parseInt(req.body?.sort_order, 10);
    const prizeSlotRaw = String(req.body?.prize_slot || '').trim();
    const winnerUserIdRaw = String(req.body?.winner_user_id || '').trim();
    const popupEnabled = String(req.body?.popup_enabled || '') === '1';
    const popupTitle = normalizeNullable(req.body?.popup_title);

    if (!title || !dateLabel || !description || !startAt || !endAt || !Number.isInteger(sortOrder)) {
      return res.status(400).json({ error: 'יש למלא כותרת, תאריך, תיאור, טווח תאריכים וסדר תצוגה' });
    }

    const startAtSql = startAt.length === 10 ? `${startAt} 00:00:00` : startAt.replace('T', ' ') + ':00';
    const endAtSql = endAt.length === 10 ? `${endAt} 23:59:59` : endAt.replace('T', ' ') + ':00';
    const prizeSlot = prizeSlotRaw ? Number.parseInt(prizeSlotRaw, 10) : null;
    const winnerUserId = winnerUserIdRaw ? Number.parseInt(winnerUserIdRaw, 10) : null;
    if (winnerUserId != null && !Number.isInteger(winnerUserId)) {
      return res.status(400).json({ error: 'זוכה לא תקין' });
    }

    let prizeImageUrl = current.prize_image_url || null;
    let popupImageUrl = current.popup_image_url || null;
    const prizeFile = req.files?.prize_image?.[0];
    const popupFile = req.files?.popup_image?.[0];

    if (prizeFile) prizeImageUrl = await replaceScheduleAsset(id, 'prize_image_url', prizeFile, 'prize');
    if (popupFile) popupImageUrl = await replaceScheduleAsset(id, 'popup_image_url', popupFile, 'popup');

    await db.run(`
      UPDATE schedule_items
      SET title = ?, date_label = ?, description = ?, start_at = ?, end_at = ?, sort_order = ?,
          prize_slot = ?, winner_user_id = ?, prize_image_url = ?, popup_enabled = ?, popup_title = ?, popup_image_url = ?
      WHERE id = ?
    `, [
      title,
      dateLabel,
      description,
      startAtSql,
      endAtSql,
      sortOrder,
      Number.isInteger(prizeSlot) ? prizeSlot : null,
      winnerUserId,
      prizeImageUrl,
      popupEnabled ? 1 : 0,
      popupTitle,
      popupImageUrl,
      id
    ]);

    const updated = await db.one(`
      SELECT
        s.*,
        u.id AS winner_id,
        u.name AS winner_name,
        u.email AS winner_email,
        u.profile_image_url AS winner_profile_image_url
      FROM schedule_items s
      LEFT JOIN users u ON u.id = s.winner_user_id
      WHERE s.id = ?
    `, [id]);
    res.json({ ok: true, item: updated });
  } catch (e) {
    console.error('admin/schedule-items/save:', e);
    res.status(500).json({ error: 'שמירת שורת הלוז נכשלה' });
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
    const importMode = String(req.body?.import_mode || 'replace_existing').trim();
    if (!['replace_existing', 'replace_all'].includes(importMode)) {
      return res.status(400).json({ error: 'מצב ייבוא לא תקין' });
    }

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

    const summary = { created: 0, updated: 0, skipped: 0, cleared: 0, import_mode: importMode };
    const generated = [];

    await db.tx(async (t) => {
      if (importMode === 'replace_all') {
        const countRow = await t.one('SELECT COUNT(*) AS n FROM users WHERE is_admin = 0');
        summary.cleared = Number(countRow?.n || 0);
        await t.run('DELETE FROM users WHERE is_admin = 0');
      }

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

// גיבוי SQL של כל טבלאות האתר
router.get('/site-backup/export', async (req, res) => {
  try {
    const tables = await listSiteTables();
    if (!tables.length) {
      return res.status(400).json({ error: 'לא נמצאו טבלאות לגיבוי' });
    }

    const dump = await runCommandCapture('mysqldump', [
      ...mysqlCliBaseArgs(),
      '--single-transaction',
      '--skip-comments',
      '--add-drop-table',
      '--skip-dump-date',
      db.config.database,
      ...tables
    ]);
    const archive = await createBackupArchive(dump);
    const dateTag = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="site-backup-${dateTag}.tar.gz"`);
    return res.send(archive);
  } catch (e) {
    console.error('admin/site-backup/export:', e);
    res.status(500).json({ error: 'ייצוא הגיבוי נכשל' });
  }
});

// ייבוא SQL שמחליף את נתוני האתר
router.post('/site-backup/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'יש לבחור קובץ גיבוי' });

    const filename = String(req.file.originalname || '').toLowerCase();
    if (!req.file.buffer?.length) {
      return res.status(400).json({ error: 'הקובץ ריק' });
    }

    if (filename.endsWith('.sql')) {
      await runMysqlImport(req.file.buffer);
      return res.json({ ok: true, message: 'גיבוי SQL יובא בהצלחה' });
    }

    if (filename.endsWith('.tar.gz') || filename.endsWith('.tgz')) {
      await importBackupArchive(req.file.buffer);
      return res.json({ ok: true, message: 'הגיבוי יובא בהצלחה כולל מסד הנתונים והתמונות' });
    }

    return res.status(400).json({ error: 'יש להעלות קובץ ‎.sql או ‎.tar.gz' });
  } catch (e) {
    console.error('admin/site-backup/import:', e);
    res.status(500).json({ error: 'ייבוא הגיבוי נכשל' });
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

    const current = await db.one('SELECT id, is_admin, role FROM users WHERE id = ?', [id]);
    if (!current) return res.status(404).json({ error: 'משתמש לא נמצא' });

    // מנהל-משנה אינו רשאי לערוך מנהלים / מנהלי-משנה אחרים
    if (!req.user.isAdmin) {
      const targetRole = current.is_admin ? 'admin' : (current.role || 'user');
      if (targetRole !== 'user') {
        return res.status(403).json({ error: 'אין הרשאה לערוך משתמש זה' });
      }
    }

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

    const canGuessGroups = req.body?.can_guess_groups === undefined
      ? null
      : (req.body.can_guess_groups ? 1 : 0);

    // רק מנהל מערכת מלא רשאי לשנות תפקיד
    let nextRole = null;
    if (req.user.isAdmin && req.body?.role !== undefined) {
      const r = String(req.body.role);
      if (!['user', 'manager', 'admin'].includes(r)) {
        return res.status(400).json({ error: 'תפקיד לא תקין' });
      }
      // מנהל מערכת לא יכול להוריד את עצמו מתפקיד admin (מניעת נעילה עצמית)
      if (req.user.id === id && r !== 'admin') {
        return res.status(400).json({ error: 'לא ניתן לשנות את התפקיד של עצמך' });
      }
      nextRole = r;
    }

    const sets = ['name = ?', 'email = ?', 'phone_number = ?', 'department = ?'];
    const params = [name, email, phoneNumber || null, department || null];
    if (canGuessGroups !== null) { sets.push('can_guess_groups = ?'); params.push(canGuessGroups); }
    if (nextRole !== null) {
      sets.push('role = ?'); params.push(nextRole);
      sets.push('is_admin = ?'); params.push(nextRole === 'admin' ? 1 : 0);
    }
    params.push(id);
    await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);

    const updated = await db.one(`
      SELECT u.id, u.email, u.name, u.phone_number, u.department, u.is_admin, u.can_guess_groups, u.role, u.created_at,
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
    if (!await ensureCanManageTarget(req, res, id)) return;

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
    if (!await ensureCanManageTarget(req, res, id)) return;
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

// ────────── ניהול תגי הישג ──────────
// מחזיר את הקונפיגורציה הפעילה (ברירות מחדל ממוזגות עם השמור) + רשימת מזהי התגים.
router.get('/badges', async (req, res) => {
  try {
    const config = await loadBadgeConfig();
    res.json({ config, defaults: DEFAULT_BADGE_CONFIG, ids: Object.keys(DEFAULT_BADGE_CONFIG.badges) });
  } catch (e) {
    console.error('admin/badges/get:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.post('/badges', async (req, res) => {
  try {
    const incoming = req.body || {};
    // מיזוג בטוח על-גבי ברירות המחדל — שומר רק שדות מוכרים
    const merged = { badges: {}, thresholds: { ...DEFAULT_BADGE_CONFIG.thresholds } };
    for (const id of Object.keys(DEFAULT_BADGE_CONFIG.badges)) {
      const d = DEFAULT_BADGE_CONFIG.badges[id];
      const inc = (incoming.badges || {})[id] || {};
      merged.badges[id] = {
        enabled: inc.enabled === undefined ? d.enabled : !!inc.enabled,
        emoji: (typeof inc.emoji === 'string' && inc.emoji.trim()) ? inc.emoji.trim().slice(0, 8) : d.emoji
      };
    }
    const th = incoming.thresholds || {};
    for (const k of Object.keys(DEFAULT_BADGE_CONFIG.thresholds)) {
      const n = Number(th[k]);
      if (Number.isFinite(n) && n >= 0) merged.thresholds[k] = Math.trunc(n);
    }
    await db.run(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      ['badges_config', JSON.stringify(merged)]
    );
    res.json({ ok: true, config: merged });
  } catch (e) {
    console.error('admin/badges/set:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

router.post('/send-emails', upload.array('attachments', 6), async (req, res) => {
  try {
    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();
    const includeLoginDetails = String(req.body?.include_login_details || '') === '1';
    const department = String(req.body?.department || '').trim();

    let recipientIds = [];
    try {
      recipientIds = JSON.parse(String(req.body?.recipient_ids || '[]'));
    } catch {
      recipientIds = [];
    }

    if (!subject || !body) {
      return res.status(400).json({ error: 'יש להזין כותרת ותוכן הודעה' });
    }

    const smtpSettings = await readSettingsMap([
      'smtp_server',
      'smtp_port',
      'smtp_security',
      'smtp_user',
      'smtp_password',
      'site_url',
      'smtp_manager_email',
      'email_user_delivery_mode',
      'gmail_app_user',
      'gmail_app_password'
    ]);
    const userDeliveryMode = resolveUserDeliveryMode(smtpSettings);
    assertSmtpSettings(smtpSettings);
    if (userDeliveryMode === 'gmail') assertGmailSettings(smtpSettings);

    const reportTransporter = nodemailer.createTransport(buildTransportConfig(smtpSettings));
    const userTransporter = userDeliveryMode === 'gmail'
      ? nodemailer.createTransport(buildGmailTransportConfig(smtpSettings))
      : reportTransporter;
    const userSenderEmail = userDeliveryMode === 'gmail'
      ? String(smtpSettings.gmail_app_user || '').trim()
      : String(smtpSettings.smtp_user || '').trim();
    const reportSenderEmail = String(smtpSettings.smtp_user || '').trim();

    const filters = ['is_admin = 0'];
    const params = [];
    if (recipientIds.length) {
      const cleanIds = recipientIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
      if (!cleanIds.length) {
        return res.status(400).json({ error: 'לא נבחרו נמענים תקינים' });
      }
      filters.push(`id IN (${cleanIds.map(() => '?').join(',')})`);
      params.push(...cleanIds);
    }
    if (department) {
      filters.push('department = ?');
      params.push(department);
    }

    const recipients = await db.query(`
      SELECT id, email, name, phone_number, department
      FROM users
      WHERE ${filters.join(' AND ')}
      ORDER BY department ASC, name ASC, id ASC
    `, params);

    if (!recipients.length) {
      return res.status(400).json({ error: 'לא נמצאו נמענים לשליחה' });
    }

    const attachments = (req.files || []).map((file) => ({
      filename: file.originalname || 'attachment',
      content: file.buffer,
      contentType: file.mimetype || undefined
    }));
    const attachmentMeta = (req.files || []).map((file) => ({
      filename: file.originalname || 'attachment',
      size: file.size || file.buffer?.length || 0,
      mimeType: file.mimetype || ''
    }));

    const campaign = await db.run(`
      INSERT INTO email_campaigns (
        created_by_user_id, subject, body, include_login_details, department_filter,
        recipient_count, attachments_json, user_delivery_mode, sender_email, manager_email
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.user?.id || null,
      subject,
      body,
      includeLoginDetails ? 1 : 0,
      department || null,
      recipients.length,
      JSON.stringify(attachmentMeta),
      userDeliveryMode,
      userSenderEmail || null,
      String(smtpSettings.smtp_manager_email || '').trim() || null
    ]);
    const campaignId = campaign?.insertId || campaign?.lastID;

    for (const recipient of recipients) {
      await db.run(`
        INSERT INTO email_campaign_recipients (
          campaign_id, user_id, recipient_name, recipient_email, recipient_phone, recipient_department, status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `, [
        campaignId,
        recipient.id || null,
        recipient.name || null,
        recipient.email,
        recipient.phone_number || null,
        recipient.department || null
      ]);
    }

    const sent = [];
    const failed = [];
    for (const recipient of recipients) {
      const extraLines = [];
      const siteUrl = String(smtpSettings.site_url || '').trim();
      if (includeLoginDetails) {
        if (siteUrl) extraLines.push(`כתובת האתר: ${siteUrl}`);
        extraLines.push(`שם משתמש: ${recipient.email}`);
        extraLines.push(`סיסמה: ${recipient.phone_number || 'לא מוגדר מספר טלפון למשתמש זה'}`);
      }

      try {
        await userTransporter.sendMail({
          from: userSenderEmail,
          to: recipient.email,
          subject,
          text: [body, ...extraLines].join('\n\n'),
          html: buildEmailHtml(body, extraLines),
          attachments
        });
        sent.push(recipient.email);
        await db.run(`
          UPDATE email_campaign_recipients
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error_message = NULL
          WHERE campaign_id = ? AND recipient_email = ?
        `, [campaignId, recipient.email]);
      } catch (error) {
        failed.push({ email: recipient.email, error: error.message });
        await db.run(`
          UPDATE email_campaign_recipients
          SET status = 'failed', error_message = ?
          WHERE campaign_id = ? AND recipient_email = ?
        `, [String(error.message || 'send failed').slice(0, 4000), campaignId, recipient.email]);
      }
    }

    const managerEmail = String(smtpSettings.smtp_manager_email || '').trim();
    let managerReportSent = false;
    if (managerEmail) {
      const summaryLines = [
        `כותרת: ${subject}`,
        `נשלח ל-${sent.length} משתמשים`,
        `נמענים: ${sent.join(', ') || 'אין'}`,
        includeLoginDetails ? 'נכללו פרטי התחברות: כן' : 'נכללו פרטי התחברות: לא',
        `ספק שליחה למשתמשים: ${userDeliveryMode === 'gmail' ? 'Gmail' : 'SMTP'}`
      ];
      if (failed.length) {
        summaryLines.push(`נכשלו: ${failed.length}`);
        summaryLines.push(`שגיאות: ${failed.map((item) => `${item.email} (${item.error})`).join(', ')}`);
      }
      await reportTransporter.sendMail({
        from: reportSenderEmail,
        to: managerEmail,
        subject: `דוח שליחה: ${subject}`,
        text: `${summaryLines.join('\n')}\n\nתוכן ההודעה:\n${body}`,
        html: buildEmailHtml(body, summaryLines)
      });
      managerReportSent = true;
    }

    await db.run(
      'UPDATE email_campaigns SET recipient_count = ?, manager_report_sent = ? WHERE id = ?',
      [sent.length, managerReportSent ? 1 : 0, campaignId]
    );
    try {
      await appendEmailSendLog({
        created_at: new Date().toISOString(),
        campaign_id: campaignId,
        created_by_user_id: req.user?.id || null,
        subject,
        body,
        include_login_details: includeLoginDetails,
        department_filter: department || null,
        user_delivery_mode: userDeliveryMode,
        sender_email: userSenderEmail,
        manager_email: managerEmail || null,
        sent_count: sent.length,
        failed_count: failed.length,
        recipients: recipients.map((recipient) => ({
          id: recipient.id,
          name: recipient.name,
          email: recipient.email,
          phone_number: recipient.phone_number || null,
          department: recipient.department || null,
          status: sent.includes(recipient.email) ? 'sent' : 'failed'
        })),
        attachments: attachmentMeta
      });
    } catch (logError) {
      console.error('admin/send-emails/log:', logError);
    }

    res.json({
      ok: true,
      sent: sent.length,
      failed: failed.length,
      recipients: sent,
      failed_recipients: failed,
      campaign_id: campaignId,
      delivery_mode: userDeliveryMode
    });
  } catch (e) {
    console.error('admin/send-emails:', e);
    res.status(500).json({ error: `שליחת האימיילים נכשלה: ${e.message}` });
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
