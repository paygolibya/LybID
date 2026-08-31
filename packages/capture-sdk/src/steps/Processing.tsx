interface ProcessingProps {
  statusText: string;
}

export function Processing({ statusText }: ProcessingProps) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand"
        role="status"
        aria-label="Processing"
      />
      <p className="text-sm text-slate-600">{statusText}</p>
    </div>
  );
}
