import { useLanguage } from '../i18n';
import logo from '../assets/lybid-logo.png';
import { Button } from './Button';
import { ADMIN_DASHBOARD_LOGIN_URL } from '../config';

export function Nav() {
  const { t, lang, setLang } = useLanguage();

  return (
    <nav className="sticky top-0 z-40 border-b border-paper-3 bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-24 max-w-6xl items-center justify-between px-8">
        {/* Bigger logo, as asked — this is the primary brand mark on the
            page's very first row, so it earns real size, not a cramped
            nav-icon treatment. */}
        <a href="#" className="flex items-center">
          <img src={logo} alt="LybID" className="h-14 w-auto sm:h-16" />
        </a>

        <div className="hidden items-center gap-9 text-[15px] font-medium md:flex">
          <a href="#product" className="opacity-80 hover:opacity-100">
            {t.nav.product}
          </a>
          <a href="#solutions" className="opacity-80 hover:opacity-100">
            {t.nav.solutions}
          </a>
          <a href="#why" className="opacity-80 hover:opacity-100">
            {t.nav.why}
          </a>
          <a href="#pricing" className="opacity-80 hover:opacity-100">
            {t.nav.pricing}
          </a>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex overflow-hidden rounded-full border border-paper-3 text-[13px] font-semibold">
            <button
              type="button"
              onClick={() => setLang('ar')}
              className={`px-3 py-1.5 transition ${lang === 'ar' ? 'bg-ink text-paper' : 'text-ink/70 hover:text-ink'}`}
              aria-pressed={lang === 'ar'}
            >
              عربي
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-3 py-1.5 transition ${lang === 'en' ? 'bg-ink text-paper' : 'text-ink/70 hover:text-ink'}`}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
          </div>
          <a
            href={ADMIN_DASHBOARD_LOGIN_URL}
            className="hidden text-[15px] font-medium opacity-80 hover:opacity-100 sm:inline"
          >
            {t.nav.signIn}
          </a>
          <Button variant="solid-verified" href="#pricing" className="hidden sm:inline-flex">
            {t.nav.cta}
          </Button>
        </div>
      </div>
    </nav>
  );
}
