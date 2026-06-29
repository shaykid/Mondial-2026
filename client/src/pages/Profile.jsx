import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/TranslationContext';
import { UserGroupBadges } from '../components/GroupBadges';
import MyReviews from '../components/MyReviews';
import MyCoinsPanel from '../components/MyCoinsPanel';

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const { t, language } = useTranslation();
  const [stats, setStats] = useState(null);
  const [topGroups, setTopGroups] = useState([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState('');
  const [phoneDraft, setPhoneDraft] = useState(user?.phone_number || '');
  const [languageDraft, setLanguageDraft] = useState(user?.preferred_language || language);
  const [profileMsg, setProfileMsg] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setOk('');
    if (newPassword !== confirmPassword) {
      setErr(t('profile.password_mismatch'));
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword
      });
      setOk(t('profile.password_saved'));
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
    api.get('/predictions/stats').then(r => setStats(r.data)).catch(() => setStats(null));
    if (user?.canGuessGroups) {
      api.get('/guess-groups/leaderboard').then(r => setTopGroups((r.data || []).slice(0, 7))).catch(() => setTopGroups([]));
    }
  }, [user?.canGuessGroups]);

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

  useEffect(() => {
    setLanguageDraft(user?.preferred_language || language);
  }, [user?.preferred_language, language]);

  const saveProfileDetails = async () => {
    setProfileMsg('');
    setProfileBusy(true);
    try {
      const res = await updateProfile({ profile_image_file: profileImageFile, phone_number: phoneDraft, preferred_language: languageDraft });
      setProfileMsg(res?.pic_bonus ? t('profile.pic_bonus_granted') : t('profile.saved'));
      setProfileImageFile(null);
    } catch (e) {
      setProfileMsg(errMsg(e, t('profile.save_error')));
    } finally {
      setProfileBusy(false);
    }
  };

  return (
    <main className="page">
      <h1 className="page-title">
        {t('profile.title')}
      </h1>
      <p className="page-subtitle">{t('profile.subtitle')}</p>

      <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
        <div className="stat-card" style={{ borderTop: '4px solid var(--pitch)' }}>
          <div className="label">{t('profile.user_details')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginTop: 12 }}>
            <InfoField label={t('login.full_name')} value={user?.name || t('common.none')} />
            <InfoField label={t('login.email')} value={user?.email || t('common.none')} />
            <InfoField label={t('profile.phone')} value={user?.phone_number || t('common.none')} />
            <InfoField label={t('admin.tab_departments')} value={user?.department || t('common.none')} />
          </div>
        </div>

        {stats && <StatisticsCard stats={stats} t={t} showGroup={!!user?.canGuessGroups} />}

        <div className="stat-card" style={{ borderTop: '4px solid var(--crimson)' }}>
          <div className="label">{t('profile.profile_details')}</div>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>
            {t('profile.profile_help')}
          </p>
          {!user?.profile_image_url && !user?.isGuest && (
            <p className="pic-bonus-note">🎁 {t('profile.pic_bonus_note')}</p>
          )}

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
            <label>{t('profile.phone')}</label>
            <input
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder="050-0000000"
            />
          </div>

          <div className="field" style={{maxWidth: 420}}>
            <label>{t('common.language')}</label>
            <select value={languageDraft} onChange={(e) => setLanguageDraft(e.target.value)}>
              <option value="he">{t('common.language_he')}</option>
              <option value="ar">{t('common.language_ar')}</option>
              <option value="en">{t('common.language_en')}</option>
            </select>
          </div>

          <div className="field" style={{maxWidth: 420}}>
            <label>{t('profile.choose_image')}</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setProfileImageFile(e.target.files?.[0] || null)}
            />
          </div>

          {profileMsg && <div className={`alert ${profileMsg.includes('שגיאה') ? 'alert-error' : 'alert-success'}`}>{profileMsg}</div>}

          <button className="btn btn-gold" type="button" onClick={saveProfileDetails} disabled={profileBusy}>
            {profileBusy ? <span className="spinner" /> : t('profile.save_profile')}
          </button>
        </div>

        <form className="stat-card" style={{ borderTop: '4px solid var(--gold)' }} onSubmit={submit}>
          <div className="label">{t('profile.password_change')}</div>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>
            {t('profile.password_help')}
          </p>

          {err && <div className="alert alert-error">{err}</div>}
          {ok && <div className="alert alert-success">{ok}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            <div className="field">
              <label>{t('profile.current_password')}</label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="field">
              <label>{t('profile.new_password')}</label>
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
              <label>{t('profile.confirm_password')}</label>
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
            {busy ? <span className="spinner" /> : t('profile.save_password')}
          </button>
        </form>
      </div>

      {!user?.isGuest && <MyCoinsPanel />}

      <MyReviews />

      {user?.canGuessGroups && <TopGroupsBanner groups={topGroups} t={t} />}
    </main>
  );
}

