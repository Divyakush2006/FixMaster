import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { WifiOff, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../ui/Toast';
import { aiApi } from '../../api/endpoints';
import type { AiHealthStatus } from '../../types';
import { isManager } from '../../utils/roles';

export const SupervisorAiNotificationBanner: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const prevStatusRef = useRef<string | null>(null);

  const isSupervisorOrAdmin = isManager(user?.role);

  const { data: health } = useQuery<AiHealthStatus>({
    queryKey: ['ai-health'],
    queryFn: async () => {
      try {
        return await aiApi.getHealth();
      } catch (err: any) {
        const payload = err?.data || err?.body;
        if (payload?.status) return payload;
        return { status: 'DOWN', message: 'AI Service unreachable' } as any;
      }
    },
    enabled: isSupervisorOrAdmin,
    refetchInterval: 20_000,
    staleTime: 15_000,
  });

  // Alert with toast when status transitions to DOWN
  useEffect(() => {
    if (!isSupervisorOrAdmin || !health) return;

    if (health.status === 'DOWN' && prevStatusRef.current !== 'DOWN') {
      showToast(
        'AI Service is DOWN',
        'error',
        'Automatic technician allocation is offline. Please begin manual allocation for incoming tickets.'
      );
    }
    prevStatusRef.current = health.status;
  }, [health?.status, isSupervisorOrAdmin, showToast]);

  if (!isSupervisorOrAdmin || health?.status !== 'DOWN') {
    return null;
  }

  return (
    <div
      role="alert"
      className="sticky top-14 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-red-700 bg-red-600 px-4 py-2.5 text-xs text-white shadow-sm sm:px-6 sm:text-sm"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-700/80">
          <WifiOff className="h-3.5 w-3.5 text-white animate-pulse" />
        </span>
        <p className="leading-tight">
          <strong className="font-semibold">AI Service Offline:</strong> Automatic allocation is down. Supervisors must manually dispatch technicians for open tickets.
        </p>
      </div>

      <Link
        to="/supervisor/all-complaints?status=OPEN"
        className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50 hover:text-red-800"
      >
        Start Manual Allocation
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
};
