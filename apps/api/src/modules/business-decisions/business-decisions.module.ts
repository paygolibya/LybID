import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AdminBusinessDecisionsController } from './admin-business-decisions.controller';
import { BusinessDecisionsController } from './business-decisions.controller';
import { BusinessDecisionsService } from './business-decisions.service';

@Module({
  imports: [BusinessesModule, AuditLogModule],
  controllers: [BusinessDecisionsController, AdminBusinessDecisionsController],
  providers: [BusinessDecisionsService],
  exports: [BusinessDecisionsService],
})
export class BusinessDecisionsModule {}
