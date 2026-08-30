import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { createTenantScopingExtension } from './prisma-tenant.extension';
import type {
  ExtendedPrismaClient,
  ScopedTransactionClient,
} from './prisma-types';
import { RequestAuthContext, RequestContextService } from './tenant-context';

/**
 * Owns two things:
 *  - `client`: the tenant-scoping-extended Prisma client, connected as the
 *    non-owner `lybid_app` runtime role (RUNTIME_DATABASE_URL) so RLS
 *    policies apply. This is what RequestTransactionInterceptor opens the
 *    per-request transaction on.
 *  - `runAuthBootstrap`: the *one* documented path that intentionally
 *    bypasses the app-level tenant-scoping extension (there is no tenant
 *    context yet when validating an incoming API key). It uses the raw,
 *    unextended client and relies entirely on the DB-level
 *    `app.auth_bootstrap` RLS policy for protection — see
 *    prisma/migrations/*_rls_setup.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly rawClient: PrismaClient;
  readonly client: ExtendedPrismaClient;

  constructor(
    configService: ConfigService<Env, true>,
    private readonly requestContext: RequestContextService,
  ) {
    this.rawClient = new PrismaClient({
      datasourceUrl: configService.get('RUNTIME_DATABASE_URL', { infer: true }),
    });
    this.client = this.rawClient.$extends(
      createTenantScopingExtension(() => this.requestContext.getAuth()),
    ) as ExtendedPrismaClient;
  }

  async onModuleInit(): Promise<void> {
    await this.rawClient.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.rawClient.$disconnect();
  }

  async runAuthBootstrap<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.rawClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.auth_bootstrap', 'true', true)`;
      return fn(tx as unknown as PrismaClient);
    });
  }

  async openTenantTransaction<T>(
    tenantId: string,
    fn: (tx: ScopedTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  async openAdminTransaction<T>(
    fn: (tx: ScopedTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_admin', 'true', true)`;
      return fn(tx);
    });
  }

  /**
   * The tenant-scoped entry point for non-HTTP code (BullMQ processors,
   * cron, CLI scripts) — anything that needs the same guarantees an HTTP
   * request gets (CLS auth context set, tenant-scoped transaction, RLS GUC)
   * without a guard/interceptor to set them up first.
   *
   * Manufactures a fresh CLS context (`runInNewContext`), populates it the
   * same way `ApiKeyGuard` + `RequestTransactionInterceptor` would for a
   * real request, then hands the caller a scoped transaction. Callers can
   * then use `requestContext.requireTx()` from ordinary application
   * services exactly as HTTP handlers do — no parallel, weaker data-access
   * path for background jobs.
   */
  async runAsTenant<T>(
    auth: Extract<RequestAuthContext, { mode: 'tenant' }>,
    fn: (tx: ScopedTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.requestContext.runInNewContext(async () => {
      this.requestContext.setAuth(auth);
      return this.openTenantTransaction(auth.tenantId, async (tx) => {
        this.requestContext.setTx(tx);
        return fn(tx);
      });
    });
  }
}
