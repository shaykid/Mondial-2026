import { useTranslation } from '../i18n/TranslationContext';

// תגי הישג להימורי מטבעות — לשימוש בלוח המצטיינים
export function CoinBadge({ rank, winRate = 0, betsWon = 0 }) {
  const { t } = useTranslation();
  const badges = [];
  if (rank === 1) badges.push(<span key="rich" className="gg-badge gg-badge-gold" title={t('coin.badge_richest')}>💰 {t('coin.badge_richest')}</span>);
  else if (rank === 2) badges.push(<span key="r2" className="gg-badge gg-badge-silver" title="#2">🥈</span>);
  else if (rank === 3) badges.push(<span key="r3" className="gg-badge gg-badge-bronze" title="#3">🥉</span>);
  if (betsWon >= 5 && winRate >= 60) {
    badges.push(<span key="sharp" className="gg-badge gg-badge-blue" title={t('coin.badge_sharp')}>🎯 {t('coin.badge_sharp')}</span>);
  }
  if (!badges.length) return null;
  return <span className="gg-badge-row">{badges}</span>;
}

export default CoinBadge;
