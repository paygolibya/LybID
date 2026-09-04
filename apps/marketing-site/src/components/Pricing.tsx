import { useLanguage } from '../i18n';
import { Button } from './Button';

function Check({ color = '#0E6B4A' }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-none">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Pricing() {
  const { t, fontDisplay, fontBody } = useLanguage();

  return (
    <section id="pricing" className="px-8 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 max-w-[620px]">
          <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-verified">
            {t.pricing.eyebrow}
          </span>
          <h2 className={`${fontDisplay} mt-3 text-[28px] font-semibold [text-wrap:balance] sm:text-[36px]`}>
            {t.pricing.heading}
          </h2>
          <p className={`${fontBody} mt-3.5 text-[16.5px] leading-[1.6] text-ink/65`}>{t.pricing.sub}</p>
        </div>

        <div className="grid max-w-[860px] grid-cols-1 gap-5 sm:grid-cols-2">
          {/* Basic — live now, gets the highlighted treatment */}
          <div className="relative flex flex-col rounded-[20px] border-2 border-verified bg-paper p-8 shadow-lg">
            <span className="absolute -top-3.5 start-7 rounded-full bg-verified px-3 py-1.5 text-[11.5px] font-semibold text-paper">
              {t.pricing.basic.badge}
            </span>
            <span className="text-[15px] font-semibold uppercase tracking-[0.04em] text-ink/60">
              {t.pricing.basic.name}
            </span>
            <div className="force-ltr mt-3.5 flex items-baseline gap-2">
              <span className={`${fontDisplay} text-[44px] font-semibold`}>0.500</span>
              <span className="font-mono text-[13.5px] text-ink/55">{t.pricing.unit}</span>
            </div>
            <p className={`${fontBody} mt-3 min-h-[44px] text-[14.5px] leading-[1.55] text-ink/65`}>
              {t.pricing.basic.desc}
            </p>
            <ul className="mt-6 flex-1 list-none p-0">
              {t.pricing.basic.items.map((item, i) => (
                <li key={item} className={`flex items-start gap-2.5 py-2.5 text-[14.5px] ${i > 0 ? 'border-t border-paper-3' : ''}`}>
                  <Check />
                  {item}
                </li>
              ))}
            </ul>
            <Button variant="solid-verified" href="#" className="mt-6 justify-center">
              {t.pricing.basic.cta}
            </Button>
          </div>

          {/* Professional — coming soon, quieter treatment */}
          <div className="flex flex-col rounded-[20px] border border-paper-3 bg-paper-2 p-8">
            <span className="mb-3.5 inline-block w-fit rounded-full bg-paper-3 px-3 py-1.5 text-[11.5px] font-semibold text-ink/60">
              {t.pricing.pro.badge}
            </span>
            <span className="text-[15px] font-semibold uppercase tracking-[0.04em] text-ink/60">
              {t.pricing.pro.name}
            </span>
            <div className="force-ltr mt-3.5 flex items-baseline gap-2">
              <span className={`${fontDisplay} text-[44px] font-semibold`}>1.000</span>
              <span className="font-mono text-[13.5px] text-ink/55">{t.pricing.unit}</span>
            </div>
            <p className={`${fontBody} mt-3 min-h-[44px] text-[14.5px] leading-[1.55] text-ink/65`}>
              {t.pricing.pro.desc}
            </p>
            <ul className="mt-6 flex-1 list-none p-0">
              {t.pricing.pro.items.map((item, i) => (
                <li key={item} className={`flex items-start gap-2.5 py-2.5 text-[14.5px] ${i > 0 ? 'border-t border-paper-3' : ''}`}>
                  <Check color="#5B6250" />
                  {item}
                </li>
              ))}
            </ul>
            <Button variant="ghost-ink" href="#" disabled className="mt-6 justify-center">
              {t.pricing.pro.cta}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
