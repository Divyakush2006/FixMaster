import React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from './cn';

type StatTone = 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const ICON_TONE: Record<StatTone, string> = {
  brand: 'bg-brand-50 text-brand-600',
  info: 'bg-sky-50 text-sky-600',
  success: 'bg-emerald-50 text-emerald-600',
  warning: 'bg-amber-50 text-amber-600',
  danger: 'bg-rose-50 text-rose-600',
  neutral: 'bg-slate-100 text-slate-600',
};

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** Supporting line under the value, e.g. "12% of all tickets". */
  subtitle?: React.ReactNode;
  tone?: StatTone;
  /** Draws attention (coloured top edge) - for figures that need action. */
  highlight?: boolean;
  loading?: boolean;
}

/** KPI tile: label, large figure, optional context line. */
export const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, subtitle, tone = 'brand', highlight, loading }) => (
  <div
    className={cn(
      'relative overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-card',
      highlight && 'border-rose-200 before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-rose-500'
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <p className="text-[13px] font-medium text-slate-500">{title}</p>
      {Icon && (
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', ICON_TONE[tone])}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      )}
    </div>
    {loading ? (
      <div className="mt-2 h-7 w-16 animate-pulse rounded bg-slate-100" />
    ) : (
      <p className="mt-1 text-[26px] font-semibold leading-8 tracking-tight text-slate-900 tabular">{value}</p>
    )}
    {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
  </div>
);
