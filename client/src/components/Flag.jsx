// רכיב דגל - משתמש ב-flagcdn.com שמספק דגלים PNG באיכות גבוהה
// לפי קוד ISO 3166-1 alpha-2 (וגם תת-קודים כמו gb-eng לאנגליה)
import { useTeamReview } from '../context/TeamReviewContext';

export default function Flag({ code, size = 'md', title }) {
  const { hasReview, openReview } = useTeamReview();
  const reviewable = hasReview(code);
  if (!code) {
    return (
      <span
        className={`flag flag-${size} flag-placeholder`}
        title={title || 'TBD'}
        role="img"
        aria-label={title || 'TBD'}
      >
        TBD
      </span>
    );
  }
  const url = `https://flagcdn.com/w160/${code}.png`;
  return (
    <span
      className={`flag flag-${size} ${reviewable ? 'flag-reviewable' : ''}`}
      style={{ backgroundImage: `url(${url})` }}
      title={reviewable ? 'יש ביקורת נבחרת — לחץ לצפייה' : (title || code)}
      role={reviewable ? 'button' : 'img'}
      aria-label={title || code}
      onClick={reviewable ? (e) => { e.stopPropagation(); openReview(code); } : undefined}
    >
      {reviewable && <span className="flag-review-badge" aria-hidden="true">📝</span>}
    </span>
  );
}
