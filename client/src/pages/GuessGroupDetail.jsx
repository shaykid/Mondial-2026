import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/TranslationContext';
import Flag from '../components/Flag';
import ScoreText from '../components/ScoreText';
import { ilMs } from '../utils/time';

const PICKS = [
  { value: 'home', key: 'gg.pick', label: '1' },
  { value: 'draw', key: 'gg.pick', label: 'X' },
  { value: 'away', key: 'gg.pick', label: '2' }
];

function isLocked(kickoff) {
  if (!kickoff) return false;
  const raw = String(kickoff);
  const ms = ilMs(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return Date.now() >= (ms - 60 * 60 * 1000);
}

export default function GuessGroupDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { t, pickText } = useTranslation();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [matches, setMatches] = useState([]);

  // add-member state
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);

  // add-bet state
  const [betMatch, setBetMatch] = useState('');
  const [betPick, setBetPick] = useState('home');

  const load = () => {
    api.get(`/guess-groups/${id}`)
      .then(r => { setData(r.data); setErr(''); })
      .catch(e => setErr(errMsg(e)));
  };

  useEffect(() => { load(); }, [id]);
  useEffect(() => { api.get('/matches').then(r => setMatches(r.data)).catch(() => setMatches([])); }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const h = setTimeout(() => {
      api.get(`/guess-groups/users?q=${encodeURIComponent(q.trim())}`).then(r => setResults(r.data)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  if (err) return <main className="page"><div className="alert alert-error">{err}</div><BackBtn nav={nav} t={t} /></main>;
  if (!data) return <main className="page"><div className="stat-card" style={{ textAlign: 'center', padding: 28 }}><span className="spinner" /></div></main>;

  const { group, members, bets, multiplier, total_points, rank, can_manage, max_members, entry_cost, my_paid } = data;
  const betMatchIds = new Set(bets.map(b => b.match_id));
  const availableMatches = matches.filter(m => !betMatchIds.has(m.id) && !isLocked(m.kickoff));

  const addMember = async (uid) => {
    setErr('');
    try { await api.post(`/guess-groups/${id}/members`, { user_id: uid }); setQ(''); setResults([]); load(); }
    catch (e) { setErr(errMsg(e)); }
  };
  const removeMember = async (uid) => {
    setErr('');
    try {
      const r = await api.delete(`/guess-groups/${id}/members/${uid}`);
      if (r.data?.deleted || uid === user.id) return nav('/guess-groups');
      load();
    } catch (e) { setErr(errMsg(e)); }
  };
  const addBet = async () => {
    setErr('');
    if (!betMatch) return;
    try { await api.post(`/guess-groups/${id}/bets`, { match_id: Number(betMatch), pick: betPick }); setBetMatch(''); load(); }
    catch (e) { setErr(errMsg(e)); }
  };
  const changeBet = async (matchId, pick) => {
    setErr('');
    try { await api.post(`/guess-groups/${id}/bets`, { match_id: matchId, pick }); load(); }
    catch (e) { setErr(errMsg(e)); }
  };
  const removeBet = async (matchId) => {
    setErr('');
    try { await api.delete(`/guess-groups/${id}/bets/${matchId}`); load(); }
    catch (e) { setErr(errMsg(e)); }
  };
  const deleteGroup = async () => {
    if (!window.confirm(t('gg.delete_confirm'))) return;
    try { await api.delete(`/guess-groups/${id}`); nav('/guess-groups'); }
    catch (e) { setErr(errMsg(e)); }
  };

  return (
    <main className="page">
      <BackBtn nav={nav} t={t} />
      <div className="gg-detail-head">
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>{group.name}</h1>
          {group.description && <p className="page-subtitle" style={{ margin: 0 }}>{group.description}</p>}
        </div>
        <div className="gg-detail-stats">
          <div><span className="gg-stat-val">{total_points}</span><span className="gg-stat-lbl">{t('gg.points')}</span></div>
          <div><span className="gg-stat-val">{rank ? `#${rank}` : '—'}</span><span className="gg-stat-lbl">{t('gg.rank')}</span></div>
          <div><span className="gg-stat-val">×{multiplier}</span><span className="gg-stat-lbl">{t('gg.multiplier')}</span></div>
          <div><span className="gg-stat-val">{entry_cost > 0 ? entry_cost : '—'}</span><span className="gg-stat-lbl">{t('gg.entry_cost')}</span></div>
        </div>
      </div>

      {(entry_cost > 0 || my_paid > 0) && (
        <div className="gg-cost-banner">
          {my_paid > 0 && <span>💰 {t('gg.you_paid')}: <strong>{my_paid}</strong></span>}
          <span className="gg-net">{t('gg.net_from_group')}: <strong>{total_points - my_paid}</strong></span>
        </div>
      )}

      {err && <div className="alert alert-error">{err}</div>}

      {/* Members */}
      <div className="stat-card" style={{ borderTop: '4px solid var(--pitch)' }}>
        <div className="label">{t('gg.members')} ({members.length}/{max_members})</div>
        <div className="gg-member-list">
          {members.map(m => (
            <div key={m.id} className="gg-member">
              {m.profile_image_url
                ? <img className="gg-mini-avatar" src={m.profile_image_url} alt={m.name} />
                : <span className="gg-mini-avatar gg-mini-fallback">{(m.name || '?').slice(0, 1)}</span>}
              <span className="gg-member-name">{m.name}</span>
              {m.role === 'leader' && <span className="gg-badge gg-badge-gold">👑 {t('gg.leader')}</span>}
              {(can_manage && m.role !== 'leader') && (
                <button className="gg-remove-x" onClick={() => removeMember(m.id)} title={t('gg.remove')}>×</button>
              )}
              {(!can_manage && m.id === user.id) && (
                <button className="gg-remove-x" onClick={() => { if (window.confirm(t('gg.leave_confirm'))) removeMember(m.id); }} title={t('gg.leave')}>×</button>
              )}
            </div>
          ))}
        </div>

        {can_manage && members.length < max_members && (
          <div className="gg-add-member">
            <div style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0' }}>{t('gg.add_member_help')}</div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('gg.search_user')} />
            {results.length > 0 && (
              <div className="gg-search-results">
                {results.filter(u => !members.some(m => m.id === u.id)).map(u => (
                  <button key={u.id} className="gg-search-row" onClick={() => addMember(u.id)}>
                    <span>{u.name}</span>
                    <span className="gg-add-plus">＋ {t('gg.add_member')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bets */}
      <div className="stat-card" style={{ borderTop: '4px solid var(--gold)' }}>
        <div className="label">{t('gg.bets')}</div>
        {can_manage && <p style={{ color: 'var(--muted)', marginTop: 6, fontSize: 13 }}>{t('gg.bets_help')}</p>}

        {can_manage && (
          <div className="gg-add-bet">
            <select value={betMatch} onChange={e => setBetMatch(e.target.value)}>
              <option value="">{t('gg.choose_match')}</option>
              {availableMatches.map(m => (
                <option key={m.id} value={m.id}>
                  {pickText(m.home_name, m.home_name_en, m.home_name_ar)} – {pickText(m.away_name, m.away_name_en, m.away_name_ar)}
                </option>
              ))}
            </select>
            <div className="gg-pick-group">
              {PICKS.map(p => (
                <button key={p.value} type="button"
                  className={`gg-pick-btn ${betPick === p.value ? 'active' : ''}`}
                  onClick={() => setBetPick(p.value)}>{p.label}</button>
              ))}
            </div>
            <button className="btn btn-gold" type="button" onClick={addBet} disabled={!betMatch}>{t('gg.add_bet')}</button>
          </div>
        )}

        {bets.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 18 }}>{t('gg.no_bets')}</div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="standings-table gg-bets-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'start' }}>{t('gg.match')}</th>
                  <th style={{ textAlign: 'center' }}>{t('gg.pick')}</th>
                  <th style={{ textAlign: 'center' }}>{t('gg.result')}</th>
                  <th style={{ textAlign: 'center' }}>{t('gg.points')}</th>
                  {can_manage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {bets.map(b => {
                  const locked = isLocked(b.kickoff);
                  const finished = b.status === 'finished' && b.actual_home != null;
                  return (
                    <tr key={b.id}>
                      <td>
                        <div className="gg-bet-match">
                          <Flag code={b.home_code} size="sm" />
                          <span>{pickText(b.home_name, b.home_name_en, b.home_name_ar)}</span>
                          <span className="gg-vs">–</span>
                          <span>{pickText(b.away_name, b.away_name_en, b.away_name_ar)}</span>
                          <Flag code={b.away_code} size="sm" />
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {(can_manage && !locked) ? (
                          <div className="gg-pick-group gg-pick-inline">
                            {PICKS.map(p => (
                              <button key={p.value} type="button"
                                className={`gg-pick-btn ${b.pick === p.value ? 'active' : ''}`}
                                onClick={() => changeBet(b.match_id, p.value)}>{p.label}</button>
                            ))}
                          </div>
                        ) : (
                          <span className="points-pill">{b.pick === 'home' ? '1' : b.pick === 'away' ? '2' : 'X'}</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {finished ? <strong><ScoreText home={b.actual_home} away={b.actual_away} /></strong> : <span style={{ color: 'var(--muted)' }}>{locked ? t('gg.pending') : '—'}</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {finished
                          ? <span className={`points-pill ${b.points > 0 ? 'high' : ''}`}>{b.points > 0 ? `+${b.points}` : '0'}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      {can_manage && (
                        <td style={{ textAlign: 'center' }}>
                          {!locked && <button className="gg-remove-x" onClick={() => removeBet(b.match_id)} title={t('gg.remove')}>×</button>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {can_manage && (
        <button className="btn btn-danger" type="button" onClick={deleteGroup} style={{ marginTop: 8 }}>
          {t('gg.delete_group')}
        </button>
      )}
    </main>
  );
}

function BackBtn({ nav, t }) {
  return <button className="gg-back-link" onClick={() => nav('/guess-groups')}>{t('gg.back')}</button>;
}
