import React from 'react';
import { Check } from 'lucide-react';
import { TimelineEvent } from '../../types';
import { cn } from '../ui/cn';

/** Vertical activity history: completed steps, the current step, pending steps. */
export const ActivityTimeline: React.FC<{ events: TimelineEvent[] }> = ({ events }) => (
  <ol className="relative">
    {events.map((event, idx) => {
      const last = idx === events.length - 1;
      return (
        <li key={`${event.title}-${idx}`} className="relative flex gap-3.5 pb-5 last:pb-0">
          {!last && <span className="absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px bg-slate-200" aria-hidden />}
          <span
            className={cn(
              'relative z-10 mt-0.5 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border-2',
              event.status === 'completed' && 'border-brand-600 bg-brand-600 text-white',
              event.status === 'current' && 'border-amber-500 bg-white',
              event.status === 'pending' && 'border-slate-300 bg-white'
            )}
            aria-hidden
          >
            {event.status === 'completed' && <Check className="h-3 w-3" strokeWidth={3} />}
            {event.status === 'current' && <span className="h-2 w-2 rounded-full bg-amber-500" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className={cn('text-[13px] font-medium', event.status === 'pending' ? 'text-slate-500' : 'text-slate-900')}>{event.title}</p>
              <time className="text-xs text-slate-500 tabular">{event.timestamp}</time>
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{event.description}</p>
          </div>
        </li>
      );
    })}
  </ol>
);
