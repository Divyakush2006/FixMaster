import React from 'react';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { Complaint } from '../../types';
import { StatusBadge, PriorityBadge } from '../../components/common/Badges';
import { Button } from '../../components/ui/Button';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { ticketLocation, ticketRef } from '../../utils/labels';

interface TicketsTableProps {
  complaints: Complaint[];
  loading?: boolean;
  onView: (c: Complaint) => void;
  onVerify: (c: Complaint) => void;
  skeletonRows?: number;
}

/**
 * A student's tickets: a table on desktop, stacked rows on small screens.
 * Tickets waiting for the student's sign-off get a "Confirm" action.
 */
export const TicketsTable: React.FC<TicketsTableProps> = ({ complaints, loading, onView, onVerify, skeletonRows = 5 }) => (
  <>
    <TableWrap className="hidden md:block">
      <Table>
        <THead>
          <tr>
            <Th>Ticket</Th>
            <Th>Location</Th>
            <Th>Status</Th>
            <Th>Priority</Th>
            <Th>Raised</Th>
            <Th className="text-right">
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </THead>
        {loading ? (
          <TableSkeleton columns={6} rows={skeletonRows} />
        ) : (
          <TBody>
            {complaints.map((c) => (
              <Tr key={c.complaint_id} interactive onClick={() => onView(c)}>
                <Td className="max-w-[360px]">
                  <p className="truncate font-medium text-slate-900">{c.issue_name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    <span className="font-mono">{ticketRef(c.complaint_id)}</span> · {c.category_name}
                  </p>
                </Td>
                <Td className="whitespace-nowrap font-medium text-slate-800">{ticketLocation(c)}</Td>
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
                  <div className="flex items-center justify-end gap-2">
                    {c.status === 'PENDING_VERIFICATION' && (
                      <Button
                        size="sm"
                        icon={ShieldCheck}
                        onClick={(e) => {
                          e.stopPropagation();
                          onVerify(c);
                        }}
                      >
                        Confirm
                      </Button>
                    )}
                    <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden />
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        )}
      </Table>
    </TableWrap>

    <ul className="divide-y divide-slate-100 md:hidden">
      {loading
        ? Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="space-y-2 px-4 py-4">
              <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
            </li>
          ))
        : complaints.map((c) => (
            <li key={c.complaint_id}>
              <button type="button" onClick={() => onView(c)} className="w-full space-y-2 px-4 py-3.5 text-left hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-slate-900">{c.issue_name}</p>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-hidden />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <StatusBadge status={c.status} />
                  <PriorityBadge priority={c.priority} />
                </div>
                <p className="text-xs text-slate-500">
                  <span className="font-mono">{ticketRef(c.complaint_id)}</span> · {ticketLocation(c)} · {formatRelativeTime(c.created_at)}
                </p>
              </button>
              {c.status === 'PENDING_VERIFICATION' && (
                <div className="px-4 pb-3.5">
                  <Button size="sm" icon={ShieldCheck} block onClick={() => onVerify(c)}>
                    Confirm the work
                  </Button>
                </div>
              )}
            </li>
          ))}
    </ul>
  </>
);
