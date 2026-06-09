import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function SchedulePopupManager() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [activePopup, setActivePopup] = useState(null);

  useEffect(() => {
    if (!user) return;
    api.get('/schedule').then((r) => setItems(r.data || [])).catch(() => setItems([]));
  }, [user]);

  useEffect(() => {
    if (!user || !items.length) return;
    const now = Date.now();
    const next = items.find((item) => {
      if (!item.popup_enabled || !item.popup_image_url) return false;
      const start = new Date(item.start_at).getTime();
      const end = new Date(item.end_at).getTime();
      const key = `schedule_popup_seen_${user.id}_${item.id}`;
      return now >= start && now <= end && !sessionStorage.getItem(key);
    });
    setActivePopup(next || null);
  }, [items, user]);

  if (!activePopup) return null;

  const closePopup = () => {
    sessionStorage.setItem(`schedule_popup_seen_${user.id}_${activePopup.id}`, '1');
    setActivePopup(null);
  };

  return (
    <div className="doc-modal-backdrop" onClick={closePopup}>
      <div className="admin-modal schedule-popup-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-head">
          <div>
            <h3>{activePopup.popup_title || activePopup.title}</h3>
            <p style={{ margin: 0, color: 'var(--muted)' }}>{activePopup.date_label}</p>
          </div>
          <button className="btn btn-sm btn-outline" onClick={closePopup}>סגור</button>
        </div>
        <img
          src={activePopup.popup_image_url}
          alt={activePopup.popup_title || activePopup.title}
          className="schedule-popup-image"
        />
      </div>
    </div>
  );
}
