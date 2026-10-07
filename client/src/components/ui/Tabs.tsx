import React from 'react';
import { cn } from './cn';

export interface TabItem<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
  icon?: React.ElementType;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/** Underlined tab bar for switching views or filters within a page. */
export function Tabs<T extends string>({ items, value, onChange, ariaLabel, className }: TabsProps<T>) {
  return (
    <div className={cn('border-b border-slate-200', className)}>
      <div role="tablist" aria-label={ariaLabel} className="-mb-px flex gap-5 overflow-x-auto scrollbar-none">
        {items.map((item) => {
          const active = item.value === value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onChange(item.value)}
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-0.5 pb-2.5 pt-1 text-[13px] font-medium transition-colors',
                active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
              )}
            >
              {Icon && <Icon className="h-4 w-4" aria-hidden />}
              {item.label}
              {item.count !== undefined && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-2xs font-semibold tabular',
                    active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pill-shaped segmented control for a small, exclusive choice. */
export function Segmented<T extends string>({ items, value, onChange, ariaLabel, className }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('inline-grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-slate-100 p-1', className)}>
      {items.map((item) => {
        const active = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all',
              active ? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
