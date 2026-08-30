import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ApplicantsModule } from '../applicants/applicants.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { OcrClientService } from './ocr-client/ocr-client.service';
import {
  EXTRACTION_QUEUE_NAME,
  ExtractionQueue,
} from './queue/extraction.queue';
import { ExtractionProcessor } from './queue/extraction.processor';
import { StorageService } from './storage/storage.service';

@Module({
  imports: [
    ApplicantsModule,
    BullModule.registerQueue({ name: EXTRACTION_QUEUE_NAME }),
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    StorageService,
    ExtractionQueue,
    ExtractionProcessor,
    OcrClientService,
  ],
  exports: [DocumentsService, StorageService],
})
export class DocumentsModule {}
