import { Injectable, NotFoundException } from '@nestjs/common';
import type { BiometricCheck, Document, DocumentType } from '@prisma/client';
import { BiometricChecksService } from '../biometric-checks/biometric-checks.service';
import type { CreateBiometricCheckDto } from '../biometric-checks/dto/create-biometric-check.dto';
import { DocumentsService } from '../documents/documents.service';
import type { ValidatedFile } from '../documents/file-validation.util';

/**
 * Thin delegation layer over the existing DocumentsService/BiometricChecksService
 * — reuses all the upload/validation/queue logic those already have, adding
 * only: (a) applicantId comes from the token, never a URL param, for the
 * two creates, and (b) an ownership check on the two reads, since their
 * underlying services look up purely by resource id with no applicantId
 * filter. See the applicant-session plan for why this lives as a separate
 * module rather than new methods on the existing controllers.
 */
@Injectable()
export class ApplicantSessionService {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly biometricChecksService: BiometricChecksService,
  ) {}

  uploadDocument(
    applicantId: string,
    type: DocumentType,
    buffer: Buffer,
    originalFilename: string,
    validated: ValidatedFile,
  ): Promise<Document> {
    return this.documentsService.upload({
      applicantId,
      type,
      buffer,
      originalFilename,
      validated,
      apiKeyId: undefined, // no API key — this came from an applicant-session token
    });
  }

  async getDocument(id: string, applicantId: string) {
    const result = await this.documentsService.getWithLatestExtraction(id);
    if (result.applicantId !== applicantId) {
      // 404, not 403 — don't confirm the resource exists for an applicant
      // it doesn't belong to. Same idiom used everywhere else cross-tenant
      // (see e.g. document-upload.e2e-spec.ts's "404, not the leaked
      // resource" tests).
      throw new NotFoundException(`Document ${id} not found`);
    }
    return result;
  }

  createBiometricCheck(
    applicantId: string,
    dto: CreateBiometricCheckDto,
  ): Promise<BiometricCheck> {
    return this.biometricChecksService.create({
      ...dto,
      applicantId,
      apiKeyId: undefined,
    });
  }

  async getBiometricCheck(
    id: string,
    applicantId: string,
  ): Promise<BiometricCheck> {
    const result = await this.biometricChecksService.getOrThrow(id);
    if (result.applicantId !== applicantId) {
      throw new NotFoundException(`Biometric check ${id} not found`);
    }
    return result;
  }
}
