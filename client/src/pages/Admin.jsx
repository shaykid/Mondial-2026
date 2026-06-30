// דף ניהול - מנהל בלבד
// ----------------------------------------------------------------
// טאבים: סקירה / משתמשים / משחקים / הגדרות / פעולות
// ----------------------------------------------------------------
import { useEffect, useState } from 'react';
import api, { errMsg } from '../api/client';
import Flag from '../components/Flag';
import { useTranslation } from '../i18n/TranslationContext';
import { useAuth } from '../context/AuthContext';
import { ilDate, ilDateTime } from '../utils/time';
import { stageLabel } from '../lib/stages';

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const { t } = useTranslation();
  const { user } = useAuth();
  const isFullAdmin = !!user?.isAdmin;
  // מנהל-משנה (manager) רואה רק את הטאבים של ניהול משתמשים ומשחקים
  const MANAGER_TABS = ['overview', 'users', 'matches'];
  const allTabs = [
    { id: 'overview', label: t('admin.tab_overview') },
    { id: 'users', label: t('admin.tab_users') },
    { id: 'departments', label: t('admin.tab_departments') },
    { id: 'matches', label: t('admin.tab_matches') },
    { id: 'settings', label: t('admin.tab_settings') },
    { id: 'missing', label: 'ניחושים חסרים' },
    { id: 'badges', label: t('admin.tab_badges') },
    { id: 'messages', label: 'שליחת הודעות' },
    { id: 'contact', label: 'צור קשר' },
    { id: 'schedule', label: t('admin.tab_schedule') },
    { id: 'datasource', label: 'מקור נתונים' },
    { id: 'simulate', label: '🤖 סימולציה' },
    { id: 'actions', label: t('admin.tab_actions') }
  ];
  const tabs = isFullAdmin ? allTabs : allTabs.filter(item => MANAGER_TABS.includes(item.id));

  return (
    <div className="page">
      <h1 className="page-title">
        {t('admin.title')}
      </h1>
      <p className="page-subtitle">{t('admin.subtitle')}</p>

      <div className="tabs" style={{ marginBottom: 32 }}>
        {tabs.map(item => (
          <button
            key={item.id}
            className={`tab ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
          >{item.label}</button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users'    && <UsersTab    />}
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'matches'  && <MatchesTab  />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'missing'  && <MissingGuessesTab />}
      {tab === 'badges'   && <BadgesTab   />}
      {tab === 'messages' && <MessagesTab />}
      {tab === 'contact'  && <ContactTab  />}
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'datasource' && <DataSourceTab />}
      {tab === 'simulate' && <SimulateTab />}
      {tab === 'actions'  && <ActionsTab  />}
    </div>
  );
}

/* ─────────────── סימולציה: משתמשים וירטואליים ─────────────── */
const inputStyle = (w) => ({ display: 'block', marginTop: 4, width: w, minWidth: w, padding: '8px 10px', border: '1px solid var(--paper-dim)', borderRadius: 8, background: 'var(--paper-pure)' });
function SimulateTab() {
  const [strategies, setStrategies] = useState([]);
  const [count, setCount] = useState(6);
  const [strategy, setStrategy] = useState('random');
  const [opts, setOpts] = useState({ bets: true, reviews: true, likes: true, suggestions: true, avatar: true });
  const [list, setList] = useState([]);
  const [progress, setProgress] = useState({ running: false, total: 0, done: 0, failed: 0 });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [matches, setMatches] = useState([]);
  const [betMatch, setBetMatch] = useState('');
  const [betH, setBetH] = useState('');
  const [betA, setBetA] = useState('');

  const load = async () => {
    try {
      const { data } = await api.get('/admin/simulate/list');
      setList(data.users || []);
      setProgress(data.progress || { running: false });
    } catch (e) { /* */ }
  };

  const toggleEnabled = async (u) => {
    try { await api.patch(`/admin/simulate/${u.user_id}`, { enabled: !u.enabled }); load(); }
    catch (e) { setMsg(errMsg(e)); }
  };

  const toggleSel = (id) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = list.length > 0 && list.every(u => sel.has(u.user_id));
  const selectAll = () => setSel(allSelected ? new Set() : new Set(list.map(u => u.user_id)));

  const bulk = async (action, extra = {}) => {
    const ids = [...sel];
    if (!ids.length) { setMsg('לא נבחרו בוטים'); return; }
    try {
      const { data } = await api.post('/admin/simulate/bulk', { ids, action, ...extra });
      setMsg(`✓ בוצע על ${data.affected} בוטים`);
      load();
    } catch (e) { setMsg(errMsg(e)); }
  };
  const bulkRebet = () => {
    if (!betMatch) { setMsg('בחר משחק'); return; }
    const hasScore = betH !== '' && betA !== '';
    bulk('rebet', { matchId: Number(betMatch), ...(hasScore ? { home: Number(betH), away: Number(betA) } : {}) });
  };

  useEffect(() => {
    api.get('/admin/simulate/strategies').then(r => setStrategies(r.data.strategies || [])).catch(() => {});
    api.get('/matches').then(r => setMatches((r.data || []).filter(m => m.status !== 'finished'))).catch(() => {});
    load();
    const iv = setInterval(load, 4000); // טבלה חיה
    return () => clearInterval(iv);
  }, []);

  const create = async () => {
    setBusy(true); setMsg('');
    try {
      const { data } = await api.post('/admin/simulate', { count: Number(count), strategy, options: opts });
      setMsg(`✓ התחילה יצירת ${data.started} בוטים (${data.strategy}). הטבלה תתעדכן בזמן אמת.`);
      load();
    } catch (e) {
      setMsg(errMsg(e));
    } finally { setBusy(false); }
  };

  const removeOne = async (id) => {
    if (!confirm('למחוק את משתמש הסימולציה הזה (וכל הנתונים שלו)?')) return;
    try { await api.delete(`/admin/simulate/${id}`); load(); } catch (e) { setMsg(errMsg(e)); }
  };
  const removeAll = async () => {
    if (!confirm('למחוק את כל משתמשי הסימולציה? פעולה בלתי הפיכה.')) return;
    try { const { data } = await api.delete('/admin/simulate/all'); setMsg(`✓ נמחקו ${data.removed} בוטים`); load(); }
    catch (e) { setMsg(errMsg(e)); }
  };

  const toggle = (k) => setOpts(o => ({ ...o, [k]: !o[k] }));
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div>
      <div className="alert" style={{ background: 'var(--paper-dim)', marginBottom: 16 }}>
        יצירת משתמשים וירטואליים (בוטים) עם שם/טלפון/אימייל ואווטאר שנוצרים ב-AI, ניחושים לכל המשחקים,
        4-5 ריביוים, 20-30 לייקים (אהבתי) והצעות הימור לשחקנים אחרים — לפי אסטרטגיית הימור נבחרת.
        <br /><small style={{ color: 'var(--muted)' }}>בוטים נוצרים <b>מושבתים כברירת מחדל</b> — סמנו אותם והפעילו. הם אינם מקבלים מיילים אמיתיים.</small>
      </div>

      <div style={{ display: 'grid', gap: 12, padding: 16, marginBottom: 20, background: 'var(--paper-pure)', border: '1px solid var(--paper-dim)', borderRadius: 12 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>כמות
            <input type="number" min={1} max={50} value={count}
              onChange={e => setCount(e.target.value)} style={inputStyle(90)} />
          </label>
          <label>אסטרטגיית הימור
            <select value={strategy} onChange={e => setStrategy(e.target.value)} style={inputStyle(200)}>
              {strategies.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[['bets', 'ניחושים'], ['reviews', 'ריביוים'], ['likes', 'לייקים (אהבתי)'], ['suggestions', 'הצעות הימור'], ['avatar', 'אווטאר AI']].map(([k, lbl]) => (
            <label key={k} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={!!opts[k]} onChange={() => toggle(k)} /> {lbl}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-gold" onClick={create} disabled={busy || progress.running}>
            {progress.running ? 'סימולציה רצה…' : 'צור בוטים'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={load}>רענון</button>
          <button className="btn btn-sm btn-outline" style={{ color: 'var(--crimson)' }} onClick={removeAll}>מחק הכל</button>
        </div>
        {progress.running && (
          <div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>בתהליך: {progress.done}/{progress.total} (נכשלו: {progress.failed})</div>
            <div style={{ height: 8, background: 'var(--paper-dim)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--pitch)' }} />
            </div>
          </div>
        )}
        {msg && <div className={`alert ${msg.startsWith('✓') ? 'alert-success' : 'alert-error'}`}>{msg}</div>}
      </div>

      <h3 style={{ margin: '8px 0' }}>בוטים ({list.length}) · פעילים {list.filter(u => u.enabled).length}</h3>

      {sel.size > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '10px 14px', marginBottom: 10, background: 'var(--paper-pure)', border: '1px solid var(--gold)', borderRadius: 10 }}>
          <b>{sel.size} נבחרו</b>
          <button className="btn btn-sm btn-pitch" onClick={() => bulk('enable')}>הפעל</button>
          <button className="btn btn-sm btn-outline" onClick={() => bulk('disable')}>השבת</button>
          <button className="btn btn-sm btn-outline" onClick={() => setSel(new Set())}>נקה בחירה</button>
          <span style={{ borderInlineStart: '1px solid var(--paper-dim)', paddingInlineStart: 10, display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            שנה ניחוש למשחק:
            <select value={betMatch} onChange={e => setBetMatch(e.target.value)} style={inputStyle(220)}>
              <option value="">בחר משחק…</option>
              {matches.map(m => <option key={m.id} value={m.id}>{(m.home_name || m.home_label_he || m.home_code)} – {(m.away_name || m.away_label_he || m.away_code)}</option>)}
            </select>
            <input type="number" min={0} max={30} placeholder="בית" value={betH} onChange={e => setBetH(e.target.value)} style={inputStyle(70)} />
            <input type="number" min={0} max={30} placeholder="חוץ" value={betA} onChange={e => setBetA(e.target.value)} style={inputStyle(70)} />
            <button className="btn btn-sm btn-gold" onClick={bulkRebet}>החל</button>
            <small style={{ color: 'var(--muted)' }}>(ריק = לפי אסטרטגיה)</small>
          </span>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}><input type="checkbox" checked={allSelected} onChange={selectAll} /></th>
              <th>שם</th><th>אסטרטגיה</th><th>טלפון</th><th>אימייל</th>
              <th>ניחושים</th><th>ריביוים</th><th>לייקים</th><th>הצעות</th><th>שיחים</th><th>סטטוס</th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.map(u => (
              <tr key={u.user_id} style={{ opacity: u.enabled ? 1 : 0.55, background: sel.has(u.user_id) ? 'var(--paper-dim)' : undefined }}>
                <td><input type="checkbox" checked={sel.has(u.user_id)} onChange={() => toggleSel(u.user_id)} /></td>
                <td style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
                  {u.profile_image_url
                    ? <img src={u.profile_image_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                    : <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--paper-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{(u.name || '?').slice(0, 1)}</span>}
                  {u.name}
                </td>
                <td>{u.strategy_he}</td>
                <td dir="ltr">{u.phone_number}</td>
                <td dir="ltr" style={{ fontSize: 12, color: 'var(--muted)' }}>{u.email}</td>
                <td>{u.predictions}</td>
                <td>{u.reviews}</td>
                <td>{u.likes}</td>
                <td>{u.suggestions}</td>
                <td>{u.balance?.toLocaleString?.() ?? u.balance}</td>
                <td>
                  <button className={`toggle-pill ${u.enabled ? 'on' : ''}`} style={{ fontSize: 12 }}
                    onClick={() => toggleEnabled(u)}>{u.enabled ? 'פעיל' : 'מושבת'}</button>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-gold" onClick={() => setEditId(u.user_id)}>ערוך</button>{' '}
                  <button className="btn btn-sm btn-outline" style={{ color: 'var(--crimson)' }} onClick={() => removeOne(u.user_id)}>מחק</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={12} style={{ color: 'var(--muted)' }}>אין עדיין בוטים — צור כמה למעלה.</td></tr>}
          </tbody>
        </table>
      </div>

      {editId && <BotEditModal id={editId} strategies={strategies} onClose={() => setEditId(null)} onSaved={load} />}
    </div>
  );
}

/* ─────────────── פופאפ עריכת בוט ─────────────── */
function BotEditModal({ id, strategies, onClose, onSaved }) {
  const [bot, setBot] = useState(null);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [imgPrompt, setImgPrompt] = useState('');
  const [regen, setRegen] = useState(false);
  const [img, setImg] = useState('');
  const [history, setHistory] = useState(null);

  useEffect(() => {
    api.get(`/admin/simulate/${id}`).then(r => {
      setBot(r.data);
      setForm({
        name: r.data.name || '', phone_number: r.data.phone_number || '', email: r.data.email || '',
        strategy: r.data.strategy, enabled: r.data.enabled, email_as_name: !!r.data.persona?.email_as_name,
        bio: r.data.persona?.bio || '', style: r.data.persona?.style || '', avatar_hint: r.data.persona?.avatar_hint || ''
      });
      setImg(r.data.profile_image_url || '');
    }).catch(e => setMsg(errMsg(e)));
  }, [id]);

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true); setMsg('');
    try { await api.patch(`/admin/simulate/${id}`, form); onSaved && onSaved(); onClose(); }
    catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  };

  const regenerate = async () => {
    setRegen(true); setMsg('');
    try { const { data } = await api.post(`/admin/simulate/${id}/regenerate-avatar`, { prompt: imgPrompt }); setImg(data.profile_image_url + '?t=' + Date.now()); onSaved && onSaved(); }
    catch (e) { setMsg(errMsg(e)); } finally { setRegen(false); }
  };

  const loadHistory = async () => {
    try { const { data } = await api.get(`/admin/simulate/${id}/history`); setHistory(data.events || []); }
    catch (e) { setMsg(errMsg(e)); }
  };

  if (!bot) return null;
  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="admin-modal-head">
          <h3>עריכת בוט · {bot.name}</h3>
          <button className="btn btn-sm btn-outline" onClick={onClose}>סגור</button>
        </div>
        {msg && <div className="alert alert-error">{msg}</div>}

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center' }}>
            {img
              ? <img src={img} alt="" style={{ width: 120, height: 120, borderRadius: 12, objectFit: 'cover' }} />
              : <div style={{ width: 120, height: 120, borderRadius: 12, background: 'var(--paper-dim)', display: 'grid', placeItems: 'center' }}>{(bot.name || '?').slice(0, 1)}</div>}
            <div style={{ marginTop: 8 }}>
              <input placeholder="פרומפט לתמונה (אופציונלי)" value={imgPrompt} onChange={e => setImgPrompt(e.target.value)} style={inputStyle(170)} />
              <button className="btn btn-sm btn-pitch" style={{ marginTop: 6 }} onClick={regenerate} disabled={regen}>{regen ? 'מייצר…' : 'צור פרצוף חדש'}</button>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 240, display: 'grid', gap: 8 }}>
            <label>שם<input value={form.name} onChange={e => upd('name', e.target.value)} style={inputStyle('100%')} /></label>
            <label>טלפון<input dir="ltr" value={form.phone_number} onChange={e => upd('phone_number', e.target.value)} style={inputStyle('100%')} /></label>
            <label>אימייל<input dir="ltr" value={form.email} onChange={e => upd('email', e.target.value)} style={inputStyle('100%')} /></label>
            <label>אסטרטגיה
              <select value={form.strategy} onChange={e => upd('strategy', e.target.value)} style={inputStyle('100%')}>
                {(strategies || []).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={!!form.enabled} onChange={e => upd('enabled', e.target.checked)} /> פעיל (מופיע בטבלה החיה)
            </label>
            <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={!!form.email_as_name} onChange={e => upd('email_as_name', e.target.checked)} /> השתמש באימייל כשם תצוגה
            </label>
          </div>
        </div>

        <label style={{ display: 'block', marginTop: 10 }}>ביו<textarea rows="2" value={form.bio} onChange={e => upd('bio', e.target.value)} style={{ ...inputStyle('100%'), display: 'block' }} /></label>
        <label style={{ display: 'block' }}>סגנון ניחוש<input value={form.style} onChange={e => upd('style', e.target.value)} style={inputStyle('100%')} /></label>

        <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
          <button className="btn btn-gold" onClick={save} disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button className="btn btn-outline" onClick={loadHistory}>היסטוריית מעשים</button>
        </div>

        {history && (
          <div style={{ marginTop: 12, maxHeight: 220, overflowY: 'auto', borderTop: '1px solid var(--paper-dim)', paddingTop: 8 }}>
            {history.length === 0 ? <div style={{ color: 'var(--muted)' }}>אין פעולות עדיין</div> : history.map((e, i) => (
              <div key={i} style={{ fontSize: 13, padding: '3px 0', display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{ilDateTime(e.at)}</span>
                <span>{e.type === 'bet' ? '🎯' : e.type === 'review' ? '🎙️' : e.type === 'like' ? '❤️' : '💰'} {e.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── סקירה ─────────────── */
function OverviewTab() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');
  const { t } = useTranslation();

  useEffect(() => {
    api.get('/admin/overview')
      .then(r => setStats(r.data))
      .catch(e => setErr(errMsg(e)));
  }, []);

  if (err) return <div className="alert alert-error">{err}</div>;
  if (!stats) return <div className="loading-page"><div className="spinner" /></div>;

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="label">{t('admin.overview.users')}</div>
        <div className="value">{stats.users}</div>
      </div>
      <div className="stat-card">
        <div className="label">{t('admin.overview.predictions')}</div>
        <div className="value">{stats.predictions}</div>
      </div>
      <div className="stat-card">
        <div className="label">{t('admin.overview.matches')}</div>
        <div className="value">{stats.matches}</div>
      </div>
      <div className="stat-card">
        <div className="label">{t('admin.overview.finished')}</div>
        <div className="value">{stats.finished}</div>
      </div>
    </div>
  );
}

/* ─────────────── משתמשים ─────────────── */
function UsersTab() {
  const { user: currentUser } = useAuth();
  const isFullAdmin = !!currentUser?.isAdmin;
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [importMode, setImportMode] = useState('replace_existing');
  const [importResult, setImportResult] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoResult, setDemoResult] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createDraft, setCreateDraft] = useState({ name: '', email: '', phone_number: '', department: '', password: '', role: 'user' });
  const [createBusy, setCreateBusy] = useState(false);
  const [createNotice, setCreateNotice] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [editNotice, setEditNotice] = useState('');
  const [resetNotice, setResetNotice] = useState('');

  const load = () => {
    setErr('');
    Promise.all([
      api.get('/admin/users'),
      api.get('/admin/departments')
    ])
      .then(([usersRes, departmentsRes]) => {
        setUsers(usersRes.data);
        setDepartments(departmentsRes.data.departments || []);
      })
      .catch(e => setErr(errMsg(e)));
  };

  useEffect(load, []);

  const openEdit = (user) => {
    setErr('');
    setEditNotice('');
    setResetNotice('');
    setEditingUser(user);
    setEditDraft({
      name: user.name || '',
      email: user.email || '',
      phone_number: user.phone_number || '',
      department: user.department || '',
      can_guess_groups: !!user.can_guess_groups,
      publish_prediction: !!user.publish_prediction,
      gender: ['male', 'female', 'irrelevant', 'random'].includes(user.gender) ? user.gender : 'random',
      role: user.is_admin ? 'admin' : (user.role || 'user')
    });
  };

  const closeEdit = () => {
    setEditingUser(null);
    setEditDraft(null);
    setEditBusy(false);
    setResetBusy(false);
    setEditNotice('');
    setResetNotice('');
  };

  const openCreate = () => {
    setErr('');
    setCreateNotice('');
    setCreateDraft({ name: '', email: '', phone_number: '', department: '', password: '', role: 'user' });
    setCreatingUser(true);
  };

  const closeCreate = () => {
    setCreatingUser(false);
    setCreateBusy(false);
    setCreateNotice('');
  };

  const createUser = async () => {
    setCreateBusy(true);
    setErr('');
    setCreateNotice('');
    try {
      const { data } = await api.post('/admin/users', createDraft);
      setCreateNotice(`משתמש נוצר. סיסמה: ${data.password}`);
      load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setCreateBusy(false);
    }
  };

  const remove = async (id, name) => {
    if (!confirm(`למחוק את ${name}? פעולה זו אינה הפיכה.`)) return;
    setBusy(true);
    try {
      await api.delete(`/admin/users/${id}`);
      load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const saveUser = async () => {
    if (!editingUser || !editDraft) return;
    setEditBusy(true);
    setErr('');
    setEditNotice('');
    setResetNotice('');
    try {
      const payload = {
        name: editDraft.name,
        email: editDraft.email,
        phone_number: editDraft.phone_number,
        department: editDraft.department,
        can_guess_groups: editDraft.can_guess_groups,
        publish_prediction: editDraft.publish_prediction,
        gender: editDraft.gender
      };
      if (isFullAdmin) payload.role = editDraft.role;
      const { data } = await api.patch(`/admin/users/${editingUser.id}`, payload);
      setEditNotice('הנתונים נשמרו בהצלחה');
      if (data?.user) {
        setEditingUser(data.user);
        setEditDraft({
          name: data.user.name || '',
          email: data.user.email || '',
          phone_number: data.user.phone_number || '',
          department: data.user.department || '',
          can_guess_groups: !!data.user.can_guess_groups,
          publish_prediction: !!data.user.publish_prediction,
          gender: ['male', 'female', 'irrelevant', 'random'].includes(data.user.gender) ? data.user.gender : 'random',
          role: data.user.is_admin ? 'admin' : (data.user.role || 'user')
        });
      }
      load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setEditBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!editingUser) return;
    if (!confirm(`לאפס סיסמה עבור ${editingUser.name}?`)) return;
    setResetBusy(true);
    setErr('');
    setResetNotice('');
    try {
      const { data } = await api.post(`/admin/users/${editingUser.id}/reset-password`);
      setResetNotice(`הסיסמה אופסה: ${data.password}`);
      load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setResetBusy(false);
    }
  };

  const download = async (format) => {
    setExporting(format);
    setErr('');
    setImportResult(null);
    try {
      const { data } = await api.get(`/admin/users/export?format=${format}`, { responseType: 'blob' });
      const blob = new Blob([data], {
        type: format === 'csv'
          ? 'text/csv;charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `users.${format === 'csv' ? 'csv' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setExporting(null);
    }
  };

  const importUsers = async () => {
    if (!importFile) {
      setErr('יש לבחור קובץ לייבוא');
      return;
    }
    const confirmText = importMode === 'replace_all'
      ? 'האם לנקות את כל המשתמשים הקיימים שאינם מנהלים, ואז לייבא רק את מה שיש בקובץ?'
      : 'האם לייבא את הקובץ ולעדכן משתמשים קיימים לפי אימייל?';
    if (!confirm(confirmText)) return;

    setImporting(true);
    setErr('');
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      formData.append('import_mode', importMode);
      const { data } = await api.post('/admin/users/import', formData);
      setImportResult(data);
      setImportFile(null);
      load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = [
      'שם מלא,email (username),password,phone number,מחלקה',
      'משתמש בדיקה 01,demo01@company.local,,050-555-1001,שיווק'
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const createDemoUsers = async () => {
    if (!confirm('ליצור/לעדכן 10 משתמשי דמו עם כל הניחושים?')) return;
    setDemoBusy(true);
    setErr('');
    setDemoResult(null);
    try {
      const { data } = await api.post('/admin/users/demo');
      setDemoResult(data);
      load();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div>
      {err && <div className="alert alert-error">{err}</div>}
      {importResult && (
        <div className="alert alert-success">
          ייבוא הושלם: {importResult.created} נוצרו, {importResult.updated} עודכנו, {importResult.skipped} דולגו.
          {importResult.import_mode === 'replace_all' && (
            <div style={{ marginTop: 8 }}>
              נוקו לפני הייבוא {importResult.cleared} משתמשים קיימים שאינם מנהלים.
            </div>
          )}
          {importResult.generated?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong>סיסמאות שנוצרו אוטומטית:</strong>
              <div style={{ marginTop: 8, maxHeight: 220, overflow: 'auto', background: 'rgba(255,255,255,0.5)', padding: 12, borderRadius: 4 }}>
                {importResult.generated.map(item => (
                  <div key={`${item.email}-${item.password}`} style={{ marginBottom: 8 }}>
                    <div>{item.name} · {item.email} · {item.department || '—'}</div>
                    <div style={{ fontFamily: 'monospace' }}>{item.password}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {demoResult && (
        <div className="alert alert-success">
          נוצרו/עודכנו {demoResult.users} משתמשי דמו ו-{demoResult.predictions} ניחושים.
          {demoResult.generated?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong>פרטי כניסה לדמו:</strong>
              <div style={{ marginTop: 8, maxHeight: 220, overflow: 'auto', background: 'rgba(255,255,255,0.5)', padding: 12, borderRadius: 4 }}>
                {demoResult.generated.map(item => (
                  <div key={item.email} style={{ marginBottom: 8 }}>
                    <div>{item.name} · {item.email} · {item.department || '—'}</div>
                    <div style={{ fontFamily: 'monospace' }}>
                      {item.password} · {item.phone_number || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <button className="btn btn-sm btn-gold" onClick={openCreate}>
          הוסף משתמש
        </button>
        <button className="btn btn-sm btn-gold" onClick={() => download('csv')} disabled={exporting !== null}>
          {exporting === 'csv' ? 'מייצא...' : 'ייצוא CSV'}
        </button>
        <button className="btn btn-sm btn-outline" onClick={() => download('xlsx')} disabled={exporting !== null}>
          {exporting === 'xlsx' ? 'מייצא...' : 'ייצוא XLSX'}
        </button>
        <button className="btn btn-sm btn-outline" onClick={downloadTemplate}>
          הורד תבנית
        </button>
        <label className="btn btn-sm btn-pitch" style={{ overflow: 'hidden', position: 'relative' }}>
          <input
            type="file"
            accept=".csv,.xls,.xlsx"
            onChange={e => setImportFile(e.target.files?.[0] || null)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
          />
          {importFile ? `קובץ: ${importFile.name}` : 'בחר קובץ לייבוא'}
        </label>
        <select
          value={importMode}
          onChange={e => setImportMode(e.target.value)}
          style={{ minWidth: 220 }}
        >
          <option value="replace_existing">ייבוא: החלף קיימים / הוסף חדשים</option>
          <option value="replace_all">ייבוא: נקה הכל והעלה רק מהקובץ</option>
        </select>
        <button className="btn btn-sm btn-pitch" onClick={importUsers} disabled={importing || !importFile}>
          {importing ? 'מייבא...' : 'ייבוא משתמשים'}
        </button>
        <button className="btn btn-sm btn-gold" onClick={createDemoUsers} disabled={demoBusy}>
          {demoBusy ? 'יוצר...' : 'צור 10 משתמשי דמו'}
        </button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -6, marginBottom: 16 }}>
        ביצוא, עמודת הסיסמה נשארת ריקה כי המערכת שומרת רק גיבוב סיסמה. לפני הייבוא בחר האם לעדכן קיימים או לנקות את כל המשתמשים שאינם מנהלים ולהעלות רק את תוכן הקובץ.
      </p>
      <div style={{
        background: 'var(--paper-pure)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        overflow: 'hidden'
      }}>
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>שם</th>
              <th>אימייל</th>
              <th>טלפון</th>
              <th>מחלקה</th>
              <th>ניחושים</th>
              <th>נרשם בתאריך</th>
              <th>תפקיד</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td><strong>{u.name}</strong></td>
                <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{u.email}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{u.phone_number || '—'}</td>
                <td style={{ fontSize: 13 }}>{u.department || '—'}</td>
                <td>{u.num_predictions}</td>
                <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {ilDate(u.created_at, 'he-IL')}
                </td>
                <td>
                  {(u.role === 'admin' || u.is_admin)
                    ? <span className="deadline-badge ok">מנהל מערכת</span>
                    : u.role === 'manager'
                      ? <span className="deadline-badge">מנהל-משנה</span>
                      : <span style={{ color: 'var(--muted)' }}>משתמש</span>
                  }
                </td>
                <td>
                  <button
                    className="btn btn-sm btn-outline"
                    style={{ marginInlineEnd: 8 }}
                    onClick={() => openEdit(u)}
                  >ערוך</button>
                  {!(u.role === 'admin' || u.is_admin) && (
                    <button
                      className="btn btn-sm"
                      style={{ background: 'var(--crimson)' }}
                      onClick={() => remove(u.id, u.name)}
                      disabled={busy}
                    >מחק</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
          אין משתמשים רשומים עדיין
        </p>
      )}

      {creatingUser && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal">
            <div className="admin-modal-head">
              <div>
                <h3>הוספת משתמש חדש</h3>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  אם לא תוזן סיסמה, תיווצר סיסמה אוטומטית.
                </div>
              </div>
              <button className="btn btn-sm btn-outline" onClick={closeCreate}>סגור</button>
            </div>
            {createNotice && <div className="alert alert-success" style={{ marginTop: 16 }}>{createNotice}</div>}
            <div className="admin-form-grid">
              <div className="field">
                <label>שם מלא</label>
                <input value={createDraft.name} onChange={e => setCreateDraft(s => ({ ...s, name: e.target.value }))} />
              </div>
              <div className="field">
                <label>אימייל</label>
                <input type="email" value={createDraft.email} onChange={e => setCreateDraft(s => ({ ...s, email: e.target.value }))} />
              </div>
              <div className="field">
                <label>טלפון</label>
                <input value={createDraft.phone_number} onChange={e => setCreateDraft(s => ({ ...s, phone_number: e.target.value }))} />
              </div>
              <div className="field">
                <label>מחלקה</label>
                <input list="department-options" value={createDraft.department} onChange={e => setCreateDraft(s => ({ ...s, department: e.target.value }))} />
              </div>
              <div className="field">
                <label>סיסמה</label>
                <input value={createDraft.password} onChange={e => setCreateDraft(s => ({ ...s, password: e.target.value }))} placeholder="ריק = יצירה אוטומטית" />
              </div>
              {isFullAdmin && (
                <div className="field">
                  <label>תפקיד</label>
                  <select value={createDraft.role} onChange={e => setCreateDraft(s => ({ ...s, role: e.target.value }))}>
                    <option value="user">משתמש</option>
                    <option value="manager">מנהל-משנה</option>
                    <option value="admin">מנהל מערכת</option>
                  </select>
                </div>
              )}
            </div>
            <button className="btn btn-pitch" onClick={createUser} disabled={createBusy}>
              {createBusy ? 'יוצר...' : 'צור משתמש'}
            </button>
          </div>
        </div>
      )}

      {editingUser && editDraft && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(11, 18, 32, 0.55)',
          display: 'grid',
          placeItems: 'center',
          padding: 16,
          zIndex: 50
        }}>
          <div style={{
            width: 'min(720px, 100%)',
            maxHeight: '90vh',
            overflow: 'auto',
            background: 'var(--paper-pure)',
            borderRadius: 12,
            border: '1px solid var(--line)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.28)',
            padding: 24
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'start' }}>
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 6, fontFamily: 'var(--font-display)' }}>
                  עריכת משתמש
                </h3>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {editingUser.name} · {editingUser.email}
                </div>
              </div>
              <button className="btn btn-sm btn-outline" onClick={closeEdit}>סגור</button>
            </div>

            {editNotice && <div className="alert alert-success" style={{ marginTop: 16 }}>{editNotice}</div>}
            {resetNotice && (
              <div className="alert alert-success" style={{ marginTop: 12, wordBreak: 'break-all' }}>
                {resetNotice}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
              <div className="field">
                <label>שם מלא</label>
                <input
                  type="text"
                  value={editDraft.name}
                  onChange={e => setEditDraft(s => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>אימייל</label>
                <input
                  type="email"
                  value={editDraft.email}
                  onChange={e => setEditDraft(s => ({ ...s, email: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>טלפון</label>
                <input
                  type="text"
                  value={editDraft.phone_number}
                  onChange={e => setEditDraft(s => ({ ...s, phone_number: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>מחלקה</label>
                <input
                  list="department-options"
                  type="text"
                  value={editDraft.department}
                  onChange={e => setEditDraft(s => ({ ...s, department: e.target.value }))}
                  placeholder="בחר/הקלד מחלקה"
                />
              </div>
            </div>

            <datalist id="department-options">
              {departments.map(dep => (
                <option key={dep} value={dep} />
              ))}
            </datalist>

            {isFullAdmin && (
              <div className="field" style={{ marginTop: 16 }}>
                <label>תפקיד</label>
                <select
                  value={editDraft.role}
                  onChange={e => setEditDraft(s => ({ ...s, role: e.target.value }))}
                >
                  <option value="user">משתמש</option>
                  <option value="manager">מנהל-משנה (ניהול משתמשים ומשחקים)</option>
                  <option value="admin">מנהל מערכת (גישה מלאה)</option>
                </select>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                  מנהל-משנה רשאי לנהל משתמשים ולעדכן תוצאות משחקים בלבד.
                </div>
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!editDraft.can_guess_groups}
                onChange={e => setEditDraft(s => ({ ...s, can_guess_groups: e.target.checked }))}
                style={{ width: 18, height: 18 }}
              />
              <span>ניחוש קבוצתי (הרשאת גישה למערכת הניחוש הקבוצתי)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!editDraft.publish_prediction}
                onChange={e => setEditDraft(s => ({ ...s, publish_prediction: e.target.checked }))}
                style={{ width: 18, height: 18 }}
              />
              <span>פרסום תחזיות (מציג למשתמש את כפתור ההקלטה "פרסם את התחזית שלך")</span>
            </label>

            <div className="field" style={{ marginTop: 16, maxWidth: 260 }}>
              <label>מגדר (לניסוח טקסטים בעברית)</label>
              <select value={editDraft.gender || 'random'} onChange={e => setEditDraft(s => ({ ...s, gender: e.target.value }))}>
                <option value="random">אקראי</option>
                <option value="male">זכר</option>
                <option value="female">נקבה</option>
                <option value="irrelevant">לא רלוונטי</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
              <button className="btn btn-pitch" onClick={saveUser} disabled={editBusy}>
                {editBusy ? 'שומר...' : 'שמור שינויים'}
              </button>
              <button className="btn btn-outline" onClick={resetPassword} disabled={resetBusy}>
                {resetBusy ? 'מאפס...' : 'איפוס סיסמה'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────── מחלקות ─────────────── */
function DepartmentsTab() {
  const [departments, setDepartments] = useState([]);
  const [draft, setDraft] = useState([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setErr('');
    setOk('');
    api.get('/admin/departments')
      .then(r => {
        const list = r.data.departments || [];
        setDepartments(list);
        setDraft(list.length ? list : ['']);
      })
      .catch(e => setErr(errMsg(e)));
  };

  useEffect(load, []);

  const update = (index, value) => {
    setDraft(items => items.map((item, i) => (i === index ? value : item)));
  };

  const addRow = () => setDraft(items => [...items, '']);
  const removeRow = (index) => setDraft(items => items.filter((_, i) => i !== index));

  const save = async () => {
    const clean = draft.map(item => item.trim()).filter(Boolean);
    if (!clean.length) {
      setErr('יש להזין לפחות מחלקה אחת');
      return;
    }
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const { data } = await api.post('/admin/departments', { departments: clean });
      const list = data.departments || clean;
      setDepartments(list);
      setDraft(list.length ? list : ['']);
      setOk('המחלקות נשמרו בהצלחה');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 760 }}>
      {err && <div className="alert alert-error">{err}</div>}
      {ok && <div className="alert alert-success">{ok}</div>}

      <div style={{
        background: 'var(--paper-pure)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        padding: 24
      }}>
        <h3 style={{
          marginTop: 0,
          marginBottom: 8,
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          letterSpacing: 1,
          color: 'var(--ink)'
        }}>ניהול מחלקות</h3>
        <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
          הרשימה הזו משמשת את טופס המשתמשים, ייבוא קבצים ועריכת פרטי משתמשים.
        </p>

        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {draft.map((value, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                value={value}
                onChange={e => update(index, e.target.value)}
                placeholder={`מחלקה ${index + 1}`}
              />
              <button
                className="btn btn-sm btn-outline"
                onClick={() => removeRow(index)}
                disabled={draft.length === 1}
              >
                מחק
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn btn-sm btn-outline" onClick={addRow}>הוסף מחלקה</button>
          <button className="btn btn-gold" onClick={save} disabled={busy}>
            {busy ? 'שומר...' : 'שמור מחלקות'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── משחקים ─────────────── */
function MatchesTab() {
  const [matches, setMatches] = useState([]);
  const [filter, setFilter] = useState('upcoming');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [editing, setEditing] = useState({}); // { matchId: { home, away } }

  const load = () => {
    api.get('/matches')
      .then(r => setMatches(r.data))
      .catch(e => setErr(errMsg(e)));
  };

  useEffect(load, []);

  const setVal = (mid, side, val) => {
    setEditing(s => ({
      ...s,
      [mid]: { ...(s[mid] || {}), [side]: val }
    }));
  };

  const setRandomTestScore = (m) => {
    const home = Math.floor(Math.random() * 5);
    const away = Math.floor(Math.random() * 5);
    setEditing((s) => ({
      ...s,
      [m.id]: { ...(s[m.id] || {}), home, away }
    }));
  };

  const save = async (m) => {
    const e = editing[m.id] || {};
    const h = e.home ?? m.home_score;
    const a = e.away ?? m.away_score;
    const hN = parseInt(h, 10), aN = parseInt(a, 10);
    if (!Number.isInteger(hN) || !Number.isInteger(aN) || hN < 0 || aN < 0) {
      setErr('יש להזין שתי תוצאות חיוביות');
      return;
    }
    setErr(''); setOk('');
    try {
      await api.post(`/admin/matches/${m.id}/score`, {
        home_score: hN,
        away_score: aN,
        status: 'finished'
      });
      setOk(`תוצאה נשמרה למשחק #${m.id}`);
      setEditing(s => { const c = { ...s }; delete c[m.id]; return c; });
      load();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const clear = async (m) => {
    if (!confirm(`לבטל את התוצאה של ${m.home_name} נגד ${m.away_name}?`)) return;
    try {
      await api.delete(`/admin/matches/${m.id}/score`);
      setOk(`תוצאה אופסה למשחק #${m.id}`);
      load();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const filtered = matches.filter(m => {
    if (filter === 'all')      return true;
    if (filter === 'finished') return m.status === 'finished';
    if (filter === 'upcoming') return m.status !== 'finished';
    return true;
  });

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${filter === 'upcoming' ? 'active' : ''}`} onClick={() => setFilter('upcoming')}>עתידיים</button>
        <button className={`tab ${filter === 'finished' ? 'active' : ''}`} onClick={() => setFilter('finished')}>הסתיימו</button>
        <button className={`tab ${filter === 'all'      ? 'active' : ''}`} onClick={() => setFilter('all')}>הכל</button>
      </div>

      {err && <div className="alert alert-error">{err}</div>}
      {ok  && <div className="alert alert-success">{ok}</div>}

      <div style={{
        background: 'var(--paper-pure)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        overflow: 'hidden'
      }}>
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>שלב</th>
              <th>קבוצה</th>
              <th>מארחת</th>
              <th>תוצאה</th>
              <th>אורחת</th>
              <th>מועד</th>
              <th>פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => {
              const e = editing[m.id] || {};
              const h = e.home ?? (m.home_score ?? '');
              const a = e.away ?? (m.away_score ?? '');
              return (
                <tr key={m.id}>
                  <td style={{ color: 'var(--muted)' }}>{m.id}</td>
                  <td><span className="deadline-badge" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>{stageLabel(m.stage, 'he')}</span></td>
                  <td style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--crimson)' }}>{m.group_letter || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <span>{m.home_name || m.home_label_he || m.home_label_en || m.home_code || '—'}</span>
                      <Flag code={m.home_code || ''} alt={m.home_name || m.home_label_he || m.home_label_en || m.home_code} size="sm" />
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                      <input
                        type="number"
                        min="0"
                        max="99"
                        className="score-input"
                        style={{ width: 50, height: 36, fontSize: 18 }}
                        value={h}
                        onChange={ev => setVal(m.id, 'home', ev.target.value)}
                      />
                      <span style={{ color: 'var(--muted)' }}>:</span>
                      <input
                        type="number"
                        min="0"
                        max="99"
                        className="score-input"
                        style={{ width: 50, height: 36, fontSize: 18 }}
                        value={a}
                        onChange={ev => setVal(m.id, 'away', ev.target.value)}
                      />
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Flag code={m.away_code || ''} alt={m.away_name || m.away_label_he || m.away_label_en || m.away_code} size="sm" />
                      <span>{m.away_name || m.away_label_he || m.away_label_en || m.away_code || '—'}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {ilDateTime(m.kickoff, 'he-IL', {
                      day: '2-digit', month: '2-digit',
                      hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-outline" onClick={() => setRandomTestScore(m)}>בדיקה</button>
                      <button className="btn btn-sm btn-pitch" onClick={() => save(m)}>שמור</button>
                      {m.status === 'finished' && (
                        <button className="btn btn-sm btn-outline" onClick={() => clear(m)}>אפס</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--muted)', padding: 40 }}>
          אין משחקים בקטגוריה זו
        </p>
      )}
    </div>
  );
}

/* ─────────────── ניחושים חסרים (ייצוא לתזכורת) ─────────────── */
function MissingGuessesTab() {
  const [missingGames, setMissingGames] = useState(5);
  const [exporting, setExporting] = useState(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waActBusy, setWaActBusy] = useState(false);
  const [err, setErr] = useState('');

  // תיבה שנייה: לפי מחלקה + טווח כמות ניחושים שהוזנו
  const [departments, setDepartments] = useState([]);
  const [actDept, setActDept] = useState('all');
  const [actMin, setActMin] = useState('');
  const [actMax, setActMax] = useState('');
  const [actPct, setActPct] = useState('');
  const [exportingAct, setExportingAct] = useState(null);

  useEffect(() => {
    api.get('/admin/departments')
      .then((res) => setDepartments(res.data.departments || []))
      .catch(() => setDepartments([]));
  }, []);

  const downloadBlob = (data, format, baseName) => {
    const blob = new Blob([data], {
      type: format === 'csv'
        ? 'text/csv;charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.${format === 'csv' ? 'csv' : 'xlsx'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportMissing = async (format) => {
    setExporting(format);
    setErr('');
    try {
      const { data } = await api.get(
        `/admin/users/export-missing?format=${format}&games=${missingGames}`,
        { responseType: 'blob' }
      );
      downloadBlob(data, format, `missing-guesses-${missingGames}games`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setExporting(null);
    }
  };

  // יוצר קובץ XLS ציבורי לכל תיבת ייצוא וקופץ ל-TmpSender לשליחת וואטסאפ (תבנית mon2026_high_scores)
  const sendWhatsapp = async (linkPath, setBusy) => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(linkPath);
      const url = 'https://tmpsender.seach.co.il/?xls=' + encodeURIComponent(data.url)
        + '&template=' + encodeURIComponent('mon2026_high_scores');
      window.open(url, '_blank');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // פרמטרי הסינון של תיבת "לפי מחלקה וכמות ניחושים" (משותף לייצוא ולוואטסאפ)
  const activityQuery = () => {
    const params = new URLSearchParams({ department: actDept });
    if (actMin !== '') params.set('min', actMin);
    if (actMax !== '') params.set('max', actMax);
    if (actPct !== '') params.set('min_correct_pct', actPct);
    return params.toString();
  };

  const exportActivity = async (format) => {
    setExportingAct(format);
    setErr('');
    try {
      const { data } = await api.get(
        `/admin/users/export-by-activity?format=${format}&${activityQuery()}`,
        { responseType: 'blob' }
      );
      downloadBlob(data, format, `users-by-guesses`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setExportingAct(null);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      {err && <div className="alert alert-error">{err}</div>}

      <SettingsCard title="ייצוא: לא ניחשו למשחקים הקרובים">
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          קובץ Excel עם שם וטלפון של כל המשתמשים שחסר להם לפחות 40% מהניחושים
          במשחקים הקרובים (לתזכורת).
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>מספר משחקים קרובים</label>
            <input
              type="number"
              min={1}
              max={20}
              value={missingGames}
              onChange={(e) => setMissingGames(Math.min(Math.max(parseInt(e.target.value, 10) || 1, 1), 20))}
            />
          </div>
          <button
            className="btn btn-sm btn-gold"
            onClick={() => exportMissing('xlsx')}
            disabled={exporting !== null}
          >
            {exporting === 'xlsx' ? 'מייצא...' : 'ייצוא XLSX'}
          </button>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => exportMissing('csv')}
            disabled={exporting !== null}
          >
            {exporting === 'csv' ? 'מייצא...' : 'ייצוא CSV'}
          </button>
          <button
            className="btn btn-sm"
            style={{ background: '#25D366', color: '#fff', borderColor: '#25D366' }}
            onClick={() => sendWhatsapp(`/admin/users/export-missing-link?games=${missingGames}`, setWaBusy)}
            disabled={waBusy}
          >
            {waBusy ? 'פותח...' : 'שלח ב-WhatsApp'}
          </button>
        </div>
      </SettingsCard>

      <SettingsCard title="ייצוא: לפי מחלקה וכמות ניחושים">
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          קובץ Excel (כולל נקודות ומיקום) של משתמשים ממחלקה נבחרת, לפי כמות הניחושים
          שהוזנו (יותר מ-X, פחות מ-Y) ולפי אחוז הניחושים הנכונים מבין המשחקים ששוחקו
          (יותר מ-X%). השאר ריק כדי לא להגביל.
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ minWidth: 180 }}>
            <label>מחלקה</label>
            <select value={actDept} onChange={(e) => setActDept(e.target.value)}>
              <option value="all">כל המחלקות</option>
              {departments.map((dep) => (
                <option key={dep} value={dep}>{dep}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>יותר מ- (X)</label>
            <input
              type="number"
              min={0}
              value={actMin}
              placeholder="ללא"
              onChange={(e) => setActMin(e.target.value)}
            />
          </div>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>פחות מ- (Y)</label>
            <input
              type="number"
              min={0}
              value={actMax}
              placeholder="ללא"
              onChange={(e) => setActMax(e.target.value)}
            />
          </div>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>יותר מ- (X%) נכונים</label>
            <input
              type="number"
              min={0}
              max={100}
              value={actPct}
              placeholder="ללא"
              onChange={(e) => setActPct(e.target.value)}
            />
          </div>
          <button
            className="btn btn-sm btn-gold"
            onClick={() => exportActivity('xlsx')}
            disabled={exportingAct !== null}
          >
            {exportingAct === 'xlsx' ? 'מייצא...' : 'ייצוא XLSX'}
          </button>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => exportActivity('csv')}
            disabled={exportingAct !== null}
          >
            {exportingAct === 'csv' ? 'מייצא...' : 'ייצוא CSV'}
          </button>
          <button
            className="btn btn-sm"
            style={{ background: '#25D366', color: '#fff', borderColor: '#25D366' }}
            onClick={() => sendWhatsapp(`/admin/users/export-by-activity-link?${activityQuery()}`, setWaActBusy)}
            disabled={waActBusy}
          >
            {waActBusy ? 'פותח...' : 'שלח ב-WhatsApp'}
          </button>
        </div>
      </SettingsCard>
    </div>
  );
}

/* ─────────────── הגדרות ─────────────── */
function SettingsTab() {
  const [settings, setSettings] = useState({});
  const [draft, setDraft]       = useState({});
  const [footerDocs, setFooterDocs] = useState([]);
  const [footerDrafts, setFooterDrafts] = useState({});
  const [specialPopups, setSpecialPopups] = useState([]);
  const [savingDocKey, setSavingDocKey] = useState(null);
  const [savingPopupId, setSavingPopupId] = useState(null);
  const [deletingPopupId, setDeletingPopupId] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk]   = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/admin/settings'),
      api.get('/admin/footer-docs'),
      api.get('/admin/special-popups')
    ])
      .then(([settingsRes, footerRes, popupsRes]) => {
        setSettings(settingsRes.data);
        setDraft(settingsRes.data);
        const docs = footerRes.data.docs || [];
        setFooterDocs(docs);
        setFooterDrafts(Object.fromEntries(docs.map((doc) => [doc.doc_key, {
          label: doc.label || '',
          file: null,
          file_url: doc.file_url || '',
          file_name: doc.file_name || '',
          file_type: doc.file_type || 'pdf'
        }])));
        setSpecialPopups((popupsRes.data?.items || []).map((item) => ({
          ...item,
          image_file: null,
          _local: false
        })));
      })
      .catch(e => setErr(errMsg(e)));
  }, []);

  const upd = (k, v) => setDraft(s => ({ ...s, [k]: v }));

  const save = async () => {
    setErr(''); setOk('');
    try {
      await api.post('/admin/settings', draft);
      setSettings(draft);
      setOk('ההגדרות נשמרו בהצלחה');
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  const saveFooterDoc = async (docKey) => {
    const draftDoc = footerDrafts[docKey];
    if (!draftDoc) return;
    setSavingDocKey(docKey);
    setErr('');
    setOk('');
    try {
      const form = new FormData();
      form.append('label', draftDoc.label);
      if (draftDoc.file) form.append('file', draftDoc.file);
      const { data } = await api.post(`/admin/footer-docs/${docKey}`, form);
      const nextDoc = data.doc;
      setFooterDocs((prev) => prev.map((item) => item.doc_key === docKey ? nextDoc : item));
      setFooterDrafts((prev) => ({
        ...prev,
        [docKey]: {
          label: nextDoc.label || '',
          file: null,
          file_url: nextDoc.file_url || '',
          file_name: nextDoc.file_name || '',
          file_type: nextDoc.file_type || 'pdf'
        }
      }));
      setOk(`מסמך "${nextDoc.label}" נשמר`);
      // רענון מיידי של הפוטר הגלובלי כדי שהקישור יפתח את הקובץ החדש
      window.dispatchEvent(new Event('footer-docs-updated'));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSavingDocKey(null);
    }
  };

  const updPopup = (id, key, value) => {
    setSpecialPopups((items) => items.map((item) => item.id === id ? { ...item, [key]: value } : item));
  };

  const addPopup = () => {
    const ts = Date.now();
    setSpecialPopups((items) => [
      ...items,
      {
        id: `special-popup-${ts}`,
        title: '',
        image_url: '',
        image_file: null,
        start_at: '',
        end_at: '',
        enabled: true,
        sort_order: items.length * 10 + 10,
        _local: true
      }
    ]);
  };

  const savePopup = async (popup) => {
    setSavingPopupId(popup.id);
    setErr('');
    setOk('');
    try {
      const form = new FormData();
      form.append('id', popup.id);
      form.append('title', popup.title || '');
      form.append('start_at', popup.start_at || '');
      form.append('end_at', popup.end_at || '');
      form.append('enabled', popup.enabled ? '1' : '0');
      form.append('sort_order', String(popup.sort_order ?? 0));
      if (popup.image_file) form.append('image', popup.image_file);
      const { data } = await api.post('/admin/special-popups', form);
      setSpecialPopups((items) => (data.items || []).map((item) => ({
        ...item,
        image_file: null,
        _local: false
      })));
      setOk(`פופאפ "${data.item?.title || data.item?.id}" נשמר`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSavingPopupId(null);
    }
  };

  const deletePopup = async (popupId) => {
    const popup = specialPopups.find((item) => item.id === popupId);
    if (popup?._local) {
      setSpecialPopups((items) => items.filter((item) => item.id !== popupId));
      return;
    }
    setDeletingPopupId(popupId);
    setErr('');
    setOk('');
    try {
      const { data } = await api.delete(`/admin/special-popups/${popupId}`);
      setSpecialPopups((data.items || []).map((item) => ({
        ...item,
        image_file: null,
        _local: false
      })));
      setOk('הפופאפ נמחק');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setDeletingPopupId(null);
    }
  };

  const dirty = JSON.stringify(settings) !== JSON.stringify(draft);
  const sendResultsEnabled = ['1', 'true', 'on', 'yes'].includes(String(draft.send_results_to_users || '').toLowerCase());

  return (
    <div style={{ maxWidth: 720 }}>
      {err && <div className="alert alert-error">{err}</div>}
      {ok  && <div className="alert alert-success">{ok}</div>}

      <SettingsCard title="מערכת שיחים (שיח-מרקט)">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={draft.coins_system_enabled === undefined ? true : ['1', 'true', 'on', 'yes'].includes(String(draft.coins_system_enabled).toLowerCase())}
            onChange={(e) => upd('coins_system_enabled', e.target.checked ? '1' : '0')}
          />
          <span>הפעל מערכת שיחים</span>
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
          כשמכובה — כל מערכת השיחים (ניחושי שיח-מרקט, הימורים, ארנק, טבלת מצטיינים,
          לשונית השיחים בתפריט ופאנל "ההימורים שלי" בפרופיל) תוסתר ותושבת לחלוטין באתר.
        </p>
      </SettingsCard>

      <SettingsCard title="אתר שומר שבת">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={draft.shabbat_mode === undefined ? true : ['1', 'true', 'on', 'yes'].includes(String(draft.shabbat_mode).toLowerCase())}
            onChange={(e) => upd('shabbat_mode', e.target.checked ? '1' : '0')}
          />
          <span>חסום את האתר בשבת (לפי מיקום הגולש)</span>
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
          כשמופעל — בכניסת השבת מוצג לגולשים מסך "שבת שלום" עד צאת השבת, לפי זמני
          הכניסה/יציאה במיקום הגולש (אזור-הזמן בדפדפן). מנהלים פטורים מהחסימה.
        </p>
      </SettingsCard>

      <SettingsCard title="ניקוד">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <NumField label="ניחוש מדויק" value={draft.scoring_exact}     onChange={v => upd('scoring_exact', v)} />
          <NumField label="כיוון נכון (1/X/2)" value={draft.scoring_result} onChange={v => upd('scoring_result', v)} />
          <NumField label="הפרש שערים נכון (תוספת)" value={draft.scoring_goal_diff} onChange={v => upd('scoring_goal_diff', v)} />
          <NumField label="בונוס לאלופה" value={draft.scoring_champion} onChange={v => upd('scoring_champion', v)} />
          <NumField label="בונוס לסגן האלופה" value={draft.scoring_runner_up} onChange={v => upd('scoring_runner_up', v)} />
          <NumField label="בונוס למלך השערים" value={draft.scoring_top_scorer} onChange={v => upd('scoring_top_scorer', v)} />
        </div>
      </SettingsCard>

      <SettingsCard title="ניחוש קבוצתי">
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          גבולות מערכת הניחוש הקבוצתי. שינוי המכפיל המקסימלי ישפיע על חישובים חדשים (הרץ "חישוב מחדש" לעדכון רטרואקטיבי).
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={String(draft.site_guess_groups_enabled ?? 'false') === 'true'}
            onChange={e => upd('site_guess_groups_enabled', e.target.checked ? 'true' : 'false')}
          />
          הפעל ניחוש קבוצתי ברמת האתר
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <NumField label="מקס׳ קבוצות לכל משתמש" value={draft.group_max_per_user ?? 8} onChange={v => upd('group_max_per_user', v)} />
          <NumField label="מקס׳ חברים בקבוצה" value={draft.group_max_members ?? 5} onChange={v => upd('group_max_members', v)} />
          <NumField label="דמי כניסה מקסימליים (נק׳)" value={draft.group_entry_cost_max ?? 5} onChange={v => upd('group_entry_cost_max', v)} />
          <NumField label="מכפיל מקסימלי (×)" value={draft.group_multiplier_cap ?? 5} onChange={v => upd('group_multiplier_cap', v)} />
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
          כשהאפשרות כבויה, קישור הניחוש הקבוצתי מוסתר מכל המשתמשים וגם ה-API נחסם.
        </div>
      </SettingsCard>

      <SettingsCard title="נעילת ניחושים">
        <div className="field" style={{ maxWidth: 280 }}>
          <label>שעות לפני פתיחת המשחק</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={draft.lock_hours_before ?? ''}
            onChange={e => upd('lock_hours_before', e.target.value)}
          />
          <small style={{ color: 'var(--muted)' }}>
            לאחר זמן זה לפני פתיחת המשחק - הניחוש ננעל
          </small>
        </div>
      </SettingsCard>

      <SettingsCard title="תוצאות סופיות (לחישוב בונוסים)">
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          הזן את הקוד הבינלאומי של האלופה/סגן האלופה (לדוגמה: <strong>ar</strong> לארגנטינה, <strong>br</strong> לברזיל),
          ואת שם השחקן המלך. לאחר השמירה, יש להריץ "חישוב מחדש" בלשונית פעולות.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div className="field">
            <label>קוד האלופה</label>
            <input
              type="text"
              placeholder="לדוגמה: ar"
              value={draft.real_champion ?? ''}
              onChange={e => upd('real_champion', e.target.value.toLowerCase())}
            />
          </div>
          <div className="field">
            <label>קוד סגן האלופה</label>
            <input
              type="text"
              placeholder="לדוגמה: fr"
              value={draft.real_runner_up ?? ''}
              onChange={e => upd('real_runner_up', e.target.value.toLowerCase())}
            />
          </div>
          <div className="field">
            <label>שם מלך השערים</label>
            <input
              type="text"
              placeholder="לדוגמה: Mbappé"
              value={draft.real_top_scorer ?? ''}
              onChange={e => upd('real_top_scorer', e.target.value)}
            />
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="מקור עדכון תוצאות">
        <div className="field" style={{ maxWidth: 360 }}>
          <label>מצב סקרייפר</label>
          <select
            value={draft.scraper_mode ?? 'manual'}
            onChange={e => upd('scraper_mode', e.target.value)}
          >
            <option value="manual">ידני (ללא עדכון אוטומטי)</option>
            <option value="espn">ESPN (סקרייפינג HTML)</option>
            <option value="api-football">API-Football (דורש מפתח ב-.env)</option>
          </select>
          <small style={{ color: 'var(--muted)' }}>
            מצב ידני: יש להזין תוצאות באופן ידני בלשונית "משחקים".
            <br />api-football מומלץ לאמינות מרבית; דורש מפתח חינמי בכתובת dashboard.api-football.com
          </small>
        </div>
      </SettingsCard>

      <SettingsCard title="SMTP / שליחת אימיילים">
        <div className="admin-form-grid">
          <div className="field">
            <label>ספק שליחה למשתמשים</label>
            <select
              value={draft.email_user_delivery_mode ?? 'smtp'}
              onChange={e => upd('email_user_delivery_mode', e.target.value)}
            >
              <option value="smtp">SMTP של הספק (seach.co.il)</option>
              <option value="gmail">חשבון Gmail (סיסמת אפליקציה)</option>
            </select>
          </div>
          <div className="field">
            <label>שרת SMTP</label>
            <input
              type="text"
              value={draft.smtp_server ?? ''}
              onChange={e => upd('smtp_server', e.target.value)}
              placeholder="smtp.inbox.co.il"
            />
          </div>
          <div className="field">
            <label>פורט SMTP</label>
            <input
              type="number"
              value={draft.smtp_port ?? '587'}
              onChange={e => upd('smtp_port', e.target.value)}
              placeholder="587"
            />
          </div>
          <div className="field">
            <label>אבטחה</label>
            <select
              value={draft.smtp_security ?? 'STARTTLS'}
              onChange={e => upd('smtp_security', e.target.value)}
            >
              <option value="STARTTLS">STARTTLS</option>
              <option value="SSL">SSL</option>
              <option value="NONE">ללא</option>
            </select>
          </div>
          <div className="field">
            <label>משתמש/כתובת שולחת</label>
            <input
              type="text"
              value={draft.smtp_user ?? ''}
              onChange={e => upd('smtp_user', e.target.value)}
              placeholder="mon2026@reports.seach.co.il"
            />
          </div>
          <div className="field">
            <label>סיסמת SMTP</label>
            <input
              type="text"
              value={draft.smtp_password ?? ''}
              onChange={e => upd('smtp_password', e.target.value)}
              placeholder="********"
            />
          </div>
          <div className="field">
            <label>מנהלת שליחות</label>
            <input
              type="email"
              value={draft.smtp_manager_email ?? ''}
              onChange={e => upd('smtp_manager_email', e.target.value)}
              placeholder="aviva@seach.co.il"
            />
          </div>
          <div className="field">
            <label>כתובת האתר</label>
            <input
              type="text"
              value={draft.site_url ?? ''}
              onChange={e => upd('site_url', e.target.value)}
              placeholder="https://mon2026.seach.co.il"
            />
          </div>
        </div>
        <div className="admin-form-grid" style={{ marginTop: 16 }}>
          <div className="field">
            <label>כתובת Gmail שולחת</label>
            <input
              type="email"
              value={draft.gmail_app_user ?? ''}
              onChange={e => upd('gmail_app_user', e.target.value)}
              placeholder="example@gmail.com"
            />
          </div>
          <div className="field">
            <label>סיסמת אפליקציה של Gmail</label>
            <input
              type="text"
              value={draft.gmail_app_password ?? ''}
              onChange={e => upd('gmail_app_password', e.target.value)}
              placeholder="16 תווים (App Password)"
            />
          </div>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
          כשבוחרים "חשבון Gmail", הודעות למשתתפים יישלחו דרך smtp.gmail.com עם כתובת ה-Gmail וסיסמת האפליקציה
          (יש להפעיל אימות דו-שלבי בחשבון Google וליצור "סיסמת אפליקציה"). דוח המנהלת ימשיך לצאת דרך SMTP של seach.co.il.
        </div>
      </SettingsCard>

      <SettingsCard title="שליחת תוצאות למשתמשים">
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={sendResultsEnabled}
            onChange={(e) => upd('send_results_to_users', e.target.checked ? '1' : '0')}
          />
          <span>שלח דוח תוצאות יומי למשתמשים</span>
        </label>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8, marginBottom: 0 }}>
          אם הפעולה פעילה, השרת ישלח דוח יומי בשעה שנקבעה לפי שעון ישראל. ברירת המחדל היא 19:00.
        </p>
        {sendResultsEnabled && (
          <div className="admin-form-grid" style={{ marginTop: 16 }}>
            <NumField
              label="שעת שליחה (שעון ישראל)"
              value={draft.send_results_hour ?? 19}
              onChange={v => upd('send_results_hour', v)}
              min={0}
              max={23}
            />
            <div className="field">
              <label>למי לשלוח</label>
              <select
                value={draft.send_results_audience ?? 'all'}
                onChange={e => upd('send_results_audience', e.target.value)}
              >
                <option value="all">כל המשתמשים</option>
                <option value="guessers">כל מי שיש לו ניחושים</option>
                <option value="top10">10 המובילים</option>
              </select>
            </div>
          </div>
        )}
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
          אם "אתר שומר שבת" פעיל, שליחת האימיילים תיעצר בזמן שבת בישראל.
        </div>
      </SettingsCard>

      <SettingsCard title="מסמכי פוטר">
        <div style={{ display: 'grid', gap: 16 }}>
          {footerDocs.filter((doc) => doc.doc_key !== 'contact').map((doc) => {
            const docDraft = footerDrafts[doc.doc_key];
            if (!docDraft) return null;
            return (
              <div key={doc.doc_key} style={{ border: '1px solid var(--line)', padding: 16, borderRadius: 6 }}>
                <div className="admin-form-grid">
                  <div className="field">
                    <label>כותרת</label>
                    <input
                      type="text"
                      value={docDraft.label}
                      onChange={(e) => setFooterDrafts((s) => ({ ...s, [doc.doc_key]: { ...s[doc.doc_key], label: e.target.value } }))}
                    />
                  </div>
                  <div className="field">
                    <label>החלפת קובץ</label>
                    {docDraft.file_url ? (
                      <div style={{ fontSize: 13, marginBottom: 6 }}>
                        קובץ נוכחי:{' '}
                        <a href={docDraft.file_url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
                          {docDraft.file_url}
                        </a>
                        {docDraft.file_name && (
                          <span style={{ color: 'var(--muted)' }}> ({docDraft.file_name})</span>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, marginBottom: 6, color: 'var(--muted)' }}>
                        לא הוגדר קובץ לקישור זה עדיין
                      </div>
                    )}
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      onChange={(e) => setFooterDrafts((s) => ({ ...s, [doc.doc_key]: { ...s[doc.doc_key], file: e.target.files?.[0] || null } }))}
                    />
                  </div>
                </div>
                <button className="btn btn-sm btn-gold" onClick={() => saveFooterDoc(doc.doc_key)} disabled={savingDocKey === doc.doc_key}>
                  {savingDocKey === doc.doc_key ? 'שומר...' : 'שמור מסמך'}
                </button>
              </div>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="פופאפים מיוחדים">
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          כל פופאפ פעיל יוצג פעם אחת לכל משתמש בזמן טווח התאריכים שלו. כדי להציג שוב הודעה באותו עיצוב בתאריך אחר, יוצרים פופאפ נוסף עם טווח נפרד.
        </p>
        <div style={{ display: 'grid', gap: 16 }}>
          {specialPopups.map((popup) => (
            <div key={popup.id} style={{ border: '1px solid var(--line)', padding: 16, borderRadius: 6 }}>
              <div className="admin-form-grid">
                <div className="field">
                  <label>מזהה</label>
                  <input type="text" value={popup.id} disabled />
                </div>
                <div className="field">
                  <label>כותרת</label>
                  <input type="text" value={popup.title || ''} onChange={(e) => updPopup(popup.id, 'title', e.target.value)} />
                </div>
                <div className="field">
                  <label>מיון</label>
                  <input
                    type="number"
                    value={popup.sort_order ?? 0}
                    onChange={(e) => updPopup(popup.id, 'sort_order', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>מתאריך</label>
                  <input
                    type="datetime-local"
                    value={String(popup.start_at || '').slice(0, 16)}
                    onChange={(e) => updPopup(popup.id, 'start_at', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>עד תאריך</label>
                  <input
                    type="datetime-local"
                    value={String(popup.end_at || '').slice(0, 16)}
                    onChange={(e) => updPopup(popup.id, 'end_at', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 28 }}>
                    <input
                      type="checkbox"
                      checked={!!popup.enabled}
                      onChange={(e) => updPopup(popup.id, 'enabled', e.target.checked)}
                    />
                    <span>פעיל</span>
                  </label>
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>תמונה</label>
                  {popup.image_url ? (
                    <img src={popup.image_url} alt={popup.title || popup.id} className="schedule-admin-preview" />
                  ) : (
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 8 }}>אין תמונה כרגע</div>
                  )}
                  <input type="file" accept="image/*" onChange={(e) => updPopup(popup.id, 'image_file', e.target.files?.[0] || null)} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-sm btn-gold" onClick={() => savePopup(popup)} disabled={savingPopupId === popup.id}>
                  {savingPopupId === popup.id ? 'שומר...' : 'שמור פופאפ'}
                </button>
                <button className="btn btn-sm btn-outline" onClick={() => deletePopup(popup.id)} disabled={deletingPopupId === popup.id}>
                  {deletingPopupId === popup.id ? 'מוחק...' : 'מחק'}
                </button>
              </div>
            </div>
          ))}
        </div>
        <button className="btn btn-sm btn-outline" onClick={addPopup} style={{ marginTop: 16 }}>
          הוסף פופאפ
        </button>
      </SettingsCard>

      <button
        className="btn btn-gold"
        onClick={save}
        disabled={!dirty}
        style={{ marginTop: 16 }}
      >
        {dirty ? 'שמור שינויים' : 'אין שינויים'}
      </button>
    </div>
  );
}

/* ─────────────── צור קשר ─────────────── */
function ContactTab() {
  const [contactMessages, setContactMessages] = useState([]);
  const [contactActionId, setContactActionId] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk]   = useState('');

  const load = () => {
    setErr('');
    api.get('/admin/footer-docs')
      .then((res) => setContactMessages(res.data.contacts || []))
      .catch((e) => setErr(errMsg(e)));
  };
  useEffect(load, []);

  const markContactHandled = async (id) => {
    setContactActionId(id); setErr(''); setOk('');
    try {
      await api.post(`/admin/contact-messages/${id}/handle`);
      setContactMessages((prev) => prev.map((item) => item.id === id ? { ...item, handled_at: new Date().toISOString() } : item));
      setOk('הפנייה סומנה כטופלה');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setContactActionId(null);
    }
  };

  const deleteContact = async (id) => {
    if (!confirm('למחוק את הפנייה?')) return;
    setContactActionId(id); setErr(''); setOk('');
    try {
      await api.delete(`/admin/contact-messages/${id}`);
      setContactMessages((prev) => prev.filter((item) => item.id !== id));
      setOk('הפנייה נמחקה');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setContactActionId(null);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      {err && <div className="alert alert-error">{err}</div>}
      {ok  && <div className="alert alert-success">{ok}</div>}

      <SettingsCard title="צור קשר">
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          פניות שנשלחו מטופס "צור קשר" באתר (שם, טלפון, טקסט ותמונה). סמן כטופל או מחק.
        </p>
        <div style={{ display: 'grid', gap: 12 }}>
          {contactMessages.map((item) => (
            <div key={item.id} style={{ border: '1px solid var(--line)', padding: 16, borderRadius: 6, background: item.handled_at ? 'rgba(45,110,62,0.08)' : 'var(--paper-pure)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <strong>{item.name}</strong>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {ilDateTime(item.created_at, 'he-IL')}
                </span>
              </div>
              <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 6 }}>
                טלפון: {item.phone_number || '—'}
                {item.user_email ? ` | משתמש: ${item.user_email}` : ''}
                {item.handled_at ? ` | טופל` : ''}
              </div>
              <p style={{ marginBottom: 12 }}>{item.message}</p>
              {item.image_url && <img src={item.image_url} alt={item.name} className="schedule-admin-preview" />}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {!item.handled_at && (
                  <button className="btn btn-sm btn-pitch" onClick={() => markContactHandled(item.id)} disabled={contactActionId === item.id}>
                    {contactActionId === item.id ? 'מעדכן...' : 'טופל'}
                  </button>
                )}
                <button className="btn btn-sm btn-outline" onClick={() => deleteContact(item.id)} disabled={contactActionId === item.id}>
                  {contactActionId === item.id ? 'מוחק...' : 'מחק'}
                </button>
              </div>
            </div>
          ))}
          {contactMessages.length === 0 && (
            <div style={{ color: 'var(--muted)' }}>אין פניות עדיין.</div>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}

function SettingsCard({ title, children }) {
  return (
    <div style={{
      background: 'var(--paper-pure)',
      border: '1px solid var(--line)',
      borderRadius: 6,
      padding: 24,
      marginBottom: 16
    }}>
      <h3 style={{
        marginTop: 0,
        marginBottom: 16,
        fontFamily: 'var(--font-display)',
        fontSize: 22,
        letterSpacing: 1,
        color: 'var(--ink)',
        borderBottom: '2px solid var(--gold)',
        paddingBottom: 6,
        display: 'inline-block'
      }}>{title}</h3>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange, min, max, step = '1' }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

function BadgesTab() {
  const { t } = useTranslation();
  const [ids, setIds] = useState([]);
  const [coinIds, setCoinIds] = useState([]);
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get('/admin/badges')
      .then(r => { setIds(r.data.ids || []); setCoinIds(r.data.coin_badge_ids || []); setConfig(r.data.config); setSaved(JSON.stringify(r.data.config)); })
      .catch(e => setErr(errMsg(e)));
  };
  useEffect(() => { load(); }, []);

  if (!config) return <div style={{ color: 'var(--muted)' }}>{err || t('common.loading')}</div>;

  const updBadge = (id, key, value) =>
    setConfig(c => ({ ...c, badges: { ...c.badges, [id]: { ...c.badges[id], [key]: value } } }));
  const updThreshold = (key, value) =>
    setConfig(c => ({ ...c, thresholds: { ...c.thresholds, [key]: value } }));
  const updCoinBadge = (id, key, value) =>
    setConfig(c => ({ ...c, coin_badges: { ...c.coin_badges, [id]: { ...(c.coin_badges || {})[id], [key]: value } } }));
  const metricLabel = { rank: 'דירוג =', win_rate: 'אחוז ניצחון ≥', balance: 'יתרת שיחים ≥', bets_settled: 'ניחושים שיושבו ≥', bets_won: 'ניחושים שזכו ≥' };

  const save = async () => {
    setErr(''); setOk(''); setBusy(true);
    try {
      const { data } = await api.post('/admin/badges', config);
      setConfig(data.config); setSaved(JSON.stringify(data.config));
      setOk(t('admin.badges_saved'));
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const dirty = JSON.stringify(config) !== saved;

  return (
    <div style={{ maxWidth: 760 }}>
      {err && <div className="alert alert-error">{err}</div>}
      {ok && <div className="alert alert-success">{ok}</div>}

      <SettingsCard title={t('admin.tab_badges')}>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>{t('admin.badges_help')}</p>
        <div className="badge-admin-list">
          {ids.map(id => {
            const b = config.badges[id] || {};
            return (
              <div key={id} className={`badge-admin-row ${b.enabled ? '' : 'disabled'}`}>
                <span className="badge-admin-emoji-preview">{b.emoji}</span>
                <div className="badge-admin-meta">
                  <strong>{t(`badge.${id}.name`)}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{t(`badge.${id}.desc`)}</span>
                </div>
                <input
                  className="badge-admin-emoji-input"
                  value={b.emoji || ''}
                  onChange={e => updBadge(id, 'emoji', e.target.value)}
                  maxLength={8}
                  aria-label="emoji"
                />
                <label className="badge-admin-toggle">
                  <input
                    type="checkbox"
                    checked={!!b.enabled}
                    onChange={e => updBadge(id, 'enabled', e.target.checked)}
                  />
                  <span>{b.enabled ? t('admin.badge_on') : t('admin.badge_off')}</span>
                </label>
              </div>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard title={t('admin.badge_thresholds')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <NumField label={t('admin.badge_centurion_points')} value={config.thresholds.centurion_points}
            onChange={v => updThreshold('centurion_points', v)} />
          <NumField label={t('admin.badge_min_predictions')} value={config.thresholds.min_predictions}
            onChange={v => updThreshold('min_predictions', v)} />
          <NumField label={t('admin.badge_min_streak')} value={config.thresholds.min_streak}
            onChange={v => updThreshold('min_streak', v)} />
          <NumField label="מינימום נקודות לקבלת תגים" value={config.thresholds.min_points}
            onChange={v => updThreshold('min_points', v)} />
        </div>
      </SettingsCard>

      <SettingsCard title="תגי שיחים (10 הישגי מטבעות)">
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>אימוג'י, שם וסף לכל תג. התג מוענק אוטומטית בלוח מצטייני השיחים.</p>
        <div className="badge-admin-list">
          {coinIds.map(id => {
            const b = (config.coin_badges || {})[id] || {};
            return (
              <div key={id} className={`badge-admin-row ${b.enabled ? '' : 'disabled'}`}>
                <span className="badge-admin-emoji-preview">{b.emoji}</span>
                <input className="badge-admin-emoji-input" value={b.emoji || ''} maxLength={8}
                  onChange={e => updCoinBadge(id, 'emoji', e.target.value)} aria-label="emoji" />
                <input style={{ flex: 1, minWidth: 100 }} value={b.label || ''}
                  onChange={e => updCoinBadge(id, 'label', e.target.value)} aria-label="label" />
                <span style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{metricLabel[b.metric] || b.metric}</span>
                <input type="number" min="0" style={{ width: 90 }} value={b.threshold ?? 0}
                  onChange={e => updCoinBadge(id, 'threshold', Number(e.target.value))} aria-label="threshold" />
                <label className="badge-admin-toggle">
                  <input type="checkbox" checked={!!b.enabled} onChange={e => updCoinBadge(id, 'enabled', e.target.checked)} />
                  <span>{b.enabled ? t('admin.badge_on') : t('admin.badge_off')}</span>
                </label>
              </div>
            );
          })}
        </div>
      </SettingsCard>

      <button className="btn btn-pitch" onClick={save} disabled={busy || !dirty}>
        {busy ? t('common.saving') : t('common.save_all')}
      </button>
    </div>
  );
}

function MessagesTab() {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [draft, setDraft] = useState({
    subject: '',
    body: '',
    department: '',
    include_login_details: true,
    attachments: []
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [resultsBusy, setResultsBusy] = useState(false);
  const [resultsPreviewUrl, setResultsPreviewUrl] = useState('');
  const [resultsPreviewBusy, setResultsPreviewBusy] = useState(false);
  const [resultsPreviewErr, setResultsPreviewErr] = useState('');

  useEffect(() => {
    let alive = true;
    let currentUrl = '';

    const loadPreview = async () => {
      setResultsPreviewBusy(true);
      setResultsPreviewErr('');
      try {
        const { data } = await api.get('/admin/user-results/preview', { responseType: 'blob' });
        currentUrl = URL.createObjectURL(data);
        if (alive) {
          setResultsPreviewUrl(currentUrl);
        } else {
          URL.revokeObjectURL(currentUrl);
        }
      } catch (e) {
        if (alive) {
          setResultsPreviewErr(errMsg(e));
        }
      } finally {
        if (alive) setResultsPreviewBusy(false);
      }
    };

    loadPreview();

    return () => {
      alive = false;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, []);

  const sendLeaderboardReport = async () => {
    setReportBusy(true); setErr(''); setOk('');
    try {
      const { data } = await api.post('/admin/leaderboard-report/send');
      setOk(`דוח טבלת המצטיינים נשלח אל ${data.to} (${data.count} משתתפים)`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setReportBusy(false);
    }
  };

  const sendUserResultsReport = async () => {
    setResultsBusy(true); setErr(''); setOk('');
    try {
      const { data } = await api.post('/admin/user-results/send');
      if (data?.skipped) {
        setOk(`שליחת תוצאות למשתמשים דולגה (${data.skipped})`);
      } else {
        setOk(`נשלחו ${data.sent} דוחות למשתמשים (${data.failed} נכשלו)`);
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setResultsBusy(false);
    }
  };

  const refreshResultsPreview = async () => {
    setResultsPreviewBusy(true);
    setResultsPreviewErr('');
    try {
      const { data } = await api.get('/admin/user-results/preview', { responseType: 'blob' });
      const nextUrl = URL.createObjectURL(data);
      setResultsPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    } catch (e) {
      setResultsPreviewErr(errMsg(e));
    } finally {
      setResultsPreviewBusy(false);
    }
  };

  useEffect(() => {
    Promise.all([
      api.get('/admin/users'),
      api.get('/admin/departments')
    ])
      .then(([usersRes, depRes]) => {
        const nextUsers = (usersRes.data || []).filter((u) => !u.is_admin);
        setUsers(nextUsers);
        setDepartments(depRes.data?.departments || []);
      })
      .catch((e) => setErr(errMsg(e)));
  }, []);

  const visibleUsers = users.filter((user) => {
    if (draft.department && user.department !== draft.department) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return String(user.name || '').toLowerCase().includes(q)
      || String(user.email || '').toLowerCase().includes(q)
      || String(user.department || '').toLowerCase().includes(q);
  });

  const finalRecipients = users
    .filter((user) => {
      if (draft.department && user.department !== draft.department) return false;
      if (selectedIds.length) return selectedIds.includes(user.id);
      return !!draft.department;
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'));

  const toggleUser = (id) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const selectAllVisible = () => {
    setSelectedIds(Array.from(new Set([...selectedIds, ...visibleUsers.map((u) => u.id)])));
  };

  const clearVisible = () => {
    const visibleSet = new Set(visibleUsers.map((u) => u.id));
    setSelectedIds((prev) => prev.filter((id) => !visibleSet.has(id)));
  };

  const selectDepartment = () => {
    if (!draft.department) return;
    const ids = users.filter((u) => u.department === draft.department).map((u) => u.id);
    setSelectedIds(Array.from(new Set([...selectedIds, ...ids])));
  };

  const sendEmails = async () => {
    if (!draft.subject.trim() || !draft.body.trim()) {
      setErr('יש להזין כותרת ותוכן הודעה');
      return;
    }
    if (!selectedIds.length && !draft.department) {
      setErr('יש לבחור לפחות נמען אחד, או לבחור מחלקה');
      return;
    }
    if (!confirm('לשלוח את האימייל לנמענים שנבחרו?')) return;

    setBusy(true);
    setErr('');
    setOk('');
    try {
      const form = new FormData();
      form.append('subject', draft.subject);
      form.append('body', draft.body);
      form.append('department', draft.department || '');
      form.append('include_login_details', draft.include_login_details ? '1' : '0');
      form.append('recipient_ids', JSON.stringify(selectedIds));
      Array.from(draft.attachments || []).forEach((file) => form.append('attachments', file));

      const { data } = await api.post('/admin/send-emails', form);
      const msg = data.failed
        ? `נשלחו ${data.sent} אימיילים, ${data.failed} נכשלו. קמפיין #${data.campaign_id}`
        : `נשלחו ${data.sent} אימיילים בהצלחה. קמפיין #${data.campaign_id}`;
      setOk(msg);
      setDraft({
        subject: '',
        body: '',
        department: '',
        include_login_details: true,
        attachments: []
      });
      setSelectedIds([]);
      setSearch('');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 1120 }}>
      {err && <div className="alert alert-error">{err}</div>}
      {ok && <div className="alert alert-success">{ok}</div>}

      <SettingsCard title="דוח יומי — טבלת המצטיינים">
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          מדי יום ב-06:00 (שעון ישראל) נשלחת אוטומטית תמונת טבלת המצטיינים אל "מנהלת שליחות"
          (כתובת המנהל/ת בהגדרות SMTP). ניתן לשלוח דוגמה עכשיו:
        </p>
        <button className="btn btn-sm btn-gold" onClick={sendLeaderboardReport} disabled={reportBusy}>
          {reportBusy ? 'שולח...' : 'שלח דוח לדוגמה עכשיו'}
        </button>
      </SettingsCard>

      <SettingsCard title="שליחת תוצאות למשתמשים">
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
          שולח ידנית את דוח תוצאות המשתמשים לפי ההגדרות הנוכחיות, כולל שעת השליחה וקהל היעד.
        </p>
        <div style={{
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: 14,
          marginBottom: 14,
          background: 'rgba(255,255,255,0.6)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <strong>תצוגה מקדימה של התמונה שתישלח</strong>
            <button className="btn btn-sm btn-outline" onClick={refreshResultsPreview} disabled={resultsPreviewBusy}>
              {resultsPreviewBusy ? 'מרענן...' : 'רענן דוגמה'}
            </button>
          </div>
          {resultsPreviewErr && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>{resultsPreviewErr}</div>
          )}
          {resultsPreviewUrl ? (
            <img
              src={resultsPreviewUrl}
              alt="תצוגה מקדימה של דוח תוצאות למשתמשים"
              className="schedule-admin-preview"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {resultsPreviewBusy ? 'טוען תצוגה מקדימה...' : 'אין תצוגה מקדימה זמינה כרגע'}
            </div>
          )}
        </div>
        <button className="btn btn-sm btn-gold" onClick={sendUserResultsReport} disabled={resultsBusy}>
          {resultsBusy ? 'שולח...' : 'שלח תוצאות עכשיו'}
        </button>
      </SettingsCard>

      <SettingsCard title="הודעת אימייל">
        <div className="field" style={{ marginBottom: 16 }}>
          <label>To:</label>
          <div style={{
            minHeight: 52,
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: 10,
            background: 'rgba(255,255,255,0.65)',
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            alignItems: 'center'
          }}>
            {finalRecipients.length > 0 ? finalRecipients.map((user) => (
              <span key={user.id} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 999,
                background: 'rgba(45,110,62,0.10)',
                border: '1px solid rgba(45,110,62,0.18)',
                fontSize: 13
              }}>
                <strong>{user.name}</strong>
                <span style={{ color: 'var(--muted)' }}>{user.email}</span>
              </span>
            )) : (
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>טרם נבחרו נמענים</span>
            )}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 6 }}>
            יוצגו כאן כל הנמענים שיקבלו בפועל את ההודעה לפי הבחירה הנוכחית.
          </div>
        </div>

        <div className="admin-form-grid">
          <div className="field">
            <label>כותרת</label>
            <input
              type="text"
              value={draft.subject}
              onChange={(e) => setDraft((s) => ({ ...s, subject: e.target.value }))}
              placeholder="כותרת ההודעה"
            />
          </div>
          <div className="field">
            <label>מחלקה</label>
            <select
              value={draft.department}
              onChange={(e) => setDraft((s) => ({ ...s, department: e.target.value }))}
            >
              <option value="">כל המחלקות</option>
              {departments.map((dep) => (
                <option key={dep} value={dep}>{dep}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label>גוף ההודעה</label>
          <textarea
            rows="8"
            value={draft.body}
            onChange={(e) => setDraft((s) => ({ ...s, body: e.target.value }))}
            placeholder="תוכן האימייל"
          />
        </div>

        <div className="field">
          <label>תמונות / קבצים מצורפים</label>
          <input
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setDraft((s) => ({ ...s, attachments: Array.from(e.target.files || []) }))}
          />
          {draft.attachments.length > 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
              {draft.attachments.map((file) => file.name).join(' | ')}
            </div>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={draft.include_login_details}
            onChange={(e) => setDraft((s) => ({ ...s, include_login_details: e.target.checked }))}
          />
          הוסף פרטי התחברות
        </label>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
          אם מסומן, כל נמען יקבל גם את כתובת האתר, שם המשתמש שלו והסיסמה לפי מספר הטלפון שמוגדר באתר.
        </div>
      </SettingsCard>

      <SettingsCard title="בחירת נמענים">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            style={{ flex: '1 1 260px', minWidth: 220 }}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם / אימייל / מחלקה"
          />
          <button className="btn btn-outline" type="button" onClick={selectAllVisible}>בחר הכל</button>
          <button className="btn btn-outline" type="button" onClick={clearVisible}>נקה בחירה</button>
          <button className="btn btn-pitch" type="button" onClick={selectDepartment} disabled={!draft.department}>בחר לפי מחלקה</button>
        </div>

        <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
          יישלח ל-{finalRecipients.length} משתמשים
        </div>

        <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflow: 'auto' }}>
          {visibleUsers.map((user) => (
            <label key={user.id} style={{
              display: 'grid',
              gridTemplateColumns: '24px 1fr',
              gap: 12,
              alignItems: 'start',
              padding: 12,
              border: '1px solid var(--line)',
              borderRadius: 6,
              background: selectedIds.includes(user.id) ? 'rgba(45,110,62,0.08)' : 'var(--paper-pure)'
            }}>
              <input
                type="checkbox"
                checked={selectedIds.includes(user.id)}
                onChange={() => toggleUser(user.id)}
              />
              <div>
                <div style={{ fontWeight: 700 }}>{user.name}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {user.email} | {user.phone_number || 'אין טלפון'} | {user.department || 'ללא מחלקה'}
                </div>
              </div>
            </label>
          ))}
          {visibleUsers.length === 0 && (
            <div style={{ color: 'var(--muted)' }}>אין משתמשים להצגה</div>
          )}
        </div>

        <div style={{ marginTop: 18 }}>
          <button className="btn btn-gold" type="button" onClick={sendEmails} disabled={busy}>
            {busy ? 'שולח...' : 'שלח אימייל לנמענים'}
          </button>
        </div>
      </SettingsCard>
    </div>
  );
}

/* ─────────────── מקור נתונים ─────────────── */
function DataSourceTab() {
  const DEFAULT_HINT = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719';
  const [mode, setMode] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [draftUrl, setDraftUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const load = () => {
    api.get('/admin/settings')
      .then(r => {
        setSourceUrl((r.data?.espn_scoreboard_url || '').trim());
        setMode(r.data?.scraper_mode || 'manual');
      })
      .catch(e => setErr(errMsg(e)));
  };
  useEffect(load, []);

  const isValid = (u) => /^https?:\/\//i.test(u.trim()) && /espn\.com/i.test(u.trim());

  const openModal = () => {
    setErr(''); setOk('');
    setDraftUrl(sourceUrl);
    setModalOpen(true);
  };

  const saveUrl = async () => {
    const clean = draftUrl.trim();
    if (clean && !isValid(clean)) {
      setErr('כתובת לא תקינה — חייבת להתחיל ב-http(s) ולכלול espn.com (השאר ריק לברירת המחדל מהקוד)');
      return;
    }
    setSaving(true);
    setErr(''); setOk('');
    try {
      await api.post('/admin/settings', { espn_scoreboard_url: clean });
      setSourceUrl(clean);
      setModalOpen(false);
      setOk('מקור הנתונים נשמר');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const testNow = async () => {
    setTesting(true);
    setErr(''); setOk('');
    try {
      const r = await api.post('/admin/scrape-now');
      const d = r.data || {};
      const count = d.updated ?? d.matched ?? d.events ?? d.scanned;
      setOk('הסקרייפר רץ בהצלחה' + (count != null ? ` — ${count} משחקים עודכנו` : ''));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      {err && <div className="alert alert-error" style={{ wordBreak: 'break-all' }}>{err}</div>}
      {ok  && <div className="alert alert-success" style={{ wordBreak: 'break-all' }}>{ok}</div>}

      <div style={{
        background: 'var(--paper-pure)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        padding: 24,
        marginBottom: 16
      }}>
        <h3 style={{ marginTop: 0, marginBottom: 8, fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--ink)' }}>
          מקור נתונים — ESPN
        </h3>
        <p style={{ margin: '0 0 16px', color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
          הכתובת שממנה הסקרייפר מושך את לוח המשחקים והתוצאות. ניתן לשנות גם את טווח התאריכים (פרמטר <code>dates</code>) בתוך הכתובת. השאר ריק כדי להשתמש בברירת המחדל הקבועה בקוד.
        </p>

        <div className="field" style={{ marginBottom: 16 }}>
          <label>כתובת ה-API הפעילה</label>
          <div style={{
            direction: 'ltr', textAlign: 'left', wordBreak: 'break-all',
            background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 6,
            padding: '10px 12px', fontSize: 13, color: 'var(--ink)'
          }}>
            {sourceUrl || `ברירת מחדל מהקוד: ${DEFAULT_HINT}`}
          </div>
        </div>

        <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          מצב סקרייפר נוכחי: <strong>{mode || '—'}</strong> (נקבע בטאב "הגדרות"). הבדיקה למטה רצה רק כשהמצב הוא <code>espn</code>.
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-pitch" onClick={openModal}>ערוך קישור מקור</button>
          <button className="btn btn-gold" onClick={testNow} disabled={testing}>
            {testing ? 'בודק...' : 'בדוק עכשיו'}
          </button>
        </div>
      </div>

      {modalOpen && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal">
            <div className="admin-modal-head">
              <div>
                <h3>עריכת קישור מקור ESPN</h3>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  הדבק כתובת ESPN scoreboard מלאה (כולל <code>?dates=</code>). ריק = ברירת המחדל מהקוד.
                </div>
              </div>
              <button className="btn btn-sm btn-outline" onClick={() => setModalOpen(false)}>סגור</button>
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <label>כתובת API</label>
              <input
                style={{ direction: 'ltr', textAlign: 'left' }}
                value={draftUrl}
                placeholder={DEFAULT_HINT}
                onChange={e => setDraftUrl(e.target.value)}
              />
            </div>
            <button className="btn btn-pitch" onClick={saveUrl} disabled={saving} style={{ marginTop: 16 }}>
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────── פעולות ─────────────── */
function ActionsTab() {
  const [err, setErr] = useState('');
  const [ok, setOk]   = useState('');
  const [busy, setBusy] = useState(null);
  const [backupFile, setBackupFile] = useState(null);
  const [teams, setTeams] = useState([]);
  const [teamCode, setTeamCode] = useState('');

  useEffect(() => { api.get('/teams').then(r => setTeams(r.data || [])).catch(() => {}); }, []);

  const genTeamReviews = async (scope, code) => {
    setErr(''); setOk(''); setBusy(`tr-${scope}`);
    try {
      const r = await api.post('/admin/team-reviews/generate', { scope, code }, { timeout: 600000 });
      setOk(`ביקורות נבחרת: נוצרו ${r.data.generated}/${r.data.total} (נכשלו: ${(r.data.failed || []).length})`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };

  const run = async (op, url, label) => {
    setErr(''); setOk(''); setBusy(op);
    try {
      const r = await api.post(url);
      setOk(`${label}: ${JSON.stringify(r.data)}`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const downloadBackup = async () => {
    setErr(''); setOk(''); setBusy('backup-export');
    try {
      const { data, headers } = await api.get('/admin/site-backup/export', { responseType: 'blob' });
      const blob = new Blob([data], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const disposition = headers['content-disposition'] || '';
      const match = disposition.match(/filename="([^"]+)"/);
      a.href = url;
      a.download = match?.[1] || 'site-backup.tar.gz';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOk('קובץ הגיבוי הורד בהצלחה');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async () => {
    if (!backupFile) {
      setErr('יש לבחור קובץ גיבוי לייבוא');
      return;
    }
    if (!confirm('ייבוא הגיבוי יחליף את כל נתוני האתר הנוכחיים. להמשיך?')) return;

    setErr(''); setOk(''); setBusy('backup-import');
    try {
      const formData = new FormData();
      formData.append('file', backupFile);
      const { data } = await api.post('/admin/site-backup/import', formData);
      setOk(data?.message || 'הגיבוי יובא בהצלחה');
      setBackupFile(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      {err && <div className="alert alert-error">{err}</div>}
      {ok  && <div className="alert alert-success" style={{ wordBreak: 'break-all' }}>{ok}</div>}

      <ActionCard
        title="עדכון תוצאות מיידי"
        desc="מפעיל את הסקרייפר באופן מיידי לפי המצב שמוגדר בהגדרות (manual / espn / api-football). שימושי לבדיקה או לעדכון חוץ-לוז."
        btnLabel="הרץ עדכון עכשיו"
        loading={busy === 'scrape'}
        onClick={() => run('scrape', '/admin/scrape-now', 'סקרייפר רץ')}
      />

      <ActionCard
        title="סריקת משחקים זמינים"
        desc="מייבא או מעדכן מה-web את כל המשחקים שכבר פורסמו, כולל שלבי נוקאאוט כמו 32 האחרונות, עם שמות זמניים כשעדיין אין נבחרות סופיות."
        btnLabel="סרוק משחקים זמינים"
        loading={busy === 'scan-fixtures'}
        onClick={() => run('scan-fixtures', '/admin/scan-fixtures-now', 'סריקת משחקים הושלמה')}
        variant="gold"
      />

      <ActionCard
        title="צור ניחושי AI ל-5 המשחקים הקרובים"
        desc="מריץ מחקר רשת חי (OpenAI) ומפיק עד 4 ניחושי מקורות לכל אחד מ-5 המשחקים הקרובים. הניחושים יוצגו ככפתורים מתחת לכל משחק. עשוי לקחת עד דקה."
        btnLabel="הפק ניחושי מומחים"
        loading={busy === 'ai-pred'}
        onClick={async () => {
          setErr(''); setOk(''); setBusy('ai-pred');
          try {
            const r = await api.post('/admin/ai-predictions/generate', { limit: 5 }, { timeout: 180000 });
            setOk(`ניחושי AI הופקו: ${r.data.matches} משחקים, ${r.data.sources || 0} מקורות`);
          } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
        }}
        variant="gold"
      />

      <div style={{ background: 'var(--paper-pure)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <h3 style={{ margin: '0 0 6px' }}>עדכון ביקורות נבחרת (AI)</h3>
        <p style={{ color: 'var(--muted)', margin: '0 0 12px', fontSize: 14 }}>
          מחקר רשת חי המפיק ביקורת טקטית בעברית לכל נבחרת. הביקורת תיפתח בלחיצה על דגל הנבחרת. עשוי לקחת זמן (קריאה לכל נבחרת).
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-gold" disabled={busy === 'tr-next8'} onClick={() => genTeamReviews('next8')}>
            {busy === 'tr-next8' ? '...' : '8 הנבחרות הקרובות'}
          </button>
          <button className="btn btn-outline" disabled={busy === 'tr-all'} onClick={() => genTeamReviews('all')}>
            {busy === 'tr-all' ? '...' : 'כל הנבחרות'}
          </button>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <select value={teamCode} onChange={e => setTeamCode(e.target.value)}>
              <option value="">— בחר נבחרת —</option>
              {teams.map(t => <option key={t.code} value={t.code}>{t.name_he || t.code}</option>)}
            </select>
            <button className="btn btn-sm btn-outline" disabled={!teamCode || busy === 'tr-team'} onClick={() => genTeamReviews('team', teamCode)}>
              {busy === 'tr-team' ? '...' : 'הפק לנבחרת'}
            </button>
          </span>
        </div>
      </div>

      <ActionCard
        title="חישוב נקודות מחדש"
        desc="מחשב מחדש את הנקודות לכל הניחושים על סמך התוצאות הסופיות וההגדרות הנוכחיות. הרץ פעולה זו לאחר שינוי משקלי הניקוד או הגדרת אלופה/סגן/מלך שערים."
        btnLabel="חשב מחדש את כל הנקודות"
        loading={busy === 'recalc'}
        onClick={() => run('recalc', '/admin/recalculate', 'חישוב הושלם')}
        variant="gold"
      />

      <div style={{
        background: 'var(--paper-pure)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        padding: 24,
        marginBottom: 16
      }}>
        <h3 style={{
          marginTop: 0,
          marginBottom: 8,
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          color: 'var(--ink)'
        }}>גיבוי נתוני האתר</h3>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
          הורד גיבוי מלא הכולל את מסד הנתונים, כל התמונות/קבצי הנתונים שהועלו לאתר, וגם את קבצי המסמכים של הפוטר (`תקנון`, `פרטיות`, `Cookies`, `נגישות`, `מפת אתר`). ניתן גם להעלות גיבוי כזה כדי להחליף את נתוני המערכת הקיימים.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <button
            className="btn btn-gold"
            onClick={downloadBackup}
            disabled={busy !== null}
          >
            {busy === 'backup-export' ? 'מייצא...' : 'הורד גיבוי מלא'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 18 }}>
          <label className="btn btn-outline" style={{ cursor: 'pointer' }}>
            בחר קובץ גיבוי לייבוא
            <input
              type="file"
              accept=".sql,.tar.gz,.tgz,text/sql,application/gzip,application/x-gzip"
              style={{ display: 'none' }}
              onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            className="btn btn-pitch"
            onClick={importBackup}
            disabled={busy !== null || !backupFile}
          >
            {busy === 'backup-import' ? 'מייבא...' : 'ייבא גיבוי והחלף נתונים'}
          </button>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {backupFile ? `קובץ נבחר: ${backupFile.name}` : 'לא נבחר קובץ'}
          </span>
        </div>
      </div>

      <div style={{
        background: 'var(--paper-pure)',
        border: '1px dashed var(--line-bold)',
        borderRadius: 6,
        padding: 24,
        marginTop: 16
      }}>
        <h3 style={{
          marginTop: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          color: 'var(--ink)'
        }}>לוז קרון אוטומטי</h3>
        <p style={{ color: 'var(--muted)', marginBottom: 0 }}>
          השרת מריץ עדכון אוטומטי כל יום ב-04:00 בלילה.<br />
          במהלך הטורניר (11 ביוני - 20 ביולי 2026) - כל שעתיים.<br />
          המצב הנוכחי נקבע על-ידי <strong>scraper_mode</strong> בהגדרות.
        </p>
      </div>
    </div>
  );
}

function ScheduleTab() {
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [savingStructure, setSavingStructure] = useState(false);

  const buildDraft = (item, index = 0) => ({
    title: item.title || '',
    date_label: item.date_label || '',
    description: item.description || '',
    start_at: String(item.start_at || '').slice(0, 10),
    end_at: String(item.end_at || '').slice(0, 10),
    sort_order: item.sort_order ?? (index + 1) * 10,
    prize_slot: item.prize_slot ?? '',
    winner_user_id: item.winner_user_id ?? '',
    popup_enabled: !!item.popup_enabled,
    popup_title: item.popup_title || '',
    prize_image_file: null,
    popup_image_file: null,
    prize_image_url: item.prize_image_url || '',
    popup_image_url: item.popup_image_url || ''
  });

  const load = () => {
    setErr('');
    Promise.all([
      api.get('/admin/schedule-items'),
      api.get('/admin/users')
    ]).then(([itemsRes, usersRes]) => {
      const nextItems = itemsRes.data || [];
      setItems(nextItems);
      setUsers((usersRes.data || []).filter((u) => !u.is_admin));
      setDrafts(Object.fromEntries(nextItems.map((item, index) => [item.id, buildDraft(item, index)])));
    }).catch((e) => setErr(errMsg(e)));
  };

  useEffect(load, []);

  const upd = (id, key, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value }
    }));
  };

  const renumberOrders = (nextItems) => {
    setDrafts((prev) => {
      const nextDrafts = { ...prev };
      nextItems.forEach((item, index) => {
        if (!nextDrafts[item.id]) nextDrafts[item.id] = buildDraft(item, index);
        nextDrafts[item.id] = {
          ...nextDrafts[item.id],
          sort_order: (index + 1) * 10
        };
      });
      return nextDrafts;
    });
  };

  const addRow = () => {
    const id = `new-${Date.now()}`;
    const nextIndex = items.length;
    const newItem = {
      id,
      title: '',
      date_label: '',
      description: '',
      start_at: '',
      end_at: '',
      sort_order: (nextIndex + 1) * 10,
      prize_slot: null,
      winner_user_id: null,
      popup_enabled: 0,
      popup_title: '',
      prize_image_url: '',
      popup_image_url: ''
    };
    const nextItems = [...items, newItem];
    setItems(nextItems);
    setDrafts((prev) => ({ ...prev, [id]: buildDraft(newItem, nextIndex) }));
    renumberOrders(nextItems);
  };

  const removeRow = (id) => {
    const draft = drafts[id];
    const label = draft?.title?.trim() || 'שורה חדשה';
    if (!confirm(`למחוק את "${label}"?`)) return;
    const nextItems = items.filter((item) => item.id !== id);
    setItems(nextItems);
    setDrafts((prev) => {
      const nextDrafts = { ...prev };
      delete nextDrafts[id];
      return nextDrafts;
    });
    renumberOrders(nextItems);
  };

  const moveRow = (id, direction) => {
    const index = items.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const nextItems = [...items];
    const [row] = nextItems.splice(index, 1);
    nextItems.splice(target, 0, row);
    setItems(nextItems);
    renumberOrders(nextItems);
  };

  const saveStructure = async () => {
    if (!items.length) {
      setErr('יש להגדיר לפחות שורה אחת בלוז');
      return;
    }
    setSavingStructure(true);
    setErr('');
    setOk('');
    try {
      const payload = {
        items: items.map((item, index) => {
          const draft = drafts[item.id] || buildDraft(item, index);
          return {
            id: typeof item.id === 'number' ? item.id : null,
            title: draft.title,
            date_label: draft.date_label,
            description: draft.description,
            start_at: draft.start_at,
            end_at: draft.end_at,
            sort_order: Number.parseInt(draft.sort_order, 10) || (index + 1) * 10,
            prize_slot: draft.prize_slot === '' ? null : Number.parseInt(draft.prize_slot, 10),
            winner_user_id: draft.winner_user_id === '' ? null : Number.parseInt(draft.winner_user_id, 10),
            popup_enabled: !!draft.popup_enabled,
            popup_title: draft.popup_title || ''
          };
        })
      };
      const { data } = await api.post('/admin/schedule-items/structure', payload);
      const nextItems = data.items || [];
      setItems(nextItems);
      setDrafts(Object.fromEntries(nextItems.map((item, index) => [item.id, buildDraft(item, index)])));
      setOk('מבנה הלוז נשמר בהצלחה ונשמר כברירת המחדל של האתר');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSavingStructure(false);
    }
  };

  const save = async (id) => {
    const draft = drafts[id];
    if (!draft) return;
    if (typeof id !== 'number') {
      setErr('יש לשמור קודם את מבנה הלוז כדי ליצור את השורה ב-DB, ורק אחר כך להעלות תמונות');
      return;
    }
    setSavingId(id);
    setErr('');
    setOk('');
    try {
      const form = new FormData();
      form.append('title', draft.title);
      form.append('date_label', draft.date_label);
      form.append('description', draft.description);
      form.append('start_at', draft.start_at);
      form.append('end_at', draft.end_at);
      form.append('sort_order', String(draft.sort_order ?? 0));
      form.append('prize_slot', draft.prize_slot === '' ? '' : String(draft.prize_slot));
      form.append('winner_user_id', draft.winner_user_id === '' ? '' : String(draft.winner_user_id));
      form.append('popup_enabled', draft.popup_enabled ? '1' : '0');
      form.append('popup_title', draft.popup_title || '');
      if (draft.prize_image_file) form.append('prize_image', draft.prize_image_file);
      if (draft.popup_image_file) form.append('popup_image', draft.popup_image_file);

      const { data } = await api.post(`/admin/schedule-items/${id}`, form);
      const item = data.item;
      setItems((prev) => prev.map((entry) => entry.id === id ? item : entry));
      setDrafts((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          prize_image_file: null,
          popup_image_file: null,
          prize_image_url: item.prize_image_url || '',
          popup_image_url: item.popup_image_url || '',
          winner_user_id: item.winner_user_id ?? '',
          popup_title: item.popup_title || '',
          popup_enabled: !!item.popup_enabled
        }
      }));
      setOk(`שורה "${item.title}" נשמרה בהצלחה`);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div style={{ maxWidth: 1120 }}>
      {err && <div className="alert alert-error">{err}</div>}
      {ok && <div className="alert alert-success">{ok}</div>}

      <div style={{
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 18
      }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>
          כאן אפשר להוסיף/להסיר שורות, לשנות את הסדר ולשמור את כל מבנה הלוז בבת אחת. לאחר מכן אפשר לשמור תמונות לכל שורה בנפרד.
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={addRow}>הוסף שורה</button>
          <button className="btn btn-gold" onClick={saveStructure} disabled={savingStructure}>
            {savingStructure ? 'שומר מבנה...' : 'שמור את כל מבנה הלוז'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {items.map((item, index) => {
          const draft = drafts[item.id];
          if (!draft) return null;
          return (
            <div key={item.id} style={{
              background: 'var(--paper-pure)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: 24
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 24 }}>{draft.title}</h3>
                  <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>{draft.date_label}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-outline" onClick={() => moveRow(item.id, -1)} disabled={index === 0}>למעלה</button>
                  <button className="btn btn-outline" onClick={() => moveRow(item.id, 1)} disabled={index === items.length - 1}>למטה</button>
                  <button className="btn btn-outline" onClick={() => removeRow(item.id)}>מחק שורה</button>
                  <button className="btn btn-gold" onClick={() => save(item.id)} disabled={savingId === item.id}>
                    {savingId === item.id ? 'שומר...' : 'שמור שורה / תמונות'}
                  </button>
                </div>
              </div>

              <div className="admin-form-grid">
                <div className="field">
                  <label>שלב</label>
                  <input type="text" value={draft.title} onChange={(e) => upd(item.id, 'title', e.target.value)} />
                </div>
                <div className="field">
                  <label>תצוגת תאריכים</label>
                  <input type="text" value={draft.date_label} onChange={(e) => upd(item.id, 'date_label', e.target.value)} />
                </div>
                <div className="field">
                  <label>מה קורה</label>
                  <input type="text" value={draft.description} onChange={(e) => upd(item.id, 'description', e.target.value)} />
                </div>
                <div className="field">
                  <label>סדר תצוגה</label>
                  <input type="number" value={draft.sort_order} onChange={(e) => upd(item.id, 'sort_order', e.target.value)} />
                </div>
                <div className="field">
                  <label>תאריך התחלה</label>
                  <input type="date" value={draft.start_at} onChange={(e) => upd(item.id, 'start_at', e.target.value)} />
                </div>
                <div className="field">
                  <label>תאריך סיום</label>
                  <input type="date" value={draft.end_at} onChange={(e) => upd(item.id, 'end_at', e.target.value)} />
                </div>
                <div className="field">
                  <label>פרס</label>
                  <select value={draft.prize_slot} onChange={(e) => upd(item.id, 'prize_slot', e.target.value)}>
                    <option value="">ללא פרס</option>
                    <option value="1">פרס 1</option>
                    <option value="2">פרס 2</option>
                    <option value="3">פרס 3</option>
                  </select>
                </div>
                <div className="field">
                  <label>זוכה בפרס</label>
                  <select value={draft.winner_user_id} onChange={(e) => upd(item.id, 'winner_user_id', e.target.value)}>
                    <option value="">טרם נקבע</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>כותרת פופאפ</label>
                  <input type="text" value={draft.popup_title} onChange={(e) => upd(item.id, 'popup_title', e.target.value)} />
                </div>
                <div className="field" style={{ justifyContent: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={draft.popup_enabled}
                      onChange={(e) => upd(item.id, 'popup_enabled', e.target.checked)}
                    />
                    הפעל פופאפ בתאריכים האלה
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 18 }}>
                <div className="field">
                  <label>תמונת פרס</label>
                  <input type="file" accept="image/*" onChange={(e) => upd(item.id, 'prize_image_file', e.target.files?.[0] || null)} />
                  {draft.prize_image_url && <img src={draft.prize_image_url} alt={draft.title} className="schedule-admin-preview" />}
                </div>
                <div className="field">
                  <label>תמונת פופאפ</label>
                  <input type="file" accept="image/*" onChange={(e) => upd(item.id, 'popup_image_file', e.target.files?.[0] || null)} />
                  {draft.popup_image_url && <img src={draft.popup_image_url} alt={draft.popup_title || draft.title} className="schedule-admin-preview" />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionCard({ title, desc, btnLabel, loading, onClick, variant }) {
  return (
    <div style={{
      background: 'var(--paper-pure)',
      border: '1px solid var(--line)',
      borderRadius: 6,
      padding: 24,
      marginBottom: 16,
      display: 'flex',
      gap: 24,
      alignItems: 'center',
      flexWrap: 'wrap'
    }}>
      <div style={{ flex: 1, minWidth: 280 }}>
        <h3 style={{
          marginTop: 0,
          marginBottom: 8,
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          color: 'var(--ink)'
        }}>{title}</h3>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>{desc}</p>
      </div>
      <button
        className={`btn ${variant === 'gold' ? 'btn-gold' : 'btn-pitch'}`}
        onClick={onClick}
        disabled={loading}
      >{loading ? 'רץ...' : btnLabel}</button>
    </div>
  );
}
