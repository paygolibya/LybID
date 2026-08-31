import { Button } from '../components/Button';

interface WelcomeProps {
  onStart: () => void;
}

export function Welcome({ onStart }: WelcomeProps) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <h2 className="text-lg font-semibold text-slate-900">
        Let&apos;s verify your identity
      </h2>
      <p className="max-w-xs text-sm text-slate-600">
        You&apos;ll need your passport, birth certificate, and a working
        camera for a quick selfie. Everything is captured live — no uploads
        from your device.
      </p>
      <Button onClick={onStart}>Get started</Button>
    </div>
  );
}
