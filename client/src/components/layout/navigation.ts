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
  ScrollText,
  Sparkles,
  Newspaper,
  ShieldCheck,
  Gauge,
  SlidersHorizontal,
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
  CHIEF_WARDEN: 'Campus Console',
  ADMIN: 'Administration Console',
};

const operations = (home: string): NavSection => ({
  heading: 'Operations',
  items: [
    { label: 'Overview', to: home, icon: LayoutDashboard, end: true },
    { label: 'All tickets', to: '/supervisor/all-complaints', icon: Inbox },
    { label: 'Escalations', to: '/supervisor/escalated', icon: AlertTriangle, badge: 'escalations' },
    { label: 'Recurring issues', to: '/supervisor/hotspots', icon: Repeat },
    { label: 'Daily briefing', to: '/supervisor/insights', icon: Newspaper },
  ],
});

const autopilot: NavSection = {
  heading: 'Autopilot',
  items: [
    { label: 'Dispatch settings', to: '/supervisor/autopilot', icon: SlidersHorizontal },
    { label: 'Staff performance', to: '/supervisor/staff', icon: Gauge },
    { label: 'Cleaning plan', to: '/supervisor/cleaning', icon: Sparkles },
  ],
};

/** Floors, rooms and shared areas of the blocks this manager runs (administrators have Blocks & rooms instead). */
const blockSettings: NavSection = {
  heading: 'Hostel',
  items: [{ label: 'Block settings', to: '/supervisor/blocks', icon: Building2 }],
};

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
    case 'CHIEF_WARDEN':
      return [operations('/supervisor'), autopilot, blockSettings, account];
    case 'ADMIN':
      return [
        operations('/admin/dashboard'),
        autopilot,
        {
          heading: 'Administration',
          items: [
            { label: 'Users & access', to: '/admin/users', icon: Users },
            { label: 'Blocks & rooms', to: '/admin/infrastructure', icon: Building2 },
            { label: 'Room allotments', to: '/admin/allotments', icon: BedDouble },
            { label: 'Privacy requests', to: '/admin/privacy', icon: ShieldCheck },
            { label: 'Audit log', to: '/admin/audit', icon: ScrollText },
          ],
        },
        account,
      ];
    default:
      return [account];
  }
}
