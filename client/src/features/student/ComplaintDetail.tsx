import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer';
import { DetailList } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/PageLoader';
import { StatusBadge, PriorityBadge, SpecializationBadge } from '../../components/common/Badges';
import { ActivityTimeline } from '../../components/common/ActivityTimeline';
import { logDescription, reconstructTimeline } from '../../utils/timeline';
import { complaintsApi } from '../../api/endpoints';
import { Complaint, ComplaintStatus, TimelineEvent } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { CLOSED_STATUSES, SCOPE_LABEL, STATUS_LABEL, ticketLocation, ticketRef } from '../../utils/labels';

interface ComplaintDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  complaint: Complaint;
  onOpenVerification?: () => void;
}

const STATUS_STEP: Record<ComplaintStatus, string> = {
  OPEN: 'Ticket registered',
  ASSIGNED: 'Technician assigned',
  IN_PROGRESS: 'Work started',
  PENDING_VERIFICATION: 'Work marked complete',
  COMPLETED: 'Closed and verified',
  ESCALATED: 'Escalated to supervisor',
  REJECTED: 'Rejected',
};

/** Read-only record view of one ticket with its activity history. */
export const ComplaintDetailModal: React.FC<ComplaintDetailModalProps> = ({ isOpen, onClose, complaint, onOpenVerification }) => {
  // Real audit trail from complaint_logs. Records inserted directly into the
  // database (demo data) may have none, so the reconstruction is the fallback.
  const { data: logs = [], isLoading: isLoadingLogs } = useQuery({
    queryKey: ['complaint-logs', complaint.complaint_id],
    queryFn: () => complaintsApi.getLogs(complaint.complaint_id),
    enabled: isOpen,
  });

  const events: TimelineEvent[] =
    logs.length > 0
      ? [
          {
            title: 'Ticket raised',
            description: `Raised by ${complaint.student_name}`,
            timestamp: formatDateTime(complaint.created_at),
            status: 'completed',
          },
          // The creation entry (no previous status) duplicates the line above.
          ...logs
            .filter((log) => log.previous_status !== null || log.new_status !== 'OPEN')
            .map((log, idx, arr) => ({
              title: STATUS_STEP[log.new_status] || STATUS_LABEL[log.new_status] || log.new_status,
              description: logDescription(log),
              timestamp: formatDateTime(log.timestamp),
              status: (idx === arr.length - 1 && !CLOSED_STATUSES.includes(complaint.status) ? 'current' : 'completed') as TimelineEvent['status'],
            })),
        ]
      : reconstructTimeline(complaint);

  const safePhoto = complaint.photo_evidence_url && /^https?:\/\//i.test(complaint.photo_evidence_url) ? complaint.photo_evidence_url : null;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      eyebrow={
        <>
          <span className="font-mono text-xs font-medium text-slate-500">{ticketRef(complaint.complaint_id)}</span>
          <StatusBadge status={complaint.status} />
          <PriorityBadge priority={complaint.priority} />
        </>
      }
      title={complaint.issue_name}
      subtitle={complaint.category_name}
    >
      <div className="space-y-6">
        {complaint.status === 'PENDING_VERIFICATION' && (
          <Alert
            tone="warning"
            title="Your confirmation is needed"
            action={
              onOpenVerification && (
                <Button size="sm" icon={ShieldCheck} onClick={onOpenVerification}>
                  Confirm
                </Button>
              )
            }
          >
            The technician has marked this work as done.
          </Alert>
        )}

        <section>
          <h3 className="eyebrow mb-3">Details</h3>
          <DetailList
            items={[
              { label: 'Location', value: ticketLocation(complaint) },
              { label: 'Type', value: SCOPE_LABEL[complaint.ticket_scope] },
              { label: 'Trade', value: <SpecializationBadge specialization={complaint.required_specialization} /> },
              { label: 'Preferred time', value: complaint.preferred_timeslot || 'Any time' },
              ...(complaint.assigned_staff_name && complaint.status !== 'OPEN' && complaint.status !== 'ESCALATED'
                ? [{ label: 'Technician', value: complaint.assigned_staff_name }]
                : []),
              { label: 'Raised by', value: complaint.student_name },
              { label: 'Raised on', value: formatDateTime(complaint.created_at) },
              ...(complaint.resolved_at ? [{ label: 'Work completed', value: formatDateTime(complaint.resolved_at) }] : []),
              ...(complaint.closed_at ? [{ label: 'Closed on', value: formatDateTime(complaint.closed_at) }] : []),
            ]}
          />
        </section>

        {complaint.description && (
          <section>
            <h3 className="eyebrow mb-2">Description</h3>
            <p className="whitespace-pre-line rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-700">
              {complaint.description}
            </p>
          </section>
        )}

        {/* Only http(s) links are ever rendered: older records may hold other schemes. */}
        {safePhoto && (
          <section>
            <h3 className="eyebrow mb-2">Attachment</h3>
            <a href={safePhoto} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1.5 text-[13px]">
              View photo
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </section>
        )}

        <section>
          <h3 className="eyebrow mb-3">Activity</h3>
          {isLoadingLogs ? (
            <div className="space-y-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : (
            <ActivityTimeline events={events} />
          )}
        </section>
      </div>
    </Drawer>
  );
};
