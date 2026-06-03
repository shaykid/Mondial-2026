import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Leaderboard() {
  const [rows, setRows] = useState([]);
  const { user } = useAuth();

  useEffect(() => {
    api.get('/leaderboard').then(r => setRows(r.data));
  }, []);

  const totalUsers = rows.length;
  const activeUsers = rows.filter((r) => Number(r.num_predictions || 0) > 0).length;
  const participantsPercent = totalUsers ? ((activeUsers / totalUsers) * 100) : 0;
  const avgScore = totalUsers
    ? (rows.reduce((sum, r) => sum + Number(r.total_points || 0), 0) / totalUsers)
    : 0;

  return (
    <main className="page">
      <h1 className="page-title">
        טבלת <span className="accent">המצטיינים</span>
      </h1>
      <p className="page-subtitle">דירוג כל העובדים לפי נקודות שנצברו · מתעדכן אוטומטית עם כל משחק שמסתיים</p>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="label">אחוז משתתפים פעילים</div>
          <div className="value">{participantsPercent.toFixed(1)}%</div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>{activeUsers} מתוך {totalUsers}</div>
        </div>
        <div className="stat-card">
          <div className="label">ממוצע ציונים</div>
          <div className="value">{avgScore.toFixed(1)}</div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>נקודות למשתתף</div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th style={{width: 80}}>מקום</th>
              <th>שם</th>
              <th style={{width: 90, textAlign:'center'}}>ניחושים</th>
              <th style={{width: 100, textAlign:'center'}}>מדויקים</th>
              <th style={{width: 100, textAlign:'center'}}>בונוס</th>
              <th style={{width: 130, textAlign:'end'}}>סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className={
                `${r.rank <= 3 ? `top-${r.rank}` : ''} ${r.id === user.id ? 'me' : ''}`
              } style={r.id === user.id ? { outline: '2px solid var(--gold)', outlineOffset: -2 } : {}}>
                <td>
                  <span className={`rank-medal ${r.rank===1?'gold':r.rank===2?'silver':r.rank===3?'bronze':''}`}>
                    {r.rank}
                  </span>
                </td>
                <td>
                  <div className="leaderboard-user">
                    {r.profile_image_url ? (
                      <img className="leaderboard-avatar" src={r.profile_image_url} alt={r.name} />
                    ) : (
                      <div className="leaderboard-avatar leaderboard-avatar-fallback">{(r.name || '?').slice(0, 1)}</div>
                    )}
                    <div className="leaderboard-user-meta">
                      <strong>{r.name}</strong>
                    </div>
                  </div>
                  {r.id === user.id && <span style={{marginInlineStart: 8, color:'var(--gold-deep)', fontSize: 11, letterSpacing:'.15em'}}>· זה אני</span>}
                </td>
                <td style={{textAlign:'center', color:'var(--muted)'}}>{r.num_predictions}</td>
                <td style={{textAlign:'center'}}>
                  {r.exact_hits > 0 ? <span className="points-pill exact">{r.exact_hits}</span> : <span style={{color:'var(--muted)'}}>—</span>}
                </td>
                <td style={{textAlign:'center'}}>
                  {r.bonus_points > 0 ? <span className="points-pill high">{r.bonus_points}</span> : <span style={{color:'var(--muted)'}}>—</span>}
                </td>
                <td style={{textAlign:'end'}}><span className="total-pts">{r.total_points}</span></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} style={{textAlign:'center', color:'var(--muted)', padding:32}}>עדיין אין משתתפים. שתף את הלינק עם הצוות!</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
