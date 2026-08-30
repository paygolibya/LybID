import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { fromBuffer as fileTypeFromBuffer } from 'file-type';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
]);

export interface ValidatedFile {
  mimeType: string;
  sha256: string;
}

/**
 * Validates an uploaded document file against its *actual* content, not the
 * client-supplied Content-Type header (which is trivially spoofable) —
 * sniffs the real file type from magic bytes via `file-type`. Rejects
 * undecodable/mismatched files early, before any OCR time is spent on them.
 */
export async function validateDocumentFile(
  buffer: Buffer,
): Promise<ValidatedFile> {
  if (buffer.length === 0) {
    throw new BadRequestException('Uploaded file is empty');
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new BadRequestException(
      `Uploaded file exceeds the ${MAX_DOCUMENT_BYTES / (1024 * 1024)}MB size limit`,
    );
  }

  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new BadRequestException(
      'Uploaded file is not a recognized JPEG, PNG, or PDF (checked by file content, not filename/header)',
    );
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  return { mimeType: detected.mime, sha256 };
}
