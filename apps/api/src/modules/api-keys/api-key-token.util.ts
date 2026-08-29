import { randomBytes, timingSafeEqual, createHmac } from 'crypto';
import type { ApiKeyEnvironment } from '@prisma/client';

const PREFIX_LENGTH = 8;
const TOKEN_BYTES = 32;

export interface GeneratedApiKey {
  /** Full plaintext token — returned to the caller exactly once, never stored. */
  plaintext: string;
  /** First chars of the random portion, stored unhashed for lookup/display. */
  keyPrefix: string;
  /** HMAC-SHA256(pepper, plaintext) — what's actually stored in the DB. */
  keyHash: string;
}

function envSegment(environment: ApiKeyEnvironment): 'live' | 'test' {
  return environment === 'LIVE' ? 'live' : 'test';
}

export function generateApiKey(
  environment: ApiKeyEnvironment,
  pepper: string,
): GeneratedApiKey {
  const random = randomBytes(TOKEN_BYTES).toString('base64url');
  const plaintext = `lyb_${envSegment(environment)}_${random}`;
  const keyPrefix = random.slice(0, PREFIX_LENGTH);
  const keyHash = hashApiKey(plaintext, pepper);
  return { plaintext, keyPrefix, keyHash };
}

export function hashApiKey(plaintext: string, pepper: string): string {
  return createHmac('sha256', pepper).update(plaintext).digest('hex');
}

/** Extracts the lookup prefix from a presented token, or null if it's not shaped like a LybID key. */
export function extractKeyPrefix(presentedToken: string): string | null {
  const match = presentedToken.match(/^lyb_(?:live|test)_([A-Za-z0-9_-]+)$/);
  if (!match) return null;
  return match[1].slice(0, PREFIX_LENGTH);
}

export function verifyApiKey(
  presentedToken: string,
  storedHash: string,
  pepper: string,
): boolean {
  const computed = Buffer.from(hashApiKey(presentedToken, pepper), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}
