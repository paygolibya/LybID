import logoUrl from '../assets/lybid-logo.png';

export function Header() {
  return (
    <header className="flex items-center justify-center border-b border-slate-200 bg-white px-4 py-3">
      <img src={logoUrl} alt="LybID" className="h-8 w-auto" />
    </header>
  );
}
