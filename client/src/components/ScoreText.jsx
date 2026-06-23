export default function ScoreText({ home, away, className = '', style = {} }) {
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
      {home}–{away}
    </bdi>
  );
}
