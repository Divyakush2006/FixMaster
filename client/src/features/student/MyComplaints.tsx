import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { complaintsApi } from '../../api/endpoints';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Tabs } from '../../components/ui/Tabs';
import { SearchInput } from '../../components/ui/SearchInput';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { ButtonLink } from '../../components/ui/Button';
import { VerificationModal } from './VerificationModal';
import { ComplaintDetailModal } from './ComplaintDetail';
import { TicketsTable } from './TicketsTable';
import { Complaint, ComplaintStatus } from '../../types';
import { ticketLocation, ticketRef } from '../../utils/labels';

type Filter = 'ALL' | 'ACTION' | 'ACTIVE' | 'COMPLETED' | 'ESCALATED';

const FILTERS: { value: Filter; label: string; match: (s: ComplaintStatus) => boolean }[] = [
  { value: 'ALL', label: 'All', match: () => true },
  { value: 'ACTION', label: 'Needs confirmation', match: (s) => s === 'PENDING_VERIFICATION' },
  { value: 'ACTIVE', label: 'In progress', match: (s) => ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(s) },
  { value: 'ESCALATED', label: 'Escalated', match: (s) => s === 'ESCALATED' },
  { value: 'COMPLETED', label: 'Closed', match: (s) => s === 'COMPLETED' || s === 'REJECTED' },
];

const PAGE_SIZE = 10;

export const MyComplaints: React.FC = () => {
  const [searchParams] = useSearchParams();
  const selectedComplaintIdFromUrl = searchParams.get('id');

  const [filter, setFilter] = useState<Filter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [verifyingComplaint, setVerifyingComplaint] = useState<Complaint | null>(null);
  const [viewingComplaint, setViewingComplaint] = useState<Complaint | null>(null);

  const { data: complaints = [], isLoading } = useQuery({
    queryKey: ['complaints'],
    queryFn: () => complaintsApi.list(),
  });

  // Deep link: /student/complaints?id=<complaint id> opens that record.
  useEffect(() => {
    if (selectedComplaintIdFromUrl && complaints.length > 0) {
      const match = complaints.find((c) => c.complaint_id === selectedComplaintIdFromUrl);
      if (match) setViewingComplaint(match);
    }
  }, [selectedComplaintIdFromUrl, complaints]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.value, complaints.filter((c) => f.match(c.status)).length])) as Record<Filter, number>,
    [complaints]
  );

  const filteredComplaints = useMemo(() => {
    const rule = FILTERS.find((f) => f.value === filter)!;
    const q = searchQuery.trim().toLowerCase();
    return complaints.filter((c) => {
      if (!rule.match(c.status)) return false;
      if (!q) return true;
      return [c.issue_name, c.category_name, c.description || '', ticketLocation(c), ticketRef(c.complaint_id), c.complaint_id].some((v) =>
        v.toLowerCase().includes(q)
      );
    });
  }, [complaints, filter, searchQuery]);

  const totalPages = Math.ceil(filteredComplaints.length / PAGE_SIZE) || 1;
  const page = Math.min(currentPage, totalPages);
  const paginated = filteredComplaints.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtering = filter !== 'ALL' || searchQuery.trim() !== '';

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Service desk', to: '/student' }, { label: 'My tickets' }]}
        title="My tickets"
        description="Every maintenance request you have raised, with its current status."
        actions={
          <ButtonLink to="/student/new" icon={Plus}>
            Raise a ticket
          </ButtonLink>
        }
      />

      <Card>
        <div className="px-5 pt-3">
          <Tabs
            ariaLabel="Filter tickets"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setCurrentPage(1);
            }}
            items={FILTERS.map((f) => ({ value: f.value, label: f.label, count: isLoading ? undefined : counts[f.value] }))}
          />
        </div>
        <div className="border-b border-slate-200 px-5 py-3">
          <SearchInput
            className="sm:max-w-sm"
            value={searchQuery}
            onChange={(q) => {
              setSearchQuery(q);
              setCurrentPage(1);
            }}
            placeholder="Search by issue, location or ticket number"
            label="Search tickets"
          />
        </div>

        {!isLoading && paginated.length === 0 ? (
          <EmptyState
            bare
            title={filtering ? 'No matching tickets' : 'No tickets yet'}
            description={
              filtering ? 'Try a different search or filter.' : 'When you raise a maintenance request it will appear here with its status.'
            }
            action={
              filtering
                ? {
                    label: 'Clear filters',
                    onClick: () => {
                      setFilter('ALL');
                      setSearchQuery('');
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <TicketsTable complaints={paginated} loading={isLoading} onView={setViewingComplaint} onVerify={setVerifyingComplaint} />
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filteredComplaints.length} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>

      {viewingComplaint && (
        <ComplaintDetailModal
          isOpen
          onClose={() => setViewingComplaint(null)}
          complaint={viewingComplaint}
          onOpenVerification={() => {
            const comp = viewingComplaint;
            setViewingComplaint(null);
            setVerifyingComplaint(comp);
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
