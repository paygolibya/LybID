import { Module } from '@nestjs/common';
import { ApplicantsModule } from '../applicants/applicants.module';
import { AdminApplicantDecisionsController } from './admin-applicant-decisions.controller';
import { ApplicantDecisionsController } from './applicant-decisions.controller';
import { ApplicantDecisionsService } from './applicant-decisions.service';

@Module({
  imports: [ApplicantsModule],
  controllers: [ApplicantDecisionsController, AdminApplicantDecisionsController],
  providers: [ApplicantDecisionsService],
  exports: [ApplicantDecisionsService],
})
export class ApplicantDecisionsModule {}
