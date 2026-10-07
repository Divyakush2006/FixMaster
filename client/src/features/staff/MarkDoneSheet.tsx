import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dispatchApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { CheckCircle2, Phone, MapPin } from 'lucide-react';
import { StaffTask } from '../../types';

interface MarkDoneSheetProps {
  isOpen: boolean;
  onClose: () => void;
  task: StaffTask;
}

export const MarkDoneSheet: React.FC<MarkDoneSheetProps> = ({ isOpen, onClose, task }) => {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const mutation = useMutation({
    mutationFn: () => dispatchApi.markTaskCompleted(task.assignment_id),
    onSuccess: (data) => {
      showToast(
        'Task Marked Done!',
        'success',
        data.message || 'Student has been notified for closed-loop verification.'
      );
      queryClient.invalidateQueries({ queryKey: ['staff-queue'] });
      onClose();
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to complete task', 'error');
    },
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Complete Service Task"
      subtitle="Mark work finished and notify student"
      maxWidth="sm"
    >
      <div className="space-y-5 font-sans">
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex items-center gap-1.5 text-cyan-400 font-extrabold text-sm">
            <MapPin className="w-4 h-4" />
            <span>{task.location_identifier}</span>
          </div>

          <h3 className="text-base font-bold text-slate-100">{task.issue_name}</h3>
          <p className="text-xs text-slate-400">Trade: {task.category_name}</p>

          <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-xs text-slate-300">
            <span>Student: {task.student_name}</span>
            {task.student_phone && (
              <a
                href={`tel:${task.student_phone}`}
                className="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Call</span>
              </a>
            )}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 text-cyan-200 text-xs leading-relaxed">
          <p className="font-semibold mb-0.5">Next Step in Closed-Loop Workflow:</p>
          Submitting moves ticket status to <strong>PENDING_VERIFICATION</strong>. The student will be prompted to inspect and rate your work before it officially closes.
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="w-full py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm shadow-xl shadow-emerald-600/25 flex items-center justify-center gap-2 active:scale-95 transition-all min-h-[48px]"
          >
            {mutation.isPending ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>CONFIRM WORK COMPLETED</span>
              </>
            )}
          </button>

          <button
            onClick={onClose}
            className="w-full py-3 rounded-2xl border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};
