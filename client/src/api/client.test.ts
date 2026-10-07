import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiFetch, apiFetchPage, ApiError } from './client';
import { saveSession, getToken, clearSession, isTokenExpired } from './session';

const user = { user_id: 'u1', reg_or_emp_id: 'S1', full_name: 'Test', role: 'STUDENT' as const };

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

  it('signs the user out and redirects on 401 when a token was sent', async () => {
    saveSession('tok', user);
    vi.stubGlobal('fetch', mockFetch(401, { error: 'Invalid or expired token.' }));
    await expect(apiFetch('/complaints')).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
    expect(window.location.href).toBe('/login?expired=1');
  });

  it('does NOT sign the user out on 403 (permission boundary, not an auth failure)', async () => {
    saveSession('tok', user);
    vi.stubGlobal('fetch', mockFetch(403, { error: 'You can only act on tasks assigned to you.' }));
    const err = await rejection(apiFetch('/dispatch/tasks/1'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('You can only act on tasks assigned to you.');
    expect(getToken()).toBe('tok');
    expect(window.location.href).toBe('/student');
  });

  it('a 401 from the login form (no token) does not redirect', async () => {
    window.location.pathname = '/login';
    vi.stubGlobal('fetch', mockFetch(401, { error: 'Invalid credentials.' }));
    const err = await rejection(apiFetch('/auth/login', { method: 'POST' }));
    expect(err.status).toBe(401);
    expect(window.location.href).toBe('/student');
  });

  it('an expired admin session returns to the admin sign-in, not the public one', async () => {
    saveSession('tok', { ...user, role: 'ADMIN' });
    window.location.pathname = '/admin/users';
    vi.stubGlobal('fetch', mockFetch(401, { error: 'Invalid or expired token.' }));
    await rejection(apiFetch('/admin/users'));
    expect(window.location.href).toBe('/admin?expired=1');
  });

  it('a failed sign-in attempt never ends the session already open', async () => {
    saveSession('tok', user);
    window.location.pathname = '/admin';
    vi.stubGlobal('fetch', mockFetch(401, { error: 'Invalid credentials.' }));
    const err = await rejection(apiFetch('/auth/admin/login', { method: 'POST' }));
    expect(err.status).toBe(401);
    expect(getToken()).toBe('tok');
  });

  it('turns a network failure into a readable ApiError with status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await rejection(apiFetch('/health'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Cannot reach the server/);
  });

  it('sends the bearer token and uses the same-origin /api base by default', async () => {
    saveSession('abc', user);
    const fetchMock = mockFetch(200, []);
    vi.stubGlobal('fetch', fetchMock);
    await apiFetch('/complaints', { params: { status: 'OPEN', block_id: '' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/complaints?status=OPEN');
    expect(init.headers.Authorization).toBe('Bearer abc');
  });
});

describe('session storage', () => {
  beforeEach(() => localStorage.clear());

  it('clearSession removes everything a session wrote, including the legacy shared allotment cache', () => {
    localStorage.setItem('fixmaster_student_allotment', JSON.stringify({ block_id: 'L_BLOCK', room_id: 'L-843' }));
    saveSession('tok', user);
    expect(localStorage.getItem('fixmaster_student_allotment')).toBeNull();
    clearSession();
    expect(localStorage.length).toBe(0);
  });

  it('detects expired and malformed tokens', () => {
    const encode = (payload: object) => `x.${btoa(JSON.stringify(payload))}.y`;
    expect(isTokenExpired(encode({ exp: Math.floor(Date.now() / 1000) + 3600 }))).toBe(false);
    expect(isTokenExpired(encode({ exp: Math.floor(Date.now() / 1000) - 10 }))).toBe(true);
    expect(isTokenExpired(encode({}))).toBe(true);
    expect(isTokenExpired('not-a-jwt')).toBe(true);
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
    saveSession('tok', user);
    expect(localStorage.getItem('fixmaster_last_activity')).not.toBeNull();
    clearSession();
    expect(localStorage.length).toBe(0);
  });
});
