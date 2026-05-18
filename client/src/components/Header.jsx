import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState } from 'react';

export default function Header() {
  const { user, logout, updateProfile } = useAuth();
  const nav = useNavigate();
  const [profileOpen, setProfileOpen] = useState(false);
  const [phone, setPhone] = useState(user?.phone_number || '');
  const [imageFile, setImageFile] = useState(null);
  const [imageName, setImageName] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

  if (!user) return null;

  const doLogout = () => { logout(); nav('/login'); };
  const openProfile = () => {
    setPhone(user?.phone_number || '');
    setImageFile(null);
    setImageName('');
    setMsg('');
    setProfileOpen(true);
  };
  const saveProfile = async () => {
    setSaving(true);
    setMsg('');
    try {
      await updateProfile({ phone_number: phone, profile_image_file: imageFile });
      setMsg('נשמר בהצלחה');
      setTimeout(() => setProfileOpen(false), 500);
    } catch (e) {
      setMsg(e?.response?.data?.error || 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  return (
    <>
      <header className="app-header">
      <div className="header-inner">
        {user?.profile_image_url ? (
          <img className="header-avatar" src={user.profile_image_url} alt={user.name} />
        ) : (
          <div className="header-avatar header-avatar-fallback">{(user?.name || '?').slice(0, 1)}</div>
        )}
        <div className="brand">
          <span className="brand-trophy">🏆</span>
          <div>
            <div>מונדיאל 2026</div>
            <div className="brand-sub">ניחושי חברת שיח</div>
          </div>
        </div>

        <nav className="nav">
          <NavLink to="/" end className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>בית</NavLink>
          <NavLink to="/predictions" className={({isActive}) => 'nav-link' + (isActive ? ' active' : '')}>הניחושיח שלי</NavLink>
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
        <button className="btn-logout" onClick={openProfile}>Profile</button>
        <button className="btn-logout" onClick={doLogout}>יציאה</button>
      </div>
      </header>

      {profileOpen && (
        <div className="player-picker-overlay" onClick={() => setProfileOpen(false)}>
          <div className="player-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="player-picker-head">
              <h3>עריכת פרופיל</h3>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setProfileOpen(false)}>סגור</button>
            </div>
            <div className="field">
              <label>טלפון</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" />
            </div>
            <div className="field">
              <label>תמונת פרופיל</label>
              <div style={{marginBottom:10}}>
                {(previewUrl || user?.profile_image_url) ? (
                  <img
                    src={previewUrl || user?.profile_image_url}
                    alt="profile preview"
                    style={{width:72, height:72, borderRadius:'50%', objectFit:'cover', border:'2px solid var(--line-bold)', background:'var(--paper-dim)'}}
                  />
                ) : (
                  <div style={{width:72, height:72, borderRadius:'50%', border:'2px solid var(--line-bold)', background:'var(--paper-dim)', display:'grid', placeItems:'center', color:'var(--muted)'}}>👤</div>
                )}
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setImageFile(f);
                  setImageName(f?.name || '');
                }}
              />
              {imageName && <div style={{fontSize:12, color:'var(--muted)', marginTop:6}}>נבחר: {imageName}</div>}
            </div>
            {msg && <div className={`alert ${msg.includes('שגיאה') ? 'alert-error' : 'alert-success'}`}>{msg}</div>}
            <button type="button" className="btn btn-gold" onClick={saveProfile} disabled={saving}>
              {saving ? 'שומר...' : 'שמור פרופיל'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
