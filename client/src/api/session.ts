import { User } from '../types';

/**
 * Single owner of what the app keeps in browser storage for a signed-in user.
 * Everything a session writes is removed by clearSession(), so on a shared
 * machine (hostel common-room PC) the next person to sign in inherits nothing
 * from the previous one.
 */
const TOKEN_KEY = 'fixmaster_token';
const USER_KEY = 'fixmaster_user';
// Time of the last user interaction, shared by every tab (idle sign-out).
const ACTIVITY_KEY = 'fixmaster_last_activity';
// Written by earlier versions of the app (a per-browser room cache that was
// shared across every account on the machine). Cleared on sign-in/out so
// stale copies don't linger.
const LEGACY_KEYS = ['fixmaster_student_allotment'];

/** Storage key of the session token, for cross-tab change detection. */
export const SESSION_TOKEN_KEY = TOKEN_KEY;

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: User): void {
  LEGACY_KEYS.forEach((k) => localStorage.removeItem(k));
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  touchActivity();
}

export function touchActivity(at = Date.now()): void {
  localStorage.setItem(ACTIVITY_KEY, String(at));
}

/** Last recorded activity; a session with no record counts as active now. */
export function getLastActivity(): number {
  const value = Number(localStorage.getItem(ACTIVITY_KEY));
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

export function replaceToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession(): void {
  [TOKEN_KEY, USER_KEY, ACTIVITY_KEY, ...LEGACY_KEYS].forEach((k) => localStorage.removeItem(k));
}

/** True when the JWT's `exp` claim is in the past (or the token is unreadable). */
export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}
