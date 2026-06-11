// מיפוי אזור-זמן IANA → קואורדינטות מייצגות (קו רוחב, קו אורך) של עיר ראשית באותו אזור.
// משמש לחישוב זמני שבת (כניסה/יציאה) לפי מיקום הגולש — ה-API של Hebcal דורש קואורדינטות.
// אם אזור הזמן לא נמצא — נופלים לירושלים.

const TZ_COORDS = {
  // ── ישראל ──
  'Asia/Jerusalem': [31.778, 35.235],
  'Asia/Tel_Aviv': [32.066, 34.778],

  // ── אירופה ──
  'Europe/London': [51.507, -0.128],
  'Europe/Dublin': [53.349, -6.260],
  'Europe/Lisbon': [38.722, -9.139],
  'Europe/Madrid': [40.417, -3.703],
  'Europe/Paris': [48.857, 2.352],
  'Europe/Brussels': [50.851, 4.352],
  'Europe/Amsterdam': [52.374, 4.890],
  'Europe/Berlin': [52.520, 13.405],
  'Europe/Zurich': [47.377, 8.540],
  'Europe/Rome': [41.903, 12.496],
  'Europe/Vienna': [48.209, 16.373],
  'Europe/Prague': [50.076, 14.438],
  'Europe/Warsaw': [52.230, 21.012],
  'Europe/Budapest': [47.498, 19.040],
  'Europe/Stockholm': [59.329, 18.069],
  'Europe/Oslo': [59.914, 10.752],
  'Europe/Copenhagen': [55.676, 12.568],
  'Europe/Helsinki': [60.170, 24.938],
  'Europe/Athens': [37.984, 23.728],
  'Europe/Bucharest': [44.427, 26.103],
  'Europe/Kyiv': [50.451, 30.524],
  'Europe/Kiev': [50.451, 30.524],
  'Europe/Moscow': [55.756, 37.617],
  'Europe/Istanbul': [41.008, 28.978],

  // ── צפון אמריקה ──
  'America/St_Johns': [47.561, -52.713],
  'America/Halifax': [44.649, -63.576],
  'America/New_York': [40.713, -74.006],
  'America/Toronto': [43.651, -79.347],
  'America/Detroit': [42.331, -83.046],
  'America/Montreal': [45.502, -73.567],
  'America/Chicago': [41.850, -87.650],
  'America/Mexico_City': [19.433, -99.133],
  'America/Winnipeg': [49.895, -97.138],
  'America/Denver': [39.739, -104.990],
  'America/Phoenix': [33.448, -112.074],
  'America/Edmonton': [53.546, -113.494],
  'America/Los_Angeles': [34.052, -118.244],
  'America/Vancouver': [49.283, -123.121],
  'America/Anchorage': [61.218, -149.900],
  'Pacific/Honolulu': [21.307, -157.858],

  // ── דרום אמריקה ──
  'America/Sao_Paulo': [-23.551, -46.633],
  'America/Argentina/Buenos_Aires': [-34.604, -58.382],
  'America/Santiago': [-33.449, -70.669],
  'America/Bogota': [4.711, -74.072],
  'America/Lima': [-12.046, -77.043],
  'America/Panama': [8.983, -79.519],

  // ── אפריקה ──
  'Africa/Johannesburg': [-26.205, 28.050],
  'Africa/Cairo': [30.044, 31.236],
  'Africa/Casablanca': [33.573, -7.590],
  'Africa/Lagos': [6.524, 3.379],
  'Africa/Nairobi': [-1.292, 36.822],
  'Africa/Tunis': [36.806, 10.181],

  // ── אסיה ──
  'Asia/Dubai': [25.205, 55.271],
  'Asia/Baghdad': [33.315, 44.366],
  'Asia/Tehran': [35.689, 51.389],
  'Asia/Riyadh': [24.713, 46.675],
  'Asia/Karachi': [24.861, 67.010],
  'Asia/Kolkata': [22.573, 88.364],
  'Asia/Calcutta': [22.573, 88.364],
  'Asia/Bangkok': [13.756, 100.502],
  'Asia/Singapore': [1.352, 103.820],
  'Asia/Hong_Kong': [22.320, 114.170],
  'Asia/Shanghai': [31.230, 121.474],
  'Asia/Tokyo': [35.690, 139.692],
  'Asia/Seoul': [37.567, 126.978],

  // ── אוקיאניה ──
  'Australia/Perth': [-31.953, 115.857],
  'Australia/Adelaide': [-34.929, 138.601],
  'Australia/Brisbane': [-27.469, 153.025],
  'Australia/Sydney': [-33.868, 151.209],
  'Australia/Melbourne': [-37.814, 144.963],
  'Pacific/Auckland': [-36.848, 174.763]
};

const DEFAULT_COORDS = [31.778, 35.235]; // ירושלים

// מחזיר קואורדינטות לאזור-זמן. אם לא נמצא במפורש — מנסה התאמה לפי אזור (Region) קרוב,
// אחרת ירושלים. (גם אם הקו-רוחב אינו מדויק לעיר המדויקת, זמן השקיעה קרוב מאוד באותו אזור.)
function coordsForTimezone(tz) {
  if (!tz || typeof tz !== 'string') return DEFAULT_COORDS;
  if (TZ_COORDS[tz]) return TZ_COORDS[tz];
  // נפילה: התאמה לפי תחילת המחרוזת (אותו יבשת/אזור)
  const region = tz.split('/')[0] + '/';
  const sameRegion = Object.keys(TZ_COORDS).find((k) => k.startsWith(region));
  return sameRegion ? TZ_COORDS[sameRegion] : DEFAULT_COORDS;
}

module.exports = { coordsForTimezone, TZ_COORDS, DEFAULT_COORDS };
