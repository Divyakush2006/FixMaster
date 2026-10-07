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
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full p-6 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-4">
          <div className="inline-flex p-3 rounded-2xl bg-rose-500/15 text-rose-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-extrabold text-slate-100">Something went wrong on this screen</h2>
          <p className="text-xs text-slate-400">
            Your data is safe. Reloading usually fixes this - especially right after an update.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs inline-flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reload</span>
          </button>
        </div>
      </div>
    );
  }
}
