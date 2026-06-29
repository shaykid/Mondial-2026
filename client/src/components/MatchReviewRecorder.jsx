import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { useTranslation } from '../i18n/TranslationContext';
import ReviewPublishModal from './ReviewPublishModal';

// כפתור הקלטה צף (תכלת, חצי-שקוף) מעל תיבות הניחוש.
// הקש → התחלת הקלטה. הקש שוב / Enter → סיום, תמלול, ופתיחת פופ-אפ פרסום.
export default function MatchReviewRecorder({ matchId, disabled, onPublished }) {
  const { t } = useTranslation();
  const [state, setState] = useState('idle'); // idle | recording | uploading
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null); // { audioUrl, transcript, warning }
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  // ניקוי הזרם בעת הסרת הרכיב
  useEffect(() => () => {
    try { recRef.current && recRef.current.state !== 'inactive' && recRef.current.stop(); } catch (e) { /* */ }
    streamRef.current && streamRef.current.getTracks().forEach(tr => tr.stop());
  }, []);

  const start = async () => {
    setErr('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr(t('reviews.mic_denied'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => upload();
      recRef.current = rec;
      rec.start();
      setState('recording');
    } catch (e) {
      setErr(t('reviews.mic_denied'));
    }
  };

  const stop = () => {
    if (recRef.current && recRef.current.state !== 'inactive') {
      recRef.current.stop();
    }
    streamRef.current && streamRef.current.getTracks().forEach(tr => tr.stop());
  };

  const upload = async () => {
    setState('uploading');
    try {
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
      const form = new FormData();
      form.append('audio', blob, 'review.webm');
      const r = await api.post('/reviews/transcribe', form);
      setModal({ audioUrl: r.data?.audio_url || null, transcript: r.data?.transcript || '', warning: r.data?.warning || '' });
    } catch (e) {
      setErr(t('reviews.failed'));
    } finally {
      setState('idle');
    }
  };

  const onClick = () => {
    if (state === 'recording') stop();
    else if (state === 'idle') start();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && state === 'recording') { e.preventDefault(); stop(); }
  };

  const label = state === 'recording' ? t('reviews.recording')
    : state === 'uploading' ? t('reviews.transcribing')
    : t('reviews.record_tip');

  return (
    <>
      <button
        type="button"
        className={`review-rec-btn ${state === 'recording' ? 'recording' : ''}`}
        onClick={onClick}
        onKeyDown={onKeyDown}
        disabled={disabled || state === 'uploading'}
        title={label}
        aria-label={label}
      >
        {state === 'uploading'
          ? <span className="spinner" />
          : <span className="review-rec-ico" aria-hidden="true">{state === 'recording' ? '■' : '🎙️'}</span>}
      </button>
      {state === 'idle' && !disabled && <span className="review-rec-cta" aria-hidden="true">{t('reviews.publish_cta')}</span>}
      {err && <span className="review-rec-err">{err}</span>}

      {modal && (
        <ReviewPublishModal
          matchId={matchId}
          audioUrl={modal.audioUrl}
          transcript={modal.transcript}
          warning={modal.warning}
          onClose={() => setModal(null)}
          onPublished={onPublished}
        />
      )}
    </>
  );
}
