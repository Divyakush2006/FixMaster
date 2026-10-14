import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiFetch, apiFetchPage, apiErrorCode, ApiError } from './client';
import type { User } from '../types';
import { saveSession, clearSession, hasSession, getCsrfToken } from './session';

const user = { user_id: 'u1', reg_or_emp_id: 'S1', full_name: 'Test', role: 'STUDENT' as const };
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
const signIn = (u: User = user) => saveSession(u, inAnHour());

/** Awaits a promise that must reject, and returns the ApiError it rejected with. */
async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected the request to fail');
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  );
}

describe('apiFetch auth handling', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    localStorage.clear();
    // window.location.href assignment would navigate jsdom; capture it instead.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, pathname: '/student', href: '/student' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('signs the user out and redirects on 401 when a session was open', async () => {
    signIn();
    vi.stubGlobal('fetch', mockFetch(401, { error: 'Invalid or expired token.' }));
    await expect(apiFetch('/complaints')).rejects.toBeInstanceOf(ApiError);
    expect(hasSession()).toBe(false);
    expect(window.location.href).toBe('/login?expired=1');
  });

  it('does NOT sign the user out on 403 (permission boundary, not an auth failure)', async () => {
    signIn();
    vi.stubGlobal('fetch', mockFetch(403, { error: 'You can only act on tasks assigned to you.' }));
    const err = await rejection(apiFetch('/dispatch/tasks/1'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('You can only act on tasks assigned to you.');
    expect(hasSession()).toBe(true);
    expect(window.location.href).toBe('/student');
  });

  it('a 401 from the login form (no session) does not redirect', async () => {
    window.location.pathname = '/login';
    vi.stubGlobal('fetch', mockFetch(401, { error: 'Invalid credentials.' }));
    const err = await rejection(apiFetch('/auth/login', { method: 'POST' }));
    expect(err.status).toBe(401);
    expect(window.location.href).toBe('/student');
  });

  it('an expired admin session returns to the admin sign-in, not the public one', async () => {
    signIn({ ...user, role: 'ADMIN' });
    window.location.pathname = '/admin/users';
    vi.stubGlobal('fetch', mockFetch(401, { error: 'Invalid or expired token.' }));
    await rejection(apiFetch('/admin/users'));
    expect(window.location.href).toBe('/admin?expired=1');
  });

  it('a failed sign-in attempt never ends the session already open', async () => {
    signIn();
    window.location.pathname = '/admin';
    vi.stubGlobal('fetch', mockFetch(401, { error: 'Invalid credentials.' }));
    const err = await rejection(apiFetch('/auth/admin/login', { method: 'POST' }));
    expect(err.status).toBe(401);
    expect(hasSession()).toBe(true);
  });

  it('turns a network failure into a readable ApiError with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await rejection(apiFetch('/health'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Cannot reach the server/);
  });

  it('uses the same-origin /api base, never puts a credential in a header, and asks for a cookie session', async () => {
    signIn();
    const fetchMock = mockFetch(200, []);
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/complaints', { params: { status: 'OPEN', block_id: '' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/complaints?status=OPEN');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers['X-Session-Transport']).toBe('cookie');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['X-CSRF-Token']).toBeUndefined();
  });

  it('echoes the CSRF cookie on state-changing requests only', async () => {
    signIn();
    document.cookie = 'fm_csrf=abc123; path=/';
    const fetchMock = mockFetch(200, {});
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/complaints', { method: 'POST', body: '{}' });
    await apiFetch('/complaints');
    expect(fetchMock.mock.calls[0][1].headers['X-CSRF-Token']).toBe('abc123');
    expect(fetchMock.mock.calls[1][1].headers['X-CSRF-Token']).toBeUndefined();
    document.cookie = 'fm_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });
});

describe('session storage', () => {
  beforeEach(() => localStorage.clear());

  it('clearSession removes everything a session wrote, including the legacy shared allotment cache', () => {
    localStorage.setItem('fixmaster_student_allotment', JSON.stringify({ block_id: 'L_BLOCK', room_id: 'L-843' }));
    signIn();
    expect(localStorage.getItem('fixmaster_student_allotment')).toBeNull();
    clearSession();
    expect(localStorage.length).toBe(0);
  });

  it('a session is only believed while it has not ended', () => {
    expect(hasSession()).toBe(false);
    saveSession(user, new Date(Date.now() + 60_000).toISOString());
    expect(hasSession()).toBe(true);
    saveSession(user, new Date(Date.now() - 1_000).toISOString());
    expect(hasSession()).toBe(false);
    localStorage.setItem('fixmaster_session_expires', 'not a date');
    expect(hasSession()).toBe(false);
  });

  it('no credential is ever written to storage, and a token left by an older version is scrubbed', () => {
    localStorage.setItem('fixmaster_token', 'old.jwt.token');
    signIn();
    expect(localStorage.getItem('fixmaster_token')).toBeNull();
    const everything = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join(' ');
    expect(everything).not.toMatch(/eyJ|Bearer/);
    clearSession();
    expect(localStorage.length).toBe(0);
  });

  it('reads the CSRF value from its cookie', () => {
    document.cookie = 'fm_csrf=tok%2Bvalue; path=/';
    expect(getCsrfToken()).toBe('tok+value');
    document.cookie = 'fm_csrf=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    expect(getCsrfToken()).toBeNull();
  });
});

describe('paged lists and empty responses', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('apiFetchPage reads the full size from X-Total-Count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Total-Count': '57' },
        })
      )
    );
    const page = await apiFetchPage<{ id: number }>('/complaints', { params: { limit: 2, offset: 0 } });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(57);
  });

  it('apiFetchPage falls back to the item count without the header', async () => {
    vi.stubGlobal('fetch', mockFetch(200, [{ id: 1 }]));
    expect((await apiFetchPage('/x')).total).toBe(1);
  });

  it('a 204 response resolves without trying to parse a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeNull();
  });

  it('the activity timestamp is part of the session and cleared with it', () => {
    localStorage.clear();
    signIn();
    expect(localStorage.getItem('fixmaster_last_activity')).not.toBeNull();
    clearSession();
    expect(localStorage.length).toBe(0);
  });
});

describe('machine-readable error codes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('exposes the API code and details so screens can branch on them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'You have 2 open jobs.', code: 'OPEN_JOBS', details: { open_jobs: 2 } }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const err = (await apiFetch('/me/availability', { method: 'PATCH' }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(apiErrorCode(err)).toBe('OPEN_JOBS');
    expect(err.details).toEqual({ open_jobs: 2 });
    expect(err.message).toBe('You have 2 open jobs.');
  });

  it('has no code for ordinary errors or non-API failures', () => {
    expect(apiErrorCode(new ApiError('nope', 400, { error: 'nope' }))).toBeUndefined();
    expect(apiErrorCode(new Error('boom'))).toBeUndefined();
  });
});
