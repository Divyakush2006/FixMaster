import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { metaApi, complaintsApi } from '../../api/endpoints';
import { useMyAllotment } from '../../hooks/useMyAllotment';
import { useToast } from '../../components/ui/Toast';
import { StatusBadge, PriorityBadge } from '../../components/common/Badges';
import { VerificationModal } from './VerificationModal';
import { Complaint, Subcategory } from '../../types';
import { formatRelativeTime } from '../../utils/formatters';
import {
  Sparkles,
  Zap,
  Building2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  PlusCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const StudentHome: React.FC = () => {
  // Verification modal state
  const [verifyingComplaint, setVerifyingComplaint] = useState<Complaint | null>(null);

  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // The student's real room, from the server. Quick actions file against it;
  // without an allotment there is nothing to file against (and the API would
  // reject any room the student picked themselves).
  const { allotment, isLoading: isLoadingAllotment } = useMyAllotment();

  // Fetch categories with subcategories
  const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
    queryKey: ['meta-categories'],
    queryFn: async () => {
      const data = await metaApi.getCategories();
      // The server orders categories and never returns null subcategories;
      // sorting here too keeps the tile order stable regardless.
      return [...data].sort((a, b) => a.category_id - b.category_id);
    },
  });

  // Fetch student's own complaints
  const { data: complaints = [], isLoading: isLoadingComplaints } = useQuery({
    queryKey: ['complaints'],
    queryFn: () => complaintsApi.list(),
  });

  // Quick Action mutation
  const quickActionMutation = useMutation({
    mutationFn: complaintsApi.create,
    onSuccess: (res) => {
      showToast('1-Click Request Dispatched!', 'success', `Ticket Reference: ${res.complaint.complaint_id}`);
      // Optimistically update cache
      queryClient.setQueryData(['complaints'], (old: Complaint[] = []) => [res.complaint, ...old]);
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
    },
    onError: (err: any) => {
      showToast(err.message || 'Failed to dispatch quick action', 'error');
    },
  });

  const handleQuickActionClick = (sub: Subcategory) => {
    if (!allotment) {
      showToast('No room allotted yet', 'info', 'Ask the hostel office to allot your room, then try again.');
      return;
    }
    quickActionMutation.mutate({
      ticket_scope: 'ROOM',
      block_id: allotment.block_id,
      room_id: allotment.room_id,
      subcategory_id: sub.subcategory_id,
      priority: sub.priority_level,
      description: `1-Click Quick Action: ${sub.issue_name}`,
    });
  };

  // Quick action categories filter
  const quickActionCategories = categories.filter((c) => c.is_quick_action);

  // Active & Pending verification complaints
  const pendingVerificationTickets = complaints.filter(
    (c) => c.status === 'PENDING_VERIFICATION'
  );
  const activeTickets = complaints.filter(
    (c) => !['COMPLETED', 'REJECTED'].includes(c.status)
  );

  return (
    <div className="space-y-8 font-sans">
      {/* Header Banner */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-cyan-950/80 via-slate-900 to-blue-950/80 border border-slate-800 shadow-2xl relative overflow-hidden">
        <div className="absolute -right-6 -top-6 w-48 h-48 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold mb-2">
              <Zap className="w-3.5 h-3.5" />
              <span>1-CLICK SERVICE DISPATCH</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-100">
              Hostel Maintenance Portal
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-xl leading-relaxed">
              Tap any quick service tile below to request immediate room maintenance.
            </p>
          </div>

          {/* Room Allotment Pill */}
          <div className="bg-slate-950/80 border border-slate-800 p-3.5 rounded-2xl flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  Your Room Allotment
                </div>
                <div className="text-xs font-extrabold text-slate-100 flex items-center gap-1">
                  {isLoadingAllotment ? (
                    <span className="text-slate-500">Loading...</span>
                  ) : allotment ? (
                    <>
                      <span>{allotment.block_id}</span>
                      <span className="text-slate-500">•</span>
                      <span>{allotment.room_id}</span>
                    </>
                  ) : (
                    <span className="text-amber-400 font-semibold">Not allotted yet</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PINNED PENDING VERIFICATION TICKETS (CRITICAL CLOSED-LOOP STEP) */}
      {pendingVerificationTickets.length > 0 && (
        <section className="space-y-3 animate-fadeIn">
          <div className="flex items-center gap-2 text-amber-400 font-extrabold text-sm">
            <AlertCircle className="w-5 h-5 animate-pulse" />
            <span>ACTION REQUIRED — Confirm & Rate Completed Work</span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {pendingVerificationTickets.map((complaint) => (
              <div
                key={complaint.complaint_id}
                className="p-4 sm:p-5 rounded-2xl bg-amber-950/30 border-2 border-amber-500/50 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={complaint.status} />
                    <PriorityBadge priority={complaint.priority} />
                    <span className="text-[11px] text-slate-400 font-mono">
                      {complaint.created_at && formatRelativeTime(complaint.created_at)}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-slate-100">{complaint.issue_name}</h3>
                  <p className="text-xs text-slate-300">
                    Location:{' '}
                    <strong className="text-slate-100">
                      {complaint.room_id || complaint.common_area_id || complaint.block_id}
                    </strong>
                  </p>
                </div>

                <button
                  onClick={() => setVerifyingComplaint(complaint)}
                  className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>CONFIRM & RATE WORK</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {!isLoadingAllotment && !allotment && (
        <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <p className="font-bold text-amber-300">No room has been allotted to your account yet.</p>
            <p className="mt-0.5 text-amber-200/80">
              Room tickets and 1-click actions become available once the hostel office allots your room.
              You can still report problems in common areas from the full complaint form.
            </p>
          </div>
        </div>
      )}

      {/* QUICK ACTIONS TILES */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-extrabold text-slate-100">1-Click Quick Actions</h2>
          </div>
          <span className="text-xs text-slate-400">One tap files immediately</span>
        </div>

        {isLoadingCategories ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 rounded-2xl bg-slate-800/40 animate-pulse border border-slate-800"
              />
            ))}
          </div>
        ) : quickActionCategories.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 bg-slate-900 border border-slate-800 rounded-2xl">
            No quick action subcategories configured.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickActionCategories.flatMap((cat) =>
              cat.subcategories.map((sub) => (
                <button
                  key={sub.subcategory_id}
                  onClick={() => handleQuickActionClick(sub)}
                  disabled={quickActionMutation.isPending || !allotment}
                  className="group relative p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/80 transition-all text-left shadow-lg hover:shadow-cyan-500/10 flex flex-col justify-between overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-800"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-cyan-500/10 to-transparent rounded-bl-full pointer-events-none group-hover:scale-125 transition-transform" />

                  <div className="flex items-start justify-between gap-2 mb-4">
                    <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 group-hover:bg-cyan-500 group-hover:text-slate-950 transition-colors">
                      <Zap className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                      {sub.required_specialization}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-sm font-bold text-slate-100 group-hover:text-cyan-300 transition-colors">
                      {sub.issue_name}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                      <span>Category: {cat.category_name}</span>
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-cyan-400 font-semibold group-hover:translate-x-1 transition-transform">
                    <span>Tap to File Ticket</span>
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </section>

      {/* ACTIVE TICKETS STRIP */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-slate-100 flex items-center gap-2">
            <span>Active Tickets</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs">
              {activeTickets.length}
            </span>
          </h2>

          <div className="flex items-center gap-3">
            <Link
              to="/student/new"
              className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Full Complaint Form</span>
            </Link>
            <Link
              to="/student/complaints"
              className="text-xs font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {isLoadingComplaints ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-20 bg-slate-800/40 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activeTickets.length === 0 ? (
          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800 text-center text-xs text-slate-400">
            No active maintenance complaints. Use 1-Click Quick Actions above or file a new ticket.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {activeTickets.slice(0, 4).map((ticket) => (
              <div
                key={ticket.complaint_id}
                className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={ticket.status} size="sm" />
                    <PriorityBadge priority={ticket.priority} size="sm" />
                    <span className="text-[11px] text-slate-400 font-mono">
                      {formatRelativeTime(ticket.created_at)}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold text-slate-100">{ticket.issue_name}</h4>
                  <p className="text-xs text-slate-400">
                    Location: {ticket.room_id || ticket.common_area_id || ticket.block_id}
                  </p>
                </div>

                <Link
                  to={`/student/complaints?id=${ticket.complaint_id}`}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold text-center border border-slate-700"
                >
                  View Details
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Verification Modal */}
      {verifyingComplaint && (
        <VerificationModal
          isOpen={true}
          onClose={() => setVerifyingComplaint(null)}
          complaintId={verifyingComplaint.complaint_id}
          issueName={verifyingComplaint.issue_name}
          locationIdentifier={
            verifyingComplaint.room_id ||
            verifyingComplaint.common_area_id ||
            verifyingComplaint.block_id
          }
        />
      )}
    </div>
  );
};
