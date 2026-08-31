import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequestContextService } from '../../database/tenant-context';
import type { ApplicantJwtPayload } from '../../modules/applicant-tokens/applicant-jwt.strategy';

/**
 * Guards ApplicantSessionModule's routes — a short-lived token scoped to
 * exactly one applicant, meant to reach an untrusted browser (the client
 * capture SDK), never the tenant's own long-lived X-API-Key. Mirrors
 * AdminJwtGuard's shape exactly, activating the 'applicant-jwt' Passport
 * strategy instead of the default 'jwt' one admin uses.
 *
 * Sets 'applicant' auth mode, which RequestTransactionInterceptor treats
 * the same as 'tenant' mode for opening a tenant-scoped transaction (same
 * tenantId/environment auto-scoping) — the *finer* restriction to this one
 * applicant is enforced by ApplicantSessionModule itself, not here or by
 * the Prisma tenant-scoping extension. See the applicant-session plan.
 */
@Injectable()
export class ApplicantTokenGuard extends AuthGuard('applicant-jwt') {
  constructor(private readonly requestContext: RequestContextService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const activated = (await super.canActivate(context)) as boolean;
    if (!activated) return false;

    const request = context
      .switchToHttp()
      .getRequest<{ user: ApplicantJwtPayload }>();
    this.requestContext.setAuth({
      mode: 'applicant',
      tenantId: request.user.tenantId,
      environment: request.user.environment,
      applicantId: request.user.sub,
    });
    return true;
  }
}
