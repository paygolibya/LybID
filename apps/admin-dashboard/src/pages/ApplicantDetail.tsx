import { Fragment, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ErrorBanner, Spinner } from '../components/Spinner';
import { useAuth } from '../lib/auth';
import type { AdminDocument, Decision } from '../lib/api-client';
import { useAsync } from '../lib/useAsync';

export function ApplicantDetail() {
  const { tenantId = '', applicantId = '' } = useParams<{
    tenantId: string;
    applicantId: string;
  }>();
  const { api } = useAuth();
  const detail = useAsync(
    () => api.getApplicantDetail(tenantId, applicantId),
    [api, tenantId, applicantId],
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  if (!tenantId || !applicantId) return null;
  if (detail.status === 'loading') return <Spinner />;
  if (detail.status === 'error') return <ErrorBanner message={detail.message} />;
  const applicant = detail.data;
  const latestDecision = applicant.decisions[0] as Decision | undefined;

  async function decide() {
    setActionBusy(true);
    setActionError(null);
    try {
      await api.decideApplicant(tenantId, applicantId);
      detail.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to compute decision');
    } finally {
      setActionBusy(false);
    }
  }

  async function review(status: 'APPROVED' | 'REJECTED', notes: string) {
    setActionBusy(true);
    setActionError(null);
    try {
      await api.reviewApplicant(tenantId, applicantId, { status, notes: notes || undefined });
      detail.reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to submit review');
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">
          {[applicant.firstName, applicant.lastName].filter(Boolean).join(' ') ||
            'Unnamed applicant'}
        </h1>
        <p className="text-sm text-slate-500">
          {applicant.externalId ?? applicant.id}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-slate-500">Latest decision:</span>
          <Badge value={applicant.latestDecisionStatus} />
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} />}

      <Section title="Documents">
        {applicant.documents.length === 0 && (
          <p className="text-sm text-slate-500">No documents uploaded yet.</p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {applicant.documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              load={() => api.getDocumentImageBlob(tenantId, doc.id)}
            />
          ))}
        </div>
      </Section>

      <Section title="Biometric checks">
        {applicant.biometricChecks.length === 0 && (
          <p className="text-sm text-slate-500">No biometric check yet.</p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {applicant.biometricChecks.map((check) => (
            <div key={check.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Selfie</span>
                <Badge value={check.status} />
              </div>
              <AuthenticatedImage
                alt="Selfie"
                load={() => api.getDocumentImageBlob(tenantId, check.selfieDocumentId)}
              />
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-600">
                <dt>Liveness</dt>
                <dd>
                  <Badge value={check.livenessVerdict} />{' '}
                  {check.livenessScore?.toFixed(2)}
                </dd>
                <dt>Face match</dt>
                <dd>
                  <Badge value={check.faceMatchVerdict} />{' '}
                  {check.faceMatchScore?.toFixed(2)}
                </dd>
              </dl>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Decision">
        <div className="flex flex-col gap-3">
          <Button disabled={actionBusy} onClick={decide}>
            {applicant.decisions.length === 0 ? 'Compute decision' : 'Recompute decision'}
          </Button>
          {latestDecision?.status === 'NEEDS_REVIEW' && (
            <ReviewForm busy={actionBusy} onSubmit={review} />
          )}
          <DecisionHistory decisions={applicant.decisions} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DocumentCard({
  document,
  load,
}: {
  document: AdminDocument;
  load: () => Promise<Blob>;
}) {
  const latestExtraction = document.extractions[0];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-700">{document.type}</span>
        <Badge value={document.status} />
      </div>
      <AuthenticatedImage alt={document.type} load={load} />
      {latestExtraction && (
        <div className="mt-2 text-xs text-slate-600">
          <p>
            Confidence:{' '}
            {latestExtraction.overallConfidence != null
              ? `${Math.round(latestExtraction.overallConfidence * 100)}%`
              : '—'}
          </p>
          {latestExtraction.fields && latestExtraction.fields.length > 0 && (
            <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
              {latestExtraction.fields.map((f) => (
                <Fragment key={f.name}>
                  <dt className="text-slate-400">{f.name}</dt>
                  <dd>{f.value}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

export function ReviewForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (status: 'APPROVED' | 'REJECTED', notes: string) => void;
}) {
  const [notes, setNotes] = useState('');
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="mb-2 text-sm font-medium text-amber-900">
        This case needs manual review.
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
        rows={2}
      />
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => onSubmit('APPROVED', notes)}>
          Approve
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => onSubmit('REJECTED', notes)}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

export function DecisionHistory({ decisions }: { decisions: Decision[] }) {
  if (decisions.length === 0) {
    return <p className="text-sm text-slate-500">No decisions yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {decisions.map((d) => (
        <li
          key={d.id}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <div className="flex items-center justify-between">
            <Badge value={d.status} />
            <span className="text-xs text-slate-400">
              {new Date(d.createdAt).toLocaleString()}
            </span>
          </div>
          {d.reviewerId && (
            <p className="mt-1 text-xs text-slate-500">
              Reviewed by {d.reviewerId}
              {d.reviewNotes ? ` — ${d.reviewNotes}` : ''}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
