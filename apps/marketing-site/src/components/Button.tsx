import type { ReactNode } from 'react';
import { useLanguage } from '../i18n';

type Variant = 'solid-verified' | 'solid-gold' | 'ghost-ink' | 'ghost-gold';

const VARIANT_CLASSES: Record<Variant, string> = {
  'solid-verified': 'bg-verified text-paper hover:bg-verified-deep',
  'solid-gold': 'bg-gold text-ink hover:bg-gold-deep',
  'ghost-ink': 'border border-paper-3 text-ink hover:border-verified',
  'ghost-gold': 'border border-ink-3 text-paper hover:border-gold',
};

export function Button({
  children,
  variant,
  withArrow,
  disabled,
  href = '#',
  className = '',
}: {
  children: ReactNode;
  variant: Variant;
  withArrow?: boolean;
  disabled?: boolean;
  href?: string;
  className?: string;
}) {
  const { isAr } = useLanguage();
  return (
    <a
      href={disabled ? undefined : href}
      aria-disabled={disabled}
      className={`group inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold transition
        ${disabled ? 'cursor-default opacity-55 hover:!bg-paper-3 hover:!border-paper-3' : ''}
        ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
      {withArrow && (
        <span
          className={`inline-block transition-transform group-hover:translate-x-0.5 ${isAr ? 'group-hover:-translate-x-0.5 scale-x-[-1]' : ''}`}
        >
          →
        </span>
      )}
    </a>
  );
}
