// נתיבי הימורי מטבעות ("שיחים") — לוח הצעות פתוח, אתגור ישיר, יישוב אוטומטי 1:1
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ensureWallet, adjust, coinLeaderboard, userCoinStats, setChallengeOpen, START_BALANCE } = require('../services/coins');

const router = express.Router();

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
             cu.name AS creator_name, ou.name AS opponent_name, tu.name AS target_name
      FROM coin_bets b
      JOIN matches m ON m.id = b.match_id
      JOIN users cu ON cu.id = b.creator_id
      LEFT JOIN users ou ON ou.id = b.opponent_id
      LEFT JOIN users tu ON tu.id = b.target_user_id
      WHERE b.creator_id = ? OR b.opponent_id = ?
      ORDER BY b.created_at DESC
    `, [req.user.id, req.user.id]);
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
             m.home_code, m.away_code, m.kickoff, m.status AS match_status,
             cu.name AS creator_name, cu.profile_image_url AS creator_image
      FROM coin_bets b
      JOIN matches m ON m.id = b.match_id
      JOIN users cu ON cu.id = b.creator_id
      WHERE b.status = 'open'
        AND b.creator_id <> ?
        AND (b.target_user_id IS NULL OR b.target_user_id = ?)
        AND m.status <> 'finished'
      ORDER BY b.created_at DESC
    `, [req.user.id, req.user.id]);
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

// ───────── יצירת הצעת הימור ─────────
router.post('/', auth(), async (req, res) => {
  try {
    if (blockGuest(req, res)) return;
    const matchId = Number(req.body?.match_id);
    const proposition = String(req.body?.proposition || '');
    const stake = Number(req.body?.stake);
    const targetUserId = req.body?.target_user_id ? Number(req.body.target_user_id) : null;

    if (!Number.isInteger(matchId)) return res.status(400).json({ error: 'משחק לא תקין' });
    if (!PROPS.includes(proposition)) return res.status(400).json({ error: 'בחירה לא תקינה' });
    if (!Number.isInteger(stake) || stake <= 0 || stake > START_BALANCE) {
      return res.status(400).json({ error: 'סכום הימור לא תקין' });
    }

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
    if (balance < stake) return res.status(400).json({ error: 'אין מספיק מטבעות' });

    const betId = await db.tx(async (t) => {
      await adjust(t, req.user.id, -stake, 'bet_stake');
      const r = await t.run(
        `INSERT INTO coin_bets (match_id, proposition, stake, creator_id, target_user_id, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
        [matchId, proposition, stake, req.user.id, targetUserId]
      );
      return r.insertId;
    });

    res.json({ ok: true, id: betId });
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

    const match = await db.one('SELECT * FROM matches WHERE id = ?', [bet.match_id]);
    if (!match || match.status === 'finished') return res.status(403).json({ error: 'המשחק כבר הסתיים' });
    if (await isMatchLocked(match)) return res.status(403).json({ error: 'מאוחר מדי — ההימורים נעולים' });

    const balance = await ensureWallet(req.user.id);
    if (balance < bet.stake) return res.status(400).json({ error: 'אין מספיק מטבעות' });

    const done = await db.tx(async (t) => {
      // נעילה אטומית: עדכן רק אם עדיין open
      const upd = await t.run(
        "UPDATE coin_bets SET opponent_id = ?, status = 'matched' WHERE id = ? AND status = 'open'",
        [req.user.id, id]
      );
      if (!upd.affectedRows) return false;
      await adjust(t, req.user.id, -bet.stake, 'bet_stake', id);
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

    await db.tx(async (t) => {
      const upd = await t.run("UPDATE coin_bets SET status = 'cancelled' WHERE id = ? AND status = 'open'", [id]);
      if (upd.affectedRows) await adjust(t, bet.creator_id, bet.stake, 'bet_cancel_refund', id);
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('coins/cancel:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
