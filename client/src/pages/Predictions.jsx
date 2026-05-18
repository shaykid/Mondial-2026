import { useEffect, useMemo, useState } from 'react';
import api, { errMsg } from '../api/client';
import Flag from '../components/Flag';

function formatDateTime(iso) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', weekday: 'short' }),
    time: d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
  };
}

function flagEmojiFromCode(code) {
  if (!code) return '🏳️';
  const c = String(code).toLowerCase();
  const map = {
    'gb-eng': '🏴', 'gb-sct': '🏴', 'gb-wls': '🏴', 'gb-nir': '🏴'
  };
  if (map[c]) return map[c];
  const base = c.slice(0, 2);
  if (!/^[a-z]{2}$/.test(base)) return '🏳️';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + base.charCodeAt(0) - 97, A + base.charCodeAt(1) - 97);
}

function scoreTone(side, home, away) {
  if (!Number.isInteger(home) || !Number.isInteger(away)) return '';
  if (home === away) return 'score-equal';
  if (side === 'home') return home > away ? 'score-high' : 'score-low';
  return away > home ? 'score-high' : 'score-low';
}

export default function Predictions() {
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [predictions, setPredictions] = useState({});  // matchId -> {home, away, points, locked, saved}
  const [special, setSpecial] = useState({ champion_code: '', runner_up_code: '', top_scorer: '' });
  const [players, setPlayers] = useState([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [specialDirty, setSpecialDirty] = useState(false);
  const [lockHours, setLockHours] = useState(1);
  const [tab, setTab] = useState('group');
  const [savingId, setSavingId] = useState(null);
  const [savingSpecial, setSavingSpecial] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/matches'),
      api.get('/teams'),
      api.get('/predictions/my'),
      api.get('/predictions/players')
    ]).then(([m, t, p, pl]) => {
      setMatches(m.data);
      setTeams(t.data);
      setPlayers(pl.data || []);
      const pmap = {};
      for (const pr of p.data.predictions) {
        pmap[pr.match_id] = {
          home: pr.home_score,
          away: pr.away_score,
          points: pr.points,
          saved: true,
          actual_home: pr.actual_home,
          actual_away: pr.actual_away,
          status: pr.status
        };
      }
      setPredictions(pmap);
      if (p.data.special) setSpecial(p.data.special);
      setSpecialDirty(false);
    });
  }, []);

  const onChange = (matchId, side, value) => {
    setPredictions(prev => ({
      ...prev,
      [matchId]: {
        ...prev[matchId],
        [side]: value === '' ? '' : Number(value),
        saved: false
      }
    }));
  };

  const save = async (matchId) => {
    const p = predictions[matchId];
    if (!Number.isInteger(p?.home) || !Number.isInteger(p?.away)) {
      setMsg('יש להזין שני מספרים תקינים');
      return;
    }
    setSavingId(matchId);
    setMsg('');
    try {
      await api.post(`/predictions/match/${matchId}`, { home_score: p.home, away_score: p.away });
      setPredictions(prev => ({ ...prev, [matchId]: { ...prev[matchId], saved: true } }));
      setMsg('✓ הניחוש נשמר');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSavingId(null);
    }
  };

  const saveSpecial = async () => {
    setSavingSpecial(true); setMsg('');
    try {
      await api.post('/predictions/special', special);
      setSpecialDirty(false);
      setMsg('✓ ניחושים מיוחדים נשמרו');
      setTimeout(() => setMsg(''), 2000);
    } catch (e) { setMsg(errMsg(e)); }
    finally { setSavingSpecial(false); }
  };

  const saveAll = async () => {
    const dirtyPredictions = Object.entries(predictions)
      .filter(([, p]) => !p.saved)
      .map(([id, p]) => ({ id: Number(id), home: p.home, away: p.away }))
    const invalidDirty = dirtyPredictions.some(({ home, away }) => !Number.isInteger(home) || !Number.isInteger(away));
    const dirtyMatches = dirtyPredictions.filter(({ home, away }) => Number.isInteger(home) && Number.isInteger(away));

    const needsSpecialSave = specialDirty;

    if (invalidDirty) {
      setMsg('יש ניחושים לא תקינים. תקן אותם ואז שמור הכל');
      return;
    }

    if (dirtyMatches.length === 0 && !needsSpecialSave) {
      setMsg('אין שינויים לשמור');
      return;
    }

    setSavingAll(true);
    setMsg('');
    try {
      const tasks = [
        ...dirtyMatches.map(({ id, home, away }) =>
          api.post(`/predictions/match/${id}`, { home_score: home, away_score: away })
        ),
      ];
      if (needsSpecialSave) tasks.push(api.post('/predictions/special', special));

      const results = await Promise.allSettled(tasks);
      const matchResults = results.slice(0, dirtyMatches.length);
      const specialResult = needsSpecialSave ? results[results.length - 1] : null;
      const failedMatches = matchResults.filter(r => r.status === 'rejected').length;
      const savedMatches = dirtyMatches.length - failedMatches;

      if (savedMatches > 0) {
        setPredictions(prev => {
          const next = { ...prev };
          dirtyMatches.forEach(({ id }, index) => {
            if (matchResults[index]?.status === 'fulfilled' && next[id]) {
              next[id] = { ...next[id], saved: true };
            }
          });
          return next;
        });
      }
      if (needsSpecialSave && specialResult?.status === 'fulfilled') setSpecialDirty(false);

      const specialFailed = needsSpecialSave && specialResult?.status === 'rejected';

      if (failedMatches > 0 || specialFailed) {
        const totalFailed = failedMatches + (specialFailed ? 1 : 0);
        setMsg(`✓ נשמרו ${savedMatches} ניחושים, ${totalFailed} נכשלו`);
      } else if (savedMatches > 0 && needsSpecialSave) {
        setMsg(`✓ נשמרו ${savedMatches} ניחושים וניחושים מיוחדים`);
      } else if (savedMatches > 0) {
        setMsg(`✓ נשמרו ${savedMatches} ניחושים`);
      } else {
        setMsg('✓ ניחושים מיוחדים נשמרו');
      }
      setTimeout(() => setMsg(''), 2000);
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setSavingAll(false);
    }
  };

  // קיבוץ משחקים לפי תאריך
  const byDay = useMemo(() => {
    const groups = {};
    const list = matches.filter(m => m.stage === 'group' || tab === 'all');
    for (const m of list) {
      const day = m.kickoff.slice(0, 10);
      if (!groups[day]) groups[day] = [];
      groups[day].push(m);
    }
    return Object.entries(groups).sort(([a],[b]) => a.localeCompare(b));
  }, [matches, tab]);

  const completedCount = Object.values(predictions).filter(p => Number.isInteger(p.home)).length;

  return (
    <main className="page">
      <h1 className="page-title">
        הניחו<span className="word-shiach">שיח</span> שלי
      </h1>
      <p className="page-subtitle">
        השלמת {completedCount} מתוך {matches.length} משחקים · כל ניחוש נסגר {lockHours} שעה לפני בעיטת הפתיחה
      </p>

      {msg && <div className={`alert ${msg.startsWith('✓') ? 'alert-success' : 'alert-error'}`} style={{position:'sticky', top: 80, zIndex: 10}}>{msg}</div>}

      <div className="predictions-toolbar">
        <div className="tabs">
          <button className={`tab ${tab==='group'?'active':''}`} onClick={() => setTab('group')}>שלב הבתים</button>
          <button className={`tab ${tab==='special'?'active':''}`} onClick={() => setTab('special')}>ניחושים מיוחדים</button>
        </div>
        <button
          type="button"
          className="btn btn-gold predictions-save-all"
          onClick={saveAll}
          disabled={savingAll || (Object.values(predictions).every(p => p.saved) && !specialDirty)}
        >
          {savingAll ? <span className="spinner" /> : 'שמור הכל'}
        </button>
      </div>

      {tab === 'special' ? (
        <SpecialPredictions
          teams={teams}
          players={players}
          special={special}
          playerSearch={playerSearch}
          setPlayerSearch={setPlayerSearch}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          setSpecial={(next) => {
            setSpecial(next);
            setSpecialDirty(true);
          }}
          onSave={saveSpecial}
          saving={savingSpecial}
        />
      ) : (
        <>
          {byDay.map(([day, dayMatches]) => (
            <div key={day}>
              <div className="day-label">
                {new Date(day).toLocaleDateString('he-IL', { weekday:'long', day:'2-digit', month:'long' })}
              </div>
              {dayMatches.map(m => {
                const p = predictions[m.id] || {};
                const kickoff = new Date(m.kickoff).getTime();
                const lockTime = kickoff - lockHours * 3600 * 1000;
                const locked = Date.now() >= lockTime;
                const finished = m.status === 'finished';
                const { time } = formatDateTime(m.kickoff);
                return (
                  <div key={m.id} className={`prediction-row ${locked ? 'locked' : ''} ${p.points ? 'scored' : ''}`}>
                    <div className="match-team home">
                      <span className="name">{m.home_name}</span>
                      <Flag code={m.home_code} size="sm" title={m.home_name} />
                      <span style={{color:'var(--muted)', fontSize:12, marginInlineStart: 8}}>{time}</span>
                    </div>

                    <div className="scores-block">
                      <input
                        type="number"
                        className={`score-input ${scoreTone('home', p.home, p.away)}`}
                        min={0} max={30}
                        value={p.home ?? ''}
                        disabled={locked || finished}
                        onChange={e => onChange(m.id, 'home', e.target.value)}
                      />
                      <span className="dash">:</span>
                      <input
                        type="number"
                        className={`score-input ${scoreTone('away', p.home, p.away)}`}
                        min={0} max={30}
                        value={p.away ?? ''}
                        disabled={locked || finished}
                        onChange={e => onChange(m.id, 'away', e.target.value)}
                      />
                    </div>

                    <div className="match-team away">
                      <Flag code={m.away_code} size="sm" title={m.away_name} />
                      <span className="name">{m.away_name}</span>
                      {(p.actual_home != null && p.actual_away != null) && (
                        <span className="numeric" style={{marginInlineStart: 12, padding:'2px 8px', background:'var(--ink)', color:'var(--gold)', fontSize:14, borderRadius:2}}>
                          תוצאה: {p.actual_home}–{p.actual_away}
                        </span>
                      )}
                      {p.points != null && p.points > 0 && (
                        <span className={`points-pill ${p.points >= 5 ? 'exact' : p.points >= 3 ? 'high' : ''}`}>
                          {p.points} נק׳
                        </span>
                      )}
                      {!locked && !finished && !p.saved && Number.isInteger(p.home) && (
                        <button className="btn btn-sm btn-pitch" onClick={() => save(m.id)} disabled={savingId === m.id}>
                          {savingId === m.id ? '...' : 'שמור'}
                        </button>
                      )}
                      {p.saved && !locked && <span style={{color:'var(--pitch)', fontSize:13}}>✓ נשמר</span>}
                      {locked && !finished && <span style={{color:'var(--muted)', fontSize:12}}>🔒 נעול</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </main>
  );
}

function SpecialPredictions({ teams, players, special, setSpecial, onSave, saving, playerSearch, setPlayerSearch, pickerOpen, setPickerOpen }) {
  const champion = teams.find(t => t.code === special.champion_code);
  const runnerUp = teams.find(t => t.code === special.runner_up_code);
  const selectedPlayer = players.find(p => p.id === special.top_scorer_player_id);
  const filteredPlayers = players.filter(p => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return true;
    return String(p.name_en || '').toLowerCase().includes(q)
      || String(p.name_he || '').toLowerCase().includes(q)
      || String(p.country_en || '').toLowerCase().includes(q)
      || String(p.country_he || '').toLowerCase().includes(q);
  });
  return (
    <>
    <div style={{display:'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', maxWidth: 900}}>
      <div className="stat-card" style={{borderTop:'4px solid var(--gold)', position:'relative', zIndex:1}}>
        <div className="label">🏆 אלופת המונדיאל</div>
        <p style={{fontSize:13, color:'var(--muted)', margin:'4px 0 12px'}}>20 נקודות בניחוש מדויק</p>
        {champion && (
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8, fontSize:13}}>
            <Flag code={champion.code} size="sm" title={champion.name_he} />
            <span>{champion.name_he}</span>
          </div>
        )}
        <select className="field" value={special.champion_code || ''} onChange={e => setSpecial({...special, champion_code: e.target.value})} style={{width:'100%', padding:12}}>
          <option value="">בחר נבחרת...</option>
          {teams.map(t => <option key={t.code} value={t.code}>{flagEmojiFromCode(t.code)} {t.name_he}</option>)}
        </select>
      </div>

      <div className="stat-card" style={{borderTop:'4px solid #c9d1d9', position:'relative', zIndex:1}}>
        <div className="label">🥈 סגנית האלופה</div>
        <p style={{fontSize:13, color:'var(--muted)', margin:'4px 0 12px'}}>10 נקודות בניחוש מדויק</p>
        {runnerUp && (
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8, fontSize:13}}>
            <Flag code={runnerUp.code} size="sm" title={runnerUp.name_he} />
            <span>{runnerUp.name_he}</span>
          </div>
        )}
        <select className="field" value={special.runner_up_code || ''} onChange={e => setSpecial({...special, runner_up_code: e.target.value})} style={{width:'100%', padding:12}}>
          <option value="">בחר נבחרת...</option>
          {teams.map(t => <option key={t.code} value={t.code}>{flagEmojiFromCode(t.code)} {t.name_he}</option>)}
        </select>
      </div>

      <div className="stat-card" style={{borderTop:'4px solid var(--crimson)'}}>
        <div className="label">👑 מלך השערים</div>
        <p style={{fontSize:13, color:'var(--muted)', margin:'4px 0 12px'}}>15 נקודות בניחוש מדויק</p>
        {selectedPlayer ? (
          <div style={{display:'flex', gap:10, alignItems:'center', marginBottom:10}}>
            {selectedPlayer.image_url && <img src={selectedPlayer.image_url} alt={selectedPlayer.name_en} style={{width:44, height:44, borderRadius:'50%', objectFit:'cover', border:'2px solid var(--line)'}} />}
            <div style={{lineHeight:1.2}}>
              <div style={{fontWeight:700}}>{selectedPlayer.name_he}</div>
              <div style={{fontSize:12, color:'var(--muted)'}}>{selectedPlayer.name_en} · {selectedPlayer.country_he || selectedPlayer.country_en || ''}</div>
            </div>
          </div>
        ) : <div style={{fontSize:13, color:'var(--muted)', marginBottom:10}}>לא נבחר שחקן</div>}
        <button className="btn btn-outline" onClick={() => setPickerOpen(true)} type="button">
          בחר שחקן
        </button>
      </div>

      <div style={{gridColumn: '1 / -1'}}>
        <button className="btn btn-gold" onClick={onSave} disabled={saving}>
          {saving ? <span className="spinner" /> : 'שמור ניחושים מיוחדים'}
        </button>
      </div>
    </div>
    {pickerOpen && (
      <div className="player-picker-overlay" onClick={() => setPickerOpen(false)}>
        <div className="player-picker-modal" onClick={(e) => e.stopPropagation()}>
          <div className="player-picker-head">
            <h3>בחירת מלך השערים</h3>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setPickerOpen(false)}>סגור</button>
          </div>
          <input
            className="field"
            placeholder="חיפוש שחקן / מדינה"
            value={playerSearch}
            onChange={e => setPlayerSearch(e.target.value)}
            style={{width:'100%', padding:12, marginBottom:12}}
          />
          <div className="player-list">
            {filteredPlayers.map(p => (
              <button
                key={p.id}
                type="button"
                className={`player-item ${special.top_scorer_player_id === p.id ? 'active' : ''}`}
                onClick={() => {
                  setSpecial({ ...special, top_scorer_player_id: p.id, top_scorer: p.name_en });
                  setPickerOpen(false);
                }}
              >
                {p.image_url ? <img src={p.image_url} alt={p.name_en} /> : <span className="player-avatar-fallback">👤</span>}
                <span className="player-item-text">
                  <strong>{p.name_he}</strong>
                  <small>
                    {p.name_en} · {p.country_he || p.country_en || ''}
                    {p.team_code ? <span style={{display:'inline-flex', alignItems:'center', gap:6, marginInlineStart:8}}><Flag code={p.team_code} size="sm" title={p.country_he || p.country_en || p.name_en} /></span> : null}
                  </small>
                </span>
              </button>
            ))}
            {filteredPlayers.length === 0 && <div style={{padding: 12, color:'var(--muted)'}}>אין תוצאות</div>}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
