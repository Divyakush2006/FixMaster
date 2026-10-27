import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { aiApi } from '../../api/endpoints';
import type { AiHealthStatus } from '../../types';
import { Alert } from '../ui/Alert';
import { ButtonLink } from '../ui/Button';

/** Shared by the banner and the top bar: one poll for everyone on the page. */
export const useAiHealth = (enabled = true) =>
  useQuery({ queryKey: ['ai-health'], queryFn: aiApi.getHealth, enabled, refetchInterval: 60_000, staleTime: 30_000, retry: 1 });

/** Which providers are struggling and why, in a sentence: "Gemini timed out · Groq is covering." */
export function aiTrouble(health: AiHealthStatus): string {
  const NAME: Record<string, string> = { groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter' };
  const name = (p: string) => NAME[p] ?? p;
  const struggling = health.providers.filter(
    (p) => p.configured && (p.breaker_open || p.used_today >= p.daily_limit || ((p.keys_total ?? 0) > 0 && (p.keys_available ?? 0) === 0) || (p.failed_last_hour >= 3 && p.failed_last_hour > p.ok_last_hour))
  );
  const covering = health.providers.filter((p) => p.configured && !struggling.includes(p) && p.ok_last_hour > 0);
  if (struggling.length === 0) return 'Some AI providers are unavailable; others are covering.';
  const why = (p: (typeof struggling)[number]) =>
    p.breaker_open ? 'is paused after repeated errors' : p.used_today >= p.daily_limit ? 'has used today’s allowance' : (p.keys_total ?? 0) > 0 && (p.keys_available ?? 0) === 0 ? 'has hit its rate limit' : `kept failing (${(p.last_error || 'errors').replace(/\.$/, '')})`;
  return `${struggling.map((p) => `${name(p.provider)} ${why(p)}`).join('; ')}.${covering.length ? ` ${covering.map((p) => name(p.provider)).join(' and ')} ${covering.length === 1 ? 'is' : 'are'} covering.` : ''}`;
}

/**
 * Tells supervisors when AI help is reduced, and what still works: drafts
 * fall back to the keyword matcher and the autopilot to suggestions, so
 * nothing stops - but more needs a human look. Silent when AI is healthy or
 * simply not configured (a normal, supported setup).
 */
export const AiHealthBanner: React.FC = () => {
  const { data: health } = useAiHealth();
  if (!health || health.status === 'HEALTHY' || health.status === 'DISABLED') return null;

  if (health.drill) {
    return (
      <Alert tone="warning" title="AI outage drill in progress" action={<ButtonLink to="/supervisor/all-complaints?status=OPEN" size="sm" variant="secondary">Open tickets</ButtonLink>}>
        {health.drill.reason || 'AI features are switched off for practice.'} Dispatch every ticket by hand until the drill ends.
      </Alert>
    );
  }

  const down = health.status === 'DOWN';
  return (
    <Alert
      tone={down ? 'danger' : 'warning'}
      title={
        <span className="inline-flex items-center gap-2">
          {down ? <WifiOff className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
          {down ? 'AI help is unavailable' : 'AI help is partly unavailable'}
        </span>
      }
      action={
        <ButtonLink to="/supervisor/all-complaints?status=OPEN" size="sm" variant={down ? 'danger' : 'secondary'}>
          Review open tickets
        </ButtonLink>
      }
    >
      {down
        ? 'Students’ drafts use the keyword matcher and the autopilot only suggests. Check new tickets’ issue types and dispatch them yourself.'
        : `${aiTrouble(health)} Keep an eye on new tickets.`}
    </Alert>
  );
};
