import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import CoinIcon from './CoinIcon';
import { useTranslation } from '../i18n/TranslationContext';
import { ilDate } from '../utils/time';
import { getMatchTeamName } from '../lib/match-utils';

// פאנל אישי: יתרת שיחים + סטטיסטיקות + כל ההימורים של המשתמש (לפי סוג וסטטוס)
export default function MyCoinsPanel() {
  const { t, locale, pickText } = useTranslation();
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [stats, setStats] = useState(null);
  const [bets, setBets] = useState([]);

  useEffect(() => {
    api.get('/coin-bets/wallet').then(r => setWallet(r.data)).catch(() => {});
    api.get('/coin-bets/stats').then(r => setStats(r.data)).catch(() => {});
    api.get('/coin-bets/mine').then(r => setBets(r.data || [])).catch(() => {});
  }, []);

  // תווית סוג ההימור (כרגע רק "תוצאת משחק"; מוכן להרחבה לסוגים נוספים)
  const marketLabel = (m) => t(`coin.market_${m || 'result'}`);
  const propLabel = (b) => {
    if (b.proposition === 'draw') return t('coin.draw');
    return getMatchTeamName(b, b.proposition === 'home' ? 'home' : 'away', pickText).name;
  };
  const statusLabel = {
    open: t('coin.status_open'), matched: t('coin.status_matched'),
    settled: t('coin.status_settled'), cancelled: t('coin.status_cancelled'), void: t('coin.status_void')
  };

  return (
    <div className="card my-coins" style={{ marginTop: 24 }}>
      <div className="my-coins-head">
        <div className="label" style={{ margin: 0 }}>{t('coin.my_coins_title')}</div>
        <Link to="/coin-bets" className="btn btn-sm btn-gold">{t('coin.go_bet')}</Link>
      </div>

      <div className="my-coins-stats">
        <div className="stat-card">
          <div className="label">{t('coin.balance')}</div>
          <div className="value" style={{ color: 'var(--gold)' }}><CoinIcon size={15} /> {wallet ? wallet.balance.toLocaleString() : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('coin.rank')}</div>
          <div className="value">{stats?.rank ? `#${stats.rank}` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('coin.wins')}</div>
          <div className="value">{stats ? `${stats.bets_won}/${stats.bets_settled}` : '—'}</div>
        </div>
        <div className="stat-card">
          <div className="label">{t('coin.win_rate')}</div>
          <div className="value">{stats ? `${stats.win_rate}%` : '—'}</div>
        </div>
      </div>

      <div className="my-coins-bets-title">{t('coin.all_bets')}</div>
      {bets.length === 0 ? (
        <div className="coin-empty">{t('coin.mine_empty')}</div>
      ) : (
        <div className="coin-list">
          {bets.map(b => {
            const won = b.status === 'settled' && b.winner_id === user?.id;
            return (
              <div key={b.id} className="coin-card" dir="rtl">
                <div className="my-coins-bet-row">
                  <span className="coin-type-chip">{marketLabel(b.market)}</span>
                  <span className="my-coins-teams">
                    {getMatchTeamName(b, 'home', pickText).name}–{getMatchTeamName(b, 'away', pickText).name}
                  </span>
                  <span className="coin-match-when">{ilDate(b.kickoff, locale, { day: '2-digit', month: '2-digit' })}</span>
                </div>
                <div className="coin-card-body">
                  <span>{t('coin.you_back')} <strong>{propLabel(b)}</strong></span>
                  <span className="coin-stake"><CoinIcon size={15} /> {b.stake.toLocaleString()}</span>
                </div>
                <div className="coin-card-foot">
                  <span className={`coin-status coin-status-${b.status}`}>{statusLabel[b.status]}</span>
                  {b.status === 'settled' && b.winner_id && (
                    won
                      ? <span className="coin-result-win">+{(b.stake * 2).toLocaleString()} <CoinIcon size={15} /></span>
                      : <span className="coin-result-lose">−{b.stake.toLocaleString()} <CoinIcon size={15} /></span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
