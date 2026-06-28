const IL_TZ = 'Asia/Jerusalem';

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

function parseServerDateMs(value) {
  if (value == null || value === '') return NaN;
  const raw = String(value).trim();
  const d = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? NaN : d.getTime();
}

function parseScheduleLockMs(item) {
  if (!item) return NaN;
  const labelMs = parseLabelDateMs(item.date_label);
  if (Number.isFinite(labelMs)) return labelMs;
  return parseServerDateMs(item.start_at);
}

module.exports = {
  IL_TZ,
  getTimeZoneOffsetMs,
  parseLabelDateMs,
  parseServerDateMs,
  parseScheduleLockMs
};
