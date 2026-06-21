// דוח יומי: צילום (תמונת PNG) של "טבלת המצטיינים" ושליחתו במייל ל"מנהלת שליחות".
// התמונה נוצרת מתוך נתוני הטבלה (leaderboard) ומומרת ל-PNG דרך resvg עם גופן עברי מצורף,
// כך שאין תלות בדפדפן headless או בגופני-מערכת (עובד זהה על כל השרתים).

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { Resvg } = require('@resvg/resvg-js');
const db = require('../db');
const { leaderboard } = require('./scoring');
const { getShabbatState } = require('../lib/shabbat');

const FONT_PATH = path.join(__dirname, '..', 'assets', 'fonts', 'Alef-Regular.ttf');
const FONT_FAMILY = 'Alef';
const LEADERBOARD_REPORT_LIMIT = 10;
const USER_RESULTS_SETTING_KEYS = [
  'smtp_server', 'smtp_port', 'smtp_security', 'smtp_user', 'smtp_password',
  'smtp_manager_email', 'email_user_delivery_mode', 'gmail_app_user', 'gmail_app_password',
  'send_results_to_users', 'send_results_hour', 'send_results_audience', 'shabbat_mode'
];
const BADGE_ORDER = [
  'crown', 'leader', 'oracle', 'goal_machine', 'sharpshooter',
  'streak', 'perfectionist', 'dedicated', 'centurion', 'prophet'
];
const BADGE_META = {
  crown:         { emoji: '👑', name: 'מלך הניחושים', desc: 'מספר הניחושים המדויקים הגבוה ביותר' },
  leader:        { emoji: '🏆', name: 'המוביל', desc: 'מקום ראשון בטבלה' },
  oracle:        { emoji: '🧠', name: 'האורקל', desc: 'מספר הכיוונים הנכונים (1/X/2) הגבוה ביותר' },
  goal_machine:  { emoji: '⚽', name: 'מכונת שערים', desc: 'מספר ניחושי הפרש השערים הנכונים הגבוה ביותר' },
  sharpshooter:  { emoji: '🎯', name: 'צלף', desc: 'הדיוק הגבוה ביותר (נקודות לניחוש)' },
  streak:        { emoji: '🔥', name: 'רצף חם', desc: 'הרצף הפעיל הארוך ביותר של ניחושים מזכי-נקודות' },
  perfectionist: { emoji: '💎', name: 'פרפקציוניסט', desc: 'היחס הגבוה ביותר של ניחושים מדויקים' },
  dedicated:     { emoji: '🦅', name: 'החרוץ', desc: 'מספר הניחושים הרב ביותר שהוגשו' },
  centurion:     { emoji: '💯', name: 'מועדון ה-100', desc: '100 נקודות ומעלה' },
  prophet:       { emoji: '⭐', name: 'הנביא', desc: 'ניחוש מיוחד נכון (אלופה / סגן / מלך שערים)' }
};

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function readSettingsMap(keys) {
  if (!keys.length) return {};
  const rows = await db.query(
    `SELECT \`key\`, \`value\` FROM settings WHERE \`key\` IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

async function writeSetting(key, value) {
  await db.run(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [key, String(value)]
  );
}

function buildTransportConfig(s) {
  const security = String(s.smtp_security || 'STARTTLS').trim().toUpperCase();
  const port = Number(s.smtp_port || 587);
  const secure = security === 'SSL' || security === 'SMTPS' || port === 465;
  return {
    host: String(s.smtp_server || '').trim(),
    port,
    secure,
    requireTLS: security === 'STARTTLS',
    auth: { user: String(s.smtp_user || '').trim(), pass: String(s.smtp_password || '') }
  };
}

function buildGmailTransportConfig(s) {
  return {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
      user: String(s.gmail_app_user || '').trim(),
      pass: String(s.gmail_app_password || '')
    }
  };
}

function resolveUserDeliveryMode(s) {
  return String(s.email_user_delivery_mode || 'smtp').trim().toLowerCase() === 'gmail' ? 'gmail' : 'smtp';
}

function assertSmtpSettings(s) {
  if (!s.smtp_server || !s.smtp_user || !s.smtp_password) {
    throw new Error('יש להגדיר תחילה פרטי SMTP בלשונית ההגדרות');
  }
}

function assertGmailSettings(s) {
  if (!String(s.gmail_app_user || '').trim() || !String(s.gmail_app_password || '').trim()) {
    throw new Error('יש להגדיר כתובת Gmail וסיסמת אפליקציה בלשונית ההגדרות');
  }
}

function friendlyMailError(message, mode) {
  const m = String(message || '');
  if (mode === 'gmail' && /Application-specific password|Username and Password not accepted|InvalidSecondFactor|BadCredentials|5\.7\.[89]/i.test(m)) {
    return 'התחברות ל-Gmail נכשלה: יש להשתמש ב"סיסמת אפליקציה" (App Password) בת 16 תווים מחשבון Google עם אימות דו-שלבי פעיל.';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|certificate/i.test(m)) {
    return 'לא ניתן להתחבר לשרת הדואר (בדקו כתובת, פורט, אבטחה או חיבור לרשת)';
  }
  return m || 'send failed';
}

function isTruthySetting(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function normalizeBadgeList(badges) {
  if (!Array.isArray(badges) || !badges.length) return [];
  const byId = new Map();
  for (const badge of badges) {
    if (typeof badge === 'string') {
      byId.set(badge, { id: badge, emoji: BADGE_META[badge]?.emoji || '•' });
    } else if (badge && badge.id) {
      byId.set(badge.id, {
        id: badge.id,
        emoji: badge.emoji || BADGE_META[badge.id]?.emoji || '•'
      });
    }
  }
  return BADGE_ORDER.filter((id) => byId.has(id)).map((id) => byId.get(id));
}

function badgeEmojiText(badges) {
  const ordered = normalizeBadgeList(badges);
  return ordered.length ? ordered.map((b) => b.emoji).join(' ') : '—';
}

function badgeHtmlPills(badges) {
  const ordered = normalizeBadgeList(badges);
  if (!ordered.length) return '<span style="color:#8aa69a">—</span>';
  return ordered.map((b) => {
    const meta = BADGE_META[b.id] || {};
    const title = `${meta.name || b.id}${meta.desc ? ` — ${meta.desc}` : ''}`;
    return `<span title="${xmlEscape(title)}" style="display:inline-block;margin:0 3px 4px 0;padding:2px 6px;border-radius:999px;background:#ffffff14;border:1px solid #2d6e3e;font-size:15px;line-height:1">${xmlEscape(b.emoji)}</span>`;
  }).join('');
}

function buildSummaryTable(rows) {
  const bodyRows = rows.map((row) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #d8e7dd;text-align:center;font-weight:700;color:#0b3d2e">${row.rank}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #d8e7dd;color:#0b3d2e">${xmlEscape(row.name)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #d8e7dd">${badgeHtmlPills(row.badges)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #d8e7dd;text-align:center;font-weight:700;color:#0b3d2e">${row.total_points}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #d8e7dd;text-align:center;color:#0b3d2e">${row.exact_hits}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #d8e7dd;text-align:center;color:#0b3d2e">${row.num_predictions}</td>
    </tr>
  `).join('');
  return `
    <table dir="rtl" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:16px;background:#f7fbf8;border:1px solid #d8e7dd;border-radius:10px;overflow:hidden">
      <thead>
        <tr style="background:#e8f3eb">
          <th style="padding:10px;border-bottom:1px solid #d8e7dd;text-align:center">מקום</th>
          <th style="padding:10px;border-bottom:1px solid #d8e7dd;text-align:right">שם</th>
          <th style="padding:10px;border-bottom:1px solid #d8e7dd;text-align:right">תגי הישג</th>
          <th style="padding:10px;border-bottom:1px solid #d8e7dd;text-align:center">נק׳</th>
          <th style="padding:10px;border-bottom:1px solid #d8e7dd;text-align:center">מדויקים</th>
          <th style="padding:10px;border-bottom:1px solid #d8e7dd;text-align:center">ניחושים</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function buildLeaderboardEmailHtml({ dateLabel, topRows, intro, showImage = true, footerText = '' }) {
  const footer = footerText
    ? `<p style="margin-top:18px;padding-top:12px;border-top:1px solid #d8e7dd;color:#0b3d2e;font-size:13px">
        ${xmlEscape(footerText).replace(/\n/g, '<br />')}
      </p>`
    : '';
  return `<div dir="rtl" style="font-family:Arial,sans-serif">
    <p>${intro} נכון לתאריך ${xmlEscape(dateLabel)}.</p>
    ${showImage ? '<img src="cid:leaderboard" alt="טבלת המצטיינים" style="max-width:100%;border-radius:8px"/>' : ''}
    ${buildSummaryTable(topRows)}
    ${footer}
  </div>`;
}

// בונה SVG של טבלת המצטיינים (RTL) מתוך שורות הדירוג
function buildLeaderboardSvg(rows, dateLabel, limit) {
  const top = rows.slice(0, limit);
  const W = 1120;
  const rowH = 58;
  const headTop = 138;
  const H = headTop + rowH * (top.length + 1) + 28;

  // עמודות (קואורדינטות x), כותרות מימין לשמאל
  const X_RANK = 1040;  // מקום
  const X_NAME = 1000;  // שם (יישור לימין, גדל שמאלה)
  const X_BADGES = 620; // תגי הישג
  const X_PTS = 430;    // נקודות
  const X_EXACT = 270;  // ניחושים מדויקים
  const X_PRED = 120;   // סה״כ ניחושים

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#0b3d2e"/>`);
  parts.push(`<rect x="0" y="0" width="${W}" height="96" fill="#08311f"/>`);
  parts.push(`<text x="28" y="28" font-family="${FONT_FAMILY}" font-size="16" fill="#cfe8d8" text-anchor="start">בס"ד</text>`);
  parts.push(`<text x="${W - 30}" y="50" font-family="${FONT_FAMILY}" font-size="34" font-weight="bold" fill="#ffd700" text-anchor="end">טבלת המצטיינים</text>`);
  parts.push(`<text x="${W - 30}" y="80" font-family="${FONT_FAMILY}" font-size="18" fill="#cfe8d8" text-anchor="end">מונדיאל 2026 · ${xmlEscape(dateLabel)}</text>`);

  // כותרות עמודות
  const hy = headTop;
  parts.push(`<text x="${X_RANK}" y="${hy}" font-family="${FONT_FAMILY}" font-size="18" fill="#ffd700" text-anchor="middle">מקום</text>`);
  parts.push(`<text x="${X_NAME}" y="${hy}" font-family="${FONT_FAMILY}" font-size="18" fill="#ffd700" text-anchor="end">שם</text>`);
  parts.push(`<text x="${X_BADGES}" y="${hy}" font-family="${FONT_FAMILY}" font-size="18" fill="#ffd700" text-anchor="end">תגי הישג</text>`);
  parts.push(`<text x="${X_PTS}" y="${hy}" font-family="${FONT_FAMILY}" font-size="18" fill="#ffd700" text-anchor="middle">נק׳</text>`);
  parts.push(`<text x="${X_EXACT}" y="${hy}" font-family="${FONT_FAMILY}" font-size="18" fill="#ffd700" text-anchor="middle">מדויקים</text>`);
  parts.push(`<text x="${X_PRED}" y="${hy}" font-family="${FONT_FAMILY}" font-size="18" fill="#ffd700" text-anchor="middle">ניחושים</text>`);
  parts.push(`<line x1="20" y1="${hy + 12}" x2="${W - 20}" y2="${hy + 12}" stroke="#2d6e3e" stroke-width="2"/>`);

  top.forEach((r, i) => {
    const y = headTop + rowH * (i + 1) + 18;
    const cy = y - 14;
    if (i % 2 === 0) parts.push(`<rect x="14" y="${cy}" width="${W - 28}" height="${rowH}" fill="#ffffff10"/>`);
    const rankColor = r.rank === 1 ? '#ffd700' : r.rank === 2 ? '#c0c0c0' : r.rank === 3 ? '#cd7f32' : '#ffffff';
    parts.push(`<text x="${X_RANK}" y="${y}" font-family="${FONT_FAMILY}" font-size="22" font-weight="bold" fill="${rankColor}" text-anchor="middle">${r.rank}</text>`);
    parts.push(`<text x="${X_NAME}" y="${y}" font-family="${FONT_FAMILY}" font-size="21" fill="#ffffff" text-anchor="end" textLength="330" lengthAdjust="spacingAndGlyphs">${xmlEscape(r.name)}</text>`);
    parts.push(`<text x="${X_BADGES}" y="${y}" font-family="${FONT_FAMILY}" font-size="18" fill="#d8f7df" text-anchor="end">${xmlEscape(badgeEmojiText(r.badges))}</text>`);
    parts.push(`<text x="${X_PTS}" y="${y}" font-family="${FONT_FAMILY}" font-size="22" font-weight="bold" fill="#7CFC9A" text-anchor="middle">${r.total_points}</text>`);
    parts.push(`<text x="${X_EXACT}" y="${y}" font-family="${FONT_FAMILY}" font-size="20" fill="#cfe8d8" text-anchor="middle">${r.exact_hits}</text>`);
    parts.push(`<text x="${X_PRED}" y="${y}" font-family="${FONT_FAMILY}" font-size="20" fill="#cfe8d8" text-anchor="middle">${r.num_predictions}</text>`);
  });

  parts.push('</svg>');
  return parts.join('\n');
}

