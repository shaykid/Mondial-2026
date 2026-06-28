import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { errMsg } from '../api/client';
import Flag from '../components/Flag';
import ScoreText from '../components/ScoreText';
import { useTranslation } from '../i18n/TranslationContext';
import { useAuth } from '../context/AuthContext';
import { ilDate, ilTime, ilMs, ilDayKey, parseScheduleLockMs } from '../utils/time';

function formatDateTime(iso, locale) {
  return {
    date: ilDate(iso, locale, { day: '2-digit', month: '2-digit', weekday: 'short' }),
    time: ilTime(iso, locale, { hour: '2-digit', minute: '2-digit' })
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
  const { t, locale, pickText, language } = useTranslation();
  const { user, guestCheckEmail, guestFinalize } = useAuth();
  const nav = useNavigate();
  const isGuest = !!user?.isGuest;
  // הרשמת אורח בסיום: אימייל → טלפון → קדימה
  const [regOpen, setRegOpen] = useState(false);
  const [regStep, setRegStep] = useState('email');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regEmailExists, setRegEmailExists] = useState(false);
  const [regBusy, setRegBusy] = useState(false);
  const [regErr, setRegErr] = useState('');
  const [autoPrompted, setAutoPrompted] = useState(false);
  const [matches, setMatches] = useState([]);
  const [teams, setTeams] = useState([]);
  const [predictions, setPredictions] = useState({});  // matchId -> {home, away, points, locked, saved}
  const [special, setSpecial] = useState({ champion_code: '', runner_up_code: '', top_scorer: '' });
  const [specialLocked, setSpecialLocked] = useState(false);
  const [specialLockLabel, setSpecialLockLabel] = useState('');
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
      api.get('/predictions/players'),
      api.get('/schedule'),
      api.get('/site/scoring')
    ]).then(([m, t, p, pl, scheduleRes, scoringRes]) => {
      setMatches(m.data);
      setTeams(t.data);
      setPlayers(pl.data || []);
      // נעילת ניחושים — לפי ההגדרה בשרת (lock_hours_before), במקום ערך קבוע
      const lh = Number(scoringRes?.data?.lockHoursBefore);
      if (Number.isFinite(lh) && lh >= 0) setLockHours(lh);
      const specialLockRow = (scheduleRes.data || []).find((item) => item.title === 'סגירת ניחושים מיוחדים');
      if (specialLockRow) {
        const lockAt = parseScheduleLockMs(specialLockRow);
        setSpecialLocked(Date.now() >= lockAt);
        setSpecialLockLabel(specialLockRow.date_label || '');
      }
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

  // תוצאה אקראית 0..5 — תוצאות גבוהות (5) נדירות יותר; תיקו אפשרי
  const randomScore = () => {
    const weights = [22, 26, 24, 16, 8, 4]; // 0,1,2,3,4,5
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let s = 0; s < weights.length; s++) { r -= weights[s]; if (r < 0) return s; }
    return 0;
  };

  // מילוי אקראי של כל הניחושים הריקים (משחקים שלא ננעלו ולא הסתיימו)
  const randomFill = () => {
    setPredictions(prev => {
      const next = { ...prev };
      let filled = 0;
      for (const m of matches) {
        if (m.status === 'finished') continue;
        const lockTime = ilMs(m.kickoff) - lockHours * 3600 * 1000;
        if (Date.now() >= lockTime) continue;
        const cur = next[m.id] || {};
        const hasHome = Number.isInteger(cur.home);
        const hasAway = Number.isInteger(cur.away);
        if (hasHome && hasAway) continue; // לא דורסים ניחוש קיים
        next[m.id] = {
          ...cur,
          home: hasHome ? cur.home : randomScore(),
          away: hasAway ? cur.away : randomScore(),
          saved: false
        };
        filled++;
      }
      if (!filled) setMsg(t('predictions.random_none') || 'אין ניחושים ריקים למילוי');
      return next;
    });
  };

  // ─── הרשמת אורח בסיום ───
  const filledCount = Object.values(predictions).filter(p => Number.isInteger(p.home) && Number.isInteger(p.away)).length;
  const openReg = () => { setRegErr(''); setRegStep('email'); setRegOpen(true); };

  const regContinueEmail = async () => {
    const email = regEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setRegErr('יש להזין כתובת אימייל תקינה'); return; }
    setRegBusy(true); setRegErr('');
    try {
      const exists = await guestCheckEmail(email);
      setRegEmailExists(exists);
      setRegStep('phone');
    } catch (e) { setRegErr(errMsg(e)); }
    finally { setRegBusy(false); }
  };

  const regSubmit = async () => {
    if (regPhone.replace(/\D/g, '').length < 6) { setRegErr('יש להזין מספר טלפון תקין'); return; }
    setRegBusy(true); setRegErr('');
    try {
      await guestFinalize(regEmail.trim().toLowerCase(), regPhone.trim());
      setRegOpen(false);
      nav('/');
    } catch (e) {
      setRegErr(errMsg(e));
    } finally { setRegBusy(false); }
  };

  // אורח: פתיחה אוטומטית של ההרשמה לאחר 3 ניחושים
  useEffect(() => {
    if (isGuest && !autoPrompted && !regOpen && filledCount >= 3) {
      setAutoPrompted(true);
      openReg();
    }
  }, [isGuest, autoPrompted, regOpen, filledCount]);

  const save = async (matchId) => {
    const p = predictions[matchId];
    if (!Number.isInteger(p?.home) || !Number.isInteger(p?.away)) {
      setMsg(t('predictions.invalid_two_scores'));
      return;
    }
    setSavingId(matchId);
    setMsg('');
    try {
      await api.post(`/predictions/match/${matchId}`, { home_score: p.home, away_score: p.away });
      setPredictions(prev => ({ ...prev, [matchId]: { ...prev[matchId], saved: true } }));
      setMsg(t('predictions.saved'));
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
      setMsg(t('predictions.special_saved'));
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
      setMsg(t('predictions.invalid_dirty'));
      return;
    }

    if (dirtyMatches.length === 0 && !needsSpecialSave) {
      setMsg(t('predictions.no_changes'));
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
        setMsg(t('predictions.saved_count_failed', { saved: savedMatches, failed: totalFailed }));
      } else if (savedMatches > 0 && needsSpecialSave) {
        setMsg(t('predictions.saved_count_and_special', { saved: savedMatches }));
      } else if (savedMatches > 0) {
        setMsg(t('predictions.saved_count', { saved: savedMatches }));
      } else {
        setMsg(t('predictions.special_saved'));
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
      const day = ilDayKey(m.kickoff);
      if (!groups[day]) groups[day] = [];
      groups[day].push(m);
    }
    return Object.entries(groups).sort(([a],[b]) => a.localeCompare(b));
  }, [matches, tab]);

  const completedCount = Object.values(predictions).filter(p => Number.isInteger(p.home)).length;

  return (
    <main className="page">
      <h1 className="page-title">
        {t('predictions.title')}
      </h1>
      <p className="page-subtitle">
        {t('predictions.subtitle', { completed: completedCount, total: matches.length, hours: lockHours })}
      </p>

      {msg && <div className={`alert ${msg.startsWith('✓') ? 'alert-success' : 'alert-error'}`} style={{position:'sticky', top: 80, zIndex: 10}}>{msg}</div>}

      {isGuest && (
        <div className="alert" style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap', background:'var(--paper-pure)', border:'1px solid var(--gold)' }}>
          <span>אתה משחק כאורח — מלא ניחושים ולחץ "סיום והרשמה" כדי לשמור אותם ולהצטרף.</span>
          <button type="button" className="btn btn-gold" onClick={openReg}>סיום והרשמה</button>
        </div>
      )}

      <div className="predictions-toolbar">
        <div className="tabs">
          <button className={`tab ${tab==='group'?'active':''}`} onClick={() => setTab('group')}>{t('predictions.group_stage')}</button>
          <button className={`tab ${tab==='special'?'active':''}`} onClick={() => setTab('special')}>{t('predictions.special')}</button>
        </div>
        {tab === 'group' && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={randomFill}
            style={{ marginInlineEnd: 8 }}
          >
            מילוי אקראי
          </button>
        )}
        <button
          type="button"
          className="btn btn-gold predictions-save-all"
          onClick={saveAll}
          disabled={savingAll || (Object.values(predictions).every(p => p.saved) && !specialDirty)}
        >
          {savingAll ? <span className="spinner" /> : t('common.save_all')}
        </button>
      </div>

      {tab === 'special' ? (
        <SpecialPredictions
          teams={teams}
          players={players}
          special={special}
          specialLocked={specialLocked}
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
          t={t}
          locale={locale}
          pickText={pickText}
          language={language}
          specialLockLabel={specialLockLabel}
        />
      ) : (
        <>
          {byDay.map(([day, dayMatches]) => (
            <div key={day}>
              <div className="day-label">
                {ilDate(dayMatches[0].kickoff, locale, { weekday:'long', day:'2-digit', month:'long' })}
              </div>
              {dayMatches.map(m => {
                const p = predictions[m.id] || {};
                const kickoff = ilMs(m.kickoff);
                const lockTime = kickoff - lockHours * 3600 * 1000;
                const locked = Date.now() >= lockTime;
                const finished = m.status === 'finished';
                const { time } = formatDateTime(m.kickoff, locale);
                const homeName = pickText(m.home_name, m.home_name_en, m.home_name_ar);
                const awayName = pickText(m.away_name, m.away_name_en, m.away_name_ar);
                return (
                  <div key={m.id} className={`prediction-row ${locked ? 'locked' : ''} ${finished ? 'finished-result' : ''} ${p.points ? 'scored' : ''}`} dir="ltr">
                    <div className="match-team home">
                      <span className="name">{homeName}</span>
                      <Flag code={m.home_code} size="sm" title={homeName} />
                    </div>

                    <div className="scores-col">
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
                      <span className="match-time-under">{time}</span>
                      {finished && m.home_score != null && m.away_score != null && (
                        <span className="match-final-score">
                          <span>{t('predictions.result', { home: m.home_score, away: m.away_score })}</span>
                        </span>
                      )}
                    </div>

                    <div className="match-team away">
                      <Flag code={m.away_code} size="sm" title={awayName} />
                      <span className="name">{awayName}</span>
                      {p.points != null && p.points > 0 && (
                        <span className={`points-pill ${p.points >= 5 ? 'exact' : p.points >= 3 ? 'high' : ''}`}>
                          {p.points} {t('common.points')}
                        </span>
                      )}
                      {!locked && !finished && !p.saved && Number.isInteger(p.home) && (
                        <button className="btn btn-sm btn-pitch" onClick={() => save(m.id)} disabled={savingId === m.id}>
                          {savingId === m.id ? '...' : t('common.save')}
                        </button>
                      )}
                      {p.saved && !locked && <span style={{color:'var(--pitch)', fontSize:13}}>{t('predictions.saved_mark')}</span>}
                      {locked && !finished && <span style={{color:'var(--muted)', fontSize:12}}>{t('predictions.locked')}</span>}
                    </div>
                    {finished && Number.isInteger(p.home) && Number.isInteger(p.away) && (
                      <div className="prediction-finished-summary">
                        <span dir="ltr" style={{ display: 'inline-flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span>{t('home.my_guess_label')}</span>
                          <ScoreText home={p.home} away={p.away} />
                        </span>
                        <span className={`points-pill ${p.points >= 5 ? 'exact' : p.points >= 3 ? 'high' : 'zero'}`}>
                          {Number(p.points || 0)} {t('common.points')}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      {regOpen && (
        <div className="doc-modal-backdrop" onClick={() => !regBusy && setRegOpen(false)}>
          <div className="doc-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="doc-modal-head">
              <h3>{regStep === 'email' ? 'כמעט סיימת! מה האימייל שלך?' : 'מה מספר הטלפון שלך?'}</h3>
              {!regBusy && <button type="button" className="btn btn-sm btn-outline" onClick={() => setRegOpen(false)}>{t('common.close')}</button>}
            </div>
            {regErr && <div className="alert alert-error">{regErr}</div>}
            {regStep === 'email' ? (
              <>
                <div className="field">
                  <label>אימייל</label>
                  <input type="email" value={regEmail} onChange={e => setRegEmail(e.target.value)} autoComplete="email" placeholder="example@email.com" />
                </div>
                <button className="btn btn-gold" style={{ width:'100%', justifyContent:'center' }} onClick={regContinueEmail} disabled={regBusy}>
                  {regBusy ? <span className="spinner" /> : 'המשך'}
                </button>
              </>
            ) : (
              <>
                {regEmailExists && (
                  <div className="alert" style={{ background:'var(--paper-pure)', border:'1px solid var(--gold)' }}>
                    האימייל כבר רשום — הזן את הטלפון שלך לאימות, ונמשיך לחשבון הקיים.
                  </div>
                )}
                <div className="field">
                  <label>טלפון</label>
                  <input type="tel" value={regPhone} onChange={e => setRegPhone(e.target.value)} autoComplete="tel" placeholder="050-0000000" />
                </div>
                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <button className="btn btn-outline" onClick={() => setRegStep('email')} disabled={regBusy}>חזרה</button>
                  <button className="btn btn-gold" style={{ flex:1, justifyContent:'center' }} onClick={regSubmit} disabled={regBusy}>
                    {regBusy ? <span className="spinner" /> : 'קדימה'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function SpecialPredictions({ teams, players, special, setSpecial, onSave, saving, playerSearch, setPlayerSearch, pickerOpen, setPickerOpen, specialLocked, t, pickText, language, specialLockLabel }) {
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
    <div style={{fontSize:14, color:'var(--muted)', marginBottom:12}}>
      {t('predictions.special_lock_note', { date: specialLockLabel || '8.7.2026 · 12:00' })}
    </div>
    <div style={{display:'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', maxWidth: 900}}>
      <div className="stat-card" style={{borderTop:'4px solid var(--gold)', position:'relative', zIndex:1}}>
        <div className="label">{t('predictions.champion')}</div>
        <p style={{fontSize:13, color:'var(--muted)', margin:'4px 0 12px'}}>{t('predictions.exact_20')}</p>
        {champion && (
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8, fontSize:13}}>
            <Flag code={champion.code} size="sm" title={pickText(champion.name_he, champion.name_en, champion.name_ar)} />
            <span>{pickText(champion.name_he, champion.name_en, champion.name_ar)}</span>
          </div>
        )}
        <select className="field" value={special.champion_code || ''} onChange={e => setSpecial({...special, champion_code: e.target.value})} style={{width:'100%', padding:12}} disabled={specialLocked}>
          <option value="">{t('common.select_team')}</option>
          {teams.map(team => <option key={team.code} value={team.code}>{flagEmojiFromCode(team.code)} {pickText(team.name_he, team.name_en, team.name_ar)}</option>)}
        </select>
      </div>

      <div className="stat-card" style={{borderTop:'4px solid #c9d1d9', position:'relative', zIndex:1}}>
        <div className="label">{t('predictions.runner_up')}</div>
        <p style={{fontSize:13, color:'var(--muted)', margin:'4px 0 12px'}}>{t('predictions.exact_10')}</p>
        {runnerUp && (
          <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8, fontSize:13}}>
            <Flag code={runnerUp.code} size="sm" title={pickText(runnerUp.name_he, runnerUp.name_en, runnerUp.name_ar)} />
            <span>{pickText(runnerUp.name_he, runnerUp.name_en, runnerUp.name_ar)}</span>
          </div>
        )}
        <select className="field" value={special.runner_up_code || ''} onChange={e => setSpecial({...special, runner_up_code: e.target.value})} style={{width:'100%', padding:12}} disabled={specialLocked}>
          <option value="">{t('common.select_team')}</option>
          {teams.map(team => <option key={team.code} value={team.code}>{flagEmojiFromCode(team.code)} {pickText(team.name_he, team.name_en, team.name_ar)}</option>)}
        </select>
      </div>

      <div className="stat-card" style={{borderTop:'4px solid var(--crimson)'}}>
        <div className="label">{t('predictions.top_scorer')}</div>
        <p style={{fontSize:13, color:'var(--muted)', margin:'4px 0 12px'}}>{t('predictions.exact_15')}</p>
        {selectedPlayer ? (
          <div style={{display:'flex', gap:10, alignItems:'center', marginBottom:10}}>
            {selectedPlayer.image_url && <img src={selectedPlayer.image_url} alt={selectedPlayer.name_en} style={{width:44, height:44, borderRadius:'50%', objectFit:'cover', border:'2px solid var(--line)'}} />}
            <div style={{lineHeight:1.2}}>
              <div style={{fontWeight:700}}>{pickText(selectedPlayer.name_he, selectedPlayer.name_en)}</div>
              <div style={{fontSize:12, color:'var(--muted)'}}>{selectedPlayer.name_en} · {(language === 'he' ? (selectedPlayer.country_he || selectedPlayer.country_en) : selectedPlayer.country_en || selectedPlayer.country_he || '')}</div>
            </div>
          </div>
        ) : <div style={{fontSize:13, color:'var(--muted)', marginBottom:10}}>{t('predictions.no_player')}</div>}
        <button className="btn btn-outline" onClick={() => setPickerOpen(true)} type="button" disabled={specialLocked}>
          {t('predictions.choose_player')}
        </button>
      </div>

      <div style={{gridColumn: '1 / -1'}}>
        <button className="btn btn-gold" onClick={onSave} disabled={saving || specialLocked}>
          {saving ? <span className="spinner" /> : t('predictions.save_special')}
        </button>
      </div>
    </div>
    {pickerOpen && !specialLocked && (
      <div className="player-picker-overlay" onClick={() => setPickerOpen(false)}>
        <div className="player-picker-modal" onClick={(e) => e.stopPropagation()}>
          <div className="player-picker-head">
            <h3>{t('predictions.top_scorer_picker')}</h3>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setPickerOpen(false)}>{t('common.close')}</button>
          </div>
          <input
            className="field"
            placeholder={t('predictions.player_search_placeholder')}
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
                  <strong>{pickText(p.name_he, p.name_en)}</strong>
                  <small>
                    {p.name_en} · {(language === 'he' ? (p.country_he || p.country_en) : p.country_en || p.country_he || '')}
                    {p.team_code ? <span style={{display:'inline-flex', alignItems:'center', gap:6, marginInlineStart:8}}><Flag code={p.team_code} size="sm" title={(language === 'he' ? (p.country_he || p.country_en) : p.country_en || p.country_he || p.name_en)} /></span> : null}
                  </small>
                </span>
              </button>
            ))}
            {filteredPlayers.length === 0 && <div style={{padding: 12, color:'var(--muted)'}}>{t('common.no_results')}</div>}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
