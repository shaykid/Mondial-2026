// שירות עדכון תוצאות (async/MySQL)
// תומך בשלושה מצבים:
//   1. manual       - עדכון ידני בלבד דרך ממשק הניהול (ברירת מחדל)
//   2. espn         - סקרייפינג מ-ESPN (חינמי)
//   3. api-football - דרך api-football.com (דורש מפתח חינמי)

const axios = require('axios');
const db = require('../db');
const { recalcForMatch } = require('./scoring');

const TEAM_NAME_VARIANTS = {
  'mexico': 'mx', 'south korea': 'kr', 'korea republic': 'kr', 'south africa': 'za',
  'czech republic': 'cz', 'czechia': 'cz',
  'canada': 'ca', 'switzerland': 'ch', 'qatar': 'qa',
  'bosnia and herzegovina': 'ba', 'bosnia-herzegovina': 'ba', 'bosnia': 'ba',
  'brazil': 'br', 'morocco': 'ma', 'scotland': 'gb-sct', 'haiti': 'ht',
  'usa': 'us', 'united states': 'us', 'paraguay': 'py', 'australia': 'au',
  'turkiye': 'tr', 'turkey': 'tr',
  'germany': 'de', 'ecuador': 'ec', 'ivory coast': 'ci',
  "côte d'ivoire": 'ci', "cote d'ivoire": 'ci', 'curacao': 'cw', 'curaçao': 'cw',
  'netherlands': 'nl', 'japan': 'jp', 'tunisia': 'tn', 'sweden': 'se',
  'belgium': 'be', 'iran': 'ir', 'egypt': 'eg', 'new zealand': 'nz',
  'spain': 'es', 'uruguay': 'uy', 'saudi arabia': 'sa',
  'cape verde': 'cv', 'cabo verde': 'cv',
  'france': 'fr', 'senegal': 'sn', 'norway': 'no', 'iraq': 'iq',
  'argentina': 'ar', 'austria': 'at', 'algeria': 'dz', 'jordan': 'jo',
  'portugal': 'pt', 'colombia': 'co', 'uzbekistan': 'uz',
  'dr congo': 'cd', 'congo dr': 'cd', 'dem. republic of congo': 'cd',
  'england': 'gb-eng', 'croatia': 'hr', 'panama': 'pa', 'ghana': 'gh'
};

function teamCode(name) {
  if (!name) return null;
  // נרמול: הסרת סימני ניקוד (Türkiye→turkiye, Côte d'Ivoire→cote d'ivoire, Curaçao→curacao)
  const key = String(name).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').replace(/^the /, '');
  return TEAM_NAME_VARIANTS[key] || null;
}

// עדכון תוצאת משחק יחיד
async function updateMatchScore(matchId, homeScore, awayScore, status = 'finished') {
  const r = await db.run(`
    UPDATE matches
    SET home_score = ?, away_score = ?, status = ?, updated_at = NOW()
    WHERE id = ?
  `, [homeScore, awayScore, status, matchId]);
  if (r.affectedRows && status === 'finished') {
    await recalcForMatch(matchId);
  }
  return r.affectedRows > 0;
}

async function getModeFromSettings() {
  // settings.scraper_mode עוקף את .env (ברגע שהמנהל בחר במסך)
  const r = await db.one("SELECT `value` FROM settings WHERE `key` = 'scraper_mode'");
  return (r && r.value) || (process.env.SCRAPER_MODE || 'manual').toLowerCase();
}

// ─────────── ESPN ───────────
// ESPN's fixtures HTML is now rendered client-side (the React/"Fitt" framework),
// so the old cheerio <tr> parser found nothing. We use ESPN's public JSON
// scoreboard API instead, which returns clean structured fixtures + scores.
const ESPN_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

