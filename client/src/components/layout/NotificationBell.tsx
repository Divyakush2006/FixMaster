import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { notificationsApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { AppNotification, Role } from '../../types';
import { formatRelativeTime } from '../../utils/formatters';
import { cn } from '../ui/cn';

const POLL_MS = 30_000;

/** Where a notification leads, by role. */
function destination(role: Role, n: AppNotification): string {
  if (role === 'STUDENT') return n.complaint_id ? `/student/complaints?id=${n.complaint_id}` : '/student/complaints';
  if (role === 'STAFF') return '/staff';
  if (role === 'ADMIN') return '/admin/dashboard';
  return n.kind.endsWith('escalated') ? '/supervisor/escalated' : '/supervisor/all-complaints';
}

/**
 * The bell: unread count (polled), and a dropdown with the latest messages.
 * Messages are written by the database in the same transaction as the change
 * they describe, so the bell never shows something that was rolled back.
 */
export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: count } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    enabled: !!user,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.list(),
    enabled: !!user && open,
  });
  const unread = count?.unread ?? 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: notificationsApi.markRead, onSuccess: refresh });
  const markAll = useMutation({ mutationFn: notificationsApi.markAllRead, onSuccess: refresh });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const openItem = (n: AppNotification) => {
    if (!n.read_at) markRead.mutate(n.notification_id);
    setOpen(false);
    navigate(destination(user.role, n));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-overlay animate-scale-in"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            <button
              type="button"
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
              className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              Mark all read
            </button>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-8 text-center text-[13px] text-slate-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-slate-500">You are all caught up.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((n) => (
                  <li key={n.notification_id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.read_at && 'bg-brand-50/50')}
                    >
                      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[13px] text-slate-900', !n.read_at && 'font-semibold')}>{n.title}</span>
                        {n.body && <span className="mt-0.5 block text-xs text-slate-600">{n.body}</span>}
                        <span className="mt-1 block text-2xs text-slate-500">{formatRelativeTime(n.created_at)}</span>
                        {!n.read_at && <span className="sr-only"> (unread)</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
