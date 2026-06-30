// נתיבי ביקורת נבחרת (AI) — רשימת קודים עם ביקורת + שליפת ביקורת לנבחרת
const express = require('express');
const { auth } = require('../middleware/auth');
const { getReview, codesWithReviews } = require('../services/teamReviews');

const router = express.Router();

// רשימת קודי נבחרות שיש להן ביקורת (לסימון על הדגלים)
router.get('/', auth(false), async (req, res) => {
  try {
    res.json(await codesWithReviews());
  } catch (e) {
    console.error('team-reviews/list:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ביקורת לנבחרת בודדת
router.get('/:code', auth(false), async (req, res) => {
  try {
    const r = await getReview(String(req.params.code));
    if (!r) return res.status(404).json({ error: 'אין ביקורת לנבחרת זו' });
    res.json(r);
  } catch (e) {
    console.error('team-reviews/get:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
