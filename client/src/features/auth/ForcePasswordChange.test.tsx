// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const changePassword = vi.fn();
const updateUser = vi.fn();
const renewSession = vi.fn();
const logout = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { full_name: 'Asha Rao', reg_or_emp_id: 'SUP_M01' }, updateUser, renewSession, logout }),
}));
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../api/endpoints', () => ({ meApi: { changePassword: (...a: unknown[]) => changePassword(...a) } }));

import { ForcePasswordChange } from './ForcePasswordChange';

function setup() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ForcePasswordChange />
    </QueryClientProvider>
  );
}

async function fill(user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm: string) {
  await user.type(screen.getByLabelText(/password you were given/i), current);
  await user.type(screen.getByLabelText(/^new password/i), next);
  await user.type(screen.getByLabelText(/confirm new password/i), confirm);
  await user.click(screen.getByRole('button', { name: /save and continue/i }));
}

describe('ForcePasswordChange', () => {
  beforeEach(() => {
    changePassword.mockReset();
    updateUser.mockReset();
    renewSession.mockReset();
  });
  afterEach(cleanup);

  it('refuses a weak, mismatched or unchanged password without calling the server', async () => {
    const user = userEvent.setup();
    setup();
    await fill(user, 'Given#Pass42xy', 'short', 'short');
    expect(await screen.findByText(/new password: use at least 8/i)).toBeTruthy();
    cleanup();
    setup();
    await fill(user, 'Given#Pass42xy', 'Orchard9Maple', 'Orchard9Maplf');
    expect(await screen.findByText(/do not match/i)).toBeTruthy();
    cleanup();
    setup();
    await fill(user, 'Orchard9Maple', 'Orchard9Maple', 'Orchard9Maple');
    expect(await screen.findByText(/different from the one you were given/i)).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('changes the password, renews the session and lifts the requirement', async () => {
    changePassword.mockResolvedValue({ message: 'ok', expires_at: '2026-10-29T00:00:00Z' });
    const user = userEvent.setup();
    setup();
    await fill(user, 'Given#Pass42xy', 'Orchard9Maple', 'Orchard9Maple');
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ must_change_password: false }));
    expect(changePassword).toHaveBeenCalledWith('Given#Pass42xy', 'Orchard9Maple');
    expect(renewSession).toHaveBeenCalledWith('2026-10-29T00:00:00Z');
  });

  it('shows the server message when the given password was wrong', async () => {
    changePassword.mockRejectedValue(new Error('Current password is incorrect.'));
    const user = userEvent.setup();
    setup();
    await fill(user, 'Wrong#Pass42xy', 'Orchard9Maple', 'Orchard9Maple');
    expect(await screen.findByText(/current password is incorrect/i)).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
