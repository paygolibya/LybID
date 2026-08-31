import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewApplicantDecisionDto {
  // Restricted to APPROVED/REJECTED, not the full DecisionStatus enum —
  // reviewing *into* NEEDS_REVIEW doesn't make sense, a review resolves it.
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  // No bank-staff identity system exists yet — free text the tenant's own
  // caller supplies, same posture as ApiKey.createdByAdminId elsewhere but
  // without an FK (there's no matching user table to reference).
  @IsString()
  @MaxLength(200)
  reviewerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
