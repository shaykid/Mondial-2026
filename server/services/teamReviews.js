// services/teamReviews.js
// ביקורת טקטית לנבחרת (מחקר רשת חי, פלט עברית מובנה) — לפי הפרומפט של מנהל המערכת.
const db = require('../db');

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.AI_TEAM_MODEL || 'gpt-4o';

function buildPrompt(teamNameEn, teamNameHe) {
  const name = teamNameEn || teamNameHe;
  return `You are a football tactical review assistant.

Create a current FIFA World Cup 2026 review for this national team: ${name} (Hebrew name: ${teamNameHe}).
Use current, verifiable web sources only (FIFA, Reuters, ESPN, BBC Sport, Sky Sports, CBS Sports, The Guardian, FOX Sports, The Athletic, Opta Analyst, Sports Mole, WhoScored). Use 4-6 sources.

Return ONLY valid JSON, no markdown, matching:
{
  "team_name": "${teamNameHe}",
  "summary": "",
  "formation_and_style": { "usual_formation": "", "key_players": [], "attacking_style": "", "defensive_structure": "", "bench_depth": "" },
  "advantages": [],
  "weaknesses": [],
  "key_players": [ { "name": "", "position": "", "importance": "" } ],
  "review_sources": [ { "source_name": "", "source_icon": "📰|📊|🎙️|🏥|⚽|🏆", "reviewer_label": "", "url": "", "source_type": "match_report|tactical_preview|squad_update|injury_update|power_ranking|data_model|expert_opinion", "main_point": "" } ],
  "professional_assessment": { "ceiling": "", "main_condition_for_success": "", "biggest_danger": "", "confidence_level": "low|medium|high" },
  "missing_data_notes": []
}

Rules:
- Do not invent lineup, injuries, tactical shape, or source claims. If formation isn't confirmed, write "לא אושר באופן ברור".
- ALL text VALUES must be in HEBREW (player names may stay in their common form). Keep "url" and "source_icon" as-is.
- For each source include a source_icon: 📰 news/match report, 📊 data/probability model, 🎙️ expert opinion, 🏥 injury/squad update, ⚽ tactical preview, 🏆 power ranking.`;
}

function extractText(resp) {
  if (!resp || !Array.isArray(resp.output)) return resp?.output_text || '';
  let out = '';
  for (const item of resp.output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) if (c.type === 'output_text' && typeof c.text === 'string') out += c.text;
    }
  }
  return out || resp.output_text || '';
}

function parseJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return null; }
}

async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error('OPENAI_API_KEY missing'); e.code = 'NO_API_KEY'; throw e; }
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, tools: [{ type: 'web_search_preview' }], input: prompt })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`); e.code = 'OPENAI_ERROR'; throw e;
  }
  return res.json();
}

async function teamName(code) {
  const t = await db.one('SELECT name_he, name_en FROM teams WHERE code = ?', [code]);
  return t || { name_he: code, name_en: code };
}

// מייצר ושומר ביקורת לנבחרת אחת
async function generateForTeam(code) {
  const t = await teamName(code);
  const resp = await callOpenAI(buildPrompt(t.name_en, t.name_he));
  const data = parseJson(extractText(resp));
  if (!data) { const e = new Error('AI לא החזיר JSON'); e.code = 'BAD_JSON'; throw e; }
  await db.run(
    `INSERT INTO team_reviews (team_code, payload, generated_at) VALUES (?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), generated_at = VALUES(generated_at)`,
    [code, JSON.stringify(data)]
  );
  return data;
}

async function generateForCodes(codes) {
  let done = 0;
  const failed = [];
  for (const code of codes) {
    try { await generateForTeam(code); done++; }
    catch (e) { failed.push({ code, error: e.message }); }
  }
  return { ok: true, generated: done, failed };
}

async function allTeamCodes() {
  const rows = await db.query('SELECT code FROM teams ORDER BY code');
  return rows.map(r => r.code);
}

// נבחרות שמשחקות במשחקים הקרובים (עד ~8 נבחרות)
async function next8TeamCodes() {
  const rows = await db.query(
    `SELECT home_code, away_code FROM matches
      WHERE status <> 'finished' AND kickoff >= UTC_TIMESTAMP()
      ORDER BY kickoff ASC LIMIT 8`
  );
  const set = [];
  for (const m of rows) for (const c of [m.home_code, m.away_code]) {
    if (c && !set.includes(c)) set.push(c);
    if (set.length >= 8) break;
  }
  return set.slice(0, 8);
}

async function getReview(code) {
  const row = await db.one('SELECT payload, generated_at FROM team_reviews WHERE team_code = ?', [code]);
  if (!row) return null;
  let payload = null;
  try { payload = JSON.parse(row.payload); } catch { payload = null; }
  return { team_code: code, review: payload, generated_at: row.generated_at };
}

async function codesWithReviews() {
  const rows = await db.query('SELECT team_code FROM team_reviews');
  return rows.map(r => r.team_code);
}

module.exports = {
  generateForTeam, generateForCodes, allTeamCodes, next8TeamCodes,
  getReview, codesWithReviews
};
