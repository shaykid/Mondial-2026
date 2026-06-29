// אייקון "ניחוש מקצועי" — כדור בדולח
export default function PredictorIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none', verticalAlign: '-0.16em' }}>
      <ellipse cx="12" cy="20" rx="6" ry="1.6" fill="#5b3b86" opacity="0.5" />
      <rect x="7.5" y="17.5" width="9" height="2.4" rx="1.2" fill="#7a52ad" />
      <circle cx="12" cy="10.5" r="7" fill="#9b6fd4" />
      <circle cx="12" cy="10.5" r="7" fill="url(#pg)" />
      <path d="M8 8.5 Q10 6 13.5 6.5" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d="M15.5 12 l0.6 1.4 1.4 0.6 -1.4 0.6 -0.6 1.4 -0.6 -1.4 -1.4 -0.6 1.4 -0.6 z" fill="#fff" opacity="0.9" />
      <defs>
        <radialGradient id="pg" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#7a52ad" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}
