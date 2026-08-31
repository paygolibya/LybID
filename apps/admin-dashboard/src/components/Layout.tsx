import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import logoUrl from '../assets/lybid-logo.png';
import { useAuth } from '../lib/auth';
import { Button } from './Button';

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/tenants" className="flex items-center gap-2">
            <img src={logoUrl} alt="LybID" className="h-6 w-auto" />
            <span className="text-sm font-semibold text-slate-500">Admin</span>
          </Link>
          <Button variant="secondary" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
