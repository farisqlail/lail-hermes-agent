import React, { useEffect, useRef, useState } from 'react';
import './CameraCapture.css';

interface CameraCaptureProps {
  isOpen: boolean;
  onClose: () => void;
  /** Handed a JPEG File built from the current video frame. The caller stages
   *  it exactly like an attached picture, so the existing upload + vision path
   *  recognises it — no separate object-detection model. */
  onCapture: (file: File) => void;
}

/** Live webcam preview that fills its positioned parent (the HUD container),
 *  covering the graph while open. Kept its own component so the getUserMedia
 *  lifecycle — permission, the MediaStream, and stopping every track on
 *  close — stays in one place; a leaked stream leaves the camera light on. */
export function CameraCapture({ isOpen, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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

  if (!isOpen) return null;

  const snap = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `kamera-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        });
        onCapture(file);
        onClose();
      },
      'image/jpeg',
      0.9,
    );
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
          <div className="camera-actions">
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
