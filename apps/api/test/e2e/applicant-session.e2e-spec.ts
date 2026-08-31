import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { OcrClientService } from '../../src/modules/documents/ocr-client/ocr-client.service';
import {
  createApplicant,
  createTenantWithApiKey,
  createTestAppWithStubOcr,
  getOwnerClient,
  issueApplicantSessionToken,
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

describe('Applicant session (e2e, stubbed OCR) — the browser-facing token-scoped surface', () => {
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

  it('mints a session token only behind the tenant API key, never without one', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-session-mint',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 's-1',
    });

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/session-token`)
      .expect(401);

    const res = await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/session-token`)
      .set('X-API-Key', tenant.token)
      .expect(201);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.expiresAt).toBeDefined();
  });

  it('uploads and polls a document through the session token — no API key ever used', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-session-upload',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 's-2',
    });
    const sessionToken = await issueApplicantSessionToken(
      app,
      tenant.token,
      applicantId,
    );

    extractMock.mockResolvedValue({
      rawText: 'ok',
      fields: [{ name: 'number', value: 'N1', confidence: 0.98 }],
      overallConfidence: 0.95,
    });

    const uploadRes = await request(app.getHttpServer())
      .post('/v1/applicant-session/documents')
      .set('Authorization', `Bearer ${sessionToken}`)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);

    expect(uploadRes.body.applicantId).toBe(applicantId);
    const documentId = uploadRes.body.id as string;

    const result = await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/applicant-session/documents/${documentId}`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      return res.body.status !== 'UPLOADED' && res.body.status !== 'PROCESSING'
        ? res.body
        : false;
    });

    expect(result.status).toBe('EXTRACTED');
  });

  it('creates and polls a biometric check through the session token', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-session-biometric',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 's-3',
    });
    const sessionToken = await issueApplicantSessionToken(
      app,
      tenant.token,
      applicantId,
    );

    // Passport (reference) uploaded via the real API-key route first — a
    // bank's own backend would typically do this server-side before
    // handing the applicant a session token for just the selfie capture,
    // but either route works since both write the same Document rows.
    extractMock.mockResolvedValue({
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });
    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/documents`)
      .set('X-API-Key', tenant.token)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);

    const selfieRes = await request(app.getHttpServer())
      .post('/v1/applicant-session/documents')
      .set('Authorization', `Bearer ${sessionToken}`)
      .field('type', 'SELFIE')
      .attach('file', TINY_PNG, 'selfie.png')
      .expect(202);

    const checkRes = await request(app.getHttpServer())
      .post('/v1/applicant-session/biometric-checks')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ selfieDocumentId: selfieRes.body.id })
      .expect(202);

    expect(checkRes.body.applicantId).toBe(applicantId);

    const result = await waitFor(async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/applicant-session/biometric-checks/${checkRes.body.id}`)
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
      return res.body.status !== 'PROCESSING' ? res.body : false;
    });
    expect(['COMPLETED', 'NEEDS_REVIEW', 'FAILED']).toContain(result.status);
  });

  it('rejects a garbage/malformed token (401)', async () => {
    await request(app.getHttpServer())
      .get(
        '/v1/applicant-session/documents/00000000-0000-0000-0000-000000000000',
      )
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it("rejects the tenant's real API key on applicant-session routes (they're token-only)", async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-session-wrongauth',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 's-4',
    });

    await request(app.getHttpServer())
      .post('/v1/applicant-session/documents')
      .set('X-API-Key', tenant.token) // wrong header entirely — no Authorization Bearer at all
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(401);

    void applicantId; // not used beyond establishing the tenant has a real applicant
  });

  it("a session token cannot see another applicant's document (404, not the leaked resource)", async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-session-iso',
    );
    const applicantA = await createApplicant(app, tenant.token, {
      externalId: 's-5-a',
    });
    const applicantB = await createApplicant(app, tenant.token, {
      externalId: 's-5-b',
    });

    extractMock.mockResolvedValue({
      rawText: 'ok',
      fields: [],
      overallConfidence: 0.95,
    });
    const tokenA = await issueApplicantSessionToken(
      app,
      tenant.token,
      applicantA,
    );
    const uploadRes = await request(app.getHttpServer())
      .post('/v1/applicant-session/documents')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('type', 'PASSPORT')
      .attach('file', TINY_PNG, 'passport.png')
      .expect(202);

    const tokenB = await issueApplicantSessionToken(
      app,
      tenant.token,
      applicantB,
    );
    await request(app.getHttpServer())
      .get(`/v1/applicant-session/documents/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);
  });

  it('a session token cannot be used to mint another session token (issuance stays API-key-only)', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-session-noescalate',
    );
    const applicantId = await createApplicant(app, tenant.token, {
      externalId: 's-6',
    });
    const sessionToken = await issueApplicantSessionToken(
      app,
      tenant.token,
      applicantId,
    );

    await request(app.getHttpServer())
      .post(`/v1/applicants/${applicantId}/session-token`)
      .set('Authorization', `Bearer ${sessionToken}`) // wrong header — this route wants X-API-Key
      .expect(401);
  });
});
