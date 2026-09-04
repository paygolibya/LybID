import { useLanguage } from '../i18n';

export function Solutions() {
  const { t, fontDisplay, fontBody } = useLanguage();

  return (
    <section id="solutions" className="bg-ink px-5 py-16 text-paper sm:px-8 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 max-w-[620px]">
          <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-gold">
            {t.solutions.eyebrow}
          </span>
          <h2 className={`${fontDisplay} mt-3 text-[28px] font-semibold [text-wrap:balance] sm:text-[36px]`}>
            {t.solutions.heading}
          </h2>
          <p className={`${fontBody} mt-3.5 text-[16.5px] leading-[1.6] text-paper/60`}>{t.solutions.sub}</p>
        </div>

        <div className="mb-8 flex flex-wrap gap-2.5">
          {t.solutions.filters.map((f, i) => (
            <span
              key={f}
              className={`rounded-full border px-4 py-2 text-[13.5px] font-medium ${
                i === 0
                  ? 'border-paper bg-paper text-ink'
                  : i === t.solutions.filters.length - 1
                    ? 'border-ink-3 text-paper/40'
                    : 'border-ink-3 text-paper/60'
              }`}
            >
              {f}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-ink-3 bg-ink-2 p-7">
            <SolutionGroupHead label={t.solutions.kyc.label} tag={t.solutions.kyc.tag} />
            <SolutionList items={t.solutions.kyc.items} />
          </div>
          <div className="rounded-2xl border border-ink-3 bg-ink-2 p-7">
            <SolutionGroupHead label={t.solutions.kyb.label} tag={t.solutions.kyb.tag} />
            <SolutionList items={t.solutions.kyb.items} />
            <div className="mt-5 flex items-center gap-2.5 text-[13.5px] text-paper/55">
              <span className="h-1.5 w-1.5 flex-none rounded-full border border-paper/55" />
              {t.solutions.note}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SolutionGroupHead({ label, tag }: { label: string; tag: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <h3 className="text-[20px] font-semibold">{label}</h3>
      <span className="font-mono text-[12px] text-paper/55">{tag}</span>
    </div>
  );
}

function SolutionList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3.5 list-none p-0">
      {items.map((item, i) => (
        <li
          key={item}
          className={`flex items-center py-3.5 text-[15px] ${i > 0 ? 'border-t border-ink-3' : ''}`}
        >
          <span className="me-3 h-1.5 w-1.5 flex-none rounded-full bg-gold" />
          {item}
        </li>
      ))}
    </ul>
  );
}
