// קובץ ראשי של שרת מערכת ניחושי המונדיאל 2026 (MySQL 8)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const { runDailyUpdate } = require('./services/scraper');
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
app.use('/api/guess-groups', require('./routes/guess-groups'));
app.use('/api/leaderboard',  require('./routes/leaderboard'));
app.use('/api/admin',        require('./routes/admin'));

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