function StatisticsCard({ stats, t, showGroup = false }) {
  const ind = stats.individual || {};
  const grp = stats.group || {};
  const partner = grp.top_partner;
  return (
    <div className="stat-card" style={{ borderTop: '4px solid var(--gold)' }}>
      <div className="label">{t('profile.stats_title')}</div>
      {showGroup && <UserGroupBadges groupsCount={grp.groups_count || 0} />}

      <div className="gg-stats-section">{t('profile.stats_individual')}</div>
      <div className="gg-stats-grid">
        <Metric value={ind.total_points ?? 0} label={t('profile.stat_total_points')} accent />
        <Metric value={ind.rank ? `#${ind.rank}` : '—'} label={t('profile.stat_rank')} />
        <Metric value={ind.num_predictions ?? 0} label={t('profile.stat_predictions')} />
        <Metric value={ind.exact_hits ?? 0} label={t('profile.stat_exact')} />
        <Metric value={ind.result_hits ?? 0} label={t('profile.stat_result')} />
        <Metric value={ind.misses ?? 0} label={t('profile.stat_misses')} />
      </div>

      {showGroup && <div className="gg-stats-section">{t('profile.stats_group')}</div>}
      {showGroup && ((grp.groups_count || 0) === 0 ? (
        <div style={{ color: 'var(--muted)', padding: '8px 0' }}>{t('profile.stat_no_groups')}</div>
      ) : (
        <>
          <div className="gg-stats-grid">
            <Metric value={grp.groups_count ?? 0} label={t('profile.stat_groups')} />
            <Metric value={grp.total_group_points ?? 0} label={t('profile.stat_group_points')} accent />
            <Metric value={grp.total_paid ?? 0} label={t('profile.stat_total_paid')} />
            <Metric value={grp.available_points ?? 0} label={t('gg.available_points')} />
            <Metric
              value={grp.best_group ? `#${grp.best_group.rank}` : '—'}
              label={t('profile.stat_best_group')}
              sub={grp.best_group ? grp.best_group.name : ''}
            />
          </div>

          <div className="gg-mygroups">
            <div className="gg-mygroups-head">
              <span>{t('profile.stat_groups')}</span>
              <span style={{ textAlign: 'center' }}>{t('gg.entry_cost')}</span>
              <span style={{ textAlign: 'end' }}>{t('profile.stat_my_earn')}</span>
            </div>
            {(grp.groups || []).map(g => (
              <Link key={g.id} to={`/guess-groups/${g.id}`} className="gg-mygroups-row">
                <span className="gg-mygroups-name">{g.name} <span className="gg-mygroups-rank">#{g.rank}</span></span>
                <span style={{ textAlign: 'center', color: 'var(--muted)' }}>{g.cost > 0 ? g.cost : '—'}</span>
                <span style={{ textAlign: 'end' }} className={`gg-mygroups-earn ${(g.earned - g.cost) >= 0 ? 'pos' : 'neg'}`}>
                  {g.earned} {g.cost > 0 ? <span className="gg-mygroups-net">({(g.earned - g.cost) >= 0 ? '+' : ''}{g.earned - g.cost})</span> : null}
                </span>
              </Link>
            ))}
          </div>
          <div className="gg-partner">
            <span className="gg-partner-label">{t('profile.stat_top_partner')}:</span>
            {partner ? (
              <span className="gg-partner-name">
                {partner.profile_image_url
                  ? <img className="gg-mini-avatar" src={partner.profile_image_url} alt={partner.name} />
                  : <span className="gg-mini-avatar gg-mini-fallback">{(partner.name || '?').slice(0, 1)}</span>}
                <strong>{partner.name}</strong>
                <span style={{ color: 'var(--muted)' }}>· {t('gg.x_members', { n: partner.groups })}</span>
              </span>
            ) : <span style={{ color: 'var(--muted)' }}>{t('profile.stat_no_partner')}</span>}
          </div>
        </>
      ))}
    </div>
  );
}

function Metric({ value, label, sub, accent }) {
  return (
    <div className="gg-metric">
      <span className={`gg-metric-val ${accent ? 'accent' : ''}`}>{value}</span>
      <span className="gg-metric-lbl">{label}</span>
      {sub && <span className="gg-metric-sub">{sub}</span>}
    </div>
  );
}

// באנר "הקבוצות המובילות" — באנר #1 מתוך סט באנרים בתחתית הפרופיל (30% התחתונים)
function TopGroupsBanner({ groups, t }) {
  return (
    <section className="gg-banner-set" aria-label={t('profile.banner_top_groups')}>
      <div className="gg-banner">
        <div className="gg-banner-head">
          <span className="gg-banner-title">🏆 {t('profile.banner_top_groups')}</span>
          <span className="gg-banner-sub">{t('profile.banner_subtitle')}</span>
        </div>
        {groups.length === 0 ? (
          <div className="gg-banner-empty">{t('gg.board_empty')}</div>
        ) : (
          <div className="gg-banner-strip">
            {groups.map(g => (
              <Link key={g.id} to={`/guess-groups/${g.id}`} className={`gg-banner-card rank-${g.rank}`}>
                <div className="gg-banner-rank">#{g.rank}</div>
                <div className="gg-banner-name">{g.name}</div>
                <div className="gg-banner-pts">{g.total_points} <span>{t('gg.points')}</span></div>
                <div className="gg-banner-meta">
                  {t('gg.x_members', { n: g.member_count })} · ×{g.multiplier} · {g.winning_bets}/{g.total_bets} {t('gg.winning_bets')}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
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
