import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { autopilotApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Form';
import { Segmented } from '../../components/ui/Tabs';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/PageLoader';
import { SpecializationBadge } from '../../components/common/Badges';
import type { AutopilotMode, AutopilotSetting, ScoreComponent, Specialization } from '../../types';
import { blockLabel } from '../../utils/labels';
import { COMPONENT_HELP, COMPONENT_LABEL, MODE_HELP, MODE_LABEL } from './autopilotLabels';
import { useManagedBlocks } from './useManagedBlocks';

const TRADES: Specialization[] = ['CLEANING', 'ELECTRICIAN', 'PLUMBER', 'AC_TECH', 'CARPENTER'];
const MODES: AutopilotMode[] = ['OFF', 'SUGGEST', 'AUTO'];
const COMPONENTS: ScoreComponent[] = ['quality', 'load', 'idle', 'proximity', 'reliability', 'roomHistory'];
const CAMPUS = '__campus__';

/**
 * Where and how far the dispatch autopilot acts: per block and trade, Off,
 * Suggest or Automatic, with a live-job cap and, for those who want it, the
 * weights of the score. A block without its own setting follows the campus
 * default.
 */
export const AutopilotSettingsPage: React.FC = () => {
  const { data, isLoading } = useQuery({ queryKey: ['autopilot-settings'], queryFn: autopilotApi.settings });
  const { blocks, isLoading: loadingBlocks } = useManagedBlocks();
  const [scope, setScope] = useState<string>('');

  useEffect(() => {
    if (scope || !data || loadingBlocks) return;
    setScope(data.can_edit_campus_default ? CAMPUS : blocks[0]?.block_id ?? '');
  }, [data, blocks, loadingBlocks, scope]);

  const blockId = scope === CAMPUS ? null : scope;
  const find = (b: string | null, trade: Specialization) => data?.settings.find((s) => s.block_id === b && s.specialization === trade);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Autopilot' }]}
        title="Dispatch autopilot"
        description="Choose where the autopilot only suggests a technician and where it assigns one by itself. Every automatic decision is recorded with its full score."
      />

      <Card className="mb-6 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[280px_1fr] sm:items-end">
          <Field label="Settings for">
            {(a) => (
              <Select {...a} value={scope} onChange={(e) => setScope(e.target.value)}>
                {data?.can_edit_campus_default && <option value={CAMPUS}>Campus default (every block)</option>}
                {blocks.map((b) => (
                  <option key={b.block_id} value={b.block_id}>
                    {blockLabel(b.block_id)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ul className="grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-3">
            {MODES.map((m) => (
              <li key={m}>
                <strong className="text-slate-800">{MODE_LABEL[m]}:</strong> {MODE_HELP[m]}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {isLoading || !data || !scope ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-3">
          {TRADES.map((trade) => (
            <TradeSettingRow
              key={`${scope}-${trade}`}
              blockId={blockId}
              trade={trade}
              own={find(blockId, trade)}
              inherited={blockId ? find(null, trade) : undefined}
              defaults={data.defaults}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TradeSettingRow: React.FC<{
  blockId: string | null;
  trade: Specialization;
  own?: AutopilotSetting;
  inherited?: AutopilotSetting;
  defaults: { mode: AutopilotMode; live_job_cap: number; weights: Record<ScoreComponent, number> };
}> = ({ blockId, trade, own, inherited, defaults }) => {
  const effective = own ?? inherited ?? { ...defaults, block_id: null, specialization: trade };
  const [mode, setMode] = useState<AutopilotMode>(effective.mode);
  const [cap, setCap] = useState(effective.live_job_cap);
  const [weights, setWeights] = useState<Record<ScoreComponent, number>>(() =>
    Object.fromEntries(COMPONENTS.map((k) => [k, Math.round(effective.weights[k])])) as Record<ScoreComponent, number>
  );
  const [tuning, setTuning] = useState(false);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const total = useMemo(() => COMPONENTS.reduce((s, k) => s + (weights[k] || 0), 0), [weights]);

  const save = useMutation({
    mutationFn: () => autopilotApi.saveSetting({ block_id: blockId, specialization: trade, mode, live_job_cap: cap, weights: tuning ? weights : own?.weights ?? null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autopilot-settings'] });
      showToast('Autopilot updated', 'success', `${trade.toLowerCase()} · ${blockId ? blockLabel(blockId) : 'campus default'}: ${MODE_LABEL[mode]}`);
    },
    onError: (err: Error) => showToast('Not saved', 'error', err.message),
  });

  const dirty = mode !== effective.mode || cap !== effective.live_job_cap || tuning;

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <SpecializationBadge specialization={trade} />
          {!own && <Badge tone="neutral">{blockId && inherited ? 'Follows campus default' : 'Default'}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            ariaLabel={`Autopilot mode for ${trade}`}
            value={mode}
            onChange={(v) => setMode(v)}
            items={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
          />
          <label className="flex items-center gap-2 text-xs text-slate-600">
            Live-job cap
            <Input type="number" min={1} max={50} value={cap} onChange={(e) => setCap(Number(e.target.value))} className="w-20" aria-label={`Live-job cap for ${trade}`} />
          </label>
          <Button variant="ghost" size="sm" icon={SlidersHorizontal} onClick={() => setTuning((t) => !t)} aria-expanded={tuning}>
            Weights
          </Button>
          <Button size="sm" disabled={!dirty || cap < 1 || cap > 50 || (tuning && total === 0)} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
      {tuning && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-3 text-xs text-slate-600">
            How much each part counts. They are scaled to add up to 100 (now {total}). After a bad experience at a place, ratings count for half automatically.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {COMPONENTS.map((k) => (
              <Field key={k} label={COMPONENT_LABEL[k]} hint={undefined}>
                {(a) => (
                  <Input
                    {...a}
                    type="number"
                    min={0}
                    max={100}
                    title={COMPONENT_HELP[k]}
                    value={weights[k]}
                    onChange={(e) => setWeights((w) => ({ ...w, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))}
                  />
                )}
              </Field>
            ))}
          </div>
          {total === 0 && (
            <Alert tone="warning" className="mt-3">
              At least one weight must be above zero.
            </Alert>
          )}
        </div>
      )}
    </Card>
  );
};
