import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Document } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import {
  CurrentTenant,
  CurrentTenantInfo,
} from '../../common/decorators/current-tenant.decorator';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import {
  MAX_DOCUMENT_BYTES,
  validateDocumentFile,
} from './file-validation.util';

@ApiTags('documents')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('applicants/:applicantId/documents')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }),
  )
  async upload(
    @Param('applicantId') applicantId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: CurrentTenantInfo,
  ): Promise<Document> {
    const validated = await validateDocumentFile(file.buffer, dto.type);

    return this.documentsService.upload({
      applicantId,
      type: dto.type,
      buffer: file.buffer,
      originalFilename: file.originalname,
      validated,
      apiKeyId: tenant.apiKeyId,
    });
  }

  @Get('documents/:id')
  get(@Param('id') id: string) {
    return this.documentsService.getWithLatestExtraction(id);
  }
}
