import { useEffect, useState } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/TranslationContext';

function getStorageKey(userId, popupId) {
  return `special_popup_seen_${userId}_${popupId}`;
}

export default function LoginAnnouncementPopup() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [activePopup, setActivePopup] = useState(null);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setActivePopup(null);
      return;
    }
    api.get('/site/special-popups').then((r) => setItems(r.data || [])).catch(() => setItems([]));
  }, [user]);

  useEffect(() => {
    if (!user?.id || !items.length) {
      setActivePopup(null);
      return;
    }

    const now = Date.now();
    const next = items.find((item) => {
      if (!item?.enabled || !item?.image_url || !item?.id) return false;
      const start = new Date(item.start_at).getTime();
      const end = new Date(item.end_at).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return now >= start && now <= end && !localStorage.getItem(getStorageKey(user.id, item.id));
    });
    setActivePopup(next || null);
  }, [items, user]);

  if (!user || !activePopup) return null;

  const closePopup = () => {
    localStorage.setItem(getStorageKey(user.id, activePopup.id), '1');
    setActivePopup(null);
  };

  return (
    <div className="doc-modal-backdrop" onClick={closePopup}>
      <div className="admin-modal login-announcement-modal" onClick={(e) => e.stopPropagation()}>
        {!!activePopup.title && (
          <div className="admin-modal-head" style={{ marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{activePopup.title}</h3>
          </div>
        )}
        <div className="login-announcement-actions">
          <button className="btn btn-sm btn-outline" onClick={closePopup}>{t('common.close')}</button>
        </div>
        <img
          src={activePopup.image_url}
          alt={activePopup.title || 'Special popup'}
          className="login-announcement-image"
        />
      </div>
    </div>
  );
}
