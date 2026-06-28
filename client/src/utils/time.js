// כל הזמנים באתר מוצגים לפי שעון ישראל (Asia/Jerusalem).
// ה-API מחזיר DATETIME כמחרוזת UTC נאיבית ("2026-06-11 19:00:00") ללא אזור זמן;
// יש לפרש אותה כ-UTC (כפי שהשרת עושה), אחרת הדפדפן מפרש בזמן המקומי ומקבל instant שגוי
// (ובפרט זמן נעילת הניחושים יוצג/יחושב לא נכון).
export const IL_TZ = 'Asia/Jerusalem';

export function parseServerDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  // אם כבר יש אזור זמן (Z או ±hh:mm) — להשתמש כמו שהוא; אחרת להתייחס כ-UTC
  if (/[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(`${s.replace(' ', 'T')}Z`);
}

function getTimeZoneOffsetMs(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset'
  }).formatToParts(date);
  const tzName = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * ((hours * 60) + minutes) * 60 * 1000;
}

function parseLabelDateMs(label, timeZone = IL_TZ) {
  const raw = String(label || '').trim();
  if (!raw) return null;
  const match = raw.match(/(\d{1,2})[./](\d{1,2})[./](\d{4}).*?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);

  if (!day || !month || !year || hour > 23 || minute > 59 || second > 59) return null;

  const localGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = localGuess;
  for (let i = 0; i < 2; i += 1) {
    const offsetMs = getTimeZoneOffsetMs(timeZone, new Date(utcMs));
    utcMs = localGuess - offsetMs;
  }
  return utcMs;
}

export function parseScheduleLockMs(item) {
  if (!item) return NaN;
  const labelMs = parseLabelDateMs(item.date_label);
  if (Number.isFinite(labelMs)) return labelMs;
  return ilMs(item.start_at);
}

// חותמת זמן במילישניות (absolute) — לחישוב נעילה/השוואות
export function ilMs(value) {
  const d = parseServerDate(value);
  return d ? d.getTime() : NaN;
}

export function ilDateTime(value, locale, opts = {}) {
  const d = parseServerDate(value);
  return d ? d.toLocaleString(locale, { timeZone: IL_TZ, ...opts }) : '';
}

export function ilDate(value, locale, opts = {}) {
  const d = parseServerDate(value);
  return d ? d.toLocaleDateString(locale, { timeZone: IL_TZ, ...opts }) : '';
}

export function ilTime(value, locale, opts = {}) {
  const d = parseServerDate(value);
  return d ? d.toLocaleTimeString(locale, { timeZone: IL_TZ, ...opts }) : '';
}

// מפתח יום (YYYY-MM-DD) לפי שעון ישראל — לקיבוץ משחקים לפי תאריך ישראלי
export function ilDayKey(value) {
  const d = parseServerDate(value);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IL_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}
