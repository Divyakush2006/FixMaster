// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ suggestions: vi.fn(), dispatch: vi.fn() }));
vi.mock('../../api/endpoints', () => ({ autopilotApi: api }));

import { AutopilotPanel } from './AutopilotPanel';

const weights = { quality: 30, load: 20, idle: 10, proximity: 15, reliability: 20, roomHistory: 5 };
const components = { quality: 0.8, load: 0.5, idle: 0.2, proximity: 1, reliability: 0.9, roomHistory: 0 };
const candidate = (id: string, name: string, score: number) => ({ user_id: id, full_name: name, score, live_jobs: 1, rated_jobs: 12, components, weights });

const suggestions = (over: Record<string, unknown> = {}) => ({
  settings: { mode: 'SUGGEST' },
  recovery: false,
  candidates: [candidate('u1', 'Dhanush V', 81), candidate('u2', 'Selvi R', 74)],
  excluded: [{ user_id: 'u3', full_name: 'Mani K', reason: 'AT_CAPACITY' }],
  ...over,
});

function setup(onAssigned = vi.fn(), onPick = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AutopilotPanel complaintId="t-1" onAssigned={onAssigned} onPick={onPick} />
    </QueryClientProvider>
  );
  return { onAssigned, onPick };
}

describe('AutopilotPanel', () => {
  afterEach(() => {
    cleanup();
    Object.values(api).forEach((f) => f.mockReset());
  });

  it('shows who it would send, with the score and each part of it', async () => {
    api.suggestions.mockResolvedValue(suggestions());
    setup();
    expect(await screen.findByText('Dhanush V')).toBeTruthy();
    expect(screen.getByLabelText('Score 81 out of 100')).toBeTruthy();
    expect(screen.getByText('Ratings')).toBeTruthy();
    expect(screen.getByText('Time since last job')).toBeTruthy();
  });

  it('assigns the top pick on one click and reports who was sent', async () => {
    api.suggestions.mockResolvedValue(suggestions());
    api.dispatch.mockResolvedValue({ assigned: true, staff_name: 'Dhanush V' });
    const user = userEvent.setup();
    const { onAssigned } = setup();
    await user.click(await screen.findByRole('button', { name: 'Assign Dhanush' }));
    expect(api.dispatch).toHaveBeenCalledWith('t-1');
    await vi.waitFor(() => expect(onAssigned).toHaveBeenCalledWith('Dhanush V'));
  });

  it('lets the manager pick someone else from the shortlist', async () => {
    api.suggestions.mockResolvedValue(suggestions());
    const user = userEvent.setup();
    const { onPick } = setup();
    await user.click(await screen.findByRole('button', { name: /Selvi R/ }));
    expect(onPick).toHaveBeenCalledWith('u2');
    expect(api.dispatch).not.toHaveBeenCalled();
  });

  it('explains who was left out and why', async () => {
    api.suggestions.mockResolvedValue(suggestions());
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: /1 not considered/ }));
    expect(screen.getByText('Mani K')).toBeTruthy();
    expect(screen.getByText('At their live-job limit')).toBeTruthy();
  });

  it('marks recovery mode after a bad experience', async () => {
    api.suggestions.mockResolvedValue(suggestions({ recovery: true }));
    setup();
    expect(await screen.findByText('Recovery mode')).toBeTruthy();
  });

  it('says so when nobody can take the ticket', async () => {
    api.suggestions.mockResolvedValue(suggestions({ candidates: [] }));
    setup();
    expect(await screen.findByText(/Nobody can take this right now/)).toBeTruthy();
  });

  it('shows nothing when the autopilot is off for this place', async () => {
    api.suggestions.mockResolvedValue(suggestions({ settings: { mode: 'OFF' } }));
    setup();
    await vi.waitFor(() => expect(api.suggestions).toHaveBeenCalled());
    expect(screen.queryByText('Autopilot suggestion')).toBeNull();
  });
});
