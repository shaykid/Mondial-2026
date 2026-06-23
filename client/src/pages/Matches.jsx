import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import MatchCard from '../components/MatchCard';
import ScoreText from '../components/ScoreText';
import { useTranslation } from '../i18n/TranslationContext';
import { ilDate, ilDayKey } from '../utils/time';

export default function Matches() {
  const { t, locale } = useTranslation();
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
      const day = ilDayKey(m.kickoff);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(m);
    }
    return Object.entries(byDay).sort(([a],[b]) => a.localeCompare(b));
  }, [matches, filter]);

  const groupLetters = ['A','B','C','D','E','F','G','H','I','J','K','L'];

  return (
    <main className="page">
      <h1 className="page-title">
        {t('matches.title')}
      </h1>
      <p className="page-subtitle">{t('matches.subtitle')}</p>

      <div className="tabs" style={{flexWrap:'wrap'}}>
        <button className={`tab ${filter==='all'?'active':''}`} onClick={() => setFilter('all')}>{t('matches.filter_all')}</button>
        <button className={`tab ${filter==='upcoming'?'active':''}`} onClick={() => setFilter('upcoming')}>{t('matches.filter_upcoming')}</button>
        <button className={`tab ${filter==='finished'?'active':''}`} onClick={() => setFilter('finished')}>{t('matches.filter_finished')}</button>
        {groupLetters.map(g => (
          <button key={g} className={`tab ${filter===g?'active':''}`} onClick={() => setFilter(g)}>{t('matches.group_prefix', { group: g })}</button>
        ))}
      </div>

      {groups.map(([day, dayMatches]) => (
        <div key={day}>
          <div className="day-label">
            {ilDate(dayMatches[0].kickoff, locale, { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}
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
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span>{t('home.my_guess_label')}</span>
                          <ScoreText home={prediction.home_score} away={prediction.away_score} />
                        </span>
                      </span>
                    ) : (
                      <span style={{color:'var(--muted)', fontWeight:600, fontSize:14}}>
                        {t('matches.no_prediction')}
                      </span>
                    )}

                    {showPoints && (
                      <span className={`points-pill ${points >= 5 ? 'exact' : points >= 3 ? 'high' : 'zero'}`}>
                        {points} {t('common.points')}
                      </span>
                    )}
                  </div>
                </MatchCard>
              );
            })}
          </div>
        </div>
      ))}

      {groups.length === 0 && <p style={{color:'var(--muted)'}}>{t('matches.no_rows')}</p>}
    </main>
  );
}
