import { useLanguage } from '../i18n';

export function WhySelfHosted() {
  const { t, fontDisplay, fontBody } = useLanguage();

  return (
    <section id="why" className="px-8 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 max-w-[620px]">
          <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-verified">
            {t.why.eyebrow}
          </span>
          <h2 className={`${fontDisplay} mt-3 text-[28px] font-semibold [text-wrap:balance] sm:text-[36px]`}>
            {t.why.heading}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {t.why.items.map((item, i) => (
            <div key={item.title} className="border-t-2 border-verified pt-4.5">
              <span className="font-mono text-[13px] font-medium text-verified">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-2.5 text-[19px] font-semibold">{item.title}</h3>
              <p className={`${fontBody} mt-2.5 text-[15px] leading-[1.6] text-ink/65`}>{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
