import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Tenant } from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateTenantDto): Promise<Tenant> {
    const tx = this.requestContext.requireTx();

    const existing = await tx.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException(
        `A tenant with slug "${dto.slug}" already exists`,
      );
    }

    const tenant = await tx.tenant.create({
      data: { name: dto.name, slug: dto.slug },
    });

    const { adminId } = this.requestContext.requireAuth() as {
      mode: 'admin';
      adminId: string;
    };
    await this.auditLog.record({
      actorType: 'platform_admin',
      actorId: adminId,
      action: 'tenant.created',
      targetType: 'tenant',
      targetId: tenant.id,
      metadata: { name: tenant.name, slug: tenant.slug },
    });

    return tenant;
  }

  async list(): Promise<Tenant[]> {
    const tx = this.requestContext.requireTx();
    return tx.tenant.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOrThrow(id: string): Promise<Tenant> {
    const tx = this.requestContext.requireTx();
    const tenant = await tx.tenant.findUnique({ where: { id } });
    if (!tenant || tenant.deletedAt) {
      throw new NotFoundException(`Tenant ${id} not found`);
    }
    return tenant;
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED'): Promise<Tenant> {
    await this.getOrThrow(id);
    const tx = this.requestContext.requireTx();
    const tenant = await tx.tenant.update({ where: { id }, data: { status } });

    const { adminId } = this.requestContext.requireAuth() as {
      mode: 'admin';
      adminId: string;
    };
    await this.auditLog.record({
      actorType: 'platform_admin',
      actorId: adminId,
      action: status === 'ACTIVE' ? 'tenant.activated' : 'tenant.suspended',
      targetType: 'tenant',
      targetId: tenant.id,
    });

    return tenant;
  }
}
