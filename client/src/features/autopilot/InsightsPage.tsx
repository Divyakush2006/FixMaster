import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Inbox, RefreshCw, Send, Siren, Sparkles } from 'lucide-react';
import { insightsApi } from '../../api/endpoints';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { Input } from '../../components/ui/Form';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/PageLoader';
import { Table, TableWrap, THead, Th, TBody, Tr, Td } from '../../components/ui/Table';
import { PriorityBadge } from '../../components/common/Badges';
import type { AskResult } from '../../types';
import { SPECIALIZATION_LABEL, blockLabel } from '../../utils/labels';
import { formatRelativeTime } from '../../utils/formatters';

const SUGGESTIONS = ['Which tickets are about to miss their deadline?', 'Which rooms keep having the same problem?', 'Which tickets has nobody taken yet?', 'What is being reported most this week?'];

/**
 * The morning page: a written briefing, the figures behind it, tickets close to
 * missing their deadline, and places that keep breaking. Everything is limited
 * to the blocks the signed-in manager runs. The briefing says whether a model
 * or fixed rules wrote it, and the questions box can only run the listed
 * reports.
 */
export const InsightsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const briefing = useQuery({ queryKey: ['insights-briefing'], queryFn: insightsApi.briefing });
  const overview = useQuery({ queryKey: ['insights-overview'], queryFn: () => insightsApi.overview() });
  const risk = useQuery({ queryKey: ['insights-risk'], queryFn: insightsApi.breachRisk });
  const recurring = useQuery({ queryKey: ['insights-recurring'], queryFn: insightsApi.recurring });
  const refresh = useMutation({
    mutationFn: insightsApi.refreshBriefing,
    onSuccess: (b) => queryClient.setQueryData(['insights-briefing'], b),
  });
  const t = overview.data?.totals;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader breadcrumbs={[{ label: 'Operations' }, { label: 'Insights' }]} title="Today's briefing" description="What needs attention first, in the blocks you run." />

      <Card className="mb-6">
        <CardHeader
          icon={<Sparkles className="mt-0.5 h-5 w-5 text-brand-700" aria-hidden />}
          title="Briefing"
          description={
            briefing.data
              ? `${briefing.data.source === 'AI' ? 'Written by an AI model from the figures below' : 'Standard summary of the figures below'} · ${formatRelativeTime(briefing.data.generated_at)}`
              : undefined
          }
          actions={
            <Button variant="secondary" size="sm" icon={RefreshCw} loading={refresh.isPending} onClick={() => refresh.mutate()}>
              Refresh
            </Button>
          }
        />
        <CardBody>
          {briefing.isLoading ? (
            <Skeleton className="h-24" />
          ) : briefing.isError || !briefing.data ? (
            <Alert tone="danger">The briefing could not be loaded.</Alert>
          ) : (
            <div className="space-y-4">
              <p className="text-base font-semibold text-slate-900">{briefing.data.narrative.headline}</p>
              {briefing.data.narrative.highlights.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-700">
                  {briefing.data.narrative.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              )}
              {briefing.data.narrative.actions.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">To do today</h3>
                  <ol className="list-decimal space-y-1 pl-5 text-[13px] text-slate-800">
                    {briefing.data.narrative.actions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Open tickets" value={t?.open_tickets ?? '—'} icon={Inbox} tone="info" loading={overview.isLoading} subtitle={t ? `${t.raised_24h} raised in 24 hours` : undefined} />
        <StatCard title="Overdue" value={t?.overdue ?? '—'} icon={AlertTriangle} tone="danger" highlight={!!t && t.overdue > 0} loading={overview.isLoading} subtitle={t ? `${t.at_risk} close to the deadline` : undefined} />
        <StatCard title="Emergencies" value={t?.emergencies ?? '—'} icon={Siren} tone="danger" highlight={!!t && t.emergencies > 0} loading={overview.isLoading} />
        <StatCard title="Not yet assigned" value={t?.unassigned ?? '—'} icon={Clock} tone="warning" loading={overview.isLoading} />
      </div>

      <AskBox />

      <Watchlist />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Close to missing their deadline" description="Most urgent first." />
          {risk.isLoading ? (
            <CardBody>
              <Skeleton className="h-32" />
            </CardBody>
          ) : (risk.data ?? []).length === 0 ? (
            <EmptyState bare title="Nothing at risk" description="No open ticket is overdue or close to its deadline." />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <Th>Issue</Th>
                    <Th>Priority</Th>
                    <Th className="text-right">Time left</Th>
                  </tr>
                </THead>
                <TBody>
                  {(risk.data ?? []).map((r) => (
                    <Tr key={r.complaint_id}>
                      <Td>
                        <p className="font-medium text-slate-900">{r.issue_name}</p>
                        <p className="text-xs text-slate-500">
                          {blockLabel(r.block_id)} · {r.location ?? '—'} · {r.assigned_to ?? 'nobody assigned'}
                        </p>
                      </Td>
                      <Td>
                        <PriorityBadge priority={r.priority} />
                      </Td>
                      <Td className="whitespace-nowrap text-right tabular-nums">
                        {r.sla_status === 'OVERDUE' ? <Badge tone="danger">{Math.abs(r.hours_left)} h overdue</Badge> : <Badge tone="warning">{r.hours_left} h left</Badge>}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>

        <Card>
          <CardHeader title="Places that keep breaking" description="The same kind of fault three or more times in 30 days." />
          {recurring.isLoading ? (
            <CardBody>
              <Skeleton className="h-32" />
            </CardBody>
          ) : (recurring.data ?? []).length === 0 ? (
            <EmptyState bare title="No repeat faults" description="Nothing has failed three times in the last 30 days." />
          ) : (
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <Th>Place</Th>
                    <Th>Kind of fault</Th>
                    <Th className="text-right">Times</Th>
                  </tr>
                </THead>
                <TBody>
                  {(recurring.data ?? []).map((r) => (
                    <Tr key={`${r.block_id}-${r.location}-${r.category_name}`}>
                      <Td>
                        <p className="font-medium text-slate-900">{r.location ?? '—'}</p>
                        <p className="text-xs text-slate-500">{blockLabel(r.block_id)}</p>
                      </Td>
                      <Td>{r.category_name}</Td>
                      <Td className="text-right tabular-nums">{r.incidents}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>
    </div>
  );
};

const GAP_LABEL = { NO_COVER: 'Nobody on duty', POOL_ONLY: 'Campus pool only', STRETCHED: 'Stretched' } as const;

/** What the chief warden scans first: unusual weeks, short staffing, and how blocks compare. */
const Watchlist: React.FC = () => {
  const trend = useQuery({ queryKey: ['insights-trend'], queryFn: insightsApi.volumeTrend });
  const gaps = useQuery({ queryKey: ['insights-gaps'], queryFn: insightsApi.staffingGaps });
  const compare = useQuery({ queryKey: ['insights-compare'], queryFn: insightsApi.blockComparison });
  const busyBlocks = trend.data?.rows.blocks ?? [];
  const busyWeeks = (trend.data?.rows.weeks ?? []).filter((w) => w.unusual && w.z > 0);
  const short = gaps.data?.rows ?? [];
  const blocks = compare.data?.rows ?? [];

  return (
    <div className="mb-6 space-y-4">
      {busyBlocks.length > 0 && (
        <Alert tone="warning" title="Busier than usual">
          <ul className="list-disc pl-5">
            {busyBlocks.slice(0, 3).map((b) => (
              <li key={b.block_id}>
                {blockLabel(b.block_id)}: {b.last_7_days} tickets in the last 7 days, against about {b.usual_week} in a usual week.
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {busyWeeks.length > 0 && (
        <Alert tone="info" title="An unusually busy week">
          {busyWeeks.length === 1 ? 'One week' : `${busyWeeks.length} weeks`} in the last two months had far more tickets than the others (the busiest had {Math.max(...busyWeeks.map((w) => w.tickets))}).
        </Alert>
      )}
      {short.length > 0 && (
        <Card>
          <CardHeader title="Where staffing is short" description="Open tickets with too few technicians on duty for the trade." />
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Block</Th>
                  <Th>Trade</Th>
                  <Th className="text-right">Open</Th>
                  <Th className="text-right">On duty</Th>
                  <Th>Cover</Th>
                </tr>
              </THead>
              <TBody>
                {short.slice(0, 8).map((g) => (
                  <Tr key={`${g.block_id}-${g.trade}`}>
                    <Td>{blockLabel(g.block_id)}</Td>
                    <Td>{SPECIALIZATION_LABEL[g.trade]}</Td>
                    <Td className="text-right tabular-nums">{g.open_tickets}</Td>
                    <Td className="text-right tabular-nums">{g.on_duty}</Td>
                    <Td>
                      <Badge tone={g.status === 'NO_COVER' ? 'danger' : 'warning'}>{GAP_LABEL[g.status]}</Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}
      {blocks.length > 1 && (
        <Card>
          <CardHeader title="Blocks compared" description="Last 30 days, lowest share of deadlines met first." />
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Block</Th>
                  <Th className="text-right">Tickets</Th>
                  <Th className="text-right">Deadlines met</Th>
                  <Th className="text-right">Overdue now</Th>
                  <Th className="text-right">Avg. time</Th>
                  <Th className="text-right">Rating</Th>
                </tr>
              </THead>
              <TBody>
                {blocks.slice(0, 12).map((b) => (
                  <Tr key={b.block_id}>
                    <Td className="font-medium text-slate-900">{blockLabel(b.block_id)}</Td>
                    <Td className="text-right tabular-nums">{b.tickets}</Td>
                    <Td className="text-right tabular-nums">{b.compliance_pct === null ? '—' : `${b.compliance_pct}%`}</Td>
                    <Td className="text-right tabular-nums">{b.overdue_now}</Td>
                    <Td className="text-right tabular-nums">{b.avg_hours === null ? '—' : `${b.avg_hours} h`}</Td>
                    <Td className="text-right tabular-nums">{b.avg_rating === null ? '—' : b.avg_rating.toFixed(1)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
};

/** Plain-language questions, answered only from the listed reports. */
const AskBox: React.FC = () => {
  const [question, setQuestion] = useState('');
  const ask = useMutation({ mutationFn: (q: string) => insightsApi.ask(q) });
  const submit = (q: string) => q.trim().length >= 3 && ask.mutate(q.trim());
  const result: AskResult | undefined = ask.data;

  return (
    <Card className="mb-6">
      <CardHeader title="Ask FixMaster" description="Ask about open work, deadlines or repeat faults. Answers come from your own blocks' live figures." />
      <CardBody className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
        >
          <Input aria-label="Your question" value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder="Which tickets are about to miss their deadline?" />
          <Button type="submit" icon={Send} loading={ask.isPending} disabled={question.trim().length < 3}>
            Ask
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setQuestion(s);
                submit(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        {ask.isError && <Alert tone="danger">That did not work. Try again in a moment.</Alert>}
        {result && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3" role="status">
            <p className="text-[13px] text-slate-900">{result.answer}</p>
            {result.answered && result.title && (
              <p className="mt-1 text-xs text-slate-500">
                From the report “{result.title}” · {result.source === 'AI' ? 'question understood by an AI model' : 'question matched by keywords'}
              </p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
};
