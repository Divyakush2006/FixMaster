// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const verifyEmail = vi.fn();
const resendCode = vi.fn();

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ verifyEmail }) }));
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../api/endpoints', () => ({ authApi: { resendCode: (id: string) => resendCode(id) } }));

import { VerifyEmailScreen } from './VerifyEmailScreen';
import { needsOnboarding } from '../../components/layout/ProtectedRoute';

function setup(state?: object) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/verify-email', state }]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmailScreen />} />
        <Route path="/onboarding" element={<p>Onboarding page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('VerifyEmailScreen', () => {
  beforeEach(() => {
    verifyEmail.mockReset();
    resendCode.mockReset();
  });
  afterEach(cleanup);

  it('keeps only digits, confirms the code and moves on to onboarding', async () => {
    verifyEmail.mockResolvedValue({ role: 'STUDENT', account_status: 'PENDING_PROFILE' });
    const user = userEvent.setup();
    setup({ regNo: '24BCE0001', email: 'as***@vitstudent.ac.in' });
    expect(screen.getByText(/as\*\*\*@vitstudent\.ac\.in/)).toBeTruthy();
    await user.type(screen.getByLabelText(/verification code/i), '12a3456');
    await user.click(screen.getByRole('button', { name: /confirm and continue/i }));
    expect(verifyEmail).toHaveBeenCalledWith('24BCE0001', '123456');
    expect(await screen.findByText('Onboarding page')).toBeTruthy();
  });

  it('shows the server answer and clears the code when it is wrong', async () => {
    verifyEmail.mockRejectedValue(new Error('That code is wrong or has expired.'));
    const user = userEvent.setup();
    setup({ regNo: '24BCE0001' });
    await user.type(screen.getByLabelText(/verification code/i), '000000');
    await user.click(screen.getByRole('button', { name: /confirm and continue/i }));
    expect(await screen.findByText(/wrong or has expired/i)).toBeTruthy();
    expect((screen.getByLabelText(/verification code/i) as HTMLInputElement).value).toBe('');
  });

  it('asks for the registration number when opened directly, and holds resend during the cooldown only', async () => {
    resendCode.mockResolvedValue({ message: 'If that account is waiting for a code, a new one is on its way.' });
    const user = userEvent.setup();
    setup();
    const resend = screen.getByRole('button', { name: /send a new code/i }) as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
    await user.type(screen.getByLabelText(/registration number/i), '24bce0001');
    await user.click(screen.getByRole('button', { name: /send a new code/i }));
    expect(resendCode).toHaveBeenCalledWith('24BCE0001');
    expect((screen.getByRole('button', { name: /send a new code in/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('needsOnboarding', () => {
  it('holds back students until their profile is complete, and nobody else', () => {
    expect(needsOnboarding({ role: 'STUDENT', account_status: 'PENDING_PROFILE' })).toBe(true);
    expect(needsOnboarding({ role: 'STUDENT', account_status: 'ACTIVE' })).toBe(false);
    expect(needsOnboarding({ role: 'STUDENT' })).toBe(false); // sessions from before onboarding existed
    expect(needsOnboarding({ role: 'SUPERVISOR', account_status: 'PENDING_PROFILE' })).toBe(false);
    expect(needsOnboarding(null)).toBe(false);
  });
});
