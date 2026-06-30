import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api, { errMsg } from '../api/client';
import Flag from '../components/Flag';
import { CoinBadge } from '../components/CoinBadges';
import CoinIcon from '../components/CoinIcon';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/TranslationContext';
import { ilDate, ilTime, ilMs } from '../utils/time';
import { getMatchTeamName } from '../lib/match-utils';

const PROPS = ['home', 'draw', 'away'];

function flagEmojiFromCode(code) {
  if (!code) return '🏳️';
  const c = String(code).toLowerCase();
  if (['gb-eng', 'gb-sct', 'gb-wls', 'gb-nir'].includes(c)) return '🏴';
  const base = c.slice(0, 2);
  if (!/^[a-z]{2}$/.test(base)) return '🏳️';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + base.charCodeAt(0) - 97, A + base.charCodeAt(1) - 97);
}

// משפט טבעי: "מנחש ש{קבוצה} ינצחו" / "...לא ינצחו" / "מנחש שיהיה תיקו" / "...שלא יהיה תיקו"
function guessPhrase(t, propLabel, m, prop, negate) {
  if (prop === 'draw') return t(negate ? 'coin.guess_not_draw' : 'coin.guess_draw');
  return t(negate ? 'coin.guess_not_win' : 'coin.guess_win', { team: propLabel(m, prop) });
}

export default function CoinBets() {
  const { user, coinsEnabled } = useAuth();
  const { t, locale, pickText } = useTranslation();
  const location = useLocation();
  const challenge = location.state?.challenge; // { userId, userName, matchId }
  const [tab, setTab] = useState(challenge ? 'create' : 'board');
  const [prefill, setPrefill] = useState(null); // { matchId, proposition, target }
  const [wallet, setWallet] = useState(null);
  const [mine, setMine] = useState([]);
  const [open, setOpen] = useState([]);
  const [board, setBoard] = useState([]);
  const [matches, setMatches] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    api.get('/coin-bets/wallet').then(r => setWallet(r.data)).catch(() => {});
    api.get('/coin-bets/mine').then(r => setMine(r.data || [])).catch(() => {});
    api.get('/coin-bets/open').then(r => setOpen(r.data || [])).catch(() => {});
    api.get('/coin-bets/leaderboard').then(r => setBoard(r.data || [])).catch(() => {});
    api.get('/matches').then(r => setMatches(r.data || [])).catch(() => {});
  };
  useEffect(load, []);

  const propLabel = (m, prop) => {
    if (prop === 'draw') return t('coin.draw');
    return getMatchTeamName(m, prop, pickText).name;
  };

  const matchById = useMemo(() => Object.fromEntries(matches.map(m => [m.id, m])), [matches]);

  // רשימת נבחרות ייחודית (קוד+שם עברי) להימורי אלופה/סגנית
  const teamOptions = useMemo(() => {
    const map = {};
    matches.forEach(m => ['home', 'away'].forEach(side => {
      const code = m[`${side}_code`];
      if (code && !map[code]) map[code] = getMatchTeamName(m, side, pickText).name || code.toUpperCase();
    }));
    return Object.entries(map).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [matches, pickText]);

  const refresh = () => { setErr(''); load(); };

  const act = async (fn, okMsg) => {
    setErr(''); setMsg('');
    try { await fn(); setMsg(okMsg); refresh(); }
    catch (e) { setErr(errMsg(e)); }
  };

  if (!coinsEnabled) {
    return (
      <main className="page" dir="rtl">
        <h1 className="page-title">{t('coin.title')}</h1>
        <div className="coin-empty">{t('coin.system_disabled')}</div>
      </main>
    );
  }

  return (
    <main className="page" dir="rtl">
      <h1 className="page-title">{t('coin.title')}</h1>
      <p className="page-subtitle">{t('coin.subtitle')}</p>

      <div className="coin-wallet-banner">
        <span className="coin-wallet-label">{t('coin.balance')}</span>
        <span className="coin-wallet-value"><CoinIcon size={15} /> {wallet ? wallet.balance.toLocaleString() : '—'}</span>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="tabs" style={{ marginBottom: 24 }}>
        <button className={`tab ${tab === 'board' ? 'active' : ''}`} onClick={() => setTab('board')}>{t('coin.tab_board')}</button>
        <button className={`tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>{t('coin.tab_create')}</button>
        <button className={`tab ${tab === 'find' ? 'active' : ''}`} onClick={() => setTab('find')}>{t('coin.tab_find')}</button>
        <button className={`tab ${tab === 'special' ? 'active' : ''}`} onClick={() => setTab('special')}>{t('coin.tab_special')}</button>
        <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>{t('coin.tab_mine')}</button>
        <button className={`tab ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}>{t('coin.tab_leaderboard')}</button>
      </div>

      {tab === 'board' && (
        <OpenBoard open={open} propLabel={propLabel} locale={locale}
          onAccept={(b) => act(() => api.post(`/coin-bets/${b.id}/accept`), t('coin.accepted'))} t={t} />
      )}

      {tab === 'create' && (
        <CreateBet matches={matches} propLabel={propLabel} wallet={wallet}
          initialTarget={prefill?.target || (challenge ? { id: challenge.userId, name: challenge.userName } : null)}
          initialMatchId={prefill?.matchId ?? challenge?.matchId}
          initialProposition={prefill?.proposition}
          onCreated={() => { setPrefill(null); setTab('mine'); act(async () => {}, t('coin.created')); }} t={t} locale={locale} />
      )}

      {tab === 'find' && (
        <FindOpponent propLabel={propLabel} locale={locale} t={t}
          onChallenge={(o) => { setPrefill({ matchId: o.match_id, proposition: o.my_prop, target: { id: o.user_id, name: o.user_name } }); setTab('create'); }} />
      )}

      {tab === 'special' && (
        <SpecialBets teamOptions={teamOptions} t={t} userId={user.id} onAfterChange={refresh} />
      )}

      {tab === 'mine' && (
        <MyBets mine={mine} matchById={matchById} propLabel={propLabel} userId={user.id} locale={locale}
          onCancel={(b) => act(() => api.post(`/coin-bets/${b.id}/cancel`), t('coin.cancelled'))} t={t} />
      )}

      {tab === 'leaderboard' && <CoinLeaderboard board={board} userId={user.id} t={t} />}
    </main>
  );
}

