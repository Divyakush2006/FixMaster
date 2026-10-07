import { mapApiError } from '../utils/errorMapper';
import { clearSession, getToken } from './session';

// Same-origin '/api' by default: in development Vite proxies it to the API
// (vite.config.ts), in production the web server does (client/nginx.conf).
// Set VITE_API_BASE_URL only when the API lives on a different origin.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
}

/** A page of a list endpoint; `total` comes from the X-Total-Count header. */
export interface Page<T> {
  items: T[];
  total: number;
}

export async function apiFetch<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  return (await request<T>(endpoint, options)).body;
}

/** For list endpoints that report their full size in X-Total-Count. */
export async function apiFetchPage<T>(endpoint: string, options: RequestOptions = {}): Promise<Page<T>> {
  const { body, response } = await request<T[]>(endpoint, options);
  const header = Number(response.headers.get('X-Total-Count'));
  return { items: body, total: Number.isFinite(header) && response.headers.has('X-Total-Count') ? header : body.length };
}

async function request<T>(endpoint: string, options: RequestOptions): Promise<{ body: T; response: Response }> {
  const { params, headers: customHeaders, ...customOptions } = options;

  let url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) url += `?${queryString}`;
  }

  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(customHeaders as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(url, { ...customOptions, headers });
  } catch (error) {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, error);
  }

  const contentType = response.headers.get('content-type') || '';
  let body: any = null;
  if (response.status === 204) {
    body = null;
  } else if (contentType.includes('application/json')) {
    body = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    body = { error: text || `Server returned non-JSON format (HTTP ${response.status})` };
  }

  if (!response.ok) {
    // Only 401 means "sign in again" (no/invalid/expired/revoked token, or a
    // deactivated account). 403 means signed in but not allowed to do this
    // one thing - an ordinary error, never a reason to sign out.
    // A failed sign-in attempt (any /auth/* endpoint) must never end the
    // session the user already has open.
    const isSignInRequest = endpoint.startsWith('/auth/');
    if (response.status === 401 && token && !isSignInRequest) {
      clearSession();
      const path = window.location.pathname;
      const isAdminArea = path === '/admin' || path.startsWith('/admin/');
      const signInPage = isAdminArea ? '/admin' : '/login';
      if (path !== signInPage) {
        // Full navigation (not a router push) so every in-memory cache from
        // this session is discarded too.
        window.location.href = `${signInPage}?expired=1`;
      }
    }
    throw new ApiError(mapApiError(body), response.status, body);
  }

  return { body: body as T, response };
}
