import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../apps/api/src/config';

describe('configuration safety', () => {
  it.each([
    'development-only-secret-change-me-now',
    'replace-with-at-least-32-random-characters'
  ])('rejects a known JWT placeholder in production: %s', (jwtSecret) => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: jwtSecret
    })).toThrow();
  });

  it('accepts an explicitly supplied production signing secret', () => {
    expect(loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'a-genuinely-random-production-secret-value-1234567890'
    }).nodeEnv).toBe('production');
  });
});
