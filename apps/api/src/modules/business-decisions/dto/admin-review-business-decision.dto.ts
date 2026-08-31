import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Mirrors AdminReviewApplicantDecisionDto exactly, for Business.
export class AdminReviewBusinessDecisionDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
