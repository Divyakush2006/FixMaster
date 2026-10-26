// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AssistantDraft, AssistantResponse } from '../../types';

const draftTickets = vi.fn();
vi.mock('../../api/endpoints', () => ({ aiApi: { draftTickets: (t: string) => draftTickets(t) } }));

import { RequestAssistant } from './RequestAssistant';

const base: AssistantDraft = {
  ticket_scope: 'ROOM',
  block_id: 'L_BLOCK',
  room_id: 'L-810',
  common_area_id: null,
  common_area_name: null,
  category_id: 2,
  category_name: 'Electrical & Power Systems',
  subcategory_id: 5,
  issue_name: 'Power Socket Damaged / Sparking',
  required_specialization: 'ELECTRICIAN',
  priority: 'HIGH',
  description: 'Socket near the desk sparks when a charger is plugged in.',
  confidence: 0.9,
  safety_advice: 'Do not touch the socket.',
  needs: [],
  existing_ticket: null,
  review_hint: null,
};

function setup(onUse = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RequestAssistant onUse={onUse} />
    </QueryClientProvider>
  );
  return onUse;
}

describe('RequestAssistant', () => {
  afterEach(() => {
    cleanup();
    draftTickets.mockReset();
  });

  it('drafts from free text and hands the chosen draft to the form, with its safety advice shown', async () => {
    const response: AssistantResponse = { source: 'ai', drafts: [base], clarification: null, notice: null };
    draftTickets.mockResolvedValue(response);
    const user = userEvent.setup();
    const onUse = setup();
    await user.type(screen.getByLabelText(/describe the problem/i), 'socket sparking near my desk');
    await user.click(screen.getByRole('button', { name: /draft my request/i }));
    expect(draftTickets).toHaveBeenCalledWith('socket sparking near my desk');
    expect(await screen.findByText('Power Socket Damaged / Sparking')).toBeTruthy();
    expect(screen.getByText(/Do not touch the socket/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /review and send/i }));
    expect(onUse).toHaveBeenCalledWith(base);
  });

  it('explains fallbacks and blocks drafts that cannot be sent yet', async () => {
    draftTickets.mockResolvedValue({
      source: 'rules',
      drafts: [{ ...base, room_id: null, needs: ['ROOM_ALLOTMENT'], review_hint: 'Check the issue type.' }],
      clarification: null,
      notice: 'The assistant is unavailable right now.',
    });
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText(/describe the problem/i), 'socket sparking');
    await user.click(screen.getByRole('button', { name: /draft my request/i }));
    expect(await screen.findByText(/assistant is unavailable/)).toBeTruthy();
    expect(screen.getByText('Check the issue type.')).toBeTruthy();
    expect(screen.getByText(/needs a room allotment/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /review and send/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks back when nothing could be drafted', async () => {
    draftTickets.mockResolvedValue({ source: 'ai', drafts: [], clarification: 'What is broken, and where?', notice: null });
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByLabelText(/describe the problem/i), 'help');
    await user.click(screen.getByRole('button', { name: /draft my request/i }));
    expect(await screen.findByText('What is broken, and where?')).toBeTruthy();
  });
});
