// תזכורות ניחושים בדוא״ל:
//   1) כל לילה (04:00 שעון ישראל) — לכל משתמש ששלח ניחושים למשחקי "מחר", מייל מרכז עם הניחושים שלו.
//   2) 2.5 שעות לפני תחילת משחק — לכל מי שניחש את אותו משחק, תזכורת עם הניחוש שלו.
//
// הערות זמן: עמודת matches.kickoff נשמרת כ-UTC נאיבי (db.js מוגדר timezone:'Z', dateStrings:true),
// לכן ממירים גבולות "יום ישראלי" ל-UTC לפני ההשוואה מול ה-DB, ומפרשים את kickoff כ-UTC בתצוגה.

const nodemailer = require('nodemailer');
const db = require('../db');
const { getShabbatState, getDatePartsInTz } = require('../lib/shabbat');
const {
  readSettingsMap,
  isTruthySetting,
  buildTransportConfig,
  buildGmailTransportConfig,
  resolveUserDeliveryMode,
  assertSmtpSettings,
  assertGmailSettings,
  friendlyMailError
} = require('./leaderboard-report');

const IL_TZ = 'Asia/Jerusalem';
const SITE_URL = 'www.mon2026.seach.co.il';
const PREMATCH_LEAD_MINUTES = 150;       // 2.5 שעות
const PREMATCH_WINDOW_MINUTES = 6;       // חלון לכידה (גדול מתדירות ה-cron) — מונע פספוס

const SETTING_KEYS = [
  'smtp_server', 'smtp_port', 'smtp_security', 'smtp_user', 'smtp_password',
  'email_user_delivery_mode', 'gmail_app_user', 'gmail_app_password',
  'shabbat_mode', 'send_prediction_reminders', 'send_prematch_reminders'
];

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// הגדרה אופציונלית שברירת-המחדל שלה "פעיל": ריק/לא-מוגדר => פעיל; אחרת לפי הערך.
function isEnabledByDefault(value) {
  if (value == null || String(value).trim() === '') return true;
  return isTruthySetting(value);
}

// היסט (ms) של אזור הזמן בישראל עבור רגע נתון
function ilOffsetMs(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: IL_TZ, timeZoneName: 'shortOffset'
  }).formatToParts(date);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const m = tz.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * ((Number(m[2] || 0) * 60) + Number(m[3] || 0)) * 60 * 1000;
}

// שעת-קיר ישראלית (Y-M-D H:M) -> רגע UTC
function ilWallTimeToUtc(y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let utc = guess;
  for (let i = 0; i < 2; i += 1) utc = guess - ilOffsetMs(new Date(utc));
  return new Date(utc);
}

