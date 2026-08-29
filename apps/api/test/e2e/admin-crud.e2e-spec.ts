import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  createTestApp,
  getOwnerClient,
  loginAsTestAdmin,
  resetDatabase,
  seedAdmin,
} from './utils/test-app';

describe('Admin CRUD (e2e)', () => {
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

  it('rejects login with a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ email: 'test-admin@marsa.ly', password: 'wrong-password' })
      .expect(401);
  });

  it('rejects admin routes with no token', async () => {
    await request(app.getHttpServer()).get('/admin/tenants').expect(401);
  });

  it('creates, lists, and fetches a tenant', async () => {
    const created = await request(app.getHttpServer())
      .post('/admin/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bank of Tripoli', slug: 'bank-of-tripoli' })
      .expect(201);

    expect(created.body.status).toBe('ACTIVE');

    const list = await request(app.getHttpServer())
      .get('/admin/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body).toHaveLength(1);

    await request(app.getHttpServer())
      .get(`/admin/tenants/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('rejects creating a tenant with a duplicate slug', async () => {
    await request(app.getHttpServer())
      .post('/admin/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bank of Tripoli', slug: 'dup-bank' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/admin/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Another Bank', slug: 'dup-bank' })
      .expect(409);
  });

  it('issues an api key returning the plaintext token once, and never exposes keyHash', async () => {
    const tenant = await request(app.getHttpServer())
      .post('/admin/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bank X', slug: 'bank-x' })
      .expect(201);

    const issued = await request(app.getHttpServer())
      .post(`/admin/tenants/${tenant.body.id}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ environment: 'TEST' })
      .expect(201);

    expect(issued.body.token).toMatch(/^lyb_test_/);
    expect(issued.body.keyHash).toBeUndefined();

    const list = await request(app.getHttpServer())
      .get(`/admin/tenants/${tenant.body.id}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body[0].keyHash).toBeUndefined();
    expect(list.body[0].token).toBeUndefined();
  });

  it('records an audit log entry on tenant creation and key issuance', async () => {
    const tenant = await request(app.getHttpServer())
      .post('/admin/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bank Audit', slug: 'bank-audit' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/admin/tenants/${tenant.body.id}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ environment: 'LIVE' })
      .expect(201);

    const logs = await owner.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual([
      'tenant.created',
      'api_key.issued',
    ]);
  });
});
