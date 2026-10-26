import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, WifiOff } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { aiApi } from '../../api/endpoints';
import { WORKSPACE_NAME } from './navigation';
import { NotificationBell } from './NotificationBell';
import { UserMenu } from './UserMenu';
import type { AiHealthStatus } from '../../types';
import { isManager } from '../../utils/roles';

export const Topbar: React.FC<{ onOpenNav: () => void }> = ({ onOpenNav }) => {
  const { user } = useAuth();
  if (!user) return null;

  const isSupervisorOrAdmin = isManager(user.role);

  const { data: health } = useQuery<AiHealthStatus>({
    queryKey: ['ai-health'],
    queryFn: async () => {
      try {
        return await aiApi.getHealth();
      } catch (err: any) {
        const payload = err?.data || err?.body;
        if (payload?.status) return payload;
        return { status: 'DOWN', message: 'Offline' } as any;
      }
    },
    enabled: isSupervisorOrAdmin,
    refetchInterval: 20_000,
    staleTime: 15_000,
  });

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
                title="AI Service is DOWN. Click to manually allocate open tickets."
              >
                <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
                <WifiOff className="h-3 w-3 text-red-600" />
                <span className="hidden sm:inline">AI Down · Manual Dispatch</span>
                <span className="sm:hidden">AI Down</span>
              </Link>
            ) : health.status === 'DEGRADED' ? (
              <Link
                to="/supervisor/all-complaints?status=OPEN"
                className="flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200 transition"
                title="AI Service is degraded."
              >
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="hidden sm:inline">AI Degraded</span>
              </Link>
            ) : health.status === 'HEALTHY' ? (
              <span className="hidden md:flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-2xs font-medium text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                AI Dispatch Active
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
