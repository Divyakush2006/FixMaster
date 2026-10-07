import React from 'react';
import { ComplaintStatus, Priority, Specialization, Role } from '../../types';
import { Badge, Tone } from '../ui/Badge';
import { cn } from '../ui/cn';
import { PRIORITY_LABEL, ROLE_LABEL, SPECIALIZATION_LABEL, STATUS_LABEL } from '../../utils/labels';
import { Sparkles, Zap, Hammer, Wind, Droplets, LucideIcon } from 'lucide-react';

const STATUS_TONE: Record<ComplaintStatus, Tone> = {
  OPEN: 'info',
  ASSIGNED: 'violet',
  IN_PROGRESS: 'brand',
  PENDING_VERIFICATION: 'warning',
  COMPLETED: 'success',
  ESCALATED: 'danger',
  REJECTED: 'neutral',
};

interface StatusBadgeProps {
  status: ComplaintStatus;
  /** Kept for call-site compatibility; badges have one size. */
  size?: 'sm' | 'md' | 'lg';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => (
  <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>
    {STATUS_LABEL[status] ?? status}
  </Badge>
);

const PRIORITY_STYLE: Record<Priority, { text: string; bars: number; bar: string }> = {
  EMERGENCY: { text: 'text-rose-700', bars: 4, bar: 'bg-rose-600' },
  HIGH: { text: 'text-orange-700', bars: 3, bar: 'bg-orange-500' },
  MEDIUM: { text: 'text-amber-700', bars: 2, bar: 'bg-amber-500' },
  LOW: { text: 'text-slate-600', bars: 1, bar: 'bg-slate-400' },
};

interface PriorityBadgeProps {
  priority: Priority;
  size?: 'sm' | 'md' | 'lg';
}

/** Priority as a four-step signal meter plus label. Emergency is solid red. */
export const PriorityBadge: React.FC<PriorityBadgeProps> = ({ priority }) => {
  const style = PRIORITY_STYLE[priority];
  if (!style) return <Badge>{priority}</Badge>;
  if (priority === 'EMERGENCY') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-rose-600 px-2 py-0.5 text-xs font-semibold text-white">
        <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
        {PRIORITY_LABEL.EMERGENCY}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium', style.text)}>
      <span className="flex items-end gap-px" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn('w-[3px] rounded-sm', i <= style.bars ? style.bar : 'bg-slate-200')} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      {PRIORITY_LABEL[priority]}
    </span>
  );
};

export const SPECIALIZATION_ICON: Record<Specialization, LucideIcon> = {
  CLEANING: Sparkles,
  ELECTRICIAN: Zap,
  CARPENTER: Hammer,
  AC_TECH: Wind,
  PLUMBER: Droplets,
};

export const SpecializationBadge: React.FC<{ specialization: Specialization }> = ({ specialization }) => {
  const Icon = SPECIALIZATION_ICON[specialization];
  return (
    <Badge tone="neutral" icon={Icon ? <Icon className="h-3 w-3 text-slate-500" aria-hidden /> : undefined}>
      {SPECIALIZATION_LABEL[specialization] ?? specialization}
    </Badge>
  );
};

const ROLE_TONE: Record<Role, Tone> = {
  STUDENT: 'brand',
  STAFF: 'success',
  SUPERVISOR: 'orange',
  ADMIN: 'violet',
};

export const RoleBadge: React.FC<{ role: Role }> = ({ role }) => <Badge tone={ROLE_TONE[role] ?? 'neutral'}>{ROLE_LABEL[role] ?? role}</Badge>;
