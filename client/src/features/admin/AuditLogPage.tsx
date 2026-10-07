import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { adminApi } from '../../api/endpoints';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card } from '../../components/ui/Card';
import { Select } from '../../components/ui/Form';
import { Badge, Tone } from '../../components/ui/Badge';
import { Avatar } from '../../components/ui/Avatar';
import { Alert } from '../../components/ui/Alert';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { Table, TableWrap, THead, Th, TBody, Tr, Td, TableSkeleton } from '../../components/ui/Table';
import { AuditEntry } from '../../types';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';

const PAGE_SIZE = 50;

/** Human wording for each recorded action. */
const ACTION_LABEL: Record<string, string> = {
  'auth.admin_sign_in': 'Administrator signed in',
  'auth.admin_sign_out': 'Administrator signed out',
  'auth.account_locked': 'Account locked after failed sign-ins',
  'user.create': 'Account created',
  'user.deactivate': 'Account deactivated',
  'user.reactivate': 'Account reactivated',
  'user.set_availability': 'Duty status changed',
  'user.unlock': 'Account unlocked',
  'user.reset_password': 'Password reset',
  'allotment.create': 'Room allotted',
  'allotment.move': 'Student moved to another room',
  'allotment.end': 'Allotment ended',
  'block.create': 'Block created',
  'block.rename': 'Block renamed',
  'floor.add': 'Floor added',
  'floor.remove': 'Floor removed',
  'room.create': 'Rooms created',
  'room.close': 'Room closed',
  'room.reopen': 'Room reopened',
  'room.update': 'Room updated',
};

const AREA_TONE: Record<string, Tone> = { auth: 'violet', user: 'brand', allotment: 'info', block: 'orange', floor: 'orange', room: 'orange' };

const FILTERS = [
  { value: '', label: 'All activity' },
  { value: 'auth', label: 'Sign-ins and lockouts' },
  { value: 'user', label: 'Accounts' },
  { value: 'allotment', label: 'Room allotments' },
  { value: 'block', label: 'Blocks' },
  { value: 'floor', label: 'Floors' },
  { value: 'room', label: 'Rooms' },
];

/** One readable line summarising the details recorded with an entry. */
export function describeAudit(e: AuditEntry): string {
  const d = e.details as Record<string, any>;
  switch (e.action) {
    case 'user.create':
      return `${d.reg_or_emp_id} · ${String(d.role).toLowerCase()}${d.specialization ? ` (${String(d.specialization).toLowerCase()})` : ''}`;
    case 'user.deactivate':
      return d.released_tickets ? `${d.reg_or_emp_id} · ${d.released_tickets} open task(s) returned to the queue` : String(d.reg_or_emp_id ?? '');
    case 'user.set_availability':
      return `${d.reg_or_emp_id} · ${d.is_available ? 'on duty' : 'off duty'}`;
    case 'auth.account_locked':
      return `${d.failed_attempts} failed attempts · locked for ${d.locked_minutes} min (${d.portal} sign-in)`;
    case 'allotment.create':
      return `Room ${d.room_id} · ${d.academic_year}`;
    case 'allotment.move':
      return `${d.from_room_id} → ${d.room_id} · ${d.academic_year}`;
    case 'allotment.end':
      return `Room ${d.room_id}`;
    case 'block.create':
      return `${d.block_name} · ground + ${d.top_floor} floors`;
    case 'block.rename':
      return `${d.from} → ${d.to}`;
    case 'floor.add':
    case 'floor.remove':
      return `Floor ${d.floor_number === 0 ? 'G' : d.floor_number}`;
    case 'room.create': {
      const rooms = Array.isArray(d.rooms) ? d.rooms : [];
      return rooms.length > 3 ? `${rooms[0]} … ${rooms[rooms.length - 1]} (${rooms.length} rooms)` : rooms.join(', ');
    }
    case 'room.close':
    case 'room.reopen':
    case 'room.update':
      return Object.entries(d)
        .map(([k, v]) => `${k.replace('_', ' ')}: ${(v as any)?.from} → ${(v as any)?.to}`)
        .join(' · ');
    default:
      return typeof d.reg_or_emp_id === 'string' ? d.reg_or_emp_id : '';
  }
}

export const AuditLogPage: React.FC = () => {
  const [area, setArea] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['admin-audit', area, page],
    queryFn: () => adminApi.listAudit({ action: area || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const target = (e: AuditEntry) => {
    if (e.target_type === 'user') return e.target_name ?? e.target_id;
    if (e.target_type === 'block') return e.target_id?.replace('_BLOCK', '-Block');
    return e.target_id;
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Administration' }, { label: 'Audit log' }]}
        title="Audit log"
        description="Every change to accounts, allotments and hostel infrastructure, with who made it and when. Entries cannot be edited or deleted."
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <Select
            aria-label="Filter activity"
            value={area}
            onChange={(e) => {
              setArea(e.target.value);
              setPage(1);
            }}
            className="sm:w-64"
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
          <p className="text-[13px] text-slate-500">
            {isLoading ? 'Loading…' : `${total} ${total === 1 ? 'entry' : 'entries'}`}
            {isFetching && !isLoading && <span className="ml-2 text-slate-500">Updating…</span>}
          </p>
        </div>

        {isError ? (
          <div className="p-5">
            <Alert tone="danger" title="The audit log could not be loaded" />
          </div>
        ) : !isLoading && rows.length === 0 ? (
          <EmptyState bare icon={ShieldCheck} title="No activity recorded" description="Administrative changes will appear here as they happen." />
        ) : (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <Th>When</Th>
                    <Th>Action</Th>
                    <Th>Subject</Th>
                    <Th>Details</Th>
                    <Th>Performed by</Th>
                    <Th>Source</Th>
                  </tr>
                </THead>
                {isLoading ? (
                  <TableSkeleton columns={6} />
                ) : (
                  <TBody>
                    {rows.map((e) => {
                      const areaKey = e.action.split('.')[0];
                      return (
                        <Tr key={e.audit_id}>
                          <Td className="whitespace-nowrap" title={formatDateTime(e.occurred_at)}>
                            <p className="text-slate-900">{formatRelativeTime(e.occurred_at)}</p>
                            <p className="text-xs text-slate-500">{formatDateTime(e.occurred_at)}</p>
                          </Td>
                          <Td>
                            <Badge tone={AREA_TONE[areaKey] ?? 'neutral'}>{ACTION_LABEL[e.action] ?? e.action}</Badge>
                          </Td>
                          <Td className="font-medium text-slate-900">{target(e) ?? '—'}</Td>
                          <Td className="max-w-[320px] text-slate-600">
                            <span className="line-clamp-2">{describeAudit(e) || '—'}</span>
                          </Td>
                          <Td>
                            {e.actor_name ? (
                              <div className="flex items-center gap-2.5">
                                <Avatar name={e.actor_name} size="sm" />
                                <div className="leading-tight">
                                  <p className="whitespace-nowrap text-slate-900">{e.actor_name}</p>
                                  <p className="font-mono text-2xs text-slate-500">{e.actor_reg_or_emp_id}</p>
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-500">System</span>
                            )}
                          </Td>
                          <Td className="whitespace-nowrap font-mono text-xs text-slate-500" title={e.request_id ? `Request ${e.request_id}` : undefined}>
                            {e.ip_address ?? '—'}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                )}
              </Table>
            </TableWrap>
            <Pagination currentPage={Math.min(page, totalPages)} totalPages={totalPages} onPageChange={setPage} totalItems={total} pageSize={PAGE_SIZE} />
          </>
        )}
      </Card>
    </div>
  );
};
