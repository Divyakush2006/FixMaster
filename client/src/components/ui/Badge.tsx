import React from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'violet' | 'orange';

const TONE: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-500/15',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/15',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  orange: 'bg-orange-50 text-orange-700 ring-orange-600/20',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  brand: 'bg-brand-500',
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  violet: 'bg-violet-500',
  orange: 'bg-orange-500',
};

interface BadgeProps {
  tone?: Tone;
  dot?: boolean;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  title?: string;
}

export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', dot, icon, className, children, title }) => (
  <span
    title={title}
    className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
      TONE[tone],
      className
    )}
  >
    {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone])} aria-hidden />}
    {icon}
    {children}
  </span>
);
