import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, Star, Tags } from 'lucide-react';
import { autopilotApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Form';
import { EmptyState } from '../../components/ui/EmptyState';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { SpecializationBadge } from '../../components/common/Badges';
import type { Specialization, StaffPerformanceRow } from '../../types';
import { SPECIALIZATION_LABEL, blockLabel } from '../../utils/labels';
import { formatRelativeTime } from '../../utils/formatters';
import { FLAG_LABEL, POSITIVE_TAGS, TAG_LABEL } from './autopilotLabels';

const TRADES: Specialization[] = ['CLEANING', 'ELECTRICIAN', 'PLUMBER', 'AC_TECH', 'CARPENTER'];
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

/**
 * Sixty days of each technician's work: ratings (raw and smoothed), work sent
 * back, deadlines met, and what residents' comments mention. Flags appear only
 * after enough rated jobs, always with their evidence - they start a
 * conversation, they never penalise anyone automatically.
 */
export const StaffPerformancePage: React.FC = () => {
  const [trade, setTrade] = useState<Specialization | ''>('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const { user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['staff-performance', trade], queryFn: () => autopilotApi.performance(trade || undefined) });
  const rows = flaggedOnly ? data.filter((r) => r.flags.length > 0) : data;
  const flagged = data.filter((r) => r.flags.length > 0).length;

  const tagNow = useMutation({
    mutationFn: autopilotApi.tagFeedback,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['staff-performance'] });
      showToast('Comments read', 'success', `${r.tagged} new review comment${r.tagged === 1 ? '' : 's'} tagged${r.source === 'RULES' ? ' by keyword rules' : ''}.`);
    },
  });

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Staff performance' }]}
        title="Staff performance"
        description="Last 60 days. The autopilot uses the same figures to choose technicians."
        actions={
          user && ['CHIEF_WARDEN', 'ADMIN'].includes(user.role) ? (
            <Button variant="secondary" icon={Tags} loading={tagNow.isPending} onClick={() => tagNow.mutate()}>
              Read new comments now
            </Button>
          ) : undefined
        }
      />

      {flagged > 0 && (
        <Alert tone="warning" className="mb-4" title={`${flagged} ${flagged === 1 ? 'technician needs' : 'technicians need'} a look`}>
          Flags need at least 8 rated jobs and show their evidence. Talk to the person before drawing conclusions.
        </Alert>
      )}

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-3 sm:flex-row sm:items-center">
          <Select aria-label="Trade" value={trade} onChange={(e) => setTrade(e.target.value as Specialization | '')} className="sm:w-56">
            <option value="">All trades</option>
            {TRADES.map((t) => (
              <option key={t} value={t}>
                {SPECIALIZATION_LABEL[t]}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-[13px] text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            Flagged only
          </label>
          <p className="text-[13px] text-slate-500 sm:ml-auto">{isLoading ? 'Loading…' : `${rows.length} technicians`}</p>
        </div>

        {!isLoading && rows.length === 0 ? (
          <EmptyState bare title={flaggedOnly ? 'Nobody is flagged' : 'No technicians'} description={flaggedOnly ? 'Every technician with enough rated jobs is within the thresholds.' : 'No staff match this filter.'} />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Technician</Th>
                  <Th className="text-right">Rating</Th>
                  <Th className="text-right">Sent back</Th>
                  <Th className="text-right">On time</Th>
                  <Th className="text-right">Avg. job</Th>
                  <Th className="text-right">Live</Th>
                  <Th>Residents mention</Th>
                  <Th>Flags</Th>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={8} />
              ) : (
                <TBody>
                  {rows.map((r) => (
                    <PerformanceRow key={r.user_id} row={r} />
                  ))}
                </TBody>
              )}
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
};

const PerformanceRow: React.FC<{ row: StaffPerformanceRow }> = ({ row: r }) => {
  const tags = Object.entries(r.comment_tags).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <Tr>
      <Td>
        <p className="font-medium text-slate-900">{r.full_name}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          <SpecializationBadge specialization={r.specialization} />
          {r.home_block_id ? blockLabel(r.home_block_id) : 'Campus pool'}
          {r.shift ? ` · ${r.shift.toLowerCase()}` : ''}
          {!r.is_available && <Badge tone="neutral">Off duty</Badge>}
        </p>
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums" title={r.smoothed_rating !== null ? `Smoothed for the score: ${r.smoothed_rating}` : undefined}>
        {r.avg_rating === null ? (
          <span className="text-slate-500">No ratings</span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
            {r.avg_rating.toFixed(1)} <span className="text-xs text-slate-500">({r.rated_jobs})</span>
          </span>
        )}
      </Td>
      <Td className="text-right tabular-nums">{r.verification_rounds ? `${pct(r.rework_rate)} (${r.sent_back})` : '—'}</Td>
      <Td className="text-right tabular-nums">{pct(r.on_time_rate)}</Td>
      <Td className="text-right tabular-nums">{r.avg_minutes === null ? '—' : `${r.avg_minutes} min`}</Td>
      <Td className="text-right tabular-nums" title={r.last_assigned_at ? `Last job ${formatRelativeTime(r.last_assigned_at)}` : 'No jobs yet'}>
        {r.live_jobs}
      </Td>
      <Td>
        <div className="flex flex-wrap gap-1">
          {tags.length === 0 ? (
            <span className="text-xs text-slate-500">—</span>
          ) : (
            tags.map(([tag, n]) => (
              <Badge key={tag} tone={POSITIVE_TAGS.has(tag) ? 'success' : 'warning'}>
                {TAG_LABEL[tag] ?? tag} · {n}
              </Badge>
            ))
          )}
        </div>
      </Td>
      <Td>
        <ul className="space-y-1">
          {r.flags.map((f) => (
            <li key={f.code} className="text-xs">
              <span className="inline-flex items-center gap-1 font-medium text-rose-800">
                <Flag className="h-3 w-3" aria-hidden />
                {FLAG_LABEL[f.code]}
              </span>
              <span className="block text-slate-500">{f.evidence}</span>
            </li>
          ))}
        </ul>
      </Td>
    </Tr>
  );
};
