import { DocumentType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UploadDocumentDto {
  @IsEnum(DocumentType)
  type!: DocumentType;
}
