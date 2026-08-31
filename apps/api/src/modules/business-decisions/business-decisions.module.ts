import { Module } from '@nestjs/common';
import { BusinessesModule } from '../businesses/businesses.module';
import { BusinessDecisionsController } from './business-decisions.controller';
import { BusinessDecisionsService } from './business-decisions.service';

@Module({
  imports: [BusinessesModule],
  controllers: [BusinessDecisionsController],
  providers: [BusinessDecisionsService],
  exports: [BusinessDecisionsService],
})
export class BusinessDecisionsModule {}
