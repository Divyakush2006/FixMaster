import React from 'react';
import { Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { WORKSPACE_NAME } from './navigation';
import { UserMenu } from './UserMenu';

export const Topbar: React.FC<{ onOpenNav: () => void }> = ({ onOpenNav }) => {
  const { user } = useAuth();
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
        <UserMenu />
      </div>
    </header>
  );
};