// Date -> מחרוזת DATETIME בפורמט MySQL לפי UTC ("YYYY-MM-DD HH:MM:SS")
function toMysqlUtc(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// גבולות "מחר" (לפי לוח-שנה ישראלי) כרגעי UTC
function tomorrowIlBoundsUtc(now = new Date()) {
  const p = getDatePartsInTz(IL_TZ, now);
  const t = new Date(Date.UTC(p.year, p.month - 1, p.day));
  t.setUTCDate(t.getUTCDate() + 1); // מחר (לוח-שנה ישראלי)
  const y = t.getUTCFullYear();
  const mo = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  return {
    startUtc: ilWallTimeToUtc(y, mo, d, 0, 0),
    endUtc: ilWallTimeToUtc(y, mo, d + 1, 0, 0) // Date.UTC מטפל בגלישת חודש
  };
}

function teamName(row, side, lang) {
  const he = row[`${side}_he`] || row[`${side}_label_he`];
  const en = row[`${side}_en`] || row[`${side}_label_en`];
  return (lang === 'en' ? (en || he) : (he || en)) || '—';
}

function fmtKickoff(kickoffStr, lang) {
  const d = new Date(String(kickoffStr).replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'he-IL', {
    timeZone: IL_TZ, weekday: 'long', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
}

// בונה transporter + כתובת-שולח לפי מצב המסירה למשתמשים (smtp / gmail)
function buildUserTransport(s) {
  const mode = resolveUserDeliveryMode(s);
  assertSmtpSettings(s);
  if (mode === 'gmail') {
    assertGmailSettings(s);
    return {
      transporter: nodemailer.createTransport(buildGmailTransportConfig(s)),
      from: `"מונדיאל 2026" <${String(s.gmail_app_user || '').trim()}>`,
      mode
    };
  }
  return {
    transporter: nodemailer.createTransport(buildTransportConfig(s)),
    from: `"מונדיאל 2026" <${String(s.smtp_user || '').trim()}>`,
    mode
  };
}

async function isShabbatNow(s) {
  if (!isTruthySetting(s.shabbat_mode)) return false;
  const shabbat = await getShabbatState(IL_TZ);
  return shabbat.active || shabbat.error;
}

function predictionRowHtml(row, lang) {
  const home = teamName(row, 'home', lang);
  const away = teamName(row, 'away', lang);
  return `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #d8e7dd;color:#0b3d2e">${xmlEscape(fmtKickoff(row.kickoff, lang))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #d8e7dd;color:#0b3d2e;font-weight:700">🏠 ${xmlEscape(home)} נגד ${xmlEscape(away)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #d8e7dd;text-align:center;font-weight:700;color:#0b3d2e;font-size:18px;direction:ltr">${Number(row.pred_home)} : ${Number(row.pred_away)}</td>
    </tr>`;
}

function buildNextDayEmailHtml(name, rows, lang) {
  const body = rows.map((r) => predictionRowHtml(r, lang)).join('');
  return `<div dir="rtl" style="font-family:Arial,sans-serif;color:#0b3d2e">
    <p>שלום ${xmlEscape(name)},</p>
    <p>ריכזנו עבורך את הניחושים שמילאת למשחקי <strong>מחר</strong> במונדיאל 2026:</p>
    <table dir="rtl" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:12px;background:#f7fbf8;border:1px solid #d8e7dd;border-radius:10px;overflow:hidden">
      <thead>
        <tr style="background:#e8f3eb">
          <th style="padding:10px;border-bottom:1px solid #d8e7dd;text-align:right">מועד</th>
          <th style="padding:10px;border-bottom:1px solid #d8e7dd;text-align:right">משחק</th>
          <th style="padding:10px;border-bottom:1px solid #d8e7dd;text-align:center">הניחוש שלך</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
    <p style="margin-top:14px;font-size:13px;color:#0b3d2e">עדיין אפשר לעדכן ניחושים עד מועד הנעילה של כל משחק — ${SITE_URL}</p>
  </div>`;
}

function buildPrematchEmailHtml(name, row, lang) {
  const home = teamName(row, 'home', lang);
  const away = teamName(row, 'away', lang);
  return `<div dir="rtl" style="font-family:Arial,sans-serif;color:#0b3d2e">
    <p>שלום ${xmlEscape(name)},</p>
    <p>המשחק <strong>🏠 ${xmlEscape(home)} נגד ${xmlEscape(away)}</strong> מתחיל בעוד כשעתיים וחצי (${xmlEscape(fmtKickoff(row.kickoff, lang))}).</p>
    <p style="font-size:18px;font-weight:700">הניחוש שלך: <span style="direction:ltr;display:inline-block">${Number(row.pred_home)} : ${Number(row.pred_away)}</span></p>
    <p style="margin-top:12px;font-size:13px;color:#0b3d2e">בהצלחה! — ${SITE_URL}</p>
  </div>`;
}

// SQL משותף לשליפת ניחושים + פרטי משתמש + שמות קבוצות, לפי חלון kickoff
const PREDICTIONS_IN_WINDOW_SQL = `
  SELECT u.id AS user_id, u.email, u.name, u.preferred_language,
         m.id AS match_id, m.kickoff, m.status,
         p.home_score AS pred_home, p.away_score AS pred_away,
         ht.name_he AS home_he, ht.name_en AS home_en,
         at.name_he AS away_he, at.name_en AS away_en,
         m.home_label_he, m.home_label_en, m.away_label_he, m.away_label_en
  FROM predictions p
  JOIN users   u  ON u.id = p.user_id
  JOIN matches m  ON m.id = p.match_id
  LEFT JOIN teams ht ON ht.code = m.home_code
  LEFT JOIN teams at ON at.code = m.away_code
  WHERE u.is_guest = 0 AND u.email IS NOT NULL AND u.email <> ''
    AND m.status <> 'finished'
    AND m.kickoff >= ? AND m.kickoff < ?
  ORDER BY u.id ASC, m.kickoff ASC, m.id ASC
`;

// ─────────── (ב) מייל לילי על משחקי מחר ───────────
async function sendNextDayPredictionEmails(options = {}) {
  const force = Boolean(options.force);
  const s = await readSettingsMap(SETTING_KEYS);

  if (!force && !isEnabledByDefault(s.send_prediction_reminders)) return { skipped: 'disabled' };
  if (!s.smtp_server || !s.smtp_user || !s.smtp_password) return { skipped: 'no_smtp' };
  if (!force && await isShabbatNow(s)) return { skipped: 'shabbat' };

  const { startUtc, endUtc } = tomorrowIlBoundsUtc();
  const rows = await db.query(PREDICTIONS_IN_WINDOW_SQL, [toMysqlUtc(startUtc), toMysqlUtc(endUtc)]);
  if (!rows.length) return { skipped: 'no_predictions', sent: 0, failed: 0 };

  // קיבוץ לפי משתמש
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user: r, items: [] });
    byUser.get(r.user_id).items.push(r);
  }

  const { transporter, from, mode } = buildUserTransport(s);
  let sent = 0; const failed = [];
  for (const { user, items } of byUser.values()) {
    const lang = user.preferred_language === 'en' ? 'en' : 'he';
    try {
      await transporter.sendMail({
        from,
        to: user.email,
        subject: 'הניחושים שלך למשחקי מחר — מונדיאל 2026',
        html: buildNextDayEmailHtml(user.name, items, lang)
      });
      sent += 1;
    } catch (e) {
      failed.push({ email: user.email, error: friendlyMailError(e.message, mode) });
    }
  }

  console.log(`[next-day-reminders] users=${byUser.size} sent=${sent} failed=${failed.length} mode=${mode}`);
  return { sent, failed: failed.length, failed_recipients: failed, users: byUser.size };
}

