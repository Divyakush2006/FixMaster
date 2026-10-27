import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Hourglass, Play } from 'lucide-react';
import { autopilotApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/ui/StatCard';
import { PriorityBadge, SpecializationBadge } from '../../components/common/Badges';
import { blockLabel, ticketRef } from '../../utils/labels';
import { waitingReason } from './autopilotLabels';

/**
 * What Automatic has actually done: tickets it assigned in the last day, and the
 * ones still waiting for it with the reason (everyone on duty is at their limit,
 * off shift ...). It retries waiting tickets every minute by itself; "Run now"
 * does it on the spot.
 */
export const AutopilotStatusCard: React.FC = () => {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['autopilot-status'], queryFn: autopilotApi.status, refetchInterval: 30_000 });

  const run = useMutation({
    mutationFn: autopilotApi.sweep,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['autopilot-status'] });
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      queryClient.invalidateQueries({ queryKey: ['analytics-kpi'] });
      showToast(
        r.checked === 0 ? 'Nothing was waiting' : `Assigned ${r.assigned} of ${r.checked}`,
        r.assigned > 0 || r.checked === 0 ? 'success' : 'info',
        r.waiting > 0 ? `${r.waiting} still have nobody who can take them.` : undefined
      );
    },
    onError: (err: Error) => showToast('Could not run the autopilot', 'error', err.message),
  });

  const waiting = data?.waiting ?? [];
  const lastRun = data?.last_sweep ? new Date(data.last_sweep.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <Card className="mb-6">
      <CardHeader
        title="What Automatic is doing"
        description={`Tickets on Automatic that nobody could take are retried every minute${lastRun ? ` (last pass ${lastRun})` : ''}.`}
        icon={<Bot className="h-5 w-5 text-slate-500" aria-hidden />}
        actions={
          <Button size="sm" variant="secondary" icon={Play} loading={run.isPending} onClick={() => run.mutate()}>
            Run now
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 px-4 pb-4 sm:grid-cols-2">
        <StatCard title="Assigned automatically, last 24 hours" value={data?.assigned_last_24h ?? '—'} icon={Bot} tone="success" loading={isLoading} />
        <StatCard
          title="Waiting for the autopilot"
          value={data?.waiting_total ?? '—'}
          icon={Hourglass}
          tone={data && data.waiting_total > 0 ? 'warning' : 'neutral'}
          highlight={!!data && data.waiting_total > 0}
          loading={isLoading}
          subtitle="Open tickets on Automatic"
        />
      </div>
      {waiting.length > 0 && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100" aria-label="Tickets waiting for the autopilot">
          {waiting.map((w) => (
            <li key={w.complaint_id} className="flex flex-col gap-1 px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{ticketRef(w.complaint_id)}</span>
                <span className="font-medium text-slate-900">{w.issue_name}</span>
                <span className="text-slate-500">{blockLabel(w.block_id)}</span>
                <SpecializationBadge specialization={w.specialization} />
                <PriorityBadge priority={w.priority} />
              </div>
              <p className="text-xs text-slate-600">
                {w.waiting_minutes < 60 ? `${w.waiting_minutes} min` : `${Math.round(w.waiting_minutes / 60)} h`} · {waitingReason(w)}
              </p>
            </li>
          ))}
          {data && data.waiting_total > waiting.length && (
            <li className="px-4 py-2 text-xs text-slate-500">…and {data.waiting_total - waiting.length} more, oldest and most urgent first above.</li>
          )}
        </ul>
      )}
    </Card>
  );
};
