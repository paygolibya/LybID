import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Mirrors ReviewApplicantDecisionDto, minus reviewerId — the admin routes
// source that from the authenticated admin's own JWT (see
// AdminApplicantDecisionsController), not client-supplied free text, now
// that a real reviewer identity (PlatformAdminUser.email) exists to use.
export class AdminReviewApplicantDecisionDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
