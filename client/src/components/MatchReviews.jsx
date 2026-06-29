import { useEffect, useState } from 'react';
import api from '../api/client';
import { useTranslation } from '../i18n/TranslationContext';

// רשימת ריביוים מתקפלת מתחת לכל משחק. נטענת בעצלתיים בעת פתיחה,
// ומתרעננת כש-bump משתנה (אחרי פרסום ריביו חדש).
export default function MatchReviews({ matchId, bump = 0 }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/reviews/match/${matchId}`)
      .then(r => { setRows(r.data || []); setCount((r.data || []).length); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  // טען ספירה ראשונית קלה רק כשנפתח; רענן בעת פרסום אם פתוח
  useEffect(() => { if (open) load(); }, [open]);
  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [bump]);

  const label = count != null ? t('reviews.show', { count }) : t('reviews.show_empty');

  return (
    <div className="match-reviews">
      <button type="button" className="match-reviews-toggle" onClick={() => setOpen(o => !o)}>
        <span>{open ? '▾' : '▸'}</span> {label}
      </button>

      {open && (
        <div className="match-reviews-body">
          {loading && <div className="match-reviews-empty">{t('common.loading')}</div>}
          {!loading && rows && rows.length === 0 && (
            <div className="match-reviews-empty">{t('reviews.none')}</div>
          )}
          {!loading && rows && rows.map(rev => (
            <div key={rev.id} className="review-card" dir="rtl">
              <div className="review-card-head">
                {rev.profile_image_url
                  ? <img className="review-avatar" src={rev.profile_image_url} alt="" />
                  : <span className="review-avatar review-avatar-blank" aria-hidden="true">👤</span>}
                <span className="review-author">{rev.user_name}</span>
                {rev.include_prediction && rev.pred_home != null && rev.pred_away != null && (
                  <span className="review-pred-chip">
                    {t('reviews.my_prediction', { home: rev.pred_home, away: rev.pred_away })}
                  </span>
                )}
              </div>
              {rev.body && <div className="review-body">{rev.body}</div>}
              {rev.audio_url && <audio className="review-audio" controls src={rev.audio_url} />}
              {/* מקום עתידי להצבעות אימוג'י (שלב 2) */}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
