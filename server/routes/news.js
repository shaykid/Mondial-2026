const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { auth } = require('../middleware/auth');

const router = express.Router();

let cache = { at: 0, items: [] };

router.get('/sports', auth(false), async (req, res) => {
  try {
    const now = Date.now();
    if (now - cache.at < 15 * 60 * 1000 && cache.items.length) {
      return res.json(cache.items);
    }

    const url = 'https://news.google.com/rss/search?q=%D7%A1%D7%A4%D7%95%D7%A8%D7%98&hl=he&gl=IL&ceid=IL:he';
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Mondial2026Bot/1.0)' }
    });
    const $ = cheerio.load(data, { xmlMode: true });
    const items = $('item').toArray().slice(0, 12).map((item) => ({
      title: $(item).find('title').text().trim(),
      link: $(item).find('link').text().trim()
    })).filter((item) => item.title && item.link);

    cache = { at: now, items };
    res.json(items);
  } catch (e) {
    console.error('news/sports:', e.message);
    res.json(cache.items || []);
  }
});

module.exports = router;
