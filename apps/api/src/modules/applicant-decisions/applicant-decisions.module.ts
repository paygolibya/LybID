import { Module } from '@nestjs/common';
import { ApplicantsModule } from '../applicants/applicants.module';
import { ApplicantDecisionsController } from './applicant-decisions.controller';
import { ApplicantDecisionsService } from './applicant-decisions.service';

@Module({
  imports: [ApplicantsModule],
  controllers: [ApplicantDecisionsController],
  providers: [ApplicantDecisionsService],
  exports: [ApplicantDecisionsService],
})
export class ApplicantDecisionsModule {}
