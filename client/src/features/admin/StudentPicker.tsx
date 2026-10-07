import React, { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { adminApi } from '../../api/endpoints';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { Avatar } from '../../components/ui/Avatar';
import { Spinner } from '../../components/ui/Spinner';
import { cn } from '../../components/ui/cn';
import { User } from '../../types';

interface StudentPickerProps {
  value: User | null;
  onChange: (student: User | null) => void;
  inputProps?: { id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string };
}

/**
 * Type-ahead student search (server-side, 20 results at a time). Replaces a
 * dropdown of every student, which stops being usable past a few hundred.
 * Keyboard: Up/Down to move, Enter to choose, Escape to close.
 */
export const StudentPicker: React.FC<StudentPickerProps> = ({ value, onChange, inputProps }) => {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const q = useDebouncedValue(text.trim(), 250);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['admin-users', 'student-search', q],
    queryFn: () => adminApi.searchStudents(q),
    enabled: open && q.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (s: User) => {
    onChange(s);
    setText('');
    setOpen(false);
  };

  if (value) {
    return (
      <div className="flex h-[38px] items-center gap-2.5 rounded-md border border-slate-300 bg-white pl-2 pr-1 shadow-xs">
        <Avatar name={value.full_name} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
          {value.full_name} <span className="font-mono text-xs text-slate-500">{value.reg_or_emp_id}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Choose a different student"
          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const showList = open && q.length >= 2;

  return (
    <div className="relative" ref={wrapRef}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
      <input
        {...inputProps}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder="Type a name or registration number"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="form-control pl-9 pr-9"
      />
      {isFetching && <Spinner className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-overlay"
        >
          {results.length === 0 && !isFetching && <li className="px-3 py-2.5 text-[13px] text-slate-500">No active student matches “{q}”.</li>}
          {results.map((s, i) => (
            <li
              key={s.user_id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-2', i === active && 'bg-brand-50')}
            >
              <Avatar name={s.full_name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-slate-900">{s.full_name}</span>
                <span className="block font-mono text-xs text-slate-500">{s.reg_or_emp_id}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
