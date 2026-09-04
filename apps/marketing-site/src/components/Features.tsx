import { useLanguage } from '../i18n';

const ICONS = [
  <path key="1" d="M3 4h18v16H3zM3 9h18M7 14h4" />,
  <path key="2" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM9 7h7M9 11h7" />,
  <path key="3" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.5 3.5-6 8-6s8 2.5 8 6" />,
  <path key="4" d="M3 21V8l9-5 9 5v13zM9 21v-7h6v7" />,
];

export function Features() {
  const { t, fontDisplay, fontBody } = useLanguage();

  return (
    <section id="product" className="px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 max-w-[620px]">
          <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-verified">
            {t.features.eyebrow}
          </span>
          <h2 className={`${fontDisplay} mt-3 text-[28px] font-semibold [text-wrap:balance] sm:text-[36px]`}>
            {t.features.heading}
          </h2>
          <p className={`${fontBody} mt-3.5 text-[16.5px] leading-[1.6] text-ink/65`}>{t.features.sub}</p>
        </div>

        <div className="grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-4">
          {t.features.items.map((item, i) => (
            <div key={item.title} className="flex flex-col gap-3.5 rounded-2xl bg-paper-2 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-paper shadow-sm">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E6B4A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[i]}
                </svg>
              </div>
              <h3 className="text-[18px] font-semibold">{item.title}</h3>
              <p className="text-[14.5px] leading-[1.55] text-ink/65">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
