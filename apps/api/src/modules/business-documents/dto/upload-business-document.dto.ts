import { BusinessDocumentType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UploadBusinessDocumentDto {
  @IsEnum(BusinessDocumentType)
  type!: BusinessDocumentType;
}