const STAGE_WINDOWS = [
  { stage: 'group', start: '2026-06-11T00:00:00Z', end: '2026-06-27T23:59:59Z' },
  { stage: 'round_of_32', start: '2026-06-28T00:00:00Z', end: '2026-07-03T23:59:59Z' },
  { stage: 'round_of_16', start: '2026-07-04T00:00:00Z', end: '2026-07-07T23:59:59Z' },
  { stage: 'quarter_final', start: '2026-07-09T00:00:00Z', end: '2026-07-11T23:59:59Z' },
  { stage: 'semi_final', start: '2026-07-14T00:00:00Z', end: '2026-07-15T23:59:59Z' },
  { stage: 'third_place', start: '2026-07-18T00:00:00Z', end: '2026-07-18T23:59:59Z' },
  { stage: 'final', start: '2026-07-19T00:00:00Z', end: '2026-07-19T23:59:59Z' }
];

function detectStageFromDate(iso) {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  return STAGE_WINDOWS.find(({ start, end }) => {
    const a = new Date(start).getTime();
    const b = new Date(end).getTime();
    return ms >= a && ms <= b;
  })?.stage || null;
}

function normalizeVenue(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function findFallbackMatch({ stage, kickoff, venue }) {
  const stageName = stage || detectStageFromDate(kickoff);
  if (!stageName) return null;
  const rows = await db.query(`
    SELECT id, kickoff, status, home_code, away_code, venue
    FROM matches
    WHERE stage = ? AND status != 'finished'
    ORDER BY kickoff ASC, id ASC
  `, [stageName]);
  if (!rows.length) return null;
  const targetMs = new Date(kickoff).getTime();
  const venueKey = normalizeVenue(venue);
  const withVenue = venueKey ? rows.filter((row) => normalizeVenue(row.venue).includes(venueKey) || venueKey.includes(normalizeVenue(row.venue))) : [];
  const pool = withVenue.length ? withVenue : rows;
  if (!Number.isFinite(targetMs)) return pool[0];
  return pool.reduce((best, row) => {
    if (!best) return row;
    const bestMs = Math.abs(new Date(best.kickoff).getTime() - targetMs);
    const rowMs = Math.abs(new Date(row.kickoff).getTime() - targetMs);
    return rowMs < bestMs ? row : best;
  }, null);
}

async function scrapeFromESPN() {
  // Query the full tournament window so a single run can settle any finished game.
  const url = `${ESPN_SCOREBOARD}?dates=20260611-20260719`;
  const updated = [];
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Mondial2026Bot/1.0)' },
    timeout: 20000
  });
  const events = (data && data.events) || [];
  for (const ev of events) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp || !Array.isArray(comp.competitors)) continue;
    const home = comp.competitors.find((c) => c.homeAway === 'home');
    const away = comp.competitors.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;

    const homeCode = teamCode(home.team && home.team.displayName);
    const awayCode = teamCode(away.team && away.team.displayName);
    const eventVenue = comp.venue && comp.venue.fullName;
    const eventDate = ev.date || comp.date;

    let match = null;
    if (homeCode && awayCode) {
      // המשחק ב-DB לפי הצמד בכל סדר (ESPN לעיתים מציג בית/חוץ הפוך מהזריעה).
      // לא הופכים את בית/חוץ ב-DB (כדי לא להפוך ניחושים קיימים) — רק מתאימים את הכיוון.
      match = await db.one(`
        SELECT id, kickoff, status, home_code, away_code, stage, venue FROM matches
        WHERE (home_code = ? AND away_code = ?) OR (home_code = ? AND away_code = ?)
        ORDER BY kickoff ASC LIMIT 1
      `, [homeCode, awayCode, awayCode, homeCode]);
    }
    if (!match) {
      match = await findFallbackMatch({
        stage: detectStageFromDate(eventDate),
        kickoff: eventDate,
        venue: eventVenue
      });
    }
    if (!match) continue;

    // האם כיוון ה-DB תואם ל-ESPN (בית=בית) או הפוך
    const sameOrientation = match.home_code && homeCode && awayCode
      ? match.home_code === homeCode
      : true;

    // ── סנכרון זמן פתיחה מ-ESPN (מקור-אמת ללוח הזמנים) ──
    // ev.date הוא ISO ב-UTC; ה-DB מאחסן UTC נאיבי ('YYYY-MM-DD HH:MM:SS').
    if (ev.date) {
      const espnMs = new Date(ev.date).getTime();
      const dbMs = new Date(String(match.kickoff) + (String(match.kickoff).endsWith('Z') ? '' : 'Z')).getTime();
      if (Number.isFinite(espnMs) && Math.abs(dbMs - espnMs) > 60000) {
        const naiveUtc = new Date(ev.date).toISOString().slice(0, 19).replace('T', ' ');
        await db.run('UPDATE matches SET kickoff = ?, updated_at = NOW() WHERE id = ?', [naiveUtc, match.id]);
        updated.push({ id: match.id, kickoff: naiveUtc });
      }
    }

    // ── תוצאה/סטטוס: רק למשחק שעדיין לא 'finished' ב-DB ──
    const hs = parseInt(home.score, 10);
    const as = parseInt(away.score, 10);
    // state: 'pre' (not started) | 'in' (live) | 'post' (final)
    const state = comp.status && comp.status.type && comp.status.type.state;
    if (match.status !== 'finished' && state !== 'pre' && Number.isInteger(hs) && Number.isInteger(as)) {
      const status = state === 'post' ? 'finished' : 'live';
      // התאמת התוצאה לכיוון ה-DB (אם הפוך — מחליפים)
      const dbHome = sameOrientation ? hs : as;
      const dbAway = sameOrientation ? as : hs;
      if (await updateMatchScore(match.id, dbHome, dbAway, status)) {
        const homeLabel = match.home_code || match.home_label_en || match.home_label_he || `match-${match.id}`;
        const awayLabel = match.away_code || match.away_label_en || match.away_label_he || `match-${match.id}`;
        updated.push({ id: match.id, score: `${homeLabel} ${dbHome}-${dbAway} ${awayLabel}`, status });
      }
    }
  }
  return updated;
}

