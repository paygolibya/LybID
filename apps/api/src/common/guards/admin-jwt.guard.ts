import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequestContextService } from '../../database/tenant-context';
import type { AdminJwtPayload } from '../../modules/admin-auth/jwt.strategy';

/**
 * Guards `/admin/*` routes (Marsa-internal tenant/API-key management, and
 * since Phase 7 the bank-facing admin dashboard's own tenant-scoped reads).
 * On success, sets the request auth context to admin mode, which
 * RequestTransactionInterceptor uses to open a transaction with
 * `app.is_admin` set instead of `app.tenant_id` — admin requests
 * intentionally bypass app-level tenant scoping and rely on the RLS
 * `*_admin_all` policies. `email` is carried through (not just `adminId`)
 * so admin-triggered actions — e.g. the Phase 7 review endpoints — can
 * record a real reviewer identity instead of client-supplied free text.
 */
@Injectable()
export class AdminJwtGuard extends AuthGuard('jwt') {
  constructor(private readonly requestContext: RequestContextService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const activated = (await super.canActivate(context)) as boolean;
    if (!activated) return false;

    const request = context
      .switchToHttp()
      .getRequest<{ user: AdminJwtPayload }>();
    this.requestContext.setAuth({
      mode: 'admin',
      adminId: request.user.sub,
      email: request.user.email,
    });
    return true;
  }
}
