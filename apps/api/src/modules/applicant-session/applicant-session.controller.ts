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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { BiometricCheck, Document } from '@prisma/client';
import { ApplicantTokenGuard } from '../../common/guards/applicant-token.guard';
import {
  CurrentApplicant,
  CurrentApplicantInfo,
} from '../../common/decorators/current-applicant.decorator';
import { CreateBiometricCheckDto } from '../biometric-checks/dto/create-biometric-check.dto';
import { UploadDocumentDto } from '../documents/dto/upload-document.dto';
import {
  MAX_DOCUMENT_BYTES,
  validateDocumentFile,
} from '../documents/file-validation.util';
import { ApplicantSessionService } from './applicant-session.service';

// Browser-facing surface for the client capture SDK — guarded only by the
// short-lived, single-applicant ApplicantTokenGuard, never the tenant's own
// X-API-Key. Completely separate route tree from /v1/applicants/:id/documents
// etc., which stay API-key-only and untouched. See the applicant-session plan.
@ApiTags('applicant-session')
@ApiBearerAuth()
@UseGuards(ApplicantTokenGuard)
@Controller('v1/applicant-session')
export class ApplicantSessionController {
  constructor(
    private readonly applicantSessionService: ApplicantSessionService,
  ) {}

  @Post('documents')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }),
  )
  async uploadDocument(
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentApplicant() applicant: CurrentApplicantInfo,
  ): Promise<Document> {
    const validated = await validateDocumentFile(file.buffer, dto.type);
    return this.applicantSessionService.uploadDocument(
      applicant.applicantId,
      dto.type,
      file.buffer,
      file.originalname,
      validated,
    );
  }

  @Get('documents/:id')
  getDocument(
    @Param('id') id: string,
    @CurrentApplicant() applicant: CurrentApplicantInfo,
  ) {
    return this.applicantSessionService.getDocument(id, applicant.applicantId);
  }

  @Post('biometric-checks')
  @HttpCode(HttpStatus.ACCEPTED)
  createBiometricCheck(
    @Body() dto: CreateBiometricCheckDto,
    @CurrentApplicant() applicant: CurrentApplicantInfo,
  ): Promise<BiometricCheck> {
    return this.applicantSessionService.createBiometricCheck(
      applicant.applicantId,
      dto,
    );
  }

  @Get('biometric-checks/:id')
  getBiometricCheck(
    @Param('id') id: string,
    @CurrentApplicant() applicant: CurrentApplicantInfo,
  ): Promise<BiometricCheck> {
    return this.applicantSessionService.getBiometricCheck(
      id,
      applicant.applicantId,
    );
  }
}
