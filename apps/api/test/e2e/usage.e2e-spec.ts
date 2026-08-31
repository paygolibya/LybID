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

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Usage metering + reporting (e2e, stubbed OCR)', () => {
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
  });

  async function uploadPassportAndWait(
    tenantToken: string,
    applicantId: string,
    resolvedOcr: unknown,
  ): Promise<string> {
    extractMock.mockResolvedValue(resolvedOcr);
    const res = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenantToken)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);
    await waitFor(async () => {
      const doc = await request(app.getHttpServer())
        .get(`/v1/documents/${res.body.id}`)
        .set('X-API-Key', tenantToken)
        .expect(200);
      return doc.body.status !== 'UPLOADED' && doc.body.status !== 'PROCESSING'
        ? doc.body
        : false;
    });
    return res.body.id as string;
  }

  it('counts a processed document (EXTRACTED) toward usage', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-usage-happy',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'u-1',
    });

    await uploadPassportAndWait(tenant.token, applicantId, {
      rawText: 'ok',
      fields: [{ name: 'number', value: 'N1', confidence: 0.98 }],
      overallConfidence: 0.95,
    });

    const usageRes = await request(app.getHttpServer())
      .get('/v1/usage')
      .set('X-API-Key', tenant.token)
      .expect(200);

    expect(usageRes.body.counts.DOCUMENT_PROCESSED).toBe(1);
    expect(usageRes.body.total).toBe(1);
    expect(usageRes.body.environment).toBe('LIVE');
  });

  it('counts a NEEDS_REVIEW document too, but not a FAILED one', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-usage-mixed',
    );
    const applicantIdReview = await createApplicant(app, tenant.token, {
      externalId: 'u-2',
    });
    const applicantIdFail = await createApplicant(app, tenant.token, {
      externalId: 'u-3',
    });

    await uploadPassportAndWait(tenant.token, applicantIdReview, {
      rawText: 'blurry',
      fields: [],
      overallConfidence: 0.3,
    });

    extractMock.mockRejectedValue(
      new Error('OCR extraction failed with status 503'),
    );
    const failRes = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantIdFail}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);
    await waitFor(
      async () => {
        const doc = await request(app.getHttpServer())
          .get(`/v1/documents/${failRes.body.id}`)
          .set('X-API-Key', tenant.token)
          .expect(200);
        return doc.body.status === 'FAILED' ? doc.body : false;
      },
      { timeoutMs: 20_000 },
    );

    const usageRes = await request(app.getHttpServer())
      .get('/v1/usage')
      .set('X-API-Key', tenant.token)
      .expect(200);

    // Only the NEEDS_REVIEW document counts — the FAILED one (LybID's own
    // infrastructure error) doesn't.
    expect(usageRes.body.total).toBe(1);
  });

  it('counts a processed BusinessDocument toward the same tenant total', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-usage-business',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'u-4',
    });
    await uploadPassportAndWait(tenant.token, applicantId, {
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });

    const bizRes = await request(app.getHttpServer())
      .post('/v1/businesses')
      .set('X-API-Key', tenant.token)
      .send({ externalId: 'u-biz-1' })
      .expect(201);

    extractMock.mockResolvedValue({
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });
    const docRes = await request(app.getHttpServer())
      .post(`/v1/businesses/${bizRes.body.id}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'TAX_ID')
      .attach('file', TINY_PNG, 'tax.png')
      .expect(202);
    await waitFor(async () => {
      const doc = await request(app.getHttpServer())
        .get(`/v1/business-documents/${docRes.body.id}`)
        .set('X-API-Key', tenant.token)
        .expect(200);
      return doc.body.status !== 'UPLOADED' && doc.body.status !== 'PROCESSING'
        ? doc.body
        : false;
    });

    const usageRes = await request(app.getHttpServer())
      .get('/v1/usage')
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(usageRes.body.total).toBe(2); // one Document + one BusinessDocument
  });

  it("a LIVE key's own usage never includes the same tenant's TEST-key activity, and vice versa", async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-usage-env',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'u-5',
    });
    await uploadPassportAndWait(tenant.token, applicantId, {
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });

    // Issue a second, TEST-environment key for the same tenant. Which
    // environment a tenant sees via GET /v1/usage is fixed by which key it
    // authenticates with (enforced by the tenant-scoping extension itself,
    // not a client-controlled filter) — see usage.controller.ts's comment.
    const testKeyRes = await request(app.getHttpServer())
      .post(`/admin/tenants/${tenant.tenantId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ environment: 'TEST' })
      .expect(201);
    const testToken = testKeyRes.body.token as string;

    const testApplicantId = await createApplicant(app, testToken, {
      externalId: 'u-5-test',
    });
    await uploadPassportAndWait(testToken, testApplicantId, {
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });

    const liveUsage = await request(app.getHttpServer())
      .get('/v1/usage')
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(liveUsage.body.total).toBe(1);
    expect(liveUsage.body.environment).toBe('LIVE');

    const testUsage = await request(app.getHttpServer())
      .get('/v1/usage')
      .set('X-API-Key', testToken)
      .expect(200);
    expect(testUsage.body.total).toBe(1);
    expect(testUsage.body.environment).toBe('TEST');
  });

  it("the admin endpoint's ?environment= filter correctly separates a tenant's LIVE and TEST usage", async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-usage-admin-env',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'u-7',
    });
    await uploadPassportAndWait(tenant.token, applicantId, {
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });

    const testKeyRes = await request(app.getHttpServer())
      .post(`/admin/tenants/${tenant.tenantId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ environment: 'TEST' })
      .expect(201);
    const testApplicantId = await createApplicant(app, testKeyRes.body.token, {
      externalId: 'u-7-test',
    });
    await uploadPassportAndWait(testKeyRes.body.token, testApplicantId, {
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });

    const liveRes = await request(app.getHttpServer())
      .get(`/admin/tenants/${tenant.tenantId}/usage`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(liveRes.body.total).toBe(1);
    expect(liveRes.body.environment).toBe('LIVE');

    const testRes = await request(app.getHttpServer())
      .get(`/admin/tenants/${tenant.tenantId}/usage?environment=TEST`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(testRes.body.total).toBe(1);
    expect(testRes.body.environment).toBe('TEST');
  });

  it('keeps usage isolated per tenant', async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-usage-iso-a',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-usage-iso-b',
    );

    const applicantA = await createApplicant(app, tenantA.token, {
      externalId: 'iso-a',
    });
    await uploadPassportAndWait(tenantA.token, applicantA, {
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });

    const applicantB = await createApplicant(app, tenantB.token, {
      externalId: 'iso-b',
    });
    await uploadPassportAndWait(tenantB.token, applicantB, {
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });

    const usageA = await request(app.getHttpServer())
      .get('/v1/usage')
      .set('X-API-Key', tenantA.token)
      .expect(200);
    const usageB = await request(app.getHttpServer())
      .get('/v1/usage')
      .set('X-API-Key', tenantB.token)
      .expect(200);

    expect(usageA.body.total).toBe(1);
    expect(usageB.body.total).toBe(1);
  });

  it('lets an admin query usage for any tenant, matching what the tenant sees itself', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-usage-admin',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 'u-6',
    });
    await uploadPassportAndWait(tenant.token, applicantId, {
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });

    const adminUsage = await request(app.getHttpServer())
      .get(`/admin/tenants/${tenant.tenantId}/usage`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(adminUsage.body.total).toBe(1);
  });
});