// יוצר PNG (Buffer) של טבלת המצטיינים
async function renderLeaderboardPng(limit = LEADERBOARD_REPORT_LIMIT, rows = null) {
  const board = rows || await leaderboard();
  const topRows = board.slice(0, limit);
  const dateLabel = new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date());
  const svg = buildLeaderboardSvg(board, dateLabel, limit);
  const fontBuffer = fs.readFileSync(FONT_PATH);
  const resvg = new Resvg(svg, {
    font: { fontBuffers: [fontBuffer], defaultFontFamily: FONT_FAMILY, loadSystemFonts: false },
    background: '#0b3d2e'
  });
  return { png: resvg.render().asPng(), dateLabel, count: board.length, topRows };
}

// מפיק ושולח את הדוח ל"מנהלת שליחות" (smtp_manager_email) דרך SMTP
async function sendLeaderboardReport() {
  const s = await readSettingsMap([
    'smtp_server', 'smtp_port', 'smtp_security', 'smtp_user', 'smtp_password', 'smtp_manager_email', 'shabbat_mode'
  ]);
  if (!s.smtp_server || !s.smtp_user || !s.smtp_password) {
    throw new Error('חסרים פרטי SMTP בהגדרות');
  }
  const manager = String(s.smtp_manager_email || '').trim();
  if (!manager) throw new Error('לא הוגדרה כתובת "מנהלת שליחות" (smtp_manager_email)');
  if (isTruthySetting(s.shabbat_mode)) {
    const shabbat = await getShabbatState('Asia/Jerusalem');
    if (shabbat.active || shabbat.error) return { skipped: shabbat.error ? 'shabbat_unavailable' : 'shabbat' };
  }

  const rows = await leaderboard();
  const { png, dateLabel, count, topRows } = await renderLeaderboardPng(LEADERBOARD_REPORT_LIMIT, rows);
  const transporter = nodemailer.createTransport(buildTransportConfig(s));
  const fileDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const filename = `leaderboard-${fileDate}.png`;

  await transporter.sendMail({
    from: String(s.smtp_user || '').trim(),
    to: manager,
    subject: `טבלת המצטיינים — דוח יומי (${dateLabel})`,
    text: `מצורפת תמונת טבלת המצטיינים, כולל 10 המובילים ותגי ההישג שלהם, נכון לתאריך ${dateLabel}.`,
    html: buildLeaderboardEmailHtml({
      dateLabel,
      topRows,
      intro: 'מצורפת תמונת <strong>טבלת המצטיינים</strong> של 10 המובילים, כולל <strong>תגי הישג</strong>',
      showImage: true
    }),
    attachments: [{ filename, content: png, contentType: 'image/png', cid: 'leaderboard' }]
  });

  return { to: manager, count, dateLabel };
}

