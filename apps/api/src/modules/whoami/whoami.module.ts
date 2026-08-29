import { Module } from '@nestjs/common';
import { WhoamiController } from './whoami.controller';

@Module({
  controllers: [WhoamiController],
})
export class WhoamiModule {}
