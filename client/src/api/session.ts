import { User } from '../types';

/**
 * Single owner of what the app keeps in browser storage for a signed-in user.
 * Everything a session writes is removed by clearSession(), so on a shared
 * machine (hostel common-room PC) the next person to sign in inherits nothing
 * from the previous one.
 */
const TOKEN_KEY = 'fixmaster_token';
const USER_KEY = 'fixmaster_user';
// Written by earlier versions of the app (a per-browser room cache that was
// shared across every account on the machine). Cleared on sign-in/out so
// stale copies don't linger.
const LEGACY_KEYS = ['fixmaster_student_allotment'];

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
}

export function replaceToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession(): void {
  [TOKEN_KEY, USER_KEY, ...LEGACY_KEYS].forEach((k) => localStorage.removeItem(k));
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
