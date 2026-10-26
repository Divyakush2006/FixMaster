import { User } from '../types';

/**
 * Single owner of what the app keeps in browser storage for a signed-in user.
 *
 * The session itself is an HttpOnly cookie the browser holds and page scripts
 * cannot read. Storage only keeps what the UI needs to draw itself before the
 * first API call - the signed-in person's profile and when the session ends.
 * Neither is a credential: with them alone nothing can be done.
 *
 * Everything a session writes is removed by clearSession(), so on a shared
 * machine (hostel common-room PC) the next person to sign in inherits nothing
 * from the previous one.
 */
const USER_KEY = 'fixmaster_user';
const EXPIRES_KEY = 'fixmaster_session_expires';
// Time of the last user interaction, shared by every tab (idle sign-out).
const ACTIVITY_KEY = 'fixmaster_last_activity';
// Written by earlier versions of the app. `fixmaster_token` held the session
// token itself in storage; it is scrubbed on every sign-in/out so no copy of a
// credential lingers in a browser that was used before cookies were adopted.
const LEGACY_KEYS = ['fixmaster_token', 'fixmaster_student_allotment'];

/** Storage key that changes whenever the signed-in person does, for cross-tab detection. */
export const SESSION_KEY = USER_KEY;

const CSRF_COOKIE = 'fm_csrf';

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

/** When the server-side session ends, if known. */
export function getSessionExpiry(): number | null {
  const value = Date.parse(localStorage.getItem(EXPIRES_KEY) ?? '');
  return Number.isFinite(value) ? value : null;
}

/** True when this browser believes a session is open (the server stays the authority). */
export function hasSession(): boolean {
  const expiry = getSessionExpiry();
  return getStoredUser() !== null && expiry !== null && expiry > Date.now();
}

export function saveSession(user: User, expiresAt: string): void {
  LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  localStorage.setItem(EXPIRES_KEY, expiresAt);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  touchActivity();
}

/** Updates the stored profile of the signed-in person (e.g. after onboarding). */
export function updateStoredUser(patch: Partial<User>): void {
  const current = getStoredUser();
  if (current) localStorage.setItem(USER_KEY, JSON.stringify({ ...current, ...patch }));
}

/** After a password change the server re-issues the cookie with a new end time. */
export function updateSessionExpiry(expiresAt: string): void {
  localStorage.setItem(EXPIRES_KEY, expiresAt);
}

export function touchActivity(at = Date.now()): void {
  localStorage.setItem(ACTIVITY_KEY, String(at));
}

/** Last recorded activity; a session with no record counts as active now. */
export function getLastActivity(): number {
  const value = Number(localStorage.getItem(ACTIVITY_KEY));
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

export function clearSession(): void {
  [USER_KEY, EXPIRES_KEY, ACTIVITY_KEY, ...LEGACY_KEYS].forEach((k) => localStorage.removeItem(k));
}

/** The CSRF value the server set at sign-in; sent back in a header on every state-changing request. */
export function getCsrfToken(): string | null {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
}
