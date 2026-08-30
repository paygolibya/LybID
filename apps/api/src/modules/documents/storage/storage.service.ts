import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import type { Env } from '../../../config/env.validation';

/**
 * Thin wrapper around the MinIO (self-hosted, S3-compatible) client, kept
 * behind this interface-shaped service rather than used directly so the
 * backend is swappable later without touching callers.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly client: MinioClient;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('MINIO_BUCKET', { infer: true });
    this.client = new MinioClient({
      endPoint: config.get('MINIO_ENDPOINT', { infer: true }),
      port: config.get('MINIO_PORT', { infer: true }),
      useSSL: config.get('MINIO_USE_SSL', { infer: true }),
      accessKey: config.get('MINIO_ACCESS_KEY', { infer: true }),
      secretKey: config.get('MINIO_SECRET_KEY', { infer: true }),
    });
  }

  async onModuleInit(): Promise<void> {
    const exists = await this.client
      .bucketExists(this.bucket)
      .catch(() => false);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
  }

  /** Builds a storage key that keeps a tenant's documents grouped and human-inspectable. */
  buildKey(
    tenantId: string,
    documentId: string,
    originalFilename: string,
  ): string {
    const safeName = originalFilename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 100);
    return `${tenantId}/${documentId}-${safeName}`;
  }

  async putObject(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }

  async getObject(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }
}
