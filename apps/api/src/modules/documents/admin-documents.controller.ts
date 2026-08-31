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
import { DocumentsService } from './documents.service';
import {
  isNotFoundStorageError,
  StorageService,
} from './storage/storage.service';

// The system's first-ever endpoint that serves a stored document back out
// — MinIO is otherwise purely internal (written by upload, read only by
// the OCR/biometrics sidecars). Deliberately a backend-proxied stream, not
// a presigned MinIO URL handed to the browser: the raw MinIO
// URL/credentials never reach the browser, and every view goes through the
// same AdminJwtGuard check as any other admin action, with nothing
// resembling a bearer URL that could leak via browser history/logs/a
// shared screen. Covers passport, birth certificate, and selfie — all
// three are rows in the same Document table (selfie via `type: SELFIE`,
// since Phase 2).
@ApiTags('admin-documents')
@ApiBearerAuth()
@UseGuards(AdminJwtGuard)
@Controller('admin/tenants/:tenantId/documents')
export class AdminDocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly storageService: StorageService,
  ) {}

  @Get(':id/image')
  async getImage(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await this.documentsService.getForTenantOrThrow(
      tenantId,
      id,
    );
    // Phase 8: a Document row can outlive its MinIO object now that
    // erasure (ApplicantsService.erase()) deletes the object but keeps the
    // row — storageKey is a required column, so it can't be nulled to
    // signal this. Translate the resulting not-found into a 404 rather
    // than an unhandled 500.
    let buffer: Buffer;
    try {
      buffer = await this.storageService.getObject(document.storageKey);
    } catch (err) {
      if (isNotFoundStorageError(err)) {
        throw new NotFoundException(`Document ${id}'s image has been erased`);
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
