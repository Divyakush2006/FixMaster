import React from 'react';
import { cn } from './cn';

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Show the label next to the switch (otherwise it is only the accessible name). */
  showLabel?: boolean;
}

export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, disabled, showLabel }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={showLabel ? undefined : label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="group inline-flex items-center gap-2.5 disabled:cursor-not-allowed disabled:opacity-50"
  >
    <span
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-emerald-500' : 'bg-slate-300'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </span>
    {showLabel && <span className="text-[13px] font-medium text-slate-700">{label}</span>}
  </button>
);
