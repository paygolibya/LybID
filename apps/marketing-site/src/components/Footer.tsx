import { useLanguage } from '../i18n';
import logo from '../assets/lybid-logo.png';

export function Footer() {
  const { t } = useLanguage();
  const hrefs = ['#product', '#solutions', '#pricing', '#'];

  return (
    <footer className="border-t border-ink-3 bg-ink px-8 py-11 text-paper">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <img src={logo} alt="LybID" className="h-8 w-auto brightness-0 invert" style={{ opacity: 0.92 }} />
            <span className="text-[13.5px] text-paper/55">{t.footer.tagline}</span>
          </div>
          <div className="flex gap-6 text-[14px]">
            {t.footer.links.map((link, i) => (
              <a key={link} href={hrefs[i]} className="text-paper/55 hover:text-paper">
                {link}
              </a>
            ))}
          </div>
        </div>
        <p className="mt-5 text-[12.5px] text-paper/45">{t.footer.fine}</p>
      </div>
    </footer>
  );
}
