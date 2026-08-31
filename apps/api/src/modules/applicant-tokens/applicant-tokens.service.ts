import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.validation';
import { ApplicantsService } from '../applicants/applicants.service';

export interface IssuedApplicantToken {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class ApplicantTokensService {
  constructor(
    private readonly applicantsService: ApplicantsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Only callable behind ApiKeyGuard (see the controller) — a tenant's own
   * trusted backend mints this on an applicant's behalf, then hands the
   * resulting token to the browser. Never called by the browser itself.
   */
  async issue(
    applicantId: string,
    tenantId: string,
    environment: 'LIVE' | 'TEST',
  ): Promise<IssuedApplicantToken> {
    // Resolving through the (extension-scoped) ApplicantsService both
    // confirms the applicant exists and prevents cross-tenant FK smuggling
    // — same pattern every other cross-entity lookup in this codebase uses.
    const applicant = await this.applicantsService.getOrThrow(applicantId);

    const expiresIn = this.config.get('APPLICANT_TOKEN_EXPIRES_IN', {
      infer: true,
    });
    const token = await this.jwt.signAsync(
      {
        sub: applicant.id,
        tenantId,
        environment,
      },
      { expiresIn },
    );

    return { token, expiresAt: expiresInToDate(expiresIn) };
  }
}

/** Mirrors what jsonwebtoken's own `ms`-based expiresIn parsing accepts
 * closely enough for the common cases this project uses ("30m", "8h", etc.)
 * — used only to report expiresAt back to the caller for display/UX, the
 * token's own baked-in `exp` claim is what's actually enforced. */
function expiresInToDate(expiresIn: string): Date {
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(expiresIn.trim());
  if (!match) {
    // Unrecognized format (e.g. a raw number of seconds as a string) —
    // fall back to treating it as seconds, jsonwebtoken's own default.
    const seconds = Number(expiresIn);
    return new Date(
      Date.now() + (Number.isFinite(seconds) ? seconds : 0) * 1000,
    );
  }
  const value = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return new Date(Date.now() + value * unitMs[match[2]]);
}
