import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mondial_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    // עדכון "פעולה אחרונה" — תוקף ההפעלה מתחדש ל-36 יום מהפעולה האחרונה
    localStorage.setItem('mondial_last_active', String(Date.now()));
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      // Token invalid - clear and let UI handle redirect
      localStorage.removeItem('mondial_token');
    }
    return Promise.reject(err);
  }
);

export default api;

// Helper to extract error message
export function errMsg(err, fallback = 'אירעה שגיאה') {
  return err?.response?.data?.error || err?.message || fallback;
}
