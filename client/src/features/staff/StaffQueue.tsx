import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, ClipboardList, Layers, Phone, PlayCircle, RefreshCw, User, Wrench } from 'lucide-react';
import { dispatchApi, meApi } from '../../api/endpoints';
import { apiErrorCode } from '../../api/client';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Switch } from '../../components/ui/Switch';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/PageLoader';
import { cn } from '../../components/ui/cn';
import { PriorityBadge, SpecializationBadge } from '../../components/common/Badges';
import { MarkDoneSheet } from './MarkDoneSheet';
import { StaffTask } from '../../types';
import { formatDateTime, formatRelativeTime, floorLabel } from '../../utils/formatters';
import { ticketRef } from '../../utils/labels';

export const StaffQueue: React.FC = () => {
  const [selectedTask, setSelectedTask] = useState<StaffTask | null>(null);
  // Set when going off duty would leave open jobs: the technician chooses.
  const [offDutyJobs, setOffDutyJobs] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: queue = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['staff-queue'],
    queryFn: dispatchApi.getQueue,
  });

  // On/off duty. Auto-dispatch only sends new work to staff who are on duty.
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: meApi.getMe });
  const isOnDuty = me?.is_available !== false;
  const dutyMutation = useMutation({
    mutationFn: ({ next, releaseOpenJobs }: { next: boolean; releaseOpenJobs?: boolean }) => meApi.setAvailability(next, releaseOpenJobs),
    onSuccess: (res) => {
      setOffDutyJobs(null);
      queryClient.setQueryData(['me'], (old: typeof me) => (old ? { ...old, is_available: res.is_available } : old));
      queryClient.invalidateQueries({ queryKey: ['staff-queue'] });
      showToast(
        res.is_available ? 'You are on duty' : 'You are off duty',
        'info',
        res.is_available
          ? 'New tickets can be dispatched to you automatically.'
          : res.released_jobs > 0
            ? `${res.released_jobs} open ${res.released_jobs === 1 ? 'job was' : 'jobs were'} handed back to your supervisor.`
            : res.open_jobs > 0
              ? `You kept ${res.open_jobs} open ${res.open_jobs === 1 ? 'job' : 'jobs'}. You will not receive new automatically dispatched tickets.`
              : 'You will not receive automatically dispatched tickets.'
      );
    },
    onError: (err: Error) => {
      if (apiErrorCode(err) === 'OPEN_JOBS') {
        const details = (err as Error & { details?: { open_jobs?: number } }).details;
        setOffDutyJobs(details?.open_jobs ?? queue.length);
        return;
      }
      showToast('Could not update duty status', 'error', err.message);
    },
  });

  const startWorkMutation = useMutation({
    mutationFn: (assignmentId: string) => dispatchApi.startWork(assignmentId),
    onSuccess: () => {
      showToast('Work started', 'success', 'The student can now see the ticket is in progress.');
      queryClient.invalidateQueries({ queryKey: ['staff-queue'] });
    },
    onError: (err: Error) => {
      showToast('Could not start the task', 'error', err.message);
      // TASK_REASSIGNED: a supervisor moved the job; drop it from the queue.
      if (apiErrorCode(err) === 'TASK_REASSIGNED') queryClient.invalidateQueries({ queryKey: ['staff-queue'] });
    },
  });

  // Group by floor while keeping the server's walking order.
  const floorGroups = useMemo(() => {
    const groups: { floor: number; tasks: StaffTask[] }[] = [];
    queue.forEach((task) => {
      const floor = task.floor_number ?? 0;
      let group = groups.find((g) => g.floor === floor);
      if (!group) {
        group = { floor, tasks: [] };
        groups.push(group);
      }
      group.tasks.push(task);
    });
    return groups;
  }, [queue]);

  const emergencyCount = queue.filter((t) => t.priority === 'EMERGENCY').length;
  const highCount = queue.filter((t) => t.priority === 'HIGH').length;
  const inProgressCount = queue.filter((t) => t.assignment_state === 'IN_PROGRESS').length;

  return (
    <div>
      <PageHeader
        title="My work queue"
        description="Ordered floor by floor, so each floor can be covered in a single visit."
        actions={
          <>
            <div className="flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 shadow-xs">
              <Switch checked={isOnDuty} onChange={(next) => dutyMutation.mutate({ next })} label={isOnDuty ? 'On duty' : 'Off duty'} showLabel disabled={!me || dutyMutation.isPending} />
            </div>
            <Button variant="secondary" icon={RefreshCw} onClick={() => refetch()} loading={isFetching && !isLoading}>
              Refresh
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Assigned to me" value={queue.length} icon={ClipboardList} tone="brand" loading={isLoading} />
        <StatCard title="In progress" value={inProgressCount} icon={Wrench} tone="info" loading={isLoading} />
        <StatCard title="Emergency" value={emergencyCount} icon={AlertOctagon} tone="danger" highlight={emergencyCount > 0} loading={isLoading} />
        <StatCard title="High priority" value={highCount} icon={Layers} tone="warning" loading={isLoading} />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : queue.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Your queue is clear"
          description="No tasks are assigned to you right now. New assignments appear here as soon as a supervisor dispatches them."
        />
      ) : (
        <div className="space-y-6">
          {floorGroups.map((group) => (
            <Card key={group.floor} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5 py-2.5">
                <h2 className="text-[13px] font-semibold text-slate-900">{floorLabel(group.floor)}</h2>
                <span className="text-xs text-slate-500">
                  {group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'}
                </span>
              </div>
              <ul className="divide-y divide-slate-100">
                {group.tasks.map((task) => {
                  const isEmergency = task.priority === 'EMERGENCY';
                  const inProgress = task.assignment_state === 'IN_PROGRESS';
                  const starting = startWorkMutation.isPending && startWorkMutation.variables === task.assignment_id;
                  return (
                    <li key={task.assignment_id} className={cn('relative px-5 py-4', isEmergency && 'bg-rose-50/40')}>
                      {isEmergency && <span className="absolute inset-y-0 left-0 w-1 bg-rose-600" aria-hidden />}
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 gap-4">
                          <div className="w-20 shrink-0">
                            <p className="eyebrow">Location</p>
                            <p className="mt-0.5 font-mono text-lg font-semibold leading-6 text-slate-900">{task.location_identifier}</p>
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <p className="font-medium text-slate-900">{task.issue_name}</p>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                              <PriorityBadge priority={task.priority} />
                              <SpecializationBadge specialization={task.specialization} />
                              {inProgress && (
                                <Badge tone="brand" dot>
                                  In progress
                                </Badge>
                              )}
                            </div>
                            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                              <span className="font-mono">{ticketRef(task.complaint_id)}</span>
                              <span title={formatDateTime(task.assigned_at)}>Assigned {formatRelativeTime(task.assigned_at)}</span>
                              <span className="inline-flex items-center gap-1">
                                <User className="h-3 w-3" aria-hidden />
                                {task.student_name}
                              </span>
                              {task.student_phone && (
                                <a href={`tel:${task.student_phone}`} className="link inline-flex items-center gap-1">
                                  <Phone className="h-3 w-3" aria-hidden />
                                  {task.student_phone}
                                </a>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                          {!inProgress && (
                            <Button
                              variant="secondary"
                              icon={PlayCircle}
                              loading={starting}
                              disabled={startWorkMutation.isPending}
                              onClick={() => startWorkMutation.mutate(task.assignment_id)}
                              className="h-10 sm:h-9"
                            >
                              Start work
                            </Button>
                          )}
                          <Button
                            variant="success"
                            icon={CheckCircle2}
                            onClick={() => setSelectedTask(task)}
                            className={cn('h-10 sm:h-9', inProgress && 'col-span-2')}
                          >
                            Mark complete
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {selectedTask && <MarkDoneSheet isOpen onClose={() => setSelectedTask(null)} task={selectedTask} />}

      <Modal
        isOpen={offDutyJobs !== null}
        onClose={() => setOffDutyJobs(null)}
        title="You still have open jobs"
        subtitle={`${offDutyJobs ?? 0} ${offDutyJobs === 1 ? 'job is' : 'jobs are'} in your queue.`}
        maxWidth="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOffDutyJobs(null)}>
              Stay on duty
            </Button>
            <Button variant="secondary" loading={dutyMutation.isPending && dutyMutation.variables?.releaseOpenJobs === false} onClick={() => dutyMutation.mutate({ next: false, releaseOpenJobs: false })}>
              Keep them
            </Button>
            <Button loading={dutyMutation.isPending && dutyMutation.variables?.releaseOpenJobs === true} onClick={() => dutyMutation.mutate({ next: false, releaseOpenJobs: true })}>
              Hand back
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">
          <strong className="font-medium text-slate-800">Keep them</strong> if you will finish them on your next shift; your supervisor will see that you are off duty
          with open jobs. <strong className="font-medium text-slate-800">Hand back</strong> returns them to your supervisor so someone on duty can be assigned now.
        </p>
      </Modal>
    </div>
  );
};
