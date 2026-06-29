import { useState, useMemo } from 'react';
import { useTranslation } from '../i18n/TranslationContext';
import PredictorIcon from './PredictorIcon';

// לוגו המקור לפי הדומיין (favicon גדול דרך שירות גוגל)
function logoFor(url) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; }
  catch { return null; }
}

// 4 כפתורי ניחוש-AI + אווטארים של ריביוי משתמשים, מתחת לכל משחק.
// data = { sources, consensus } | undefined ; reviews = [{...}] | undefined
export default function MatchPredictionButtons({ data, reviews }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(null); // {kind:'ai'|'review', i}
  const sources = (data && data.sources) || [];
  const consensus = data && data.consensus;
  const revs = reviews || [];
  // ריביו פנימי אחד אקראי (אם קיים) לצד 3-4 המקורות החיצוניים
  const review = useMemo(() => (revs.length ? revs[Math.floor(Math.random() * revs.length)] : null), [revs.length]);
  const slots = [0, 1, 2, 3];

  const typeLabel = (ty) => t(`aipred.type_${ty || 'editorial_opinion'}`);
  const cur = open && (open.kind === 'ai' ? sources[open.i] : review);

  return (
    <div className="aipred-bar" dir="rtl">
      <span className="aipred-bar-label"><PredictorIcon size={18} /> {t('aipred.bar_title')}</span>
      <div className="aipred-btns">
        {slots.map(i => {
          const s = sources[i];
          if (!s) {
            return (
              <button key={i} type="button" className="aipred-chip" disabled title={t('aipred.no_data')}>
                <PredictorIcon size={26} />
              </button>
            );
          }
          const logo = logoFor(s.source_url);
          return (
            <button key={i} type="button" className="aipred-chip active" onClick={() => setOpen({ kind: 'ai', i })} title={s.source_name}>
              {logo
                ? <img className="aipred-logo" src={logo} alt={s.source_name} onError={e => { e.currentTarget.style.display = 'none'; }} />
                : <PredictorIcon size={26} />}
            </button>
          );
        })}

        {/* ריביו פנימי אחד (אקראי) — אווטאר המבקר */}
        {review && (
          <button type="button" className="aipred-chip review-chip" onClick={() => setOpen({ kind: 'review' })} title={review.user_name}>
            {review.profile_image_url
              ? <img className="aipred-logo" src={review.profile_image_url} alt={review.user_name} />
              : <span className="aipred-avatar-fallback">{(review.user_name || '?').slice(0, 1)}</span>}
          </button>
        )}
      </div>

      {cur && open.kind === 'ai' && (
        <div className="aipred-modal-backdrop" onClick={() => setOpen(null)}>
          <div className="aipred-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="aipred-modal-head">
              <span>{logoFor(cur.source_url) && <img className="aipred-logo sm" src={logoFor(cur.source_url)} alt="" />} {cur.source_name}</span>
              <button className="aipred-x" onClick={() => setOpen(null)}>×</button>
            </div>
            <div className="aipred-type">{typeLabel(cur.prediction_type)}</div>
            <div className="aipred-pred">{cur.prediction || '—'}</div>
            {cur.notes && <div className="aipred-notes">{cur.notes}</div>}
            {cur.source_url && (
              <a className="aipred-link" href={cur.source_url} target="_blank" rel="noopener noreferrer">{t('aipred.open_source')} ↗</a>
            )}
            {consensus && (consensus.suggested_score || consensus.most_common) && (
              <div className="aipred-consensus">
                <strong>{t('aipred.consensus')}</strong>
                <div>{t('aipred.suggested_score')}: <b>{consensus.suggested_score || '—'}</b>{consensus.most_common ? ` · ${consensus.most_common}` : ''}</div>
                {consensus.confidence && <div>{t('aipred.confidence')}: {t(`aipred.conf_${consensus.confidence}`)}</div>}
                {consensus.explanation && <div className="aipred-expl">{consensus.explanation}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {cur && open.kind === 'review' && (
        <div className="aipred-modal-backdrop" onClick={() => setOpen(null)}>
          <div className="aipred-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="aipred-modal-head">
              <span>
                {cur.profile_image_url
                  ? <img className="aipred-logo sm" src={cur.profile_image_url} alt="" />
                  : null} {cur.user_name}
              </span>
              <button className="aipred-x" onClick={() => setOpen(null)}>×</button>
            </div>
            <div className="aipred-type">{t('reviews.member_review')}</div>
            {cur.body && <div className="aipred-pred" style={{ fontWeight: 500, fontSize: 15 }}>{cur.body}</div>}
            {cur.audio_url && <audio controls src={cur.audio_url} style={{ width: '100%', marginTop: 8 }} />}
          </div>
        </div>
      )}
    </div>
  );
}
