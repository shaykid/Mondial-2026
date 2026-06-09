import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import MatchCard from '../components/MatchCard';

export default function Matches() {
  const [matches, setMatches] = useState([]);
  const [myPredictions, setMyPredictions] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    Promise.all([
      api.get('/matches'),
      api.get('/predictions/my')
    ]).then(([matchesRes, predictionsRes]) => {
      setMatches(matchesRes.data);
      setMyPredictions(predictionsRes.data.predictions || []);
    });
  }, []);

  const predictionMap = useMemo(
    () => Object.fromEntries(myPredictions.map((p) => [p.match_id, p])),
    [myPredictions]
  );

  const groups = useMemo(() => {
    const list = matches.filter(m => {
      if (filter === 'all') return true;
      if (filter === 'finished') return m.status === 'finished';
      if (filter === 'upcoming') return m.status !== 'finished';
      return m.group_letter === filter;
    });
    const byDay = {};
    for (const m of list) {
      const day = m.kickoff.slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(m);
    }
    return Object.entries(byDay).sort(([a],[b]) => a.localeCompare(b));
  }, [matches, filter]);

  const groupLetters = ['A','B','C','D','E','F','G','H','I','J','K','L'];

  return (
    <main className="page">
      <h1 className="page-title">
        לוח <span className="accent">המשחקים</span>
      </h1>
      <p className="page-subtitle">כל 72 משחקי שלב הבתים — תאריכים, אצטדיונים ותוצאות</p>

      <div className="tabs" style={{flexWrap:'wrap'}}>
        <button className={`tab ${filter==='all'?'active':''}`} onClick={() => setFilter('all')}>הכל</button>
        <button className={`tab ${filter==='upcoming'?'active':''}`} onClick={() => setFilter('upcoming')}>קרובים</button>
        <button className={`tab ${filter==='finished'?'active':''}`} onClick={() => setFilter('finished')}>הסתיימו</button>
        {groupLetters.map(g => (
          <button key={g} className={`tab ${filter===g?'active':''}`} onClick={() => setFilter(g)}>בית {g}</button>
        ))}
      </div>

      {groups.map(([day, dayMatches]) => (
        <div key={day}>
          <div className="day-label">
            {new Date(day).toLocaleDateString('he-IL', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}
          </div>
          <div style={{display: 'grid', gap: 12}}>
            {dayMatches.map(m => {
              const prediction = predictionMap[m.id];
              const hasPrediction = prediction && Number.isInteger(prediction.home_score) && Number.isInteger(prediction.away_score);
              const showPoints = hasPrediction && m.status === 'finished';
              const points = Number(prediction?.points || 0);

              return (
                <MatchCard key={m.id} match={m}>
                  <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap'}}>
                    {hasPrediction ? (
                      <span style={{color:'var(--pitch)', fontWeight:700, fontSize:14}}>
                        הניחוש שלי: {prediction.home_score} - {prediction.away_score}
                      </span>
                    ) : (
                      <span style={{color:'var(--muted)', fontWeight:600, fontSize:14}}>
                        אין ניחוש שלי למשחק זה
                      </span>
                    )}

                    {showPoints && (
                      <span className={`points-pill ${points >= 5 ? 'exact' : points >= 3 ? 'high' : 'zero'}`}>
                        {points} נק׳
                      </span>
                    )}
                  </div>
                </MatchCard>
              );
            })}
          </div>
        </div>
      ))}

      {groups.length === 0 && <p style={{color:'var(--muted)'}}>אין משחקים לסינון זה.</p>}
    </main>
  );
}
