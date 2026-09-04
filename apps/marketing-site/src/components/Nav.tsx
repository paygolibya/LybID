import { useState } from 'react';
import { useLanguage } from '../i18n';
import logo from '../assets/lybid-logo.png';
import { Button } from './Button';
import { ADMIN_DASHBOARD_LOGIN_URL } from '../config';

const LINKS = [
  { href: '#product', key: 'product' as const },
  { href: '#solutions', key: 'solutions' as const },
  { href: '#why', key: 'why' as const },
  { href: '#pricing', key: 'pricing' as const },
];

export function Nav() {
  const { t, lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-40 border-b border-paper-3 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:h-24 sm:px-8">
        {/* Bigger logo, as asked — this is the primary brand mark on the
            page's very first row, so it earns real size, not a cramped
            nav-icon treatment. Scaled down one notch on the smallest
            screens so it doesn't crowd the hamburger button. */}
        <a href="#" className="flex items-center" onClick={() => setOpen(false)}>
          <img src={logo} alt="LybID" className="h-11 w-auto sm:h-14 lg:h-16" />
        </a>

        <div className="hidden items-center gap-9 text-[15px] font-medium md:flex">
          {LINKS.map((link) => (
            <a key={link.key} href={link.href} className="opacity-80 hover:opacity-100">
              {t.nav[link.key]}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex overflow-hidden rounded-full border border-paper-3 text-[13px] font-semibold">
            <button
              type="button"
              onClick={() => setLang('ar')}
              className={`px-2.5 py-1.5 transition sm:px-3 ${lang === 'ar' ? 'bg-ink text-paper' : 'text-ink/70 hover:text-ink'}`}
              aria-pressed={lang === 'ar'}
            >
              عربي
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-2.5 py-1.5 transition sm:px-3 ${lang === 'en' ? 'bg-ink text-paper' : 'text-ink/70 hover:text-ink'}`}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
          </div>

          <a
            href={ADMIN_DASHBOARD_LOGIN_URL}
            className="hidden text-[15px] font-medium opacity-80 hover:opacity-100 md:inline"
          >
            {t.nav.signIn}
          </a>
          <Button variant="solid-verified" href="#pricing" className="hidden md:inline-flex">
            {t.nav.cta}
          </Button>

          {/* Hamburger — the real mobile-nav gap this fixes: below `md`
              there was previously no way to reach section links, sign in,
              or the primary CTA at all without scrolling the whole page
              first. 44px tap target, per standard mobile touch-target
              guidance. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-paper-3 md:hidden"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-menu" className="border-t border-paper-3 bg-paper px-5 py-5 md:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <a
                key={link.key}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3 text-[16px] font-medium hover:bg-paper-2"
              >
                {t.nav[link.key]}
              </a>
            ))}
            <a
              href={ADMIN_DASHBOARD_LOGIN_URL}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-3 text-[16px] font-medium hover:bg-paper-2"
            >
              {t.nav.signIn}
            </a>
          </div>
          <Button variant="solid-verified" href="#pricing" className="mt-4 w-full justify-center">
            {t.nav.cta}
          </Button>
        </div>
      )}
    </nav>
  );
}
