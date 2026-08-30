import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBusinessDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalId?: string;

  // Bank-declared, for the bank's own record-keeping only — never compared
  // against OCR results or used in any decisioning (that's Phase 4 scope).
  @IsOptional()
  @IsString()
  @MaxLength(300)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  commercialRegistrationNumber?: string;
}
