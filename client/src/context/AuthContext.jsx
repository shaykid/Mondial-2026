import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

// העוגייה/הפעלה פגה לאחר 36 יום מהפעולה האחרונה של המשתמש
const INACTIVITY_MS = 36 * 24 * 60 * 60 * 1000;
const touch = () => localStorage.setItem('mondial_last_active', String(Date.now()));

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [coinsEnabled, setCoinsEnabled] = useState(true); // מתג ראשי למערכת השיחים

  // דגלי תכונות ציבוריים
  useEffect(() => {
    api.get('/site/features')
      .then(r => setCoinsEnabled(r.data?.coins_enabled !== false))
      .catch(() => setCoinsEnabled(true));
  }, []);

  const persistSession = (token, u) => {
    localStorage.setItem('mondial_token', token);
    touch();
    setUser(u);
  };

  // טעינת המשתמש המחובר אם יש token (פג תוקף לאחר 36 יום חוסר פעילות)
  useEffect(() => {
    const token = localStorage.getItem('mondial_token');
    const lastActive = Number(localStorage.getItem('mondial_last_active') || 0);
    if (!token) { setLoading(false); return; }
    if (lastActive && Date.now() - lastActive > INACTIVITY_MS) {
      localStorage.removeItem('mondial_token');
      localStorage.removeItem('mondial_last_active');
      setLoading(false);
      return;
    }
    api.get('/auth/me')
      .then(r => {
        if (r.data.token) localStorage.setItem('mondial_token', r.data.token);
        touch();
        setUser(r.data.user);
      })
      .catch(() => localStorage.removeItem('mondial_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    persistSession(data.token, data.user);
    return data.user;
  };

  const register = async (name, email, password, preferred_language) => {
    const { data } = await api.post('/auth/register', { name, email, password, preferred_language });
    persistSession(data.token, data.user);
    return data.user;
  };

  // התחלת משחק כאורח — יוצר משתמש זמני ומחזיר token כדי שיוכל לשמור ניחושים
  const guestStart = async (preferred_language) => {
    const { data } = await api.post('/auth/guest-start', { preferred_language });
    persistSession(data.token, data.user);
    return data.user;
  };

  const guestCheckEmail = async (email) => {
    const { data } = await api.post('/auth/guest-check-email', { email });
    return !!data.exists;
  };

  // השלמת הרשמת אורח (אימייל + טלפון) → רישום מלא לאתר
  const guestFinalize = async (email, phone_number) => {
    const { data } = await api.post('/auth/guest-finalize', { email, phone_number });
    persistSession(data.token, data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('mondial_token');
    localStorage.removeItem('mondial_last_active');
    setUser(null);
  };

  const updateProfile = async ({ phone_number, profile_image_file, preferred_language, publish_prediction, gender }) => {
    const form = new FormData();
    form.append('phone_number', phone_number || '');
    if (preferred_language) form.append('preferred_language', preferred_language);
    if (publish_prediction !== undefined) form.append('publish_prediction', publish_prediction ? '1' : '0');
    if (gender !== undefined) form.append('gender', gender);
    if (profile_image_file) form.append('profile_image', profile_image_file);
    const { data } = await api.post('/auth/profile', form);
    if (data?.user) setUser(data.user);
    return data || null;
  };

  return (
    <AuthContext.Provider value={{
      user, loading, login, register, logout, updateProfile,
      guestStart, guestCheckEmail, guestFinalize, coinsEnabled
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
