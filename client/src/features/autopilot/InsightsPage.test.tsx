// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  overview: vi.fn(),
  breachRisk: vi.fn(),
  recurring: vi.fn(),
  briefing: vi.fn(),
  refreshBriefing: vi.fn(),
  ask: vi.fn(),
  volumeTrend: vi.fn(),
  staffingGaps: vi.fn(),
  blockComparison: vi.fn(),
}));
vi.mock('../../api/endpoints', () => ({ insightsApi: api }));

import { InsightsPage } from './InsightsPage';

const totals = { blocks: 3, open_tickets: 42, unassigned: 5, overdue: 4, at_risk: 7, emergencies: 1, raised_24h: 9 };

const report = (rows: unknown) => ({ report: 'x', title: 'x', answer: '', rows });

function setup(source: 'AI' | 'RULES' = 'RULES', watch: { trend?: unknown; gaps?: unknown; compare?: unknown } = {}) {
  api.volumeTrend.mockResolvedValue(report(watch.trend ?? { weeks: [], blocks: [] }));
  api.staffingGaps.mockResolvedValue(report(watch.gaps ?? []));
  api.blockComparison.mockResolvedValue(report(watch.compare ?? []));
  api.overview.mockResolvedValue({ totals, blocks: [] });
  api.breachRisk.mockResolvedValue([
    { complaint_id: 'c1', block_id: 'L_BLOCK', priority: 'HIGH', status: 'ASSIGNED', category_name: 'Electrical', issue_name: 'Power Socket Damaged', location: '843', sla_status: 'OVERDUE', due_at: '', hours_left: -3.5, assigned_to: null },
  ]);
  api.recurring.mockResolvedValue([{ block_id: 'L_BLOCK', ticket_scope: 'ROOM', location: '843', category_name: 'Electrical', incidents: 4, most_recent: '' }]);
  api.briefing.mockResolvedValue({
    narrative: { headline: '1 emergency ticket open: check these first.', highlights: ['42 tickets open across 3 blocks.'], actions: ['Confirm a technician is on every emergency ticket.'] },
    facts: { totals },
    source,
    model: null,
    generated_at: new Date().toISOString(),
    cached: true,
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <InsightsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('InsightsPage', () => {
  afterEach(() => {
    cleanup();
    Object.values(api).forEach((f) => f.mockReset());
  });

  it('shows the briefing, the figures behind it and the tickets that need attention', async () => {
    setup();
    expect(await screen.findByText('1 emergency ticket open: check these first.')).toBeTruthy();
    expect(screen.getByText('Confirm a technician is on every emergency ticket.')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(await screen.findByText('Power Socket Damaged')).toBeTruthy();
    expect(screen.getByText(/nobody assigned/)).toBeTruthy();
    expect(screen.getByText(/3\.5 h overdue/)).toBeTruthy();
  });

  it('says whether a model or fixed rules wrote the briefing', async () => {
    setup('RULES');
    expect(await screen.findByText(/Standard summary of the figures below/)).toBeTruthy();
    cleanup();
    setup('AI');
    expect(await screen.findByText(/Written by an AI model/)).toBeTruthy();
  });

  it('asks a question and shows the answer with the report it came from', async () => {
    api.ask.mockResolvedValue({ answered: true, answer: '4 tickets are overdue.', source: 'AI', report: 'breach_risk', title: 'Tickets at risk of missing their deadline' });
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByLabelText('Your question'), 'what is overdue?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(api.ask).toHaveBeenCalledWith('what is overdue?');
    expect(await screen.findByText('4 tickets are overdue.')).toBeTruthy();
    expect(screen.getByText(/Tickets at risk of missing their deadline/)).toBeTruthy();
    expect(screen.getByText(/understood by an AI model/)).toBeTruthy();
  });

  it('puts what the chief warden scans first above the tables: busy blocks, short staffing, block comparison', async () => {
    setup('RULES', {
      trend: { weeks: [{ week_start: '2026-09-28', tickets: 44, urgent: 3, z: 2.9, unusual: true }], blocks: [{ block_id: 'T_BLOCK', last_7_days: 30, usual_week: 4, z: 26 }] },
      gaps: [{ block_id: 'L_BLOCK', trade: 'ELECTRICIAN', staff: 2, on_duty: 0, pool_on_duty: 0, open_tickets: 5, status: 'NO_COVER' }],
      compare: [
        { block_id: 'L_BLOCK', block_name: 'L', tickets: 60, urgent: 5, met: 10, breached: 40, compliance_pct: 20, overdue_now: 7, escalated_now: 1, avg_hours: 30, avg_rating: 4.1 },
        { block_id: 'T_BLOCK', block_name: 'T', tickets: 30, urgent: 3, met: 25, breached: 1, compliance_pct: 96.2, overdue_now: 0, escalated_now: 0, avg_hours: 3, avg_rating: 4.8 },
      ],
    });
    expect(await screen.findByText('Busier than usual')).toBeTruthy();
    expect(screen.getByText(/30 tickets in the last 7 days, against about 4/)).toBeTruthy();
    expect(screen.getByText('An unusually busy week')).toBeTruthy();
    expect(await screen.findByText('Nobody on duty')).toBeTruthy();
    expect(await screen.findByText('Blocks compared')).toBeTruthy();
    expect(screen.getByText('20%')).toBeTruthy();
  });

  it('shows no watchlist when nothing stands out', async () => {
    setup();
    await screen.findByText('1 emergency ticket open: check these first.');
    expect(screen.queryByText('Busier than usual')).toBeNull();
    expect(screen.queryByText('Where staffing is short')).toBeNull();
    expect(screen.queryByText('Blocks compared')).toBeNull();
  });

  it('does not send a question that is too short', async () => {
    setup();
    const ask = await screen.findByRole('button', { name: 'Ask' });
    expect((ask as HTMLButtonElement).disabled).toBe(true);
  });
});
