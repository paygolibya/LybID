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
          <div className="flex items-center gap-6">
            <Link to="/tenants" className="flex items-center gap-2">
              <img src={logoUrl} alt="LybID" className="h-6 w-auto" />
              <span className="text-sm font-semibold text-slate-500">Admin</span>
            </Link>
            <nav className="flex gap-4 text-sm text-slate-500">
              <Link to="/tenants" className="hover:text-slate-900">
                Tenants
              </Link>
              <Link to="/audit-log" className="hover:text-slate-900">
                Audit log
              </Link>
            </nav>
          </div>
          <Button variant="secondary" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
