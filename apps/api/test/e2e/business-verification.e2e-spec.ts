import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { OcrClientService } from '../../src/modules/documents/ocr-client/ocr-client.service';
import {
  createBusiness,
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
// (business-file-validation.util.ts) accepts it as a genuine image.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Business verification -> async OCR (e2e, stubbed OCR client)', () => {
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
    // Same cross-spec-file BullMQ lesson as document-upload.e2e-spec.ts and
    // biometric-check.e2e-spec.ts (see README's Phase 2 section) — a
    // delayed retry from this file's sidecar-down test can still be
    // sitting in Redis when Jest moves to the next spec file. Flush here,
    // not just in beforeEach.
    await resetQueue();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await resetQueue();
    await seedAdmin(owner);
    adminToken = await loginAsTestAdmin(app);
    extractMock.mockReset();
  });

  it('uploads a commercial registration document, processes it async, and reaches EXTRACTED with high-confidence fields', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-kyb-happy',
    );
    const businessId = await createBusiness(app, tenant.token, {
      externalId: 'biz-1',
      legalName: 'Tripoli Trading Co.',
    });

    extractMock.mockResolvedValue({
      rawText: 'اسم الشركة شركة طرابلس للتجارة',
      fields: [
        { name: 'company_name', value: 'شركة طرابلس للتجارة', confidence: 0.9 },
      ],
      overallConfidence: 0.9,
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'COMMERCIAL_REGISTRATION')
      .attach('file', TINY_PNG, 'commercial-registration.png')
      .expect(202);

    expect(uploadRes.body.status).toBe('UPLOADED');
    const documentId = uploadRes.body.id as string;

    const result = await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/business-documents/${documentId}`)
        .set('X-API-Key', tenant.token)
        .expect(200);
      return res.body.status !== 'UPLOADED' && res.body.status !== 'PROCESSING'
        ? res.body
        : false;
    });

    expect(result.status).toBe('EXTRACTED');
    expect(result.latestExtraction.overallConfidence).toBe(0.9);
    expect(result.latestExtraction.fields[0].name).toBe('company_name');
    expect(extractMock).toHaveBeenCalledTimes(1);
  });

  it('flags a low-confidence extraction as NEEDS_REVIEW instead of EXTRACTED', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-kyb-lowconf',
    );
    const businessId = await createBusiness(app, tenant.token, {
      externalId: 'biz-2',
    });

    extractMock.mockResolvedValue({
      rawText: 'blurry unreadable text',
      fields: [{ name: 'tax_number', value: '???', confidence: 0.3 }],
      overallConfidence: 0.3,
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'TAX_ID')
      .attach('file', TINY_PNG, 'tax-id.png')
      .expect(202);

    const result = await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/business-documents/${uploadRes.body.id}`)
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
      'bank-kyb-sidecar-down',
    );
    const businessId = await createBusiness(app, tenant.token, {
      externalId: 'biz-3',
    });

    extractMock.mockRejectedValue(
      new Error('OCR extraction failed with status 503'),
    );

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'CHAMBER_OF_COMMERCE')
      .attach('file', TINY_PNG, 'chamber.png')
      .expect(202);

    const result = await waitFor(
      async () => {
        const res = await request(app.getHttpServer())
          .get(`/v1/business-documents/${uploadRes.body.id}`)
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
      'bank-kyb-corrupt',
    );
    const businessId = await createBusiness(app, tenant.token, {
      externalId: 'biz-4',
    });

    await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'TAX_ID')
      .attach('file', Buffer.from('not actually an image'), 'tax-id.png')
      .expect(400);

    expect(extractMock).not.toHaveBeenCalled();
  });

  it('rejects a document upload for a cross-tenant businessId (404, not the leaked resource)', async () => {
    const tenantA = await createTenantWithApiKey(app, adminToken, 'bank-kyb-a');
    const tenantB = await createTenantWithApiKey(app, adminToken, 'bank-kyb-b');
    const businessOfA = await createBusiness(app, tenantA.token, {
      externalId: 'a-biz',
    });

    await request(app.getHttpServer())
      .post(`/v1/businesses/${businessOfA}/documents`)
      .set('X-API-Key', tenantB.token)
      .field('type', 'COMMERCIAL_REGISTRATION')
      .attach('file', TINY_PNG, 'commercial-registration.png')
      .expect(404);

    expect(extractMock).not.toHaveBeenCalled();
  });

  it("tenant B cannot fetch tenant A's business (404, not the leaked resource)", async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-kyb-iso-a',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-kyb-iso-b',
    );
    const businessOfA = await createBusiness(app, tenantA.token, {
      externalId: 'a-biz-2',
    });

    await request(app.getHttpServer())
      .get(`/v1/businesses/${businessOfA}`)
      .set('X-API-Key', tenantB.token)
      .expect(404);
  });
});
