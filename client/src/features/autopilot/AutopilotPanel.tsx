import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ShieldAlert, Sparkles } from 'lucide-react';
import { autopilotApi } from '../../api/endpoints';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/PageLoader';
import { cn } from '../../components/ui/cn';
import type { AutopilotCandidate, ScoreComponent } from '../../types';
import { COMPONENT_HELP, COMPONENT_LABEL, EXCLUSION_LABEL, MODE_LABEL } from './autopilotLabels';

const ORDER: ScoreComponent[] = ['quality', 'load', 'idle', 'proximity', 'reliability', 'roomHistory'];

/** One horizontal bar per score part: how strong it is, and how much it counts. */
export const ScoreBreakdown: React.FC<{ candidate: AutopilotCandidate }> = ({ candidate }) => (
  <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
    {ORDER.map((k) => (
      <div key={k} className="flex items-center gap-2 text-xs" title={COMPONENT_HELP[k]}>
        <dt className="w-32 shrink-0 text-slate-600">{COMPONENT_LABEL[k]}</dt>
        <dd className="flex flex-1 items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <span className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.round(candidate.components[k] * 100)}%` }} />
          </span>
          <span className="w-12 text-right font-mono tabular-nums text-slate-500">
            {Math.round(candidate.components[k] * candidate.weights[k])}/{Math.round(candidate.weights[k])}
          </span>
        </dd>
      </div>
    ))}
  </dl>
);

/**
 * The autopilot's view of an open ticket, inside the dispatch drawer: who it
 * would send and why, who it left out and why, and one click to accept.
 * Choosing someone else by hand stays available underneath.
 */
export const AutopilotPanel: React.FC<{ complaintId: string; onAssigned: (name: string) => void; onPick: (userId: string) => void }> = ({ complaintId, onAssigned, onPick }) => {
  const [showExcluded, setShowExcluded] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ['autopilot-suggestions', complaintId], queryFn: () => autopilotApi.suggestions(complaintId) });
  const accept = useMutation({
    mutationFn: () => autopilotApi.dispatch(complaintId),
    onSuccess: (r) => r.assigned && r.staff_name && onAssigned(r.staff_name),
  });

  if (isLoading) return <Skeleton className="h-32" />;
  if (isError || !data) return null;
  if (data.settings.mode === 'OFF') return null;

  const [best, ...rest] = data.candidates;
  return (
    <section className="rounded-lg border border-brand-200 bg-brand-50/40 p-4" aria-labelledby="autopilot-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="autopilot-heading" className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
          <Sparkles className="h-4 w-4 text-brand-700" aria-hidden />
          Autopilot suggestion
        </h4>
        <div className="flex items-center gap-1.5">
          {data.recovery && (
            <Badge tone="orange" title="This place had a bad experience recently: only the best-rated quarter is considered, and ratings count for half the score.">
              <ShieldAlert className="mr-1 h-3 w-3" aria-hidden />
              Recovery mode
            </Badge>
          )}
          <Badge tone="neutral">{MODE_LABEL[data.settings.mode]}</Badge>
        </div>
      </div>

      {!best ? (
        <p className="mt-3 text-[13px] text-slate-700">Nobody can take this right now. See who was left out below, or choose someone by hand.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">{best.full_name}</p>
                <p className="text-xs text-slate-500">
                  {best.live_jobs} live {best.live_jobs === 1 ? 'job' : 'jobs'} · {best.rated_jobs} rated in 60 days
                </p>
              </div>
              <span className="font-mono text-lg font-semibold tabular-nums text-brand-800" aria-label={`Score ${best.score} out of 100`}>
                {best.score}
              </span>
            </div>
            <div className="mt-3">
              <ScoreBreakdown candidate={best} />
            </div>
            {accept.data && !accept.data.assigned && <p className="mt-2 text-xs text-rose-700">Nobody was free any more; refresh and try again.</p>}
            {accept.isError && <p className="mt-2 text-xs text-rose-700">{(accept.error as Error).message}</p>}
            <div className="mt-3 flex justify-end">
              <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}>
                Assign {best.full_name.split(' ')[0]}
              </Button>
            </div>
          </div>
          {rest.length > 0 && (
            <ol className="space-y-1" aria-label="Other candidates">
              {rest.slice(0, 4).map((c, i) => (
                <li key={c.user_id}>
                  <button type="button" onClick={() => onPick(c.user_id)} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-white">
                    <span>
                      <span className="mr-2 font-mono text-xs text-slate-500">#{i + 2}</span>
                      {c.full_name}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600">{c.score}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {data.excluded.length > 0 && (
        <div className="mt-3 border-t border-brand-100 pt-2">
          <button type="button" onClick={() => setShowExcluded((v) => !v)} className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900" aria-expanded={showExcluded}>
            <ChevronDown className={cn('h-3.5 w-3.5 transition', showExcluded && 'rotate-180')} aria-hidden />
            {data.excluded.length} not considered
          </button>
          {showExcluded && (
            <ul className="mt-2 space-y-1">
              {data.excluded.map((e) => (
                <li key={e.user_id} className="flex justify-between gap-3 text-xs">
                  <span className="text-slate-800">{e.full_name}</span>
                  <span className="text-slate-500">{EXCLUSION_LABEL[e.reason]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
