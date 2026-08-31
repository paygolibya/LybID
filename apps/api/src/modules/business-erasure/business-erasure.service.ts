import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Business } from '@prisma/client';
import { RequestContextService } from '../../database/tenant-context';
import { AuditLogService } from '../audit-log/audit-log.service';
import { BusinessesService } from '../businesses/businesses.service';
import { StorageService } from '../documents/storage/storage.service';

// Mirrors ApplicantErasureService exactly, for Business/BusinessDocument.
@Injectable()
export class BusinessErasureService {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly businessesService: BusinessesService,
    private readonly storage: StorageService,
    private readonly auditLog: AuditLogService,
  ) {}

  async erase(businessId: string): Promise<Business> {
    const tx = this.requestContext.requireTx();
    const business = await this.businessesService.getOrThrow(businessId);

    const documents = await tx.businessDocument.findMany({
      where: { businessId: business.id },
    });
    for (const document of documents) {
      await this.storage.deleteObject(document.storageKey);
      await tx.businessDocumentExtraction.updateMany({
        where: { documentId: document.id },
        data: { rawText: null, fields: Prisma.DbNull },
      });
    }

    const erased = await tx.business.update({
      where: { id: business.id },
      data: {
        legalName: null,
        commercialRegistrationNumber: null,
        externalId: null,
        erasedAt: new Date(),
      },
    });

    await this.auditLog.recordForCurrentActor({
      action: 'business.erase',
      targetType: 'business',
      targetId: business.id,
      metadata: { documentCount: documents.length },
    });

    return erased;
  }
}
