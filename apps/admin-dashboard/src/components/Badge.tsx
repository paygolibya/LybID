// Color-codes the statuses that recur across this whole dashboard —
// DecisionStatus, DocumentStatus, BiometricCheckStatus, ApiKeyStatus,
// TenantStatus all share enough vocabulary (APPROVED/ACTIVE-ish "good",
// NEEDS_REVIEW/PROCESSING-ish "pending", REJECTED/FAILED/SUSPENDED/REVOKED
// "bad") that one lookup table covers all of them well enough for a v1.
const TONE_BY_VALUE: Record<string, 'good' | 'pending' | 'bad' | 'neutral'> = {
  APPROVED: 'good',
  ACTIVE: 'good',
  COMPLETED: 'good',
  EXTRACTED: 'good',
  MATCH: 'good',
  LIVE: 'good',
  NEEDS_REVIEW: 'pending',
  PROCESSING: 'pending',
  UPLOADED: 'pending',
  REJECTED: 'bad',
  FAILED: 'bad',
  SUSPENDED: 'bad',
  REVOKED: 'bad',
  SPOOF: 'bad',
  NO_MATCH: 'bad',
  UNKNOWN: 'neutral',
};

const TONE_CLASSES: Record<'good' | 'pending' | 'bad' | 'neutral', string> = {
  good: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  bad: 'bg-red-100 text-red-800',
  neutral: 'bg-slate-100 text-slate-700',
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const tone = TONE_BY_VALUE[value] ?? 'neutral';
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {value}
    </span>
  );
}
