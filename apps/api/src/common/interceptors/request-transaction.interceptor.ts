import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { from, Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../database/prisma.service';
import { RequestContextService } from '../../database/tenant-context';

/**
 * Opens the per-request Prisma transaction and sets the Postgres session GUC
 * (`app.tenant_id` or `app.is_admin`) that the RLS policies from
 * `2_rls_setup` key off of. Runs *after* ApiKeyGuard/AdminJwtGuard (guards
 * run before interceptors in Nest's pipeline), so `RequestContextService`
 * already has `auth` set by the time this runs — if it doesn't, the route
 * has no auth guard on it (e.g. /health, admin login) and there is nothing
 * to scope, so we just pass through.
 *
 * All downstream DB access for the request MUST go through
 * `RequestContextService.requireTx()`, not `PrismaService.client` directly,
 * or it will run outside the SET LOCAL-scoped transaction.
 */
@Injectable()
export class RequestTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const auth = this.requestContext.getAuth();
    if (!auth) {
      return next.handle();
    }

    if (auth.mode === 'tenant') {
      return from(
        this.prisma.openTenantTransaction(auth.tenantId, async (tx) => {
          this.requestContext.setTx(tx);
          return firstValueFrom(next.handle(), { defaultValue: undefined });
        }),
      );
    }

    return from(
      this.prisma.openAdminTransaction(async (tx) => {
        this.requestContext.setTx(tx);
        return firstValueFrom(next.handle(), { defaultValue: undefined });
      }),
    );
  }
}