// ─────────── (ג) מייל 2.5 שעות לפני משחק ───────────
async function wasPrematchNotified(matchId) {
  const row = await db.one('SELECT 1 AS x FROM settings WHERE `key` = ?', [`prematch_notified_${matchId}`]);
  return !!row;
}
async function markPrematchNotified(matchId) {
  await db.run(
    'INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [`prematch_notified_${matchId}`, '1']
  );
}

async function sendPrematchPredictionEmails(options = {}) {
  const force = Boolean(options.force);
  const s = await readSettingsMap(SETTING_KEYS);

  if (!force && !isEnabledByDefault(s.send_prematch_reminders)) return { skipped: 'disabled' };
  if (!s.smtp_server || !s.smtp_user || !s.smtp_password) return { skipped: 'no_smtp' };
  if (!force && await isShabbatNow(s)) return { skipped: 'shabbat' };

  // משחקים שה-kickoff שלהם בעוד ~2.5 שעות (חלון לכידה קצר), ושטרם נשלחה עליהם תזכורת
  const now = new Date();
  const lower = new Date(now.getTime() + PREMATCH_LEAD_MINUTES * 60000);
  const upper = new Date(now.getTime() + (PREMATCH_LEAD_MINUTES + PREMATCH_WINDOW_MINUTES) * 60000);
  const dueMatches = await db.query(
    `SELECT id FROM matches
     WHERE status <> 'finished' AND kickoff >= ? AND kickoff < ?
       AND NOT EXISTS (SELECT 1 FROM settings st WHERE st.\`key\` = CONCAT('prematch_notified_', matches.id))
     ORDER BY kickoff ASC`,
    [toMysqlUtc(lower), toMysqlUtc(upper)]
  );
  if (!dueMatches.length) return { skipped: 'no_due_matches', sent: 0, failed: 0 };

  const { transporter, from, mode } = buildUserTransport(s);
  let sent = 0; const failed = []; let matchesNotified = 0;

  for (const dm of dueMatches) {
    // אם נשלחה תזכורת במקביל (מרוץ) — דלג
    if (await wasPrematchNotified(dm.id)) continue;
    const rows = await db.query(
      PREDICTIONS_IN_WINDOW_SQL.replace('m.kickoff >= ? AND m.kickoff < ?', 'm.id = ?'),
      [dm.id]
    );
    for (const r of rows) {
      const lang = r.preferred_language === 'en' ? 'en' : 'he';
      const home = teamName(r, 'home', lang);
      const away = teamName(r, 'away', lang);
      try {
        await transporter.sendMail({
          from,
          to: r.email,
          subject: `תזכורת: ${home} נגד ${away} מתחיל בעוד כשעתיים וחצי`,
          html: buildPrematchEmailHtml(r.name, r, lang)
        });
        sent += 1;
      } catch (e) {
        failed.push({ email: r.email, error: friendlyMailError(e.message, mode) });
      }
    }
    await markPrematchNotified(dm.id);
    matchesNotified += 1;
  }

  console.log(`[prematch-reminders] matches=${matchesNotified} sent=${sent} failed=${failed.length} mode=${mode}`);
  return { sent, failed: failed.length, failed_recipients: failed, matches: matchesNotified };
}

module.exports = {
  sendNextDayPredictionEmails,
  sendPrematchPredictionEmails
};
