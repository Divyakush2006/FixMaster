import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, UserCheck } from 'lucide-react';
import { complaintsApi, dispatchApi, metaApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Drawer } from '../../components/ui/Drawer';
import { DetailList } from '../../components/ui/Card';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { Skeleton } from '../../components/ui/PageLoader';
import { cn } from '../../components/ui/cn';
import { StatusBadge, PriorityBadge, SpecializationBadge } from '../../components/common/Badges';
import { ActivityTimeline } from '../../components/common/ActivityTimeline';
import { Complaint, TimelineEvent } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { reconstructTimeline } from '../../utils/timeline';
import { SCOPE_LABEL, SPECIALIZATION_LABEL, STATUS_LABEL, ticketLocation, ticketRef } from '../../utils/labels';

interface DispatchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  complaint: Complaint;
}

/** A ticket's record plus dispatch controls, for supervisors and admins. */
export const DispatchDrawer: React.FC<DispatchDrawerProps> = ({ isOpen, onClose, complaint }) => {
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const isCleaning = complaint.required_specialization === 'CLEANING';
  // The database only (re)assigns tickets in these states.
  const canDispatch = complaint.status === 'OPEN' || complaint.status === 'ESCALATED';

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

  const roster = useMemo(
    () => [...staffList].sort((a, b) => Number(b.is_available) - Number(a.is_available) || a.active_task_count - b.active_task_count),
    [staffList]
  );

  const afterDispatch = () => {
    queryClient.invalidateQueries({ queryKey: ['complaints'] });
    queryClient.invalidateQueries({ queryKey: ['analytics-kpi'] });
    queryClient.invalidateQueries({ queryKey: ['complaint-logs', complaint.complaint_id] });
  };

  const manualAssignMutation = useMutation({
    mutationFn: () => dispatchApi.assignTechnician(complaint.complaint_id, selectedStaffId),
    onSuccess: (data) => {
      showToast('Technician assigned', 'success', data.message);
      afterDispatch();
      onClose();
    },
    onError: (err: Error) => showToast('Assignment failed', 'error', err.message),
  });

  // The backend reports `assigned` honestly: 200 with assigned=false means no
  // cleaner was free, which is not a failure.
  const autoDispatchMutation = useMutation({
    mutationFn: () => dispatchApi.autoDispatchCleaning(complaint.complaint_id),
    onSuccess: (data) => {
      showToast(data.assigned ? 'Auto-dispatched' : 'No housekeeping staff available', data.assigned ? 'success' : 'info', data.message);
      afterDispatch();
      if (data.assigned) onClose();
    },
    onError: (err: Error) => showToast('Auto-dispatch failed', 'error', err.message),
  });

  const events: TimelineEvent[] =
    logs.length > 0
      ? logs.map((log, idx) => ({
          title: log.previous_status ? `${STATUS_LABEL[log.previous_status]} → ${STATUS_LABEL[log.new_status]}` : `Raised as ${STATUS_LABEL[log.new_status]}`,
          description: [log.action_note, log.changed_by_name].filter(Boolean).join(' · ') || '—',
          timestamp: formatDateTime(log.timestamp),
          status: idx === logs.length - 1 ? 'current' : 'completed',
        }))
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
            <Button icon={UserCheck} disabled={!selectedStaffId} loading={manualAssignMutation.isPending} onClick={() => manualAssignMutation.mutate()}>
              {complaint.status === 'ESCALATED' ? 'Reassign technician' : 'Assign technician'}
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
          <Alert tone="danger" title="Escalated by the student">
            The student reported that the problem was not fixed. Assign a technician to re-inspect.
          </Alert>
        )}

        <section>
          <h3 className="eyebrow mb-3">Details</h3>
          <DetailList
            items={[
              { label: 'Location', value: <span className="font-medium">{ticketLocation(complaint)}</span> },
              { label: 'Type', value: SCOPE_LABEL[complaint.ticket_scope] },
              { label: 'Raised by', value: complaint.student_name },
              { label: 'Raised on', value: formatDateTime(complaint.created_at) },
              { label: 'Trade', value: <SpecializationBadge specialization={complaint.required_specialization} /> },
              { label: 'Preferred time', value: complaint.preferred_timeslot || 'Any time' },
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
              This ticket is <strong>{STATUS_LABEL[complaint.status].toLowerCase()}</strong>. Tickets can only be assigned while they are open or escalated.
            </Alert>
          ) : (
            <div className="space-y-4">
              {isCleaning && (
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
                  {isCleaning ? 'Or choose' : 'Choose'} a {SPECIALIZATION_LABEL[complaint.required_specialization].toLowerCase()} technician
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
                      return (
                        <button
                          key={staff.user_id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={!staff.is_available}
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
                              {staff.active_task_count} active {staff.active_task_count === 1 ? 'task' : 'tasks'}
                            </span>
                          </span>
                          {staff.is_available ? (
                            <Badge tone="success" dot>
                              On duty
                            </Badge>
                          ) : (
                            <Badge tone="neutral">Off duty</Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section>
          <h3 className="eyebrow mb-3">Activity</h3>
          {isLoadingLogs ? <Skeleton className="h-20" /> : <ActivityTimeline events={events} />}
        </section>
      </div>
    </Drawer>
  );
};
