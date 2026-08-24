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
