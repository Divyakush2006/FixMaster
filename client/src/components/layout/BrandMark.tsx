import React from 'react';
import { cn } from '../ui/cn';
import logoMark from '../../assets/logo-mark.png';

/** Product logo mark + wordmark. `tone` picks the text colour for dark or light backgrounds. */
export const BrandMark: React.FC<{ tone?: 'light' | 'dark'; subtitle?: string; className?: string }> = ({
  tone = 'dark',
  subtitle = 'Hostel Facilities',
  className,
}) => (
  <div className={cn('flex items-center gap-2.5', className)}>
    <img
      src={logoMark}
      alt=""
      width={36}
      height={36}
      className={cn('h-9 w-9 shrink-0 rounded-lg', tone === 'light' && 'ring-1 ring-white/15')}
    />
    <div className="leading-tight">
      <div className={cn('text-[15px] font-semibold tracking-tight', tone === 'light' ? 'text-white' : 'text-slate-900')}>FixMaster</div>
      {subtitle && <div className={cn('text-2xs font-medium', tone === 'light' ? 'text-white/55' : 'text-slate-500')}>{subtitle}</div>}
    </div>
  </div>
);
