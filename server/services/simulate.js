// services/simulate.js — מנוע "סימולציה": יוצר משתמשים וירטואליים (בוטים) עם נתונים
// שנוצרים ע"י AI (שם עברי, טלפון, אימייל, אווטאר), ניחושים, ריביוים, לייקים והצעות הימור.
// המשתמשים מסומנים בטבלת sim_users כדי שלא יקבלו מיילים אמיתיים ושניתן יהיה לנהלם.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createSpecialBet } = require('./coins');

const OPENAI_CHAT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_IMAGE = 'https://api.openai.com/v1/images/generations';
const TEXT_MODEL = process.env.SIM_TEXT_MODEL || 'gpt-4o-mini';
const IMAGE_MODEL = process.env.SIM_IMAGE_MODEL || 'gpt-image-1';

// ───────────── אסטרטגיות הימור ─────────────
const STRATEGIES = {
  gambler:  { he: 'מהמר',            score: 'wild',     stakeMin: 800, stakeMax: 3000, suggest: 3 },
  fun:      { he: 'סתם בכיף',         score: 'goals',    stakeMin: 100, stakeMax: 600,  suggest: 1 },
  thinker:  { he: 'מחושב (הסתברות)',  score: 'realistic',stakeMin: 300, stakeMax: 1200, suggest: 2 },
  random:   { he: 'אקראי',           score: 'uniform',  stakeMin: 100, stakeMax: 1500, suggest: 1 },
};
const STRATEGY_KEYS = Object.keys(STRATEGIES);

// ───────────── מאגרי שמות (סגנון תל-אביבי, גיבוי ללא-AI) ─────────────
// {he, en} כדי לאפשר גם כתובת gmail בלטינית
const FIRST_F = [['נועה','Noa'],['שירה','Shira'],['יעל','Yael'],['מאיה','Maya'],['רוני','Roni'],['סתיו','Stav'],['אלמה','Alma'],['רומי','Romi'],['ליבי','Libby'],['עדן','Eden'],['אופק','Ofek'],['יהלי','Yahli'],['דריה','Daria'],['רותם','Rotem'],['גאיה','Gaya'],['מיקה','Mika'],['נטע','Neta'],['שני','Shani'],['אור','Or'],['תמר','Tamar']];
const FIRST_M = [['יותם','Yotam'],['איתי','Itay'],['עידו','Ido'],['אורי','Ori'],['רועי','Roy'],['איתמר','Itamar'],['יונתן','Yonatan'],['עומר','Omer'],['נדב','Nadav'],['איתן','Eitan'],['רום','Rom'],['ארי','Ari'],['ליאו','Leo'],['דניאל','Daniel'],['גיא','Guy'],['עמית','Amit'],['אלון','Alon'],['טל','Tal'],['רן','Ran'],['יואב','Yoav']];
const LAST = [['כהן','Kohen'],['לוי','Levi'],['שגב','Segev'],['ברקת','Bareket'],['רוזן','Rosen'],['גולן','Golan'],['פלד','Peled'],['רגב','Regev'],['ניר','Nir'],['דרור','Dror'],['שחר','Shahar'],['אלון','Alon'],['נוי','Noy'],['ברנע','Barnea'],['אבן','Even'],['גל','Gal'],['ברק','Barak'],['שלו','Shalev'],['זיו','Ziv'],['רום','Rom']];
const COOL = ['Power','King','Pro','Star','Goal','TLV','Real','Vibe','Wave','Nova','Max','Prime'];
const COOL_FIRST = ['Nixon','Rocky','Ace','Neo','Rio','Leo','Ziggy','Coby','Remy','Dash'];

// בחירת מגדר לפי 60% נקבה / 40% זכר
function pickGender() { return Math.random() < 0.6 ? 'female' : 'male'; }
function pickName(gender) {
  const fp = gender === 'female' ? FIRST_F : FIRST_M;
  const [fHe, fEn] = pick(fp);
  const [lHe, lEn] = pick(LAST);
  return { name: `${fHe} ${lHe}`, first_en: fEn, last_en: lEn };
}

