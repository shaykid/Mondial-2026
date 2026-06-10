// נתיבי "ניחוש קבוצתי" (Guess-Groups) — async/MySQL
// מספר חברים מחזיקים סט משותף של הימורי תוצאה (1/X/2). מנהיג הקבוצה קובע את ההימורים.
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { groupLeaderboard, groupMultiplier, userAvailablePoints } = require('../services/scoring');

const router = express.Router();

// ברירות מחדל לכל הגבולות — ניתנים לשינוי דרך לוח הניהול (טבלת settings)
const DEFAULTS = {
  maxPerUser:    8,  // group_max_per_user — כמה קבוצות לכל משתמש
  maxMembers:    5,  // group_max_members — חברים מקסימליים בקבוצה
  entryCostMax:  5,  // group_entry_cost_max — דמי כניסה מקסימליים
  multiplierCap: 5   // group_multiplier_cap — מכפיל מקסימלי
};
const VALID_PICKS = ['home', 'draw', 'away'];

// בדיקת הרשאה: רק משתמשים עם can_guess_groups (או מנהלים) רשאים לגשת לניחוש הקבוצתי.
// נבדק מול ה-DB בכל בקשה כדי לשקף שינוי הרשאה ע"י מנהל באופן מיידי.
async function requireGuessAccess(req, res, next) {
  try {
    const featureEnabled = await getSetting('site_guess_groups_enabled', 'false');
    if (String(featureEnabled).trim().toLowerCase() !== 'true') {
      return res.status(403).json({ error: 'הניחוש הקבוצתי כבוי כרגע ברמת האתר' });
    }
    if (req.user.isAdmin) return next();
    const u = await db.one('SELECT can_guess_groups FROM users WHERE id = ?', [req.user.id]);
    if (!u || !u.can_guess_groups) {
      return res.status(403).json({ error: 'אין לך הרשאה לניחוש קבוצתי' });
    }
    next();
  } catch (e) {
    console.error('guess-access:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
}

// כל נתיבי הניחוש הקבוצתי דורשים הזדהות + הרשאת ניחוש קבוצתי
router.use(auth(), requireGuessAccess);

async function getSetting(key, def) {
  const r = await db.one('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  return r ? r.value : def;
}

async function getSettingNum(key, def) {
  const r = await db.one('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  const n = r ? Number(r.value) : NaN;
  return Number.isFinite(n) ? n : def;
}

// טוען את כל הגבולות מההגדרות (עם נפילה לברירות המחדל)
async function loadCaps() {
  return {
    maxPerUser:    await getSettingNum('group_max_per_user',    DEFAULTS.maxPerUser),
    maxMembers:    await getSettingNum('group_max_members',     DEFAULTS.maxMembers),
    entryCostMax:  await getSettingNum('group_entry_cost_max',  DEFAULTS.entryCostMax),
    multiplierCap: await getSettingNum('group_multiplier_cap',  DEFAULTS.multiplierCap)
  };
}

function clampCost(v, max) {
  return Math.max(0, Math.min(Number(max) || DEFAULTS.entryCostMax, Math.trunc(Number(v) || 0)));
}

// האם המשחק נעול להימורים (כמו בניחושים האישיים)
async function isMatchLocked(match) {
  const lockHours = Number(await getSetting('lock_hours_before', 1));
  const raw = String(match.kickoff);
  const kickoffMs = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`).getTime();
  const lockTime = kickoffMs - (lockHours * 60 * 60 * 1000);
  return Date.now() >= lockTime;
}

// מחזיר את שורת החברות של המשתמש בקבוצה (או null)
async function membership(groupId, userId) {
  return db.one('SELECT * FROM guess_group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
}

// בדיקת הרשאת ניהול: מנהיג הקבוצה או מנהל מערכת
async function canManage(group, req) {
  if (req.user.isAdmin) return true;
  return group && group.leader_user_id === req.user.id;
}

// ────────── רשימת קבוצות ──────────
// קבוצות שהמשתמש חבר בהן (מנהל מערכת רואה הכל)
router.get('/', auth(), async (req, res) => {
  try {
    const board = await groupLeaderboard();
    const rows = req.user.isAdmin
      ? board
      : board.filter(g => (g.members || []).some(m => m.id === req.user.id));
    res.json(rows);
  } catch (e) {
    console.error('guess-groups/list:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── לוח מצטיינים של הקבוצות (האלמנט החי) ──────────
router.get('/leaderboard', auth(), async (req, res) => {
  try {
    res.json(await groupLeaderboard());
  } catch (e) {
    console.error('guess-groups/leaderboard:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── הנקודות הזמינות של המשתמש המחובר ──────────
router.get('/me/points', auth(), async (req, res) => {
  try {
    const caps = await loadCaps();
    res.json({
      available_points: await userAvailablePoints(req.user.id),
      max_entry_cost: caps.entryCostMax,
      max_per_user: caps.maxPerUser
    });
  } catch (e) {
    console.error('guess-groups/me-points:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── רשימת משתמשים להוספה כחברים ──────────
router.get('/users', auth(), async (req, res) => {
  try {
    const q = `%${(req.query.q || '').trim()}%`;
    const rows = await db.query(`
      SELECT id, name, email, profile_image_url
      FROM users
      WHERE is_admin = 0 AND (name LIKE ? OR email LIKE ?)
      ORDER BY name ASC
      LIMIT 30
    `, [q, q]);
    res.json(rows);
  } catch (e) {
    console.error('guess-groups/users:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── יצירת קבוצה ──────────
router.post('/', auth(), async (req, res) => {
  try {
    const caps = await loadCaps();
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim() || null;
    const entryCost = clampCost(req.body?.entry_cost, caps.entryCostMax);
    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ error: 'שם קבוצה לא תקין' });
    }

    const countRow = await db.one(
      'SELECT COUNT(*) AS n FROM guess_group_members WHERE user_id = ?', [req.user.id]);
    if (Number(countRow.n) >= caps.maxPerUser) {
      return res.status(400).json({ error: `ניתן להשתתף בעד ${caps.maxPerUser} קבוצות` });
    }

    // המנהיג עצמו משלם את דמי הכניסה — חובה שיהיו לו מספיק נקודות
    if (entryCost > 0) {
      const available = await userAvailablePoints(req.user.id);
      if (available < entryCost) {
        return res.status(400).json({ error: `אין מספיק נקודות זמינות (${available}) עבור דמי כניסה של ${entryCost}` });
      }
    }

    const groupId = await db.tx(async (t) => {
      const r = await t.run(
        'INSERT INTO guess_groups (name, description, leader_user_id, entry_cost) VALUES (?, ?, ?, ?)',
        [name, description, req.user.id, entryCost]);
      await t.run(
        "INSERT INTO guess_group_members (group_id, user_id, role, paid_points) VALUES (?, ?, 'leader', ?)",
        [r.insertId, req.user.id, entryCost]);
      return r.insertId;
    });

    res.json({ ok: true, id: groupId });
  } catch (e) {
    console.error('guess-groups/create:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── פרטי קבוצה ──────────
router.get('/:id', auth(), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const group = await db.one('SELECT * FROM guess_groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'קבוצה לא נמצאה' });

    const mine = await membership(groupId, req.user.id);
    if (!mine && !req.user.isAdmin) {
      return res.status(403).json({ error: 'אינך חבר בקבוצה זו' });
    }

    const members = await db.query(`
      SELECT u.id, u.name, u.profile_image_url, m.role, m.paid_points, m.joined_at
      FROM guess_group_members m
      JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY m.role = 'leader' DESC, u.name ASC
    `, [groupId]);

    const bets = await db.query(`
      SELECT b.id, b.match_id, b.pick, b.points,
        m.kickoff, m.status, m.home_code, m.away_code,
        m.home_score AS actual_home, m.away_score AS actual_away,
        th.name_he AS home_name, th.name_en AS home_name_en,
        ta.name_he AS away_name, ta.name_en AS away_name_en
      FROM guess_group_bets b
      JOIN matches m ON m.id = b.match_id
      JOIN teams th ON th.code = m.home_code
      JOIN teams ta ON ta.code = m.away_code
      WHERE b.group_id = ?
      ORDER BY m.kickoff ASC, m.id ASC
    `, [groupId]);

    const caps = await loadCaps();
    const board = await groupLeaderboard();
    const standing = board.find(g => g.id === groupId) || null;
    const myPaidRow = mine ? members.find(m => m.id === req.user.id) : null;

    res.json({
      group,
      members,
      bets,
      member_count: members.length,
      multiplier: groupMultiplier(members.length, caps.multiplierCap),
      total_points: standing ? standing.total_points : 0,
      rank: standing ? standing.rank : null,
      entry_cost: Number(group.entry_cost || 0),
      my_paid: myPaidRow ? Number(myPaidRow.paid_points || 0) : 0,
      available_points: await userAvailablePoints(req.user.id),
      can_manage: await canManage(group, req),
      max_members: caps.maxMembers
    });
  } catch (e) {
    console.error('guess-groups/detail:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── מחיקת קבוצה ──────────
router.delete('/:id', auth(), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const group = await db.one('SELECT * FROM guess_groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'קבוצה לא נמצאה' });
    if (!(await canManage(group, req))) {
      return res.status(403).json({ error: 'רק מנהיג הקבוצה או מנהל יכולים למחוק' });
    }
    await db.run('DELETE FROM guess_groups WHERE id = ?', [groupId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('guess-groups/delete:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── הוספת חבר ──────────
router.post('/:id/members', auth(), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const targetUserId = Number(req.body?.user_id);
    const group = await db.one('SELECT * FROM guess_groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'קבוצה לא נמצאה' });
    if (!(await canManage(group, req))) {
      return res.status(403).json({ error: 'רק מנהיג הקבוצה או מנהל יכולים להוסיף חברים' });
    }
    const target = await db.one('SELECT id, name FROM users WHERE id = ?', [targetUserId]);
    if (!target) return res.status(404).json({ error: 'משתמש לא נמצא' });

    if (await membership(groupId, targetUserId)) {
      return res.status(400).json({ error: 'המשתמש כבר חבר בקבוצה' });
    }

    const caps = await loadCaps();
    const sizeRow = await db.one('SELECT COUNT(*) AS n FROM guess_group_members WHERE group_id = ?', [groupId]);
    if (Number(sizeRow.n) >= caps.maxMembers) {
      return res.status(400).json({ error: `הקבוצה מלאה (עד ${caps.maxMembers} חברים)` });
    }

    const userGroupsRow = await db.one('SELECT COUNT(*) AS n FROM guess_group_members WHERE user_id = ?', [targetUserId]);
    if (Number(userGroupsRow.n) >= caps.maxPerUser) {
      return res.status(400).json({ error: `${target.name} כבר משתתף ב-${caps.maxPerUser} קבוצות` });
    }

    // החבר משלם את דמי הכניסה של הקבוצה — חובה שיהיו לו מספיק נקודות זמינות
    const entryCost = Number(group.entry_cost || 0);
    if (entryCost > 0) {
      const available = await userAvailablePoints(targetUserId);
      if (available < entryCost) {
        return res.status(400).json({ error: `ל${target.name} אין מספיק נקודות זמינות (${available}) עבור דמי כניסה ${entryCost}` });
      }
    }

    await db.run(
      "INSERT INTO guess_group_members (group_id, user_id, role, paid_points) VALUES (?, ?, 'member', ?)",
      [groupId, targetUserId, entryCost]);
    res.json({ ok: true });
  } catch (e) {
    console.error('guess-groups/add-member:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── הסרת חבר (ניהול או עזיבה עצמית) ──────────
router.delete('/:id/members/:userId', auth(), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    const group = await db.one('SELECT * FROM guess_groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'קבוצה לא נמצאה' });

    const isSelf = targetUserId === req.user.id;
    if (!isSelf && !(await canManage(group, req))) {
      return res.status(403).json({ error: 'אין הרשאה להסיר חבר זה' });
    }

    if (targetUserId === group.leader_user_id) {
      // המנהיג עוזב → מותר רק אם הוא לבדו בקבוצה (אחרת ימחוק/יעביר ידנית)
      const sizeRow = await db.one('SELECT COUNT(*) AS n FROM guess_group_members WHERE group_id = ?', [groupId]);
      if (Number(sizeRow.n) > 1) {
        return res.status(400).json({ error: 'מנהיג הקבוצה אינו יכול לעזוב כל עוד יש חברים נוספים — מחקו את הקבוצה במקום' });
      }
      await db.run('DELETE FROM guess_groups WHERE id = ?', [groupId]);
      return res.json({ ok: true, deleted: true });
    }

    await db.run('DELETE FROM guess_group_members WHERE group_id = ? AND user_id = ?', [groupId, targetUserId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('guess-groups/remove-member:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── קביעת/עדכון הימור משותף (מנהיג בלבד) ──────────
router.post('/:id/bets', auth(), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const matchId = Number(req.body?.match_id);
    const pick = String(req.body?.pick || '');
    if (!VALID_PICKS.includes(pick)) {
      return res.status(400).json({ error: 'הימור לא תקין (1 / X / 2)' });
    }
    const group = await db.one('SELECT * FROM guess_groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'קבוצה לא נמצאה' });
    if (!(await canManage(group, req))) {
      return res.status(403).json({ error: 'רק מנהיג הקבוצה קובע את ההימורים' });
    }
    const match = await db.one('SELECT * FROM matches WHERE id = ?', [matchId]);
    if (!match) return res.status(404).json({ error: 'משחק לא נמצא' });
    if (await isMatchLocked(match)) {
      return res.status(403).json({ error: 'מאוחר מדי — ההימורים נעולים למשחק זה' });
    }

    await db.run(`
      INSERT INTO guess_group_bets (group_id, match_id, pick)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE pick = VALUES(pick), points = 0, updated_at = CURRENT_TIMESTAMP
    `, [groupId, matchId, pick]);
    res.json({ ok: true });
  } catch (e) {
    console.error('guess-groups/set-bet:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ────────── הסרת הימור (לפני נעילה) ──────────
router.delete('/:id/bets/:matchId', auth(), async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const matchId = Number(req.params.matchId);
    const group = await db.one('SELECT * FROM guess_groups WHERE id = ?', [groupId]);
    if (!group) return res.status(404).json({ error: 'קבוצה לא נמצאה' });
    if (!(await canManage(group, req))) {
      return res.status(403).json({ error: 'רק מנהיג הקבוצה קובע את ההימורים' });
    }
    const match = await db.one('SELECT * FROM matches WHERE id = ?', [matchId]);
    if (match && await isMatchLocked(match)) {
      return res.status(403).json({ error: 'מאוחר מדי — ההימורים נעולים למשחק זה' });
    }
    await db.run('DELETE FROM guess_group_bets WHERE group_id = ? AND match_id = ?', [groupId, matchId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('guess-groups/remove-bet:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
