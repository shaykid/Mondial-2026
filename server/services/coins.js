// שירות הימורי מטבעות ("שיחים") — ארנקים, יישוב הימורים, לוח מצטיינים
const db = require('../db');

const START_BALANCE = 10000; // יתרת פתיחה לכל משתמש

async function getSettingNum(key, def) {
  const r = await db.one('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  const n = r ? Number(r.value) : NaN;
  return Number.isFinite(n) ? n : def;
}

// יוצר ארנק אם חסר (מחוץ לטרנזקציה). מחזיר את היתרה.
async function ensureWallet(userId) {
  const r = await db.run(
    'INSERT IGNORE INTO coin_wallets (user_id, balance) VALUES (?, ?)',
    [userId, START_BALANCE]
  );
  if (r.affectedRows) {
    await db.run(
      'INSERT INTO coin_transactions (user_id, amount, reason, balance_after) VALUES (?, ?, ?, ?)',
      [userId, START_BALANCE, 'seed', START_BALANCE]
    );
  }
  const w = await db.one('SELECT balance FROM coin_wallets WHERE user_id = ?', [userId]);
  return w ? Number(w.balance) : START_BALANCE;
}

// גרסת-טרנזקציה: מוודא ארנק בתוך t
async function ensureWalletTx(t, userId) {
  const r = await t.run(
    'INSERT IGNORE INTO coin_wallets (user_id, balance) VALUES (?, ?)',
    [userId, START_BALANCE]
  );
  if (r.affectedRows) {
    await t.run(
      'INSERT INTO coin_transactions (user_id, amount, reason, balance_after) VALUES (?, ?, ?, ?)',
      [userId, START_BALANCE, 'seed', START_BALANCE]
    );
  }
}

// משנה יתרה בתוך טרנזקציה ורושם לספר החשבונות. מחזיר את היתרה החדשה.
async function adjust(t, userId, amount, reason, betId = null) {
  await ensureWalletTx(t, userId);
  await t.run('UPDATE coin_wallets SET balance = balance + ? WHERE user_id = ?', [amount, userId]);
  const w = await t.one('SELECT balance FROM coin_wallets WHERE user_id = ?', [userId]);
  const balanceAfter = w ? Number(w.balance) : amount;
  await t.run(
    'INSERT INTO coin_transactions (user_id, amount, reason, bet_id, balance_after) VALUES (?, ?, ?, ?, ?)',
    [userId, amount, reason, betId, balanceAfter]
  );
  return balanceAfter;
}

function outcomeOf(match) {
  if (match.home_score == null || match.away_score == null) return null;
  if (match.home_score > match.away_score) return 'home';
  if (match.home_score < match.away_score) return 'away';
  return 'draw';
}

// יישוב כל ההימורים על משחק שהסתיים. נקרא מתוך recalcForMatch.
// matched → המנצח לוקח 2X. open (לא נתפס) → החזר ליוצר וביטול.
async function settleCoinBetsForMatch(matchId) {
  const match = await db.one('SELECT * FROM matches WHERE id = ?', [matchId]);
  if (!match || match.status !== 'finished') return;
  const outcome = outcomeOf(match);
  if (!outcome) return;

  const bets = await db.query(
    "SELECT * FROM coin_bets WHERE match_id = ? AND status IN ('open','matched')",
    [matchId]
  );
  if (!bets.length) return;

  await db.tx(async (t) => {
    for (const bet of bets) {
      if (bet.status === 'open') {
        // לא נתפס בזמן — החזר ליוצר ובטל
        await adjust(t, bet.creator_id, bet.stake, 'bet_void_refund', bet.id);
        await t.run(
          "UPDATE coin_bets SET status = 'void', settled_at = CURRENT_TIMESTAMP WHERE id = ?",
          [bet.id]
        );
        continue;
      }
      // matched — היוצר הימר על bet.proposition; היריב על ההפך
      const creatorWon = outcome === bet.proposition;
      const winnerId = creatorWon ? bet.creator_id : bet.opponent_id;
      await adjust(t, winnerId, bet.stake * 2, 'bet_win', bet.id);
      await t.run(
        "UPDATE coin_bets SET status = 'settled', winner_id = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ?",
        [winnerId, bet.id]
      );
    }
  });
}

// לוח מצטיינים לפי יתרת מטבעות + סטטיסטיקות הימורים
// תגמול מטבעות לכותב ריביו לפי מספר ההצבעות, ×5 אם הניחוש שלו היה מדויק.
// אידמפוטנטי: שומר coins_awarded ומזכה רק את ההפרש — בטוח להרצה חוזרת ומתעדכן
// כשמגיעות הצבעות נוספות (גם אחרי שהמשחק הסתיים).
async function settleReviewReward(review) {
  const match = await db.one('SELECT id, status, home_score, away_score FROM matches WHERE id = ?', [review.match_id]);
  if (!match || match.status !== 'finished' || match.home_score == null || match.away_score == null) return;

  const votesRow = await db.one('SELECT COUNT(*) AS n FROM review_votes WHERE review_id = ?', [review.id]);
  const votes = Number(votesRow?.n || 0);

  const pred = await db.one(
    'SELECT home_score, away_score FROM predictions WHERE user_id = ? AND match_id = ?',
    [review.user_id, review.match_id]
  );
  const correct = !!pred && pred.home_score === match.home_score && pred.away_score === match.away_score;

  const perVote = await getSettingNum('review_coins_per_vote', 50);
  const multiplier = await getSettingNum('review_correct_multiplier', 5);
  const target = votes * perVote * (correct ? multiplier : 1);
  const delta = target - Number(review.coins_awarded || 0);
  if (delta === 0) return;

  await db.tx(async (t) => {
    // עדכון אטומי: מזכה רק אם coins_awarded לא השתנה בינתיים
    const upd = await t.run(
      'UPDATE match_reviews SET coins_awarded = ? WHERE id = ? AND coins_awarded = ?',
      [target, review.id, Number(review.coins_awarded || 0)]
    );
    if (upd.affectedRows) {
      await adjust(t, review.user_id, delta, 'review_reward');
    }
  });
}

// יישוב תגמולי הריביו לכל הריביוים על משחק שהסתיים. נקרא מתוך recalcForMatch.
async function settleReviewRewardsForMatch(matchId) {
  const reviews = await db.query(
    "SELECT id, user_id, match_id, coins_awarded FROM match_reviews WHERE match_id = ? AND status = 'published'",
    [matchId]
  );
  for (const r of reviews) await settleReviewReward(r);
}

async function coinLeaderboard() {
  const rows = await db.query(`
    SELECT u.id, u.name, u.profile_image_url,
      COALESCE(w.balance, ?) AS balance,
      (SELECT COUNT(*) FROM coin_bets b
         WHERE b.status = 'settled' AND (b.creator_id = u.id OR b.opponent_id = u.id)) AS bets_settled,
      (SELECT COUNT(*) FROM coin_bets b
         WHERE b.status = 'settled' AND b.winner_id = u.id) AS bets_won
    FROM users u
    LEFT JOIN coin_wallets w ON w.user_id = u.id
    WHERE u.is_admin = 0 AND u.is_guest = 0
    ORDER BY balance DESC, bets_won DESC, u.name ASC
  `, [START_BALANCE]);

  rows.forEach(r => {
    r.balance = Number(r.balance);
    r.bets_settled = Number(r.bets_settled);
    r.bets_won = Number(r.bets_won);
    r.win_rate = r.bets_settled ? Math.round((r.bets_won / r.bets_settled) * 100) : 0;
  });

  // דירוג עם טיפול בשוויון (1, 1, 3, ...)
  let lastBal = null, lastRank = 0;
  rows.forEach((r, i) => {
    if (r.balance !== lastBal) { lastRank = i + 1; lastBal = r.balance; }
    r.rank = lastRank;
  });
  return rows;
}

async function userCoinStats(userId) {
  const balance = await ensureWallet(userId);
  const agg = await db.one(`
    SELECT
      SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END) AS settled,
      SUM(CASE WHEN status = 'settled' AND winner_id = ? THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN status = 'open' AND opponent_id IS NULL THEN 1 ELSE 0 END) AS open_offers,
      SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) AS active
    FROM coin_bets
    WHERE creator_id = ? OR opponent_id = ?
  `, [userId, userId, userId]);

  const board = await coinLeaderboard();
  const me = board.find(r => r.id === userId) || null;

  return {
    balance,
    rank: me ? me.rank : null,
    players_count: board.length,
    bets_settled: Number(agg?.settled || 0),
    bets_won: Number(agg?.won || 0),
    open_offers: Number(agg?.open_offers || 0),
    active_bets: Number(agg?.active || 0),
    win_rate: Number(agg?.settled) ? Math.round((Number(agg.won) / Number(agg.settled)) * 100) : 0
  };
}

module.exports = {
  START_BALANCE,
  ensureWallet,
  adjust,
  outcomeOf,
  settleCoinBetsForMatch,
  settleReviewReward,
  settleReviewRewardsForMatch,
  coinLeaderboard,
  userCoinStats
};
