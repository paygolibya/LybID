import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/lib/auth';
import { Login } from '../src/pages/Login';

// A minimal route pair, not the real <App/> tree — Login redirects to
// "/tenants" on success via <Navigate>, and that needs *some* matching
// route to actually render, or the redirect can't be observed.
function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/tenants" element={<p>Tenants page reached</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Login', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in and stores the token in sessionStorage, not localStorage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ accessToken: 'a-real-jwt' }),
      }),
    );

    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'admin@marsa.ly');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/tenants page reached/i)).toBeInTheDocument();
    expect(sessionStorage.getItem('lybid_admin_token')).toBe('a-real-jwt');
  });

  it('shows the server error message on a failed login without storing a token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Invalid credentials' }),
      }),
    );

    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'admin@marsa.ly');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
    expect(sessionStorage.getItem('lybid_admin_token')).toBeNull();
  });
});
