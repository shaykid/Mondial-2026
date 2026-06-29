// services/aiPredictions.js
// מייצר "ניחושי AI" ל-5 המשחקים הקרובים ע"י מחקר רשת חי (OpenAI Responses API + web_search),
// לפי הפרומפט של מנהל המערכת. שומר עד 4 מקורות לכל משחק + קונצנזוס.
const db = require('../db');

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const MODEL = process.env.AI_PRED_MODEL || 'gpt-4o';

function kickoffIso(raw) {
  const s = String(raw);
  return s.endsWith('Z') ? s : `${s.replace(' ', 'T')}Z`;
}

// N המשחקים הקרובים שטרם הסתיימו (LIMIT מוטמע — mysql2 לא תומך ב-placeholder ל-LIMIT)
async function upcomingMatches(limit) {
  const n = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);
  return db.query(
    `SELECT m.id, m.kickoff, m.home_code, m.away_code,
            COALESCE(th.name_en, m.home_label_en, m.home_code) AS home_en,
            COALESCE(ta.name_en, m.away_label_en, m.away_code) AS away_en,
            COALESCE(th.name_he, m.home_label_he, m.home_code) AS home_he,
            COALESCE(ta.name_he, m.away_label_he, m.away_code) AS away_he
       FROM matches m
       LEFT JOIN teams th ON th.code = m.home_code
       LEFT JOIN teams ta ON ta.code = m.away_code
      WHERE m.status <> 'finished' AND m.kickoff >= UTC_TIMESTAMP()
      ORDER BY m.kickoff ASC
      LIMIT ${n}`
  );
}

function buildPrompt(fixtures) {
  const list = fixtures.map(f =>
    `- match_id ${f.id}: ${f.home_en} vs ${f.away_en} | kickoff(UTC) ${kickoffIso(f.kickoff)}`
  ).join('\n');
  return `You are a football match prediction research assistant.

Research prediction sources for EXACTLY these specific upcoming FIFA World Cup 2026 matches (do NOT pick other matches):
${list}

For each match collect 3-4 prediction sources. Prefer exact-score predictions; otherwise use the source's betting/prediction direction (team to win / draw / over-under / BTTS / to qualify).

Rules:
- Use only current, verifiable web sources (ESPN, BBC Sport, Sky Sports, CBS, Sports Mole, Opta Analyst, Dimers, WhoScored, Forebet, WinDrawWin, Covers, etc.).
- Do NOT invent predictions or URLs. If fewer than 3 reliable sources exist for a match, include what was found and note it.
- Classify each prediction's type as one of: exact_score, betting_tip, probability_model, editorial_opinion.
- Convert kickoff to Asia/Jerusalem in the output.
- Echo back the SAME match_id I gave above for each match.

Return ONLY valid JSON (no markdown), matching:
{
  "matches": [
    {
      "match_id": 0,
      "kickoff_israel_time": "",
      "stage": "",
      "predictions": [
        { "source_name": "", "source_url": "", "prediction_type": "exact_score|betting_tip|probability_model|editorial_opinion", "prediction": "", "notes": "" }
      ],
      "consensus": { "most_common_result": "", "suggested_score": "", "confidence": "low|medium|high", "explanation": "" }
    }
  ],
  "missing_data_notes": []
}`;
}

function extractText(resp) {
  if (!resp || !Array.isArray(resp.output)) return '';
  let out = '';
  for (const item of resp.output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === 'output_text' && typeof c.text === 'string') out += c.text;
      }
    }
  }
  return out || resp.output_text || '';
}

function parseJson(text) {
  if (!text) return null;
  let s = text.trim();
  // הסרת גדרות markdown אם קיימות
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // חיתוך לאובייקט החיצוני
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try { return JSON.parse(s); } catch { return null; }
}

async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) { const e = new Error('OPENAI_API_KEY missing'); e.code = 'NO_API_KEY'; throw e; }
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      tools: [{ type: 'web_search_preview' }],
      input: prompt
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
    e.code = 'OPENAI_ERROR';
    throw e;
  }
  return res.json();
}

const TYPES = ['exact_score', 'betting_tip', 'probability_model', 'editorial_opinion'];
const CONF = ['low', 'medium', 'high'];

