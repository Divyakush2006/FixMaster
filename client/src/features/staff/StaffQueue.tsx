import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { dispatchApi, meApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { PriorityBadge } from '../../components/common/Badges';
import { EmptyState } from '../../components/ui/EmptyState';
import { MarkDoneSheet } from './MarkDoneSheet';
import { StaffTask } from '../../types';
import { formatRelativeTime, floorLabel } from '../../utils/formatters';
import {
  ListTodo,
  Phone,
  CheckCircle2,
  MapPin,
  User,
  Wrench,
  Navigation,
  Loader2,
  Power,
} from 'lucide-react';

export const StaffQueue: React.FC = () => {
  const [selectedTask, setSelectedTask] = useState<StaffTask | null>(null);
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: queue = [], isLoading, refetch } = useQuery({
    queryKey: ['staff-queue'],
    queryFn: dispatchApi.getQueue,
  });

  // On/off duty. Auto-dispatch only sends new work to staff who are on duty.
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: meApi.getMe });
  const isOnDuty = me?.is_available !== false;
  const dutyMutation = useMutation({
    mutationFn: (next: boolean) => meApi.setAvailability(next),
    onSuccess: (res) => {
      queryClient.setQueryData(['me'], (old: typeof me) => (old ? { ...old, is_available: res.is_available } : old));
      showToast(
        res.is_available ? 'You are on duty' : 'You are off duty',
        'info',
        res.is_available ? 'New tickets can be auto-dispatched to you.' : 'You will not receive auto-dispatched tickets.'
      );
    },
    onError: (err: any) => showToast(err.message || 'Could not update duty status', 'error'),
  });

  const startWorkMutation = useMutation({
    mutationFn: (assignmentId: string) => dispatchApi.startWork(assignmentId),
    onSuccess: () => {
      showToast('Work Started', 'success', 'Ticket moved to IN_PROGRESS.');
      queryClient.invalidateQueries({ queryKey: ['staff-queue'] });
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to start task', 'error');
    },
  });

  // Group tasks by floor while PRESERVING server ordering
  const floorGroups = useMemo(() => {
    const groups: { floor: number; tasks: StaffTask[] }[] = [];

    queue.forEach((task) => {
      const floor = task.floor_number ?? 0;
      let existingGroup = groups.find((g) => g.floor === floor);
      if (!existingGroup) {
        existingGroup = { floor, tasks: [] };
        groups.push(existingGroup);
      }
      existingGroup.tasks.push(task);
    });

    return groups;
  }, [queue]);

  const emergencyCount = queue.filter((t) => t.priority === 'EMERGENCY').length;
  const highCount = queue.filter((t) => t.priority === 'HIGH').length;

  return (
    <div className="space-y-6 font-sans max-w-2xl mx-auto">
      {/* Header Bar */}
      <div className="p-4 sm:p-5 rounded-3xl bg-slate-950 border border-slate-800 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-400">
            <ListTodo className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-slate-100">Walking Task Queue</h1>
            <p className="text-xs text-slate-400">Floor-ordered technician route</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => dutyMutation.mutate(!isOnDuty)}
            disabled={!me || dutyMutation.isPending}
            aria-pressed={isOnDuty}
            className={`px-3.5 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 min-h-[40px] ${
              isOnDuty
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{isOnDuty ? 'On duty' : 'Off duty'}</span>
          </button>
          <button
            onClick={() => refetch()}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors min-h-[40px]"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-center">
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
            Total Tasks
          </span>
          <span className="text-xl font-black text-slate-100">{queue.length}</span>
        </div>

        <div className="p-3 rounded-2xl bg-rose-950/30 border border-rose-900/50 text-center">
          <span className="text-[10px] uppercase font-bold text-rose-400 tracking-wider block">
            Emergency
          </span>
          <span className="text-xl font-black text-rose-300">{emergencyCount}</span>
        </div>

        <div className="p-3 rounded-2xl bg-amber-950/30 border border-amber-900/50 text-center">
          <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider block">
            High Priority
          </span>
          <span className="text-xl font-black text-amber-300">{highCount}</span>
        </div>
      </div>

      {/* Queue Tasks List Grouped by Floor */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 bg-slate-900/60 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : queue.length === 0 ? (
        <EmptyState
          title="No tasks assigned"
          description="Your walking task queue is currently empty. Check back when a supervisor assigns new tickets."
        />
      ) : (
        <div className="space-y-6">
          {floorGroups.map((group) => (
            <section key={group.floor} className="space-y-3">
              {/* Sticky Floor Header */}
              <div className="sticky top-16 z-30 py-2 px-3 rounded-xl bg-slate-950/90 border border-slate-800 backdrop-blur-md flex items-center justify-between shadow-md">
                <div className="flex items-center gap-2 text-cyan-400 font-black text-sm">
                  <Navigation className="w-4 h-4" />
                  <span>{floorLabel(group.floor)}</span>
                </div>
                <span className="text-xs text-slate-400 font-semibold">
                  {group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'}
                </span>
              </div>

              {/* Task Cards */}
              <div className="space-y-3">
                {group.tasks.map((task) => {
                  const isEmergency = task.priority === 'EMERGENCY';

                  return (
                    <div
                      key={task.assignment_id}
                      className={`p-4 sm:p-5 rounded-2xl bg-slate-900 border transition-all shadow-xl space-y-4 ${
                        isEmergency
                          ? 'border-2 border-red-500/80 bg-red-950/20 shadow-red-500/10'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {/* Top Header: Location + Badges */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">
                            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Location</span>
                          </div>
                          <div className="text-xl font-black text-slate-100 tracking-tight">
                            {task.location_identifier}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1">
                          <PriorityBadge priority={task.priority} size="md" />
                          <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                            Assigned {formatRelativeTime(task.assigned_at)}
                          </span>
                        </div>
                      </div>

                      {/* Issue Details */}
                      <div>
                        <h3 className="text-base font-bold text-slate-100">{task.issue_name}</h3>
                        <p className="text-xs text-slate-400">Trade: {task.category_name}</p>
                      </div>

                      {/* Student Info & Phone Call CTA */}
                      <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-slate-400" />
                          <span className="font-semibold text-slate-200">{task.student_name}</span>
                        </div>

                        {task.student_phone ? (
                          <a
                            href={`tel:${task.student_phone}`}
                            className="px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-400 border border-cyan-500/30 font-bold text-xs flex items-center gap-1.5 transition-colors min-h-[36px]"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>Call Student</span>
                          </a>
                        ) : (
                          <span className="text-[11px] text-slate-500">No phone provided</span>
                        )}
                      </div>

                      {/* Action Buttons (Large Tap Target >= 48px) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {task.assignment_state === 'IN_PROGRESS' ? (
                          <div className="py-3 px-4 rounded-xl bg-cyan-950/30 border border-cyan-500/30 text-cyan-400 text-xs font-semibold flex items-center justify-center gap-1.5">
                            <Wrench className="w-4 h-4" />
                            <span>Work In Progress</span>
                          </div>
                        ) : (
                          <button
                            onClick={() => startWorkMutation.mutate(task.assignment_id)}
                            disabled={startWorkMutation.isPending}
                            className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors min-h-[48px]"
                          >
                            {startWorkMutation.isPending && startWorkMutation.variables === task.assignment_id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Wrench className="w-4 h-4" />
                            )}
                            <span>Start Work</span>
                          </button>
                        )}

                        <button
                          onClick={() => setSelectedTask(task)}
                          className="py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 active:scale-95 transition-all min-h-[48px]"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>MARK WORK DONE</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Mark Done Sheet */}
      {selectedTask && (
        <MarkDoneSheet
          isOpen={true}
          onClose={() => setSelectedTask(null)}
          task={selectedTask}
        />
      )}
    </div>
  );
};
