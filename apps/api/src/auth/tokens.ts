import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from '../errors/app-error';

export function createAccessToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { email: user.email, tokenType: 'access' },
    config.jwtSecret,
    {
      subject: user.id,
      expiresIn: config.jwtExpiresIn as NonNullable<SignOptions['expiresIn']>,
      algorithm: 'HS256',
      issuer: 'sphere-backend',
      audience: 'sphere-creator'
    }
  );
}

type MediaTokenPayload = {
  tokenType: 'media';
  derivativeId: string;
  publicationId?: string;
};

export function createMediaToken(options: {
  derivativeId: string;
  publicationId?: string;
}): string {
  const payload: MediaTokenPayload = {
    tokenType: 'media',
    derivativeId: options.derivativeId,
    ...(options.publicationId === undefined ? {} : { publicationId: options.publicationId })
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.signedMediaTtlSeconds,
    algorithm: 'HS256',
    issuer: 'sphere-backend',
    audience: 'sphere-media'
  });
}

export function verifyMediaToken(token: string, derivativeId: string): MediaTokenPayload {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'sphere-backend',
      audience: 'sphere-media'
    });
  } catch {
    throw new AppError('MEDIA_ACCESS_DENIED', 'The media access link is invalid or expired.', { status: 403 });
  }
  if (
    typeof decoded === 'string' ||
    decoded.tokenType !== 'media' ||
    decoded.derivativeId !== derivativeId
  ) {
    throw new AppError('MEDIA_ACCESS_DENIED', 'The media access link is invalid or expired.', { status: 403 });
  }
  return decoded as MediaTokenPayload;
}

export type TelemetryTokenPayload = {
  tokenType: 'telemetry';
  experienceId: string;
  publicationRevision: number;
  viewerIntegrationVersion: string;
};

/**
 * Scopes a visitor's telemetry to the exact publication they were served.
 *
 * A published manifest hands every visitor its experience id, publication
 * revision and viewer integration version, so those three fields alone cannot
 * establish that an event came from a real playback session. This token is
 * minted when a manifest is resolved and is the thing ingestion trusts.
 */
export function createTelemetryToken(options: {
  experienceId: string;
  publicationRevision: number;
  viewerIntegrationVersion: string;
}): string {
  const payload: TelemetryTokenPayload = {
    tokenType: 'telemetry',
    experienceId: options.experienceId,
    publicationRevision: options.publicationRevision,
    viewerIntegrationVersion: options.viewerIntegrationVersion
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.telemetryTokenTtlSeconds,
    algorithm: 'HS256',
    issuer: 'sphere-backend',
    audience: 'sphere-telemetry'
  });
}

export function verifyTelemetryToken(token: string): TelemetryTokenPayload {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'sphere-backend',
      audience: 'sphere-telemetry'
    });
  } catch {
    throw new AppError('TELEMETRY_TOKEN_INVALID', 'The telemetry session token is invalid or expired.', {
      status: 401
    });
  }
  if (
    typeof decoded === 'string'
    || decoded.tokenType !== 'telemetry'
    || typeof decoded.experienceId !== 'string'
    || typeof decoded.publicationRevision !== 'number'
    || typeof decoded.viewerIntegrationVersion !== 'string'
  ) {
    throw new AppError('TELEMETRY_TOKEN_INVALID', 'The telemetry session token is invalid or expired.', {
      status: 401
    });
  }
  return decoded as TelemetryTokenPayload;
}

export type EditorSessionRole = 'viewer' | 'editor' | 'admin' | 'owner';

export type EditorSessionTokenPayload = {
  tokenType: 'editor-session';
  projectId: string;
  userId: string;
  role: EditorSessionRole;
};

/**
 * A short-lived credential scoped to one project, for the three paths a
 * browser must reach directly: media, the event stream and telemetry.
 *
 * The creator's bearer token is never handed to browser JavaScript. This
 * mirrors the pattern already used for playback, where a signed media URL —
 * not a bearer token — is the capability the player holds. It grants nothing
 * the caller could not already do, and it expires quickly.
 */
export function createEditorSessionToken(options: {
  projectId: string;
  userId: string;
  role: EditorSessionRole;
}): string {
  const payload: EditorSessionTokenPayload = {
    tokenType: 'editor-session',
    projectId: options.projectId,
    userId: options.userId,
    role: options.role
  };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.editorSessionTtlSeconds,
    algorithm: 'HS256',
    issuer: 'sphere-backend',
    audience: 'sphere-editor'
  });
}

export function verifyEditorSessionToken(token: string): EditorSessionTokenPayload {
  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'sphere-backend',
      audience: 'sphere-editor'
    });
  } catch {
    throw new AppError('EDITOR_SESSION_INVALID', 'The editing session is invalid or expired.', {
      status: 401
    });
  }
  if (
    typeof decoded === 'string'
    || decoded.tokenType !== 'editor-session'
    || typeof decoded.projectId !== 'string'
    || typeof decoded.userId !== 'string'
    || typeof decoded.role !== 'string'
  ) {
    throw new AppError('EDITOR_SESSION_INVALID', 'The editing session is invalid or expired.', {
      status: 401
    });
  }
  return decoded as EditorSessionTokenPayload;
}
