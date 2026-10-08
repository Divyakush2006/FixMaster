import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, GitMerge, Sparkles, UserCheck, Users } from 'lucide-react';
import { complaintsApi, dispatchApi, metaApi } from '../../api/endpoints';
import { apiErrorCode } from '../../api/client';
import { useToast } from '../../components/ui/Toast';
import { useConfirm } from '../../components/ui/ConfirmDialog';
import { Drawer } from '../../components/ui/Drawer';
import { DetailList } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { Field, Textarea } from '../../components/ui/Form';
import { Skeleton } from '../../components/ui/PageLoader';
import { cn } from '../../components/ui/cn';
import { StatusBadge, PriorityBadge, SpecializationBadge } from '../../components/common/Badges';
import { ActivityTimeline } from '../../components/common/ActivityTimeline';
import { Complaint, TimelineEvent } from '../../types';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { isNoteEntry, logDescription, noteTitle, reconstructTimeline } from '../../utils/timeline';
import { SCOPE_LABEL, SPECIALIZATION_LABEL, STATUS_LABEL, ticketLocation, ticketRef } from '../../utils/labels';

interface DispatchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  complaint: Complaint;
}

const CLOSURE_TEXT: Record<string, string> = {
  CONFIRMED: 'Confirmed by a resident.',
  AUTO_CONFIRMED: 'Closed automatically: nobody confirmed or rejected the work within 72 hours.',
  WITHDRAWN: 'Withdrawn by the people who reported it before anyone was assigned.',
  INVALID: 'Rejected as not valid work.',
  DUPLICATE: 'Merged into another ticket as a duplicate.',
};

