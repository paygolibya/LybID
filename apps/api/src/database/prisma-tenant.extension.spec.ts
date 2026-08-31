import { applyTenantScoping } from './prisma-tenant.extension';
import type { RequestAuthContext } from './tenant-context';

const tenantAuth: RequestAuthContext = {
  mode: 'tenant',
  tenantId: 'tenant-a',
  environment: 'LIVE',
  apiKeyId: 'key-1',
};

const adminAuth: RequestAuthContext = {
  mode: 'admin',
  adminId: 'admin-1',
  email: 'admin@example.com',
};

describe('applyTenantScoping', () => {
  it('passes non-tenant-scoped models through untouched, even with no auth context', () => {
    const args = { where: { email: 'x@y.com' } };
    expect(
      applyTenantScoping('PlatformAdminUser', 'findFirst', args, undefined),
    ).toBe(args);
  });

  it('fails closed: throws when a tenant-scoped model is queried with no auth context at all', () => {
    expect(() =>
      applyTenantScoping('ApiKey', 'findMany', {}, undefined),
    ).toThrow(/no request auth context/i);
  });

  it('auto-injects the scope filter for a tenant-mode read', () => {
    const result = applyTenantScoping('ApiKey', 'findMany', {}, tenantAuth);
    expect(result.where).toEqual({ tenantId: 'tenant-a' });
  });

  it('uses the model-specific scope field (Tenant scopes by its own id)', () => {
    const result = applyTenantScoping('Tenant', 'findFirst', {}, tenantAuth);
    expect(result.where).toEqual({ id: 'tenant-a' });
  });

  it('merges the scope filter alongside an existing where clause', () => {
    const result = applyTenantScoping(
      'ApiKey',
      'findMany',
      { where: { status: 'ACTIVE' } },
      tenantAuth,
    );
    expect(result.where).toEqual({ status: 'ACTIVE', tenantId: 'tenant-a' });
  });

  it('throws if an explicit where clause tries to target a different tenant', () => {
    expect(() =>
      applyTenantScoping(
        'ApiKey',
        'findMany',
        { where: { tenantId: 'tenant-b' } },
        tenantAuth,
      ),
    ).toThrow(/scoping violation/i);
  });

  it('auto-injects the scope field on create', () => {
    const result = applyTenantScoping(
      'ApiKey',
      'create',
      { data: { environment: 'LIVE' } },
      tenantAuth,
    );
    expect(result.data).toEqual({ environment: 'LIVE', tenantId: 'tenant-a' });
  });

  it('throws if create data explicitly sets a different tenant', () => {
    expect(() =>
      applyTenantScoping(
        'ApiKey',
        'create',
        { data: { tenantId: 'tenant-b' } },
        tenantAuth,
      ),
    ).toThrow(/scoping violation/i);
  });

  it('admin mode bypasses app-level scoping entirely', () => {
    const args = { where: { tenantId: 'anything' } };
    expect(applyTenantScoping('ApiKey', 'findMany', args, adminAuth)).toBe(
      args,
    );
  });

  describe('environment scoping (models with environmentField, e.g. Applicant)', () => {
    it('auto-injects both tenantId and environment on a read', () => {
      const result = applyTenantScoping(
        'Applicant',
        'findMany',
        {},
        tenantAuth,
      );
      expect(result.where).toEqual({
        tenantId: 'tenant-a',
        environment: 'LIVE',
      });
    });

    it('auto-injects both fields on create', () => {
      const result = applyTenantScoping(
        'Applicant',
        'create',
        { data: { externalId: 'cust-1' } },
        tenantAuth,
      );
      expect(result.data).toEqual({
        externalId: 'cust-1',
        tenantId: 'tenant-a',
        environment: 'LIVE',
      });
    });

    it('throws if an explicit where clause targets a different environment (same tenant)', () => {
      expect(() =>
        applyTenantScoping(
          'Applicant',
          'findMany',
          { where: { environment: 'TEST' } },
          tenantAuth,
        ),
      ).toThrow(/scoping violation/i);
    });

    it('a TEST-environment key only sees its own environment', () => {
      const testAuth: RequestAuthContext = {
        ...tenantAuth,
        environment: 'TEST',
      };
      const result = applyTenantScoping('Applicant', 'findMany', {}, testAuth);
      expect(result.where).toEqual({
        tenantId: 'tenant-a',
        environment: 'TEST',
      });
    });

    it('admin mode bypasses environment scoping too', () => {
      const args = { where: {} };
      expect(applyTenantScoping('Applicant', 'findMany', args, adminAuth)).toBe(
        args,
      );
    });
  });
});
