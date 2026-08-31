import { Module } from '@nestjs/common';
import { AdminUsageController } from './admin-usage.controller';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Module({
  controllers: [UsageController, AdminUsageController],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
