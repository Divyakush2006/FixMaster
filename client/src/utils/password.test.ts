import { describe, it, expect } from 'vitest';
import { passwordProblem } from './password';

describe('passwordProblem (mirrors the server policy)', () => {
  it('accepts a reasonable password', () => {
    expect(passwordProblem('Corridor7Lamp', '24BCE0001')).toBeNull();
  });
  it('rejects short, letter-only, digit-only, common and ID-containing passwords', () => {
    expect(passwordProblem('Ab1')).toMatch(/8 characters/);
    expect(passwordProblem('abcdefgh')).toMatch(/letter and one number/);
    expect(passwordProblem('12345678')).toMatch(/letter and one number/);
    expect(passwordProblem('Password123')).toMatch(/too common/);
    expect(passwordProblem('my24bce0001pw', '24BCE0001')).toMatch(/account ID/);
  });
});
