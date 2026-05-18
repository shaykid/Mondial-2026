// נתיבי ניחושים (async/MySQL)
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

async function getSetting(key, def) {
  const r = await db.one('SELECT `value` FROM settings WHERE `key` = ?', [key]);
  return r ? r.value : def;
}

// כל הניחושים של המשתמש המחובר
router.get('/my', auth(), async (req, res) => {
  try {
    const preds = await db.query(`
      SELECT p.*, m.home_code, m.away_code, m.kickoff, m.status,
        m.home_score AS actual_home, m.away_score AS actual_away
      FROM predictions p
      JOIN matches m ON m.id = p.match_id
      WHERE p.user_id = ?
      ORDER BY m.kickoff ASC
    `, [req.user.id]);

    const special = await db.one(`
      SELECT sp.*,
        p.name_en AS top_scorer_name_en,
        p.name_he AS top_scorer_name_he,
        p.country_en AS top_scorer_country_en,
        p.country_he AS top_scorer_country_he,
        p.image_url AS top_scorer_image_url
      FROM special_predictions sp
      LEFT JOIN players p ON p.id = sp.top_scorer_player_id
      WHERE sp.user_id = ?
    `, [req.user.id]);
    res.json({ predictions: preds, special: special || null });
  } catch (e) {
    console.error('predictions/my:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// רשימת שחקנים לבחירה (מלך השערים)
router.get('/players', auth(), async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT id, name_en, name_he, country_en, country_he, image_url, team_code
      FROM players
      ORDER BY name_en ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error('predictions/players:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// הזנת ניחוש למשחק
router.post('/match/:id', auth(), async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    const { home_score, away_score } = req.body || {};
    if (!Number.isInteger(home_score) || !Number.isInteger(away_score) ||
        home_score < 0 || away_score < 0 || home_score > 30 || away_score > 30) {
      return res.status(400).json({ error: 'תוצאה לא תקינה' });
    }

    const match = await db.one('SELECT * FROM matches WHERE id = ?', [matchId]);
    if (!match) return res.status(404).json({ error: 'משחק לא נמצא' });

    // בדיקת נעילה
    const lockHours = Number(await getSetting('lock_hours_before', 1));
    const lockTime = new Date(match.kickoff + (match.kickoff.endsWith('Z') ? '' : 'Z')).getTime()
                     - (lockHours * 60 * 60 * 1000);
    if (Date.now() >= lockTime) {
      return res.status(403).json({ error: 'מאוחר מדי - הניחושים נעולים למשחק זה' });
    }

    await db.run(`
      INSERT INTO predictions (user_id, match_id, home_score, away_score)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        home_score   = VALUES(home_score),
        away_score   = VALUES(away_score),
        submitted_at = CURRENT_TIMESTAMP,
        points       = 0
    `, [req.user.id, matchId, home_score, away_score]);

    res.json({ ok: true });
  } catch (e) {
    console.error('predict-match:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ניחושים מיוחדים (אלופה, סגן, מלך)
router.post('/special', auth(), async (req, res) => {
  try {
    const { champion_code, runner_up_code, top_scorer, top_scorer_player_id } = req.body || {};

    // נעילה בזמן בעיטת הפתיחה של המונדיאל
    const opener = await db.one(`SELECT MIN(kickoff) AS k FROM matches`);
    if (opener && opener.k) {
      const lockHours = Number(await getSetting('lock_hours_before', 1));
      const openerTime = new Date(opener.k + (String(opener.k).endsWith('Z') ? '' : 'Z')).getTime();
      if (Date.now() >= openerTime - lockHours * 3600000) {
        return res.status(403).json({ error: 'נעילה: ניחושים מיוחדים נסגרו עם תחילת הטורניר' });
      }
    }

    let topScorerPlayerId = null;
    let topScorerText = top_scorer || null;
    if (top_scorer_player_id != null && top_scorer_player_id !== '') {
      const pid = Number(top_scorer_player_id);
      if (!Number.isInteger(pid) || pid <= 0) {
        return res.status(400).json({ error: 'שחקן לא תקין' });
      }
      const player = await db.one('SELECT id, name_en FROM players WHERE id = ?', [pid]);
      if (!player) return res.status(400).json({ error: 'שחקן לא נמצא' });
      topScorerPlayerId = player.id;
      topScorerText = player.name_en;
    }

    await db.run(`
      INSERT INTO special_predictions (user_id, champion_code, runner_up_code, top_scorer_player_id, top_scorer, submitted_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        champion_code  = VALUES(champion_code),
        runner_up_code = VALUES(runner_up_code),
        top_scorer_player_id = VALUES(top_scorer_player_id),
        top_scorer     = VALUES(top_scorer),
        submitted_at   = CURRENT_TIMESTAMP
    `, [req.user.id, champion_code || null, runner_up_code || null, topScorerPlayerId, topScorerText]);

    res.json({ ok: true });
  } catch (e) {
    console.error('predict-special:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
