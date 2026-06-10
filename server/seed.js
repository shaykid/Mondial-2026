#!/usr/bin/env node
// אכלוס מסד הנתונים בנתוני המונדיאל וביצירת משתמש מנהל ראשוני (MySQL 8)
// בטוח להרצה חוזרת - משתמש ב-ON DUPLICATE KEY UPDATE

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const teams = require('./data/teams');
const matches = require('./data/matches');
const { DEFAULT_DEPARTMENTS } = require('./lib/departments');
const { upsertPlayers, players } = require('./lib/players-catalog');
const { seedScheduleItems, scheduleDefaults } = require('./lib/schedule-items');
const { seedFooterDocuments, footerDocumentDefaults } = require('./lib/footer-content');
const { seedTranslations, translations } = require('./lib/translations');

// ממיר ISO UTC ('2026-06-11T19:00:00Z') לפורמט DATETIME של MySQL ('2026-06-11 19:00:00')
function isoToMysql(iso) {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

async function seed() {
  console.log('🌍 אכלוס מסד הנתונים של מונדיאל 2026...');

  try {
    await db.ping();
  } catch (e) {
    console.error('✗ אין גישה למסד הנתונים. הרץ קודם: npm run db:create && npm run db:init');
    console.error('   הודעה:', e.message);
    process.exit(1);
  }

  // ─────────── קבוצות ───────────
  await db.tx(async (t) => {
    for (const x of teams) {
      await t.run(`
        INSERT INTO teams (code, name_en, name_he, group_letter)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name_en      = VALUES(name_en),
          name_he      = VALUES(name_he),
          group_letter = VALUES(group_letter)
      `, [x.code, x.en, x.he, x.group]);
    }
  });
  console.log(`   ✓ ${teams.length} קבוצות נטענו`);

  // ─────────── משחקים ───────────
  await db.tx(async (t) => {
    for (const m of matches) {
      await t.run(`
        INSERT INTO matches (id, stage, group_letter, home_code, away_code, kickoff, venue, status)
        VALUES (?, 'group', ?, ?, ?, ?, ?, 'scheduled')
        ON DUPLICATE KEY UPDATE
          group_letter = VALUES(group_letter),
          home_code    = VALUES(home_code),
          away_code    = VALUES(away_code),
          kickoff      = VALUES(kickoff),
          venue        = VALUES(venue)
      `, [m.id, m.group, m.home, m.away, isoToMysql(m.kickoff), m.venue]);
    }
  });
  console.log(`   ✓ ${matches.length} משחקים נטענו`);

  // ─────────── שחקנים ───────────
  await db.tx(async (t) => {
    await upsertPlayers(t);
  });
  console.log(`   ✓ ${players.length} שחקנים נטענו`);

  // ─────────── לוז ופרסים ───────────
  await db.tx(async (t) => {
    await seedScheduleItems(t);
  });
  console.log(`   ✓ ${scheduleDefaults.length} שורות לוז ופרסים נטענו`);

  // ─────────── מסמכי פוטר ───────────
  await db.tx(async (t) => {
    await seedFooterDocuments(t);
  });
  console.log(`   ✓ ${footerDocumentDefaults.length} מסמכי פוטר נטענו`);

  // ─────────── תרגומים ───────────
  await db.tx(async (t) => {
    await seedTranslations(t);
  });
  console.log(`   ✓ ${Object.keys(translations).length} מפתחות תרגום נטענו`);

  // ─────────── מנהל ראשוני ───────────
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@company.local').toLowerCase();
  const adminPass  = process.env.ADMIN_PASSWORD || 'changeme123';
  const exists = await db.one('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (!exists) {
    const hash = bcrypt.hashSync(adminPass, 10);
    await db.run(
      `INSERT INTO users (email, name, password_hash, preferred_language, is_admin, role) VALUES (?, ?, ?, 'he', 1, 'admin')`,
      [adminEmail, 'מנהל המערכת', hash]
    );
    console.log(`   ✓ נוצר משתמש מנהל: ${adminEmail} / ${adminPass}`);
    console.log('   ⚠️  אנא שנה את הסיסמה בהקדם!');
  } else {
    console.log(`   ✓ משתמש המנהל ${adminEmail} כבר קיים`);
  }

  // ─────────── הגדרות ברירת מחדל ───────────
  const settings = [
    ['scoring_exact',     '5'],
    ['scoring_result',    '3'],
    ['scoring_goal_diff', '1'],
    ['scoring_champion',  '20'],
    ['scoring_runner_up', '10'],
    ['scoring_top_scorer','15'],
    ['lock_hours_before', process.env.LOCK_HOURS_BEFORE || '1'],
    ['scraper_mode',      process.env.SCRAPER_MODE || 'manual'],
    // ניחוש קבוצתי — גבולות הניתנים לשינוי בלוח הניהול
    ['group_max_per_user',   '8'],
    ['group_max_members',    '5'],
    ['group_entry_cost_max', '5'],
    ['group_multiplier_cap', '5'],
    ['site_guess_groups_enabled', process.env.SITE_GUESS_GROUPS_ENABLED || 'false'],
    ['departments',       JSON.stringify(DEFAULT_DEPARTMENTS)],
    ['site_url',          process.env.SITE_URL || 'http://localhost:5225'],
    ['smtp_server',       process.env.SMTP_SERVER || 'smtp.inbox.co.il'],
    ['smtp_port',         process.env.SMTP_PORT || '587'],
    ['smtp_security',     process.env.SMTP_SECURITY || 'STARTTLS'],
    ['smtp_user',         process.env.SMTP_USER || 'mon2026@reports.seach.co.il'],
    ['smtp_password',     process.env.SMTP_PASSWORD || '^kdebr%cuNZ65Z'],
    ['smtp_manager_email', process.env.SMTP_MANAGER_EMAIL || 'aviva@seach.co.il'],
    ['email_user_delivery_mode', process.env.EMAIL_USER_DELIVERY_MODE || 'smtp'],
    ['gmail_from_email',   process.env.GMAIL_FROM_EMAIL || process.env.GMAIL_USER || ''],
    ['gmail_client_id',    process.env.GMAIL_CLIENT_ID || ''],
    ['gmail_client_secret', process.env.GMAIL_CLIENT_SECRET || ''],
    ['gmail_refresh_token', process.env.GMAIL_REFRESH_TOKEN || ''],
    ['gmail_access_token', process.env.GMAIL_ACCESS_TOKEN || '']
  ];
  // INSERT IGNORE - אם המנהל כבר ערך הגדרה ידנית, נשמר ערכו הקיים.
  for (const [k, v] of settings) {
    await db.run('INSERT IGNORE INTO settings (`key`, `value`) VALUES (?, ?)', [k, v]);
  }
  console.log('   ✓ הגדרות מערכת נטענו');

  console.log('\n✅ אכלוס הושלם בהצלחה!\n');
}

seed()
  .then(() => process.exit(0))
  .catch(e => { console.error('✗ שגיאה:', e.message); process.exit(1); });
