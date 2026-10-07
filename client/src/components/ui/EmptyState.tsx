import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';
import { cn } from './cn';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Render without its own border, for use inside a Card. */
  bare?: boolean;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon = Inbox, title, description, action, bare, className }) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center px-6 py-12 text-center',
      !bare && 'rounded-lg border border-dashed border-slate-300 bg-white',
      className
    )}
  >
    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
      <Icon className="h-5 w-5" aria-hidden />
    </div>
    <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
    <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-slate-500">{description}</p>
    {action && (
      <Button variant="secondary" size="sm" className="mt-4" onClick={action.onClick}>
        {action.label}
      </Button>
    )}
  </div>
);
