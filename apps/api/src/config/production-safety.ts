import type { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

// Mirrors .env.example's own placeholder values exactly — the point isn't
// pattern-matching "looks like a dev secret", it's catching the single
// most damaging real mistake this platform could ship with: copying
// .env.example into a production deployment without actually generating
// real secrets. Checked once at boot, not on every request.
const PLACEHOLDER_VALUES = {
  JWT_SECRET: 'dev-only-change-me-jwt-secret',
  API_KEY_PEPPER: 'dev-only-change-me-api-key-pepper',
  APPLICANT_TOKEN_SECRET: 'dev-only-change-me-applicant-token-secret',
  ADMIN_BOOTSTRAP_PASSWORD: 'change-me-on-first-login',
} as const satisfies Partial<Record<keyof Env, string>>;

/**
 * Refuses to boot in production with an unchanged .env.example secret.
 * A no-op outside NODE_ENV=production — every one of these placeholder
 * values is exactly what local dev and the e2e/CI test suites already use
 * on purpose, so this can't (and shouldn't) run there.
 */
export function assertProductionSecretsAreNotPlaceholders(
  config: ConfigService<Env, true>,
): void {
  if (config.get('NODE_ENV', { infer: true }) !== 'production') return;

  const offending = (
    Object.entries(PLACEHOLDER_VALUES) as [keyof Env, string][]
  ).filter(
    ([key, placeholder]) => config.get(key, { infer: true }) === placeholder,
  );
  if (offending.length > 0) {
    const names = offending.map(([key]) => key).join(', ');
    throw new Error(
      `Refusing to start in production: ${names} still ${
        offending.length === 1 ? 'has' : 'have'
      } its .env.example placeholder value. Generate real secrets before deploying.`,
    );
  }
}
