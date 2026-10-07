import React, { useId } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from './cn';
import { useOverlay } from './overlay';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Shown above the title, e.g. status badges. */
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: 'md' | 'lg';
}

/** Right-hand side panel for inspecting and acting on one record. */
export const Drawer: React.FC<DrawerProps> = ({ isOpen, onClose, title, subtitle, eyebrow, children, footer, width = 'lg' }) => {
  const panelRef = useOverlay(isOpen, onClose);
  const titleId = useId();
  if (!isOpen) return null;

  return createPortal(
    <div
      data-overlay
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[2px] animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'flex h-full w-full flex-col bg-white shadow-overlay outline-none focus-visible:ring-0 animate-slide-in-right',
          width === 'lg' ? 'max-w-xl' : 'max-w-md'
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="min-w-0 space-y-2">
            {eyebrow && <div className="flex flex-wrap items-center gap-2">{eyebrow}</div>}
            <h2 id={titleId} className="text-lg font-semibold leading-6 text-slate-900">
              {title}
            </h2>
            {subtitle && <p className="text-[13px] text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-2 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body
  );
};
