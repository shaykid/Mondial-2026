import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/TranslationContext';
import LanguageSelector from './LanguageSelector';

export default function Header() {
  const { user, logout, coinsEnabled } = useAuth();
  const { t } = useTranslation();
  const nav = useNavigate();

  const doLogout = () => { logout(); nav('/login'); };

  if (!user) return null;

  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="header-left-tools">
          <LanguageSelector compact />
        </div>

        <div className="header-right-brand">
          {coinsEnabled && <span className="header-brand-name">הינביט-מרקט</span>}
          {user?.profile_image_url ? (
            <img className="header-avatar" src={user.profile_image_url} alt={user.name} />
          ) : (
            <div className="header-avatar header-avatar-fallback">{(user?.name || '?').slice(0, 1)}</div>
          )}
          <img className="header-logo-large header-logo-left" src="/theme-assets/logo-header.png" alt="Hinbit logo" />
        </div>

        {user.isGuest ? (
          <nav className="nav">
            <span className="nav-link active">{t('nav.predictions')}</span>
          </nav>
        ) : (
        <nav className="nav">
          <NavLink to="/" end className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.home')}</NavLink>
          <NavLink to="/predictions" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.predictions')}</NavLink>
          <NavLink to="/matches" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.matches')}</NavLink>
          <NavLink to="/schedule" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.schedule')}</NavLink>
          <NavLink to="/groups" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.groups')}</NavLink>
          {user.canGuessGroups && (
            <NavLink to="/guess-groups" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.guess_groups')}</NavLink>
          )}
          {!user.isGuest && coinsEnabled && (
            <NavLink to="/coin-bets" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.coin_betting')}</NavLink>
          )}
          <NavLink to="/leaderboard" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.leaderboard')}</NavLink>
          <NavLink to="/profile" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.profile')}</NavLink>
          {(user.isAdmin || user.role === 'manager') && (
            <NavLink to="/admin" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>{t('nav.admin')}</NavLink>
          )}
        </nav>
        )}

        <span className="user-chip">
          <span>{user.name}</span>
        </span>
        <button className="btn-logout" onClick={doLogout}>{t('nav.logout')}</button>
      </div>
    </header>
  );
}
