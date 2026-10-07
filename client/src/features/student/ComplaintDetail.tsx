import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../../components/ui/Modal';
import { StatusBadge, PriorityBadge } from '../../components/common/Badges';
import { reconstructTimeline } from '../../utils/timeline';
import { complaintsApi } from '../../api/endpoints';
import { Complaint, ComplaintStatus, TimelineEvent } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import {
  Building2,
  Clock,
  User,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

interface ComplaintDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  complaint: Complaint;
  onOpenVerification?: () => void;
}

const STATUS_LABELS: Record<ComplaintStatus, string> = {
  OPEN: 'Complaint Registered',
  ASSIGNED: 'Dispatched to Technician',
  IN_PROGRESS: 'Work In Progress',
  PENDING_VERIFICATION: 'Work Marked Completed',
  COMPLETED: 'Closed & Verified',
  ESCALATED: 'Escalated by Student',
  REJECTED: 'Rejected',
};

const TERMINAL_STATUSES: ComplaintStatus[] = ['COMPLETED', 'REJECTED'];

export const ComplaintDetailModal: React.FC<ComplaintDetailModalProps> = ({
  isOpen,
  onClose,
  complaint,
  onOpenVerification,
}) => {
  // Real audit trail from complaint_logs. A brand-new OPEN ticket
  // legitimately has zero rows here (the DB trigger only fires on a status
  // CHANGE, not on creation), so the client-side reconstruction is kept as
  // the fallback rather than showing an empty timeline.
  const { data: logs = [], isLoading: isLoadingLogs } = useQuery({
    queryKey: ['complaint-logs', complaint.complaint_id],
    queryFn: () => complaintsApi.getLogs(complaint.complaint_id),
    enabled: isOpen,
  });

  const timelineEvents: TimelineEvent[] =
    logs.length > 0
      ? [
          {
            title: 'Complaint Registered',
            description: `Ticket raised by ${complaint.student_name} (${complaint.issue_name})`,
            timestamp: formatDateTime(complaint.created_at),
            status: 'completed',
          },
          ...logs.map((log, idx) => ({
            title: STATUS_LABELS[log.new_status] || log.new_status,
            description: log.action_note
              ? log.changed_by_name
                ? `${log.action_note} — ${log.changed_by_name}`
                : log.action_note
              : `Status changed to ${log.new_status}`,
            timestamp: formatDateTime(log.timestamp),
            status: (idx === logs.length - 1 && !TERMINAL_STATUSES.includes(complaint.status)
              ? 'current'
              : 'completed') as TimelineEvent['status'],
          })),
        ]
      : reconstructTimeline(complaint);

  const location = complaint.room_id || complaint.common_area_id || complaint.block_id;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Complaint Record Details"
      subtitle={`Ref ID: ${complaint.complaint_id}`}
      maxWidth="lg"
    >
      <div className="space-y-6 font-sans">
        {/* Verification Alert Banner if Pending Verification */}
        {complaint.status === 'PENDING_VERIFICATION' && (
          <div className="p-4 rounded-2xl bg-amber-950/40 border-2 border-amber-500/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5 animate-pulse" />
              <div>
                <h4 className="text-xs font-bold text-amber-300">Action Required: Sign-off Work</h4>
                <p className="text-[11px] text-amber-200/80">
                  Technician has marked work completed. Please verify to close ticket.
                </p>
              </div>
            </div>

            {onOpenVerification && (
              <button
                onClick={onOpenVerification}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5 shrink-0"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Confirm & Rate</span>
              </button>
            )}
          </div>
        )}

        {/* Title & Badges */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={complaint.status} size="lg" />
            <PriorityBadge priority={complaint.priority} size="lg" />
          </div>
          <h2 className="text-lg font-extrabold text-slate-100">{complaint.issue_name}</h2>
          <p className="text-xs text-slate-400">Category: {complaint.category_name}</p>
        </div>

        {/* Key Info Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs">
          <div>
            <span className="text-slate-400 flex items-center gap-1 mb-0.5">
              <Building2 className="w-3.5 h-3.5 text-cyan-400" /> Location
            </span>
            <span className="font-bold text-slate-100">{location}</span>
          </div>

          <div>
            <span className="text-slate-400 flex items-center gap-1 mb-0.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" /> Preferred Timeslot
            </span>
            <span className="font-bold text-slate-100">{complaint.preferred_timeslot || 'N/A'}</span>
          </div>

          <div>
            <span className="text-slate-400 flex items-center gap-1 mb-0.5">
              <User className="w-3.5 h-3.5 text-cyan-400" /> Raised By
            </span>
            <span className="font-bold text-slate-100">{complaint.student_name}</span>
          </div>

          <div>
            <span className="text-slate-400 flex items-center gap-1 mb-0.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" /> Registered At
            </span>
            <span className="font-bold text-slate-100">{formatDateTime(complaint.created_at)}</span>
          </div>
        </div>

        {/* Description */}
        {complaint.description && (
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-slate-300">Description</h4>
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 leading-relaxed">
              {complaint.description}
            </div>
          </div>
        )}

        {/* Photo Evidence - only http(s) links are ever rendered as links.
            The API rejects anything else now, but records stored before that
            validation existed may still hold e.g. a javascript: URL. */}
        {complaint.photo_evidence_url && /^https?:\/\//i.test(complaint.photo_evidence_url) && (
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-slate-300">Photo Evidence</h4>
            <a
              href={complaint.photo_evidence_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 underline font-semibold"
            >
              <span>View attached photo evidence</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        {/* Audit Trail Timeline */}
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-extrabold text-slate-300 uppercase tracking-wider">
            Ticket Audit Trail
          </h4>

          {isLoadingLogs && (
            <div className="h-16 bg-slate-900/60 rounded-xl animate-pulse" />
          )}

          <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
            {timelineEvents.map((event, idx) => (
              <div key={idx} className="relative flex items-start justify-between gap-3">
                <div
                  className={`absolute -left-6 top-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    event.status === 'completed'
                      ? 'bg-cyan-500 border-cyan-400 text-slate-950'
                      : event.status === 'current'
                      ? 'bg-amber-500 border-amber-400 text-slate-950 animate-pulse'
                      : 'bg-slate-900 border-slate-700'
                  }`}
                >
                  {event.status === 'completed' && <CheckCircle2 className="w-3 h-3 stroke-[3]" />}
                </div>

                <div>
                  <h5 className="text-xs font-bold text-slate-200">{event.title}</h5>
                  <p className="text-[11px] text-slate-400 mt-0.5">{event.description}</p>
                </div>

                <span className="text-[10px] font-mono text-slate-500 shrink-0">
                  {event.timestamp}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};