// ─────────── api-football ───────────
async function scrapeFromApiFootball() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY לא הוגדר ב-.env');
  const url = 'https://v3.football.api-sports.io/fixtures?league=1&season=2026';
  const updated = [];
  const { data } = await axios.get(url, {
    headers: { 'x-apisports-key': key },
    timeout: 20000
  });
  if (!data || !data.response) return updated;
  for (const fx of data.response) {
    if (fx.fixture.status.short !== 'FT') continue;
    const home = teamCode(fx.teams.home.name);
    const away = teamCode(fx.teams.away.name);
    if (!home || !away) continue;
    const match = await db.one(`
      SELECT id FROM matches
      WHERE home_code = ? AND away_code = ? AND status != 'finished'
      ORDER BY kickoff ASC LIMIT 1
    `, [home, away]);
    if (match) {
      if (await updateMatchScore(match.id, fx.goals.home, fx.goals.away, 'finished')) {
        updated.push({ id: match.id, score: `${home} ${fx.goals.home}-${fx.goals.away} ${away}` });
      }
    }
  }
  return updated;
}

// ─────────── Dispatcher ───────────
async function runDailyUpdate() {
  const mode = await getModeFromSettings();
  console.log(`[${new Date().toISOString()}] עדכון תוצאות - מצב: ${mode}`);
  try {
    let updated = [];
    if (mode === 'espn') updated = await scrapeFromESPN();
    else if (mode === 'api-football') updated = await scrapeFromApiFootball();
    else {
      console.log('   מצב ידני - לא בוצע סקרייפינג.');
      return { mode, updated: [] };
    }
    console.log(`   עודכנו ${updated.length} משחקים`);
    return { mode, updated };
  } catch (e) {
    console.error('   ✗ שגיאה בעדכון:', e.message);
    return { mode, updated: [], error: e.message };
  }
}

module.exports = { runDailyUpdate, updateMatchScore, teamCode };
