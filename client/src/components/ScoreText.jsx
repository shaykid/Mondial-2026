export default function ScoreText({ home, away, className = '', style = {}, markHome = false, homeRight = false }) {
  const homeEl = markHome ? <span className="home-score-mark" title="קבוצת בית">{home}</span> : home;
  return (
    <bdi
      dir="ltr"
      className={className}
      style={{
        direction: 'ltr',
        unicodeBidi: 'isolate',
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      {/* homeRight: בית מימין כדי להתאים לפריסת RTL (שם הקבוצה הביתית מימין) */}
      {homeRight ? <>{away}–{homeEl}</> : <>{homeEl}–{away}</>}
    </bdi>
  );
}
