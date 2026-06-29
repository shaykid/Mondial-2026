import { useState } from 'react';
import { useTranslation } from '../i18n/TranslationContext';
import PredictorIcon from './PredictorIcon';

// 4 כפתורי ניחוש-AI מתחת לכל משחק. כל כפתור פותח פופאפ עם ניחוש ממקור אחד.
// data = { sources: [...], consensus: {...} } או undefined (אז הכפתורים מושבתים).
export default function MatchPredictionButtons({ data }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(null); // אינדקס מקור פתוח
  const sources = (data && data.sources) || [];
  const consensus = data && data.consensus;
  const slots = [0, 1, 2, 3];

  const typeLabel = (ty) => t(`aipred.type_${ty || 'editorial_opinion'}`);

  return (
    <div className="aipred-bar" dir="rtl">
      <span className="aipred-bar-label"><PredictorIcon size={15} /> {t('aipred.bar_title')}</span>
      <div className="aipred-btns">
        {slots.map(i => {
          const s = sources[i];
          if (!s) {
            return (
              <button key={i} type="button" className="aipred-btn" disabled title={t('aipred.no_data')}>
                <PredictorIcon size={16} />
              </button>
            );
          }
          return (
            <button key={i} type="button" className="aipred-btn active" onClick={() => setOpen(i)} title={s.source_name}>
              <PredictorIcon size={16} />
              <span className="aipred-btn-name">{s.source_name}</span>
            </button>
          );
        })}
      </div>

      {open != null && sources[open] && (
        <div className="aipred-modal-backdrop" onClick={() => setOpen(null)}>
          <div className="aipred-modal" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="aipred-modal-head">
              <span><PredictorIcon size={20} /> {sources[open].source_name}</span>
              <button className="aipred-x" onClick={() => setOpen(null)}>×</button>
            </div>
            <div className="aipred-type">{typeLabel(sources[open].prediction_type)}</div>
            <div className="aipred-pred">{sources[open].prediction || '—'}</div>
            {sources[open].notes && <div className="aipred-notes">{sources[open].notes}</div>}
            {sources[open].source_url && (
              <a className="aipred-link" href={sources[open].source_url} target="_blank" rel="noopener noreferrer">
                {t('aipred.open_source')} ↗
              </a>
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
    </div>
  );
}
