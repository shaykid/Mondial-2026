import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Header() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  if (!user) return null;

  const doLogout = () => { logout(); nav('/login'); };

  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="brand">
          <span className="brand-trophy">🏆</span>
          <div>
            <div>מונדיאל 2026</div>
            <div className="brand-sub">ניחושי החברה</div>
          </div>
        </div>

        <nav className="nav">
          <NavLink to="/" end className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>בית</NavLink>
          <NavLink to="/predictions" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>הניחושים שלי</NavLink>
          <NavLink to="/matches" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>משחקים</NavLink>
          <NavLink to="/groups" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>בתים</NavLink>
          <NavLink to="/leaderboard" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>טבלת מצטיינים</NavLink>
          <NavLink to="/profile" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>פרופיל</NavLink>
          {user.isAdmin && (
            <NavLink to="/admin" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>ניהול</NavLink>
          )}
        </nav>

        <span className="user-chip">
          <span>{user.name}</span>
        </span>
        <button className="btn-logout" onClick={doLogout}>יציאה</button>
      </div>
    </header>
  );
}
