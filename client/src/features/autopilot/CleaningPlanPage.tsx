import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { autopilotApi } from '../../api/endpoints';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Field, Select } from '../../components/ui/Form';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/PageLoader';
import type { StaffShift } from '../../types';
import { blockLabel } from '../../utils/labels';
import { useManagedBlocks } from './useManagedBlocks';

const SHIFTS: { value: StaffShift; label: string }[] = [
  { value: 'MORNING', label: 'Morning shift' },
  { value: 'EVENING', label: 'Evening shift' },
  { value: 'NIGHT', label: 'Night shift' },
];

const SLOT_LABEL = { MORNING: 'Morning', AFTERNOON: 'Afternoon', EVENING: 'Evening' } as const;

/**
 * Who cleans which floors in a block on a shift. Rooms are split evenly across
 * the housekeepers on duty, and each resident's preferred cleaning slot is
 * counted so a round can be planned around when people are in.
 */
export const CleaningPlanPage: React.FC = () => {
  const { blocks, isLoading: loadingBlocks } = useManagedBlocks();
  const [blockId, setBlockId] = useState('');
  const [shift, setShift] = useState<StaffShift>('MORNING');

  useEffect(() => {
    if (!blockId && blocks.length > 0) setBlockId(blocks[0].block_id);
  }, [blocks, blockId]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cleaning-plan', blockId, shift],
    queryFn: () => autopilotApi.cleaningPlan(blockId, shift),
    enabled: Boolean(blockId),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Cleaning plan' }]}
        title="Cleaning plan"
        description="How the rooms in a block are shared between the housekeepers on a shift."
      />

      <Card className="mb-6 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Block">
            {(a) => (
              <Select {...a} value={blockId} onChange={(e) => setBlockId(e.target.value)} disabled={loadingBlocks}>
                {blocks.map((b) => (
                  <option key={b.block_id} value={b.block_id}>
                    {blockLabel(b.block_id)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Shift">
            {(a) => (
              <Select {...a} value={shift} onChange={(e) => setShift(e.target.value as StaffShift)}>
                {SHIFTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      {isLoading || loadingBlocks ? (
        <Skeleton className="h-48" />
      ) : isError || !data ? (
        <Alert tone="danger">The plan could not be loaded. Try again in a moment.</Alert>
      ) : (
        <div className="space-y-4">
          {data.uses_campus_pool && (
            <Alert tone="info" title="Campus pool in use">
              This block has no housekeepers of its own on this shift, so staff from the campus pool are covering it.
            </Alert>
          )}
          {data.unassigned_floors.length > 0 && (
            <Alert tone="warning" title="Floors without a cleaner">
              Floor {data.unassigned_floors.join(', ')} {data.unassigned_floors.length === 1 ? 'has' : 'have'} nobody assigned on this shift.
            </Alert>
          )}

          {data.cleaners.length === 0 ? (
            <EmptyState icon={Sparkles} title="No housekeepers on this shift" description="Nobody is on duty for this block and shift, so there is nothing to plan." />
          ) : (
            <>
              <p className="text-[13px] text-slate-600">
                {data.total_rooms} rooms shared between {data.cleaners.length} {data.cleaners.length === 1 ? 'housekeeper' : 'housekeepers'}.
              </p>
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {data.cleaners.map((c) => (
                  <li key={c.user_id}>
                    <Card className="h-full p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{c.full_name}</p>
                          <p className="text-xs text-slate-500">{c.floors.length === 0 ? 'No floors' : `Floor ${c.floors.join(', ')}`}</p>
                        </div>
                        <p className="text-right">
                          <span className="font-mono text-lg font-semibold tabular-nums text-brand-800">{c.rooms}</span>
                          <span className="block text-xs text-slate-500">rooms</span>
                        </p>
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-xs">
                        {(Object.keys(SLOT_LABEL) as (keyof typeof SLOT_LABEL)[]).map((k) => (
                          <div key={k}>
                            <dt className="text-slate-500">{SLOT_LABEL[k]}</dt>
                            <dd className="font-mono tabular-nums text-slate-800">{c.slots[k]}</dd>
                          </div>
                        ))}
                      </dl>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
};
