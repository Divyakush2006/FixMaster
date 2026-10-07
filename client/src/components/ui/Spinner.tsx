import React from 'react';
import { cn } from './cn';

export const Spinner: React.FC<{ className?: string; label?: string }> = ({ className, label = 'Loading' }) => (
  <span
    role="status"
    aria-label={label}
    className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
  />
);
