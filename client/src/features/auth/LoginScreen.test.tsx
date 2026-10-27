// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const capabilities = vi.fn();

vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), getHomeRouteForRole: () => '/student', isAuthenticated: false, isLoading: false, user: null }),
}));
vi.mock('../../api/endpoints', () => ({ authApi: { capabilities: () => capabilities() } }));

import { LoginScreen } from './LoginScreen';

function renderLogin(url = '/login') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <LoginScreen />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('university sign-in on the login page', () => {
  afterEach(cleanup);

  it('offers the button, named for the provider, only when the deployment has single sign-on', async () => {
    capabilities.mockResolvedValue({ password_reset: true, sso: { label: 'your VIT account' } });
    renderLogin();
    const link = await screen.findByRole('link', { name: 'Sign in with your VIT account' });
    expect(link.getAttribute('href')).toBe('/api/auth/sso/start');
  });

  it('shows no button when single sign-on is off, or on the staff tab', async () => {
    capabilities.mockResolvedValue({ password_reset: true, sso: null });
    renderLogin();
    await screen.findByRole('button', { name: /sign in as student/i });
    expect(screen.queryByRole('link', { name: /sign in with/i })).toBeNull();
    cleanup();

    capabilities.mockResolvedValue({ password_reset: true, sso: { label: 'your VIT account' } });
    renderLogin('/login?portal=staff');
    await screen.findByRole('button', { name: /sign in as staff/i });
    expect(screen.queryByRole('link', { name: /sign in with/i })).toBeNull();
  });

  it('explains in plain words why a university sign-in did not complete', async () => {
    capabilities.mockResolvedValue({ password_reset: true, sso: { label: 'your VIT account' } });
    renderLogin('/login?sso=no_account');
    expect((await screen.findByRole('alert')).textContent).toMatch(/no FixMaster student account.*create your account first/i);
    cleanup();

    renderLogin('/login?sso=something-unexpected');
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be completed/i);
  });
});
