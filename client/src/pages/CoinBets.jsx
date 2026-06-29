import { useEffect, useMemo, useState } from 'react';
import api, { errMsg } from '../api/client';
import Flag from '../components/Flag';
import { CoinBadge } from '../components/CoinBadges';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/TranslationContext';
import { ilDate, ilTime, ilMs } from '../utils/time';
import { getMatchTeamName } from '../lib/match-utils';

const PROPS = ['home', 'draw', 'away'];

export default function CoinBets() {
  const { user } = useAuth();
  const { t, locale, pickText } = useTranslation();
  const [tab, setTab] = useState('board');
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

  const refresh = () => { setErr(''); load(); };

  const act = async (fn, okMsg) => {
    setErr(''); setMsg('');
    try { await fn(); setMsg(okMsg); refresh(); }
    catch (e) { setErr(errMsg(e)); }
  };

  return (
    <main className="page" dir="rtl">
      <h1 className="page-title">{t('coin.title')}</h1>
      <p className="page-subtitle">{t('coin.subtitle')}</p>

      <div className="coin-wallet-banner">
        <span className="coin-wallet-label">{t('coin.balance')}</span>
        <span className="coin-wallet-value">🪙 {wallet ? wallet.balance.toLocaleString() : '—'}</span>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="tabs" style={{ marginBottom: 24 }}>
        <button className={`tab ${tab === 'board' ? 'active' : ''}`} onClick={() => setTab('board')}>{t('coin.tab_board')}</button>
        <button className={`tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>{t('coin.tab_create')}</button>
        <button className={`tab ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>{t('coin.tab_mine')}</button>
        <button className={`tab ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}>{t('coin.tab_leaderboard')}</button>
      </div>

      {tab === 'board' && (
        <OpenBoard open={open} propLabel={propLabel} locale={locale}
          onAccept={(b) => act(() => api.post(`/coin-bets/${b.id}/accept`), t('coin.accepted'))} t={t} />
      )}

      {tab === 'create' && (
        <CreateBet matches={matches} propLabel={propLabel} wallet={wallet}
          onCreated={() => { setTab('mine'); act(async () => {}, t('coin.created')); }} t={t} locale={locale} />
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
                <span className="coin-prop"> {t('coin.backs')} <strong>{propLabel(m, b.proposition)}</strong></span>
                {b.target_user_id && <span className="coin-challenge-tag"> {t('coin.direct_challenge')}</span>}
              </div>
              <div className="coin-stake">🪙 {b.stake.toLocaleString()}</div>
            </div>
            <div className="coin-card-foot">
              <span className="coin-you-take">{t('coin.you_take')}: <strong>{t('coin.not_x', { x: propLabel(m, b.proposition) })}</strong></span>
              <button className="btn btn-sm btn-gold" onClick={() => onAccept(b)}>{t('coin.accept')} (🪙 {b.stake.toLocaleString()})</button>
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
        const myProp = iAmCreator ? b.proposition : null; // creator backs proposition; opponent backs negation
        const won = b.status === 'settled' && b.winner_id === userId;
        const lost = b.status === 'settled' && b.winner_id && b.winner_id !== userId;
        return (
          <div key={b.id} className={`coin-card ${won ? 'coin-won' : ''} ${lost ? 'coin-lost' : ''}`}>
            <MatchLine m={b} locale={locale} />
            <div className="coin-card-body">
              <div>
                {iAmCreator
                  ? <span>{t('coin.you_back')} <strong>{propLabel(b, b.proposition)}</strong></span>
                  : <span>{t('coin.you_take')} <strong>{t('coin.not_x', { x: propLabel(b, b.proposition) })}</strong></span>}
                <div className="coin-vs-who">
                  {b.opponent_id
                    ? <>{t('coin.vs')} {iAmCreator ? b.opponent_name : b.creator_name}</>
                    : (b.target_name ? t('coin.waiting_for', { name: b.target_name }) : t('coin.waiting_open'))}
                </div>
              </div>
              <div className="coin-stake">🪙 {b.stake.toLocaleString()}</div>
            </div>
            <div className="coin-card-foot">
              <span className={`coin-status coin-status-${b.status}`}>{statusLabel[b.status]}</span>
              {won && <span className="coin-result-win">+{(b.stake * 2).toLocaleString()} 🪙</span>}
              {lost && <span className="coin-result-lose">−{b.stake.toLocaleString()} 🪙</span>}
              {b.status === 'open' && iAmCreator && (
                <button className="btn btn-sm btn-outline" onClick={() => onCancel(b)}>{t('coin.cancel')}</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreateBet({ matches, propLabel, wallet, onCreated, locale, t }) {
  const [matchId, setMatchId] = useState('');
  const [proposition, setProposition] = useState('home');
  const [stake, setStake] = useState(100);
  const [target, setTarget] = useState(null);
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
              {m.home_code?.toUpperCase()}–{m.away_code?.toUpperCase()} · {ilDate(m.kickoff, locale, { day: '2-digit', month: '2-digit' })} {ilTime(m.kickoff, locale, { hour: '2-digit', minute: '2-digit' })}
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
        </div>
      )}

      <div className="field">
        <label>{t('coin.stake')} {wallet && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({t('coin.balance')}: 🪙 {wallet.balance.toLocaleString()})</span>}</label>
        <input type="number" min="1" value={stake} onChange={e => setStake(e.target.value)} />
      </div>

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
            <td>🪙 {r.balance.toLocaleString()}</td>
            <td>{r.bets_won}/{r.bets_settled} {r.bets_settled > 0 && <span style={{ color: 'var(--muted)' }}>({r.win_rate}%)</span>}</td>
            <td><CoinBadge rank={r.rank} winRate={r.win_rate} betsWon={r.bets_won} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
