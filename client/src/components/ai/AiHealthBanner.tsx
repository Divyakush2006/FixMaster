import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, WifiOff, Bot, RefreshCw, ArrowRight } from 'lucide-react';
import { aiApi } from '../../api/endpoints';
import type { AiHealthStatus } from '../../types';

const STATUS_CONFIG = {
  HEALTHY: null, // Don't render anything when healthy
  DEGRADED: {
    icon: AlertTriangle,
    bg: 'bg-amber-50 border-amber-200',
    iconColor: 'text-amber-600',
    titleColor: 'text-amber-900',
    textColor: 'text-amber-800',
    title: 'AI Service Degraded',
    actionLabel: 'Some tickets may need manual triage and allocation.',
    ctaText: 'Review Open Tickets',
  },
  DOWN: {
    icon: WifiOff,
    bg: 'bg-red-50 border-red-200',
    iconColor: 'text-red-600',
    titleColor: 'text-red-900',
    textColor: 'text-red-800',
    title: 'AI Service is Down — Manual Allocation Mode Active',
    actionLabel: 'All tickets are using fallback rules. Supervisors must manually allocate technicians.',
    ctaText: 'Start Manual Allocation',
  },
  DISABLED: {
    icon: Bot,
    bg: 'bg-slate-50 border-slate-200',
    iconColor: 'text-slate-500',
    titleColor: 'text-slate-800',
    textColor: 'text-slate-600',
    title: 'AI Service Not Configured',
    actionLabel: 'Gemini API key is not set. All processing uses rule-based heuristics.',
    ctaText: 'View Open Tickets',
  },
} as const;

/**
 * Polls /api/ai/health every 20s and shows a banner on supervisor
 * views when AI is degraded, down, or disabled.
 */
export const AiHealthBanner: React.FC = () => {
  const { data: health, isLoading, refetch } = useQuery<AiHealthStatus>({
    queryKey: ['ai-health'],
    queryFn: async () => {
      try {
        return await aiApi.getHealth();
      } catch (err: any) {
        // If the endpoint itself failed with payload, parse data/body
        const payload = err?.data || err?.body;
        if (payload && payload.status) return payload as AiHealthStatus;
        // Network error → treat as DOWN
        return {
          status: 'DOWN' as const,
          gemini_enabled: false,
          recent_calls: 0,
          fallback_count: 0,
          fallback_rate: 1,
          last_fallback_at: null,
          last_success_at: null,
          message: 'Unable to reach AI health endpoint. Automatic allocation is suspended.',
        };
      }
    },
    refetchInterval: 20_000, // Poll every 20 seconds
    staleTime: 15_000,
    retry: 1,
  });

  if (isLoading || !health) return null;

  const config = STATUS_CONFIG[health.status];
  if (!config) return null; // HEALTHY — no banner

  const Icon = config.icon;
  const ago = health.last_fallback_at
    ? `Last fallback: ${new Date(health.last_fallback_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
    : null;

  return (
    <div className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${config.bg}`} role="alert">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${config.iconColor}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${config.titleColor}`}>{config.title}</p>
          <p className={`mt-0.5 text-[13px] leading-relaxed ${config.textColor}`}>
            {health.message}
          </p>
          <div className={`mt-1 flex flex-wrap items-center gap-3 text-xs ${config.textColor}`}>
            {health.recent_calls > 0 && (
              <span>
                Fallback rate: <strong>{Math.round(health.fallback_rate * 100)}%</strong> ({health.fallback_count}/{health.recent_calls} recent calls)
              </span>
            )}
            {ago && <span>· {ago}</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center">
        <Link
          to="/supervisor/all-complaints?status=OPEN"
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition ${
            health.status === 'DOWN'
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50'
          }`}
        >
          {config.ctaText}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <button
          onClick={() => refetch()}
          className={`flex-shrink-0 rounded-md p-1.5 transition hover:bg-black/5 ${config.iconColor}`}
          title="Refresh AI status"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
