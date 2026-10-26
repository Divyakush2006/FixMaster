// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ getPrivacyNotice: vi.fn(), getMe: vi.fn() }));
const auth = vi.hoisted(() => ({ value: { isAuthenticated: false, user: null as null | { role: string } } }));
vi.mock('../../api/endpoints', () => ({ metaApi: { getPrivacyNotice: api.getPrivacyNotice }, meApi: { getMe: api.getMe } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth.value }));

import { PrivacyNoticePage } from './PrivacyNoticePage';
import { PrivacyNoticeBanner } from '../../components/layout/PrivacyNoticeBanner';

const notice = {
  version: '2026-10',
  title: 'How FixMaster uses your information',
  intro: 'This notice says what the hostel office keeps.',
  sections: [
    { id: 'collected', title: 'What we keep', items: ['Your account.', 'Your resident profile.'] },
    { id: 'rights', title: 'Your rights', items: ['Download everything we hold.', 'Ask for erasure.'] },
  ],
  contact: 'the Hostel Estates Office',
  retention: {},
};

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );

describe('PrivacyNoticePage', () => {
  afterEach(() => {
    cleanup();
    Object.values(api).forEach((f) => f.mockReset());
    auth.value = { isAuthenticated: false, user: null };
  });

  it('shows the notice with its version, every section and a contact, without signing in', async () => {
    api.getPrivacyNotice.mockResolvedValue(notice);
    wrap(<PrivacyNoticePage />);
    expect(await screen.findByRole('heading', { name: 'How FixMaster uses your information' })).toBeTruthy();
    expect(screen.getByText('2026-10')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What we keep' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your rights' })).toBeTruthy();
    expect(screen.getByText('Ask for erasure.')).toBeTruthy();
    expect(screen.getByText(/contact the Hostel Estates Office/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeTruthy();
  });

  it('says so when it cannot be loaded', async () => {
    api.getPrivacyNotice.mockRejectedValue(new Error('down'));
    wrap(<PrivacyNoticePage />);
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
  });
});

describe('PrivacyNoticeBanner', () => {
  afterEach(() => {
    cleanup();
    Object.values(api).forEach((f) => f.mockReset());
    auth.value = { isAuthenticated: false, user: null };
  });

  it('asks a resident to read and accept a changed notice', async () => {
    auth.value = { isAuthenticated: true, user: { role: 'STUDENT' } };
    api.getMe.mockResolvedValue({ privacy_notice_outdated: true });
    wrap(<PrivacyNoticeBanner />);
    expect(await screen.findByText('The privacy notice has changed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review and accept' }).getAttribute('href')).toBe('/onboarding');
    expect(screen.getByRole('link', { name: 'read the new notice' }).getAttribute('href')).toBe('/privacy');
  });

  it('stays out of the way when the resident is up to date, and for staff', async () => {
    auth.value = { isAuthenticated: true, user: { role: 'STUDENT' } };
    api.getMe.mockResolvedValue({ privacy_notice_outdated: false });
    wrap(<PrivacyNoticeBanner />);
    await vi.waitFor(() => expect(api.getMe).toHaveBeenCalled());
    expect(screen.queryByText('The privacy notice has changed')).toBeNull();
    cleanup();
    auth.value = { isAuthenticated: true, user: { role: 'SUPERVISOR' } };
    api.getMe.mockClear();
    wrap(<PrivacyNoticeBanner />);
    expect(api.getMe).not.toHaveBeenCalled();
  });
});
