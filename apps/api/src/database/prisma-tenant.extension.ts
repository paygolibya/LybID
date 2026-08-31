import { Prisma } from '@prisma/client';
import type { RequestAuthContext } from './tenant-context';

/**
 * Per-model config for app-level auto-scoping. This is the *primary*
 * correctness layer (Postgres RLS, set up in the `rls_setup` migrations, is
 * the DB-level defense-in-depth layer described in the Phase 0/1 plans).
 *
 * `scopeField` is the column on the model that identifies its tenant: for
 * most models this is `tenantId`; for `Tenant` itself it's the row's own
 * `id`.
 *
 * `environmentField`, if set, additionally auto-scopes the model by
 * LIVE/TEST environment (app-layer only — see the Phase 1 plan for why this
 * isn't mirrored at the RLS layer). Without this, a tenant's LIVE API key
 * could read/enumerate that same tenant's TEST data (or vice versa) — a
 * same-tenant PII leak class, lower severity than cross-tenant but real.
 */
export const TENANT_SCOPED_MODELS: Record<
  string,
  { scopeField: string; environmentField?: string }
> = {
  Tenant: { scopeField: 'id' },
  ApiKey: { scopeField: 'tenantId' },
  Applicant: { scopeField: 'tenantId', environmentField: 'environment' },
  Document: { scopeField: 'tenantId', environmentField: 'environment' },
  DocumentExtraction: {
    scopeField: 'tenantId',
    environmentField: 'environment',
  },
  BiometricCheck: { scopeField: 'tenantId', environmentField: 'environment' },
  Business: { scopeField: 'tenantId', environmentField: 'environment' },
  BusinessDocument: {
    scopeField: 'tenantId',
    environmentField: 'environment',
  },
  BusinessDocumentExtraction: {
    scopeField: 'tenantId',
    environmentField: 'environment',
  },
  ApplicantDecision: {
    scopeField: 'tenantId',
    environmentField: 'environment',
  },
  BusinessDecision: {
    scopeField: 'tenantId',
    environmentField: 'environment',
  },
  UsageRecord: { scopeField: 'tenantId', environmentField: 'environment' },
};

const READ_OR_FILTER_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

const CREATE_OPERATIONS = new Set(['create']);
const CREATE_MANY_OPERATIONS = new Set(['createMany']);

/** field -> required value, e.g. { tenantId: 'abc', environment: 'LIVE' } */
type ScopePairs = Record<string, string>;

// Structural, not Extract<RequestAuthContext, {mode:'tenant'}> — 'tenant'
// and 'applicant' modes both satisfy this shape, and both get identical
// tenant+environment auto-scoping here. The *finer* "only this one
// applicant" restriction for applicant-mode is deliberately NOT handled in
// this file — there's no generic way to know which field on which model
// means "applicant" across Document/BiometricCheck/etc. from here; that
// check lives in ApplicantSessionModule instead. See the applicant-session
// plan.
type TenantScopedAuth = { tenantId: string; environment: 'LIVE' | 'TEST' };

function scopePairsFor(
  config: { scopeField: string; environmentField?: string },
  auth: TenantScopedAuth,
): ScopePairs {
  const pairs: ScopePairs = { [config.scopeField]: auth.tenantId };
  if (config.environmentField) {
    pairs[config.environmentField] = auth.environment;
  }
  return pairs;
}

function mergeWhereScope(
  model: string,
  where: unknown,
  scope: ScopePairs,
): Record<string, unknown> {
  const existing = (where ?? {}) as Record<string, unknown>;
  for (const [field, value] of Object.entries(scope)) {
    if (field in existing && existing[field] !== value) {
      throw new Error(
        `Tenant scoping violation: ${model} query explicitly filtered ${field}=${String(
          existing[field],
        )} which does not match the authenticated context. Refusing to run.`,
      );
    }
  }
  return { ...existing, ...scope };
}

function mergeCreateData(
  model: string,
  data: unknown,
  scope: ScopePairs,
): Record<string, unknown> {
  const existing = (data ?? {}) as Record<string, unknown>;
  for (const [field, value] of Object.entries(scope)) {
    if (field in existing && existing[field] !== value) {
      throw new Error(
        `Tenant scoping violation: ${model}.create set ${field}=${String(
          existing[field],
        )} which does not match the authenticated context.`,
      );
    }
  }
  return { ...existing, ...scope };
}

/**
 * Pure transformation at the heart of the tenant-scoping extension —
 * extracted so it can be unit-tested (see prisma-tenant.extension.spec.ts)
 * without spinning up a real Prisma client. Returns the args to run the
 * query with, or throws to fail closed.
 */
export function applyTenantScoping(
  model: string,
  operation: string,
  args: { where?: unknown; data?: unknown },
  auth: RequestAuthContext | undefined,
): { where?: unknown; data?: unknown } {
  const config = TENANT_SCOPED_MODELS[model];
  if (!config) {
    return args;
  }

  if (!auth) {
    throw new Error(
      `Tenant scoping violation: ${model}.${operation} was called with no request auth context set. ` +
        'This model is tenant-scoped and requires either tenant or admin context.',
    );
  }

  if (auth.mode === 'admin') {
    return args;
  }

  const scope = scopePairsFor(config, auth);
  const scopedArgs = { ...args };

  if (READ_OR_FILTER_OPERATIONS.has(operation)) {
    scopedArgs.where = mergeWhereScope(model, scopedArgs.where, scope);
  } else if (CREATE_OPERATIONS.has(operation)) {
    scopedArgs.data = mergeCreateData(model, scopedArgs.data, scope);
  } else if (CREATE_MANY_OPERATIONS.has(operation)) {
    const items = (
      (scopedArgs.data as Record<string, unknown>[] | undefined) ?? []
    ).map((item) => ({ ...item, ...scope }));
    scopedArgs.data = items;
  }

  return scopedArgs;
}

/**
 * Creates the Prisma Client Extension that enforces tenant scoping.
 *
 * Fails closed: querying a tenant-scoped model with no auth context at all
 * (e.g. a route handler that forgot a guard) throws rather than silently
 * running unscoped. Admin-mode requests intentionally bypass app-level
 * scoping (platform admins manage all tenants) and rely on the RLS
 * `*_admin_all` policies for DB-level protection instead.
 */
export function createTenantScopingExtension(
  getAuth: () => RequestAuthContext | undefined,
) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'tenant-scoping',
      query: {
        $allModels: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations(params: any) {
            const { model, operation, args, query } = params as {
              model?: string;
              operation: string;
              args: { where?: unknown; data?: unknown };
              query: (args: unknown) => Promise<unknown>;
            };
            if (!model) {
              return query(args);
            }
            const scopedArgs = applyTenantScoping(
              model,
              operation,
              args,
              getAuth(),
            );
            return query(scopedArgs);
          },
        },
      },
    }),
  );
}
