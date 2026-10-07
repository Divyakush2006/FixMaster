import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  pageSize?: number;
  className?: string;
}

/** Table footer: "Showing 1-12 of 40" and previous/next controls. */
export const Pagination: React.FC<PaginationProps> = ({ currentPage, totalPages, onPageChange, totalItems, pageSize = 10, className }) => {
  if (totalItems === 0) return null;
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems ?? totalPages * pageSize);

  const navButton = 'inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 text-[13px] font-medium text-slate-700 shadow-xs transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className={cn('flex flex-col items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-[13px] text-slate-500 sm:flex-row', className)}>
      <p className="tabular">
        {totalItems !== undefined ? (
          <>
            Showing <span className="font-medium text-slate-900">{start}</span>–<span className="font-medium text-slate-900">{end}</span> of{' '}
            <span className="font-medium text-slate-900">{totalItems}</span>
          </>
        ) : (
          <>
            Page <span className="font-medium text-slate-900">{currentPage}</span> of <span className="font-medium text-slate-900">{totalPages}</span>
          </>
        )}
      </p>
      {totalPages > 1 && (
        <nav className="flex items-center gap-2" aria-label="Pagination">
          <button type="button" className={navButton} onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
            Previous
          </button>
          <span className="px-1 tabular text-slate-600">
            {currentPage} / {totalPages}
          </span>
          <button type="button" className={navButton} onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages}>
            Next
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
};
