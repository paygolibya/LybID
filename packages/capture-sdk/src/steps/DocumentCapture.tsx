import { CameraView } from '../components/CameraView';
import type { CaptureKind } from '../lib/state-machine';

interface DocumentCaptureProps {
  kind: CaptureKind;
  onCapture: (blob: Blob) => void;
}

const CONFIG: Record<
  CaptureKind,
  {
    title: string;
    instructions: string;
    facingMode: 'user' | 'environment';
    guideShape: 'document' | 'face';
  }
> = {
  PASSPORT: {
    title: 'Scan your passport',
    instructions:
      'Hold your passport’s photo page flat inside the frame, in good light.',
    facingMode: 'environment',
    guideShape: 'document',
  },
  BIRTH_CERTIFICATE: {
    title: 'Scan your birth certificate',
    instructions:
      'Hold your birth certificate flat inside the frame, in good light.',
    facingMode: 'environment',
    guideShape: 'document',
  },
  SELFIE: {
    title: 'Take a selfie',
    instructions: 'Center your face in the frame and look directly at the camera.',
    facingMode: 'user',
    guideShape: 'face',
  },
};

export function DocumentCapture({ kind, onCapture }: DocumentCaptureProps) {
  const config = CONFIG[kind];
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-4 pt-2 text-center text-base font-semibold text-slate-900">
        {config.title}
      </h2>
      <CameraView
        facingMode={config.facingMode}
        guideShape={config.guideShape}
        instructions={config.instructions}
        onCapture={onCapture}
      />
    </div>
  );
}
