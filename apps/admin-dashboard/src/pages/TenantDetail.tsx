import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ErrorBanner, Spinner } from '../components/Spinner';
import { Table } from '../components/Table';
import { useAuth } from '../lib/auth';
import type {
  Applicant,
  ApiKey,
  Business,
  DecisionStatus,
  IssuedApiKey,
} from '../lib/api-client';
import { useAsync } from '../lib/useAsync';

type Tab = 'overview' | 'api-keys' | 'usage' | 'applicants' | 'businesses';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'api-keys', label: 'API Keys' },
  { key: 'usage', label: 'Usage' },
  { key: 'applicants', label: 'Applicants' },
  { key: 'businesses', label: 'Businesses' },
];

export function TenantDetail() {
  const { tenantId = '' } = useParams<{ tenantId: string }>();
  const { api } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  // React Router only mounts this element for a matched `/tenants/:tenantId`
  // route, so tenantId is always present in practice — the `= ''` default
  // above exists only so hook order stays fixed on every render (an early
  // `return null` before the hooks above would violate the Rules of Hooks).
  const tenant = useAsync(() => api.getTenant(tenantId), [api, tenantId]);
  if (!tenantId) return null;

  return (
    <div>
      {tenant.status === 'loading' && <Spinner />}
      {tenant.status === 'error' && <ErrorBanner message={tenant.message} />}
      {tenant.status === 'ready' && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <h1 className="text-lg font-semibold text-slate-900">
              {tenant.data.name}
            </h1>
            <Badge value={tenant.data.status} />
            <span className="text-sm text-slate-400">/{tenant.data.slug}</span>
          </div>

          <div className="mb-4 flex gap-1 border-b border-slate-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`border-b-2 px-3 py-2 text-sm font-medium ${
                  tab === t.key
                    ? 'border-brand text-brand'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <OverviewTab tenantId={tenantId} status={tenant.data.status} onChanged={tenant.reload} />
          )}
          {tab === 'api-keys' && <ApiKeysTab tenantId={tenantId} />}
          {tab === 'usage' && <UsageTab tenantId={tenantId} />}
          {tab === 'applicants' && <ApplicantsTab tenantId={tenantId} />}
          {tab === 'businesses' && <BusinessesTab tenantId={tenantId} />}
        </>
      )}
    </div>
  );
}

function OverviewTab({
  tenantId,
  status,
  onChanged,
}: {
  tenantId: string;
  status: string;
  onChanged: () => void;
}) {
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (status === 'ACTIVE') await api.suspendTenant(tenantId);
      else await api.activateTenant(tenantId);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tenant');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}
      <p className="text-sm text-slate-600">
        This tenant is currently <Badge value={status} />.
      </p>
      <div>
        <Button
          variant={status === 'ACTIVE' ? 'danger' : 'primary'}
          disabled={busy}
          onClick={toggle}
        >
          {status === 'ACTIVE' ? 'Suspend tenant' : 'Activate tenant'}
        </Button>
      </div>
    </div>
  );
}

