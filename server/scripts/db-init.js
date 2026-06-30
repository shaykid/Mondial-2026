#!/usr/bin/env node
// scripts/db-init.js
// מריץ את כל ה-CREATE TABLE IF NOT EXISTS מתוך ../schema.js.
// בטוח להרצה חוזרת.

require('dotenv').config();
const db = require('../db');
const schema = require('../schema');

async function main() {
  console.log('🛠️  יוצר טבלאות (אם לא קיימות)...');
  try {
    await db.ping();
  } catch (e) {
    console.error('✗ אין גישה ל-DATABASE. הרץ קודם: npm run db:create');
    console.error('   הודעה:', e.message);
    process.exit(1);
  }
  for (const ddl of schema) {
    await db.query(ddl);
    const tableName = (ddl.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/) || [])[1] || '?';
    console.log(`   ✓ ${tableName}`);
  }
  const phoneCol = await db.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'phone_number'
  `);
  if (!phoneCol.n) {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN phone_number VARCHAR(32) NULL AFTER name
    `);
    console.log('   ✓ users.phone_number');
  }
  const deptCol = await db.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'department'
  `);
  if (!deptCol.n) {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN department VARCHAR(120) NULL AFTER phone_number
    `);
    console.log('   ✓ users.department');
  }
  const profileImageCol = await db.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'profile_image_url'
  `);
  if (!profileImageCol.n) {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN profile_image_url VARCHAR(500) NULL AFTER phone_number
    `);
    console.log('   ✓ users.profile_image_url');
  }
  const passwordChangedCol = await db.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'password_changed'
  `);
  if (!passwordChangedCol.n) {
    await db.query(`
      ALTER TABLE users
      ADD COLUMN password_changed TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash
    `);
    console.log('   ✓ users.password_changed');
  }
  const topScorerPlayerCol = await db.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'special_predictions'
      AND column_name = 'top_scorer_player_id'
  `);
  if (!topScorerPlayerCol.n) {
    await db.query(`
      ALTER TABLE special_predictions
      ADD COLUMN top_scorer_player_id INT NULL AFTER runner_up_code
    `);
    console.log('   ✓ special_predictions.top_scorer_player_id');
  }
  // הרחבת settings.value ל-TEXT (הגדרות ארוכות כמו badges_config / departments)
  const settingsValueCol = await db.one(`
    SELECT DATA_TYPE FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'settings' AND column_name = 'value'
  `);
  if (settingsValueCol && settingsValueCol.DATA_TYPE && settingsValueCol.DATA_TYPE.toLowerCase() === 'varchar') {
    await db.query('ALTER TABLE settings MODIFY COLUMN `value` TEXT NULL');
    console.log('   ✓ settings.value → TEXT');
  }

  // הרשאת "ניחוש קבוצתי" למשתמש (ברירת מחדל: כבוי)
  await addColumnIfMissing('users', 'can_guess_groups',
    'ALTER TABLE users ADD COLUMN can_guess_groups TINYINT(1) NOT NULL DEFAULT 0 AFTER is_admin');

  // שם הקבוצה/מדינה בערבית (לתרגום שמות המדינות בכל משחק)
  await addColumnIfMissing('teams', 'name_ar',
    'ALTER TABLE teams ADD COLUMN name_ar VARCHAR(80) NULL AFTER name_he');

  // תפקיד משתמש: user / manager / admin (מנהל מערכת מלא מקבל admin)
  await addColumnIfMissing('users', 'role',
    "ALTER TABLE users ADD COLUMN role ENUM('user','manager','admin') NOT NULL DEFAULT 'user' AFTER can_guess_groups");
  // התאמה לאחור: מנהלי מערכת קיימים (is_admin=1) מקבלים role='admin'
  await db.query("UPDATE users SET role = 'admin' WHERE is_admin = 1 AND role <> 'admin'");

  // משתמש אורח (התחלת משחק לפני הרשמה מלאה)
  await addColumnIfMissing('users', 'is_guest',
    "ALTER TABLE users ADD COLUMN is_guest TINYINT(1) NOT NULL DEFAULT 0 AFTER role");

  // עמודות "ניחוש קבוצתי" (אם הטבלאות נוצרו בגרסה מוקדמת ללא עמודות אלה)
  await addColumnIfMissing('guess_groups', 'entry_cost',
    'ALTER TABLE guess_groups ADD COLUMN entry_cost INT NOT NULL DEFAULT 0 AFTER leader_user_id');
  await addColumnIfMissing('guess_group_members', 'paid_points',
    'ALTER TABLE guess_group_members ADD COLUMN paid_points INT NOT NULL DEFAULT 0 AFTER role');

  // שלבי נוקאאוט עם שמות placeholders עד שידועים זהויות הנבחרות
  await addColumnIfMissing('matches', 'home_label_he',
    'ALTER TABLE matches ADD COLUMN home_label_he VARCHAR(120) NULL AFTER away_code');
  await addColumnIfMissing('matches', 'home_label_en',
    'ALTER TABLE matches ADD COLUMN home_label_en VARCHAR(120) NULL AFTER home_label_he');
  await addColumnIfMissing('matches', 'home_label_ar',
    'ALTER TABLE matches ADD COLUMN home_label_ar VARCHAR(120) NULL AFTER home_label_en');
  await addColumnIfMissing('matches', 'away_label_he',
    'ALTER TABLE matches ADD COLUMN away_label_he VARCHAR(120) NULL AFTER home_label_ar');
  await addColumnIfMissing('matches', 'away_label_en',
    'ALTER TABLE matches ADD COLUMN away_label_en VARCHAR(120) NULL AFTER away_label_he');
  await addColumnIfMissing('matches', 'away_label_ar',
    'ALTER TABLE matches ADD COLUMN away_label_ar VARCHAR(120) NULL AFTER away_label_en');
  await makeColumnNullable('matches', 'home_code', 'VARCHAR(10) NULL');
  await makeColumnNullable('matches', 'away_code', 'VARCHAR(10) NULL');

  // מטבעות שהוענקו לכותב הריביו מהצבעות (×5 אם הניחוש היה מדויק)
  await addColumnIfMissing('match_reviews', 'coins_awarded',
    'ALTER TABLE match_reviews ADD COLUMN coins_awarded INT NOT NULL DEFAULT 0 AFTER status');

  // "פתוח לאתגרי ניחוש" — האם המשתמש גלוי לאתגור ע"י אחרים
  await addColumnIfMissing('coin_wallets', 'challenge_open',
    'ALTER TABLE coin_wallets ADD COLUMN challenge_open TINYINT(1) NOT NULL DEFAULT 0 AFTER balance');

  // תרגומי טקסט ריביו שמורים (תרגום פעם אחת ושמירה ב-DB)
  await addColumnIfMissing('match_reviews', 'body_en',
    'ALTER TABLE match_reviews ADD COLUMN body_en TEXT NULL AFTER body');
  await addColumnIfMissing('match_reviews', 'body_ar',
    'ALTER TABLE match_reviews ADD COLUMN body_ar TEXT NULL AFTER body_en');

  console.log('   ✓ הסכמה הוקמה בהצלחה');
}

// עזר: מוסיף עמודה רק אם הטבלה קיימת והעמודה חסרה
async function addColumnIfMissing(table, column, ddl) {
  const tbl = await db.one(`
    SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = ?
  `, [table]);
  if (!tbl.n) return; // הטבלה תיווצר ממילא עם כל העמודות מתוך schema.js
  const col = await db.one(`
    SELECT COUNT(*) AS n FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
  `, [table, column]);
  if (!col.n) {
    await db.query(ddl);
    console.log(`   ✓ ${table}.${column}`);
  }
}

async function makeColumnNullable(table, column, ddlType) {
  const tbl = await db.one(`
    SELECT COUNT(*) AS n FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name = ?
  `, [table]);
  if (!tbl.n) return;
  const col = await db.one(`
    SELECT IS_NULLABLE, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS max_len
    FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
  `, [table, column]);
  if (!col || String(col.IS_NULLABLE).toUpperCase() === 'YES') return;
  await db.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${ddlType}`);
  console.log(`   ✓ ${table}.${column} → NULL`);
}

main().then(() => process.exit(0)).catch(e => {
  console.error('✗ שגיאה ביצירת טבלאות:', e.message);
  process.exit(1);
});
