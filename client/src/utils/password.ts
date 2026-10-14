/**
 * Mirrors the server's password policy (src/middleware/validators.js) so a
 * form can explain a problem before submitting. The server stays the
 * authority; this is only for faster, friendlier feedback.
 */
const COMMON = new Set([
  'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1', 'qwerty123', 'qwerty12',
  'abc12345', 'abcd1234', 'abcdef12', 'admin123', 'admin1234', 'welcome1', 'welcome123', 'letmein1',
  'iloveyou1', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'test1234', 'vit12345', 'hostel123', 'student123',
]);

export const PASSWORD_HINT = 'At least 8 characters, including a letter and a number.';

/** Returns a message describing what is wrong, or null when the password is acceptable. */
export function passwordProblem(password: string, accountId?: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (new TextEncoder().encode(password).length > 72) return 'Use at most 72 bytes.';
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'Include at least one letter and one number.';
  if (COMMON.has(password.toLowerCase())) return 'This password is too common. Choose a less predictable one.';
  const id = accountId?.trim().toUpperCase();
  if (id && password.toUpperCase().includes(id)) return 'The password must not contain the account ID.';
  return null;
}

export type PasswordStrength = { score: 0 | 1 | 2 | 3; label: string };

/** A rough strength read-out for a form; the server's policy stays the authority. */
export function passwordStrength(password: string): PasswordStrength {
  if (!password) return { score: 0, label: '' };
  let points = 0;
  if (password.length >= 8) points++;
  if (password.length >= 12) points++;
  if (/\p{Ll}/u.test(password) && /\p{Lu}/u.test(password)) points++;
  if (/\d/.test(password) && /[^\p{L}\d]/u.test(password)) points++;
  const score = (passwordProblem(password) ? Math.min(points, 1) : Math.max(1, Math.min(points - 1, 3))) as 0 | 1 | 2 | 3;
  return { score, label: ['', 'Weak', 'Good', 'Strong'][score] };
}
