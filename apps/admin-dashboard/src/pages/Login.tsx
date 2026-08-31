import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import logoUrl from '../assets/lybid-logo.png';
import { Button } from '../components/Button';
import { ErrorBanner } from '../components/Spinner';
import { Input } from '../components/Input';
import { useAuth } from '../lib/auth';

export function Login() {
  const { token, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (token) return <Navigate to="/tenants" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <img src={logoUrl} alt="LybID" className="mx-auto mb-4 h-8 w-auto" />
        <h1 className="mb-4 text-center text-sm font-medium text-slate-500">
          Admin sign in
        </h1>
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="mb-3 flex flex-col gap-1">
          <label htmlFor="email" className="text-xs font-medium text-slate-600">
            Email
          </label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="mb-4 flex flex-col gap-1">
          <label htmlFor="password" className="text-xs font-medium text-slate-600">
            Password
          </label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
