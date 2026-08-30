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
import type { BusinessDocument } from '@prisma/client';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import {
  CurrentTenant,
  CurrentTenantInfo,
} from '../../common/decorators/current-tenant.decorator';
import {
  MAX_BUSINESS_DOCUMENT_BYTES,
  validateBusinessDocumentFile,
} from './business-file-validation.util';
import { BusinessDocumentsService } from './business-documents.service';
import { UploadBusinessDocumentDto } from './dto/upload-business-document.dto';

@ApiTags('business-documents')
@ApiSecurity('apiKey')
@UseGuards(ApiKeyGuard)
@Controller('v1')
export class BusinessDocumentsController {
  constructor(
    private readonly businessDocumentsService: BusinessDocumentsService,
  ) {}

  @Post('businesses/:businessId/documents')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_BUSINESS_DOCUMENT_BYTES },
    }),
  )
  async upload(
    @Param('businessId') businessId: string,
    @Body() dto: UploadBusinessDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentTenant() tenant: CurrentTenantInfo,
  ): Promise<BusinessDocument> {
    const validated = await validateBusinessDocumentFile(file.buffer, dto.type);

    return this.businessDocumentsService.upload({
      businessId,
      type: dto.type,
      buffer: file.buffer,
      originalFilename: file.originalname,
      validated,
      apiKeyId: tenant.apiKeyId,
    });
  }

  @Get('business-documents/:id')
  get(@Param('id') id: string) {
    return this.businessDocumentsService.getWithLatestExtraction(id);
  }
}
