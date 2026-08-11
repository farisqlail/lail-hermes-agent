import React, {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import './CameraCapture.css';
import { loadDetector, coverBox, label, Detection } from '../detect';

/** What a parent can ask the live camera to do imperatively: grab the current
 *  frame as a JPEG, and read what the detector last saw. The "explain what I'm
 *  holding" flow needs both at the instant the operator finishes speaking, which
 *  a prop callback cannot deliver — hence a ref handle. */
export interface CameraHandle {
  captureFrame(): Promise<File | null>;
  detections(): Detection[];
}

interface CameraCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  /** Handed a JPEG File built from the current video frame. The caller stages
   *  it exactly like an attached picture, so the existing upload + vision path
   *  recognises it — no separate object-detection model. */
  onCapture: (file: File) => void;
  /** When on, the parent auto-sends the current frame every time the operator
   *  speaks, so the agent explains whatever is in view. The camera only owns the
   *  toggle's UI; the parent owns the behaviour (it has the voice loop). */
  narrate?: boolean;
  onToggleNarrate?: (next: boolean) => void;
}

/** Live webcam preview that fills its positioned parent (the HUD container),
 *  covering the graph while open. Kept its own component so the getUserMedia
 *  lifecycle — permission, the MediaStream, and stopping every track on
 *  close — stays in one place; a leaked stream leaves the camera light on. */
export const CameraCapture = forwardRef<CameraHandle, CameraCaptureProps>(
  function CameraCapture(
    { isOpen, onClose, onCapture, narrate = false, onToggleNarrate },
    ref,
  ) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // The detector's most recent output, kept in a ref so captureFrame() can read
  // it synchronously without re-rendering on every frame.
  const detsRef = useRef<Detection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Live object detection state, separate from the camera itself: the camera
  // can be up (ready) while the GPU model is still downloading (detecting).
  const [detecting, setDetecting] = useState<'off' | 'loading' | 'on' | 'error'>('off');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    // `environment` prefers the rear camera on a phone/tablet; a laptop with
    // one camera ignores it. Audio off — this is a snapshot, not a recording.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        // The overlay may have closed while permission was pending; if so, drop
        // the stream we were just handed rather than leaving it running.
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(cameraError(e));
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setReady(false);
      setError(null);
    };
  }, [isOpen]);

  // Run the detector on the live preview while the camera is up. Started only
  // once the video is `ready`, so the model has real frames to read; the loop
  // is a requestAnimationFrame chain (foreground here, so it is not throttled),
  // and every teardown path stops it and clears the overlay. Model load is
  // lazy and cached in detect.ts, so reopening the camera does not re-download.
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    setDetecting('loading');
    loadDetector()
      .then((model) => {
        if (stopped) return;
        setDetecting('on');
        const loop = async () => {
          if (stopped) return;
          const video = videoRef.current;
          const canvas = overlayRef.current;
          if (video && canvas && video.videoWidth) {
            try {
              const preds = await model.detect(video, 20);
              if (!stopped) {
                detsRef.current = preds;
                drawDetections(canvas, video, preds);
              }
            } catch {
              // A single dropped frame (context lost on resize, etc.) must not
              // kill the loop — the next frame usually succeeds.
            }
          }
          if (!stopped) rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => {
        if (!stopped) setDetecting('error');
      });

    return () => {
      stopped = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const c = overlayRef.current;
      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      detsRef.current = [];
    };
  }, [ready]);

  // The current frame as a JPEG File, or null if the video is not yet playing.
  // Shared by the snap button and the parent's "explain what I'm holding" flow,
  // so both encode the frame the same way.
  const captureFrame = (): Promise<File | null> =>
    new Promise((resolve) => {
      const video = videoRef.current;
      if (!video || !video.videoWidth) return resolve(null);
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) =>
          resolve(
            blob
              ? new File([blob], `kamera-${Date.now()}.jpg`, { type: 'image/jpeg' })
              : null,
          ),
        'image/jpeg',
        0.9,
      );
    });

  useImperativeHandle(ref, () => ({
    captureFrame,
    detections: () => detsRef.current,
  }), []);

  if (!isOpen) return null;

  const snap = async () => {
    const file = await captureFrame();
    if (!file) return;
    onCapture(file);
    onClose();
  };

  return (
    <div className="camera-overlay">
      <button
        type="button"
        className="camera-close"
        title="Tutup kamera"
        onClick={onClose}
      >
        ×
      </button>

      {error ? (
        <p className="camera-error">{error}</p>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="camera-preview"
          />
          <canvas ref={overlayRef} className="camera-overlay-canvas" />
          {detecting !== 'off' && (
            <div className={`camera-detect-badge camera-detect-${detecting}`}>
              {detecting === 'loading'
                ? '⏳ Memuat model deteksi…'
                : detecting === 'on'
                ? '🎯 Deteksi objek aktif (GPU)'
                : '⚠ Deteksi objek tidak tersedia'}
            </div>
          )}
          <div className="camera-actions">
            <button
              type="button"
              className={`camera-narrate ${narrate ? 'on' : ''}`}
              onClick={() => onToggleNarrate?.(!narrate)}
              title="Saat aktif, agent otomatis menjelaskan objek di kamera setiap kali kamu bicara"
            >
              {narrate ? '🗣️ Auto-jelaskan: ON' : '🗣️ Auto-jelaskan: OFF'}
            </button>
            <button
              type="button"
              className="camera-snap"
              disabled={!ready}
              onClick={snap}
            >
              📸 Ambil &amp; kirim
            </button>
          </div>
        </>
      )}
    </div>
  );
});

/** Draw the current detections onto the overlay canvas, aligned to the
 *  `object-fit: cover` preview. The canvas is sized in CSS pixels (the video's
 *  displayed size), and each box is mapped from the frame's intrinsic pixels by
 *  coverBox — the same cover crop the browser applies to the video. */
function drawDetections(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  preds: Detection[],
): void {
  const viewW = video.clientWidth;
  const viewH = video.clientHeight;
  if (canvas.width !== viewW) canvas.width = viewW;
  if (canvas.height !== viewH) canvas.height = viewH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.lineWidth = 2;
  ctx.font = '14px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  for (const d of preds) {
    const b = coverBox(d.bbox, video.videoWidth, video.videoHeight, viewW, viewH);
    ctx.strokeStyle = '#66fcf1';
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    const text = label(d);
    const tw = ctx.measureText(text).width;
    const ty = Math.max(0, b.y - 18);
    ctx.fillStyle = '#66fcf1';
    ctx.fillRect(b.x, ty, tw + 8, 18);
    ctx.fillStyle = '#0b0c10';
    ctx.fillText(text, b.x + 4, ty + 2);
  }
}

/** Turn a getUserMedia rejection into something the operator can act on: the
 *  common cases are a denied permission and no camera at all. */
function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError')
    return 'Akses kamera ditolak. Izinkan di pengaturan browser lalu coba lagi.';
  if (name === 'NotFoundError')
    return 'Tidak ada kamera yang terdeteksi di perangkat ini.';
  return 'Gagal membuka kamera.';
}
