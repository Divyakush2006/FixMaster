import { BlockKind, CommonAreaType, Complaint, ComplaintStatus, HostelType, Priority, Role, RoomType, SlaStatus, Specialization, TicketScope } from '../types';

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
  CANCELLED: 'Withdrawn',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  EMERGENCY: 'Emergency',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const SLA_LABEL: Record<SlaStatus, string> = {
  ON_TRACK: 'On track',
  AT_RISK: 'Due soon',
  OVERDUE: 'Overdue',
  MET: 'Within SLA',
  BREACHED: 'SLA missed',
  NOT_APPLICABLE: '',
};

/** "3h", "45m", "2d 4h" - a compact duration for SLA text. */
export function shortDuration(ms: number): string {
  const mins = Math.max(Math.round(Math.abs(ms) / 60000), 1);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/**
 * One line about a ticket's deadline, e.g. "Due in 3h", "Overdue by 2h",
 * "Done within SLA". Null when the SLA does not apply.
 */
export function slaText(c: Pick<Complaint, 'sla_status' | 'sla_due_at' | 'resolved_at' | 'closed_at'>, now = Date.now()): string | null {
  if (!c.sla_status || c.sla_status === 'NOT_APPLICABLE' || !c.sla_due_at) return null;
  const due = new Date(c.sla_due_at).getTime();
  switch (c.sla_status) {
    case 'ON_TRACK':
    case 'AT_RISK':
      return `Due in ${shortDuration(due - now)}`;
    case 'OVERDUE':
      return `Overdue by ${shortDuration(now - due)}`;
    case 'MET':
      return 'Done within SLA';
    case 'BREACHED': {
      const done = new Date(c.resolved_at || c.closed_at || due).getTime();
      return `SLA missed by ${shortDuration(done - due)}`;
    }
    default:
      return null;
  }
}

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
  CHIEF_WARDEN: 'Chief warden',
  ADMIN: 'Administrator',
};

export const ROOM_TYPE_LABEL: Record<RoomType, string> = {
  NON_AC: 'Non-AC',
  AC: 'AC',
  DELUXE_AC: 'Deluxe AC',
};

export const HOSTEL_LABEL: Record<HostelType, string> = {
  MENS: "Men's hostel",
  LADIES: "Ladies' hostel",
};

export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  RESIDENTIAL: 'Residential block',
  HOSTEL_WIDE: 'Whole hostel',
  ACADEMIC: 'Academic block',
};

export const AREA_TYPE_LABEL: Record<CommonAreaType, string> = {
  WATER_COOLER: 'Water cooler',
  COMMON_WASHROOM: 'Common washroom',
  SHOWER_ROOM: 'Shower room',
  ELEVATOR: 'Lift',
  CORRIDOR: 'Corridor',
  STUDY_HALL: 'Study hall',
};

export const SCOPE_LABEL: Record<TicketScope, string> = {
  ROOM: 'Room',
  COMMON_AREA: 'Common area',
};

/**
 * How a shared ticket relates to the signed-in student: tickets belong to the
 * room (or common area), so a roommate's request shows up for everyone in it.
 * Returns null for an ordinary ticket only the student reported.
 */
export function sharedTicketNote(c: Pick<Complaint, 'is_reporter' | 'reporter_count' | 'ticket_scope'>): string | null {
  if (c.is_reporter === false) return c.ticket_scope === 'ROOM' ? 'Raised by a roommate' : null;
  const others = Math.max((c.reporter_count ?? 1) - 1, 0);
  return others > 0 ? `You + ${others} other${others === 1 ? '' : 's'}` : null;
}

/** Statuses after which nothing more happens to a ticket. */
export const CLOSED_STATUSES: ComplaintStatus[] = ['COMPLETED', 'REJECTED', 'CANCELLED'];

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

/**
 * "L_BLOCK" -> "L-Block" for places that only have the id. A ladies' block id
 * has an L in front ("LA_BLOCK" -> "A-Block (Ladies)"), and MH and PRP are not
 * lettered blocks at all.
 */
export function blockLabel(blockId: string): string {
  const [code] = blockId.split('_');
  if (!blockId.endsWith('_BLOCK')) return blockId;
  if (code === 'MH') return "MH (whole men's hostel)";
  if (code === 'PRP') return 'PRP (academic block)';
  if (/^L[A-Z]$/.test(code)) return `${code[1]}-Block (Ladies)`;
  return `${code}-Block`;
}

/** The short tag for a chart axis: A, B ... T for the men's blocks, LA ... LS for the ladies', MH, PRP. */
export function blockShort(blockId: string): string {
  return blockId.split('_')[0];
}

export type BlockGroup = 'MENS' | 'LADIES' | 'ACADEMIC';

export const BLOCK_GROUPS: { key: BlockGroup; label: string }[] = [
  { key: 'MENS', label: HOSTEL_LABEL.MENS },
  { key: 'LADIES', label: HOSTEL_LABEL.LADIES },
  { key: 'ACADEMIC', label: 'Academic blocks' },
];

interface BlockLike {
  block_id: string;
  hostel_type?: HostelType | null;
  block_kind?: BlockKind;
}

/** Which list a block belongs to. Falls back to the id for rows that carry no hostel (older data). */
export function blockGroup(b: BlockLike): BlockGroup {
  if (b.hostel_type) return b.hostel_type;
  if (b.hostel_type === null || b.block_id === 'PRP_BLOCK') return 'ACADEMIC';
  return /^L[A-Z]_BLOCK$/.test(b.block_id) ? 'LADIES' : 'MENS';
}

/** Men's hostel, then the ladies', then academic; inside each the whole-hostel block first, then A, B, C ... */
export function compareBlocks(a: BlockLike, b: BlockLike): number {
  const rank = (x: BlockLike) => BLOCK_GROUPS.findIndex((g) => g.key === blockGroup(x));
  const wide = (x: BlockLike) => (x.block_kind === 'HOSTEL_WIDE' || x.block_id === 'MH_BLOCK' ? 0 : 1);
  return rank(a) - rank(b) || wide(a) - wide(b) || blockShort(a.block_id).length - blockShort(b.block_id).length || a.block_id.localeCompare(b.block_id);
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
