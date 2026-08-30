import { IsOptional, IsString } from 'class-validator';

export class CreateBiometricCheckDto {
  @IsString()
  selfieDocumentId!: string;

  // If omitted, the applicant's most recent PASSPORT-type Document is
  // auto-selected as the reference — simplifies client integration, since
  // there's normally exactly one passport per applicant from Phase 1.
  @IsOptional()
  @IsString()
  referenceDocumentId?: string;
}
