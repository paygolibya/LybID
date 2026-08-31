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

    // Exhaustive switch, not if/else — an if/else here once silently
    // treated "not tenant" as "must be admin", which would have opened an
    // ADMIN transaction (bypassing all tenant scoping) for the first mode
    // added beyond those original two. The `never` in default makes a
    // future mode added without updating this dispatch a compile error
    // instead of a silent security gap.
    switch (auth.mode) {
      case 'tenant':
      case 'applicant':
        // Both carry the same tenantId — applicant-mode's *finer*
        // restriction (to one specific applicant) is enforced by the
        // consuming module itself, not at this layer. See the
        // applicant-session plan.
        return from(
          this.prisma.openTenantTransaction(auth.tenantId, async (tx) => {
            this.requestContext.setTx(tx);
            return firstValueFrom(next.handle(), { defaultValue: undefined });
          }),
        );
      case 'admin':
        return from(
          this.prisma.openAdminTransaction(async (tx) => {
            this.requestContext.setTx(tx);
            return firstValueFrom(next.handle(), { defaultValue: undefined });
          }),
        );
      default: {
        const _exhaustive: never = auth;
        throw new Error(
          `Unhandled auth mode in RequestTransactionInterceptor: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }
}
