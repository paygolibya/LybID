import { Injectable, NotFoundException } from '@nestjs/common';
import type { Business, Prisma } from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import type { CreateBusinessDto } from './dto/create-business.dto';

@Injectable()
export class BusinessesService {
  constructor(private readonly requestContext: RequestContextService) {}

  async create(dto: CreateBusinessDto): Promise<Business> {
    const tx = this.requestContext.requireTx();
    // tenantId/environment are required columns in the generated Prisma
    // types, but for tenant-mode requests they're auto-injected by the
    // tenant-scoping extension (prisma-tenant.extension.ts) before the
    // query reaches the DB — never set explicitly here. The cast reflects
    // that the extension, not this call site, satisfies those fields.
    return tx.business.create({
      data: {
        externalId: dto.externalId,
        legalName: dto.legalName,
        commercialRegistrationNumber: dto.commercialRegistrationNumber,
      } as Prisma.BusinessUncheckedCreateInput,
    });
  }

  async list(): Promise<Business[]> {
    const tx = this.requestContext.requireTx();
    return tx.business.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Scoped lookup used both by the GET endpoint and by BusinessDocumentsService
   * before attaching a document — resolving through this (extension-scoped)
   * query is what prevents cross-tenant FK smuggling: a businessId
   * belonging to another tenant resolves to null here, never reaching a
   * later insert.
   */
  async getOrThrow(id: string): Promise<Business> {
    const tx = this.requestContext.requireTx();
    const business = await tx.business.findUnique({ where: { id } });
    if (!business || business.deletedAt) {
      throw new NotFoundException(`Business ${id} not found`);
    }
    return business;
  }
}