// מייצר ושומר ניחושי AI ל-N המשחקים הקרובים. מחזיר סיכום.
async function generateForNextMatches(limit = 5, force = false) {
  const all = await upcomingMatches(limit);
  if (!all.length) return { ok: true, matches: 0, note: 'no upcoming matches' };

  // דלג על משחקים שכבר יש להם ניחושים (אלא אם force) — לא לבצע fetch מחדש
  let fixtures = all;
  if (!force) {
    const have = await db.query(
      `SELECT DISTINCT match_id FROM match_ai_predictions WHERE match_id IN (${all.map(() => '?').join(',')})`,
      all.map(f => f.id)
    );
    const haveSet = new Set(have.map(r => r.match_id));
    fixtures = all.filter(f => !haveSet.has(f.id));
  }
  if (!fixtures.length) return { ok: true, matches: 0, skipped: all.length, note: 'all already have predictions' };

  const validIds = new Set(fixtures.map(f => f.id));
  const resp = await callOpenAI(buildPrompt(fixtures));
  const data = parseJson(extractText(resp));
  if (!data || !Array.isArray(data.matches)) {
    const e = new Error('AI לא החזיר JSON תקין'); e.code = 'BAD_JSON'; throw e;
  }

  let stored = 0, sources = 0;
  for (const m of data.matches) {
    const mid = Number(m.match_id);
    if (!validIds.has(mid)) continue;
    const preds = Array.isArray(m.predictions) ? m.predictions.slice(0, 4) : [];
    const cons = m.consensus || {};

    await db.tx(async (t) => {
      await t.run('DELETE FROM match_ai_predictions WHERE match_id = ?', [mid]);
      let slot = 0;
      for (const p of preds) {
        const type = TYPES.includes(p.prediction_type) ? p.prediction_type : 'editorial_opinion';
        await t.run(
          `INSERT INTO match_ai_predictions (match_id, slot, source_name, source_url, prediction_type, prediction, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [mid, slot++,
            String(p.source_name || 'מקור').slice(0, 158),
            p.source_url ? String(p.source_url).slice(0, 498) : null,
            type,
            p.prediction != null ? String(p.prediction) : null,
            p.notes != null ? String(p.notes) : null]
        );
        sources++;
      }
      const conf = CONF.includes(String(cons.confidence || '').toLowerCase()) ? String(cons.confidence).toLowerCase() : null;
      await t.run(
        `INSERT INTO match_ai_consensus (match_id, most_common, suggested_score, confidence, explanation, generated_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE most_common=VALUES(most_common), suggested_score=VALUES(suggested_score),
           confidence=VALUES(confidence), explanation=VALUES(explanation), generated_at=VALUES(generated_at)`,
        [mid,
          cons.most_common_result ? String(cons.most_common_result).slice(0, 158) : null,
          cons.suggested_score ? String(cons.suggested_score).slice(0, 38) : null,
          conf,
          cons.explanation ? String(cons.explanation) : null]
      );
    });
    stored++;
  }
  return { ok: true, matches: stored, sources, notes: data.missing_data_notes || [] };
}

// כל ניחושי ה-AI מקובצים לפי match_id (לתצוגת הכפתורים)
async function getAllActive() {
  const preds = await db.query(
    `SELECT p.match_id, p.slot, p.source_name, p.source_url, p.prediction_type, p.prediction, p.notes
       FROM match_ai_predictions p
       JOIN matches m ON m.id = p.match_id
      WHERE m.status <> 'finished'
      ORDER BY p.match_id, p.slot`
  );
  const cons = await db.query(
    `SELECT c.match_id, c.most_common, c.suggested_score, c.confidence, c.explanation
       FROM match_ai_consensus c JOIN matches m ON m.id = c.match_id WHERE m.status <> 'finished'`
  );
  const byMatch = {};
  for (const p of preds) {
    (byMatch[p.match_id] = byMatch[p.match_id] || { match_id: p.match_id, sources: [], consensus: null }).sources.push(p);
  }
  for (const c of cons) {
    byMatch[c.match_id] = byMatch[c.match_id] || { match_id: c.match_id, sources: [], consensus: null };
    byMatch[c.match_id].consensus = c;
  }
  return byMatch;
}

// ריצה יומית: ניחושים לכל המשחקים ב-48 השעות הקרובות (לכל הפחות 5 הקרובים), דילוג על קיימים
async function generateDaily() {
  if (!process.env.OPENAI_API_KEY) return { ok: false, note: 'no api key' };
  const row = await db.one(
    "SELECT COUNT(*) AS n FROM matches WHERE status <> 'finished' AND kickoff >= UTC_TIMESTAMP() AND kickoff <= (UTC_TIMESTAMP() + INTERVAL 2 DAY)"
  );
  const limit = Math.max(5, Number(row?.n || 0));
  return generateForNextMatches(limit, false);
}

module.exports = { generateForNextMatches, generateDaily, getAllActive };
