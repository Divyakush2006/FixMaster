import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BedDouble, CheckCircle2, ClipboardCheck, Clock3, Plus, ShieldCheck, Zap } from 'lucide-react';
import { metaApi, complaintsApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { useMyAllotment } from '../../hooks/useMyAllotment';
import { useToast } from '../../components/ui/Toast';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Alert } from '../../components/ui/Alert';
import { Button, ButtonLink } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/PageLoader';
import { Spinner } from '../../components/ui/Spinner';
import { SPECIALIZATION_ICON } from '../../components/common/Badges';
import { VerificationModal } from './VerificationModal';
import { ComplaintDetailModal } from './ComplaintDetail';
import { TicketsTable } from './TicketsTable';
import { Complaint, Subcategory } from '../../types';
import { floorLabel } from '../../utils/formatters';
import { blockLabel, greeting, isOpenStatus, PRIORITY_LABEL, ROOM_TYPE_LABEL, SPECIALIZATION_LABEL, ticketLocation, ticketRef } from '../../utils/labels';

export const StudentHome: React.FC = () => {
  const [verifyingComplaint, setVerifyingComplaint] = useState<Complaint | null>(null);
  const [viewingComplaint, setViewingComplaint] = useState<Complaint | null>(null);

  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // The student's real room, from the server. Quick actions file against it;
  // without an allotment there is nothing to file against (and the API would
  // reject any room the student picked themselves).
  const { allotment, isLoading: isLoadingAllotment } = useMyAllotment();

  const { data: categories = [], isLoading: isLoadingCategories } = useQuery({
    queryKey: ['meta-categories'],
    queryFn: async () => [...(await metaApi.getCategories())].sort((a, b) => a.category_id - b.category_id),
  });

  const { data: complaints = [], isLoading: isLoadingComplaints } = useQuery({
    queryKey: ['complaints'],
    queryFn: () => complaintsApi.list(),
  });

  const quickActionMutation = useMutation({
    mutationFn: complaintsApi.create,
    onSuccess: (res) => {
      showToast('Request submitted', 'success', `${res.complaint.issue_name} · ${ticketRef(res.complaint.complaint_id)}`);
      queryClient.setQueryData(['complaints'], (old: Complaint[] = []) => [res.complaint, ...old]);
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
    },
    onError: (err: Error) => showToast('Request not submitted', 'error', err.message),
  });

  const handleQuickAction = (sub: Subcategory) => {
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

  const quickServices = categories.filter((c) => c.is_quick_action).flatMap((c) => c.subcategories);
  const pendingVerification = complaints.filter((c) => c.status === 'PENDING_VERIFICATION');
  const activeTickets = complaints.filter((c) => isOpenStatus(c.status));
  const closedCount = complaints.filter((c) => c.status === 'COMPLETED').length;
  const firstName = user?.full_name.split(' ')[0] ?? '';

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description="Raise maintenance requests for your room and follow them through to completion."
        actions={
          <ButtonLink to="/student/new" icon={Plus}>
            Raise a ticket
          </ButtonLink>
        }
      />

      <div className="space-y-6">
        {pendingVerification.length > 0 && (
          <Card className="border-amber-200">
            <CardHeader
              className="border-amber-100 bg-amber-50/60"
              icon={
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-100 text-amber-700">
                  <ShieldCheck className="h-4 w-4" />
                </span>
              }
              title="Your confirmation is needed"
              description="The technician has marked this work as done. Check it and confirm, or report that the problem remains."
            />
            <ul className="divide-y divide-slate-100">
              {pendingVerification.map((c) => (
                <li key={c.complaint_id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{c.issue_name}</p>
                    <p className="text-xs text-slate-500">
                      <span className="font-mono">{ticketRef(c.complaint_id)}</span> · {ticketLocation(c)}
                    </p>
                  </div>
                  <Button size="sm" icon={ShieldCheck} onClick={() => setVerifyingComplaint(c)}>
                    Review and confirm
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!isLoadingAllotment && !allotment && (
          <Alert tone="warning" title="No room has been allotted to your account yet">
            Room requests become available once the hostel office allots your room. You can still report problems in common areas.
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              <StatCard title="Open" value={activeTickets.length} icon={Clock3} tone="brand" loading={isLoadingComplaints} />
              <StatCard
                title="To confirm"
                value={pendingVerification.length}
                icon={ClipboardCheck}
                tone="warning"
                loading={isLoadingComplaints}
              />
              <StatCard title="Closed" value={closedCount} icon={CheckCircle2} tone="success" loading={isLoadingComplaints} />
            </div>

            <Card>
              <CardHeader
                title="Quick requests"
                description={allotment ? `Submitted instantly for room ${allotment.room_id}.` : 'Available once a room is allotted to you.'}
                icon={
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-600">
                    <Zap className="h-4 w-4" />
                  </span>
                }
              />
              <CardBody>
                {isLoadingCategories ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-[92px]" />
                    ))}
                  </div>
                ) : quickServices.length === 0 ? (
                  <p className="text-[13px] text-slate-500">No quick requests are configured.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {quickServices.map((sub) => {
                      const Icon = SPECIALIZATION_ICON[sub.required_specialization] ?? Zap;
                      const pending = quickActionMutation.isPending && quickActionMutation.variables?.subcategory_id === sub.subcategory_id;
                      return (
                        <button
                          key={sub.subcategory_id}
                          type="button"
                          onClick={() => handleQuickAction(sub)}
                          disabled={quickActionMutation.isPending || !allotment}
                          className="group flex items-center gap-3 rounded-lg sm:flex-col sm:items-start border border-slate-200 bg-white p-4 text-left transition-all hover:border-brand-300 hover:shadow-card disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:shadow-none"
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600 transition-colors group-hover:bg-brand-50 group-hover:text-brand-600">
                            {pending ? <Spinner /> : <Icon className="h-[18px] w-[18px]" />}
                          </span>
                          <span>
                            <span className="block text-[13px] font-medium leading-snug text-slate-900">{sub.issue_name.replace(/^1-Click\s+/i, '')}</span>
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {SPECIALIZATION_LABEL[sub.required_specialization]} · {PRIORITY_LABEL[sub.priority_level]} priority
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader
                title="Your room"
                icon={
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                    <BedDouble className="h-4 w-4" />
                  </span>
                }
              />
              <CardBody>
                {isLoadingAllotment ? (
                  <div className="space-y-2">
                    <Skeleton className="h-7 w-24" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                ) : allotment ? (
                  <div>
                    <p className="font-mono text-2xl font-semibold tracking-tight text-slate-900">{allotment.room_id}</p>
                    <dl className="mt-4 space-y-2.5 text-[13px]">
                      {[
                        ['Block', blockLabel(allotment.block_id)],
                        ['Floor', floorLabel(allotment.floor_number)],
                        ['Room type', ROOM_TYPE_LABEL[allotment.room_type as keyof typeof ROOM_TYPE_LABEL] ?? allotment.room_type],
                        ['Academic year', allotment.academic_year],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-4">
                          <dt className="text-slate-500">{k}</dt>
                          <dd className="font-medium text-slate-900">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : (
                  <p className="text-[13px] text-slate-500">Not allotted yet. The hostel office will assign your room.</p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader
            title="Open tickets"
            description="Your requests that are still in progress."
            actions={
              <Link to="/student/complaints" className="link inline-flex items-center gap-1 text-[13px]">
                View all tickets
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          {!isLoadingComplaints && activeTickets.length === 0 ? (
            <EmptyState
              bare
              icon={CheckCircle2}
              title="Nothing open"
              description="You have no requests in progress. Use a quick request above or raise a ticket."
            />
          ) : (
            <TicketsTable
              complaints={activeTickets.slice(0, 5)}
              loading={isLoadingComplaints}
              onView={setViewingComplaint}
              onVerify={setVerifyingComplaint}
              skeletonRows={3}
            />
          )}
        </Card>
      </div>

      {viewingComplaint && (
        <ComplaintDetailModal
          isOpen
          onClose={() => setViewingComplaint(null)}
          complaint={viewingComplaint}
          onOpenVerification={() => {
            const c = viewingComplaint;
            setViewingComplaint(null);
            setVerifyingComplaint(c);
          }}
        />
      )}

      {verifyingComplaint && (
        <VerificationModal
          isOpen
          onClose={() => setVerifyingComplaint(null)}
          complaintId={verifyingComplaint.complaint_id}
          issueName={verifyingComplaint.issue_name}
          locationIdentifier={ticketLocation(verifyingComplaint)}
        />
      )}
    </div>
  );
};
