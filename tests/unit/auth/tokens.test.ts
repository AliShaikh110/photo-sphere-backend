import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { config } from '../../../src/config';
import { decodeAccessToken } from '../../../src/middlewares/auth';

const claims = { email: 'owner@example.test', tokenType: 'access' };

describe('access-token trust boundary', () => {
  it('accepts only the expected issuer and audience', () => {
    const valid = jwt.sign(claims, config.jwtSecret, {
      algorithm: 'HS256',
      subject: '00000000-0000-4000-8000-000000000001',
      issuer: 'sphere-backend',
      audience: 'sphere-creator'
    });
    expect(decodeAccessToken(valid).sub).toBe('00000000-0000-4000-8000-000000000001');

    for (const options of [
      { issuer: 'another-service', audience: 'sphere-creator' },
      { issuer: 'sphere-backend', audience: 'another-client' }
    ]) {
      const token = jwt.sign(claims, config.jwtSecret, {
        algorithm: 'HS256',
        subject: '00000000-0000-4000-8000-000000000001',
        ...options
      });
      expect(() => decodeAccessToken(token)).toThrowError(
        expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED' })
      );
    }
  });
});
