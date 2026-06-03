import { useEffect, useState } from 'react';

const DOCS = [
  { label: 'תקנון ותנאי שימוש', url: '/docs/rules-and-terms.pdf' },
  { label: 'מדיניות פרטיות', url: '/docs/privacy-policy.pdf' },
  { label: 'מדיניות Cookies', url: '/docs/cookies-policy.pdf' },
  { label: 'הצהרת נגישות', url: '/docs/accessibility-statement.pdf' },
  { label: 'צור קשר', url: '/docs/contact.pdf' },
  { label: 'מפת אתר', url: '/docs/sitemap.pdf' }
];

export default function SiteFooter() {
  const [doc, setDoc] = useState(null);
  const [showConsent, setShowConsent] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('mondial_terms_accepted')) {
      setDoc(DOCS[0]);
      setShowConsent(true);
    }
  }, []);

  const acceptTerms = () => {
    localStorage.setItem('mondial_terms_accepted', '1');
    setShowConsent(false);
    setDoc(null);
  };

  return (
    <>
      <footer className="site-footer">
        {DOCS.map((item, index) => (
          <button key={item.url} type="button" onClick={() => setDoc(item)}>
            {item.label}{index < DOCS.length - 1 ? ' |' : ''}
          </button>
        ))}
      </footer>

      {doc && (
        <div className="doc-modal-backdrop" onClick={() => !showConsent && setDoc(null)}>
          <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="doc-modal-head">
              <h3>{doc.label}</h3>
              {!showConsent && (
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setDoc(null)}>סגור</button>
              )}
            </div>
            <iframe title={doc.label} src={doc.url} />
            {showConsent && (
              <button type="button" className="btn btn-gold" onClick={acceptTerms}>
                אישור שקראתי את התקנון
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
