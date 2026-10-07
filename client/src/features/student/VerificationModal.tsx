import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star, ThumbsUp, ThumbsDown } from 'lucide-react';
import { feedbackApi } from '../../api/endpoints';
import { useToast } from '../../components/ui/Toast';
import { Modal } from '../../components/ui/Modal';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Textarea } from '../../components/ui/Form';
import { cn } from '../../components/ui/cn';

interface VerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  complaintId: string;
  issueName: string;
  locationIdentifier?: string;
}

const RATING_TEXT = ['', 'Very poor', 'Poor', 'Satisfactory', 'Good', 'Excellent'];

/** The student's sign-off: confirm and rate the work, or escalate it. */
export const VerificationModal: React.FC<VerificationModalProps> = ({ isOpen, onClose, complaintId, issueName, locationIdentifier }) => {
  const [isSatisfied, setIsSatisfied] = useState<boolean | null>(null);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [comments, setComments] = useState('');

  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const mutation = useMutation({
    mutationFn: feedbackApi.submit,
    onSuccess: (data) => {
      showToast(
        isSatisfied ? 'Ticket closed' : 'Ticket escalated',
        isSatisfied ? 'success' : 'info',
        data.message || (isSatisfied ? 'Thank you for confirming the work.' : 'A supervisor will review it.')
      );
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      onClose();
    },
    onError: (err: Error) => showToast('Could not submit your response', 'error', err.message),
  });

  const submit = () => {
    if (isSatisfied === null) return;
    mutation.mutate({
      complaint_id: complaintId,
      is_satisfied: isSatisfied,
      rating: isSatisfied ? rating : null,
      comments: comments.trim() || null,
    });
  };

  const choice = (value: boolean, Icon: React.ElementType, title: string, text: string) => {
    const active = isSatisfied === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => setIsSatisfied(value)}
        className={cn(
          'flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors',
          active
            ? value
              ? 'border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500'
              : 'border-rose-500 bg-rose-50/60 ring-1 ring-rose-500'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        )}
      >
        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? (value ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-400')} />
        <span>
          <span className="block text-[13px] font-semibold text-slate-900">{title}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{text}</span>
        </span>
      </button>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Confirm the work"
      subtitle={`${issueName}${locationIdentifier ? ` · ${locationIdentifier}` : ''}`}
      maxWidth="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isSatisfied === false ? 'danger' : 'primary'}
            disabled={isSatisfied === null}
            loading={mutation.isPending}
            onClick={submit}
          >
            {isSatisfied === false ? 'Escalate ticket' : 'Confirm and close'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[13px] font-medium text-slate-700">Has the problem been fixed?</p>
          <div role="radiogroup" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {choice(true, ThumbsUp, 'Yes, it is fixed', 'The ticket will be closed.')}
            {choice(false, ThumbsDown, 'No, it is not fixed', 'A supervisor will re-inspect it.')}
          </div>
        </div>

        {isSatisfied === true && (
          <div className="rounded-lg border border-slate-200 px-4 py-3.5">
            <p className="text-[13px] font-medium text-slate-700">Rate the service</p>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex" onMouseLeave={() => setHoverRating(0)}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    aria-label={`${star} star${star > 1 ? 's' : ''}`}
                    aria-pressed={star === rating}
                    onMouseEnter={() => setHoverRating(star)}
                    onClick={() => setRating(star)}
                    className="p-0.5"
                  >
                    <Star
                      className={cn('h-6 w-6 transition-colors', star <= (hoverRating || rating) ? 'fill-amber-400 text-amber-400' : 'fill-slate-100 text-slate-300')}
                    />
                  </button>
                ))}
              </div>
              <span className="text-[13px] text-slate-600">{RATING_TEXT[hoverRating || rating]}</span>
            </div>
          </div>
        )}

        {isSatisfied === false && (
          <Alert tone="warning">The ticket returns to the supervisor's escalation queue for priority re-inspection.</Alert>
        )}

        <Field label="Comments" aside="Optional">
          {(a) => (
            <Textarea
              {...a}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder={isSatisfied === false ? 'Describe what is still wrong' : 'Anything you would like to add'}
              rows={3}
              maxLength={500}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
};
