import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../config/env.validation';
import { PrismaService } from '../../database/prisma.service';
import { RequestContextService } from '../../database/tenant-context';
import {
  extractKeyPrefix,
  verifyApiKey,
} from '../../modules/api-keys/api-key-token.util';

/**
 * Authenticates the tenant-facing API surface via the `X-API-Key` header.
 *
 * The initial lookup-by-prefix is the one documented, intentionally-unscoped
 * query in the system (see PrismaService.runAuthBootstrap and the Phase 0
 * plan) — there is no tenant context yet at this point, so it cannot go
 * through the app-level tenant-scoping extension. It is protected instead by
 * the DB-level `*_auth_bootstrap_select` RLS policies.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly requestContext: RequestContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.header('x-api-key');
    if (!presented) {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const prefix = extractKeyPrefix(presented);
    if (!prefix) {
      throw new UnauthorizedException('Malformed API key');
    }

    const pepper = this.config.get('API_KEY_PEPPER', { infer: true });

    const record = await this.prisma.runAuthBootstrap((tx) =>
      tx.apiKey.findUnique({
        where: { keyPrefix: prefix },
        include: { tenant: true },
      }),
    );

    if (!record || !verifyApiKey(presented, record.keyHash, pepper)) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (record.status !== 'ACTIVE') {
      throw new UnauthorizedException('API key has been revoked');
    }
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('API key has expired');
    }
    if (record.tenant.status !== 'ACTIVE') {
      throw new UnauthorizedException('Tenant account is suspended');
    }

    this.requestContext.setAuth({
      mode: 'tenant',
      tenantId: record.tenantId,
      environment: record.environment,
      apiKeyId: record.id,
    });

    return true;
  }
}
