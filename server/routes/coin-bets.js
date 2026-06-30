// נתיבי הימורי מטבעות ("שיחים") — לוח הצעות פתוח, אתגור ישיר, יישוב אוטומטי 1:1
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ensureWallet, adjust, coinLeaderboard, userCoinStats, setChallengeOpen, START_BALANCE,
  createSpecialBet, acceptSpecialBet, cancelSpecialBet, listOpenSpecialBets, listMySpecialBets } = require('../services/coins');

const router = express.Router();

// מתג ראשי: אם מערכת השיחים כבויה — כל ה-API חסום
router.use(async (req, res, next) => {
  try {
    const row = await db.one("SELECT `value` FROM settings WHERE `key` = 'coins_system_enabled'");
    const enabled = row == null ? true : ['1', 'true', 'on', 'yes'].includes(String(row.value).toLowerCase());
    if (!enabled) return res.status(403).json({ error: 'מערכת השיחים אינה פעילה', coins_disabled: true });
    next();
  } catch (e) { next(); }
});

// ───────── הימורי ניחושים מיוחדים (אלופה/סגנית/מלך שערים) ─────────
router.get('/special/open', auth(), async (req, res) => {
  try { res.json(await listOpenSpecialBets(req.user.id)); }
  catch (e) { console.error('special/open:', e); res.status(500).json({ error: 'שגיאת שרת' }); }
});
router.get('/special/mine', auth(), async (req, res) => {
  try { res.json(await listMySpecialBets(req.user.id)); }
  catch (e) { console.error('special/mine:', e); res.status(500).json({ error: 'שגיאת שרת' }); }
});
router.post('/special', auth(), async (req, res) => {
  try { res.json(await createSpecialBet(req.user.id, req.body || {})); }
  catch (e) { res.status(400).json({ error: e.message || 'שגיאה' }); }
});
router.post('/special/:id/accept', auth(), async (req, res) => {
  try { res.json(await acceptSpecialBet(Number(req.params.id), req.user.id)); }
  catch (e) { res.status(400).json({ error: e.message || 'שגיאה' }); }
});
router.post('/special/:id/cancel', auth(), async (req, res) => {
  try { res.json(await cancelSpecialBet(Number(req.params.id), req.user.id)); }
  catch (e) { res.status(400).json({ error: e.message || 'שגיאה' }); }
});

const PROPS = ['home', 'draw', 'away'];

