import { Prisma } from '@prisma/client';
import type { RequestAuthContext } from './tenant-context';

/**
 * Per-model config for app-level auto-scoping. This is the *primary*
 * correctness layer (Postgres RLS, set up in the `2_rls_setup` migration, is
 * the DB-level defense-in-depth layer described in the Phase 0 plan).
 *
 * `scopeField` is the column on the model that identifies its tenant:
 * for most future models this will be `tenantId`; for `Tenant` itself it's
 * the row's own `id`.
 */
export const TENANT_SCOPED_MODELS: Record<string, { scopeField: string }> = {
  Tenant: { scopeField: 'id' },
  ApiKey: { scopeField: 'tenantId' },
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

function mergeWhereScope(
  where: unknown,
  scopeField: string,
  tenantId: string,
): Record<string, unknown> {
  const existing = (where ?? {}) as Record<string, unknown>;
  if (scopeField in existing && existing[scopeField] !== tenantId) {
    throw new Error(
      `Tenant scoping violation: query explicitly filtered ${scopeField}=${String(
        existing[scopeField],
      )} which does not match the authenticated tenant. Refusing to run.`,
    );
  }
  return { ...existing, [scopeField]: tenantId };
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

  const scopedArgs = { ...args };

  if (READ_OR_FILTER_OPERATIONS.has(operation)) {
    scopedArgs.where = mergeWhereScope(
      scopedArgs.where,
      config.scopeField,
      auth.tenantId,
    );
  } else if (CREATE_OPERATIONS.has(operation)) {
    const data = (scopedArgs.data ?? {}) as Record<string, unknown>;
    if (
      config.scopeField in data &&
      data[config.scopeField] !== auth.tenantId
    ) {
      throw new Error(
        `Tenant scoping violation: ${model}.create set ${config.scopeField}=${String(
          data[config.scopeField],
        )} which does not match the authenticated tenant.`,
      );
    }
    scopedArgs.data = { ...data, [config.scopeField]: auth.tenantId };
  } else if (CREATE_MANY_OPERATIONS.has(operation)) {
    const items = (
      (scopedArgs.data as Record<string, unknown>[] | undefined) ?? []
    ).map((item) => ({
      ...item,
      [config.scopeField]: auth.tenantId,
    }));
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
