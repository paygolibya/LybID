interface ProgressBarProps {
  /** 1-indexed current step, out of `total`. */
  current: number;
  total: number;
  label: string;
}

export function ProgressBar({ current, total, label }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, (current / total) * 100));
  return (
    <div className="px-4 pt-4">
      <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>
          {current} / {total}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-brand transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
