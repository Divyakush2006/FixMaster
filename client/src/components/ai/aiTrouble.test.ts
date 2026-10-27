import { describe, it, expect } from 'vitest';
import { aiTrouble } from './AiHealthBanner';
import type { AiHealthStatus } from '../../types';

const provider = (over: Record<string, unknown>) => ({
  provider: 'groq',
  configured: true,
  keys_total: 3,
  keys_available: 3,
  breaker_open: false,
  used_today: 5,
  daily_limit: 1000,
  ok_last_hour: 10,
  failed_last_hour: 0,
  last_ok_at: null,
  last_error: null,
  ...over,
});
const health = (providers: Array<Record<string, unknown>>) => ({ status: 'DEGRADED', drill: null, providers, routes: {} }) as unknown as AiHealthStatus;

describe('aiTrouble', () => {
  it('names the provider that keeps failing and the one covering for it', () => {
    const text = aiTrouble(health([provider({}), provider({ provider: 'gemini', ok_last_hour: 0, failed_last_hour: 4, last_error: 'The provider did not answer in time.' })]));
    expect(text).toBe('Gemini kept failing (The provider did not answer in time). Groq is covering.');
  });

  it('says why a provider is set aside', () => {
    expect(aiTrouble(health([provider({ breaker_open: true }), provider({ provider: 'gemini' })]))).toContain('Groq is paused after repeated errors');
    expect(aiTrouble(health([provider({ used_today: 1000 }), provider({ provider: 'gemini' })]))).toContain('Groq has used today’s allowance');
    expect(aiTrouble(health([provider({ keys_available: 0 }), provider({ provider: 'gemini' })]))).toContain('Groq has hit its rate limit');
  });

  it('falls back to a general line when nothing in particular stands out', () => {
    expect(aiTrouble(health([provider({})]))).toBe('Some AI providers are unavailable; others are covering.');
  });
});
