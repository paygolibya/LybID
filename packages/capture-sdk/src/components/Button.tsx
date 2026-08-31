import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const variants = {
    primary: 'bg-brand text-white hover:bg-brand/90',
    secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props} />
  );
}
