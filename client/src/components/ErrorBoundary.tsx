import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors in a page so one broken screen shows a recovery
 * panel instead of unmounting the whole app to a blank page. Also catches a
 * failed lazy chunk load (e.g. after a redeploy replaced the old bundle),
 * which a reload fixes.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold text-slate-900">This page couldn't be displayed</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
            Your data is safe. Reloading usually fixes this, especially right after an update.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            <RotateCcw className="h-4 w-4" />
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