async function getSetting(key, def) {
  const r = await db.one('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  return r ? r.value : def;
}

function kickoffMs(match) {
  const raw = String(match.kickoff);
  return new Date(raw.endsWith('Z') ? raw : `${raw.replace(' ', 'T')}Z`).getTime();
}

async function isMatchLocked(match) {
  const lockHours = Number(await getSetting('lock_hours_before', 1));
  return Date.now() >= kickoffMs(match) - lockHours * 60 * 60 * 1000;
}

// אורחים לא יכולים להמר
function blockGuest(req, res) {
  if (req.user.isGuest) { res.status(403).json({ error: 'אורחים אינם יכולים להמר' }); return true; }
  return false;
}

// ───────── ארנק ─────────
router.get('/wallet', auth(), async (req, res) => {
  try {
    const balance = await ensureWallet(req.user.id);
    const w = await db.one('SELECT challenge_open FROM coin_wallets WHERE user_id = ?', [req.user.id]);
    res.json({ balance, start_balance: START_BALANCE, challenge_open: !!(w && w.challenge_open) });
  } catch (e) {
    console.error('coins/wallet:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// פתוח/סגור לאתגרי ניחוש
router.post('/challenge-visibility', auth(), async (req, res) => {
  try {
    if (req.user.isGuest) return res.status(403).json({ error: 'אורחים אינם יכולים' });
    await setChallengeOpen(req.user.id, !!req.body?.open);
    res.json({ ok: true, challenge_open: !!req.body?.open });
  } catch (e) {
    console.error('coins/challenge-visibility:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── סטטיסטיקות אישיות ─────────
router.get('/stats', auth(), async (req, res) => {
  try {
    res.json(await userCoinStats(req.user.id));
  } catch (e) {
    console.error('coins/stats:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── לוח מצטיינים ─────────
router.get('/leaderboard', auth(), async (req, res) => {
  try {
    res.json(await coinLeaderboard());
  } catch (e) {
    console.error('coins/leaderboard:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── ההימורים שלי (יצרתי / קיבלתי) ─────────
router.get('/mine', auth(), async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT b.*, m.home_code, m.away_code, m.kickoff, m.status AS match_status,
             m.home_score, m.away_score,
             cu.name AS creator_name, ou.name AS opponent_name, tu.name AS target_name,
             EXISTS(SELECT 1 FROM coin_bet_participants p WHERE p.bet_id = b.id AND p.opponent_id = ?) AS i_accepted,
             (SELECT p.won FROM coin_bet_participants p WHERE p.bet_id = b.id AND p.opponent_id = ?) AS my_won
      FROM coin_bets b
      JOIN matches m ON m.id = b.match_id
      JOIN users cu ON cu.id = b.creator_id
      LEFT JOIN users ou ON ou.id = b.opponent_id
      LEFT JOIN users tu ON tu.id = b.target_user_id
      WHERE b.creator_id = ? OR b.opponent_id = ?
        OR EXISTS(SELECT 1 FROM coin_bet_participants p WHERE p.bet_id = b.id AND p.opponent_id = ?)
      ORDER BY b.created_at DESC
    `, [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]);
    rows.forEach(r => { r.i_accepted = !!Number(r.i_accepted); });
    res.json(rows);
  } catch (e) {
    console.error('coins/mine:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── לוח הצעות פתוח (הצעות של אחרים שאפשר לקבל) ─────────
router.get('/open', auth(), async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT b.id, b.match_id, b.proposition, b.stake, b.creator_id, b.target_user_id, b.created_at,
             b.max_acceptors, b.accepted_count,
             m.home_code, m.away_code, m.kickoff, m.status AS match_status,
             cu.name AS creator_name, cu.profile_image_url AS creator_image
      FROM coin_bets b
      JOIN matches m ON m.id = b.match_id
      JOIN users cu ON cu.id = b.creator_id
      WHERE b.status = 'open'
        AND b.creator_id <> ?
        AND b.accepted_count < b.max_acceptors
        AND (b.target_user_id IS NULL OR b.target_user_id = ?)
        AND NOT EXISTS (SELECT 1 FROM coin_bet_participants p WHERE p.bet_id = b.id AND p.opponent_id = ?)
        AND m.status <> 'finished'
      ORDER BY b.created_at DESC
    `, [req.user.id, req.user.id, req.user.id]);
    // סינון משחקים נעולים
    const out = [];
    for (const b of rows) {
      if (!(await isMatchLocked(b))) out.push(b);
    }
    res.json(out);
  } catch (e) {
    console.error('coins/open:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── רשימת משתמשים לאתגור ישיר ─────────
router.get('/users', auth(), async (req, res) => {
  try {
    const q = `%${String(req.query.q || '').trim()}%`;
    const rows = await db.query(
      `SELECT id, name FROM users
       WHERE is_admin = 0 AND is_guest = 0 AND id <> ? AND name LIKE ?
       ORDER BY name ASC LIMIT 20`,
      [req.user.id, q]
    );
    res.json(rows);
  } catch (e) {
    console.error('coins/users:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── מצא יריב: משתמשים שהניחוש שלהם הפוך לשלך (פתוחים לאתגור) ─────────
router.get('/opponents', auth(), async (req, res) => {
  try {
    const OUTCOME = "(CASE WHEN p.home_score > p.away_score THEN 'home' WHEN p.home_score < p.away_score THEN 'away' ELSE 'draw' END)";
    const rows = await db.query(`
      SELECT m.id AS match_id, m.home_code, m.away_code, m.kickoff,
             myp.outcome AS my_prop,
             u.id AS user_id, u.name AS user_name, u.profile_image_url,
             op.outcome AS their_prop
      FROM (
        SELECT p.match_id, ${OUTCOME} AS outcome
        FROM predictions p
        WHERE p.user_id = ? AND p.home_score IS NOT NULL AND p.away_score IS NOT NULL
      ) myp
      JOIN matches m ON m.id = myp.match_id AND m.status <> 'finished'
      JOIN (
        SELECT p.user_id, p.match_id, ${OUTCOME} AS outcome
        FROM predictions p
        WHERE p.home_score IS NOT NULL AND p.away_score IS NOT NULL
      ) op ON op.match_id = myp.match_id AND op.outcome <> myp.outcome AND op.user_id <> ?
      JOIN users u ON u.id = op.user_id AND u.is_admin = 0 AND u.is_guest = 0
      JOIN coin_wallets w ON w.user_id = u.id AND w.challenge_open = 1
      WHERE m.kickoff >= UTC_TIMESTAMP()
      ORDER BY m.kickoff ASC, u.name ASC
      LIMIT 200
    `, [req.user.id, req.user.id]);
    // סינון משחקים נעולים
    const out = [];
    for (const r of rows) { if (!(await isMatchLocked(r))) out.push(r); }
    res.json(out);
  } catch (e) {
    console.error('coins/opponents:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── יצירת הצעת הימור ─────────
router.post('/', auth(), async (req, res) => {
  try {
    if (blockGuest(req, res)) return;
    const matchId = Number(req.body?.match_id);
    const proposition = String(req.body?.proposition || '');
    const stake = Number(req.body?.stake);
    const maxAcceptors = Math.min(Math.max(parseInt(req.body?.max_acceptors, 10) || 1, 1), 20);
    const targetUserId = req.body?.target_user_id ? Number(req.body.target_user_id) : null;

    if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'משחק לא תקין' });
    if (!PROPS.includes(proposition)) return res.status(400).json({ error: 'בחירה לא תקינה' });
    if (!Number.isInteger(stake) || stake <= 0 || stake > START_BALANCE) {
      return res.status(400).json({ error: 'סכום ניחוש לא תקין' });
    }
    // אתגר ישיר = מקבל יחיד
    const slots = targetUserId ? 1 : maxAcceptors;
    const totalEscrow = stake * slots;

    const match = await db.one('SELECT * FROM matches WHERE id = ?', [matchId]);
    if (!match) return res.status(404).json({ error: 'משחק לא נמצא' });
    if (match.status === 'finished') return res.status(403).json({ error: 'המשחק הסתיים' });
    if (await isMatchLocked(match)) return res.status(403).json({ error: 'מאוחר מדי — ההימורים על משחק זה נעולים' });

    if (targetUserId) {
      const target = await db.one('SELECT id, is_guest FROM users WHERE id = ?', [targetUserId]);
      if (!target || target.is_guest) return res.status(400).json({ error: 'משתמש יעד לא תקין' });
      if (targetUserId === req.user.id) return res.status(400).json({ error: 'אי אפשר לאתגר את עצמך' });
    }

    const balance = await ensureWallet(req.user.id);
    if (balance < totalEscrow) return res.status(400).json({ error: 'אין מספיק מטבעות' });

    const betId = await db.tx(async (t) => {
      await adjust(t, req.user.id, -totalEscrow, 'bet_stake');
      const r = await t.run(
        `INSERT INTO coin_bets (match_id, proposition, stake, creator_id, target_user_id, max_acceptors, status)
         VALUES (?, ?, ?, ?, ?, ?, 'open')`,
        [matchId, proposition, stake, req.user.id, targetUserId, slots]
      );
      return r.insertId;
    });

    res.json({ ok: true, id: betId, max_acceptors: slots });
  } catch (e) {
    console.error('coins/create:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── קבלת הצעה (תופס את הצד ההפוך) ─────────
router.post('/:id/accept', auth(), async (req, res) => {
  try {
    if (blockGuest(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'מזהה לא תקין' });

    const bet = await db.one('SELECT * FROM coin_bets WHERE id = ?', [id]);
    if (!bet) return res.status(404).json({ error: 'הצעה לא נמצאה' });
    if (bet.status !== 'open') return res.status(409).json({ error: 'ההצעה אינה זמינה יותר' });
    if (bet.creator_id === req.user.id) return res.status(400).json({ error: 'אי אפשר לקבל הצעה של עצמך' });
    if (bet.target_user_id && bet.target_user_id !== req.user.id) {
      return res.status(403).json({ error: 'ההצעה מיועדת למשתמש אחר' });
    }
    const already = await db.one('SELECT 1 AS x FROM coin_bet_participants WHERE bet_id = ? AND opponent_id = ?', [id, req.user.id]);
    if (already) return res.status(409).json({ error: 'כבר הצטרפת לניחוש זה' });

    const match = await db.one('SELECT * FROM matches WHERE id = ?', [bet.match_id]);
    if (!match || match.status === 'finished') return res.status(403).json({ error: 'המשחק כבר הסתיים' });
    if (await isMatchLocked(match)) return res.status(403).json({ error: 'מאוחר מדי — הניחושים נעולים' });

    const balance = await ensureWallet(req.user.id);
    if (balance < bet.stake) return res.status(400).json({ error: 'אין מספיק מטבעות' });

    const done = await db.tx(async (t) => {
      // שריון משבצת אטומי: רק אם פתוח ויש מקום פנוי
      const upd = await t.run(
        "UPDATE coin_bets SET accepted_count = accepted_count + 1 WHERE id = ? AND status = 'open' AND accepted_count < max_acceptors",
        [id]
      );
      if (!upd.affectedRows) return false;
      await t.run('INSERT INTO coin_bet_participants (bet_id, opponent_id, stake) VALUES (?, ?, ?)', [id, req.user.id, bet.stake]);
      await adjust(t, req.user.id, -bet.stake, 'bet_stake', id);
      // סמן matched כשהתמלאו כל המשבצות
      await t.run("UPDATE coin_bets SET status = 'matched' WHERE id = ? AND status = 'open' AND accepted_count >= max_acceptors", [id]);
      return true;
    });
    if (!done) return res.status(409).json({ error: 'ההצעה כבר נתפסה' });

    res.json({ ok: true });
  } catch (e) {
    console.error('coins/accept:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ───────── ביטול הצעה פתוחה (יוצר בלבד, לפני שנתפסה) ─────────
router.post('/:id/cancel', auth(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'מזהה לא תקין' });

    const bet = await db.one('SELECT * FROM coin_bets WHERE id = ?', [id]);
    if (!bet) return res.status(404).json({ error: 'הצעה לא נמצאה' });
    if (bet.creator_id !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error: 'אין הרשאה' });
    if (bet.status !== 'open') return res.status(409).json({ error: 'אפשר לבטל רק הצעה שטרם נתפסה' });
    if (Number(bet.accepted_count) > 0) return res.status(409).json({ error: 'לא ניתן לבטל — כבר יש מצטרפים' });

    await db.tx(async (t) => {
      const upd = await t.run("UPDATE coin_bets SET status = 'cancelled' WHERE id = ? AND status = 'open' AND accepted_count = 0", [id]);
      if (upd.affectedRows) await adjust(t, bet.creator_id, bet.stake * Number(bet.max_acceptors || 1), 'bet_cancel_refund', id);
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('coins/cancel:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
