import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { OcrClientService } from '../../src/modules/documents/ocr-client/ocr-client.service';
import {
  createApplicant,
  createTenantWithApiKey,
  createTestAppWithStubOcr,
  getOwnerClient,
  loginAsTestAdmin,
  resetDatabase,
  resetQueue,
  seedAdmin,
  waitFor,
} from './utils/test-app';

// A minimal valid 1x1 transparent PNG — real bytes, so magic-byte sniffing
// (file-validation.util.ts) accepts it as a genuine image.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Document upload -> async OCR (e2e, stubbed OCR client)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let adminToken: string;
  let extractMock: jest.Mock;

  beforeAll(async () => {
    owner = getOwnerClient();
    extractMock = jest.fn();
    const stub: Pick<OcrClientService, 'extract'> = { extract: extractMock };
    app = await createTestAppWithStubOcr(stub);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await resetQueue();
    await seedAdmin(owner);
    adminToken = await loginAsTestAdmin(app);
    extractMock.mockReset();
  });

  it('uploads a document, processes it async, and reaches EXTRACTED with high-confidence fields', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-upload-happy',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'cust-1',
    });

    extractMock.mockResolvedValue({
      rawText: 'P<LBYALFTAISI<<SEIF',
      fields: [{ name: 'number', value: 'N1234567', confidence: 0.98 }],
      overallConfidence: 0.95,
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);

    expect(uploadRes.body.status).toBe('UPLOADED');
    const documentId = uploadRes.body.id as string;

    const result = await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/documents/${documentId}`)
        .set('X-API-Key', tenant.token)
        .expect(200);
      return res.body.status !== 'UPLOADED' && res.body.status !== 'PROCESSING'
        ? res.body
        : false;
    });

    expect(result.status).toBe('EXTRACTED');
    expect(result.latestExtraction.overallConfidence).toBe(0.95);
    expect(result.latestExtraction.fields[0].name).toBe('number');
    expect(extractMock).toHaveBeenCalledTimes(1);
  });

  it('flags a low-confidence extraction as NEEDS_REVIEW instead of EXTRACTED', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-upload-lowconf',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'cust-2',
    });

    extractMock.mockResolvedValue({
      rawText: 'blurry unreadable text',
      fields: [{ name: 'full_name', value: '???', confidence: 0.3 }],
      overallConfidence: 0.3,
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'BIRTH_CERTIFICATE')
      .attach('file', TINY_PNG, 'cert.png')
      .expect(202);

    const result = await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/documents/${uploadRes.body.id}`)
        .set('X-API-Key', tenant.token)
        .expect(200);
      return res.body.status !== 'UPLOADED' && res.body.status !== 'PROCESSING'
        ? res.body
        : false;
    });

    expect(result.status).toBe('NEEDS_REVIEW');
  });

  it('marks the document FAILED and rethrows for BullMQ retry when the OCR sidecar errors', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-upload-sidecar-down',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'cust-3',
    });

    extractMock.mockRejectedValue(
      new Error('OCR extraction failed with status 503'),
    );

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);

    const result = await waitFor(
      async () => {
        const res = await request(app.getHttpServer())
          .get(`/v1/documents/${uploadRes.body.id}`)
          .set('X-API-Key', tenant.token)
          .expect(200);
        return res.body.status === 'FAILED' ? res.body : false;
      },
      { timeoutMs: 20_000 },
    );

    expect(result.status).toBe('FAILED');
  });

  it('rejects a non-image/PDF upload before it ever reaches the queue (magic-byte check)', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-upload-corrupt',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'cust-4',
    });

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'PASSPORT')
      .attach('file', Buffer.from('not actually an image'), 'passport.png')
      .expect(400);

    expect(extractMock).not.toHaveBeenCalled();
  });

  it('rejects a document upload for a cross-tenant applicantId (404, not the leaked resource)', async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-upload-a',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-upload-b',
    );
    const applicantOfA = await createApplicant(app, tenantA.token, {
      externalId: 'a-cust',
    });

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantOfA}/documents`)
      .set('X-API-Key', tenantB.token)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(404);

    expect(extractMock).not.toHaveBeenCalled();
  });
});
