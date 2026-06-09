const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { seedScheduleItems } = require('../lib/schedule-items');

const router = express.Router();

router.get('/', auth(), async (req, res) => {
  try {
    await db.tx(async (t) => seedScheduleItems(t));
    const rows = await db.query(`
      SELECT
        s.*,
        u.id AS winner_id,
        u.name AS winner_name,
        u.email AS winner_email,
        u.profile_image_url AS winner_profile_image_url
      FROM schedule_items s
      LEFT JOIN users u ON u.id = s.winner_user_id
      ORDER BY s.sort_order ASC, s.start_at ASC, s.id ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error('schedule:', e);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

module.exports = router;
