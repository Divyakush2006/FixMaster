import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HandlingTrailView, acknowledgement, modelLabel } from './HandlingTrail';
import type { HandlingTrail, HandlingStep } from '../../types';

const step = (over: Partial<HandlingStep>): HandlingStep => ({
  step_id: '1',
  stage: 'RECEIVED',
  actor: 'SYSTEM',
  outcome: 'DONE',
  title: 'Request received',
  detail: null,
  provider: null,
  model: null,
  created_at: '2026-10-27T10:00:00Z',
  ...over,
});

const trail: HandlingTrail = {
  pending: [],
  steps: [
    step({}),
    step({ step_id: '2', stage: 'AI_REVIEW', actor: 'AI', title: 'Reviewed by AI: priority raised to High', detail: 'Sparks could shock someone.', provider: 'groq', model: 'openai/gpt-oss-20b', data: { ai: 'OK', urgency: 'URGENT', confidence: 0.93, safety_risk: true } }),
    step({ step_id: '3', stage: 'DISPATCH', actor: 'AUTOPILOT', outcome: 'WAITING', title: 'Waiting for a technician to become free', detail: 'No one of the 5 electricians can take it right now: 4 off duty, 1 on leave.', data: { score: 71, considered: 3 } }),
  ],
};

describe('HandlingTrailView', () => {
  it('names the AI model that acknowledged the ticket, and who else acted', () => {
    render(<HandlingTrailView trail={trail} />);
    expect(screen.getByText('Groq · gpt-oss-20b')).toBeTruthy();
    expect(screen.getByText('Dispatch autopilot')).toBeTruthy();
    expect(screen.getByText(/4 off duty, 1 on leave/)).toBeTruthy();
  });

  it('keeps scores and the raw urgency for managers', () => {
    const { rerender } = render(<HandlingTrailView trail={trail} />);
    expect(screen.queryByText(/confidence 93%/)).toBeNull();
    rerender(<HandlingTrailView trail={trail} manager />);
    expect(screen.getByText(/urgency urgent · confidence 93% · safety risk/)).toBeTruthy();
    expect(screen.getByText(/score 71 of 3 considered/)).toBeTruthy();
  });

  it('shows a step that is still on its way', () => {
    render(<HandlingTrailView trail={{ steps: [step({})], pending: ['AI_REVIEW'] }} />);
    expect(screen.getByText(/AI assistant is reading your request/)).toBeTruthy();
  });

  it('labels the safety rules when no model was available', () => {
    render(<HandlingTrailView trail={{ pending: [], steps: [step({ stage: 'AI_REVIEW', title: 'Checked by standard rules' })] }} />);
    expect(screen.getByText('Safety rules')).toBeTruthy();
  });
});

describe('acknowledgement', () => {
  it('summarises the review and the dispatch in one line', () => {
    expect(acknowledgement(trail)).toBe('Read by Groq · gpt-oss-20b · Waiting for a technician to become free');
  });
  it('says the review is in progress while it is', () => {
    expect(acknowledgement({ steps: [step({})], pending: ['AI_REVIEW'] })).toBe('AI review in progress');
  });
  it('formats model labels', () => {
    expect(modelLabel({ provider: 'gemini', model: 'gemini-3.1-flash-lite' })).toBe('Gemini · gemini-3.1-flash-lite');
    expect(modelLabel({ provider: null, model: null })).toBeNull();
  });
});
