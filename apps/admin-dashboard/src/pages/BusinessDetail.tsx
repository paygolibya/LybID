import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ErrorBanner, Spinner } from '../components/Spinner';
import { useAuth } from '../lib/auth';
import type { Decision } from '../lib/api-client';
import { useAsync } from '../lib/useAsync';
import { DecisionHistory, DocumentCard, EraseAction, ReviewForm } from './ApplicantDetail';

export function BusinessDetail() {
  const { tenantId = '', businessId = '' } = useParams<{
    tenantId: string;
    businessId: string;
  }>();
  const { api } = useAuth();
  const detail = useAsync(
    () => api.getBusinessDetail(tenantId, businessId),
    [api, tenantId, businessId],
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  if (!tenantId || !businessId) return null;
  if (detail.status === 'loading') return <Spinner />;
  if (detail.status === 'error') return <ErrorBanner message={detail.message} />;
  const business = detail.data;
  const latestDecision = business.decisions[0] as Decision | undefined;

  async function decide() {
    setActionBusy(true);
    setActionError(null);
    try {
      await api.decideBusiness(tenantId, businessId);
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
      await api.reviewBusiness(tenantId, businessId, { status, notes: notes || undefined });
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
          {business.legalName ?? 'Unnamed business'}
        </h1>
        <p className="text-sm text-slate-500">
          {business.externalId ?? business.id}
        </p>
        {business.commercialRegistrationNumber && (
          <p className="text-sm text-slate-500">
            Reg. no. {business.commercialRegistrationNumber}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-slate-500">Latest decision:</span>
          <Badge value={business.latestDecisionStatus} />
        </div>
      </div>

      {actionError && <ErrorBanner message={actionError} />}

      <Section title="Documents">
        {business.documents.length === 0 && (
          <p className="text-sm text-slate-500">No documents uploaded yet.</p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {business.documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              load={() => api.getBusinessDocumentImageBlob(tenantId, doc.id)}
            />
          ))}
        </div>
      </Section>

      <Section title="Decision">
        <div className="flex flex-col gap-3">
          <Button disabled={actionBusy} onClick={decide}>
            {business.decisions.length === 0 ? 'Compute decision' : 'Recompute decision'}
          </Button>
          {latestDecision?.status === 'NEEDS_REVIEW' && (
            <ReviewForm busy={actionBusy} onSubmit={review} />
          )}
          <DecisionHistory decisions={business.decisions} />
        </div>
      </Section>

      <Section title="Danger zone">
        <EraseAction
          erasedAt={business.erasedAt}
          subjectLabel="this business"
          onErase={async () => {
            await api.eraseBusiness(tenantId, businessId);
            detail.reload();
          }}
        />
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
