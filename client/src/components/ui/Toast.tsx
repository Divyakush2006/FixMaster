import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn } from './cn';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextType {
  showToast: (title: string, type?: ToastType, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const STYLE: Record<ToastType, { icon: React.ElementType; color: string; bar: string }> = {
  success: { icon: CheckCircle2, color: 'text-emerald-600', bar: 'bg-emerald-500' },
  error: { icon: AlertCircle, color: 'text-rose-600', bar: 'bg-rose-500' },
  info: { icon: Info, color: 'text-brand-600', bar: 'bg-brand-500' },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (title: string, type: ToastType = 'info', message?: string) => {
      const id = Math.random().toString(36).substring(2, 9);
      // Keep at most four on screen; the oldest goes first.
      setToasts((prev) => [...prev.slice(-3), { id, title, type, message }]);
      setTimeout(() => removeToast(id), type === 'error' ? 7000 : 4500);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[380px]"
      >
        {toasts.map((toast) => {
          const { icon: Icon, color, bar } = STYLE[toast.type];
          return (
            <div
              key={toast.id}
              role={toast.type === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white py-3 pl-4 pr-3 shadow-overlay animate-scale-in"
            >
              <span className={cn('absolute inset-y-0 left-0 w-1', bar)} aria-hidden />
              <Icon className={cn('mt-0.5 h-[18px] w-[18px] shrink-0', color)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
                {toast.message && <p className="mt-0.5 text-[13px] leading-relaxed text-slate-600">{toast.message}</p>}
              </div>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                aria-label="Dismiss notification"
                className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
