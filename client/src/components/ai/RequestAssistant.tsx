import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Info, Sparkles, Users } from 'lucide-react';
import { aiApi } from '../../api/endpoints';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Textarea } from '../ui/Form';
import { Badge } from '../ui/Badge';
import { PriorityBadge, SpecializationBadge } from '../common/Badges';
import { cn } from '../ui/cn';
import type { AssistantDraft, AssistantResponse } from '../../types';

const EXAMPLES = ['The fan stopped and the tube light flickers', 'Floor 8 water cooler is giving warm water', 'bathroom tap leaking since morning, dustbin also full'];

interface RequestAssistantProps {
  /** Called with the draft the student picks; the form shows it for review. */
  onUse: (draft: AssistantDraft) => void;
  /** A one-line version for the student home page. */
  compact?: boolean;
}

/**
 * "Tell us what's wrong": the student describes the problem in their own
 * words and gets ticket drafts back. A draft only fills the form - the
 * student checks it and submits it themselves. Priority comes from the issue
 * type, never from the assistant.
 */
export const RequestAssistant: React.FC<RequestAssistantProps> = ({ onUse, compact }) => {
  const [text, setText] = useState('');
  const [result, setResult] = useState<AssistantResponse | null>(null);
  const draft = useMutation({ mutationFn: (t: string) => aiApi.draftTickets(t), onSuccess: setResult });

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (text.trim().length >= 3) draft.mutate(text.trim());
  };

  return (
    <Card className={cn('border-brand-200 bg-gradient-to-b from-brand-50/60 to-white', compact ? 'p-4' : 'p-5')}>
      <form onSubmit={submit} className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white" aria-hidden>
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Tell us what is wrong</h2>
            <p className="text-[13px] text-slate-600">Describe it in your own words, in any language. We will fill in the request for you to check.</p>
          </div>
        </div>
        <label htmlFor="assistant-text" className="sr-only">
          Describe the problem
        </label>
        <Textarea
          id="assistant-text"
          rows={compact ? 2 : 3}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
          }}
          placeholder={`e.g. "${EXAMPLES[0]}"`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {!compact &&
              EXAMPLES.slice(1).map((ex) => (
                <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-slate-300">
                  {ex}
                </button>
              ))}
          </div>
          <Button type="submit" size="sm" loading={draft.isPending} disabled={text.trim().length < 3}>
            Draft my request
          </Button>
        </div>
      </form>

      {draft.isError && <p className="mt-3 text-[13px] text-rose-700">{(draft.error as Error).message}</p>}

      {result && (
        <div className="mt-4 space-y-3" aria-live="polite">
          {result.notice && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {result.notice}
            </p>
          )}
          {result.drafts.length === 0 && result.clarification && <p className="text-[13px] text-slate-700">{result.clarification}</p>}
          {result.drafts.map((d, i) => (
            <DraftCard key={`${d.subcategory_id}-${i}`} draft={d} onUse={() => onUse(d)} />
          ))}
        </div>
      )}
    </Card>
  );
};

const DraftCard: React.FC<{ draft: AssistantDraft; onUse: () => void }> = ({ draft, onUse }) => {
  const where = draft.ticket_scope === 'ROOM' ? (draft.room_id ? `Room ${draft.room_id}` : 'Your room') : draft.common_area_name || 'A shared area (choose which)';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{draft.issue_name}</p>
          <p className="text-xs text-slate-500">
            {draft.category_name} · {where}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <SpecializationBadge specialization={draft.required_specialization} />
          <span title="Set by the issue type">
            <PriorityBadge priority={draft.priority} />
          </span>
        </div>
      </div>
      {draft.description && <p className="mt-2 text-[13px] text-slate-700">{draft.description}</p>}

      {draft.safety_advice && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <strong>Stay safe: </strong>
            {draft.safety_advice}
          </span>
        </p>
      )}
      {draft.review_hint && <p className="mt-2 text-[13px] text-amber-800">{draft.review_hint}</p>}
      {draft.existing_ticket && (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-slate-700">
          <Users className="h-4 w-4 text-slate-500" aria-hidden />
          Already reported here. Sending it adds you to the existing ticket.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {draft.needs.includes('ROOM_ALLOTMENT') && <Badge tone="warning">Needs a room allotment</Badge>}
          {draft.needs.includes('CHOOSE_AREA') && <Badge tone="info">Choose the exact place</Badge>}
        </div>
        <Button size="sm" variant="secondary" onClick={onUse} disabled={draft.needs.includes('ROOM_ALLOTMENT')}>
          Review and send
        </Button>
      </div>
    </div>
  );
};
