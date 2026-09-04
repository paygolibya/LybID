import { useLanguage } from '../i18n';
import { Button } from './Button';

export function FinalCta() {
  const { t, fontDisplay, fontBody } = useLanguage();

  return (
    <section className="relative overflow-hidden bg-ink px-5 py-20 text-paper sm:px-8 sm:py-28">
      <svg
        viewBox="0 0 200 200"
        fill="none"
        className="pointer-events-none absolute end-[-60px] top-1/2 hidden h-[420px] w-[420px] -translate-y-1/2 opacity-90 sm:block"
      >
        <circle cx="100" cy="100" r="98" stroke="#D6A94A" strokeOpacity="0.35" strokeWidth="1.4" />
        <circle cx="100" cy="100" r="78" stroke="#D6A94A" strokeOpacity="0.5" strokeWidth="1" />
        <circle cx="100" cy="100" r="78" stroke="#D6A94A" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 6" />
        <path d="M100 55v90M55 100h90" stroke="#D6A94A" strokeOpacity="0.3" strokeWidth="1" />
        <path d="m84 100 11 11 22-24" stroke="#D6A94A" strokeOpacity="0.7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <div className="relative z-10 mx-auto max-w-6xl">
        <div className="max-w-[480px]">
          <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-gold">
            {t.finalCta.eyebrow}
          </span>
          <h2 className={`${fontDisplay} mt-3 text-[28px] font-semibold [text-wrap:balance] sm:text-[40px]`}>
            {t.finalCta.heading}
          </h2>
          <p className={`${fontBody} mt-4 max-w-[40ch] text-[16.5px] leading-[1.6] text-paper/60`}>
            {t.finalCta.body}
          </p>
          <div className="mt-7">
            <Button variant="solid-gold" withArrow href="#pricing">
              {t.finalCta.cta}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
