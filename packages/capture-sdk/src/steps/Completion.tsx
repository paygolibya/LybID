export function Completion() {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="h-6 w-6"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-slate-900">Submitted</h2>
      {/* Deliberately no pass/fail here — verification is a separate,
          bank-triggered decision this SDK never computes or sees. See the
          plan's "what the SDK does — and does not do". */}
      <p className="max-w-xs text-sm text-slate-600">
        Your documents and selfie have been submitted for verification.
        You&apos;ll hear back shortly.
      </p>
    </div>
  );
}
