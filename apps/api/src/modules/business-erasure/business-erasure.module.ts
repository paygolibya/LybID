import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BusinessesModule } from '../businesses/businesses.module';
import { DocumentsModule } from '../documents/documents.module';
import { BusinessErasureController } from './business-erasure.controller';
import { BusinessErasureService } from './business-erasure.service';

@Module({
  imports: [BusinessesModule, DocumentsModule, AuditLogModule],
  controllers: [BusinessErasureController],
  providers: [BusinessErasureService],
})
export class BusinessErasureModule {}
