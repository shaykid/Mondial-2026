import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // טעינת המשתמש המחובר אם יש token
  useEffect(() => {
    const token = localStorage.getItem('mondial_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me')
      .then(r => {
        if (r.data.token) localStorage.setItem('mondial_token', r.data.token);
        setUser(r.data.user);
      })
      .catch(() => localStorage.removeItem('mondial_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('mondial_token', data.token);
    setUser(data.user);
    return data.user;
  };

  const register = async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password });
    localStorage.setItem('mondial_token', data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem('mondial_token');
    setUser(null);
  };

  const updateProfile = async ({ phone_number, profile_image_file }) => {
    const form = new FormData();
    form.append('phone_number', phone_number || '');
    if (profile_image_file) form.append('profile_image', profile_image_file);
    const { data } = await api.post('/auth/profile', form);
    if (data?.user) setUser(data.user);
    return data?.user || null;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
