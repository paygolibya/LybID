import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import {
  isNotFoundStorageError,
  StorageService,
} from '../documents/storage/storage.service';
import { BusinessDocumentsService } from './business-documents.service';

// Mirrors AdminDocumentsController exactly, for BusinessDocument — reuses
// StorageService from DocumentsModule, same reuse BusinessDocumentsModule
// already relies on for uploads.
@ApiTags('admin-business-documents')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/tenants/:tenantId/business-documents')
export class AdminBusinessDocumentsController {
  constructor(
    private readonly businessDocumentsService: BusinessDocumentsService,
    private readonly storageService: StorageService,
  ) {}

  @Get(':id/image')
  async getImage(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await this.businessDocumentsService.getForTenantOrThrow(
      tenantId,
      id,
    );
    // See AdminDocumentsController.getImage()'s identical comment —
    // erasure (BusinessesService.erase()) can delete the MinIO object
    // while the row survives.
    let buffer: Buffer;
    try {
      buffer = await this.storageService.getObject(document.storageKey);
    } catch (err) {
      if (isNotFoundStorageError(err)) {
        throw new NotFoundException(
          `Business document ${id}'s image has been erased`,
        );
      }
      throw err;
    }
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${document.originalFilename}"`,
    });
    return new StreamableFile(buffer);
  }
}
