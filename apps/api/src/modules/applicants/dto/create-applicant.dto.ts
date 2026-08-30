import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateApplicantDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalId?: string;

  // Bank-declared, for the bank's own record-keeping only — never compared
  // against OCR results or used in any decisioning (that's Phase 4 scope).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  lastName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}
