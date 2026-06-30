import { useEffect, useState } from 'react';
import api from '../api/client';
import { useTranslation } from '../i18n/TranslationContext';
import Flag from './Flag';

const CONF = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };

// פופאפ ביקורת נבחרת (AI) — נטען לפי קוד הנבחרת
export default function TeamReviewModal({ code, onClose }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    setLoading(true); setErr('');
    api.get(`/team-reviews/${code}`)
      .then(r => setData(r.data?.review || null))
      .catch(() => setErr(t('teamrev.none')))
      .finally(() => setLoading(false));
  }, [code]);

  const r = data || {};
  const fs = r.formation_and_style || {};
  const pa = r.professional_assessment || {};

  return (
    <div className="aipred-modal-backdrop" onClick={onClose}>
      <div className="aipred-modal teamrev-modal" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="aipred-modal-head">
          <span><Flag code={code} size="sm" /> {r.team_name || code?.toUpperCase()}</span>
          <button className="aipred-x" onClick={onClose}>×</button>
        </div>

        {loading && <div style={{ padding: 20 }}>{t('common.loading')}</div>}
        {!loading && err && <div className="alert alert-error">{err}</div>}

        {!loading && data && (
          <div className="teamrev-body">
            {r.summary && <p className="teamrev-summary">{r.summary}</p>}

            {(fs.usual_formation || fs.attacking_style) && (
              <section>
                <h4>הרכב וסגנון משחק</h4>
                {fs.usual_formation && <div><b>מערך:</b> {fs.usual_formation}</div>}
                {Array.isArray(fs.key_players) && fs.key_players.length > 0 && <div><b>שחקני מפתח:</b> {fs.key_players.join(', ')}</div>}
                {fs.attacking_style && <div><b>התקפה:</b> {fs.attacking_style}</div>}
                {fs.defensive_structure && <div><b>הגנה:</b> {fs.defensive_structure}</div>}
                {fs.bench_depth && <div><b>עומק ספסל:</b> {fs.bench_depth}</div>}
              </section>
            )}

            {Array.isArray(r.advantages) && r.advantages.length > 0 && (
              <section><h4>יתרונות</h4><ul>{r.advantages.map((a, i) => <li key={i}>{a}</li>)}</ul></section>
            )}
            {Array.isArray(r.weaknesses) && r.weaknesses.length > 0 && (
              <section><h4>חסרונות</h4><ul>{r.weaknesses.map((a, i) => <li key={i}>{a}</li>)}</ul></section>
            )}

            {Array.isArray(r.key_players) && r.key_players.length > 0 && (
              <section>
                <h4>שחקני מפתח</h4>
                <table className="teamrev-table">
                  <thead><tr><th>שחקן</th><th>תפקיד</th><th>למה חשוב</th></tr></thead>
                  <tbody>{r.key_players.map((p, i) => <tr key={i}><td>{p.name}</td><td>{p.position}</td><td>{p.importance}</td></tr>)}</tbody>
                </table>
              </section>
            )}

            {Array.isArray(r.review_sources) && r.review_sources.length > 0 && (
              <section>
                <h4>ביקורות ממקורות</h4>
                {r.review_sources.map((s, i) => (
                  <div key={i} className="teamrev-source">
                    <span className="teamrev-source-icon">{s.source_icon || '📰'}</span>
                    <div>
                      <a href={s.url} target="_blank" rel="noopener noreferrer"><b>{s.reviewer_label || s.source_name}</b></a>
                      {s.main_point && <div className="teamrev-source-point">{s.main_point}</div>}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {(pa.ceiling || pa.biggest_danger) && (
              <section className="teamrev-assess">
                <h4>סיכום מקצועי</h4>
                {pa.ceiling && <div><b>תקרת זכוכית:</b> {pa.ceiling}</div>}
                {pa.main_condition_for_success && <div><b>תנאי להצלחה:</b> {pa.main_condition_for_success}</div>}
                {pa.biggest_danger && <div><b>הסכנה הגדולה:</b> {pa.biggest_danger}</div>}
                {pa.confidence_level && <div><b>רמת ביטחון:</b> {CONF[pa.confidence_level] || pa.confidence_level}</div>}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
