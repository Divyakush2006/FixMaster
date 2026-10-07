import { Complaint, TimelineEvent } from '../types';
import { formatDateTime } from './formatters';

/**
 * Fallback timeline built from a complaint's own fields, used only when the
 * audit log (GET /complaints/:id/logs) has no rows - which happens for
 * records inserted directly into the database (e.g. demo seed data) rather
 * than created through the API.
 */
export function reconstructTimeline(complaint: Complaint): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      title: 'Complaint Registered',
      description: `Ticket raised by ${complaint.student_name} (${complaint.issue_name})`,
      timestamp: formatDateTime(complaint.created_at),
      status: 'completed',
    },
  ];

  if (complaint.status === 'OPEN') {
    events.push({
      title: 'Awaiting Supervisor Assignment',
      description: 'Ticket is in queue to be assigned to a technician.',
      timestamp: 'Pending',
      status: 'current',
    });
  } else {
    events.push({
      title: 'Dispatched to Technician',
      description: 'Supervisor assigned the ticket to a trade technician.',
      timestamp: 'Recorded',
      status: 'completed',
    });
  }

  if (['IN_PROGRESS', 'PENDING_VERIFICATION', 'COMPLETED', 'ESCALATED'].includes(complaint.status)) {
    events.push({
      title: 'Work In Progress',
      description: 'Technician is servicing the complaint.',
      timestamp: 'Recorded',
      status: complaint.status === 'IN_PROGRESS' ? 'current' : 'completed',
    });
  }

  if (['PENDING_VERIFICATION', 'COMPLETED'].includes(complaint.status)) {
    events.push({
      title: 'Work Marked Completed',
      description: 'Technician finished the repair. Awaiting verification.',
      timestamp: complaint.resolved_at ? formatDateTime(complaint.resolved_at) : 'Recorded',
      status: complaint.status === 'PENDING_VERIFICATION' ? 'current' : 'completed',
    });
  }

  if (complaint.status === 'COMPLETED') {
    events.push({
      title: 'Closed & Verified',
      description: 'Resolution confirmed and ticket signed off.',
      timestamp: complaint.closed_at ? formatDateTime(complaint.closed_at) : 'Closed',
      status: 'completed',
    });
  } else if (complaint.status === 'ESCALATED') {
    events.push({
      title: 'Escalated',
      description: 'The work was rejected and returned to the supervisor.',
      timestamp: 'Recorded',
      status: 'current',
    });
  }

  return events;
}

/**
 * One line describing an audit-trail entry: the human note (if any) and who
 * acted. The database's automatic "Transition: A -> B" note is dropped - the
 * entry's title already says that.
 */
export function logDescription(log: { action_note: string | null; changed_by_name: string | null }): string {
  const note = log.action_note && !/^Transition:/i.test(log.action_note) ? log.action_note : null;
  return [note, log.changed_by_name].filter(Boolean).join(' · ') || 'Recorded by the system';
}
