import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header';
import NewsTicker from './components/NewsTicker';
import LoginAnnouncementPopup from './components/LoginAnnouncementPopup';
import SchedulePopupManager from './components/SchedulePopupManager';
import SiteFooter from './components/SiteFooter';
import ProtectedRoute from './components/ProtectedRoute';
import ShabbatGate from './components/ShabbatGate';
import Login from './pages/Login';
import Home from './pages/Home';
import Predictions from './pages/Predictions';
import Matches from './pages/Matches';
import SchedulePrizes from './pages/SchedulePrizes';
import Groups from './pages/Groups';
import GuessGroups from './pages/GuessGroups';
import GuessGroupDetail from './pages/GuessGroupDetail';
import Leaderboard from './pages/Leaderboard';
import Admin from './pages/Admin';
import Profile from './pages/Profile';

export default function App() {
  return (
    <ShabbatGate>
      <div className="app-topbar">
        <Header />
        <NewsTicker />
      </div>
      <LoginAnnouncementPopup />
      <SchedulePopupManager />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/predictions" element={<ProtectedRoute allowGuest><Predictions /></ProtectedRoute>} />
        <Route path="/matches" element={<ProtectedRoute><Matches /></ProtectedRoute>} />
        <Route path="/schedule" element={<ProtectedRoute><SchedulePrizes /></ProtectedRoute>} />
        <Route path="/groups" element={<ProtectedRoute><Groups /></ProtectedRoute>} />
        <Route path="/guess-groups" element={<ProtectedRoute requireGuessGroups><GuessGroups /></ProtectedRoute>} />
        <Route path="/guess-groups/:id" element={<ProtectedRoute requireGuessGroups><GuessGroupDetail /></ProtectedRoute>} />
        <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute staffOnly><Admin /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SiteFooter />
    </ShabbatGate>
  );
}
