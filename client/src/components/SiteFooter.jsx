import { useEffect, useState } from 'react';
import api, { errMsg } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/TranslationContext';
import ScoringSummary from './ScoringSummary';

export default function SiteFooter() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [docs, setDocs] = useState([]);
  const [doc, setDoc] = useState(null);
  const [showConsent, setShowConsent] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState({ name: '', phone_number: '', message: '', image: null });
  const [contactErr, setContactErr] = useState('');
  const [contactOk, setContactOk] = useState('');
  const [sending, setSending] = useState(false);

  const loadDocs = (withConsent) => {
    api.get('/site/footer-docs')
      .then((r) => {
        const nextDocs = r.data || [];
        setDocs(nextDocs);
        if (withConsent && !localStorage.getItem('mondial_terms_accepted')) {
          const termsDoc = nextDocs.find((item) => item.doc_key === 'rules') || nextDocs[0];
          if (termsDoc) {
            setDoc(termsDoc);
            setShowConsent(true);
          }
        }
      })
      .catch(() => setDocs([]));
  };

  useEffect(() => {
    loadDocs(true);
    // רענון מיידי כשמנהל מעדכן מסמך פוטר (כדי שהקישור יפתח את הקובץ החדש בלי רענון דף)
    const onUpdated = () => loadDocs(false);
    window.addEventListener('footer-docs-updated', onUpdated);
    return () => window.removeEventListener('footer-docs-updated', onUpdated);
  }, []);

  useEffect(() => {
    setContactDraft((prev) => ({
      ...prev,
      name: user?.name || prev.name,
      phone_number: user?.phone_number || prev.phone_number
    }));
  }, [user]);

  const acceptTerms = () => {
    localStorage.setItem('mondial_terms_accepted', '1');
    setShowConsent(false);
    setDoc(null);
  };

  const openItem = (item) => {
    if (item.file_type === 'contact' || item.doc_key === 'contact') {
      setContactErr('');
      setContactOk('');
      setContactOpen(true);
      return;
    }
    setDoc(item);
  };

  const docLabel = (item) => {
    const map = {
      rules: 'footer.doc_rules',
      privacy: 'footer.doc_privacy',
      cookies: 'footer.doc_cookies',
      accessibility: 'footer.doc_accessibility',
      contact: 'footer.doc_contact',
      sitemap: 'footer.doc_sitemap'
    };
    return map[item.doc_key] ? t(map[item.doc_key]) : item.label;
  };

  const sendContact = async () => {
    setContactErr('');
    setContactOk('');
    if (!contactDraft.name.trim() || !contactDraft.message.trim()) {
      setContactErr(t('footer.contact_required'));
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.append('name', contactDraft.name);
      form.append('phone_number', contactDraft.phone_number);
      form.append('message', contactDraft.message);
      if (contactDraft.image) form.append('image', contactDraft.image);
      await api.post('/site/contact', form);
      setContactOk(t('footer.contact_sent'));
      setContactDraft({
        name: user?.name || '',
        phone_number: user?.phone_number || '',
        message: '',
        image: null
      });
    } catch (e) {
      setContactErr(errMsg(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <footer className="site-footer">
        {docs.map((item, index) => (
          <button key={item.doc_key} type="button" onClick={() => openItem(item)}>
            {docLabel(item)}{index < docs.length - 1 ? ' |' : ''}
          </button>
        ))}
      </footer>

      <a className="hinbit-powered" href="https://hinbit.com" target="_blank" rel="noreferrer" dir="ltr">
        <img src="https://hinbit.com/hebrew_site/hinbit-logo-symbol.png" alt="Hinbit" />
        <span>Powered by Hinbit Development</span>
      </a>

      {doc && (
        <div className="doc-modal-backdrop" onClick={() => !showConsent && setDoc(null)}>
          <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="doc-modal-head">
              <h3>{docLabel(doc)}</h3>
              {!showConsent && (
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setDoc(null)}>{t('common.close')}</button>
              )}
            </div>
            {doc.file_type === 'image' ? (
              <img title={docLabel(doc)} src={doc.file_url} alt={docLabel(doc)} className="doc-modal-image" />
            ) : (
              <iframe title={docLabel(doc)} src={doc.file_url} />
            )}
            {doc.doc_key === 'rules' && (
              <ScoringSummary compact />
            )}
            {showConsent && (
              <button type="button" className="btn btn-gold" onClick={acceptTerms}>
                {t('footer.accept_rules')}
              </button>
            )}
          </div>
        </div>
      )}

      {contactOpen && (
        <div className="doc-modal-backdrop" onClick={() => setContactOpen(false)}>
          <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="doc-modal-head">
              <h3>{t('footer.contact_title')}</h3>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setContactOpen(false)}>{t('common.close')}</button>
            </div>
            {contactErr && <div className="alert alert-error">{contactErr}</div>}
            {contactOk && <div className="alert alert-success">{contactOk}</div>}
            <div className="admin-form-grid">
              <div className="field">
                <label>{t('footer.contact_name')}</label>
                <input type="text" value={contactDraft.name} onChange={(e) => setContactDraft((s) => ({ ...s, name: e.target.value }))} />
              </div>
              <div className="field">
                <label>{t('footer.contact_phone')}</label>
                <input type="text" value={contactDraft.phone_number} onChange={(e) => setContactDraft((s) => ({ ...s, phone_number: e.target.value }))} />
              </div>
            </div>
            <div className="field">
              <label>{t('footer.contact_message')}</label>
              <textarea rows="5" value={contactDraft.message} onChange={(e) => setContactDraft((s) => ({ ...s, message: e.target.value }))} />
            </div>
            <div className="field">
              <label>{t('footer.contact_image')}</label>
              <input type="file" accept="image/*" onChange={(e) => setContactDraft((s) => ({ ...s, image: e.target.files?.[0] || null }))} />
            </div>
            <button type="button" className="btn btn-gold" onClick={sendContact} disabled={sending}>
              {sending ? t('footer.contact_sending') : t('footer.contact_send')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
