// קובץ ראשי של שרת מערכת ניחושי המונדיאל 2026 (MySQL 8)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { runDailyUpdate } = require('./services/scraper');
const { sendLeaderboardReport, sendUserResultsReport } = require('./services/leaderboard-report');
const { sendNextDayPredictionEmails, sendPrematchPredictionEmails } = require('./services/prediction-reminders');
const { getDatePartsInTz, getShabbatState } = require('./lib/shabbat');
const { activeThemeAssetsDir, themeDir, DEFAULT_THEME, activeThemeName } = require('./lib/themes');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/data', express.static(path.join(__dirname, '..', 'data')));
app.use('/docs', express.static(path.join(__dirname, '..', 'docs')));

// נכסי ערכת הנושא: קודם הערכה הפעילה, ואז ברירת המחדל (seach) כנפילה לכל נכס חסר
app.use('/theme-assets', express.static(activeThemeAssetsDir()));
app.use('/theme-assets', express.static(themeDir(DEFAULT_THEME)));
console.log(`🎨 ערכת נושא פעילה: ${activeThemeName()}`);

// נתיבי API
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/news',         require('./routes/news'));
app.use('/api/site',         require('./routes/site'));
app.use('/api',              require('./routes/matches'));
app.use('/api/schedule',     require('./routes/schedule'));
app.use('/api/predictions',  require('./routes/predictions'));
app.use('/api/reviews',      require('./routes/reviews'));
app.use('/api/guess-groups', require('./routes/guess-groups'));
app.use('/api/coin-bets',    require('./routes/coin-bets'));
app.use('/api/team-reviews', require('./routes/team-reviews'));
app.use('/api/leaderboard',  require('./routes/leaderboard'));
app.use('/api/admin',        require('./routes/admin'));

