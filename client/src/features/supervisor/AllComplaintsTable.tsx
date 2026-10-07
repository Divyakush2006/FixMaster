import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { complaintsApi, metaApi } from '../../api/endpoints';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { SearchInput } from '../../components/ui/SearchInput';
import { Select } from '../../components/ui/Form';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { StatusBadge, PriorityBadge, SpecializationBadge } from '../../components/common/Badges';
import { DispatchDrawer } from './DispatchDrawer';
import { Complaint, ComplaintStatus } from '../../types';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { STATUS_LABEL, ticketLocation, ticketRef } from '../../utils/labels';

const STATUSES = Object.keys(STATUS_LABEL) as ComplaintStatus[];
const PAGE_SIZE = 15;

export const AllComplaintsTable: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);

  const { data: blocks = [] } = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });

  // Status and block are filtered by the server; search runs on the result.
  const { data: complaints = [], isLoading } = useQuery({
    queryKey: ['complaints', statusFilter, blockFilter],
    queryFn: () => complaintsApi.list({ status: statusFilter || undefined, block_id: blockFilter || undefined }),
  });

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return complaints;
    return complaints.filter((c) =>
      [c.issue_name, c.student_name, ticketLocation(c), c.complaint_id, ticketRef(c.complaint_id)].some((v) => v.toLowerCase().includes(q))
    );
  }, [complaints, searchQuery]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1;
  const page = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtering = !!(statusFilter || blockFilter || searchQuery.trim());

  // Keep the open record in sync with refreshed data after a dispatch.
  const liveSelected = selectedComplaint && (complaints.find((c) => c.complaint_id === selectedComplaint.complaint_id) ?? selectedComplaint);

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'All tickets' }]}
        title="All tickets"
        description="Inspect any ticket and dispatch it to a technician."
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-3.5 lg:flex-row lg:items-center">
          <SearchInput
            className="lg:max-w-sm"
            value={searchQuery}
            onChange={(q) => {
              setSearchQuery(q);
              setCurrentPage(1);
            }}
            placeholder="Search issue, student, location or ticket"
            label="Search tickets"
          />
          <div className="grid grid-cols-2 gap-3 lg:flex">
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="lg:w-52"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by block"
              value={blockFilter}
              onChange={(e) => {
                setBlockFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="lg:w-56"
            >
              <option value="">All blocks</option>
              {blocks.map((b) => (
                <option key={b.block_id} value={b.block_id}>
                  {b.block_name}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-[13px] text-slate-500 lg:ml-auto">
            {isLoading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'ticket' : 'tickets'}`}
          </p>
        </div>

        {!isLoading && paginated.length === 0 ? (
          <EmptyState
            bare
            title={filtering ? 'No tickets match these filters' : 'No tickets yet'}
            description={filtering ? 'Try a different status, block or search term.' : 'Tickets raised by students appear here.'}
            action={
              filtering
                ? {
                    label: 'Clear filters',
                    onClick: () => {
                      setStatusFilter('');
                      setBlockFilter('');
                      setSearchQuery('');
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <Th>Ticket</Th>
                    <Th>Location</Th>
                    <Th>Raised by</Th>
                    <Th>Trade</Th>
                    <Th>Status</Th>
                    <Th>Priority</Th>
                    <Th>Age</Th>
                    <Th>
                      <span className="sr-only">Open</span>
                    </Th>
                  </tr>
                </THead>
                {isLoading ? (
                  <TableSkeleton columns={8} />
                ) : (
                  <TBody>
                    {paginated.map((c) => (
                      <Tr
                        key={c.complaint_id}
                        interactive
                        onClick={() => setSelectedComplaint(c)}
                        className={c.status === 'ESCALATED' ? 'bg-rose-50/40 hover:bg-rose-50' : undefined}
                      >
                        <Td className="max-w-[320px]">
                          <p className="truncate font-medium text-slate-900">{c.issue_name}</p>
                          <p className="mt-0.5 font-mono text-xs text-slate-500">{ticketRef(c.complaint_id)}</p>
                        </Td>
                        <Td className="whitespace-nowrap font-medium text-slate-800">{ticketLocation(c)}</Td>
                        <Td className="whitespace-nowrap">{c.student_name}</Td>
                        <Td>
                          <SpecializationBadge specialization={c.required_specialization} />
                        </Td>
                        <Td>
                          <StatusBadge status={c.status} />
                        </Td>
                        <Td>
                          <PriorityBadge priority={c.priority} />
                        </Td>
                        <Td className="whitespace-nowrap text-slate-500" title={formatDateTime(c.created_at)}>
                          {formatRelativeTime(c.created_at)}
                        </Td>
                        <Td className="text-right">
                          <button
                            type="button"
                            aria-label={`Open ${ticketRef(c.complaint_id)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedComplaint(c);
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                )}
              </Table>
            </TableWrap>
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>

      {liveSelected && <DispatchDrawer key={liveSelected.complaint_id} isOpen onClose={() => setSelectedComplaint(null)} complaint={liveSelected} />}
    </div>
  );
};
