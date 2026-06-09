import { useEffect, useState } from 'react';
import api from '../api/client';

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

export default function SchedulePrizes() {
  const [items, setItems] = useState([]);
  const [selectedPrize, setSelectedPrize] = useState(null);

  useEffect(() => {
    api.get('/schedule').then((r) => setItems(r.data || [])).catch(() => setItems([]));
  }, []);

  const now = Date.now();
  const nextItem = items.find((item) => new Date(item.end_at).getTime() >= now) || null;
  const prizeItems = items
    .filter((item) => Number.isInteger(Number(item.prize_slot)) && Number(item.prize_slot) > 0)
    .sort((a, b) => Number(a.prize_slot) - Number(b.prize_slot));

  return (
    <main className="page">
      <h1 className="page-title">
        לוז <span className="accent">ופרסים</span>
      </h1>
      <p className="page-subtitle">שלבי הטורניר, מועדי הביניים, והפרסים שמחולקים לאורך הדרך</p>

      <section className="schedule-layout">
        <div className="schedule-table-card">
          <table className="schedule-table">
            <thead>
              <tr>
                <th>שלב</th>
                <th>תאריכים</th>
                <th>מה קורה</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const passed = new Date(item.end_at).getTime() < now;
                return (
                  <tr key={item.id} className={passed ? 'passed' : ''}>
                    <td>{item.title}</td>
                    <td>{item.date_label}</td>
                    <td>{item.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <aside className="schedule-next-card">
          <div className="schedule-next-arrow">←</div>
          <div className="schedule-next-copy">
            <strong>היעד הבא</strong>
            {nextItem ? (
              <>
                <div>{nextItem.title}</div>
                <small>{nextItem.date_label} · {formatDate(nextItem.start_at)}</small>
              </>
            ) : (
              <small>כל המועדים בטבלה כבר עברו</small>
            )}
          </div>
        </aside>
      </section>

      <section style={{ marginTop: 28 }}>
        <div className="section-divider">
          <h2>פרסים</h2>
          <span className="badge">PRIZES</span>
        </div>

        <div className="prize-grid">
          {[1, 2, 3].map((slot) => {
            const item = prizeItems.find((entry) => Number(entry.prize_slot) === slot);
            return (
              <button
                key={slot}
                type="button"
                className="prize-card"
                onClick={() => item && setSelectedPrize(item)}
                disabled={!item}
              >
                {item?.prize_image_url ? (
                  <img src={item.prize_image_url} alt={`פרס ${slot}`} />
                ) : (
                  <div className="prize-placeholder">פרס {slot}</div>
                )}
                <div className="prize-card-label">פרס {slot}</div>
              </button>
            );
          })}
        </div>
      </section>

      {selectedPrize && (
        <div className="doc-modal-backdrop" onClick={() => setSelectedPrize(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-head">
              <div>
                <h3>{selectedPrize.title}</h3>
                <p style={{ margin: 0, color: 'var(--muted)' }}>{selectedPrize.description}</p>
              </div>
              <button className="btn btn-sm btn-outline" onClick={() => setSelectedPrize(null)}>סגור</button>
            </div>

            {selectedPrize.prize_image_url && (
              <img
                src={selectedPrize.prize_image_url}
                alt={selectedPrize.title}
                className="prize-modal-image"
              />
            )}

            <div className="winner-panel">
              <strong>הזוכה:</strong>
              {selectedPrize.winner_name ? (
                <span>{selectedPrize.winner_name}</span>
              ) : (
                <span style={{ color: 'var(--muted)' }}>טרם נקבע זוכה</span>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