function ApiKeysTab({ tenantId }: { tenantId: string }) {
  const { api } = useAuth();
  const keys = useAsync(() => api.listApiKeys(tenantId), [api, tenantId]);
  const [issuing, setIssuing] = useState(false);
  const [justIssued, setJustIssued] = useState<IssuedApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue(environment: 'LIVE' | 'TEST') {
    setIssuing(true);
    setError(null);
    try {
      const key = await api.issueApiKey(tenantId, { environment });
      setJustIssued(key);
      keys.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue key');
    } finally {
      setIssuing(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await api.revokeApiKey(id);
      keys.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}
      {justIssued && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          New {justIssued.environment} key issued — copy it now, it won't be shown
          again:
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">
            {justIssued.token}
          </code>
        </div>
      )}
      <div className="flex gap-2">
        <Button disabled={issuing} onClick={() => issue('LIVE')}>
          Issue LIVE key
        </Button>
        <Button variant="secondary" disabled={issuing} onClick={() => issue('TEST')}>
          Issue TEST key
        </Button>
      </div>
      {keys.status === 'loading' && <Spinner />}
      {keys.status === 'error' && <ErrorBanner message={keys.message} />}
      {keys.status === 'ready' && (
        <Table
          rows={keys.data}
          rowKey={(k) => k.id}
          emptyMessage="No API keys issued yet."
          columns={[
            { key: 'prefix', header: 'Prefix', cell: (k: ApiKey) => k.keyPrefix },
            {
              key: 'env',
              header: 'Environment',
              cell: (k: ApiKey) => <Badge value={k.environment} />,
            },
            {
              key: 'status',
              header: 'Status',
              cell: (k: ApiKey) => <Badge value={k.status} />,
            },
            {
              key: 'createdAt',
              header: 'Issued',
              cell: (k: ApiKey) => new Date(k.createdAt).toLocaleDateString(),
            },
            {
              key: 'actions',
              header: '',
              cell: (k: ApiKey) =>
                k.status === 'ACTIVE' ? (
                  <Button
                    variant="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      revoke(k.id);
                    }}
                  >
                    Revoke
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
    </div>
  );
}

function UsageTab({ tenantId }: { tenantId: string }) {
  const { api } = useAuth();
  const [environment, setEnvironment] = useState<'LIVE' | 'TEST'>('LIVE');
  const usage = useAsync(
    () => api.getUsage(tenantId, { environment }),
    [api, tenantId, environment],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {(['LIVE', 'TEST'] as const).map((env) => (
          <button
            key={env}
            onClick={() => setEnvironment(env)}
            className={`rounded-md px-3 py-1 text-sm ${
              environment === env
                ? 'bg-brand text-white'
                : 'bg-white text-slate-600 border border-slate-300'
            }`}
          >
            {env}
          </button>
        ))}
      </div>
      {usage.status === 'loading' && <Spinner />}
      {usage.status === 'error' && <ErrorBanner message={usage.message} />}
      {usage.status === 'ready' && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">
            {new Date(usage.data.from).toLocaleDateString()} —{' '}
            {new Date(usage.data.to).toLocaleDateString()}
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {usage.data.total}
          </p>
          <p className="text-sm text-slate-500">documents processed</p>
        </div>
      )}
    </div>
  );
}

function DecisionStatusFilter({
  value,
  onChange,
}: {
  value: DecisionStatus | undefined;
  onChange: (v: DecisionStatus | undefined) => void;
}) {
  const options: (DecisionStatus | undefined)[] = [
    undefined,
    'NEEDS_REVIEW',
    'APPROVED',
    'REJECTED',
  ];
  return (
    <div className="flex gap-2">
      {options.map((opt) => (
        <button
          key={opt ?? 'all'}
          onClick={() => onChange(opt)}
          className={`rounded-md px-3 py-1 text-sm ${
            value === opt
              ? 'bg-brand text-white'
              : 'bg-white text-slate-600 border border-slate-300'
          }`}
        >
          {opt ?? 'All'}
        </button>
      ))}
    </div>
  );
}

function ApplicantsTab({ tenantId }: { tenantId: string }) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [decisionStatus, setDecisionStatus] = useState<DecisionStatus | undefined>();
  const applicants = useAsync(
    () => api.listApplicants(tenantId, decisionStatus),
    [api, tenantId, decisionStatus],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* NEEDS_REVIEW selected here *is* the manual review queue — same
          "the filter is the queue" design as the backend itself. */}
      <DecisionStatusFilter value={decisionStatus} onChange={setDecisionStatus} />
      {applicants.status === 'loading' && <Spinner />}
      {applicants.status === 'error' && <ErrorBanner message={applicants.message} />}
      {applicants.status === 'ready' && (
        <Table
          rows={applicants.data}
          rowKey={(a) => a.id}
          onRowClick={(a) => navigate(`/tenants/${tenantId}/applicants/${a.id}`)}
          emptyMessage="No applicants match this filter."
          columns={[
            {
              key: 'name',
              header: 'Name',
              cell: (a: Applicant) =>
                [a.firstName, a.lastName].filter(Boolean).join(' ') || '—',
            },
            {
              key: 'externalId',
              header: 'External ID',
              cell: (a: Applicant) => a.externalId ?? '—',
            },
            {
              key: 'decision',
              header: 'Decision',
              cell: (a: Applicant) => <Badge value={a.latestDecisionStatus} />,
            },
            {
              key: 'createdAt',
              header: 'Created',
              cell: (a: Applicant) => new Date(a.createdAt).toLocaleDateString(),
            },
          ]}
        />
      )}
    </div>
  );
}

function BusinessesTab({ tenantId }: { tenantId: string }) {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [decisionStatus, setDecisionStatus] = useState<DecisionStatus | undefined>();
  const businesses = useAsync(
    () => api.listBusinesses(tenantId, decisionStatus),
    [api, tenantId, decisionStatus],
  );

  return (
    <div className="flex flex-col gap-3">
      <DecisionStatusFilter value={decisionStatus} onChange={setDecisionStatus} />
      {businesses.status === 'loading' && <Spinner />}
      {businesses.status === 'error' && <ErrorBanner message={businesses.message} />}
      {businesses.status === 'ready' && (
        <Table
          rows={businesses.data}
          rowKey={(b) => b.id}
          onRowClick={(b) => navigate(`/tenants/${tenantId}/businesses/${b.id}`)}
          emptyMessage="No businesses match this filter."
          columns={[
            {
              key: 'name',
              header: 'Legal name',
              cell: (b: Business) => b.legalName ?? '—',
            },
            {
              key: 'externalId',
              header: 'External ID',
              cell: (b: Business) => b.externalId ?? '—',
            },
            {
              key: 'decision',
              header: 'Decision',
              cell: (b: Business) => <Badge value={b.latestDecisionStatus} />,
            },
            {
              key: 'createdAt',
              header: 'Created',
              cell: (b: Business) => new Date(b.createdAt).toLocaleDateString(),
            },
          ]}
        />
      )}
    </div>
  );
}
