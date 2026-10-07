import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { complaintsApi, metaApi } from '../../api/endpoints';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { SearchInput } from '../../components/ui/SearchInput';
import { Select } from '../../components/ui/Form';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { Alert } from '../../components/ui/Alert';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { StatusBadge, PriorityBadge, SpecializationBadge } from '../../components/common/Badges';
import { DispatchDrawer } from './DispatchDrawer';
import { Complaint, ComplaintStatus } from '../../types';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { STATUS_LABEL, ticketLocation, ticketRef } from '../../utils/labels';

const STATUSES = Object.keys(STATUS_LABEL) as ComplaintStatus[];
const PAGE_SIZE = 25;

/**
 * The full ticket register. Filtering, search and paging all run on the
 * server (limit/offset + X-Total-Count), so it stays fast at any volume.
 */
export const AllComplaintsTable: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const q = useDebouncedValue(searchQuery.trim(), 300);

  const { data: blocks = [] } = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['complaints', 'register', statusFilter, blockFilter, q, page],
    queryFn: () =>
      complaintsApi.page({
        status: statusFilter || undefined,
        block_id: blockFilter || undefined,
        q: q || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtering = !!(statusFilter || blockFilter || q);

  // Keep the open record in sync with refreshed data after a dispatch.
  const liveSelected = selected && (rows.find((c) => c.complaint_id === selected.complaint_id) ?? selected);

  const resetTo = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Operations' }, { label: 'All tickets' }]}
        title="All tickets"
        description="Inspect any ticket and dispatch or reassign it to a technician."
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-3.5 lg:flex-row lg:items-center">
          <SearchInput
            className="lg:max-w-sm"
            value={searchQuery}
            onChange={resetTo(setSearchQuery)}
            placeholder="Search issue, student, location or TKT number"
            label="Search tickets"
          />
          <div className="grid grid-cols-2 gap-3 lg:flex">
            <Select aria-label="Filter by status" value={statusFilter} onChange={(e) => resetTo(setStatusFilter)(e.target.value)} className="lg:w-52">
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by block" value={blockFilter} onChange={(e) => resetTo(setBlockFilter)(e.target.value)} className="lg:w-56">
              <option value="">All blocks</option>
              {blocks.map((b) => (
                <option key={b.block_id} value={b.block_id}>
                  {b.block_name}
                </option>
              ))}
            </Select>
          </div>
          <p className="text-[13px] text-slate-500 lg:ml-auto" aria-live="polite">
            {isLoading ? 'Loading…' : `${total} ${total === 1 ? 'ticket' : 'tickets'}`}
            {isFetching && !isLoading && <span className="ml-2 text-slate-500">Updating…</span>}
          </p>
        </div>

        {isError ? (
          <div className="p-5">
            <Alert tone="danger" title="Tickets could not be loaded">
              Check your connection and try again.
            </Alert>
          </div>
        ) : !isLoading && rows.length === 0 ? (
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
                      setPage(1);
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            <TableWrap className={isFetching && !isLoading ? 'opacity-70 transition-opacity' : undefined}>
              <Table>
                <THead>
                  <tr>
                    <Th>Ticket</Th>
                    <Th>Location</Th>
                    <Th>Raised by</Th>
                    <Th>Trade</Th>
                    <Th>Technician</Th>
                    <Th>Status</Th>
                    <Th>Priority</Th>
                    <Th>Age</Th>
                    <Th>
                      <span className="sr-only">Open</span>
                    </Th>
                  </tr>
                </THead>
                {isLoading ? (
                  <TableSkeleton columns={9} />
                ) : (
                  <TBody>
                    {rows.map((c) => (
                      <Tr
                        key={c.complaint_id}
                        interactive
                        onClick={() => setSelected(c)}
                        className={c.status === 'ESCALATED' ? 'bg-rose-50/40 hover:bg-rose-50' : undefined}
                      >
                        <Td className="max-w-[300px]">
                          <p className="truncate font-medium text-slate-900">{c.issue_name}</p>
                          <p className="mt-0.5 font-mono text-xs text-slate-500">{ticketRef(c.complaint_id)}</p>
                        </Td>
                        <Td className="whitespace-nowrap font-medium text-slate-800">{ticketLocation(c)}</Td>
                        <Td className="whitespace-nowrap">{c.student_name}</Td>
                        <Td>
                          <SpecializationBadge specialization={c.required_specialization} />
                        </Td>
                        <Td className="whitespace-nowrap">
                          {c.assigned_staff_name && !['OPEN', 'ESCALATED'].includes(c.status) ? (
                            c.assigned_staff_name
                          ) : (
                            <span className="text-slate-500">Unassigned</span>
                          )}
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
                              setSelected(c);
                            }}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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
            <Pagination currentPage={Math.min(page, totalPages)} totalPages={totalPages} onPageChange={setPage} totalItems={total} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>

      {liveSelected && <DispatchDrawer key={liveSelected.complaint_id} isOpen onClose={() => setSelected(null)} complaint={liveSelected} />}
    </div>
  );
};
