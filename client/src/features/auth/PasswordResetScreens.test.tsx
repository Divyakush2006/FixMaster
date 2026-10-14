// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const forgotPassword = vi.fn();
const resetPassword = vi.fn();
const showToast = vi.fn();

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast }) }));
vi.mock('../../api/endpoints', () => ({
  authApi: { forgotPassword: (...a: unknown[]) => forgotPassword(...a), resetPassword: (...a: unknown[]) => resetPassword(...a) },
}));

import { ForgotPasswordScreen, ResetPasswordScreen } from './PasswordResetScreens';

const GOOD = 'Corridor7Lamp';

function renderReset() {
  return render(
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordScreen />} />
        <Route path="/login" element={<p>sign-in page</p>} />
        <Route path="/forgot-password" element={<p>forgot page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('password reset screens', () => {
  beforeEach(() => {
    forgotPassword.mockReset();
    resetPassword.mockReset();
    showToast.mockReset();
    window.location.hash = '';
  });
  afterEach(cleanup);

  it('asks for the account id and then shows a neutral confirmation', async () => {
    forgotPassword.mockResolvedValue({ message: 'ok' });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ForgotPasswordScreen />
      </MemoryRouter>
    );
    await user.click(screen.getByRole('button', { name: /email me a reset link/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/enter your registration number/i);
    expect(forgotPassword).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/registration number or employee id/i), ' 21bce0843 ');
    await user.click(screen.getByRole('button', { name: /email me a reset link/i }));
    await screen.findByText(/check your email/i);
    expect(forgotPassword).toHaveBeenCalledWith('21bce0843');
  });

  it('reads the token from the URL fragment, removes it from the address bar and submits it once', async () => {
    window.location.hash = '#token=abc.def-ghi';
    resetPassword.mockResolvedValue({ message: 'ok' });
    const user = userEvent.setup();
    renderReset();
    expect(window.location.hash).toBe('');

    await user.type(screen.getByLabelText(/^new password/i), GOOD);
    await user.type(screen.getByLabelText(/confirm new password/i), GOOD);
    await user.dblClick(screen.getByRole('button', { name: /change password/i }));
    await screen.findByText('sign-in page');
    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(resetPassword).toHaveBeenCalledWith('abc.def-ghi', GOOD);
  });

  it('checks the password before calling the server', async () => {
    window.location.hash = '#token=abc.def-ghi';
    const user = userEvent.setup();
    renderReset();
    await user.type(screen.getByLabelText(/^new password/i), 'short');
    await user.type(screen.getByLabelText(/confirm new password/i), 'short');
    await user.click(screen.getByRole('button', { name: /change password/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/at least 8 characters/i);

    await user.clear(screen.getByLabelText(/^new password/i));
    await user.type(screen.getByLabelText(/^new password/i), GOOD);
    await user.click(screen.getByRole('button', { name: /change password/i }));
    expect(screen.getByText(/do not match/i)).toBeTruthy();
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('offers a new link when the server says this one is no longer valid, and allows a retry', async () => {
    window.location.hash = '#token=abc.def-ghi';
    resetPassword.mockRejectedValueOnce(new Error('This reset link is invalid or has expired. Request a new one.'));
    const user = userEvent.setup();
    renderReset();
    await user.type(screen.getByLabelText(/^new password/i), GOOD);
    await user.type(screen.getByLabelText(/confirm new password/i), GOOD);
    await user.click(screen.getByRole('button', { name: /change password/i }));
    await screen.findByRole('link', { name: /request a new link/i });
    await waitFor(() => expect((screen.getByRole('button', { name: /change password/i }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('explains an incomplete link instead of showing a form that cannot work', () => {
    renderReset();
    expect(screen.getByText(/this link is incomplete/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /change password/i })).toBeNull();
  });
});
