import { useEffect, useState } from 'react';
import api from '../api/client';

export default function NewsTicker() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.get('/news/sports')
      .then((r) => setItems(r.data || []))
      .catch(() => setItems([]));
  }, []);

  if (!items.length) return null;

  return (
    <div className="news-ticker" dir="rtl">
      <div className="news-ticker-label">חדשות ספורט</div>
      <div className="news-ticker-track">
        <div className="news-ticker-content">
          {[...items, ...items].map((item, index) => (
            <a key={`${item.link}-${index}`} href={item.link} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
