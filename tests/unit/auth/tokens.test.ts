import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import {
  createMediaToken,
  createTelemetryToken,
  verifyTelemetryToken
} from '../../../src/auth/tokens';
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

describe('telemetry-session token', () => {
  const session = {
    experienceId: '00000000-0000-4000-8000-0000000000aa',
    publicationRevision: 3,
    viewerIntegrationVersion: 'psv-5.14.3-adapter-2'
  };

  it('round-trips the publication it is scoped to', () => {
    expect(verifyTelemetryToken(createTelemetryToken(session))).toMatchObject({
      tokenType: 'telemetry',
      ...session
    });
  });

  it('refuses a token minted for another audience or by another signer', () => {
    const media = createMediaToken({ derivativeId: '00000000-0000-4000-8000-0000000000bb' });
    expect(() => verifyTelemetryToken(media)).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_TOKEN_INVALID' })
    );

    const forged = jwt.sign({ tokenType: 'telemetry', ...session }, 'a-different-signing-secret-32ch', {
      algorithm: 'HS256',
      issuer: 'sphere-backend',
      audience: 'sphere-telemetry'
    });
    expect(() => verifyTelemetryToken(forged)).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_TOKEN_INVALID' })
    );
  });

  it('refuses a token whose scope claims are missing', () => {
    const incomplete = jwt.sign({ tokenType: 'telemetry' }, config.jwtSecret, {
      algorithm: 'HS256',
      issuer: 'sphere-backend',
      audience: 'sphere-telemetry'
    });
    expect(() => verifyTelemetryToken(incomplete)).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_TOKEN_INVALID' })
    );
  });

  it('expires, so a token cannot report against a publication forever', () => {
    const expired = jwt.sign({ tokenType: 'telemetry', ...session }, config.jwtSecret, {
      algorithm: 'HS256',
      issuer: 'sphere-backend',
      audience: 'sphere-telemetry',
      expiresIn: -1
    });
    expect(() => verifyTelemetryToken(expired)).toThrowError(
      expect.objectContaining({ code: 'TELEMETRY_TOKEN_INVALID' })
    );
  });
});
