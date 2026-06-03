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
  return preds.length;
}

// טבלת מצטיינים
async function leaderboard() {
  const exactWeight = await getSettingNum('scoring_exact', 5);
  const rows = await db.query(`
    SELECT
      u.id, u.name, u.profile_image_url,
      COALESCE(SUM(p.points), 0) AS match_points,
      COUNT(p.id) AS num_predictions,
      SUM(CASE WHEN p.points = ? THEN 1 ELSE 0 END) AS exact_hits
    FROM users u
    LEFT JOIN predictions p ON p.user_id = u.id
    WHERE u.is_admin = 0
    GROUP BY u.id, u.name, u.profile_image_url
  `, [exactWeight]);

  // המרת מספרים שמגיעים כמחרוזות ב-MySQL/JS (SUM/COUNT)
  for (const r of rows) {
    r.match_points    = Number(r.match_points    || 0);
    r.num_predictions = Number(r.num_predictions || 0);
    r.exact_hits      = Number(r.exact_hits      || 0);
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
  return rows;
}

module.exports = { calcPoints, recalcForMatch, leaderboard };
