import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Undo2, Users } from 'lucide-react';
import { Drawer } from '../../components/ui/Drawer';
import { DetailList } from '../../components/ui/Card';
import { Alert, AlertTone } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/PageLoader';
import { StatusBadge, PriorityBadge, SpecializationBadge, SlaBadge } from '../../components/common/Badges';
import { ActivityTimeline } from '../../components/common/ActivityTimeline';
import { HandlingTrailPanel } from '../../components/common/HandlingTrail';
import { isNoteEntry, logDescription, noteTitle, reconstructTimeline } from '../../utils/timeline';
import { complaintsApi } from '../../api/endpoints';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../components/ui/Toast';
import { Complaint, ComplaintStatus, TimelineEvent } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { TicketPhoto } from './TicketPhoto';
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
  REJECTED: 'Closed without work',
  CANCELLED: 'Withdrawn',
};

/** Why a closed ticket was closed, in the student's words. */
function closureSummary(c: Complaint): { tone: AlertTone; title: string; body: string } | null {
  switch (c.closure_reason) {
    case 'AUTO_CONFIRMED':
      return {
        tone: 'info',
        title: 'Closed automatically',
        body: 'Nobody confirmed or rejected the work within 72 hours of it being marked done, so the ticket was closed. If the problem is back, raise a new ticket.',
      };
    case 'WITHDRAWN':
      return { tone: 'info', title: 'Withdrawn', body: c.closure_note || 'This request was withdrawn before a technician was assigned.' };
    case 'INVALID':
      return {
        tone: 'info',
        title: 'Closed without work',
        body: c.closure_note ? `Reason given by the supervisor: ${c.closure_note}` : 'A supervisor closed this ticket.',
      };
    case 'DUPLICATE':
      return {
        tone: 'info',
        title: 'Merged into another ticket',
        body: `This was a duplicate and is now tracked as ${c.merged_into_ref ?? 'another ticket'}. Everyone who reported it was moved over.`,
      };
    default:
      return null;
  }
}

/** Record view of one ticket with its activity history. */
export const ComplaintDetailModal: React.FC<ComplaintDetailModalProps> = ({ isOpen, onClose, complaint: listed, onOpenVerification }) => {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { showToast } = useToast();

  // The list row is enough to render at once; the detail adds reporters and
  // closure details and keeps the action flags fresh.
  const { data: detail } = useQuery({
    queryKey: ['complaint', listed.complaint_id],
    queryFn: () => complaintsApi.getById(listed.complaint_id),
    enabled: isOpen,
  });
  const complaint: Complaint = detail ? { ...listed, ...detail } : listed;

  const withdraw = useMutation({
    mutationFn: () => complaintsApi.withdraw(complaint.complaint_id),
    onSuccess: (res) => {
      showToast(res.cancelled ? 'Request withdrawn' : 'Removed from this ticket', 'success', res.message);
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      queryClient.invalidateQueries({ queryKey: ['complaint', complaint.complaint_id] });
      onClose();
    },
    onError: (err: Error) => showToast('Could not withdraw', 'error', err.message),
  });

  const handleWithdraw = async () => {
    const others = Math.max((complaint.reporter_count ?? 1) - 1, 0);
    const ok = await confirm({
      title: 'Withdraw this request?',
      message:
        others > 0
          ? `${others} other ${others === 1 ? 'person has' : 'people have'} reported the same issue, so the ticket stays open for them. You will no longer follow it.`
          : 'The ticket will be closed and nobody will be sent. You can raise it again later if you need to.',
      confirmLabel: 'Withdraw',
      tone: 'danger',
    });
    if (ok) withdraw.mutate();
  };

  const closure = closureSummary(complaint);
  const roomTicket = complaint.ticket_scope === 'ROOM';
  const reporterNames = complaint.reporters?.map((r) => (r.is_you ? `${r.name} (you)` : r.name));
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
              title: isNoteEntry(log) ? noteTitle(log.action_note) : STATUS_STEP[log.new_status] || STATUS_LABEL[log.new_status] || log.new_status,
              description: logDescription(log),
              timestamp: formatDateTime(log.timestamp),
              status: (idx === arr.length - 1 && !CLOSED_STATUSES.includes(complaint.status) ? 'current' : 'completed') as TimelineEvent['status'],
            })),
        ]
      : reconstructTimeline(complaint);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      eyebrow={
        <>
          <span className="font-mono text-xs font-medium text-slate-500">{ticketRef(complaint.complaint_id)}</span>
          <StatusBadge status={complaint.status} />
          <PriorityBadge priority={complaint.priority} />
          <SlaBadge complaint={complaint} />
        </>
      }
      title={complaint.issue_name}
      subtitle={complaint.category_name}
    >
      <div className="space-y-6">
        {complaint.status === 'PENDING_VERIFICATION' &&
          (complaint.can_verify ? (
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
              The technician has marked this work as done.{' '}
              {roomTicket ? 'Anyone living in the room can confirm it; the first answer counts.' : 'Anyone who reported it can confirm it.'}{' '}
              If nobody responds within 72 hours it closes automatically.
            </Alert>
          ) : (
            <Alert tone="info" title="Waiting for confirmation">
              {complaint.is_reporter && roomTicket && !complaint.is_room_resident
                ? 'You no longer live in this room, so one of its current residents will confirm the work.'
                : 'The technician has marked this work as done and is waiting for confirmation.'}
            </Alert>
          ))}

        {closure && (
          <Alert tone={closure.tone} title={closure.title}>
            {closure.body}
          </Alert>
        )}

        {complaint.can_withdraw && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-4 py-3">
            <p className="text-[13px] text-slate-600">No longer needed? You can withdraw it until a technician is assigned.</p>
            <Button size="sm" variant="secondary" icon={Undo2} onClick={handleWithdraw} loading={withdraw.isPending}>
              Withdraw
            </Button>
          </div>
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
              ...(reporterNames && reporterNames.length > 1
                ? [
                    {
                      label: 'Reported by',
                      value: (
                        <span className="inline-flex items-start gap-1.5">
                          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                          {reporterNames.join(', ')}
                        </span>
                      ),
                    },
                  ]
                : !reporterNames && (complaint.reporter_count ?? 1) > 1
                  ? [{ label: 'Reported by', value: `${complaint.reporter_count} people` }]
                  : []),
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

        <TicketPhoto complaint={complaint} />

        {complaint.ai_safety_advisory && !CLOSED_STATUSES.includes(complaint.status) && (
          <Alert tone="warning" title="Until it is fixed">
            {complaint.ai_safety_advisory}
          </Alert>
        )}

        <section>
          <h3 className="eyebrow mb-3">How your request was handled</h3>
          <HandlingTrailPanel complaintId={complaint.complaint_id} enabled={isOpen} />
        </section>

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
