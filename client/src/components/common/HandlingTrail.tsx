import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckCircle2, Clock3, MinusCircle, ShieldCheck, Sparkles, UserCog, type LucideIcon } from 'lucide-react';
import { complaintsApi } from '../../api/endpoints';
import type { HandlingActor, HandlingOutcome, HandlingStage, HandlingStep, HandlingTrail as Trail } from '../../types';
import { formatDateTime } from '../../utils/formatters';
import { Badge, type Tone } from '../ui/Badge';
import { Skeleton } from '../ui/PageLoader';
import { cn } from '../ui/cn';

const PROVIDER_NAME: Record<string, string> = { groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter', ollama: 'Ollama', local: 'Local model', fake: 'Test model' };

/** "Groq · qwen3.8-27b": the model that acknowledged the ticket. */
export function modelLabel(step: Pick<HandlingStep, 'provider' | 'model'>): string | null {
  if (!step.provider) return null;
  const name = PROVIDER_NAME[step.provider] ?? step.provider;
  // Model ids look like "openai/gpt-oss-20b": the part after the slash is the name people know.
  const model = step.model ? step.model.split('/').pop() : null;
  return model ? `${name} · ${model}` : name;
}

/** Who did it, in words: the AI model by name, the safety rules, the autopilot, a supervisor. */
function actorOf(step: HandlingStep): { label: string; icon: LucideIcon; tone: Tone } {
  switch (step.actor as HandlingActor) {
    case 'AI':
      return { label: modelLabel(step) ?? 'AI assistant', icon: Sparkles, tone: 'violet' };
    case 'AUTOPILOT':
      return { label: 'Dispatch autopilot', icon: Bot, tone: 'brand' };
    case 'SUPERVISOR':
      return { label: 'Supervisor', icon: UserCog, tone: 'info' };
    default:
      return step.stage === 'AI_REVIEW' ? { label: 'Safety rules', icon: ShieldCheck, tone: 'neutral' } : { label: 'FixMaster', icon: CheckCircle2, tone: 'neutral' };
  }
}

const OUTCOME: Record<HandlingOutcome, { icon: LucideIcon; className: string; label: string }> = {
  DONE: { icon: CheckCircle2, className: 'text-emerald-600', label: 'Done' },
  WAITING: { icon: Clock3, className: 'text-amber-600', label: 'Waiting' },
  SKIPPED: { icon: MinusCircle, className: 'text-slate-400', label: 'Not needed' },
  FAILED: { icon: AlertTriangle, className: 'text-rose-600', label: 'Needs attention' },
};

const PENDING_TEXT: Partial<Record<HandlingStage, string>> = { AI_REVIEW: 'The AI assistant is reading your request…' };

/** What a manager may also read: the model's own answer and the autopilot's score. */
function managerNote(step: HandlingStep): string | null {
  const d = step.data;
  if (!d) return null;
  const parts: string[] = [];
  if (step.stage === 'AI_REVIEW' && d.ai === 'OK') {
    parts.push(`urgency ${String(d.urgency ?? '').toLowerCase()}`);
    if (typeof d.confidence === 'number') parts.push(`confidence ${Math.round(d.confidence * 100)}%`);
    if (d.safety_risk === true) parts.push('safety risk');
    if (typeof d.technician_note === 'string' && d.technician_note) parts.push(`for the technician: ${d.technician_note}`);
  }
  if (step.stage === 'AI_REVIEW' && Array.isArray(d.danger_words) && d.danger_words.length > 0) parts.push(`danger words: ${d.danger_words.join(', ')}`);
  if (step.stage === 'DISPATCH' && typeof d.score === 'number') parts.push(`score ${d.score} of ${String(d.considered ?? '?')} considered`);
  return parts.length ? parts.join(' · ') : null;
}

interface ViewProps {
  trail: Trail | undefined;
  loading?: boolean;
  manager?: boolean;
}

/** The trail as a list: who acknowledged the ticket, what they decided, and what is still waiting. */
export const HandlingTrailView: React.FC<ViewProps> = ({ trail, loading, manager }) => {
  if (loading && !trail) return <Skeleton className="h-24" />;
  if (!trail || (trail.steps.length === 0 && trail.pending.length === 0)) {
    return <p className="text-[13px] text-slate-500">No automatic handling was recorded for this ticket.</p>;
  }
  return (
    <ol className="space-y-2.5" aria-label="How this request was handled">
      {trail.steps.map((step) => {
        const who = actorOf(step);
        const out = OUTCOME[step.outcome];
        const OutcomeIcon = out.icon;
        const note = manager ? managerNote(step) : null;
        return (
          <li key={step.step_id} className="flex gap-3 rounded-md border border-slate-200 px-3.5 py-3">
            <OutcomeIcon className={cn('mt-0.5 h-4 w-4 shrink-0', out.className)} aria-label={out.label} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-[13px] font-medium text-slate-900">{step.title}</p>
                <time className="text-xs text-slate-500 tabular">{formatDateTime(step.created_at)}</time>
              </div>
              {step.detail && <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{step.detail}</p>}
              {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
              <div className="mt-1.5">
                <Badge tone={who.tone} icon={<who.icon className="h-3 w-3" aria-hidden />}>
                  {who.label}
                </Badge>
              </div>
            </div>
          </li>
        );
      })}
      {trail.pending.map((stage) => (
        <li key={stage} className="flex items-center gap-3 rounded-md border border-dashed border-slate-300 px-3.5 py-3 text-xs text-slate-600" aria-live="polite">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" aria-hidden />
          {PENDING_TEXT[stage] ?? 'In progress…'}
        </li>
      ))}
    </ol>
  );
};

/** Loads and shows the trail of one ticket; refreshes while a step is still on its way. */
export const HandlingTrailPanel: React.FC<{ complaintId: string; manager?: boolean; enabled?: boolean }> = ({ complaintId, manager, enabled = true }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['complaint-handling', complaintId],
    queryFn: () => complaintsApi.getHandling(complaintId),
    enabled,
    // The AI review lands a second or two after the ticket is raised.
    refetchInterval: (q) => (q.state.data && q.state.data.pending.length > 0 ? 2000 : false),
  });
  return <HandlingTrailView trail={data} loading={isLoading} manager={manager} />;
};

/** One sentence for the confirmation toast: the first thing that acknowledged the ticket and what is next. */
export function acknowledgement(trail: Trail | undefined): string | null {
  if (!trail) return null;
  const review = trail.steps.find((s) => s.stage === 'AI_REVIEW');
  const dispatch = [...trail.steps].reverse().find((s) => s.stage === 'DISPATCH');
  const parts: string[] = [];
  if (review) parts.push(review.actor === 'AI' ? `Read by ${modelLabel(review)}` : 'Checked by safety rules');
  else if (trail.pending.includes('AI_REVIEW')) parts.push('AI review in progress');
  if (dispatch) parts.push(dispatch.title);
  return parts.length ? parts.join(' · ') : null;
}
