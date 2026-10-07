import React from 'react';
import { cn } from './cn';

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement> & { as?: 'div' | 'section' }> = ({
  as: Tag = 'section',
  className,
  ...rest
}) => <Tag className={cn('rounded-lg border border-slate-200 bg-white shadow-card', className)} {...rest} />;

interface CardHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export const CardHeader: React.FC<CardHeaderProps> = ({ title, description, actions, icon, className }) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4', className)}>
    <div className="flex min-w-0 items-start gap-3">
      {icon}
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-6 text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
      </div>
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn('px-5 py-4', className)} {...rest} />
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div
    className={cn('flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-slate-200 bg-slate-50/70 px-5 py-3', className)}
    {...rest}
  />
);

/** Label/value pairs in a responsive grid - for record details. */
export const DetailList: React.FC<{ items: { label: string; value: React.ReactNode; mono?: boolean }[]; columns?: 2 | 3 }> = ({
  items,
  columns = 2,
}) => (
  <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-4', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
    {items.map((item) => (
      <div key={item.label} className="min-w-0">
        <dt className="text-xs font-medium text-slate-500">{item.label}</dt>
        <dd className={cn('mt-1 break-words text-sm text-slate-900', item.mono && 'font-mono text-[13px]')}>{item.value}</dd>
      </div>
    ))}
  </dl>
);
