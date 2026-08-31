import { Module } from '@nestjs/common';
import { ApplicantsModule } from '../applicants/applicants.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AdminApplicantDecisionsController } from './admin-applicant-decisions.controller';
import { ApplicantDecisionsController } from './applicant-decisions.controller';
import { ApplicantDecisionsService } from './applicant-decisions.service';

@Module({
  imports: [ApplicantsModule, AuditLogModule],
  controllers: [
    ApplicantDecisionsController,
    AdminApplicantDecisionsController,
  ],
  providers: [ApplicantDecisionsService],
  exports: [ApplicantDecisionsService],
})
export class ApplicantDecisionsModule {}
