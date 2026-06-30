#!/usr/bin/env node
// scripts/db-team-reviews.js
//   ברירת מחדל: טוען ביקורות נבחרת מתוך ../data/team-reviews-seed.json אל הטבלה team_reviews.
//   עם הארגומנט "export": מייצא את הביקורות הקיימות ב-DB אל קובץ ה-seed (לשימור הריצה האחרונה).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

const SEED_FILE = path.join(__dirname, '..', 'data', 'team-reviews-seed.json');

async function exportFromDb() {
  const rows = await db.query('SELECT team_code, payload FROM team_reviews ORDER BY team_code');
  fs.writeFileSync(SEED_FILE, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`✓ יוצאו ${rows.length} ביקורות נבחרת אל ${path.basename(SEED_FILE)}`);
}

async function loadToDb() {
  if (!fs.existsSync(SEED_FILE)) { console.log('ℹ אין קובץ seed — אין מה לטעון'); return; }
  const rows = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8') || '[]');
  let n = 0;
  for (const r of rows) {
    if (!r.team_code || !r.payload) continue;
    const payload = typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload);
    await db.run(
      `INSERT INTO team_reviews (team_code, payload, generated_at) VALUES (?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), generated_at = VALUES(generated_at)`,
      [r.team_code, payload]
    );
    n++;
  }
  console.log(`✓ נטענו ${n} ביקורות נבחרת אל ה-DB`);
}

(async () => {
  try {
    await db.ping();
    if (process.argv.includes('export')) await exportFromDb();
    else await loadToDb();
    process.exit(0);
  } catch (e) {
    console.error('✗ שגיאה:', e.message);
    process.exit(1);
  }
})();
