import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  createTenantWithApiKey,
  createTestApp,
  getOwnerClient,
  loginAsTestAdmin,
  resetDatabase,
  seedAdmin,
} from './utils/test-app';

describe('Applicant / Document isolation (e2e)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let adminToken: string;

  beforeAll(async () => {
    owner = getOwnerClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await seedAdmin(owner);
    adminToken = await loginAsTestAdmin(app);
  });

  it('a tenant can create and fetch its own applicant', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-applicants-a',
    );

    const created = await request(app.getHttpServer())
      .post('/v1/applicants')
      .set('X-API-Key', tenant.token)
      .send({ externalId: 'cust-1', firstName: 'Ahmed', lastName: 'Al-Ftaisi' })
      .expect(201);

    expect(created.body.externalId).toBe('cust-1');
    expect(created.body.environment).toBe('LIVE');

    const fetched = await request(app.getHttpServer())
      .get(`/v1/applicants/${created.body.id}`)
      .set('X-API-Key', tenant.token)
      .expect(200);
    expect(fetched.body.id).toBe(created.body.id);
  });

  it("tenant B cannot fetch tenant A's applicant (404, not the leaked resource)", async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-applicants-a2',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-applicants-b2',
    );

    const created = await request(app.getHttpServer())
      .post('/v1/applicants')
      .set('X-API-Key', tenantA.token)
      .send({ externalId: 'cust-secret' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/v1/applicants/${created.body.id}`)
      .set('X-API-Key', tenantB.token)
      .expect(404);
  });

  it("tenant B's applicant list never includes tenant A's applicants", async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-applicants-a3',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-applicants-b3',
    );

    await request(app.getHttpServer())
      .post('/v1/applicants')
      .set('X-API-Key', tenantA.token)
      .send({ externalId: 'a-cust' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/v1/applicants')
      .set('X-API-Key', tenantB.token)
      .send({ externalId: 'b-cust' })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/v1/applicants')
      .set('X-API-Key', tenantB.token)
      .expect(200);

    expect(list.body).toHaveLength(1);
    expect(list.body[0].externalId).toBe('b-cust');
  });

  it('a TEST-environment key never sees applicants created under the same tenant with a LIVE key', async () => {
    const tenant = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-env-split',
    );

    const testKeyRes = await request(app.getHttpServer())
      .post(`/admin/tenants/${tenant.tenantId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ environment: 'TEST' })
      .expect(201);
    const testToken = testKeyRes.body.token as string;

    await request(app.getHttpServer())
      .post('/v1/applicants')
      .set('X-API-Key', tenant.token) // LIVE key
      .send({ externalId: 'live-cust' })
      .expect(201);

    const listAsTest = await request(app.getHttpServer())
      .get('/v1/applicants')
      .set('X-API-Key', testToken)
      .expect(200);

    expect(listAsTest.body).toHaveLength(0);
  });
});
