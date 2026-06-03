import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Flag from '../components/Flag';
import MatchCard from '../components/MatchCard';

export default function Home() {
  const { user } = useAuth();
  const [matches, setMatches] = useState([]);
  const [myPredictions, setMyPredictions] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [editingMatchId, setEditingMatchId] = useState(null);
  const [draft, setDraft] = useState({ home: '', away: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/matches').then(r => setMatches(r.data)).catch(() => {});
    api.get('/predictions/my').then(r => setMyPredictions(r.data.predictions)).catch(() => {});
    api.get('/leaderboard').then(r => setLeaderboard(r.data)).catch(() => {});
  }, []);

  const upcoming = matches
    .filter(m => m.status !== 'finished')
    .slice(0, 4);

  const predictedIds = new Set(myPredictions.map(p => p.match_id));
  const predictionMap = Object.fromEntries(
    myPredictions.map(p => [p.match_id, p])
  );
  const upcomingUnpredicted = upcoming.filter(m => !predictedIds.has(m.id));

  const myRank = leaderboard.find(r => r.id === user.id);
  const topScoredUsers = leaderboard
    .filter((r) => Number(r.total_points || 0) > 3)
    .slice(0, 5);

  const isLocked = (m) => {
    const kickoff = new Date(m.kickoff).getTime();
    return Date.now() >= kickoff - 3600 * 1000 || m.status === 'finished';
  };

  const openEditor = (m) => {
    const p = predictionMap[m.id];
    setDraft({
      home: Number.isInteger(p?.home_score) ? p.home_score : '',
      away: Number.isInteger(p?.away_score) ? p.away_score : ''
    });
    setEditingMatchId(m.id);
    setMsg('');
  };

  const savePrediction = async (m) => {
    const home = Number(draft.home);
    const away = Number(draft.away);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 30 || away > 30) {
      setMsg('יש להזין תוצאה תקינה (0-30)');
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      await api.post(`/predictions/match/${m.id}`, { home_score: home, away_score: away });
      const updated = await api.get('/predictions/my');
      setMyPredictions(updated.data.predictions || []);
      setEditingMatchId(null);
      setMsg('✓ הניחוש נשמר');
    } catch (e) {
      setMsg(e?.response?.data?.error || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const scoreTone = (side) => {
    const home = Number(draft.home);
    const away = Number(draft.away);
    if (!Number.isInteger(home) || !Number.isInteger(away)) return '';
    if (home === away) return 'score-equal';
    if (side === 'home') return home > away ? 'score-high' : 'score-low';
    return away > home ? 'score-high' : 'score-low';
  };

  return (
    <main className="page">
      <div className="trophy-banner">
        <h2>שלום {user.name}<span style={{color:'var(--gold)'}}> ⚽</span></h2>
        <p>זה הזמן לחזק את הניחושים שלך. ככל שתחזה מוקדם — כך תשמור על הסיכוי לנקודות מירביות.</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">המיקום שלי</div>
          <div className="value">{myRank ? `#${myRank.rank}` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">סך הכל נקודות</div>
          <div className="value" style={{color:'var(--crimson)'}}>{myRank?.total_points ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">ניחושים מולאו</div>
          <div className="value">{myPredictions.length} / {matches.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">קלעים מדויקים</div>
          <div className="value" style={{color:'var(--gold-deep)'}}>{myRank?.exact_hits ?? 0}</div>
        </div>
      </div>

      <div className="section-divider">
        <h2>המשחקים הבאים</h2>
        <span className="badge">UP NEXT</span>
      </div>

      {msg && <div className={`alert ${msg.startsWith('✓') ? 'alert-success' : 'alert-error'}`}>{msg}</div>}

      {upcoming.length === 0 ? (
        <p className="editorial" style={{color:'var(--muted)'}}>אין משחקים קרובים כרגע.</p>
      ) : (
        <div style={{display: 'grid', gap: 12}}>
          {upcoming.map(m => {
            const hasPrediction = predictedIds.has(m.id);
            const p = predictionMap[m.id];
            const locked = isLocked(m);
            const inEdit = editingMatchId === m.id;
            return (
              <MatchCard key={m.id} match={m}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap'}}>
                  {hasPrediction ? (
                    <span style={{color:'var(--pitch)', fontWeight:700, fontSize:14}}>
                      הניחוש שלי: {p.home_score} - {p.away_score}
                    </span>
                  ) : (
                    <span style={{color:'var(--muted)', fontWeight:600, fontSize:14}}>
                      אין ניחוש עדיין
                    </span>
                  )}

                  {!locked && !inEdit && (
                    <button type="button" className="btn btn-gold btn-sm" onClick={() => openEditor(m)}>
                      {hasPrediction ? 'ערוך ניחוש' : 'השלם ניחוש'}
                    </button>
                  )}
                  {locked && (
                    <span style={{color:'var(--muted)', fontSize:13}}>🔒 הניחוש נעול (פחות משעה לפתיחה)</span>
                  )}
                </div>

                {inEdit && (
                  <div style={{marginTop:12, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      className={`score-input ${scoreTone('home')}`}
                      value={draft.home}
                      onChange={(e) => setDraft(prev => ({ ...prev, home: e.target.value === '' ? '' : Number(e.target.value) }))}
                    />
                    <span className="dash">:</span>
                    <input
                      type="number"
                      min={0}
                      max={30}
                      className={`score-input ${scoreTone('away')}`}
                      value={draft.away}
                      onChange={(e) => setDraft(prev => ({ ...prev, away: e.target.value === '' ? '' : Number(e.target.value) }))}
                    />
                    <button type="button" className="btn btn-pitch btn-sm" onClick={() => savePrediction(m)} disabled={saving}>
                      {saving ? 'שומר...' : 'שמור'}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingMatchId(null)} disabled={saving}>
                      ביטול
                    </button>
                  </div>
                )}
              </MatchCard>
            );
          })}
        </div>
      )}

      {upcomingUnpredicted.length > 0 && (
        <div className="alert alert-error" style={{marginTop: 24}}>
          ⚠️ נותרו <strong>{upcomingUnpredicted.length}</strong> משחקים בלי ניחוש. השלם את הניחושים שלך לפני שיינעלו!
        </div>
      )}

      {topScoredUsers.length > 0 && (
        <>
          <div className="section-divider">
            <h2>טופ 5</h2>
            <span className="badge">LEADERBOARD</span>
          </div>

          <table className="leaderboard-table">
            <thead>
              <tr>
                <th style={{width: 80}}>מקום</th>
                <th>שחקן</th>
                <th style={{width: 120, textAlign:'end'}}>נקודות</th>
              </tr>
            </thead>
            <tbody>
              {topScoredUsers.map(r => (
                <tr key={r.id} className={r.rank <= 3 ? `top-${r.rank}` : ''}>
                  <td>
                    <span className={`rank-medal ${r.rank===1?'gold':r.rank===2?'silver':r.rank===3?'bronze':''}`}>
                      {r.rank}
                    </span>
                  </td>
                  <td style={{fontWeight: 600}}>{r.name}</td>
                  <td style={{textAlign:'end'}}><span className="total-pts">{r.total_points}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
