import { Button } from '../components/Button';

interface ErrorScreenProps {
  message: string;
  onContinue: () => void;
}

export function ErrorScreen({ message, onContinue }: ErrorScreenProps) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m0 3.75h.008M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-slate-900">
        Something went wrong
      </h2>
      <p className="max-w-xs text-sm text-slate-600">{message}</p>
      <Button onClick={onContinue}>Try again</Button>
    </div>
  );
}
