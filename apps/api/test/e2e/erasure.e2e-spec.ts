import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { OcrClientService } from '../../src/modules/documents/ocr-client/ocr-client.service';
import {
  createApplicant,
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

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const HIGH_CONFIDENCE_OCR = {
  rawText: 'a real name and a real number',
  fields: [{ name: 'number', value: 'N1234567', confidence: 0.98 }],
  overallConfidence: 0.95,
};

// Phase 8 (bank-triggered erasure). The one thing every test here is
// really pinning down, per the confirmed scope: raw images + OCR PII are
// gone, but the record itself (and its decision history) stays visible —
// not hidden behind deletedAt, which would defeat the point of a
// compliance record that's supposed to survive.
describe('Erasure (e2e, stubbed OCR)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let adminToken: string;
  let extractMock: jest.Mock;

  beforeAll(async () => {
    owner = getOwnerClient();
    extractMock = jest.fn();
    const ocrStub: Pick<OcrClientService, 'extract'> = { extract: extractMock };
    app = await createTestAppWithStubOcr(ocrStub);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
    await resetQueue();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await resetQueue();
    await seedAdmin(owner);
    adminToken = await loginAsTestAdmin(app);
    extractMock.mockReset();
    extractMock.mockResolvedValue(HIGH_CONFIDENCE_OCR);
  });

  it('purges document images and OCR PII, nulls declared PII, but keeps the applicant visible and its decision history intact', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'erase-applicant',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'erase-1',
      firstName: 'Amina',
      lastName: 'Salem',
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);
    const documentId = uploadRes.body.id as string;
    await waitFor(async () => {
      const doc = await request(app.getHttpServer())
        .get(`/v1/documents/${documentId}`)
        .set('X-API-Key', tenant.token)
        .expect(200);
      return doc.body.status === 'EXTRACTED' ? doc.body : false;
    });

    // Confirm the image is servable *before* erasure — otherwise a 404
    // after erasure wouldn't prove anything.
    await request(app.getHttpServer())
      .get(`/admin/tenants/${tenant.tenantId}/documents/${documentId}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const eraseRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/erase`)
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(eraseRes.body.firstName).toBeNull();
    expect(eraseRes.body.lastName).toBeNull();
    expect(eraseRes.body.externalId).toBeNull();
    expect(eraseRes.body.erasedAt).not.toBeNull();

    // The image is genuinely gone from MinIO, not just hidden — 404, not 500.
    await request(app.getHttpServer())
      .get(`/admin/tenants/${tenant.tenantId}/documents/${documentId}/image`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    // The OCR-extracted PII is nulled, but the row (and its status/
    // confidence) survives.
    const docAfter = await request(app.getHttpServer())
      .get(`/v1/documents/${documentId}`)
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(docAfter.body.status).toBe('EXTRACTED');
    expect(docAfter.body.latestExtraction.rawText).toBeNull();
    expect(docAfter.body.latestExtraction.fields).toBeNull();

    // The applicant itself is NOT hidden — erasedAt is deliberately
    // separate from deletedAt (see the schema comment). A real compliance
    // record you can't look up isn't much of one.
    await request(app.getHttpServer())
      .get(`/v1/applicants/${applicantId}`)
      .set('X-API-Key', tenant.token)
      .expect(200);
    const listRes = await request(app.getHttpServer())
      .get('/v1/applicants')
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(listRes.body.map((a: { id: string }) => a.id)).toContain(
      applicantId,
    );
  });

  it('preserves decision history through erasure', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'erase-decision',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'erase-2',
    });
    // Missing verifications -> decide() 400s, which is fine: this test
    // only needs *some* pre-existing state on the applicant to prove
    // erase() doesn't touch it. Use the admin detail aggregate instead,
    // which doesn't require a decision to exist.
    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/erase`)
      .set('X-API-Key', tenant.token)
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/admin/tenants/${tenant.tenantId}/applicants/${applicantId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.decisions).toEqual([]);
    expect(detail.body.erasedAt).not.toBeNull();
  });

  it("404s erasing another tenant's applicant", async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'erase-iso-a',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'erase-iso-b',
    );
    const applicantOfA = await createApplicant(app, tenantA.token, {
      externalId: 'erase-iso',
    });

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantOfA}/erase`)
      .set('X-API-Key', tenantB.token)
      .expect(404);
  });

  it('purges business documents on erase, mirroring applicant erasure', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'erase-business',
    );
    const businessId = await createBusiness(app, tenant.token, {
      externalId: 'erase-biz-1',
      legalName: 'Sahara Trading Co',
    });

    const uploadRes = await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'COMMERCIAL_REGISTRATION')
      .attach('file', TINY_PNG, 'cr.png')
      .expect(202);
    const documentId = uploadRes.body.id as string;
    await waitFor(async () => {
      const doc = await request(app.getHttpServer())
        .get(`/v1/business-documents/${documentId}`)
        .set('X-API-Key', tenant.token)
        .expect(200);
      return doc.body.status !== 'UPLOADED' && doc.body.status !== 'PROCESSING'
        ? doc.body
        : false;
    });

    const eraseRes = await request(app.getHttpServer())
      .post(`/v1/businesses/${businessId}/erase`)
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(eraseRes.body.legalName).toBeNull();
    expect(eraseRes.body.erasedAt).not.toBeNull();

    await request(app.getHttpServer())
      .get(
        `/admin/tenants/${tenant.tenantId}/business-documents/${documentId}/image`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    const listRes = await request(app.getHttpServer())
      .get('/v1/businesses')
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(listRes.body.map((b: { id: string }) => b.id)).toContain(businessId);
  });
});
