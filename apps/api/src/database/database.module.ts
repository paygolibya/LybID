import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { PrismaService } from './prisma.service';
import { RequestContextService } from './tenant-context';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
  ],
  providers: [PrismaService, RequestContextService],
  exports: [PrismaService, RequestContextService],
})
export class DatabaseModule {}
