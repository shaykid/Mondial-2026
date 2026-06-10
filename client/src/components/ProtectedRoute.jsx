import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/TranslationContext';

export default function ProtectedRoute({ children, adminOnly = false, staffOnly = false, requireGuessGroups = false, allowGuest = false }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <div className="loading-page">{t('common.loading')}</div>;
  if (!user) return <Navigate to="/login" replace />;
  // אורח (לפני השלמת הרשמה) רשאי לגשת רק למסך "הניחושים שלי"
  if (user.isGuest && !allowGuest) return <Navigate to="/predictions" replace />;
  if (adminOnly && !user.isAdmin) return <Navigate to="/" replace />;
  if (staffOnly && !user.isAdmin && user.role !== 'manager') return <Navigate to="/" replace />;
  if (requireGuessGroups && !user.canGuessGroups) return <Navigate to="/" replace />;
  return children;
}
