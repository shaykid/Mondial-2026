// מנוע חישוב ניקוד (async/MySQL)
const db = require('../db');

async function getSettingNum(key, def) {
  const r = await db.one('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  return r ? Number(r.value) : def;
}

async function getSettingStr(key) {
  const r = await db.one('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  return r ? r.value : null;
}

// חישוב נקודות לניחוש בודד מול תוצאה אמיתית
async function calcPoints(predHome, predAway, actHome, actAway, weights) {
  if (actHome == null || actAway == null) return 0;
  const w = weights || {
    exact:    await getSettingNum('scoring_exact', 5),
    result:   await getSettingNum('scoring_result', 3),
    goalDiff: await getSettingNum('scoring_goal_diff', 1)
  };

  if (predHome === actHome && predAway === actAway) return w.exact;

  const predOutcome = Math.sign(predHome - predAway);
  const actOutcome  = Math.sign(actHome  - actAway);
  let points = 0;
  if (predOutcome === actOutcome) {
    points += w.result;
    if ((predHome - predAway) === (actHome - actAway)) {
      points += w.goalDiff;
    }
  }
  return points;
}

// עדכון ניקוד לכל הניחושים של משחק שהסתיים
async function recalcForMatch(matchId) {
  const match = await db.one('SELECT * FROM matches WHERE id = ?', [matchId]);
  if (!match || match.status !== 'finished' || match.home_score == null) return 0;

  const weights = {
    exact:    await getSettingNum('scoring_exact', 5),
    result:   await getSettingNum('scoring_result', 3),
    goalDiff: await getSettingNum('scoring_goal_diff', 1)
  };

  const preds = await db.query('SELECT * FROM predictions WHERE match_id = ?', [matchId]);
  await db.tx(async (t) => {
    for (const p of preds) {
      const pts = await calcPoints(p.home_score, p.away_score, match.home_score, match.away_score, weights);
      await t.run('UPDATE predictions SET points = ? WHERE id = ?', [pts, p.id]);
    }
  });

  // עדכון ניקוד גם להימורי הקבוצות (ניחוש קבוצתי) על אותו משחק
  await recalcGroupBetsForMatch(matchId);

  return preds.length;
}

// ────────── ניחוש קבוצתי (Guess-Groups) ──────────

const GROUP_MULTIPLIER_CAP = 5; // ברירת מחדל; ניתן לשינוי דרך ההגדרה group_multiplier_cap

// מכפיל הקבוצה לפי מספר החברים (2 חברים → ×2 ... cap, יחיד → ×1)
function groupMultiplier(memberCount, cap = GROUP_MULTIPLIER_CAP) {
  return Math.min(Math.max(Number(memberCount) || 1, 1), Number(cap) || GROUP_MULTIPLIER_CAP);
}

// חישוב נקודות להימור קבוצתי בודד (pick: 'home'|'draw'|'away') מול תוצאה אמיתית.
// ניחוש נכון → base × מכפיל. בחרו צד אך יצא תיקו → חצי. תוצאה הפוכה → 0.
function calcGroupBetPoints(pick, actHome, actAway, memberCount, baseWeight, cap = GROUP_MULTIPLIER_CAP) {
  if (actHome == null || actAway == null) return 0;
  const mult = groupMultiplier(memberCount, cap);
  const full = (Number(baseWeight) || 0) * mult;
  const actOutcome = Math.sign(actHome - actAway); // 1 בית, -1 חוץ, 0 תיקו
  const pickOutcome = pick === 'home' ? 1 : pick === 'away' ? -1 : 0;

  if (pickOutcome === actOutcome) return full;                 // ניחוש מדויק של הכיוון
  if (pickOutcome !== 0 && actOutcome === 0) return Math.round(full / 2); // צד מול תיקו → חצי
  return 0;                                                     // הפוך / תיקו שגוי
}

// עדכון נקודות לכל הימורי הקבוצות על משחק שהסתיים
async function recalcGroupBetsForMatch(matchId) {
  const match = await db.one('SELECT * FROM matches WHERE id = ?', [matchId]);
  if (!match || match.status !== 'finished' || match.home_score == null) return 0;

  const baseWeight = await getSettingNum('scoring_result', 3);
  const cap = await getSettingNum('group_multiplier_cap', GROUP_MULTIPLIER_CAP);

  const bets = await db.query(`
    SELECT b.id, b.group_id, b.pick,
      (SELECT COUNT(*) FROM guess_group_members m WHERE m.group_id = b.group_id) AS member_count
    FROM guess_group_bets b
    WHERE b.match_id = ?
  `, [matchId]);

  await db.tx(async (t) => {
    for (const b of bets) {
      const pts = calcGroupBetPoints(b.pick, match.home_score, match.away_score, b.member_count, baseWeight, cap);
      await t.run('UPDATE guess_group_bets SET points = ? WHERE id = ?', [pts, b.id]);
    }
  });
  return bets.length;
}

// טבלת מצטיינים של קבוצות הניחוש (האלמנט החי)
async function groupLeaderboard() {
  // הערה: שימוש בתת-שאילתות (ולא ב-JOIN כפול לחברים+הימורים) כדי למנוע
  // הכפלה קרטזית של SUM(points) לפי מספר החברים.
  const groups = await db.query(`
    SELECT g.id, g.name, g.description, g.leader_user_id, g.entry_cost,
      lu.name AS leader_name,
      (SELECT COUNT(*) FROM guess_group_members m WHERE m.group_id = g.id) AS member_count,
      (SELECT COALESCE(SUM(b.points), 0) FROM guess_group_bets b WHERE b.group_id = g.id) AS total_points,
      (SELECT COUNT(*) FROM guess_group_bets b WHERE b.group_id = g.id AND b.points > 0) AS winning_bets,
      (SELECT COUNT(*) FROM guess_group_bets b WHERE b.group_id = g.id) AS total_bets
    FROM guess_groups g
    LEFT JOIN users lu ON lu.id = g.leader_user_id
  `);

  const cap = await getSettingNum('group_multiplier_cap', GROUP_MULTIPLIER_CAP);
  for (const g of groups) {
    g.member_count = Number(g.member_count || 0);
    g.total_points = Number(g.total_points || 0);
    g.winning_bets = Number(g.winning_bets || 0);
    g.total_bets   = Number(g.total_bets || 0);
    g.entry_cost   = Number(g.entry_cost || 0);
    g.multiplier   = groupMultiplier(g.member_count, cap);
  }

  // חברי כל קבוצה (לתצוגה בלוח ובבאנר)
  if (groups.length) {
    const members = await db.query(`
      SELECT m.group_id, u.id, u.name, u.profile_image_url, m.role
      FROM guess_group_members m
      JOIN users u ON u.id = m.user_id
      ORDER BY m.role = 'leader' DESC, u.name ASC
    `);
    const byGroup = new Map();
    for (const mem of members) {
      if (!byGroup.has(mem.group_id)) byGroup.set(mem.group_id, []);
      byGroup.get(mem.group_id).push({
        id: mem.id, name: mem.name, profile_image_url: mem.profile_image_url, role: mem.role
      });
    }
    for (const g of groups) g.members = byGroup.get(g.id) || [];
  }

  groups.sort((a, b) => {
    if (b.total_points !== a.total_points) return b.total_points - a.total_points;
    if (b.winning_bets !== a.winning_bets) return b.winning_bets - a.winning_bets;
    return a.name.localeCompare(b.name);
  });

  // הקצאת דירוג עם טיפול בשוויון (1, 1, 3, ...)
  let lastPts = null, lastRank = 0;
  groups.forEach((g, i) => {
    if (g.total_points !== lastPts) {
      lastRank = i + 1;
      lastPts = g.total_points;
    }
    g.rank = lastRank;
  });
  return groups;
}

// סך הנקודות האישיות של המשתמש (ניחושי משחקים + בונוס מיוחד)
async function userTotalPoints(userId) {
  const row = await db.one('SELECT COALESCE(SUM(points), 0) AS pts FROM predictions WHERE user_id = ?', [userId]);
  let total = Number(row?.pts || 0);

  const champ = await getSettingNum('scoring_champion', 20);
  const ru    = await getSettingNum('scoring_runner_up', 10);
  const ts    = await getSettingNum('scoring_top_scorer', 15);
  const realChampion  = await getSettingStr('real_champion');
  const realRunnerUp  = await getSettingStr('real_runner_up');
  const realTopScorer = await getSettingStr('real_top_scorer');
  const s = await db.one('SELECT * FROM special_predictions WHERE user_id = ?', [userId]);
  if (s) {
    if (realChampion  && s.champion_code  === realChampion)  total += champ;
    if (realRunnerUp  && s.runner_up_code === realRunnerUp)  total += ru;
    if (realTopScorer && s.top_scorer &&
        s.top_scorer.trim().toLowerCase() === realTopScorer.trim().toLowerCase()) total += ts;
  }
  return total;
}

// נקודות זמינות = נקודות אישיות פחות מה שכבר שולם כדמי כניסה לקבוצות
async function userAvailablePoints(userId) {
  const total = await userTotalPoints(userId);
  const spentRow = await db.one('SELECT COALESCE(SUM(paid_points), 0) AS spent FROM guess_group_members WHERE user_id = ?', [userId]);
  return total - Number(spentRow?.spent || 0);
}

// סטטיסטיקות קבוצתיות עבור משתמש בודד (לעמוד הפרופיל)
async function userGroupStats(userId) {
  const board = await groupLeaderboard();
  const myGroups = board.filter(g => (g.members || []).some(m => m.id === userId));

  // כמה שילם המשתמש בכל קבוצה (דמי כניסה)
  const paidRows = await db.query(
    'SELECT group_id, paid_points FROM guess_group_members WHERE user_id = ?', [userId]);
  const paidByGroup = new Map(paidRows.map(r => [r.group_id, Number(r.paid_points || 0)]));

  const totalGroupPoints = myGroups.reduce((s, g) => s + g.total_points, 0);
  const totalPaid = myGroups.reduce((s, g) => s + (paidByGroup.get(g.id) || 0), 0);
  const bestGroup = myGroups.reduce((best, g) =>
    (!best || g.total_points > best.total_points) ? g : best, null);

  // עם מי ניחשתי הכי הרבה — חבר משותף במספר הקבוצות הגדול ביותר, שובר שוויון לפי נקודות משותפות
  const partners = new Map(); // userId → { name, groups, points }
  for (const g of myGroups) {
    for (const m of (g.members || [])) {
      if (m.id === userId) continue;
      const p = partners.get(m.id) || { id: m.id, name: m.name, profile_image_url: m.profile_image_url, groups: 0, points: 0 };
      p.groups += 1;
      p.points += g.total_points;
      partners.set(m.id, p);
    }
  }
  const topPartner = [...partners.values()].sort((a, b) =>
    (b.groups - a.groups) || (b.points - a.points))[0] || null;

  const available = await userAvailablePoints(userId);

  return {
    groups_count: myGroups.length,
    total_group_points: totalGroupPoints,
    total_paid: totalPaid,
    net_group_points: totalGroupPoints - totalPaid,
    available_points: available,
    best_group: bestGroup ? { id: bestGroup.id, name: bestGroup.name, points: bestGroup.total_points, rank: bestGroup.rank } : null,
    top_partner: topPartner,
    // כל קבוצה: עלות (מה ששולם) והרווח הנוכחי ממנה — לעמוד החבר
    groups: myGroups.map(g => ({
      id: g.id, name: g.name, points: g.total_points, rank: g.rank,
      member_count: g.member_count, multiplier: g.multiplier,
      entry_cost: g.entry_cost,
      cost: paidByGroup.get(g.id) || 0,
      earned: g.total_points
    }))
  };
}

// טבלת מצטיינים
async function leaderboard() {
  const exactWeight    = await getSettingNum('scoring_exact', 5);
  const resultWeight   = await getSettingNum('scoring_result', 3);
  const goalDiffWeight = await getSettingNum('scoring_goal_diff', 1);
  const gdHitPoints    = resultWeight + goalDiffWeight; // נקודות עבור כיוון נכון + הפרש נכון

  const rows = await db.query(`
    SELECT
      u.id, u.name, u.profile_image_url,
      COALESCE(SUM(p.points), 0) AS match_points,
      COUNT(p.id) AS num_predictions,
      SUM(CASE WHEN p.points = ? THEN 1 ELSE 0 END) AS exact_hits,
      SUM(CASE WHEN p.points > 0 THEN 1 ELSE 0 END) AS outcome_hits,
      SUM(CASE WHEN p.points = ? THEN 1 ELSE 0 END) AS gd_hits
    FROM users u
    LEFT JOIN predictions p ON p.user_id = u.id
    WHERE u.is_admin = 0 AND u.is_guest = 0
    GROUP BY u.id, u.name, u.profile_image_url
  `, [exactWeight, gdHitPoints]);

  // המרת מספרים שמגיעים כמחרוזות ב-MySQL/JS (SUM/COUNT)
  for (const r of rows) {
    r.match_points    = Number(r.match_points    || 0);
    r.num_predictions = Number(r.num_predictions || 0);
    r.exact_hits      = Number(r.exact_hits      || 0);
    r.outcome_hits    = Number(r.outcome_hits    || 0);
    r.gd_hits         = Number(r.gd_hits         || 0);
    // אם הפרש-שערים שווה למדויק (משקלים חריגים) — אל תספור פעמיים
    if (gdHitPoints === exactWeight) r.gd_hits = 0;
  }

  const champ = await getSettingNum('scoring_champion', 20);
  const ru    = await getSettingNum('scoring_runner_up', 10);
  const ts    = await getSettingNum('scoring_top_scorer', 15);
  const realChampion  = await getSettingStr('real_champion');
  const realRunnerUp  = await getSettingStr('real_runner_up');
  const realTopScorer = await getSettingStr('real_top_scorer');

  const specials = await db.query('SELECT * FROM special_predictions');
  const specialByUser = new Map(specials.map(s => [s.user_id, s]));

  for (const r of rows) {
    const s = specialByUser.get(r.id);
    let bonus = 0;
    if (s) {
      if (realChampion  && s.champion_code  === realChampion)  bonus += champ;
      if (realRunnerUp  && s.runner_up_code === realRunnerUp)  bonus += ru;
      if (realTopScorer && s.top_scorer &&
          s.top_scorer.trim().toLowerCase() === realTopScorer.trim().toLowerCase()) {
        bonus += ts;
      }
    }
    r.bonus_points = bonus;
    r.total_points = r.match_points + bonus;
  }

  rows.sort((a, b) => {
    if (b.total_points !== a.total_points) return b.total_points - a.total_points;
    return b.exact_hits - a.exact_hits;
  });

  // הקצאת דירוג עם טיפול בשוויון (1, 1, 3, ...)
  let lastPts = null, lastRank = 0;
  rows.forEach((r, i) => {
    if (r.total_points !== lastPts) {
      lastRank = i + 1;
      lastPts = r.total_points;
    }
    r.rank = lastRank;
  });

  // תגי הישג דינמיים — מתעדכנים בכל פעם שמשחק מסתיים (הנתונים מחושבים מחדש)
  await assignLeaderboardBadges(rows);

  return rows;
}

// ────────── תגי הישג בטבלת המצטיינים (10 תגים דינמיים) ──────────
// מתעדכנים בכל מחזור (סיום משחק / חישוב מחדש) — משתמש יכול לזכות/לאבד תג.
// הקונפיגורציה ניתנת לעריכה בלוח הניהול (הגדרה badges_config): הפעלה/כיבוי, אימוג'י, וספים.
const DEFAULT_BADGE_CONFIG = {
  badges: {
    crown:         { enabled: true, emoji: '👑' },
    leader:        { enabled: true, emoji: '🏆' },
    oracle:        { enabled: true, emoji: '🧠' },
    goal_machine:  { enabled: true, emoji: '⚽' },
    sharpshooter:  { enabled: true, emoji: '🎯' },
    streak:        { enabled: true, emoji: '🔥' },
    perfectionist: { enabled: true, emoji: '💎' },
    dedicated:     { enabled: true, emoji: '🦅' },
    centurion:     { enabled: true, emoji: '💯' },
    prophet:       { enabled: true, emoji: '⭐' }
  },
  // min_points: רף נקודות מינימלי כדי לקבל תגים בכלל (תגים מוענקים רק למי שמעל הסף)
  thresholds: { centurion_points: 100, min_predictions: 5, min_streak: 2, min_points: 13 }
};

async function loadBadgeConfig() {
  const raw = await getSettingStr('badges_config');
  if (!raw) return DEFAULT_BADGE_CONFIG;
  try {
    const parsed = JSON.parse(raw);
    return {
      badges:     { ...DEFAULT_BADGE_CONFIG.badges,     ...(parsed.badges || {}) },
      thresholds: { ...DEFAULT_BADGE_CONFIG.thresholds, ...(parsed.thresholds || {}) }
    };
  } catch {
    return DEFAULT_BADGE_CONFIG;
  }
}

// רצף "חם": אורך הרצף הנוכחי של ניחושים מזכי-נקודות (לפי סדר תאריך משחק)
async function computeCurrentStreaks() {
  const rows = await db.query(`
    SELECT p.user_id AS uid, p.points AS pts
    FROM predictions p
    JOIN matches m ON m.id = p.match_id
    WHERE m.status = 'finished' AND m.home_score IS NOT NULL
    ORDER BY p.user_id, m.kickoff ASC, m.id ASC
  `);
  const streaks = new Map();
  let curUser = null, running = 0;
  for (const r of rows) {
    if (r.uid !== curUser) { curUser = r.uid; running = 0; }
    running = Number(r.pts) > 0 ? running + 1 : 0;
    streaks.set(r.uid, running); // הערך האחרון = הרצף הנוכחי (מסתיים במשחק האחרון)
  }
  return streaks;
}

// מקצה תג (אובייקט {id, emoji}) למחזיק/י הערך המקסימלי בשדה (תיקו → כולם), בכפוף לסף.
// מדלג אם התג כבוי בקונפיגורציה.
function assignTopBadge(rows, valueFn, badgeId, cfg, { min = 1, eligibleFn = null } = {}) {
  const def = cfg.badges[badgeId];
  if (!def || !def.enabled) return;
  let best = -Infinity;
  for (const r of rows) {
    if (eligibleFn && !eligibleFn(r)) continue;
    const v = valueFn(r);
    if (v > best) best = v;
  }
  if (best < min) return;
  for (const r of rows) {
    if (eligibleFn && !eligibleFn(r)) continue;
    if (valueFn(r) === best) r.badges.push({ id: badgeId, emoji: def.emoji });
  }
}

function pushBadge(r, badgeId, cfg) {
  const def = cfg.badges[badgeId];
  if (def && def.enabled) r.badges.push({ id: badgeId, emoji: def.emoji });
}

async function assignLeaderboardBadges(rows) {
  const cfg = await loadBadgeConfig();
  const minPreds = Number(cfg.thresholds.min_predictions) || 5;
  const minStreak = Number(cfg.thresholds.min_streak) || 2;
  const centurionPts = Number(cfg.thresholds.centurion_points) || 100;
  const minPoints = Number.isFinite(Number(cfg.thresholds.min_points)) ? Number(cfg.thresholds.min_points) : 13;

  for (const r of rows) {
    r.badges = [];
    r.accuracy    = r.num_predictions > 0 ? r.match_points / r.num_predictions : 0;
    r.exact_ratio = r.num_predictions > 0 ? r.exact_hits / r.num_predictions : 0;
  }
  const streaks = await computeCurrentStreaks();
  for (const r of rows) r.current_streak = streaks.get(r.id) || 0;

  // תגים מוענקים אך ורק למשתמשים עם יותר מ-minPoints נקודות
  const eligibleRows = rows.filter(r => Number(r.total_points) > minPoints);

  const enoughPreds = (r) => r.num_predictions >= minPreds;

  // תגי-על (מחזיק יחיד / שוברי-שוויון) — מתחלפים עם שינוי הנתונים
  assignTopBadge(eligibleRows, r => r.exact_hits,      'crown',         cfg, { min: 1 });
  assignTopBadge(eligibleRows, r => r.outcome_hits,    'oracle',        cfg, { min: 1 });
  assignTopBadge(eligibleRows, r => r.gd_hits,         'goal_machine',  cfg, { min: 1 });
  assignTopBadge(eligibleRows, r => r.num_predictions, 'dedicated',     cfg, { min: 1 });
  assignTopBadge(eligibleRows, r => r.current_streak,  'streak',        cfg, { min: minStreak });
  assignTopBadge(eligibleRows, r => r.accuracy,        'sharpshooter',  cfg, { min: 0.0001, eligibleFn: enoughPreds });
  assignTopBadge(eligibleRows, r => r.exact_ratio,     'perfectionist', cfg, { min: 0.0001, eligibleFn: enoughPreds });

  // תגי-סף (כל מי שעומד בתנאי) — גם הם רק למעל הסף
  for (const r of eligibleRows) {
    if (r.rank === 1 && r.total_points > 0) pushBadge(r, 'leader', cfg);
    if (r.total_points >= centurionPts) pushBadge(r, 'centurion', cfg);
    if (r.bonus_points > 0) pushBadge(r, 'prophet', cfg);
  }
}

module.exports = {
  calcPoints, recalcForMatch, leaderboard,
  calcGroupBetPoints, groupMultiplier, recalcGroupBetsForMatch, groupLeaderboard, userGroupStats,
  userTotalPoints, userAvailablePoints,
  loadBadgeConfig, DEFAULT_BADGE_CONFIG,
  GROUP_MULTIPLIER_CAP
};