function MatchLine({ m, locale }) {
  if (!m) return null;
  return (
    <div className="coin-match-line">
      <Flag code={m.home_code || ''} size="sm" /> <span>{m.home_code?.toUpperCase()}</span>
      <span className="coin-vs">–</span>
      <span>{m.away_code?.toUpperCase()}</span> <Flag code={m.away_code || ''} size="sm" />
      <span className="coin-match-when">{ilDate(m.kickoff, locale, { day: '2-digit', month: '2-digit' })} {ilTime(m.kickoff, locale, { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  );
}

function OpenBoard({ open, propLabel, onAccept, locale, t }) {
  if (!open.length) return <div className="coin-empty">{t('coin.board_empty')}</div>;
  return (
    <div className="coin-list">
      {open.map(b => {
        const m = b; // /open rows carry match fields inline
        return (
          <div key={b.id} className="coin-card">
            <MatchLine m={m} locale={locale} />
            <div className="coin-card-body">
              <div>
                <span className="coin-creator">{b.creator_name}</span>
                <span className="coin-prop"> {guessPhrase(t, propLabel, m, b.proposition, false)}</span>
                {b.target_user_id && <span className="coin-challenge-tag"> {t('coin.direct_challenge')}</span>}
              </div>
              <div className="coin-stake"><CoinIcon size={15} /> {b.stake.toLocaleString()}</div>
            </div>
            {b.max_acceptors > 1 && (
              <div className="coin-slots">{t('coin.slots', { taken: b.accepted_count, total: b.max_acceptors })}</div>
            )}
            <div className="coin-card-foot">
              <span className="coin-you-take">{t('coin.you')} <strong>{guessPhrase(t, propLabel, m, b.proposition, true)}</strong></span>
              <button className="btn btn-sm btn-gold" onClick={() => onAccept(b)}>{t('coin.accept')} (<CoinIcon size={15} /> {b.stake.toLocaleString()})</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MyBets({ mine, matchById, propLabel, userId, onCancel, locale, t }) {
  if (!mine.length) return <div className="coin-empty">{t('coin.mine_empty')}</div>;
  const statusLabel = {
    open: t('coin.status_open'), matched: t('coin.status_matched'),
    settled: t('coin.status_settled'), cancelled: t('coin.status_cancelled'), void: t('coin.status_void')
  };
  return (
    <div className="coin-list">
      {mine.map(b => {
        const iAmCreator = b.creator_id === userId;
        const accepted = Number(b.accepted_count) || 0;
        const won = b.status === 'settled' && (iAmCreator ? Number(b.winner_id) === userId : Number(b.my_won) === 1);
        const lost = b.status === 'settled' && (iAmCreator ? Number(b.winner_id) !== userId : Number(b.my_won) === 0);
        const netAmount = iAmCreator ? b.stake * Math.max(accepted, 1) : b.stake;
        return (
          <div key={b.id} className={`coin-card ${won ? 'coin-won' : ''} ${lost ? 'coin-lost' : ''}`}>
            <MatchLine m={b} locale={locale} />
            <div className="coin-card-body">
              <div>
                <span>{t('coin.you')} <strong>{guessPhrase(t, propLabel, b, b.proposition, !iAmCreator)}</strong></span>
                <div className="coin-vs-who">
                  {iAmCreator
                    ? (Number(b.max_acceptors) > 1
                        ? t('coin.slots', { taken: accepted, total: b.max_acceptors })
                        : (b.opponent_name ? <>{t('coin.vs')} {b.opponent_name}</>
                            : (b.target_name ? t('coin.waiting_for', { name: b.target_name }) : t('coin.waiting_open'))))
                    : <>{t('coin.vs')} {b.creator_name}</>}
                </div>
              </div>
              <div className="coin-stake"><CoinIcon size={15} /> {b.stake.toLocaleString()}</div>
            </div>
            <div className="coin-card-foot">
              <span className={`coin-status coin-status-${b.status}`}>{statusLabel[b.status]}</span>
              {won && <span className="coin-result-win">+{netAmount.toLocaleString()} <CoinIcon size={15} /></span>}
              {lost && <span className="coin-result-lose">−{netAmount.toLocaleString()} <CoinIcon size={15} /></span>}
              {b.status === 'open' && iAmCreator && accepted === 0 && (
                <button className="btn btn-sm btn-outline" onClick={() => onCancel(b)}>{t('coin.cancel')}</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreateBet({ matches, propLabel, wallet, onCreated, locale, t, initialTarget, initialMatchId, initialProposition }) {
  const [matchId, setMatchId] = useState(initialMatchId ? String(initialMatchId) : '');
  const [proposition, setProposition] = useState(initialProposition || 'home');
  const [stake, setStake] = useState(100);
  const [maxAcceptors, setMaxAcceptors] = useState(1);
  const [target, setTarget] = useState(initialTarget || null);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const openMatches = matches.filter(m => m.status !== 'finished');
  const selected = matches.find(m => m.id === Number(matchId));

  useEffect(() => {
    if (userQuery.trim().length < 2) { setUserResults([]); return; }
    const id = setTimeout(() => {
      api.get(`/coin-bets/users?q=${encodeURIComponent(userQuery.trim())}`).then(r => setUserResults(r.data || [])).catch(() => {});
    }, 250);
    return () => clearTimeout(id);
  }, [userQuery]);

  const submit = async () => {
    setErr('');
    if (!matchId) { setErr(t('coin.pick_match')); return; }
    const s = Number(stake);
    if (!Number.isInteger(s) || s <= 0) { setErr(t('coin.bad_stake')); return; }
    if (wallet && s > wallet.balance) { setErr(t('coin.not_enough')); return; }
    setBusy(true);
    try {
      await api.post('/coin-bets', {
        match_id: Number(matchId), proposition, stake: s,
        max_acceptors: target ? 1 : Math.min(Math.max(Number(maxAcceptors) || 1, 1), 20),
        target_user_id: target ? target.id : null
      });
      onCreated();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="coin-create card">
      {err && <div className="alert alert-error">{err}</div>}
      <div className="field">
        <label>{t('coin.choose_match')}</label>
        <select value={matchId} onChange={e => setMatchId(e.target.value)}>
          <option value="">{t('coin.pick_match')}</option>
          {openMatches.map(m => (
            <option key={m.id} value={m.id}>
              {flagEmojiFromCode(m.home_code)} {propLabel(m, 'home')} – {flagEmojiFromCode(m.away_code)} {propLabel(m, 'away')} · {ilDate(m.kickoff, locale, { day: '2-digit', month: '2-digit' })} {ilTime(m.kickoff, locale, { hour: '2-digit', minute: '2-digit' })}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <div className="field">
          <label>{t('coin.your_pick')}</label>
          <div className="coin-prop-picker">
            {PROPS.map(p => (
              <button key={p} type="button"
                className={`coin-prop-btn ${proposition === p ? 'active' : ''}`}
                onClick={() => setProposition(p)}>
                {p === 'home' ? '1' : p === 'draw' ? 'X' : '2'}
                <span>{propLabel(selected, p)}</span>
              </button>
            ))}
          </div>
          <div className="coin-pick-preview">{t('coin.you')} <strong>{guessPhrase(t, propLabel, selected, proposition, false)}</strong></div>
        </div>
      )}

      <div className="field">
        <label>{t('coin.stake')} {wallet && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({t('coin.balance')}: <CoinIcon size={15} /> {wallet.balance.toLocaleString()})</span>}</label>
        <input type="number" min="1" value={stake} onChange={e => setStake(e.target.value)} />
      </div>

      {!target && (
        <div className="field">
          <label>{t('coin.max_acceptors')}</label>
          <input type="number" min="1" max="20" value={maxAcceptors} onChange={e => setMaxAcceptors(e.target.value)} />
          <div className="coin-hint">
            {t('coin.exposure_hint', { total: (Number(stake) * Math.min(Math.max(Number(maxAcceptors) || 1, 1), 20)).toLocaleString(), n: Math.min(Math.max(Number(maxAcceptors) || 1, 1), 20) })}
          </div>
        </div>
      )}

      <div className="field">
        <label>{t('coin.challenge_optional')}</label>
        {target ? (
          <div className="coin-target-chip">
            {target.name}
            <button type="button" className="btn btn-sm btn-outline" onClick={() => { setTarget(null); setUserQuery(''); }}>✕</button>
          </div>
        ) : (
          <>
            <input value={userQuery} onChange={e => setUserQuery(e.target.value)} placeholder={t('coin.search_user')} />
            {userResults.length > 0 && (
              <div className="coin-user-results">
                {userResults.map(u => (
                  <button key={u.id} type="button" className="coin-user-result" onClick={() => { setTarget(u); setUserResults([]); }}>{u.name}</button>
                ))}
              </div>
            )}
            <div className="coin-hint">{t('coin.open_offer_hint')}</div>
          </>
        )}
      </div>

      <button className="btn btn-gold" onClick={submit} disabled={busy}>
        {busy ? <span className="spinner" /> : t('coin.create_offer')}
      </button>
    </div>
  );
}

function FindOpponent({ propLabel, locale, t, onChallenge }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/coin-bets/opponents').then(r => setRows(r.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  const outLabel = (o, prop) => prop === 'draw' ? t('coin.draw')
    : (prop === 'home' ? (o.home_code || '').toUpperCase() : (o.away_code || '').toUpperCase());

  if (loading) return <div className="coin-empty">{t('common.loading')}</div>;
  if (!rows.length) return <div className="coin-empty">{t('coin.find_empty')}</div>;

  const byMatch = {};
  rows.forEach(r => { (byMatch[r.match_id] = byMatch[r.match_id] || { m: r, list: [] }).list.push(r); });
  return (
    <div className="coin-list">
      <p className="coin-hint" style={{ marginBottom: 8 }}>{t('coin.find_help')}</p>
      {Object.values(byMatch).map(({ m, list }) => (
        <div key={m.match_id} className="coin-card">
          <MatchLine m={m} locale={locale} />
          <div className="coin-find-mypick">{t('coin.your_pick')}: <strong>{outLabel(m, m.my_prop)}</strong></div>
          {list.map(o => (
            <div key={o.user_id} className="coin-find-row">
              <span className="coin-find-user">
                {o.profile_image_url ? <img className="aipred-logo" style={{ width: 22, height: 22, borderRadius: '50%' }} src={o.profile_image_url} alt="" /> : '👤'}
                {' '}{o.user_name} · {t('coin.their_pick')}: <strong>{outLabel(o, o.their_prop)}</strong>
              </span>
              <button className="btn btn-sm btn-gold" onClick={() => onChallenge(o)}>⚔️ {t('coin.challenge')}</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SpecialBets({ teamOptions, t, userId, onAfterChange }) {
  const [market, setMarket] = useState('champion');
  const [subjectCode, setSubjectCode] = useState('');
  const [topScorer, setTopScorer] = useState('');
  const [proposition, setProposition] = useState('yes');
  const [stake, setStake] = useState(100);
  const [open, setOpen] = useState([]);
  const [mine, setMine] = useState([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => {
    api.get('/coin-bets/special/open').then(r => setOpen(r.data || [])).catch(() => {});
    api.get('/coin-bets/special/mine').then(r => setMine(r.data || [])).catch(() => {});
  };
  useEffect(reload, []);

  const marketLabel = { champion: t('coin.sp_champion'), runner_up: t('coin.sp_runner_up'), top_scorer: t('coin.sp_top_scorer') };
  const isTop = market === 'top_scorer';
  const yesNo = (p) => p === 'yes' ? t('common.yes') : t('common.no');
  const line = (b) => `${marketLabel[b.market]}: ${b.subject_label} — ${yesNo(b.proposition)}`;

  const run = async (fn) => { setMsg(''); setBusy(true); try { await fn(); reload(); onAfterChange && onAfterChange(); } catch (e) { setMsg(e?.response?.data?.error || 'שגיאה'); } finally { setBusy(false); } };

  const create = () => run(async () => {
    const subject_code = isTop ? topScorer.trim() : subjectCode;
    if (!subject_code) { throw { response: { data: { error: t('coin.sp_pick_subject') } } }; }
    const subject_label = isTop ? topScorer.trim() : (teamOptions.find(o => o.code === subjectCode)?.name || subjectCode);
    await api.post('/coin-bets/special', { market, subject_code, subject_label, proposition, stake: Number(stake) });
    setSubjectCode(''); setTopScorer(''); setMsg(t('coin.created'));
  });

  return (
    <div className="coin-create">
      {msg && <div className="alert alert-success" style={{ marginBottom: 12 }}>{msg}</div>}
      <p className="coin-hint">{t('coin.sp_help')}</p>

      <label className="coin-field">{t('coin.sp_market')}
        <select value={market} onChange={e => { setMarket(e.target.value); setSubjectCode(''); }}>
          <option value="champion">{t('coin.sp_champion')}</option>
          <option value="runner_up">{t('coin.sp_runner_up')}</option>
          <option value="top_scorer">{t('coin.sp_top_scorer')}</option>
        </select>
      </label>

      <label className="coin-field">{t('coin.sp_subject')}
        {isTop ? (
          <input value={topScorer} onChange={e => setTopScorer(e.target.value)} placeholder={t('coin.sp_top_scorer_ph')} />
        ) : (
          <select value={subjectCode} onChange={e => setSubjectCode(e.target.value)}>
            <option value="">— {t('coin.sp_pick_subject')} —</option>
            {teamOptions.map(o => <option key={o.code} value={o.code}>{flagEmojiFromCode(o.code)} {o.name}</option>)}
          </select>
        )}
      </label>

      <label className="coin-field">{t('coin.sp_your_call')}
        <select value={proposition} onChange={e => setProposition(e.target.value)}>
          <option value="yes">{t('common.yes')}</option>
          <option value="no">{t('common.no')}</option>
        </select>
      </label>

      <label className="coin-field">{t('coin.stake')}
        <input type="number" min="1" value={stake} onChange={e => setStake(e.target.value)} />
      </label>

      <button className="btn btn-gold" disabled={busy} onClick={create}>{t('coin.create_offer')}</button>

      <h3 className="coin-subhead">{t('coin.sp_open_title')}</h3>
      {open.length === 0 ? <div className="coin-empty">{t('coin.sp_open_empty')}</div> : (
        <div className="coin-list">
          {open.map(b => (
            <div key={b.id} className="coin-card coin-find-row">
              <span>{line(b)} · <CoinIcon size={13} /> {b.stake} · {b.creator_name}</span>
              <button className="btn btn-sm btn-gold" disabled={busy} onClick={() => run(() => api.post(`/coin-bets/special/${b.id}/accept`))}>{t('coin.accept')}</button>
            </div>
          ))}
        </div>
      )}

      <h3 className="coin-subhead">{t('coin.sp_mine_title')}</h3>
      {mine.length === 0 ? <div className="coin-empty">{t('coin.sp_mine_empty')}</div> : (
        <div className="coin-list">
          {mine.map(b => {
            const iWon = b.status === 'settled' && ((b.creator_id === userId) === (b.creator_won === 1));
            return (
              <div key={b.id} className="coin-card coin-find-row">
                <span>{line(b)} · <CoinIcon size={13} /> {b.stake} · <em>{t(`coin.sp_status_${b.status}`)}</em>
                  {b.status === 'settled' && <strong style={{ marginInlineStart: 6, color: iWon ? 'var(--pitch,#2e7d32)' : '#b00' }}>{iWon ? t('coin.you_won') : t('coin.you_lost')}</strong>}
                </span>
                {b.status === 'open' && b.creator_id === userId &&
                  <button className="btn btn-sm" disabled={busy} onClick={() => run(() => api.post(`/coin-bets/special/${b.id}/cancel`))}>{t('coin.cancel')}</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CoinLeaderboard({ board, userId, t }) {
  if (!board.length) return <div className="coin-empty">{t('coin.board_empty')}</div>;
  return (
    <table className="leaderboard-table coin-leaderboard">
      <thead>
        <tr>
          <th>#</th><th>{t('coin.player')}</th><th>{t('coin.balance')}</th><th>{t('coin.wins')}</th><th></th>
        </tr>
      </thead>
      <tbody>
        {board.map(r => (
          <tr key={r.id} className={r.id === userId ? 'me-row' : ''}>
            <td className={`rank-medal top-${r.rank}`}>{r.rank}</td>
            <td>{r.name}</td>
            <td><CoinIcon size={15} /> {r.balance.toLocaleString()}</td>
            <td>{r.bets_won}/{r.bets_settled} {r.bets_settled > 0 && <span style={{ color: 'var(--muted)' }}>({r.win_rate}%)</span>}</td>
            <td><CoinBadge badges={r.coin_badges} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
