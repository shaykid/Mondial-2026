import { useEffect, useState } from 'react';
import api, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState('');
  const [phoneDraft, setPhoneDraft] = useState(user?.phone_number || '');
  const [profileMsg, setProfileMsg] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setOk('');
    if (newPassword !== confirmPassword) {
      setErr('הסיסמה החדשה ואישור הסיסמה אינם תואמים');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword
      });
      setOk('הסיסמה עודכנה בהצלחה');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!profileImageFile) {
      setProfilePreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(profileImageFile);
    setProfilePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [profileImageFile]);

  useEffect(() => {
    setPhoneDraft(user?.phone_number || '');
  }, [user?.phone_number]);

  const saveProfileDetails = async () => {
    setProfileMsg('');
    setProfileBusy(true);
    try {
      await updateProfile({ profile_image_file: profileImageFile, phone_number: phoneDraft });
      setProfileMsg('פרטי הפרופיל נשמרו');
      setProfileImageFile(null);
    } catch (e) {
      setProfileMsg(errMsg(e, 'שגיאה בשמירת פרופיל'));
    } finally {
      setProfileBusy(false);
    }
  };

  return (
    <main className="page">
      <h1 className="page-title">
        <span className="accent">הפרופיל</span> שלי
      </h1>
      <p className="page-subtitle">כאן אפשר לעדכן את הסיסמה האישית שלך</p>

      <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
        <div className="stat-card" style={{ borderTop: '4px solid var(--pitch)' }}>
          <div className="label">פרטי משתמש</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 12 }}>
            <InfoField label="שם מלא" value={user?.name || '—'} />
            <InfoField label="אימייל" value={user?.email || '—'} />
            <InfoField label="טלפון" value={user?.phone_number || '—'} />
            <InfoField label="מחלקה" value={user?.department || '—'} />
          </div>
        </div>

        <div className="stat-card" style={{ borderTop: '4px solid var(--crimson)' }}>
          <div className="label">פרטי פרופיל</div>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>
            ניתן לעדכן טלפון ולהחליף את תמונת הפרופיל.
          </p>

          <div style={{margin: '12px 0'}}>
            {(profilePreviewUrl || user?.profile_image_url) ? (
              <img
                src={profilePreviewUrl || user?.profile_image_url}
                alt="profile"
                style={{ width: 90, height: 90, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--line-bold)' }}
              />
            ) : (
              <div style={{ width: 90, height: 90, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--paper-dim)', border: '2px solid var(--line-bold)' }}>
                👤
              </div>
            )}
          </div>

          <div className="field" style={{maxWidth: 420}}>
            <label>טלפון</label>
            <input
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder="050-0000000"
            />
          </div>

          <div className="field" style={{maxWidth: 420}}>
            <label>בחר תמונה חדשה</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setProfileImageFile(e.target.files?.[0] || null)}
            />
          </div>

          {profileMsg && <div className={`alert ${profileMsg.includes('שגיאה') ? 'alert-error' : 'alert-success'}`}>{profileMsg}</div>}

          <button className="btn btn-gold" type="button" onClick={saveProfileDetails} disabled={profileBusy}>
            {profileBusy ? <span className="spinner" /> : 'שמור פרופיל'}
          </button>
        </div>

        <form className="stat-card" style={{ borderTop: '4px solid var(--gold)' }} onSubmit={submit}>
          <div className="label">שינוי סיסמה</div>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>
            יש להזין את הסיסמה הנוכחית ולאחר מכן לבחור סיסמה חדשה.
          </p>

          {err && <div className="alert alert-error">{err}</div>}
          {ok && <div className="alert alert-success">{ok}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div className="field">
              <label>סיסמה נוכחית</label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="field">
              <label>סיסמה חדשה</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <div className="field">
              <label>אישור סיסמה חדשה</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          </div>

          <button className="btn btn-gold" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : 'שמור סיסמה חדשה'}
          </button>
        </form>
      </div>
    </main>
  );
}

function InfoField({ label, value }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <input value={value} readOnly />
    </div>
  );
}
