import { DecisionStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

// Phase 4: this filter *is* the review queue (?decisionStatus=NEEDS_REVIEW)
// — no separate "review queue" resource, see the Phase 4 plan.
export class ListApplicantsDto {
  @IsOptional()
  @IsEnum(DecisionStatus)
  decisionStatus?: DecisionStatus;
}
