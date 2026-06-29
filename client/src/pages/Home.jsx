import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import Flag from '../components/Flag';
import MatchCard from '../components/MatchCard';
import CoinIcon from '../components/CoinIcon';
import ScoreText from '../components/ScoreText';
import { useTranslation } from '../i18n/TranslationContext';
import { ilMs } from '../utils/time';

export default function Home() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [matches, setMatches] = useState([]);
  const [myPredictions, setMyPredictions] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [coinStats, setCoinStats] = useState(null);
  const [coinBoard, setCoinBoard] = useState([]);
  const [editingMatchId, setEditingMatchId] = useState(null);
  const [draft, setDraft] = useState({ home: '', away: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/matches').then(r => setMatches(r.data)).catch(() => {});
    api.get('/predictions/my').then(r => setMyPredictions(r.data.predictions)).catch(() => {});
    api.get('/leaderboard').then(r => setLeaderboard(r.data)).catch(() => {});
    if (!user.isGuest) {
      api.get('/coin-bets/stats').then(r => setCoinStats(r.data)).catch(() => {});
      api.get('/coin-bets/leaderboard').then(r => setCoinBoard((r.data || []).slice(0, 5))).catch(() => {});
    }
  }, []);

  const toggleChallengeOpen = async () => {
    if (!coinStats) return;
    const next = !coinStats.challenge_open;
    setCoinStats(s => ({ ...s, challenge_open: next }));
    try { await api.post('/coin-bets/challenge-visibility', { open: next }); }
    catch { setCoinStats(s => ({ ...s, challenge_open: !next })); }
  };

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
    const kickoff = ilMs(m.kickoff);
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
      setMsg(t('home.invalid_score'));
      return;
    }
    setSaving(true);
    setMsg('');
    try {
      await api.post(`/predictions/match/${m.id}`, { home_score: home, away_score: away });
      const updated = await api.get('/predictions/my');
      setMyPredictions(updated.data.predictions || []);
      setEditingMatchId(null);
      setMsg(t('home.saved'));
    } catch (e) {
      setMsg(e?.response?.data?.error || t('home.save_error'));
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
        <h2>{t('home.greeting', { name: user.name })}<span style={{color:'var(--gold)'}}> ⚽</span></h2>
        <p>{t('home.banner_copy')}</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">{t('home.my_rank')}</div>
          <div className="value">{myRank ? `#${myRank.rank}` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('home.total_points')}</div>
          <div className="value" style={{color:'var(--crimson)'}}>{myRank?.total_points ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('home.filled_predictions')}</div>
          <div className="value">{myPredictions.length} / {matches.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('home.exact_hits')}</div>
          <div className="value" style={{color:'var(--gold-deep)'}}>{myRank?.exact_hits ?? 0}</div>
        </div>
        {coinStats && (
          <Link to="/coin-bets" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="label">{t('coin.balance')}</div>
            <div className="value" style={{color:'var(--gold)'}}><CoinIcon size={16} /> {coinStats.balance.toLocaleString()}</div>
            <div className="stat-sub" style={{ color: coinStats.last_day_net >= 0 ? 'var(--pitch)' : 'var(--crimson)' }}>
              {coinStats.last_day_net >= 0 ? '+' : ''}{coinStats.last_day_net.toLocaleString()} {t('coin.last_day')}
            </div>
          </Link>
        )}
      </div>

      {coinStats && (
        <div className="challenge-open-bar">
          <div>
            <strong>{t('coin.challenge_open_title')}</strong>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('coin.challenge_open_help')}</div>
          </div>
          <button
            type="button"
            className={`toggle-pill ${coinStats.challenge_open ? 'on' : ''}`}
            onClick={toggleChallengeOpen}
          >
            {coinStats.challenge_open ? t('coin.open_yes') : t('coin.open_no')}
          </button>
        </div>
      )}

      <div className="section-divider">
        <h2>{t('home.next_matches')}</h2>
        <span className="badge">UP NEXT</span>
      </div>

      {msg && <div className={`alert ${msg.startsWith('✓') ? 'alert-success' : 'alert-error'}`}>{msg}</div>}

      {upcoming.length === 0 ? (
        <p className="editorial" style={{color:'var(--muted)'}}>{t('home.no_upcoming')}</p>
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
                    <span
                      dir="ltr"
                      style={{color:'var(--pitch)', fontWeight:700, fontSize:14, display:'inline-flex', gap:6, alignItems:'baseline', flexWrap:'wrap'}}
                    >
                      <span>{t('home.my_guess_label')}</span>
                      <ScoreText home={p.home_score} away={p.away_score} homeRight />
                    </span>
                  ) : (
                    <span style={{color:'var(--muted)', fontWeight:600, fontSize:14}}>
                      {t('home.no_guess')}
                    </span>
                  )}

                  {!locked && !inEdit && (
                    <button type="button" className="btn btn-gold btn-sm" onClick={() => openEditor(m)}>
                      {hasPrediction ? t('home.edit_guess') : t('home.complete_guess')}
                    </button>
                  )}
                  {locked && (
                    <span style={{color:'var(--muted)', fontSize:13}}>{t('home.locked_hint')}</span>
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
                      {saving ? t('common.saving') : t('common.save')}
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingMatchId(null)} disabled={saving}>
                      {t('common.cancel')}
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
          {t('home.unpredicted_alert', { count: upcomingUnpredicted.length })}
        </div>
      )}

      {topScoredUsers.length > 0 && (
        <>
          <div className="section-divider">
            <h2>{t('home.top5')}</h2>
            <span className="badge">LEADERBOARD</span>
          </div>

          <table className="leaderboard-table">
            <thead>
              <tr>
                <th style={{width: 80}}>{t('home.place')}</th>
                <th>{t('home.player')}</th>
                <th style={{width: 120, textAlign:'end'}}>{t('home.points')}</th>
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

      {coinBoard.length > 0 && (
        <>
          <div className="section-divider">
            <h2><CoinIcon size={20} /> {t('coin.top5_coins')}</h2>
            <span className="badge">שיחים</span>
          </div>
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th style={{width: 80}}>{t('home.place')}</th>
                <th>{t('home.player')}</th>
                <th style={{width: 120, textAlign:'end'}}>{t('coin.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {coinBoard.map(r => (
                <tr key={r.id} className={r.rank <= 3 ? `top-${r.rank}` : ''}>
                  <td>
                    <span className={`rank-medal ${r.rank===1?'gold':r.rank===2?'silver':r.rank===3?'bronze':''}`}>{r.rank}</span>
                  </td>
                  <td style={{fontWeight: 600}}>{r.name}</td>
                  <td style={{textAlign:'end', color:'var(--gold-deep)', fontWeight:700}}>{r.balance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
