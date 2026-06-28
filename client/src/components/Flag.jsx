// רכיב דגל - משתמש ב-flagcdn.com שמספק דגלים PNG באיכות גבוהה
// לפי קוד ISO 3166-1 alpha-2 (וגם תת-קודים כמו gb-eng לאנגליה)

export default function Flag({ code, size = 'md', title }) {
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
      className={`flag flag-${size}`}
      style={{ backgroundImage: `url(${url})` }}
      title={title || code}
      role="img"
      aria-label={title || code}
    />
  );
}