/** A ticket's record plus dispatch controls, for supervisors and admins. */
export const DispatchDrawer: React.FC<DispatchDrawerProps> = ({ isOpen, onClose, complaint: listed }) => {
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();

  // Detail adds the reporters and closure details to the register row.
  const { data: detail } = useQuery({
    queryKey: ['complaint', listed.complaint_id],
    queryFn: () => complaintsApi.getById(listed.complaint_id),
    enabled: isOpen,
  });
  const complaint: Complaint = detail ? { ...listed, ...detail } : listed;

  const isCleaning = complaint.required_specialization === 'CLEANING';
  // The database (re)assigns tickets in these states (migrations 006, 008).
  // ASSIGNED / IN_PROGRESS means handing live work to another technician.
  const isReassign = complaint.status === 'ASSIGNED' || complaint.status === 'IN_PROGRESS';
  const canDispatch = complaint.status === 'OPEN' || complaint.status === 'ESCALATED' || isReassign;
  const isLive = canDispatch || complaint.status === 'PENDING_VERIFICATION';
  // Who this screen shows holding the ticket. Sent with every assignment so a
  // change made by someone else meanwhile is refused instead of overridden.
  const currentStaffId = isReassign ? (complaint.assigned_staff_id ?? null) : null;

  // Staff roster, pre-filtered to the trade this ticket needs. The backend
  // also rejects a specialization mismatch, so this is a convenience only.
  const { data: staffList = [], isLoading: isLoadingStaff } = useQuery({
    queryKey: ['staff-roster', complaint.required_specialization],
    queryFn: () => metaApi.getStaff(complaint.required_specialization),
    enabled: isOpen && canDispatch,
  });

  const { data: logs = [], isLoading: isLoadingLogs } = useQuery({
    queryKey: ['complaint-logs', complaint.complaint_id],
    queryFn: () => complaintsApi.getLogs(complaint.complaint_id),
    enabled: isOpen,
  });

  // Other live tickets at this room / area: candidates for a merge.
  const { data: related = [] } = useQuery({
    queryKey: ['complaint-related', complaint.complaint_id],
    queryFn: () => complaintsApi.related(complaint.complaint_id),
    enabled: isOpen && isLive,
  });

  const roster = useMemo(
    () => [...staffList].sort((a, b) => Number(b.is_available) - Number(a.is_available) || a.active_task_count - b.active_task_count),
    [staffList]
  );
  const selectedStaff = roster.find((s) => s.user_id === selectedStaffId);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['complaints'] });
    queryClient.invalidateQueries({ queryKey: ['analytics-kpi'] });
    queryClient.invalidateQueries({ queryKey: ['staff-roster'] });
    queryClient.invalidateQueries({ queryKey: ['complaint', complaint.complaint_id] });
    queryClient.invalidateQueries({ queryKey: ['complaint-logs', complaint.complaint_id] });
  };

  const manualAssignMutation = useMutation({
    mutationFn: (allowOffDuty: boolean) =>
      dispatchApi.assignTechnician(complaint.complaint_id, selectedStaffId, { expectedAssigneeId: currentStaffId, allowOffDuty }),
    onSuccess: (data) => {
      showToast(isReassign ? 'Ticket reassigned' : 'Technician assigned', 'success', data.message);
      refreshAll();
      onClose();
    },
    onError: async (err: Error) => {
      const code = apiErrorCode(err);
      if (code === 'STALE_ASSIGNMENT') {
        // Someone else dispatched it while this screen was open.
        showToast('Ticket changed meanwhile', 'info', err.message);
        refreshAll();
        onClose();
        return;
      }
      if (code === 'STAFF_OFF_DUTY') {
        if (await confirmOffDuty()) manualAssignMutation.mutate(true);
        return;
      }
      showToast('Assignment failed', 'error', err.message);
    },
  });

  const confirmOffDuty = () =>
    confirm({
      title: `${selectedStaff?.full_name ?? 'This technician'} is off duty`,
      message: 'They will see the job when they next sign in. Assign it anyway?',
      confirmLabel: 'Assign anyway',
    });

  const handleAssign = async () => {
    if (selectedStaff && !selectedStaff.is_available) {
      if (!(await confirmOffDuty())) return;
      manualAssignMutation.mutate(true);
      return;
    }
    manualAssignMutation.mutate(false);
  };

  // The backend reports `assigned` honestly: 200 with assigned=false means no
  // cleaner was free, which is not a failure.
  const autoDispatchMutation = useMutation({
    mutationFn: () => dispatchApi.autoDispatchCleaning(complaint.complaint_id),
    onSuccess: (data) => {
      showToast(data.assigned ? 'Auto-dispatched' : 'No housekeeping staff available', data.assigned ? 'success' : 'info', data.message);
      refreshAll();
      if (data.assigned) onClose();
    },
    onError: (err: Error) => showToast('Auto-dispatch failed', 'error', err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: () => complaintsApi.reject(complaint.complaint_id, reason.trim()),
    onSuccess: () => {
      showToast('Ticket rejected', 'success', 'The people who reported it can see your reason.');
      refreshAll();
      onClose();
    },
    onError: (err: Error) => showToast('Could not reject the ticket', 'error', err.message),
  });

  const mergeMutation = useMutation({
    mutationFn: (targetId: string) => complaintsApi.merge(complaint.complaint_id, targetId),
    onSuccess: (data) => {
      showToast('Duplicate merged', 'success', data.message);
      refreshAll();
      onClose();
    },
    onError: (err: Error) => showToast('Could not merge', 'error', err.message),
  });

  const handleMerge = async (target: Complaint) => {
    const ok = await confirm({
      title: `Merge into ${ticketRef(target.complaint_id)}?`,
      message: `This ticket closes as a duplicate of "${target.issue_name}". Everyone who reported it is moved to ${ticketRef(
        target.complaint_id
      )}${isReassign ? ', and its technician is released' : ''}.`,
      confirmLabel: 'Merge',
    });
    if (ok) mergeMutation.mutate(target.complaint_id);
  };

  const events: TimelineEvent[] =
    logs.length > 0
      ? logs.map((log, idx) => ({
          title: isNoteEntry(log)
            ? noteTitle(log.action_note)
            : log.previous_status
              ? `${STATUS_LABEL[log.previous_status]} → ${STATUS_LABEL[log.new_status]}`
              : `Raised as ${STATUS_LABEL[log.new_status]}`,
          description: logDescription(log),
          timestamp: formatDateTime(log.timestamp),
          status: idx === logs.length - 1 ? 'current' : 'completed',
        }))
      : reconstructTimeline(complaint);

  const trade = SPECIALIZATION_LABEL[complaint.required_specialization].toLowerCase();
  const tradeWithArticle = `${/^[aeiou]/.test(trade) ? 'an' : 'a'} ${trade}`;
  const reporterCount = complaint.reporter_count ?? 1;
  const reporterNames = complaint.reporters?.map((r) => r.name);
  const reasonValid = reason.trim().length >= 5;

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
      footer={
        canDispatch ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button icon={UserCheck} disabled={!selectedStaffId} loading={manualAssignMutation.isPending} onClick={handleAssign}>
              {complaint.status === 'OPEN' ? 'Assign technician' : 'Reassign technician'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-7">
        {complaint.status === 'ESCALATED' && (
          <Alert tone="danger" title="Escalated by a resident">
            A resident reported that the problem was not fixed. Assign a technician to re-inspect.
          </Alert>
        )}
        {complaint.closure_reason && (
          <Alert tone="info" title="Why this ticket closed">
            {CLOSURE_TEXT[complaint.closure_reason]}
            {complaint.closure_reason === 'INVALID' && complaint.closure_note ? ` Reason: ${complaint.closure_note}` : ''}
            {complaint.closure_reason === 'DUPLICATE' && complaint.merged_into_ref ? ` Now tracked as ${complaint.merged_into_ref}.` : ''}
          </Alert>
        )}

        <section>
          <h3 className="eyebrow mb-3">Details</h3>
          <DetailList
            items={[
              { label: 'Location', value: <span className="font-medium">{ticketLocation(complaint)}</span> },
              { label: 'Type', value: SCOPE_LABEL[complaint.ticket_scope] },
              { label: 'Raised by', value: complaint.student_name },
              ...(reporterCount > 1
                ? [
                    {
                      label: 'Reported by',
                      value: (
                        <span className="inline-flex items-start gap-1.5">
                          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
                          {reporterNames ? `${reporterNames.join(', ')} (${reporterCount})` : `${reporterCount} people`}
                        </span>
                      ),
                    },
                  ]
                : []),
              { label: 'Raised on', value: formatDateTime(complaint.created_at) },
              { label: 'Trade', value: <SpecializationBadge specialization={complaint.required_specialization} /> },
              { label: 'Preferred time', value: complaint.preferred_timeslot || 'Any time' },
              {
                label: 'Technician',
                value: complaint.assigned_staff_name && complaint.status !== 'OPEN' && complaint.status !== 'ESCALATED' ? complaint.assigned_staff_name : 'Unassigned',
              },
            ]}
          />
          {complaint.description && (
            <p className="mt-4 whitespace-pre-line rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-700">
              {complaint.description}
            </p>
          )}
        </section>

        <section>
          <h3 className="eyebrow mb-3">Dispatch</h3>
          {!canDispatch ? (
            <Alert tone="info">
              This ticket is <strong>{STATUS_LABEL[complaint.status].toLowerCase()}</strong>. Tickets can be assigned or reassigned until the technician marks the work complete.
            </Alert>
          ) : (
            <div className="space-y-4">
              {isReassign && (
                <Alert tone="info" title={`Currently with ${complaint.assigned_staff_name ?? 'a technician'}`}>
                  Choosing another technician moves the ticket to them and removes it from {complaint.assigned_staff_name ?? 'the current technician'}'s queue. Use this when the
                  current technician is unavailable.
                </Alert>
              )}
              {isCleaning && !isReassign && (
                <div className="flex flex-col gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-900">Auto-dispatch</p>
                    <p className="mt-0.5 text-xs text-slate-600">Assigns the least-loaded housekeeping staff member who is on duty.</p>
                  </div>
                  <Button variant="secondary" icon={Sparkles} loading={autoDispatchMutation.isPending} onClick={() => autoDispatchMutation.mutate()}>
                    Auto-dispatch
                  </Button>
                </div>
              )}

              <div>
                <p className="mb-2 text-[13px] font-medium text-slate-700">
                  {isCleaning && !isReassign ? 'Or choose' : 'Choose'} {tradeWithArticle} technician
                </p>
                {isLoadingStaff ? (
                  <div className="space-y-2">
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                  </div>
                ) : roster.length === 0 ? (
                  <Alert tone="warning">No {SPECIALIZATION_LABEL[complaint.required_specialization].toLowerCase()} technicians are registered.</Alert>
                ) : (
                  <div role="radiogroup" aria-label="Technician" className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                    {roster.map((staff) => {
                      const selected = selectedStaffId === staff.user_id;
                      const isCurrent = staff.user_id === currentStaffId;
                      return (
                        <button
                          key={staff.user_id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={isCurrent}
                          onClick={() => setSelectedStaffId(staff.user_id)}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55',
                            selected ? 'bg-brand-50' : 'hover:bg-slate-50'
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                              selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-white'
                            )}
                            aria-hidden
                          >
                            {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                          </span>
                          <Avatar name={staff.full_name} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-slate-900">{staff.full_name}</span>
                            <span className="block text-xs text-slate-500">
                              {staff.active_task_count} open {staff.active_task_count === 1 ? 'job' : 'jobs'}
                              {!staff.is_available && staff.active_task_count > 0 ? ' while off duty' : ''}
                            </span>
                          </span>
                          {isCurrent ? (
                            <Badge tone="brand">Current</Badge>
                          ) : staff.is_available ? (
                            <Badge tone="success" dot>
                              On duty
                            </Badge>
                          ) : (
                            <Badge tone={staff.active_task_count > 0 ? 'warning' : 'neutral'}>Off duty</Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedStaff && !selectedStaff.is_available && (
                  <p className="mt-2 text-xs text-amber-800">{selectedStaff.full_name} is off duty. You will be asked to confirm.</p>
                )}
              </div>
            </div>
          )}
        </section>

        {isLive && (related.length > 0 || canDispatch) && (
          <section>
            <h3 className="eyebrow mb-3">Ticket actions</h3>
            <div className="space-y-4">
              {related.length > 0 && (
                <div>
                  <p className="mb-2 text-[13px] font-medium text-slate-700">Other active tickets at this location</p>
                  <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                    {related.map((r) => (
                      <li key={r.complaint_id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-slate-900">{r.issue_name}</p>
                          <p className="text-xs text-slate-500">
                            <span className="font-mono">{ticketRef(r.complaint_id)}</span> · {STATUS_LABEL[r.status]} · raised {formatRelativeTime(r.created_at)}
                          </p>
                        </div>
                        <Button size="sm" variant="secondary" icon={GitMerge} loading={mergeMutation.isPending && mergeMutation.variables === r.complaint_id} onClick={() => handleMerge(r)}>
                          Merge into this
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-slate-500">Merge when this ticket describes the same problem under a different issue type.</p>
                </div>
              )}

              {canDispatch &&
                (rejecting ? (
                  <div className="space-y-3 rounded-lg border border-slate-200 p-4">
                    <Field label="Reason for rejecting" required hint="Shown to the people who reported it. At least 5 characters." aside={`${reason.trim().length}/300`}>
                      {(props) => <Textarea {...props} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not a hostel maintenance issue; please contact the IT help desk." />}
                    </Field>
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setRejecting(false)}>
                        Cancel
                      </Button>
                      <Button variant="danger" size="sm" icon={Ban} disabled={!reasonValid} loading={rejectMutation.isPending} onClick={() => rejectMutation.mutate()}>
                        Reject ticket
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3">
                    <p className="text-[13px] text-slate-600">Not valid work (spam, out of scope)? Close it with a reason.</p>
                    <Button size="sm" variant="secondary" icon={Ban} onClick={() => setRejecting(true)}>
                      Reject
                    </Button>
                  </div>
                ))}
            </div>
          </section>
        )}

        <section>
          <h3 className="eyebrow mb-3">Activity</h3>
          {isLoadingLogs ? <Skeleton className="h-20" /> : <ActivityTimeline events={events} />}
        </section>
      </div>
    </Drawer>
  );
};
