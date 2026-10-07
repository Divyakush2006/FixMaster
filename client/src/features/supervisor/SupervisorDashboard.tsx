import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, Inbox, Layers, Star, Wrench } from 'lucide-react';
import { analyticsApi } from '../../api/endpoints';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Alert } from '../../components/ui/Alert';
import { ButtonLink } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/PageLoader';
import { Switch } from '../../components/ui/Switch';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { coerceNumber } from '../../utils/formatters';
import { cn } from '../../components/ui/cn';

// One colour per lifecycle stage, used by both charts and the legend.
const SERIES = [
  { key: 'Not started', color: '#94a3b8' },
  { key: 'In progress', color: '#3b72f6' },
  { key: 'Awaiting confirmation', color: '#f59e0b' },
  { key: 'Resolved', color: '#10b981' },
  { key: 'Escalated', color: '#e11d48' },
] as const;

const tooltipStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  boxShadow: '0 8px 24px -8px rgb(16 24 40 / 0.18)',
  fontSize: 12,
  padding: '8px 12px',
};

export const SupervisorDashboard: React.FC = () => {
  const [showEmptyBlocks, setShowEmptyBlocks] = useState(false);
  const { data: kpis = [], isLoading, dataUpdatedAt } = useQuery({ queryKey: ['analytics-kpi'], queryFn: analyticsApi.getKpis });

  const blocks = useMemo(
    () =>
      kpis.map((b) => ({
        id: b.block_id,
        name: b.block_name || b.block_id,
        total: coerceNumber(b.total_complaints),
        notStarted: coerceNumber(b.pending_complaints),
        inProgress: coerceNumber(b.active_in_progress),
        verification: coerceNumber(b.awaiting_student_verification),
        resolved: coerceNumber(b.resolved_count),
        escalated: coerceNumber(b.escalated_count),
        commonArea: coerceNumber(b.common_area_issues),
        rating: coerceNumber(b.average_student_rating),
      })),
    [kpis]
  );

  const totals = blocks.reduce(
    (acc, b) => ({
      total: acc.total + b.total,
      notStarted: acc.notStarted + b.notStarted,
      inProgress: acc.inProgress + b.inProgress,
      verification: acc.verification + b.verification,
      resolved: acc.resolved + b.resolved,
      escalated: acc.escalated + b.escalated,
    }),
    { total: 0, notStarted: 0, inProgress: 0, verification: 0, resolved: 0, escalated: 0 }
  );

  const pct = (n: number) => (totals.total ? `${Math.round((n / totals.total) * 100)}% of all tickets` : 'No tickets yet');
  const activeBlocks = blocks.filter((b) => b.total > 0);
  const tableBlocks = (showEmptyBlocks ? blocks : activeBlocks).slice().sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const chartData = activeBlocks.map((b) => ({
    block: b.name.replace(/\s*\(.*\)$/, ''),
    'Not started': b.notStarted,
    'In progress': b.inProgress,
    'Awaiting confirmation': b.verification,
    Resolved: b.resolved,
    Escalated: b.escalated,
  }));

  const mix = [
    { name: 'Not started', value: totals.notStarted },
    { name: 'In progress', value: totals.inProgress },
    { name: 'Awaiting confirmation', value: totals.verification },
    { name: 'Resolved', value: totals.resolved },
    { name: 'Escalated', value: totals.escalated },
  ];

  return (
    <div>
      <PageHeader
        title="Operations overview"
        description={
          dataUpdatedAt
            ? `Maintenance activity across all hostel blocks · updated ${new Date(dataUpdatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
            : 'Maintenance activity across all hostel blocks.'
        }
        actions={
          <ButtonLink to="/supervisor/all-complaints" variant="secondary" icon={Inbox}>
            All tickets
          </ButtonLink>
        }
      />

      <div className="space-y-6">
        {totals.escalated > 0 && (
          <Alert
            tone="danger"
            title={`${totals.escalated} escalated ${totals.escalated === 1 ? 'ticket needs' : 'tickets need'} attention`}
            action={
              <ButtonLink to="/supervisor/escalated" size="sm" variant="danger">
                Review escalations
              </ButtonLink>
            }
          >
            Students reported that the work did not fix the problem. Re-inspect and reassign.
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <StatCard title="Total tickets" value={totals.total} icon={Layers} tone="neutral" loading={isLoading} subtitle={`${activeBlocks.length} ${activeBlocks.length === 1 ? 'block' : 'blocks'} with activity`} />
          <StatCard title="Not started" value={totals.notStarted} icon={Clock3} tone="neutral" loading={isLoading} subtitle={pct(totals.notStarted)} />
          <StatCard title="In progress" value={totals.inProgress} icon={Wrench} tone="brand" loading={isLoading} subtitle={pct(totals.inProgress)} />
          <StatCard title="Pending sign-off" value={totals.verification} icon={ClipboardCheck} tone="warning" loading={isLoading} subtitle={pct(totals.verification)} />
          <StatCard title="Resolved" value={totals.resolved} icon={CheckCircle2} tone="success" loading={isLoading} subtitle={pct(totals.resolved)} />
          <StatCard
            title="Escalated"
            value={totals.escalated}
            icon={AlertTriangle}
            tone="danger"
            highlight={totals.escalated > 0}
            loading={isLoading}
            subtitle={pct(totals.escalated)}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Tickets by block" description="Current status of every ticket, per hostel block." />
            <CardBody>
              {isLoading ? (
                <Skeleton className="h-72" />
              ) : chartData.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-[13px] text-slate-500">No tickets have been raised yet.</div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="block" stroke="#64748b" fontSize={12} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                      <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f1f5f9' }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                      {SERIES.map((s, i) => (
                        <Bar key={s.key} dataKey={s.key} stackId="status" fill={s.color} radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={56} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Status mix" description="All blocks combined." />
            <CardBody>
              {isLoading ? (
                <Skeleton className="h-72" />
              ) : totals.total === 0 ? (
                <div className="flex h-72 items-center justify-center text-[13px] text-slate-500">No data yet.</div>
              ) : (
                <div className="flex h-72 flex-col">
                  <div className="relative min-h-0 flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={mix} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={1.5} stroke="none">
                          {mix.map((m, i) => (
                            <Cell key={m.name} fill={SERIES[i].color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-2xl font-semibold text-slate-900 tabular">{totals.total}</span>
                      <span className="text-xs text-slate-500">tickets</span>
                    </div>
                  </div>
                  <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    {mix.map((m, i) => (
                      <li key={m.name} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-slate-600">
                          <span className="h-2 w-2 rounded-full" style={{ background: SERIES[i].color }} />
                          {m.name}
                        </span>
                        <span className="font-medium text-slate-900 tabular">{m.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Block performance"
            description="Workload, backlog and student satisfaction by block."
            actions={<Switch checked={showEmptyBlocks} onChange={setShowEmptyBlocks} label="Show blocks with no tickets" showLabel />}
          />
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Block</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Not started</Th>
                  <Th className="text-right">In progress</Th>
                  <Th className="text-right">Awaiting confirmation</Th>
                  <Th className="text-right">Resolved</Th>
                  <Th className="text-right">Escalated</Th>
                  <Th className="text-right">Common areas</Th>
                  <Th className="text-right">Avg. rating</Th>
                </tr>
              </THead>
              {isLoading ? (
                <TableSkeleton columns={9} rows={4} />
              ) : (
                <TBody>
                  {tableBlocks.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-[13px] text-slate-500">
                        No tickets have been raised in any block yet.
                      </td>
                    </tr>
                  )}
                  {tableBlocks.map((b) => (
                    <Tr key={b.id}>
                      <Td>
                        <p className="font-medium text-slate-900">{b.name}</p>
                        <p className="font-mono text-2xs text-slate-400">{b.id}</p>
                      </Td>
                      <Td className="text-right font-medium text-slate-900 tabular">{b.total}</Td>
                      <Td className="text-right tabular">{b.notStarted}</Td>
                      <Td className="text-right tabular">{b.inProgress}</Td>
                      <Td className="text-right tabular">{b.verification}</Td>
                      <Td className="text-right tabular">{b.resolved}</Td>
                      <Td className={cn('text-right tabular', b.escalated > 0 && 'font-semibold text-rose-600')}>{b.escalated}</Td>
                      <Td className="text-right tabular">{b.commonArea}</Td>
                      <Td className="text-right">
                        {b.rating > 0 ? (
                          <span className="inline-flex items-center gap-1 font-medium text-slate-900 tabular">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                            {b.rating.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              )}
            </Table>
          </TableWrap>
        </Card>
      </div>
    </div>
  );
};
