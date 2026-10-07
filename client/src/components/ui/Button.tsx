import React from 'react';
import { Link, LinkProps } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { cn } from './cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-xs hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600',
  secondary:
    'bg-white text-slate-700 border border-slate-300 shadow-xs hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 disabled:bg-white',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200',
  danger: 'bg-rose-600 text-white shadow-xs hover:bg-rose-700 active:bg-rose-800 disabled:bg-rose-600',
  'danger-outline': 'bg-white text-rose-700 border border-rose-200 shadow-xs hover:bg-rose-50 active:bg-rose-100',
  success: 'bg-emerald-600 text-white shadow-xs hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-600',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

const ICON_SIZE: Record<ButtonSize, string> = { sm: 'h-3.5 w-3.5', md: 'h-4 w-4', lg: 'h-4 w-4' };

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANT[variant],
    SIZE[size],
    className
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  block?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, loading, block, className, children, disabled, type = 'button', ...rest },
    ref
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, cn(block && 'w-full', className))}
      {...rest}
    >
      {loading ? <Spinner className={ICON_SIZE[size]} /> : Icon && <Icon className={ICON_SIZE[size]} aria-hidden />}
      {children}
      {IconRight && !loading && <IconRight className={ICON_SIZE[size]} aria-hidden />}
    </button>
  )
);
Button.displayName = 'Button';

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}

export const ButtonLink: React.FC<ButtonLinkProps> = ({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  ...rest
}) => (
  <Link className={buttonClasses(variant, size, className)} {...rest}>
    {Icon && <Icon className={ICON_SIZE[size]} aria-hidden />}
    {children}
    {IconRight && <IconRight className={ICON_SIZE[size]} aria-hidden />}
  </Link>
);

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'danger';
}

/** Square icon-only button. `label` is required: it is the accessible name and tooltip. */
export const IconButton: React.FC<IconButtonProps> = ({ icon: Icon, label, size = 'md', tone = 'default', className, type = 'button', ...rest }) => (
  <button
    type={type}
    aria-label={label}
    title={label}
    className={cn(
      'inline-flex items-center justify-center rounded-md text-slate-500 transition-colors',
      'hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40',
      tone === 'danger' && 'hover:bg-rose-50 hover:text-rose-700',
      size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
      className
    )}
    {...rest}
  >
    <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden />
  </button>
);