async function getUserRecipients(board, audience) {
  const mode = String(audience || 'all').trim().toLowerCase();
  let ids = null;

  if (mode === 'top10') {
    ids = board.slice(0, LEADERBOARD_REPORT_LIMIT).map((row) => row.id);
  } else if (mode === 'guessers' || mode === 'all_that_has_guesses' || mode === 'with_guesses') {
    ids = board.filter((row) => Number(row.num_predictions || 0) > 0).map((row) => row.id);
  } else {
    return db.query(`
      SELECT id, email, name
      FROM users
      WHERE is_admin = 0 AND is_guest = 0
      ORDER BY name ASC, id ASC
    `);
  }

  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.query(`
    SELECT id, email, name
    FROM users
    WHERE id IN (${placeholders})
  `, ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

async function sendUserResultsReport() {
  const s = await readSettingsMap(USER_RESULTS_SETTING_KEYS);
  if (!isTruthySetting(s.send_results_to_users)) {
    return { skipped: 'disabled' };
  }
  if (!s.smtp_server || !s.smtp_user || !s.smtp_password) {
    throw new Error('חסרים פרטי SMTP בהגדרות');
  }
  if (isTruthySetting(s.shabbat_mode)) {
    const shabbat = await getShabbatState('Asia/Jerusalem');
    if (shabbat.active || shabbat.error) return { skipped: shabbat.error ? 'shabbat_unavailable' : 'shabbat' };
  }

  const userDeliveryMode = resolveUserDeliveryMode(s);
  assertSmtpSettings(s);
  if (userDeliveryMode === 'gmail') assertGmailSettings(s);

  const board = await leaderboard();
  const recipients = await getUserRecipients(board, s.send_results_audience || 'all');
  if (!recipients.length) return { skipped: 'no_recipients' };

  const transporter = userDeliveryMode === 'gmail'
    ? nodemailer.createTransport(buildGmailTransportConfig(s))
    : nodemailer.createTransport(buildTransportConfig(s));
  const fromEmail = userDeliveryMode === 'gmail'
    ? String(s.gmail_app_user || '').trim()
    : String(s.smtp_user || '').trim();

  const { png, dateLabel, topRows } = await renderLeaderboardPng(LEADERBOARD_REPORT_LIMIT, board);
  const fileDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const filename = `leaderboard-${fileDate}.png`;

  const sent = [];
  const failed = [];
  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: fromEmail,
        to: recipient.email,
        subject: 'תוצאות ניחושי המונדיאל - קבוצת שיח',
        text: [
          `מצורפת תמונת טבלת המצטיינים של 10 המובילים, כולל תגי הישג, נכון לתאריך ${dateLabel}.`,
          '',
          'לכניסה לאתר - www.mon2026.seach.co.il'
        ].join('\n'),
        html: buildLeaderboardEmailHtml({
          dateLabel,
          topRows,
          intro: 'מצורפת תמונת <strong>טבלת המצטיינים</strong> של 10 המובילים, כולל <strong>תגי הישג</strong>',
          showImage: true,
          footerText: 'לכניסה לאתר - www.mon2026.seach.co.il'
        }),
        attachments: [{ filename, content: png, contentType: 'image/png', cid: 'leaderboard' }]
      });
      sent.push(recipient.email);
    } catch (error) {
      failed.push({ email: recipient.email, error: friendlyMailError(error.message, userDeliveryMode) });
    }
  }

  return {
    sent: sent.length,
    failed: failed.length,
    recipients: sent,
    failed_recipients: failed,
    audience: String(s.send_results_audience || 'all').trim().toLowerCase() || 'all',
    dateLabel
  };
}

module.exports = {
  renderLeaderboardPng,
  sendLeaderboardReport,
  sendUserResultsReport,
  buildLeaderboardSvg
};
