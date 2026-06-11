import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

// מסך חסימה מלא בזמן שבת (לפי מיקום הגולש). מנהלים/מנהלי-משנה פטורים, ועמוד ההתחברות נשאר נגיש.
function ShabbatBlock({ end }) {
  let endLabel = '';
  if (end) {
    try {
      endLabel = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' }).format(new Date(end));
    } catch { /* ignore */ }
  }
  return (
    <div dir="rtl" style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 16, textAlign: 'center', padding: 24,
      background: 'radial-gradient(circle at 50% 30%, #14492f, #08311f 70%)', color: '#fff'
    }}>
      <div style={{ fontSize: 64, lineHeight: 1 }}>🕯️</div>
      <h1 style={{ margin: 0, color: '#ffd700', fontSize: 34 }}>שבת שלום</h1>
      <p style={{ margin: 0, fontSize: 18, maxWidth: 420 }}>
        האתר שומר שבת ואינו פעיל כעת.
        {endLabel ? <> נחזור לפעילות במוצאי שבת, בסביבות <strong>{endLabel}</strong> (צאת השבת).</> : <> נחזור לפעילות במוצאי שבת.</>}
      </p>
      <Link to="/login" style={{ marginTop: 8, color: '#cfe8d8', fontSize: 13, opacity: 0.8 }}>
        כניסת מנהל
      </Link>
    </div>
  );
}

export default function ShabbatGate({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  const [state, setState] = useState(null); // { enabled, active, start, end }

  useEffect(() => {
    let timer;
    let cancelled = false;
    const check = async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jerusalem';
        const { data } = await api.get(`/site/shabbat?tz=${encodeURIComponent(tz)}`);
        if (cancelled) return;
        setState(data);
        // תזמון בדיקה חוזרת: בכניסת/יציאת שבת הקרובה, ולכל היותר כל 10 דקות
        let next = 10 * 60 * 1000;
        const boundary = data?.active ? data?.end : data?.start;
        if (boundary) {
          const delta = Date.parse(boundary) - Date.now() + 2000;
          if (delta > 0) next = Math.min(next, delta);
        }
        timer = setTimeout(check, Math.max(30000, Math.min(next, 6 * 3600 * 1000)));
      } catch {
        if (cancelled) return;
        setState({ enabled: true, active: false });
        timer = setTimeout(check, 10 * 60 * 1000);
      }
    };
    check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const staff = !!(user && (user.isAdmin || user.role === 'manager'));
  const blocking = state && state.enabled !== false && state.active
    && !staff && location.pathname !== '/login';

  if (blocking) return <ShabbatBlock end={state.end} />;
  return children;
}
