import React from 'react';
import { cn } from './cn';

export const PageLoader: React.FC<{ fullScreen?: boolean; label?: string }> = ({ fullScreen, label = 'Loading' }) => (
  <div
    className={cn('flex flex-col items-center justify-center gap-3', fullScreen ? 'min-h-screen bg-canvas' : 'min-h-[50vh]')}
    role="status"
    aria-label={label}
  >
    <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-600" />
    {fullScreen && <p className="text-[13px] text-slate-500">{label}...</p>}
  </div>
);

/** Grey placeholder block for content that is still loading. */
export const Skeleton: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn('animate-pulse rounded-md bg-slate-200/70', className)} aria-hidden />
);
