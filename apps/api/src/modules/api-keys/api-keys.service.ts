import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiKey } from '@prisma/client';
import type { Env } from '../../config/env.validation';
import { RequestContextService } from '../../database/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { generateApiKey } from './api-key-token.util';
import type { CreateApiKeyDto } from './dto/create-api-key.dto';

export type PublicApiKey = Omit<ApiKey, 'keyHash'>;
export interface IssuedApiKey extends PublicApiKey {
  /** Plaintext token — present ONLY on this issuance response, never again. */
  token: string;
}

function toPublic(key: ApiKey): PublicApiKey {
  const { keyHash: _keyHash, ...rest } = key;
  return rest;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(tenantId: string, dto: CreateApiKeyDto): Promise<IssuedApiKey> {
    const tx = this.requestContext.requireTx();

    const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    const pepper = this.config.get('API_KEY_PEPPER', { infer: true });
    const generated = generateApiKey(dto.environment, pepper);
    const { adminId } = this.requestContext.requireAuth() as {
      mode: 'admin';
      adminId: string;
    };

    const created = await tx.apiKey.create({
      data: {
        tenantId,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        environment: dto.environment,
        scopes: dto.scopes ?? [],
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdByAdminId: adminId,
      },
    });

    await this.auditLog.record({
      actorType: 'platform_admin',
      actorId: adminId,
      action: 'api_key.issued',
      targetType: 'api_key',
      targetId: created.id,
      tenantId,
      metadata: {
        tenantId,
        environment: dto.environment,
        keyPrefix: generated.keyPrefix,
      },
    });

    return { ...toPublic(created), token: generated.plaintext };
  }

  async listForTenant(tenantId: string): Promise<PublicApiKey[]> {
    const tx = this.requestContext.requireTx();
    const keys = await tx.apiKey.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(toPublic);
  }

  async revoke(id: string): Promise<PublicApiKey> {
    const tx = this.requestContext.requireTx();
    const existing = await tx.apiKey.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`API key ${id} not found`);
    }

    const revoked = await tx.apiKey.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    const { adminId } = this.requestContext.requireAuth() as {
      mode: 'admin';
      adminId: string;
    };
    await this.auditLog.record({
      actorType: 'platform_admin',
      actorId: adminId,
      action: 'api_key.revoked',
      targetType: 'api_key',
      targetId: id,
      tenantId: existing.tenantId,
      metadata: { tenantId: existing.tenantId },
    });

    return toPublic(revoked);
  }
}
