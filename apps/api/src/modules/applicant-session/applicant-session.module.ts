import { Module } from '@nestjs/common';
import { BiometricChecksModule } from '../biometric-checks/biometric-checks.module';
import { DocumentsModule } from '../documents/documents.module';
import { ApplicantSessionController } from './applicant-session.controller';
import { ApplicantSessionService } from './applicant-session.service';

@Module({
  imports: [DocumentsModule, BiometricChecksModule],
  controllers: [ApplicantSessionController],
  providers: [ApplicantSessionService],
})
export class ApplicantSessionModule {}
