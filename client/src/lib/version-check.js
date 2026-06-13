/* global __BUILD_ID__ */
// בודק אם עלתה גרסה חדשה של האתר (לפי build id), ואם כן — טוען מחדש אוטומטית.
// פותר את המצב שבו משתמש (במיוחד בנייד) משאיר את האתר פתוח ימים ולא מקבל את הגרסה החדשה.

const CURRENT = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null;

let busy = false;
let reloading = false;

async function check() {
  if (busy || reloading || !CURRENT) return;
  busy = true;
  try {
    const res = await fetch('/api/site/version', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.build && data.build !== CURRENT) {
        reloading = true;
        window.location.reload(); // index.html הוא no-store → נטען bundle עדכני
      }
    }
  } catch {
    /* אופליין / שגיאה זמנית — מתעלמים */
  } finally {
    busy = false;
  }
}

export function startVersionWatch() {
  if (!CURRENT) return; // בפיתוח ללא build — לא עושים כלום
  // בדיקה כשחוזרים ללשונית (קריטי בנייד — האתר חוזר מרקע) וכשמתמקדים בחלון
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', check);
  // ובדיקה תקופתית כל עוד האתר פתוח
  setInterval(check, 5 * 60 * 1000);
  check();
}
