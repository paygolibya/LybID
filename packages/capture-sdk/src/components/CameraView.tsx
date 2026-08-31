import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './Button';

interface CameraViewProps {
  /** 'environment' (rear camera) for documents, 'user' (front camera) for the selfie. */
  facingMode: 'user' | 'environment';
  guideShape: 'document' | 'face';
  instructions: string;
  onCapture: (blob: Blob) => void;
}

type CameraState = 'requesting' | 'ready' | 'denied' | 'unsupported';

/**
 * Camera-only, deliberately no file-upload fallback — an uploaded image
 * (screenshot, edited file, a photo of a photo) is trivially spoofable in a
 * way a live capture isn't, for both the documents and the selfie. If the
 * camera is unavailable there is no alternate path through this step; see
 * the "unsupported"/"denied" states below.
 */
export function CameraView({
  facingMode,
  guideShape,
  instructions,
  onCapture,
}: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>('requesting');

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    setState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setState('ready');
    } catch {
      setState('denied');
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(blob);
      },
      'image/jpeg',
      0.92,
    );
  }, [onCapture]);

  if (state === 'unsupported' || state === 'denied') {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <p className="text-sm text-slate-600">
          {state === 'unsupported'
            ? 'Camera access is not supported in this browser. Please try a different device or browser to continue — this step requires a live camera capture.'
            : 'Camera access was denied. This step requires a live camera capture to continue — please allow camera access and try again.'}
        </p>
        <Button onClick={startCamera}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="px-4 text-center text-sm text-slate-600">{instructions}</p>
      <div className="relative mx-4 overflow-hidden rounded-xl bg-slate-900">
        <video
          ref={videoRef}
          className="aspect-[4/3] w-full object-cover"
          playsInline
          muted
        />
        {state === 'requesting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 text-sm text-white">
            Starting camera…
          </div>
        )}
        <FramingGuide shape={guideShape} />
      </div>
      <div className="flex justify-center px-4 pb-2">
        <Button onClick={capture} disabled={state !== 'ready'}>
          Capture
        </Button>
      </div>
    </div>
  );
}

function FramingGuide({ shape }: { shape: 'document' | 'face' }) {
  if (shape === 'face') {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[70%] aspect-[3/4] rounded-[50%] border-4 border-white/70" />
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
      <div className="h-full w-full rounded-xl border-4 border-dashed border-white/70" />
    </div>
  );
}
