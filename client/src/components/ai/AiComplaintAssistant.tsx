import React, { useState } from 'react';
import { Sparkles, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '../ui/Button';
import { useAiAutoFill } from './useAiAutoFill';
import { AiTriageResult, AiAllocationPreview } from '../../types';

interface Props {
  studentRoom?: string | null;
  onApply: (triage: AiTriageResult, preview: AiAllocationPreview | null) => void;
  compact?: boolean;
}

export const AiComplaintAssistant: React.FC<Props> = ({ studentRoom, onApply, compact }) => {
  const [inputText, setInputText] = useState('');

  const { autoFillFromText, loading, error } = useAiAutoFill({
    onSuccess: (triage, preview) => {
      onApply(triage, preview);
    },
  });

  const handleTrigger = () => {
    if (!inputText.trim() || loading) return;
    autoFillFromText(inputText, studentRoom);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleTrigger();
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/70 via-white to-purple-50/40 p-4 shadow-sm transition-all sm:p-5">
      <div className="flex items-center gap-2">
        <div className="rounded-lg bg-indigo-600 p-1.5 text-white shadow-sm shadow-indigo-200">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            FixMaster AI Express Assistant
          </h3>
          <p className="text-xs text-slate-500">
            Describe your problem in plain words — Gemini AI will categorize, prioritize, and auto-fill the form instantly.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <textarea
          rows={compact ? 2 : 3}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g., Switchboard in room 843 is sparking when I plug in my charger, please help!"
          disabled={loading}
          className="w-full resize-none rounded-xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-800 placeholder-slate-400 backdrop-blur transition-all focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
        />

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-400">
            Press <kbd className="rounded border bg-slate-100 px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to analyze
          </span>

          <Button
            type="button"
            onClick={handleTrigger}
            disabled={!inputText.trim() || loading}
            size="sm"
            className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing with Gemini...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Auto-Fill Ticket
                <ArrowRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>

        {error && (
          <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700 border border-amber-200">
            {error} (You can also fill the fields manually below).
          </p>
        )}
      </div>
    </div>
  );
};
