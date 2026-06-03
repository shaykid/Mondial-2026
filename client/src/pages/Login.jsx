import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errMsg } from '../api/client';

export default function Login() {
  const { user, login, register } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedDocs, setAcceptedDocs] = useState(false);
  const [acceptedRanking, setAcceptedRanking] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        if (!acceptedDocs || !acceptedRanking) {
          setErr('יש לאשר את התקנון, תנאי השימוש, מדיניות הפרטיות והצגת הדירוג לפני הרשמה');
          return;
        }
        await register(name, email, password);
      }
      nav('/');
    } catch (er) {
      setErr(errMsg(er, 'שגיאה בהתחברות'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-top-logo-wrap">
        <img className="login-top-logo" src="/shiah-logo-white.png" alt="לוגו שיח" />
      </div>
      <div className="login-hero">
        <div style={{position:'relative'}}>
          <div style={{fontFamily:'var(--font-display)', fontSize: 18, letterSpacing: '0.3em', color:'var(--gold)'}}>
            FIFA WORLD CUP · USA · CANADA · MEXICO
          </div>
          <h1>
            מונדיאל<br/><span className="accent">2026</span>
          </h1>
          <p className="tag">
            ניחושי חברת שיח — חזה את התוצאות, צבור נקודות, ועלה במעלה הטבלה. הניצחון בידיים שלך.
          </p>
        </div>
        <div className="meta">
          <div><span>אצטדיונים</span>16</div>
          <div><span>נבחרות</span>48</div>
          <div><span>משחקים</span>104</div>
          <div><span>הגמר</span>19.07</div>
        </div>
      </div>

      <div className="login-form-area">
        <div className="login-form">
          <h2>{mode === 'login' ? 'התחברות' : 'הרשמה'}</h2>
          <p className="sub">{mode === 'login' ? 'ברוך שובך לזירה.' : 'הצטרף לזירת הניחושים של החברה.'}</p>

          <div className="login-toggle">
            <button type="button" className={mode==='login' ? 'active':''} onClick={() => setMode('login')}>כניסה</button>
            <button type="button" className={mode==='register' ? 'active':''} onClick={() => setMode('register')}>הרשמה</button>
          </div>

          {err && <div className="alert alert-error">{err}</div>}

          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="field">
                <label>שם מלא</label>
                <input value={name} onChange={e => setName(e.target.value)} required minLength={2} autoComplete="name" />
              </div>
            )}
            <div className="field">
              <label>אימייל</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="field">
              <label>סיסמה</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoComplete={mode==='login' ? 'current-password' : 'new-password'} />
            </div>
            {mode === 'register' && (
              <div className="consent-box">
                <label>
                  <input type="checkbox" checked={acceptedDocs} onChange={e => setAcceptedDocs(e.target.checked)} />
                  אני מאשר/ת שקראתי את תקנון המשחק, תנאי השימוש ומדיניות הפרטיות, ואני מסכים/ה להשתתף במשחק בהתאם להם.
                </label>
                <label>
                  <input type="checkbox" checked={acceptedRanking} onChange={e => setAcceptedRanking(e.target.checked)} />
                  אני מאשר/ת ששמי, מחלקתי, ניקודי ומיקומי בדירוג יוצגו למשתתפי המשחק ולעובדי החברה.
                </label>
              </div>
            )}
            <button className="btn btn-gold" style={{width:'100%', justifyContent:'center', padding:'14px'}} disabled={busy}>
              {busy ? <span className="spinner" /> : (mode === 'login' ? 'כניסה למערכת' : 'יצירת חשבון')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
