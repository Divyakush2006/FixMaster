import React from 'react';
import { cn } from './cn';
import { initials } from '../../utils/labels';

// A stable colour per person, so the same name always gets the same avatar.
const PALETTE = [
  'bg-brand-100 text-brand-800',
  'bg-emerald-100 text-emerald-800',
  'bg-violet-100 text-violet-800',
  'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-800',
  'bg-rose-100 text-rose-800',
  'bg-teal-100 text-teal-800',
];

function colourFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export const Avatar: React.FC<{ name: string; size?: 'sm' | 'md' | 'lg'; className?: string }> = ({ name, size = 'md', className }) => (
  <span
    aria-hidden
    className={cn(
      'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
      size === 'sm' && 'h-7 w-7 text-2xs',
      size === 'md' && 'h-8 w-8 text-xs',
      size === 'lg' && 'h-14 w-14 text-lg',
      colourFor(name),
      className
    )}
  >
    {initials(name)}
  </span>
);
