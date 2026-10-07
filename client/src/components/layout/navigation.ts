import {
  LayoutDashboard,
  PlusCircle,
  Ticket,
  ClipboardList,
  Inbox,
  AlertTriangle,
  Repeat,
  Users,
  Building2,
  BedDouble,
  UserCircle2,
  LucideIcon,
} from 'lucide-react';
import { Role } from '../../types';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Match only the exact path (for section home pages). */
  end?: boolean;
  /** Shows the live count of escalated tickets. */
  badge?: 'escalations';
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

/** Product area name shown in the top bar for each role. */
export const WORKSPACE_NAME: Record<Role, string> = {
  STUDENT: 'Student Services',
  STAFF: 'Technician Workspace',
  SUPERVISOR: 'Operations Console',
  ADMIN: 'Administration Console',
};

const operations = (home: string): NavSection => ({
  heading: 'Operations',
  items: [
    { label: 'Overview', to: home, icon: LayoutDashboard, end: true },
    { label: 'All tickets', to: '/supervisor/all-complaints', icon: Inbox },
    { label: 'Escalations', to: '/supervisor/escalated', icon: AlertTriangle, badge: 'escalations' },
    { label: 'Recurring issues', to: '/supervisor/hotspots', icon: Repeat },
  ],
});

const account: NavSection = {
  heading: 'Account',
  items: [{ label: 'My account', to: '/account', icon: UserCircle2 }],
};

export function navigationFor(role: Role): NavSection[] {
  switch (role) {
    case 'STUDENT':
      return [
        {
          heading: 'Service desk',
          items: [
            { label: 'Overview', to: '/student', icon: LayoutDashboard, end: true },
            { label: 'Raise a ticket', to: '/student/new', icon: PlusCircle },
            { label: 'My tickets', to: '/student/complaints', icon: Ticket },
          ],
        },
        account,
      ];
    case 'STAFF':
      return [{ heading: 'Workspace', items: [{ label: 'My work queue', to: '/staff', icon: ClipboardList, end: true }] }, account];
    case 'SUPERVISOR':
      return [operations('/supervisor'), account];
    case 'ADMIN':
      return [
        operations('/admin/dashboard'),
        {
          heading: 'Administration',
          items: [
            { label: 'Users & access', to: '/admin/users', icon: Users },
            { label: 'Blocks & rooms', to: '/admin/infrastructure', icon: Building2 },
            { label: 'Room allotments', to: '/admin/allotments', icon: BedDouble },
          ],
        },
        account,
      ];
    default:
      return [account];
  }
}
