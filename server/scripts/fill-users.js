require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');

const FILE_PATH = process.env.USERS_FILE
  ? path.resolve(process.env.USERS_FILE)
  : path.join(__dirname, '..', 'data', 'site_users.tsv');

function normalizePhone(phone) {
  return String(phone || '').trim().replace(/\s+/g, '');
}

function normalizeText(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

function parseTSV(content) {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    rows.push({
      department: normalizeText(cols[0]),
      firstName: normalizeText(cols[1]),
      lastName: normalizeText(cols[2]),
      email: normalizeText(cols[3]).toLowerCase(),
      phone: normalizePhone(cols[4])
    });
  }
  return rows;
}

function generateEmailFromPhone(phone, seed = '') {
  const base = normalizePhone(phone).replace(/[^0-9-]/g, '') || `user${seed}`;
  return `${base}@seach.co.il`;
}

function randomPassword(len = 12) {
  return crypto.randomBytes(18).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, len);
}

async function run() {
  const col = await db.one(`
    SELECT COUNT(*) AS n
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'password_changed'
  `);
  if (!col?.n) {
    await db.query('ALTER TABLE users ADD COLUMN password_changed TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash');
  }

  const content = fs.readFileSync(FILE_PATH, 'utf8');
  const parsed = parseTSV(content);
  if (!parsed.length) {
    console.log('No rows found in TSV file.');
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let generatedEmails = 0;
  let duplicateResolved = 0;
  const importEmailSet = new Set();

  await db.tx(async (t) => {
    for (let i = 0; i < parsed.length; i += 1) {
      const row = parsed[i];
      const name = normalizeText(`${row.firstName} ${row.lastName}`);
      if (!name || !row.department) {
        skipped += 1;
        continue;
      }

      let email = row.email;
      if (!email) {
        email = generateEmailFromPhone(row.phone, String(i + 1));
        generatedEmails += 1;
      }

      if (importEmailSet.has(email)) {
        email = generateEmailFromPhone(row.phone, `${i + 1}-dup`);
        duplicateResolved += 1;
      }
      importEmailSet.add(email);

      const existing = await t.one('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        await t.run(
          'UPDATE users SET name = ?, phone_number = ?, department = ?, is_admin = 0 WHERE id = ?',
          [name, row.phone || null, row.department || null, existing.id]
        );
        updated += 1;
      } else {
        const passwordHash = bcrypt.hashSync(randomPassword(), 10);
        await t.run(
          'INSERT INTO users (email, name, phone_number, department, password_hash, password_changed, is_admin) VALUES (?, ?, ?, ?, ?, 0, 0)',
          [email, name, row.phone || null, row.department || null, passwordHash]
        );
        created += 1;
      }
    }

    const depRows = await t.query('SELECT department FROM users WHERE is_admin = 0 AND department IS NOT NULL AND department <> ""');
    const merged = Array.from(new Set(depRows.map((r) => normalizeText(r.department)).filter(Boolean)));
    await t.run(
      'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
      ['departments', JSON.stringify(merged)]
    );
  });

  console.log(`Import completed from: ${FILE_PATH}`);
  console.log(`Created: ${created}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Generated emails (missing): ${generatedEmails}`);
  console.log(`Duplicate emails resolved: ${duplicateResolved}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('fill-users failed:', err?.message || err);
    process.exit(1);
  });
