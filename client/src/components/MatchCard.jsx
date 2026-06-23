import Flag from './Flag';
import ScoreText from './ScoreText';
import { useTranslation } from '../i18n/TranslationContext';
import { ilDate, ilTime } from '../utils/time';

// שעה/תאריך לפי שעון ישראל
function formatDateTime(iso, locale) {
  return {
    date: ilDate(iso, locale, { day: '2-digit', month: '2-digit' }),
    time: ilTime(iso, locale, { hour: '2-digit', minute: '2-digit' })
  };
}

export default function MatchCard({ match, children }) {
  const { locale, pickText, t } = useTranslation();
  const { date, time } = formatDateTime(match.kickoff, locale);
  const finished = match.status === 'finished';
  const live = match.status === 'live';
  const hasScore = match.home_score != null && match.away_score != null;
  const homeName = pickText(match.home_name, match.home_name_en, match.home_name_ar);
  const awayName = pickText(match.away_name, match.away_name_en, match.away_name_ar);

  return (
    <div className={`match-card ${finished ? 'finished' : ''} ${live ? 'live' : ''}`}>
      <div className="match-team home">
        <span className="name">{homeName || match.home_code}</span>
        <Flag code={match.home_code} size="md" title={homeName} />
      </div>

      <div className="match-center">
        {hasScore ? (
          <div className="match-score">
            <ScoreText home={match.home_score} away={match.away_score} />
          </div>
        ) : (
          <>
            <div className="match-time">{time}</div>
            <div className="match-vs">VS</div>
            <div className="match-status">{date}</div>
          </>
        )}
        {finished && <div className="match-status">{t('matches.filter_finished')}</div>}
      </div>

      <div className="match-team away">
        <Flag code={match.away_code} size="md" title={awayName} />
        <span className="name">{awayName || match.away_code}</span>
      </div>

      {match.venue && <div className="match-venue">📍 {match.venue}</div>}
      {children && <div style={{ gridColumn: '1 / -1', marginTop: 12, borderTop: '1px dashed var(--line)', paddingTop: 12 }}>{children}</div>}
    </div>
  );
}
