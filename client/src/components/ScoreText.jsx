export default function ScoreText({ home, away, className = '', style = {}, markHome = false }) {
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
      {markHome ? <span className="home-score-mark" title="קבוצת בית">{home}</span> : home}–{away}
    </bdi>
  );
}