// ───────────── מצב התקדמות (לטבלה החיה) ─────────────
const state = { running: false, total: 0, done: 0, failed: 0, strategy: null, startedAt: null, lastError: null };

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await db.run(`CREATE TABLE IF NOT EXISTS sim_users (
    user_id     INT          NOT NULL PRIMARY KEY,
    strategy    VARCHAR(40)  NOT NULL DEFAULT 'random',
    persona     TEXT         NULL,
    enabled     TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sim_users_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // הוספת עמודת enabled לטבלאות קיימות (MySQL לא תומך ב-ADD COLUMN IF NOT EXISTS)
  const col = await db.one(
    "SELECT 1 AS x FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'sim_users' AND column_name = 'enabled'"
  );
  if (!col) await db.run('ALTER TABLE sim_users ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1');
  schemaReady = true;
}

// ───────────── עזרי OpenAI ─────────────
async function chatJSON(system, user) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(OPENAI_CHAT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TEXT_MODEL,
        temperature: 1.0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
      })
    });
    if (!res.ok) { console.error('sim chat', res.status, (await res.text().catch(()=>'')) .slice(0,200)); return null; }
    const data = await res.json();
    const txt = data?.choices?.[0]?.message?.content?.trim();
    return txt ? JSON.parse(txt) : null;
  } catch (e) { console.error('sim chatJSON:', e.message); return null; }
}

// בונה את פרומפט יצירת התמונה — פנים (פורטרט) או חלק מתמונה משפחתית.
function avatarPrompt(persona, customPrompt) {
  if (customPrompt && String(customPrompt).trim()) return String(customPrompt).trim();
  const gender = persona?.gender === 'female' ? 'woman' : persona?.gender === 'male' ? 'man' : 'person';
  if (Math.random() < 0.5) {
    // פנים — פורטרט ריאליסטי "מהחיים"
    return `A candid, photorealistic real-life close-up portrait of an Israeli ${gender}, natural daylight, relaxed everyday casual style, looking like a genuine phone snapshot rather than a studio photo, slightly imperfect framing. ${persona?.avatar_hint || ''}`.trim();
  }
  // חלק מתמונה משפחתית (חתוך לדמות או עם ילדים)
  const withKids = Math.random() < 0.5
    ? `the ${gender} together with their kids`
    : `cropped to just the ${gender} from a larger family photo`;
  return `A candid real-life family photograph, ${withKids}, Israeli everyday casual style, natural light, genuine amateur phone snapshot (not a studio portrait), photorealistic, slightly imperfect framing. ${persona?.avatar_hint || ''}`.trim();
}

// מייצר אווטאר ושומר לדיסק. מחזיר URL יחסי או null. customPrompt — פרומפט מותאם (לרענון פנים).
async function generateAvatar(persona, customPrompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const prompt = avatarPrompt(persona, customPrompt);
  try {
    const res = await fetch(OPENAI_IMAGE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, n: 1, size: '1024x1024' })
    });
    if (!res.ok) { console.error('sim image', res.status, (await res.text().catch(()=>'')) .slice(0,200)); return null; }
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return null;
    const dir = path.join(__dirname, '..', '..', 'data', 'profile_images', 'sim');
    await fs.promises.mkdir(dir, { recursive: true });
    const fname = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    await fs.promises.writeFile(path.join(dir, fname), Buffer.from(b64, 'base64'));
    return `/data/profile_images/sim/${fname}`;
  } catch (e) { console.error('sim avatar:', e.message); return null; }
}

// ───────────── יצירת פרסונה (שם/טלפון/אימייל/ביו) ─────────────
function ruleBasedPersona(strategy) {
  const gender = pickGender();
  const nm = pickName(gender);
  return {
    name: nm.name,
    gender,
    first_en: nm.first_en,
    last_en: nm.last_en,
    handle: `${nm.first_en}${nm.last_en}`,
    bio: `אוהד/ת כדורגל מתל-אביב, אסטרטגיית ניחוש: ${STRATEGIES[strategy]?.he || strategy}`,
    style: STRATEGIES[strategy]?.he || strategy
  };
}

// כתובת אימייל: תמיד @gmail, מבוססת-שם + מילה או מספר (NoaSegev84@gmail.com / NoaSegevReal@gmail.com)
function emailParts(persona) {
  const nameHandle = (persona.handle || `${persona.first_en || ''}${persona.last_en || ''}`) || `${pick(COOL_FIRST)}${pick(COOL)}`;
  let local = nameHandle;
  const r = Math.random();
  if (r < 0.45) local += rnd(9000) + 10;                        // שם + מספר
  else if (r < 0.80) local += pick(COOL) + (rnd(90) + 10);      // שם + מילה + מספר
  else local += pick(COOL);                                      // שם + מילה
  return { local, domain: 'gmail.com' };
}

async function buildPersona(strategy) {
  const base = ruleBasedPersona(strategy); // קובע מגדר (60% נקבה) ושם-בסיס בלטינית
  const genderHe = base.gender === 'female' ? 'אישה' : 'גבר';
  const ai = await chatJSON(
    'אתה יוצר פרסונות בדויות של אוהדי כדורגל ישראלים בסגנון תל-אביבי חילוני ועכשווי, עבור סביבת בדיקה. החזר JSON בלבד.',
    `צור פרסונה ישראלית תל-אביבית (${genderHe}) ריאליסטית עם שם עברי מודרני ופחות נפוץ (השתדל להימנע משמות שכיחים מאוד). אסטרטגיית הימור: "${STRATEGIES[strategy]?.he || strategy}".
החזר JSON: {"name":"שם פרטי ושם משפחה בעברית מודרני","handle":"תעתיק לטיני של השם ב-CamelCase ללא רווחים","bio":"משפט קצר בעברית על האדם","avatar_hint":"תיאור קצר באנגלית למראה החיצוני","style":"תיאור קצר בעברית של סגנון הניחוש"}`
  );
  if (!ai || !ai.name) return base;
  const handle = String(ai.handle || '').replace(/[^A-Za-z0-9]/g, '') || base.handle;
  return {
    name: String(ai.name).slice(0, 60) || base.name,
    gender: base.gender,                // אוכפים 60/40 מהבסיס
    first_en: base.first_en,
    last_en: base.last_en,
    handle: handle.slice(0, 40),
    bio: String(ai.bio || base.bio).slice(0, 240),
    avatar_hint: String(ai.avatar_hint || '').slice(0, 200),
    style: String(ai.style || base.style).slice(0, 120)
  };
}

function ilPhone() {
  const prefix = pick(['050','052','053','054','055','058']);
  return `${prefix}-${String(rnd(9000000) + 1000000)}`;
}

// אימייל ייחודי. הבוטים מסומנים ב-sim_users ולכן לעולם לא יקבלו מייל אמיתי גם אם הדומיין gmail.com
async function uniqueSimEmail(local, domain) {
  let candidate = `${local}@${domain}`;
  for (let i = 0; i < 6; i += 1) {
    const exists = await db.one('SELECT id FROM users WHERE email = ?', [candidate]);
    if (!exists) return candidate;
    candidate = `${local}${rnd(9999)}@${domain}`;
  }
  return `${local}${Date.now().toString(36)}@${domain}`;
}

// ───────────── ניחושי תוצאה לפי אסטרטגיה ─────────────
function scoreByStrategy(mode) {
  if (mode === 'wild')      return [rnd(6), rnd(6)];                 // 0-5, הרבה שונות
  if (mode === 'goals')     return [rnd(4) + 1, rnd(4)];            // הרבה שערים, נטייה לבית
  if (mode === 'realistic') return [clamp(rnd(3), 0, 3), clamp(rnd(3), 0, 2)]; // 0-2/3, צמוד
  return [rnd(5), rnd(5)];                                          // uniform 0-4
}

// ───────────── יצירת ריביוים (טקסט עברי) ─────────────
function fallbackReview(m) {
  const opts = [
    `משחק צפוי בין ${m.home} ל${m.away}. אני מהמר על משחק צמוד עם הזדמנויות לשני הצדדים.`,
    `${m.home} נראית חזקה יותר על הנייר, אבל ${m.away} יכולה להפתיע. ריביו קצר לפני המשחק.`,
    `קלאסיקה אמיתית! ${m.home} מול ${m.away} — צריך לראות מי ייקח את השליטה בקו האמצע.`,
    `הניחוש שלי: משחק עם שערים. ${m.home} ו${m.away} שתיהן אוהבות לתקוף.`
  ];
  return pick(opts);
}

async function buildReviews(persona, matches) {
  const ai = await chatJSON(
    `אתה ${persona.name}, אוהד/ת כדורגל ישראלי/ת. כתוב ריביוים קצרים בעברית בגוף ראשון, סגנון: ${persona.style}. החזר JSON בלבד.`,
    `כתוב ריביו קצר (1-2 משפטים) לכל משחק מהרשימה. החזר JSON: {"reviews":[{"i":0,"text":"..."}, ...]}.
משחקים: ${matches.map((m, i) => `${i}: ${m.home} נגד ${m.away}`).join(' | ')}`
  );
  const map = {};
  if (ai && Array.isArray(ai.reviews)) for (const r of ai.reviews) if (Number.isInteger(r.i)) map[r.i] = String(r.text || '').slice(0, 600);
  return matches.map((m, i) => map[i] || fallbackReview(m));
}

// ───────────── שאילתות עזר ─────────────
async function loadMatches() {
  return db.query(`
    SELECT m.id, m.status, m.kickoff,
           COALESCE(ht.name_he, m.home_label_he, m.home_code, 'בית') AS home,
           COALESCE(at.name_he, m.away_label_he, m.away_code, 'חוץ') AS away
    FROM matches m
    LEFT JOIN teams ht ON ht.code = m.home_code
    LEFT JOIN teams at ON at.code = m.away_code
    ORDER BY m.kickoff ASC`);
}
async function loadTeams() { return db.query('SELECT code, name_he FROM teams ORDER BY RAND() LIMIT 12'); }

// ───────────── יצירת בוט בודד ─────────────
async function createOne(strategy, options) {
  const persona = await buildPersona(strategy);
  // השתדל להימנע משמות שכבר קיימים (best-effort)
  for (let i = 0; i < 8; i += 1) {
    const taken = await db.one('SELECT id FROM users WHERE name = ?', [persona.name]);
    if (!taken) break;
    const nm = pickName(persona.gender);
    persona.name = nm.name; persona.first_en = nm.first_en; persona.last_en = nm.last_en; persona.handle = `${nm.first_en}${nm.last_en}`;
  }
  const ep = emailParts(persona);
  const email = await uniqueSimEmail(ep.local, ep.domain);
  const phone = ilPhone();
  const passwordHash = bcrypt.hashSync(`Sim!${Math.random().toString(36).slice(2, 10)}`, 10);
  let avatarUrl = null;
  if (options.avatar !== false) avatarUrl = await generateAvatar(persona);

  const ins = await db.run(
    `INSERT INTO users (email, name, phone_number, profile_image_url, password_hash, is_admin, is_guest, can_guess_groups)
     VALUES (?, ?, ?, ?, ?, 0, 0, 1)`,
    [email, persona.name, phone, avatarUrl, passwordHash]
  );
  const userId = ins.insertId;
  await db.run(
    'INSERT INTO sim_users (user_id, strategy, persona) VALUES (?, ?, ?)',
    [userId, strategy, JSON.stringify({ ...persona, phone, email })]
  );

  const summary = { user_id: userId, name: persona.name, email, phone, strategy, predictions: 0, reviews: 0, likes: 0, suggestions: 0, avatar: !!avatarUrl };
  const mode = STRATEGIES[strategy]?.score || 'uniform';
  const matches = await loadMatches();

  // ניחושים — מכל המשחקים (אפשר תת-קבוצה אקראית)
  if (options.bets !== false && matches.length) {
    for (const m of matches) {
      if (Math.random() < 0.12) continue; // מדלג על חלק קטן כדי שייראה אנושי
      const [h, a] = scoreByStrategy(mode);
      await db.run(
        `INSERT INTO predictions (user_id, match_id, home_score, away_score, points, submitted_at)
         VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE home_score=VALUES(home_score), away_score=VALUES(away_score)`,
        [userId, m.id, h, a]
      );
      summary.predictions += 1;
    }
  }

  // ריביוים — 4-5 משחקים (עדיפות למשחקים שלא הסתיימו)
  if (options.reviews !== false && matches.length) {
    const pool = matches.filter(m => m.status !== 'finished');
    const src = (pool.length >= 5 ? pool : matches).slice();
    const chosen = [];
    const want = 4 + rnd(2); // 4-5
    while (chosen.length < want && src.length) chosen.push(src.splice(rnd(src.length), 1)[0]);
    const texts = await buildReviews(persona, chosen);
    for (let i = 0; i < chosen.length; i += 1) {
      const m = chosen[i];
      try {
        await db.run(
          `INSERT INTO match_reviews (user_id, match_id, body, status)
           VALUES (?, ?, ?, 'published')
           ON DUPLICATE KEY UPDATE body=VALUES(body), status='published'`,
          [userId, m.id, texts[i]]
        );
        summary.reviews += 1;
      } catch (e) { /* skip */ }
    }
  }

  // לייקים (אהבתי) — 20-30 על ריביוים של אחרים
  if (options.likes !== false) {
    const want = 20 + rnd(11); // 20-30
    const others = await db.query(
      `SELECT id FROM match_reviews WHERE status = "published" AND user_id <> ? ORDER BY RAND() LIMIT ${want}`,
      [userId]
    );
    for (const r of others) {
      try {
        await db.run('INSERT IGNORE INTO review_votes (review_id, voter_user_id) VALUES (?, ?)', [r.id, userId]);
        summary.likes += 1;
      } catch (e) { /* skip */ }
    }
  }

  // הצעות הימור לשחקנים אחרים (coin_special_bets)
  if (options.suggestions !== false) {
    const n = STRATEGIES[strategy]?.suggest || 1;
    const teams = await loadTeams();
    const sMin = STRATEGIES[strategy]?.stakeMin || 100;
    const sMax = STRATEGIES[strategy]?.stakeMax || 500;
    for (let i = 0; i < n && i < teams.length; i += 1) {
      const market = pick(['champion', 'runner_up']);
      const team = teams[i];
      const stake = sMin + rnd(Math.max(1, sMax - sMin));
      try {
        await createSpecialBet(userId, {
          market,
          subject_code: team.code,
          subject_label: team.name_he,
          proposition: Math.random() < 0.5 ? 'yes' : 'no',
          stake
        });
        summary.suggestions += 1;
      } catch (e) { /* אין מספיק שיחים / שוק חסום — מדלגים */ }
    }
  }

  return summary;
}

// ───────────── ריצת אצווה ברקע ─────────────
async function runBatch({ count, strategy, options }) {
  await ensureSchema();
  state.running = true; state.total = count; state.done = 0; state.failed = 0;
  state.strategy = strategy; state.startedAt = new Date().toISOString(); state.lastError = null;
  for (let i = 0; i < count; i += 1) {
    try {
      await createOne(strategy, options || {});
    } catch (e) {
      state.failed += 1; state.lastError = e.message;
      console.error('sim createOne:', e.message);
    }
    state.done += 1;
    await sleep(150);
  }
  state.running = false;
}

// מפעיל אצווה ברקע ומחזיר מיד
async function startBatch({ count, strategy, options }) {
  await ensureSchema();
  if (state.running) { const e = new Error('סימולציה כבר רצה — המתן לסיומה'); e.code = 'BUSY'; throw e; }
  const n = clamp(Math.trunc(Number(count) || 0), 1, 50);
  const strat = STRATEGY_KEYS.includes(strategy) ? strategy : 'random';
  // fire-and-forget
  runBatch({ count: n, strategy: strat, options: options || {} }).catch(e => { state.running = false; console.error('sim runBatch:', e.message); });
  return { ok: true, started: n, strategy: strat };
}

// ───────────── טבלה חיה ─────────────
async function listSim() {
  await ensureSchema();
  const rows = await db.query(`
    SELECT s.user_id, s.strategy, s.enabled, s.created_at, u.name, u.email, u.phone_number, u.profile_image_url,
           (SELECT COUNT(*) FROM predictions p WHERE p.user_id = s.user_id) AS predictions,
           (SELECT COUNT(*) FROM match_reviews r WHERE r.user_id = s.user_id) AS reviews,
           (SELECT COUNT(*) FROM review_votes v WHERE v.voter_user_id = s.user_id) AS likes,
           (SELECT COUNT(*) FROM coin_special_bets b WHERE b.creator_id = s.user_id) AS suggestions,
           COALESCE((SELECT w.balance FROM coin_wallets w WHERE w.user_id = s.user_id), 10000) AS balance
    FROM sim_users s JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC`);
  for (const r of rows) {
    r.strategy_he = STRATEGIES[r.strategy]?.he || r.strategy;
    r.enabled = !!Number(r.enabled);
    ['predictions', 'reviews', 'likes', 'suggestions', 'balance'].forEach(k => { r[k] = Number(r[k]); });
  }
  return { users: rows, progress: { ...state } };
}

// ───────────── ניהול בוט בודד ─────────────
function parsePersona(raw) { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } }

async function getOne(userId) {
  await ensureSchema();
  const id = Number(userId);
  const s = await db.one('SELECT user_id, strategy, enabled, persona, created_at FROM sim_users WHERE user_id = ?', [id]);
  if (!s) throw new Error('בוט לא נמצא');
  const u = await db.one('SELECT id, name, email, phone_number, profile_image_url FROM users WHERE id = ?', [id]);
  return {
    user_id: id,
    strategy: s.strategy,
    strategy_he: STRATEGIES[s.strategy]?.he || s.strategy,
    enabled: !!Number(s.enabled),
    persona: parsePersona(s.persona),
    name: u?.name, email: u?.email, phone_number: u?.phone_number, profile_image_url: u?.profile_image_url,
    strategies: strategies()
  };
}

async function updateOne(userId, fields) {
  await ensureSchema();
  const id = Number(userId);
  const cur = await db.one('SELECT persona, strategy FROM sim_users WHERE user_id = ?', [id]);
  if (!cur) throw new Error('בוט לא נמצא');
  const f = fields || {};
  if (f.name !== undefined)  await db.run('UPDATE users SET name = ? WHERE id = ?', [String(f.name).slice(0, 120), id]);
  if (f.phone_number !== undefined) await db.run('UPDATE users SET phone_number = ? WHERE id = ?', [String(f.phone_number).slice(0, 32), id]);
  if (f.email !== undefined && String(f.email).trim()) {
    const exists = await db.one('SELECT id FROM users WHERE email = ? AND id <> ?', [String(f.email).trim(), id]);
    if (exists) throw new Error('האימייל כבר בשימוש');
    await db.run('UPDATE users SET email = ? WHERE id = ?', [String(f.email).trim().slice(0, 190), id]);
  }
  if (f.strategy !== undefined && STRATEGY_KEYS.includes(f.strategy)) await db.run('UPDATE sim_users SET strategy = ? WHERE user_id = ?', [f.strategy, id]);
  if (f.enabled !== undefined) await db.run('UPDATE sim_users SET enabled = ? WHERE user_id = ?', [f.enabled ? 1 : 0, id]);
  if (f.persona !== undefined || f.bio !== undefined || f.style !== undefined) {
    const p = parsePersona(cur.persona);
    if (f.bio !== undefined) p.bio = String(f.bio).slice(0, 240);
    if (f.style !== undefined) p.style = String(f.style).slice(0, 120);
    if (f.avatar_hint !== undefined) p.avatar_hint = String(f.avatar_hint).slice(0, 200);
    if (typeof f.persona === 'object' && f.persona) Object.assign(p, f.persona);
    await db.run('UPDATE sim_users SET persona = ? WHERE user_id = ?', [JSON.stringify(p), id]);
  }
  return getOne(id);
}

async function setEnabled(userId, enabled) { return updateOne(userId, { enabled: !!enabled }); }

// רענון תמונת פנים עם פרומפט מותאם (אופציונלי)
async function regenerateAvatar(userId, prompt) {
  await ensureSchema();
  const id = Number(userId);
  const s = await db.one('SELECT persona FROM sim_users WHERE user_id = ?', [id]);
  if (!s) throw new Error('בוט לא נמצא');
  const persona = parsePersona(s.persona);
  const url = await generateAvatar(persona, prompt);
  if (!url) { const e = new Error('יצירת תמונה נכשלה (בדוק OPENAI_API_KEY)'); e.code = 'NO_IMAGE'; throw e; }
  await db.run('UPDATE users SET profile_image_url = ? WHERE id = ?', [url, id]);
  return { ok: true, profile_image_url: url };
}

// "היסטוריית מעשים" — ציר זמן של פעולות הבוט
async function history(userId) {
  await ensureSchema();
  const id = Number(userId);
  const events = [];
  const preds = await db.query(`SELECT p.match_id, p.home_score, p.away_score, p.submitted_at,
      COALESCE(ht.name_he, m.home_label_he, m.home_code) AS home, COALESCE(at.name_he, m.away_label_he, m.away_code) AS away
      FROM predictions p JOIN matches m ON m.id = p.match_id
      LEFT JOIN teams ht ON ht.code = m.home_code LEFT JOIN teams at ON at.code = m.away_code
      WHERE p.user_id = ? ORDER BY p.submitted_at DESC LIMIT 200`, [id]);
  for (const p of preds) events.push({ type: 'bet', at: p.submitted_at, text: `ניחש ${p.home} ${p.home_score}-${p.away_score} ${p.away}` });
  const revs = await db.query(`SELECT r.created_at, r.body, COALESCE(ht.name_he, m.home_code) AS home, COALESCE(at.name_he, m.away_code) AS away
      FROM match_reviews r JOIN matches m ON m.id = r.match_id
      LEFT JOIN teams ht ON ht.code = m.home_code LEFT JOIN teams at ON at.code = m.away_code
      WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 100`, [id]);
  for (const r of revs) events.push({ type: 'review', at: r.created_at, text: `ריביו על ${r.home}-${r.away}: ${String(r.body).slice(0, 80)}` });
  const likes = await db.query('SELECT created_at FROM review_votes WHERE voter_user_id = ? ORDER BY created_at DESC LIMIT 100', [id]);
  for (const l of likes) events.push({ type: 'like', at: l.created_at, text: 'אהבתי ריביו' });
  const sb = await db.query('SELECT created_at, market, subject_label, proposition, stake FROM coin_special_bets WHERE creator_id = ? ORDER BY created_at DESC LIMIT 100', [id]);
  for (const b of sb) events.push({ type: 'suggestion', at: b.created_at, text: `הציע הימור: ${b.subject_label} (${b.market}/${b.proposition}) על ${b.stake} שיחים` });
  events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { user_id: id, events: events.slice(0, 300) };
}

async function removeSim(userId) {
  await ensureSchema();
  const id = Number(userId);
  if (!Number.isInteger(id)) throw new Error('מזהה לא תקין');
  const row = await db.one('SELECT user_id FROM sim_users WHERE user_id = ?', [id]);
  if (!row) throw new Error('משתמש סימולציה לא נמצא');
  await db.run('DELETE FROM users WHERE id = ?', [id]); // CASCADE מנקה הכל
  return { ok: true };
}

async function removeAll() {
  await ensureSchema();
  const ids = await db.query('SELECT user_id FROM sim_users');
  for (const r of ids) { try { await db.run('DELETE FROM users WHERE id = ?', [r.user_id]); } catch (e) { /* */ } }
  return { ok: true, removed: ids.length };
}

function strategies() {
  return STRATEGY_KEYS.map(k => ({ key: k, label: STRATEGIES[k].he }));
}

module.exports = { startBatch, listSim, removeSim, removeAll, strategies, ensureSchema, getOne, updateOne, setEnabled, regenerateAvatar, history };
