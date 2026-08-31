import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../src/lib/api-client';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'error',
      json: async () => body,
    }),
  );
}

describe('ApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches the Authorization header from the getToken closure, not a snapshot', async () => {
    let currentToken = 'token-a';
    const client = new ApiClient(() => currentToken);
    mockFetch(200, []);

    await client.listTenants();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
      }),
    );

    // A later call picks up a token change without reconstructing the
    // client — this is what lets AuthProvider's single long-lived
    // ApiClient instance work correctly across login/logout.
    currentToken = 'token-b';
    mockFetch(200, []);
    await client.listTenants();
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-b' }),
      }),
    );
  });

  it('omits the Authorization header entirely when there is no token', async () => {
    const client = new ApiClient(() => null);
    mockFetch(200, { accessToken: 'x' });
    await client.login('a@b.com', 'pw');
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('throws ApiError with the server-provided message on a non-2xx response', async () => {
    const client = new ApiClient(() => 'token');
    mockFetch(404, { message: 'Applicant abc not found for tenant xyz' });
    await expect(client.getApplicantDetail('xyz', 'abc')).rejects.toMatchObject({
      status: 404,
      message: 'Applicant abc not found for tenant xyz',
    });
    await expect(client.getApplicantDetail('xyz', 'abc')).rejects.toBeInstanceOf(ApiError);
  });
});
