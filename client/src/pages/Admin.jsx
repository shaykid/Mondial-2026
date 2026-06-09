// דף ניהול - מנהל בלבד
// ----------------------------------------------------------------
// טאבים: סקירה / משתמשים / משחקים / הגדרות / פעולות
// ----------------------------------------------------------------
import { useEffect, useState } from 'react';
import api, { errMsg } from '../api/client';
import Flag from '../components/Flag';

const TABS = [
  { id: 'overview',  label: 'סקירה'    },
  { id: 'users',     label: 'משתמשים'  },
  { id: 'departments', label: 'מחלקות' },
  { id: 'matches',   label: 'משחקים'   },
  { id: 'settings',  label: 'הגדרות'   },
  { id: 'schedule',  label: 'לוז ופרסים' },
  { id: 'actions',   label: 'פעולות'   }
];

export default function Admin() {
  const [tab, setTab] = useState('overview');

  return (
    <div className="page">
      <h1 className="page-title">
        <span className="accent">ניהול</span> מערכת
      </h1>
      <p className="page-subtitle">בקרת על · משתמשים · תוצאות · הגדרות</p>

      <div className="tabs" style={{ marginBottom: 32 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users'    && <UsersTab    />}
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'matches'  && <MatchesTab  />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'actions'  && <ActionsTab  />}
    </div>
  );
}

/* ─────────────── סקירה ─────────────── */
function OverviewTab() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');

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
        <div className="label">משתמשים רשומים</div>
        <div className="value">{stats.users}</div>
      </div>
      <div className="stat-card">
        <div className="label">סה"כ ניחושים</div>
        <div className="value">{stats.predictions}</div>
      </div>
      <div className="stat-card">
        <div className="label">סה"כ משחקים</div>
        <div className="value">{stats.matches}</div>
      </div>
      <div className="stat-card">
        <div className="label">משחקים שהסתיימו</div>
        <div className="value">{stats.finished}</div>
      </div>
    </div>
  );
}

/* ─────────────── משתמשים ─────────────── */
function UsersTab() {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoResult, setDemoResult] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [createDraft, setCreateDraft] = useState({ name: '', email: '', phone_number: '', department: '', password: '' });
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
      department: user.department || ''
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
    setCreateDraft({ name: '', email: '', phone_number: '', department: '', password: '' });
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
        department: editDraft.department
      };
      const { data } = await api.patch(`/admin/users/${editingUser.id}`, payload);
      setEditNotice('הנתונים נשמרו בהצלחה');
      if (data?.user) {
        setEditingUser(data.user);
        setEditDraft({
          name: data.user.name || '',
          email: data.user.email || '',
          phone_number: data.user.phone_number || '',
          department: data.user.department || ''
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
    setImporting(true);
    setErr('');
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
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
        <button className="btn btn-sm btn-pitch" onClick={importUsers} disabled={importing || !importFile}>
          {importing ? 'מייבא...' : 'ייבוא משתמשים'}
        </button>
        <button className="btn btn-sm btn-gold" onClick={createDemoUsers} disabled={demoBusy}>
          {demoBusy ? 'יוצר...' : 'צור 10 משתמשי דמו'}
        </button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: -6, marginBottom: 16 }}>
        ביצוא, עמודת הסיסמה נשארת ריקה כי המערכת שומרת רק גיבוב סיסמה.
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
                  {new Date(u.created_at).toLocaleDateString('he-IL')}
                </td>
                <td>
                  {u.is_admin
                    ? <span className="deadline-badge ok">מנהל</span>
                    : <span style={{ color: 'var(--muted)' }}>משתמש</span>
                  }
                </td>
                <td>
                  <button
                    className="btn btn-sm btn-outline"
                    style={{ marginInlineEnd: 8 }}
                    onClick={() => openEdit(u)}
                  >ערוך</button>
                  {!u.is_admin && (
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
                  <td><span className="deadline-badge" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>{m.stage === 'group' ? 'בית' : m.stage}</span></td>
                  <td style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--crimson)' }}>{m.group_letter || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <span>{m.home_name}</span>
                      <Flag code={m.home_code} alt={m.home_name} size="sm" />
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
                      <Flag code={m.away_code} alt={m.away_name} size="sm" />
                      <span>{m.away_name}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {new Date(m.kickoff).toLocaleString('he-IL', {
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

/* ─────────────── הגדרות ─────────────── */
function SettingsTab() {
  const [settings, setSettings] = useState({});
  const [draft, setDraft]       = useState({});
  const [err, setErr] = useState('');
  const [ok, setOk]   = useState('');

  useEffect(() => {
    api.get('/admin/settings')
      .then(r => { setSettings(r.data); setDraft(r.data); })
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

  const dirty = JSON.stringify(settings) !== JSON.stringify(draft);

  return (
    <div style={{ maxWidth: 720 }}>
      {err && <div className="alert alert-error">{err}</div>}
      {ok  && <div className="alert alert-success">{ok}</div>}

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

function NumField({ label, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        step="1"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

/* ─────────────── פעולות ─────────────── */
function ActionsTab() {
  const [err, setErr] = useState('');
  const [ok, setOk]   = useState('');
  const [busy, setBusy] = useState(null);
  const [backupFile, setBackupFile] = useState(null);

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
      const blob = new Blob([data], { type: 'application/sql;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const disposition = headers['content-disposition'] || '';
      const match = disposition.match(/filename="([^"]+)"/);
      a.href = url;
      a.download = match?.[1] || 'site-backup.sql';
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
      setErr('יש לבחור קובץ SQL לייבוא');
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
          הורד SQL dump של כל טבלאות האתר או העלה קובץ SQL זהה כדי להחליף את נתוני המערכת הקיימים.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <button
            className="btn btn-gold"
            onClick={downloadBackup}
            disabled={busy !== null}
          >
            {busy === 'backup-export' ? 'מייצא...' : 'הורד גיבוי SQL'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 18 }}>
          <label className="btn btn-outline" style={{ cursor: 'pointer' }}>
            בחר קובץ SQL לייבוא
            <input
              type="file"
              accept=".sql,text/sql,application/sql"
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

  const load = () => {
    setErr('');
    Promise.all([
      api.get('/admin/schedule-items'),
      api.get('/admin/users')
    ]).then(([itemsRes, usersRes]) => {
      const nextItems = itemsRes.data || [];
      setItems(nextItems);
      setUsers((usersRes.data || []).filter((u) => !u.is_admin));
      setDrafts(Object.fromEntries(nextItems.map((item) => [item.id, {
        title: item.title || '',
        date_label: item.date_label || '',
        description: item.description || '',
        start_at: String(item.start_at || '').slice(0, 10),
        end_at: String(item.end_at || '').slice(0, 10),
        sort_order: item.sort_order ?? 0,
        prize_slot: item.prize_slot ?? '',
        winner_user_id: item.winner_user_id ?? '',
        popup_enabled: !!item.popup_enabled,
        popup_title: item.popup_title || '',
        prize_image_file: null,
        popup_image_file: null,
        prize_image_url: item.prize_image_url || '',
        popup_image_url: item.popup_image_url || ''
      }])));
    }).catch((e) => setErr(errMsg(e)));
  };

  useEffect(load, []);

  const upd = (id, key, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value }
    }));
  };

  const save = async (id) => {
    const draft = drafts[id];
    if (!draft) return;
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

      <div style={{ display: 'grid', gap: 16 }}>
        {items.map((item) => {
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
                <button className="btn btn-gold" onClick={() => save(item.id)} disabled={savingId === item.id}>
                  {savingId === item.id ? 'שומר...' : 'שמור שורה'}
                </button>
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
