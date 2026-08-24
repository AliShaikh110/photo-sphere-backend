import type { RequestHandler } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from '../errors/app-error';

type AccessClaims = JwtPayload & { sub: string; email: string; tokenType: 'access' };

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

export function decodeAccessToken(token: string): AccessClaims {
  let value: string | JwtPayload;
  try {
    value = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'sphere-backend',
      audience: 'sphere-creator'
    });
  } catch {
    throw new AppError('AUTHENTICATION_REQUIRED', 'A valid access token is required.', { status: 401 });
  }
  if (
    typeof value === 'string' ||
    typeof value.sub !== 'string' ||
    typeof value.email !== 'string' ||
    value.tokenType !== 'access'
  ) {
    throw new AppError('INVALID_ACCESS_TOKEN', 'The access token is invalid.', { status: 401 });
  }
  return value as AccessClaims;
}

export const requireAuth: RequestHandler = (request, _response, next) => {
  const token = bearerToken(request.header('authorization'));
  if (!token) {
    next(new AppError('AUTHENTICATION_REQUIRED', 'Authentication is required.', { status: 401 }));
    return;
  }
  try {
    const claims = decodeAccessToken(token);
    request.auth = { userId: claims.sub, email: claims.email };
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Gates operator surfaces such as the extension registry and the viewer
 * integration rollout. The role is read from the database on every request, so
 * revoking it takes effect immediately rather than at the next token refresh.
 */
export const requirePlatformAdmin: RequestHandler = (request, _response, next) => {
  const userId = request.auth?.userId;
  if (userId === undefined) {
    next(new AppError('AUTHENTICATION_REQUIRED', 'Authentication is required.', { status: 401 }));
    return;
  }
  void (async () => {
    try {
      const { User } = await import('../models');
      const user = await User.findByPk(userId, { attributes: ['id', 'platformRole', 'status'] });
      if (!user || user.status !== 'active' || user.platformRole !== 'platform_admin') {
        next(new AppError('PLATFORM_ADMIN_REQUIRED', 'You do not have access to this resource.', {
          status: 403
        }));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  })();
};

export const optionalAuth: RequestHandler = (request, _response, next) => {
  const token = bearerToken(request.header('authorization'));
  if (!token) {
    next();
    return;
  }
  try {
    const claims = decodeAccessToken(token);
    request.auth = { userId: claims.sub, email: claims.email };
    next();
  } catch (error) {
    next(error);
  }
};
