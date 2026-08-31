import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { ScopedTransactionClient } from './prisma-types';

export type RequestAuthContext =
  | {
      mode: 'tenant';
      tenantId: string;
      environment: 'LIVE' | 'TEST';
      // Optional — a background worker job that originated from an
      // applicant-session upload (no API key involved) reconstructs this
      // context with apiKeyId omitted. Never consulted by any
      // scoping/RLS decision, only carried through as audit metadata —
      // see the applicant-session plan for why this is safe.
      apiKeyId?: string;
    }
  | { mode: 'admin'; adminId: string; email: string }
  // A short-lived token scoped to exactly one applicant, minted via
  // ApplicantTokensModule and consumed only by ApplicantSessionModule's
  // routes — see the applicant-session plan for the full design. Carries
  // the same tenantId/environment shape as 'tenant' mode (so it gets the
  // same tenant+environment auto-scoping) plus the one applicant it's
  // restricted to; that finer restriction is enforced by the consuming
  // module itself, not by the Prisma tenant-scoping extension.
  | {
      mode: 'applicant';
      tenantId: string;
      environment: 'LIVE' | 'TEST';
      applicantId: string;
    };

export interface RequestClsStore {
  auth?: RequestAuthContext;
  tx?: ScopedTransactionClient;
  [key: symbol]: unknown;
}

/**
 * Thin wrapper around nestjs-cls so the rest of the app never touches
 * ClsService keys directly. `auth` is set by the guards (ApiKeyGuard /
 * AdminJwtGuard); `tx` is set by RequestTransactionInterceptor, which opens
 * it *inside* the SET LOCAL-scoped transaction described in the Phase 0 plan.
 */
@Injectable()
export class RequestContextService {
  constructor(private readonly cls: ClsService<RequestClsStore>) {}

  setAuth(auth: RequestAuthContext): void {
    this.cls.set('auth', auth);
  }

  getAuth(): RequestAuthContext | undefined {
    return this.cls.get('auth');
  }

  requireAuth(): RequestAuthContext {
    const auth = this.getAuth();
    if (!auth) {
      throw new Error(
        'RequestContextService.requireAuth() called with no auth context set',
      );
    }
    return auth;
  }

  setTx(tx: ScopedTransactionClient): void {
    this.cls.set('tx', tx);
  }

  /** The transaction-scoped Prisma client for the current request, or undefined outside a request (e.g. the seed script). */
  getTx(): ScopedTransactionClient | undefined {
    return this.cls.get('tx');
  }

  requireTx(): ScopedTransactionClient {
    const tx = this.getTx();
    if (!tx) {
      throw new Error(
        'RequestContextService.requireTx() called with no transaction open for this request',
      );
    }
    return tx;
  }

  /**
   * Runs `fn` inside a brand new CLS (AsyncLocalStorage) context — the
   * entry point non-HTTP code (BullMQ processors, cron, CLI scripts) must
   * use before calling `setAuth`/`setTx`, since there is no request
   * middleware to open one for them. See `PrismaService.runAsTenant`, the
   * only current caller.
   */
  runInNewContext<T>(fn: () => Promise<T>): Promise<T> {
    return this.cls.run(fn);
  }
}
