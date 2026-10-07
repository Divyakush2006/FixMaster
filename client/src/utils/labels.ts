import { ComplaintStatus, Priority, Role, RoomType, Specialization, TicketScope } from '../types';

/**
 * Display vocabulary. The API speaks in enum codes (PENDING_VERIFICATION,
 * AC_TECH...); people read these labels. Keep every screen on this one map so
 * the same state is never called two different things.
 */
export const STATUS_LABEL: Record<ComplaintStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  PENDING_VERIFICATION: 'Awaiting confirmation',
  COMPLETED: 'Closed',
  ESCALATED: 'Escalated',
  REJECTED: 'Rejected',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  EMERGENCY: 'Emergency',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const PRIORITY_RANK: Record<Priority, number> = { EMERGENCY: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export const SPECIALIZATION_LABEL: Record<Specialization, string> = {
  CLEANING: 'Housekeeping',
  ELECTRICIAN: 'Electrical',
  CARPENTER: 'Carpentry',
  AC_TECH: 'AC & HVAC',
  PLUMBER: 'Plumbing',
};

export const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'Student',
  STAFF: 'Technician',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Administrator',
};

export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  NON_AC: 'Non-AC',
  AC: 'AC',
  DELUXE_AC: 'Deluxe AC',
};

export const SCOPE_LABEL: Record<TicketScope, string> = {
  ROOM: 'Room',
  COMMON_AREA: 'Common area',
};

/** Statuses after which nothing more happens to a ticket. */
export const CLOSED_STATUSES: ComplaintStatus[] = ['COMPLETED', 'REJECTED'];

export const isOpenStatus = (status: ComplaintStatus) => !CLOSED_STATUSES.includes(status);

/**
 * Short human reference for a ticket id, e.g. "TKT-00A3F9". Display only:
 * search and every API call still use the full id.
 */
export function ticketRef(id: string | null | undefined): string {
  if (!id) return '';
  const compact = id.replace(/[^a-zA-Z0-9]/g, '');
  return `TKT-${compact.slice(-6).toUpperCase()}`;
}

/** Where a ticket is: the room, else the common area, else the block. */
export function ticketLocation(c: { room_id: string | null; common_area_id: string | null; block_id: string }): string {
  return c.room_id || c.common_area_id || c.block_id;
}

/** "L_BLOCK" -> "L-Block" for places that only have the id. */
export function blockLabel(blockId: string): string {
  const [code] = blockId.split('_');
  return blockId.endsWith('_BLOCK') ? `${code}-Block` : blockId;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  // Ignore bracketed notes and titles, e.g. "Mr. R. Sundaram (L-Block)" -> "RS".
  const parts = name
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}]/gu, ''))
    .filter((w) => w.length > 0 && !/^(mr|mrs|ms|dr|prof)$/i.test(w));
  if (parts.length === 0) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
