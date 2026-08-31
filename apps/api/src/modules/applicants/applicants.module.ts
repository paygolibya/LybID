import { Module } from '@nestjs/common';
import { AdminApplicantsController } from './admin-applicants.controller';
import { ApplicantsController } from './applicants.controller';
import { ApplicantsService } from './applicants.service';

@Module({
  controllers: [ApplicantsController, AdminApplicantsController],
  providers: [ApplicantsService],
  exports: [ApplicantsService],
})
export class ApplicantsModule {}
