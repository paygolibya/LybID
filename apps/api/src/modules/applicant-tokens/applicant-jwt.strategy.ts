import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../config/env.validation';

export interface ApplicantJwtPayload {
  sub: string; // Applicant.id
  tenantId: string;
  environment: 'LIVE' | 'TEST';
}

/**
 * Explicitly named 'applicant-jwt' (mirrors jwt.strategy.ts's shape, but
 * that one defaults to Passport's implicit 'jwt' name) — the two strategies
 * must not collide, since AdminJwtGuard/ApplicantTokenGuard each need to
 * activate their own, verified against a different secret.
 */
@Injectable()
export class ApplicantJwtStrategy extends PassportStrategy(
  Strategy,
  'applicant-jwt',
) {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('APPLICANT_TOKEN_SECRET', { infer: true }),
    });
  }

  validate(payload: ApplicantJwtPayload): ApplicantJwtPayload {
    return payload;
  }
}
