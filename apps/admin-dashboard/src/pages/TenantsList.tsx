import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Modal } from '../components/Modal';
import { ErrorBanner, Spinner } from '../components/Spinner';
import { Table } from '../components/Table';
import { useAuth } from '../lib/auth';
import type { Tenant } from '../lib/api-client';
import { useAsync } from '../lib/useAsync';

export function TenantsList() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const tenants = useAsync(() => api.listTenants(), [api]);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Tenants</h1>
        <Button onClick={() => setShowCreate(true)}>New tenant</Button>
      </div>

      {tenants.status === 'loading' && <Spinner />}
      {tenants.status === 'error' && <ErrorBanner message={tenants.message} />}
      {tenants.status === 'ready' && (
        <Table
          rows={tenants.data}
          rowKey={(t) => t.id}
          onRowClick={(t) => navigate(`/tenants/${t.id}`)}
          emptyMessage="No tenants yet — create the first one."
          columns={[
            { key: 'name', header: 'Name', cell: (t: Tenant) => t.name },
            { key: 'slug', header: 'Slug', cell: (t: Tenant) => t.slug },
            {
              key: 'status',
              header: 'Status',
              cell: (t: Tenant) => <Badge value={t.status} />,
            },
            {
              key: 'createdAt',
              header: 'Created',
              cell: (t: Tenant) => new Date(t.createdAt).toLocaleDateString(),
            },
          ]}
        />
      )}

      {showCreate && (
        <CreateTenantModal
          onClose={() => setShowCreate(false)}
          onCreated={(tenant) => {
            setShowCreate(false);
            tenants.reload();
            navigate(`/tenants/${tenant.id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateTenantModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (tenant: Tenant) => void;
}) {
  const { api } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const tenant = await api.createTenant({ name, slug });
      onCreated(tenant);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tenant');
      setSubmitting(false);
    }
  }

  return (
    <Modal title="New tenant" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-col gap-1">
          <label htmlFor="tenant-name" className="text-xs font-medium text-slate-600">
            Name
          </label>
          <Input
            id="tenant-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="tenant-slug" className="text-xs font-medium text-slate-600">
            Slug
          </label>
          <Input
            id="tenant-slug"
            required
            pattern="[a-z0-9-]+"
            title="Lowercase letters, numbers, and hyphens only"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
