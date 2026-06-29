// נתיבי משחקים, קבוצות וטבלאות (async/MySQL)
const express = require('express');
const db = require('../db');
const { getAllActive } = require('../services/aiPredictions');

const router = express.Router();

// ניחושי AI ממקורות מחקר (לכל המשחקים הקרובים שיש להם נתונים)
router.get('/ai-predictions', async (req, res) => {
  try {
    res.json(await getAllActive());
  } catch (e) {
    console.error('ai-predictions:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// קבוצות
router.get('/teams', async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM teams ORDER BY group_letter, name_he');
    res.json(rows);
  } catch (e) {
    console.error('teams:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// כל המשחקים (עם שמות הקבוצות)
router.get('/matches', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT m.*,
        th.name_he AS home_name, th.name_en AS home_name_en, th.name_ar AS home_name_ar,
        ta.name_he AS away_name, ta.name_en AS away_name_en, ta.name_ar AS away_name_ar
      FROM matches m
      LEFT JOIN teams th ON th.code = m.home_code
      LEFT JOIN teams ta ON ta.code = m.away_code
      ORDER BY m.kickoff ASC, m.id ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error('matches:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// משחק יחיד
router.get('/matches/:id', async (req, res) => {
  try {
    const m = await db.one(`
      SELECT m.*,
        th.name_he AS home_name, th.name_en AS home_name_en, th.name_ar AS home_name_ar,
        ta.name_he AS away_name, ta.name_en AS away_name_en, ta.name_ar AS away_name_ar
      FROM matches m
      LEFT JOIN teams th ON th.code = m.home_code
      LEFT JOIN teams ta ON ta.code = m.away_code
      WHERE m.id = ?
    `, [req.params.id]);
    if (!m) return res.status(404).json({ error: 'המשחק לא נמצא' });
    res.json(m);
  } catch (e) {
    console.error('match:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// טבלאות הבתים - מחושב מתוצאות בפועל
router.get('/standings', async (req, res) => {
  try {
    const teams = await db.query('SELECT * FROM teams ORDER BY group_letter, name_he');
    const finished = await db.query(
      `SELECT * FROM matches WHERE status = 'finished' AND home_score IS NOT NULL`
    );

    const tableMap = {};
    for (const t of teams) {
      tableMap[t.code] = {
        code: t.code, name_he: t.name_he, name_en: t.name_en, group: t.group_letter,
        played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, pts: 0
      };
    }
    for (const m of finished) {
      const h = tableMap[m.home_code], a = tableMap[m.away_code];
      if (!h || !a) continue;
      h.played++; a.played++;
      h.gf += m.home_score; h.ga += m.away_score;
      a.gf += m.away_score; a.ga += m.home_score;
      if (m.home_score > m.away_score) { h.won++; h.pts += 3; a.lost++; }
      else if (m.home_score < m.away_score) { a.won++; a.pts += 3; h.lost++; }
      else { h.drawn++; a.drawn++; h.pts++; a.pts++; }
      h.gd = h.gf - h.ga; a.gd = a.gf - a.ga;
    }

    const groups = {};
    for (const t of Object.values(tableMap)) {
      if (!groups[t.group]) groups[t.group] = [];
      groups[t.group].push(t);
    }
    for (const g of Object.keys(groups)) {
      groups[g].sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf);
    }
    res.json(groups);
  } catch (e) {
    console.error('standings:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
