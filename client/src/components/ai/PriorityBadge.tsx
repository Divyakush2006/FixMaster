import React from 'react';
import { Priority } from '../../types';
import { cn } from '../ui/cn';

interface Props {
  priority: Priority;
  reasoning?: string | null;
  className?: string;
}

const PRIORITY_STYLES: Record<Priority, { bg: string; text: string; border: string; dot: string }> = {
  LOW: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
  },
  MEDIUM: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  HIGH: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    dot: 'bg-orange-500',
  },
  EMERGENCY: {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-300',
    dot: 'bg-rose-500',
  },
};

export const PriorityBadge: React.FC<Props> = ({ priority, reasoning, className }) => {
  const style = PRIORITY_STYLES[priority] || PRIORITY_STYLES.MEDIUM;

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)} title={reasoning || undefined}>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide',
          style.bg,
          style.text,
          style.border
        )}
      >
        <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
        {priority}
      </span>
      {reasoning && (
        <span className="hidden text-[11px] text-slate-500 sm:inline truncate max-w-[280px]">
          ({reasoning})
        </span>
      )}
    </div>
  );
};
