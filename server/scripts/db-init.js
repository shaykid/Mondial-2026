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
  console.log('   ✓ הסכמה הוקמה בהצלחה');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('✗ שגיאה ביצירת טבלאות:', e.message);
  process.exit(1);
});
