const axios = require('axios');
const { coordsForTimezone } = require('../data/timezones');

const shabbatCache = new Map(); // `${tz}|${YYYY-MM-DD}` -> { start, end, ts }

function normalizeTimezone(tz) {
  const value = String(tz || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9_+\-]*\/[A-Za-z0-9_+\-/]+$/.test(value)) {
    return 'Asia/Jerusalem';
  }
  return value;
}

function getDatePartsInTz(tz, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = {};
  for (const part of fmt.formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

async function getShabbatState(tz = 'Asia/Jerusalem', now = new Date()) {
  const resolvedTz = normalizeTimezone(tz);
  const { year, month, day, ymd } = getDatePartsInTz(resolvedTz, now);
  const cacheKey = `${resolvedTz}|${ymd}`;
  let win = shabbatCache.get(cacheKey);

  if (!win || Date.now() - win.ts > 6 * 3600 * 1000) {
    const [lat, lng] = coordsForTimezone(resolvedTz);
    const url = `https://www.hebcal.com/shabbat?cfg=json&latitude=${lat}&longitude=${lng}`
      + `&tzid=${encodeURIComponent(resolvedTz)}&b=18&gy=${year}&gm=${month}&gd=${day}`;
    try {
      const { data } = await axios.get(url, { timeout: 12000 });
      const items = (data && data.items) || [];
      const candles = items.find((i) => i.category === 'candles');
      const havdalah = items.find((i) => i.category === 'havdalah');
      win = { start: candles ? candles.date : null, end: havdalah ? havdalah.date : null, ts: Date.now() };
      shabbatCache.set(cacheKey, win);
    } catch {
      return { enabled: true, active: false, start: null, end: null, tz: resolvedTz, error: 'unavailable' };
    }
  }

  const nowMs = now.getTime();
  const startMs = win.start ? Date.parse(win.start) : null;
  const endMs = win.end ? Date.parse(win.end) : null;
  const active = !!(startMs && endMs && nowMs >= startMs && nowMs <= endMs);
  return { enabled: true, active, start: win.start, end: win.end, tz: resolvedTz };
}

module.exports = {
  getDatePartsInTz,
  getShabbatState
};
