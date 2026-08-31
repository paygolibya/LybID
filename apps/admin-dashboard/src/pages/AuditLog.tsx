import { useState } from 'react';
import { Badge } from '../components/Badge';
import { Input } from '../components/Input';
import { ErrorBanner, Spinner } from '../components/Spinner';
import { Table } from '../components/Table';
import { useAuth } from '../lib/auth';
import type { AuditLogEntry } from '../lib/api-client';
import { useAsync } from '../lib/useAsync';

// The read endpoint AuditLogService's own Phase 0 comment deferred to
// Phase 8 ("no read endpoint... yet"), finally given a UI here. Global by
// default (every tenant's trail) — the tenantId filter narrows it to one,
// which is what a tenant-detail page would deep-link into (not built as a
// separate view; the filter here does that job).
export function AuditLog() {
  const { api } = useAuth();
  const [tenantId, setTenantId] = useState('');
  const [action, setAction] = useState('');
  const filters = useAsync(
    () =>
      api.listAuditLog({
        tenantId: tenantId || undefined,
        action: action || undefined,
        limit: 200,
      }),
    [api, tenantId, action],
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-slate-900">Audit log</h1>
      <div className="flex gap-2">
        <Input
          placeholder="Filter by tenant ID"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
        />
        <Input
          placeholder="Filter by action (e.g. admin.login.failure)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
      </div>

      {filters.status === 'loading' && <Spinner />}
      {filters.status === 'error' && <ErrorBanner message={filters.message} />}
      {filters.status === 'ready' && (
        <Table
          rows={filters.data}
          rowKey={(e) => e.id}
          emptyMessage="No audit log entries match this filter."
          columns={[
            {
              key: 'when',
              header: 'When',
              cell: (e: AuditLogEntry) => new Date(e.createdAt).toLocaleString(),
            },
            {
              key: 'action',
              header: 'Action',
              cell: (e: AuditLogEntry) => (
                <code className="text-xs">{e.action}</code>
              ),
            },
            {
              key: 'actor',
              header: 'Actor',
              cell: (e: AuditLogEntry) => (
                <span>
                  <Badge value={e.actorType} /> {e.actorId}
                </span>
              ),
            },
            {
              key: 'target',
              header: 'Target',
              cell: (e: AuditLogEntry) => (
                <span className="text-xs text-slate-500">
                  {e.targetType}/{e.targetId}
                </span>
              ),
            },
            {
              key: 'tenant',
              header: 'Tenant',
              cell: (e: AuditLogEntry) => e.tenantId ?? '—',
            },
          ]}
        />
      )}
      {filters.status === 'ready' && filters.data.length === 200 && (
        <p className="text-xs text-slate-400">
          Showing the most recent 200 entries — narrow the filters above to see more.
        </p>
      )}
    </div>
  );
}
