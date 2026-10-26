// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ erasureRequests: vi.fn(), eraseUser: vi.fn() }));
vi.mock('../../api/endpoints', () => ({ adminApi: api }));

import { ToastProvider } from '../../components/ui/Toast';
import { ConfirmProvider } from '../../components/ui/ConfirmDialog';
import { PrivacyRequestsPage } from './PrivacyRequestsPage';

const now = new Date().toISOString();
const ready = { user_id: 'u1', reg_or_emp_id: '22BCE0190', full_name: 'Priya Menon', email: 'p@x', erasure_requested_at: now, blockers: [] };
const blocked = { ...ready, user_id: 'u2', reg_or_emp_id: '22BCE0777', full_name: 'Karan Shah', blockers: ['The resident still has room L-305. End the allotment first.'] };

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <ConfirmProvider>
          <PrivacyRequestsPage />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe('PrivacyRequestsPage', () => {
  afterEach(() => {
    cleanup();
    Object.values(api).forEach((f) => f.mockReset());
  });

  it('says so when nobody is waiting', async () => {
    api.erasureRequests.mockResolvedValue([]);
    setup();
    expect(await screen.findByText('No requests')).toBeTruthy();
  });

  it('shows what is in the way and will not erase until it is cleared', async () => {
    api.erasureRequests.mockResolvedValue([ready, blocked]);
    setup();
    expect(await screen.findByText(/still has room L-305/)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Erase' }) as HTMLButtonElement[];
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
  });

  it('asks for confirmation, then erases', async () => {
    api.erasureRequests.mockResolvedValue([ready]);
    api.eraseUser.mockResolvedValue({ message: 'Personal data erased.' });
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Erase' }));
    expect(api.eraseUser).not.toHaveBeenCalled();
    expect(await screen.findByText(/Erase Priya Menon's data\?/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Erase data' }));
    await vi.waitFor(() => expect(api.eraseUser).toHaveBeenCalledWith('u1'));
  });

  it('does nothing when the confirmation is cancelled', async () => {
    api.erasureRequests.mockResolvedValue([ready]);
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Erase' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(api.eraseUser).not.toHaveBeenCalled();
  });
});
