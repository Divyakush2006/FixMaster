import React from 'react';
import { cn } from './cn';

/** Horizontally scrollable table container that sits inside a Card. */
export const TableWrap: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...rest }) => (
  <div className={cn('overflow-x-auto', className)} {...rest} />
);

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({ className, ...rest }) => (
  <table className={cn('w-full border-collapse text-left text-[13px]', className)} {...rest} />
);

export const THead: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, ...rest }) => (
  <thead className={cn('border-b border-slate-200 bg-slate-50/80', className)} {...rest} />
);

export const Th: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({ className, ...rest }) => (
  <th
    scope="col"
    className={cn('whitespace-nowrap px-4 py-2.5 text-2xs font-semibold uppercase tracking-[0.06em] text-slate-500', className)}
    {...rest}
  />
);

export const TBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({ className, ...rest }) => (
  <tbody className={cn('divide-y divide-slate-100', className)} {...rest} />
);

export const Tr: React.FC<React.HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }> = ({ className, interactive, ...rest }) => (
  <tr className={cn('transition-colors', interactive && 'cursor-pointer hover:bg-slate-50', className)} {...rest} />
);

export const Td: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({ className, ...rest }) => (
  <td className={cn('px-4 py-3 align-middle text-slate-700', className)} {...rest} />
);

/** Placeholder rows while a table loads. */
export const TableSkeleton: React.FC<{ rows?: number; columns: number }> = ({ rows = 6, columns }) => (
  <TBody>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r}>
        {Array.from({ length: columns }).map((__, c) => (
          <td key={c} className="px-4 py-3.5">
            <div className={cn('h-3 animate-pulse rounded bg-slate-100', c === 0 ? 'w-24' : c === columns - 1 ? 'ml-auto w-14' : 'w-full max-w-[140px]')} />
          </td>
        ))}
      </tr>
    ))}
  </TBody>
);
