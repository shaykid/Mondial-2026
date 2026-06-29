// עטיפה דקה סביב ספריית התמלול @hinbit/transcriber.
// הספרייה מקבלת נתיב-קובץ (לא buffer), כותבת קבצי-ביניים לדיסק, ומשתמשת ב-OpenAI
// (gpt-4o-transcribe) + ffmpeg. כאן אנו כותבים את ה-buffer לקובץ זמני, מתמללים,
// ומנקים את כל קבצי-הביניים.
const fs = require('fs');
const path = require('path');
const os = require('os');

function extFromName(name) {
  const ext = path.extname(name || '').toLowerCase();
  return ['.webm', '.ogg', '.m4a', '.mp3', '.wav', '.mpeg', '.mpga'].includes(ext) ? ext : '.webm';
}

async function ensureWritableDir(candidates) {
  let lastError = null;
  for (const dir of candidates) {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.access(dir, fs.constants.W_OK);
      return dir;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('no writable transcription dir');
}

// מנקה בשקט נתיב קובץ/תיקייה אם קיים
async function rmQuiet(p) {
  if (!p) return;
  try {
    await fs.promises.rm(p, { recursive: true, force: true });
  } catch (e) {
    /* ignore */
  }
}

/**
 * מתמלל buffer של אודיו ומחזיר את הטקסט (עברית כברירת מחדל).
 * @param {Buffer} buffer
 * @param {string} originalName
 * @returns {Promise<string>} הטקסט המתומלל
 */
async function transcribeAudioBuffer(buffer, originalName) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('OPENAI_API_KEY חסר — לא ניתן לתמלל');
    err.code = 'NO_API_KEY';
    throw err;
  }

  // טעינה עצלה כדי שהשרת יעלה גם אם החבילה עדיין לא הותקנה (התמלול ייכשל בחן)
  let transcribeLocalFile;
  try {
    ({ transcribeLocalFile } = require('@hinbit/transcriber'));
  } catch (e) {
    const err = new Error('ספריית התמלול @hinbit/transcriber אינה מותקנת בשרת');
    err.code = 'NO_LIB';
    throw err;
  }

  // תיקיית עבודה זמנית ייחודית — הכל נמחק בסוף
  const base = await ensureWritableDir([
    path.join(__dirname, '..', '..', 'data', 'review_tmp'),
    path.join(os.tmpdir(), 'mondial_review_tmp')
  ]);
  const workDir = path.join(base, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  await fs.promises.mkdir(workDir, { recursive: true });

  const inputPath = path.join(workDir, `audio${extFromName(originalName)}`);
  await fs.promises.writeFile(inputPath, buffer);

  try {
    const result = await transcribeLocalFile(inputPath, {
      language: 'he',
      apiKey,
      familySummary: false,
      outputDir: path.join(workDir, 'out'),
      chunkDir: path.join(workDir, 'chunks'),
      downloadDir: workDir
    });
    const text = (result && result.transcriptText ? String(result.transcriptText) : '').trim();
    // הסרת כותרות "--- Chunk N (..) ---" שהספרייה מזריקה בין מקטעים
    return text.replace(/^---\s*Chunk\s+\d+.*?---\s*$/gim, '').replace(/\n{3,}/g, '\n\n').trim();
  } finally {
    await rmQuiet(workDir);
  }
}

module.exports = { transcribeAudioBuffer };
