import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, WifiOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAiHealth } from '../ai/AiHealthBanner';
import { WORKSPACE_NAME } from './navigation';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';
import { isManager } from '../../utils/roles';

export const Topbar: React.FC<{ onOpenNav: () => void }> = ({ onOpenNav }) => {
  const { user } = useAuth();
  // Hooks run before any early return (rules of hooks).
  const isSupervisorOrAdmin = isManager(user?.role);
  const { data: health } = useAiHealth(isSupervisorOrAdmin);
  if (!user) return null;

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="-ml-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="truncate text-sm font-semibold text-slate-900">{WORKSPACE_NAME[user.role]}</span>
        {import.meta.env.DEV && (
          <span className="hidden rounded border border-amber-300 bg-amber-50 px-1.5 py-px text-2xs font-semibold uppercase tracking-wide text-amber-800 sm:inline">
            Development
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {isSupervisorOrAdmin && health && (
          <>
            {health.status === 'DOWN' ? (
              <Link
                to="/supervisor/all-complaints?status=OPEN"
                className="flex items-center gap-1.5 rounded-full bg-red-100 border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-800 hover:bg-red-200 transition"
                title="AI help is unavailable. Open tickets need dispatching by hand."
              >
                <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
                <WifiOff className="h-3 w-3 text-red-600" />
                <span className="hidden sm:inline">AI off · dispatch by hand</span>
                <span className="sm:hidden">AI off</span>
              </Link>
            ) : health.status === 'DEGRADED' ? (
              <Link
                to="/supervisor/all-complaints?status=OPEN"
                className="flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200 transition"
                title="Some AI providers are unavailable; others are covering."
              >
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="hidden sm:inline">AI partly off</span>
              </Link>
            ) : health.status === 'HEALTHY' ? (
              <span className="hidden md:flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-2xs font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                AI assist on
              </span>
            ) : null}
          </>
        )}
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
};
