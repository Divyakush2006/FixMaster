import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { notificationsApi } from '../../api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { AppNotification, Role } from '../../types';
import { formatRelativeTime } from '../../utils/formatters';
import { cn } from '../ui/cn';

const POLL_MS = 30_000;

/** The moment this user last opened the bell on this device (null = never). */
const seenKey = (userId: string) => `fixmaster:notifications-seen:${userId}`;
function readSeen(userId: string): number | null {
  try {
    const raw = window.localStorage.getItem(seenKey(userId));
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
function writeSeen(userId: string, at: number) {
  try {
    window.localStorage.setItem(seenKey(userId), String(at));
  } catch {
    /* storage unavailable: unread simply resets next visit */
  }
}

/** Where a notification leads, by role. */
function destination(role: Role, n: AppNotification): string {
  if (role === 'STUDENT') return n.complaint_id ? `/student/complaints?id=${n.complaint_id}` : '/student/complaints';
  if (role === 'STAFF') return '/staff';
  if (role === 'ADMIN') return '/supervisor/all-complaints';
  return n.kind === 'ticket.escalated' ? '/supervisor/escalated' : n.kind === 'ticket.overdue' ? '/supervisor/all-complaints?sla=OVERDUE' : '/supervisor/all-complaints';
}

/**
 * The bell. Messages are derived by the server from the ticket history, so
 * there is no stored read state: "unread" means newer than the last time this
 * browser opened the bell, and is therefore per device.
 */
export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<number | null>(() => (user ? readSeen(user.user_id) : null));
  const ref = useRef<HTMLDivElement>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['notifications', user?.user_id],
    queryFn: () => notificationsApi.list(),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    enabled: !!user,
  });

  // A first-ever visit starts from "now", so the whole backlog is not "new".
  useEffect(() => {
    if (user && seen === null) {
      const now = Date.now();
      writeSeen(user.user_id, now);
      setSeen(now);
    }
  }, [user, seen]);

  const isUnread = (n: AppNotification) => seen !== null && new Date(n.created_at).getTime() > seen;
  const unread = items.filter(isUnread).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items]);

  if (!user) return null;

  // Closing the bell marks everything shown as seen.
  function close() {
    setOpen(false);
    if (user) {
      const now = Date.now();
      writeSeen(user.user_id, now);
      setSeen(now);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
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
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            <p className="text-xs text-slate-500">Activity from the last 14 days</p>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-8 text-center text-[13px] text-slate-500">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-slate-500">You are all caught up.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((n) => {
                  const fresh = isUnread(n);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          navigate(destination(user.role, n));
                        }}
                        className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50', fresh && 'bg-brand-50/50')}
                      >
                        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', fresh ? 'bg-brand-600' : 'bg-transparent')} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-[13px] text-slate-900', fresh && 'font-semibold')}>{n.title}</span>
                          {n.body && <span className="mt-0.5 block text-xs text-slate-600">{n.body}</span>}
                          <span className="mt-1 block text-2xs text-slate-500">{formatRelativeTime(n.created_at)}</span>
                          {fresh && <span className="sr-only"> (new)</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
