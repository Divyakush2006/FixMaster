import React from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { complaintsApi } from '../../api/endpoints';
import { navigationFor } from './navigation';
import { BrandMark } from './BrandMark';
import { cn } from '../ui/cn';
import { X } from 'lucide-react';

interface SidebarProps {
  /** Mobile drawer state; on desktop the sidebar is always visible. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen, onCloseMobile }) => {
  const { user } = useAuth();
  const canSeeEscalations = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';

  // Same query (and cache entry) as the Escalations page.
  const { data: escalated = [] } = useQuery({
    queryKey: ['complaints', 'ESCALATED'],
    queryFn: () => complaintsApi.list({ status: 'ESCALATED' }),
    enabled: canSeeEscalations,
    staleTime: 60_000,
  });

  if (!user) return null;
  const sections = navigationFor(user.role);

  const content = (
    <div className="flex h-full flex-col bg-navy-900 text-white">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <BrandMark tone="light" />
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white md:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {sections.map((section) => (
          <div key={section.heading}>
            <p className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-[0.1em] text-white/40">{section.heading}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const count = item.badge === 'escalations' ? escalated.length : 0;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onCloseMobile}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
                          isActive ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white'
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-400" aria-hidden />}
                          <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand-300' : 'text-white/50 group-hover:text-white/80')} aria-hidden />
                          <span className="flex-1 truncate">{item.label}</span>
                          {count > 0 && (
                            <span className="rounded-full bg-rose-500 px-1.5 py-px text-2xs font-semibold text-white tabular" aria-label={`${count} escalated`}>
                              {count}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-5 py-4">
        <p className="text-xs font-medium text-white/70">VIT Vellore</p>
        <p className="text-2xs text-white/40">Hostel Estates Office</p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 md:block">{content}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-900/50 animate-fade-in" onClick={onCloseMobile} />
          <aside className="relative h-full w-72 max-w-[85vw] animate-slide-in-left shadow-overlay">{content}</aside>
        </div>
      )}
    </>
  );
};
