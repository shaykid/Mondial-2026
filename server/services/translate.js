// services/translate.js — תרגום טקסט קצר דרך OpenAI (ללא web_search), לשמירה ב-DB
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.AI_TRANSLATE_MODEL || 'gpt-4o-mini';
const LANG_NAME = { en: 'English', ar: 'Arabic', he: 'Hebrew' };

// מחזיר טקסט מתורגם, או null אם נכשל/אין מפתח
async function translateText(text, target) {
  const src = String(text || '').trim();
  if (!src || !LANG_NAME[target]) return null;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: `You are a professional translator. Translate the user's text to ${LANG_NAME[target]}. Preserve meaning and tone. Return ONLY the translation — no quotes, no notes, no explanations.` },
          { role: 'user', content: src }
        ]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content?.trim();
    return out || null;
  } catch (e) {
    console.error('translate:', e.message);
    return null;
  }
}

module.exports = { translateText };
