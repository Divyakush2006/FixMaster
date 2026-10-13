import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { complaintsApi, meApi, metaApi } from '../../api/endpoints';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { SearchInput } from '../../components/ui/SearchInput';
import { Select } from '../../components/ui/Form';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState } from '../../components/ui/EmptyState';
import { Alert } from '../../components/ui/Alert';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { StatusBadge, PriorityBadge, SpecializationBadge, SlaBadge } from '../../components/common/Badges';
import { DispatchDrawer } from './DispatchDrawer';
import { Complaint, ComplaintStatus, SlaStatus } from '../../types';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { STATUS_LABEL, ticketLocation, ticketRef } from '../../utils/labels';

const STATUSES = Object.keys(STATUS_LABEL) as ComplaintStatus[];
const PAGE_SIZE = 25;

/** Deadline filters, in the order a supervisor triages them. */
const SLA_FILTERS: { value: SlaStatus; label: string }[] = [
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'AT_RISK', label: 'Due soon' },
  { value: 'ON_TRACK', label: 'On track' },
  { value: 'BREACHED', label: 'Finished late' },
  { value: 'MET', label: 'Finished on time' },
];

/**
 * The full ticket register. Filtering, search and paging all run on the
 * server (limit/offset + X-Total-Count), so it stays fast at any volume.
 */
export const AllComplaintsTable: React.FC = () => {
  // ?sla=OVERDUE etc. lets the dashboard link straight to a filtered register.
  const [searchParams] = useSearchParams();
  const initialSla = SLA_FILTERS.some((f) => f.value === searchParams.get('sla')) ? (searchParams.get('sla') as string) : '';
  const [statusFilter, setStatusFilter] = useState('');
  const [slaFilter, setSlaFilter] = useState(initialSla);
  const [blockFilter, setBlockFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const q = useDebouncedValue(searchQuery.trim(), 300);

  const { data: allBlocks = [] } = useQuery({ queryKey: ['meta-blocks'], queryFn: metaApi.getBlocks });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: meApi.getMe });
  // A supervisor only has tickets in the blocks they look after.
  const managed = me?.role === 'SUPERVISOR' ? me.managed_blocks ?? [] : null;
  const blocks = managed ? allBlocks.filter((b) => managed.includes(b.block_id)) : allBlocks;

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['complaints', 'register', statusFilter, slaFilter, blockFilter, q, page],
    queryFn: () =>
      complaintsApi.page({
        status: statusFilter || undefined,
        sla: slaFilter || undefined,
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
  const filtering = !!(statusFilter || slaFilter || blockFilter || q);

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
            <Select aria-label="Filter by deadline" value={slaFilter} onChange={(e) => resetTo(setSlaFilter)(e.target.value)} className="lg:w-44">
              <option value="">Any deadline</option>
              {SLA_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </Select>
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
                      setSlaFilter('');
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
                    <Th>Deadline</Th>
                    <Th>Age</Th>
                    <Th>
                      <span className="sr-only">Open</span>
                    </Th>
                  </tr>
                </THead>
                {isLoading ? (
                  <TableSkeleton columns={10} />
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
                          <p className="mt-0.5 text-xs text-slate-500">
                            <span className="font-mono">{ticketRef(c.complaint_id)}</span>
                            {(c.reporter_count ?? 1) > 1 && <span> · {c.reporter_count} reporters</span>}
                          </p>
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
                        <Td>
                          <SlaBadge complaint={c} />
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
