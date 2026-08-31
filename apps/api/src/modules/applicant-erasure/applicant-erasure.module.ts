import { Module } from '@nestjs/common';
import { ApplicantsModule } from '../applicants/applicants.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { DocumentsModule } from '../documents/documents.module';
import { ApplicantErasureController } from './applicant-erasure.controller';
import { ApplicantErasureService } from './applicant-erasure.service';

@Module({
  imports: [ApplicantsModule, DocumentsModule, AuditLogModule],
  controllers: [ApplicantErasureController],
  providers: [ApplicantErasureService],
})
export class ApplicantErasureModule {}
