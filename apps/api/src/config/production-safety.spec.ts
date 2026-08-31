import type { ConfigService } from '@nestjs/config';
import { assertProductionSecretsAreNotPlaceholders } from './production-safety';
import type { Env } from './env.validation';

// A minimal fake, not a real NestJS ConfigService — only `.get()` is used
// by the function under test.
function fakeConfig(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

const REAL_SECRETS: Partial<Env> = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-genuinely-random-64-char-secret-generated-for-this-deployment',
  API_KEY_PEPPER: 'another-genuinely-random-secret-for-this-deployment',
  APPLICANT_TOKEN_SECRET: 'yet-another-real-secret-value-here',
  ADMIN_BOOTSTRAP_PASSWORD: 'a-real-strong-password-set-by-ops',
};

describe('assertProductionSecretsAreNotPlaceholders', () => {
  it('is a no-op outside production, even with every placeholder still set', () => {
    expect(() =>
      assertProductionSecretsAreNotPlaceholders(
        fakeConfig({
          NODE_ENV: 'development',
          JWT_SECRET: 'dev-only-change-me-jwt-secret',
          API_KEY_PEPPER: 'dev-only-change-me-api-key-pepper',
          APPLICANT_TOKEN_SECRET: 'dev-only-change-me-applicant-token-secret',
          ADMIN_BOOTSTRAP_PASSWORD: 'change-me-on-first-login',
        }),
      ),
    ).not.toThrow();
  });

  it('passes in production when every secret has been changed', () => {
    expect(() =>
      assertProductionSecretsAreNotPlaceholders(fakeConfig(REAL_SECRETS)),
    ).not.toThrow();
  });

  it('refuses to boot in production if JWT_SECRET is still the .env.example placeholder', () => {
    expect(() =>
      assertProductionSecretsAreNotPlaceholders(
        fakeConfig({
          ...REAL_SECRETS,
          JWT_SECRET: 'dev-only-change-me-jwt-secret',
        }),
      ),
    ).toThrow(/JWT_SECRET/);
  });

  it('refuses to boot in production if ADMIN_BOOTSTRAP_PASSWORD is still the placeholder', () => {
    expect(() =>
      assertProductionSecretsAreNotPlaceholders(
        fakeConfig({
          ...REAL_SECRETS,
          ADMIN_BOOTSTRAP_PASSWORD: 'change-me-on-first-login',
        }),
      ),
    ).toThrow(/ADMIN_BOOTSTRAP_PASSWORD/);
  });

  it('reports every offending secret at once, not just the first', () => {
    expect(() =>
      assertProductionSecretsAreNotPlaceholders(
        fakeConfig({
          ...REAL_SECRETS,
          JWT_SECRET: 'dev-only-change-me-jwt-secret',
          API_KEY_PEPPER: 'dev-only-change-me-api-key-pepper',
        }),
      ),
    ).toThrow(/JWT_SECRET.*API_KEY_PEPPER/);
  });
});
