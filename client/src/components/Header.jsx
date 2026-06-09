import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Header() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const doLogout = () => { logout(); nav('/login'); };

  if (!user) return null;

  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="header-right-brand">
          <img className="header-logo-large" src="/shiah-logo-white.png" alt="לוגו שיח" />
          {user?.profile_image_url ? (
            <img className="header-avatar" src={user.profile_image_url} alt={user.name} />
          ) : (
            <div className="header-avatar header-avatar-fallback">{(user?.name || '?').slice(0, 1)}</div>
          )}
        </div>

        <nav className="nav">
          <NavLink to="/" end className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>בית</NavLink>
          <NavLink to="/predictions" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>הניחושיח שלי</NavLink>
          <NavLink to="/matches" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>משחקים</NavLink>
          <NavLink to="/schedule" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>לוז ופרסים</NavLink>
          <NavLink to="/groups" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>בתים</NavLink>
          <NavLink to="/leaderboard" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>טבלת מצטיינים</NavLink>
          <NavLink to="/profile" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>פרופיל אישי</NavLink>
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
