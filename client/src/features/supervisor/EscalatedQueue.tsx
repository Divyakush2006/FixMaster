import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, UserCheck } from 'lucide-react';
import { complaintsApi } from '../../api/endpoints';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/PageLoader';
import { PriorityBadge, SpecializationBadge } from '../../components/common/Badges';
import { DispatchDrawer } from './DispatchDrawer';
import { Complaint } from '../../types';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { PRIORITY_RANK, ticketLocation, ticketRef } from '../../utils/labels';

export const EscalatedQueue: React.FC = () => {
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);

  const { data: complaints = [], isLoading } = useQuery({
    queryKey: ['complaints', 'ESCALATED'],
    queryFn: () => complaintsApi.list({ status: 'ESCALATED' }),
  });

  // Most urgent first, then oldest first.
  const sorted = [...complaints].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'Escalations' }]}
        title="Escalations"
        meta={!isLoading && complaints.length > 0 ? <Badge tone="danger">{complaints.length} open</Badge> : undefined}
        description="Tickets where the student reported that the work did not fix the problem. Ordered by priority, then age."
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No escalations" description="Every completed ticket has been accepted by the student. Nothing needs re-inspection." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {sorted.map((c) => (
              <li key={c.complaint_id} className="relative flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                <span className="absolute inset-y-0 left-0 w-1 bg-rose-500" aria-hidden />
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="font-mono text-xs text-slate-500">{ticketRef(c.complaint_id)}</span>
                    <PriorityBadge priority={c.priority} />
                    <SpecializationBadge specialization={c.required_specialization} />
                  </div>
                  <p className="font-medium text-slate-900">{c.issue_name}</p>
                  <p className="text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{ticketLocation(c)}</span> · Raised by {c.student_name} ·{' '}
                    <span title={formatDateTime(c.created_at)}>{formatRelativeTime(c.created_at)}</span>
                  </p>
                  {c.description && <p className="line-clamp-2 max-w-3xl text-[13px] text-slate-600">{c.description}</p>}
                </div>
                <Button icon={UserCheck} onClick={() => setSelectedComplaint(c)} className="shrink-0 self-start lg:self-center">
                  Review and reassign
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {selectedComplaint && <DispatchDrawer key={selectedComplaint.complaint_id} isOpen onClose={() => setSelectedComplaint(null)} complaint={selectedComplaint} />}
    </div>
  );
};
