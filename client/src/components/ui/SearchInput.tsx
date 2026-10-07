import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from './cn';

interface SearchInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, placeholder = 'Search', className, label = 'Search' }) => (
  <div className={cn('relative w-full', className)}>
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
    <input
      type="search"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="form-control pl-9 pr-8 [&::-webkit-search-cancel-button]:hidden"
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange('')}
        aria-label="Clear search"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
);