async function readSettingsMap(keys) {
  if (!keys.length) return {};
  const rows = await db.query(
    `SELECT \`key\`, \`value\` FROM settings WHERE \`key\` IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

async function writeSetting(key, value) {
  await db.run(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [key, String(value)]
  );
}

function isTruthySetting(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

async function runScheduledEmailJobs() {
  const now = getDatePartsInTz('Asia/Jerusalem');
  if (now.minute !== 0) return;

  const settings = await readSettingsMap([
    'shabbat_mode',
    'leaderboard_report_last_sent_ymd',
    'send_results_to_users',
    'send_results_hour',
    'results_users_last_sent_ymd'
  ]);

  if (isTruthySetting(settings.shabbat_mode)) {
    const shabbat = await getShabbatState('Asia/Jerusalem');
    if (shabbat.active || shabbat.error) {
      console.log('⏸️  דוא״ל מתוזמן הושהה בגלל שבת בישראל');
      return;
    }
  }

  if (now.hour === 6 && settings.leaderboard_report_last_sent_ymd !== now.ymd) {
    console.log('⏰ שליחת דוח יומי של טבלת המצטיינים...');
    try {
      const result = await sendLeaderboardReport();
      if (result?.skipped) {
        console.log(`   ↷ דוח מנהל לא נשלח (${result.skipped})`);
      } else {
        await writeSetting('leaderboard_report_last_sent_ymd', now.ymd);
        console.log(`   ✓ נשלח ל-${result.to} (${result.count} משתתפים)`);
      }
    } catch (e) {
      console.error('   ✗ דוח מנהל נכשל:', e.message);
    }
  }

  if (isTruthySetting(settings.send_results_to_users)) {
    const rawSendHour = Number(settings.send_results_hour);
    const sendHour = Number.isInteger(rawSendHour) && rawSendHour >= 0 && rawSendHour <= 23 ? rawSendHour : 19;
    if (now.hour === sendHour && settings.results_users_last_sent_ymd !== now.ymd) {
      console.log('⏰ שליחת תוצאות למשתמשים...');
      try {
        const result = await sendUserResultsReport();
        if (result?.skipped) {
          console.log(`   ↷ תוצאות למשתמשים לא נשלחו (${result.skipped})`);
        } else {
          await writeSetting('results_users_last_sent_ymd', now.ymd);
          console.log(`   ✓ נשלחו ${result.sent} אימיילים למשתמשים (נכשלו: ${result.failed})`);
        }
      } catch (e) {
        console.error('   ✗ שליחת תוצאות למשתמשים נכשלה:', e.message);
      }
    }
  }
}

// בריאות
app.get('/api/health', async (req, res) => {
  try {
    await db.ping();
    res.json({ ok: true, db: 'mysql', t: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'db not reachable' });
  }
});

// הגשת ה-build של הלקוח אם קיים
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        // index.html לעולם לא נשמר במטמון — כך שאחרי deploy הדפדפן מקבל את ה-bundle העדכני
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        // נכסים עם hash בשם — מותר לאחסון ארוך-טווח
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ─────────── תזמון עדכון תוצאות ───────────
cron.schedule('0 4 * * *', () => {
  console.log('⏰ הפעלת עדכון יומי...');
  runDailyUpdate().catch(e => console.error(e));
});

cron.schedule('0 */2 * * *', () => {
  const now = new Date();
  if (now >= new Date('2026-06-11') && now <= new Date('2026-07-20')) {
    console.log('⏰ עדכון תקופתי במהלך הטורניר...');
    runDailyUpdate().catch(e => console.error(e));
  }
});

// ניחושי AI יומיים (05:00 שעון ישראל): מייצר ניחושים למשחקים החסרים ב-48 השעות הקרובות / 5 הקרובים
cron.schedule('0 5 * * *', () => {
  const now = new Date();
  if (now >= new Date('2026-06-08') && now <= new Date('2026-07-20')) {
    console.log('⏰ ייצור ניחושי AI יומי...');
    require('./services/aiPredictions').generateDaily()
      .then(r => console.log('   ✓ ניחושי AI:', JSON.stringify(r)))
      .catch(e => console.error('   ✗ ניחושי AI נכשלו:', e.message));
  }
}, { timezone: 'Asia/Jerusalem' });

// דוחות אימייל מתוזמנים: מנהל ב-06:00 ומשתמשים בשעה שהוגדרה בהגדרות
cron.schedule('* * * * *', () => {
  runScheduledEmailJobs().catch((e) => console.error('   ✗ דוחות מתוזמנים נכשלו:', e.message));
}, { timezone: 'Asia/Jerusalem' });

// תזכורת לילית (04:00 שעון ישראל): לכל מי שניחש משחקים של "מחר" — מייל עם הניחושים שלו
cron.schedule('0 4 * * *', () => {
  console.log('⏰ שליחת תזכורות ניחושים למשחקי מחר...');
  sendNextDayPredictionEmails()
    .then((r) => {
      if (r?.skipped) console.log(`   ↷ תזכורות מחר לא נשלחו (${r.skipped})`);
      else console.log(`   ✓ נשלחו ${r.sent} תזכורות מחר (נכשלו: ${r.failed})`);
    })
    .catch((e) => console.error('   ✗ תזכורות מחר נכשלו:', e.message));
}, { timezone: 'Asia/Jerusalem' });

// תזכורת 2.5 שעות לפני כל משחק: לכל מי שניחש את אותו משחק — מייל עם הניחוש שלו.
// רץ כל 5 דק׳ ובודק משחקים שחוצים את סף ה-2.5 שעות (עם דה-דופ פר-משחק).
cron.schedule('*/5 * * * *', () => {
  sendPrematchPredictionEmails()
    .then((r) => {
      if (r && !r.skipped && r.matches > 0) {
        console.log(`   ✓ תזכורות טרום-משחק: ${r.sent} נשלחו עבור ${r.matches} משחקים (נכשלו: ${r.failed})`);
      }
    })
    .catch((e) => console.error('   ✗ תזכורות טרום-משחק נכשלו:', e.message));
}, { timezone: 'Asia/Jerusalem' });

// פעילות אורגנית של בוטי סימולציה (כל 20 דק׳): בוטים פעילים מעדכנים ניחושים/ריביוים/לייקים
// בשליטת ההגדרה sim_organic_enabled (ברירת מחדל: פעיל). פועל רק על בוטים מאופשרים.
cron.schedule('*/20 * * * *', () => {
  require('./services/simulate').organicTick()
    .then((r) => { if (r && r.acted) console.log(`   🤖 פעילות בוטים אורגנית: ${r.acted} פעולות (${r.bots} בוטים)`); })
    .catch((e) => console.error('   ✗ פעילות בוטים נכשלה:', e.message));
}, { timezone: 'Asia/Jerusalem' });

// בוטים מגיבים להצעות הימור שקיבלו (אחרי A..B דק׳, לפי accept_rate) — כל 2 דק׳
cron.schedule('*/2 * * * *', () => {
  require('./services/simulate').acceptBetTick()
    .then((r) => { if (r && (r.accepted || r.rejected)) console.log(`   🤝 בוטים הגיבו להצעות: ${r.accepted} אושרו, ${r.rejected} נדחו`); })
    .catch((e) => console.error('   ✗ תגובת בוטים להצעות נכשלה:', e.message));
}, { timezone: 'Asia/Jerusalem' });

const PORT = process.env.PORT || 4026;

// המתנה לחיבור DB לפני האזנה
(async () => {
  try {
    await db.ping();
  } catch (e) {
    console.error('✗ לא ניתן להתחבר ל-MySQL:', e.message);
    console.error('   הרץ קודם: npm run db:setup (יוצר DB + טבלאות + סיד)');
    process.exit(1);
  }

  // ודא שטבלת sim_users קיימת — נתיבי הציבור (לוח, שיחים, ריביוים) מסננים לפיה
  try { await require('./services/simulate').ensureSchema(); } catch (e) { console.error('sim ensureSchema:', e.message); }
  // ודא עמודות תיעוד-כניסה (last_login_at) — נתיב הניהול מסתמך עליהן
  try {
    const col = await db.one("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'last_login_at'");
    if (!col?.n) { await db.run('ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL'); await db.run('ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(64) NULL'); }
  } catch (e) { console.error('last_login ensure:', e.message); }

  app.listen(PORT, () => {
    const mode = (process.env.SCRAPER_MODE || 'manual').padEnd(28);
    const dbLoc = db.config.socketPath
      ? `socket ${db.config.socketPath}`
      : `${db.config.host}:${db.config.port}`;
    console.log(`
  ╔═══════════════════════════════════════════════╗
  ║   🏆  מערכת ניחושי מונדיאל 2026  🏆          ║
  ║                                               ║
  ║   השרת פעיל על: http://localhost:${PORT}        ║
  ║   מסד נתונים: MySQL @ ${dbLoc.padEnd(20)}║
  ║   מצב סקרייפינג: ${mode}║
  ╚═══════════════════════════════════════════════╝
  `);
  });
})();
