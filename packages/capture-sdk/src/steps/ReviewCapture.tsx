import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import type { CaptureKind } from '../lib/state-machine';

interface ReviewCaptureProps {
  kind: CaptureKind;
  blob: Blob;
  onRetake: () => void;
  onConfirm: () => void;
}

const TITLES: Record<CaptureKind, string> = {
  PASSPORT: 'passport',
  BIRTH_CERTIFICATE: 'birth certificate',
  SELFIE: 'selfie',
};

export function ReviewCapture({
  kind,
  blob,
  onRetake,
  onConfirm,
}: ReviewCaptureProps) {
  const [url, setUrl] = useState<string>('');

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="px-4 pt-2 text-center text-base font-semibold text-slate-900">
        Review your {TITLES[kind]}
      </h2>
      <p className="px-4 text-center text-sm text-slate-600">
        Make sure it&apos;s clear and readable before continuing.
      </p>
      <div className="mx-4 overflow-hidden rounded-xl bg-slate-100">
        {url && (
          <img src={url} alt={`Captured ${TITLES[kind]}`} className="w-full" />
        )}
      </div>
      <div className="flex justify-center gap-3 px-4 pb-2">
        <Button variant="secondary" onClick={onRetake}>
          Retake
        </Button>
        <Button onClick={onConfirm}>Looks good</Button>
      </div>
    </div>
  );
}
