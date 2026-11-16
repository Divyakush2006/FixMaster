import React from 'react';
import { UserCheck, ShieldAlert, Clock } from 'lucide-react';
import { AiAllocationPreview } from '../../types';

interface Props {
  preview: AiAllocationPreview | null;
  loading?: boolean;
}

export const AllocationPreview: React.FC<Props> = ({ preview, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500">
        <Clock className="h-4 w-4 animate-spin text-indigo-500" />
        <span>Evaluating available duty staff and nearest technicians...</span>
      </div>
    );
  }

  if (!preview) return null;

  if (!preview.selected_staff_user_id) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900 shadow-sm">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div>
          <span className="font-semibold block text-amber-800">Manual Supervisor Dispatch Mode</span>
          <span className="text-amber-700 leading-relaxed mt-0.5 block">{preview.allocation_reasoning}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 text-xs shadow-sm">
      <div className="flex items-center gap-2 font-medium text-indigo-900">
        <UserCheck className="h-4 w-4 text-indigo-600" />
        <span>
          AI Dispatch Target: <strong>{preview.staff_name}</strong> ({preview.specialization})
        </span>
      </div>
      <p className="mt-1 text-slate-600">
        {preview.allocation_reasoning}
      </p>
    </div>
  );
};
