import { useLanguage } from '../i18n';
import { Button } from './Button';

export function Hero() {
  const { t, fontDisplay, fontBody } = useLanguage();

  return (
    <header className="px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <span className="font-mono text-[12.5px] font-medium uppercase tracking-[0.14em] text-verified">
            {t.hero.eyebrow}
          </span>
          <h1 className={`${fontDisplay} mt-4 text-[34px] font-semibold leading-[1.08] [text-wrap:balance] sm:text-[44px] lg:text-[54px]`}>
            {t.hero.headline}
          </h1>
          <p className={`${fontBody} mt-6 max-w-[46ch] text-[18px] leading-[1.65] text-ink/65`}>{t.hero.sub}</p>
          <div className="mt-8 flex flex-wrap gap-3.5">
            <Button variant="solid-verified" withArrow href="#pricing">
              {t.hero.ctaPrimary}
            </Button>
            <Button variant="ghost-ink" href="#product">
              {t.hero.ctaSecondary}
            </Button>
          </div>
          <p className="mt-5 max-w-[42ch] text-[13.5px] text-ink/55">{t.hero.note}</p>
        </div>

        <div className="flex justify-center">
          <IdCard />
        </div>
      </div>
    </header>
  );
}

function IdCard() {
  const { t } = useLanguage();
  return (
    <div className="relative w-full max-w-[400px] px-3 sm:px-0">
      <span className="absolute -top-3.5 end-6 rounded-full bg-gold px-3 py-1.5 font-mono text-[11px] font-medium text-ink shadow-lg sm:rotate-[4deg]">
        {t.hero.card.sample}
      </span>
      <div
        className="relative flex aspect-[1.586/1] flex-col justify-between rounded-2xl p-6 text-paper shadow-2xl sm:-rotate-3"
        style={{
          background:
            'repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 7px), linear-gradient(155deg, #1C2016, #14170F)',
        }}
      >
        <div className="flex items-start justify-between">
          <span className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-paper/55">
            {t.hero.card.brand}
          </span>
          <div className="h-[54px] w-[54px] rounded-full border border-ink-3 bg-gradient-to-br from-ink-3 to-ink-2" />
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex h-[58px] w-[58px] flex-none items-center justify-center rounded-full border-[1.5px] border-gold">
            <div className="absolute inset-1.5 rounded-full border border-dashed border-gold/55" />
            <span className="text-center font-mono text-[9px] leading-tight text-gold">
              {t.hero.card.seal}
            </span>
          </div>
          <div className="text-[12.5px] leading-[1.7] text-paper/55">
            <div>
              {t.hero.card.docLabel} — <b className="font-medium text-paper">{t.hero.card.docValue}</b>
            </div>
            <div>
              {t.hero.card.liveLabel} — <b className="font-medium text-paper">{t.hero.card.liveValue}</b>
            </div>
            <div>
              {t.hero.card.stateLabel} — <b className="font-medium text-paper">{t.hero.card.stateValue}</b>
            </div>
          </div>
        </div>

        <div className="force-ltr border-t border-ink-3 pt-3 font-mono text-[8.5px] leading-[1.55] tracking-normal text-paper/55 sm:text-[12.5px] sm:tracking-[0.04em]">
          <div>
            P&lt;LBY<b className="font-normal text-gold">SAMPLE</b>&lt;&lt;APPLICANT&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
          </div>
          <div>
            A0000000&lt;9LBY000000<b className="font-normal text-gold">0</b>M000000<b className="font-normal text-gold">0</b>&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;4
          </div>
        </div>
      </div>
    </div>
  );
}
