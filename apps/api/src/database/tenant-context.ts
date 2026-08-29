import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { ScopedTransactionClient } from './prisma-types';

export type RequestAuthContext =
  | {
      mode: 'tenant';
      tenantId: string;
      environment: 'LIVE' | 'TEST';
      apiKeyId: string;
    }
  | { mode: 'admin'; adminId: string };

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
}
