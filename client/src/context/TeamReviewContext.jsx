import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client';
import TeamReviewModal from '../components/TeamReviewModal';

const TeamReviewContext = createContext({ hasReview: () => false, openReview: () => {} });

export function useTeamReview() { return useContext(TeamReviewContext); }

export function TeamReviewProvider({ children }) {
  const [codes, setCodes] = useState(() => new Set());
  const [openCode, setOpenCode] = useState(null);

  useEffect(() => {
    api.get('/team-reviews')
      .then(r => setCodes(new Set((r.data || []).map(c => String(c).toLowerCase()))))
      .catch(() => {});
  }, []);

  const hasReview = (code) => !!code && codes.has(String(code).toLowerCase());
  const openReview = (code) => { if (hasReview(code)) setOpenCode(code); };

  return (
    <TeamReviewContext.Provider value={{ hasReview, openReview }}>
      {children}
      {openCode && <TeamReviewModal code={openCode} onClose={() => setOpenCode(null)} />}
    </TeamReviewContext.Provider>
  );
}
