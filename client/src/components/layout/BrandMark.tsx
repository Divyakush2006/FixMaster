import React from 'react';
import { cn } from '../ui/cn';

/** Product logo mark + wordmark. `tone` picks the text colour for dark or light backgrounds. */
export const BrandMark: React.FC<{ tone?: 'light' | 'dark'; subtitle?: string; className?: string }> = ({
  tone = 'dark',
  subtitle = 'Hostel Facilities',
  className,
}) => (
  <div className={cn('flex items-center gap-2.5', className)}>
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#2559eb" />
      <path d="M10 9h12v3.2h-8.4v3.1h7.2v3.1h-7.2V23H10z" fill="#fff" />
    </svg>
    <div className="leading-tight">
      <div className={cn('text-[15px] font-semibold tracking-tight', tone === 'light' ? 'text-white' : 'text-slate-900')}>FixMaster</div>
      {subtitle && <div className={cn('text-2xs font-medium', tone === 'light' ? 'text-white/55' : 'text-slate-500')}>{subtitle}</div>}
    </div>
  </div>
);
