import {
  DEFAULT_MEDIA_DELIVERY_POLICY,
  formatMediaLocation
} from '@alishaikh110/experience-compiler';

import { createMediaToken } from '../auth/tokens';
import { config } from '../config';
import { AppError } from '../errors/app-error';
import { incrementMetric } from '../observability';
import { authorizeDerivative } from './experience-service';

export interface RefreshedMediaUrl {
  readonly assetId: string;
  readonly derivativeId: string;
  readonly kind: string;
  readonly url: string;
  readonly expiresAt: string;
}

/**
 * Reissues expiring media URLs without recompiling.
 *
 * A long editing session outlives the signatures it started with. Reloading
 * the editor or recompiling the experience to get fresh ones would be absurd,
 * so this route exists — and grants nothing: authorization is re-checked
 * against each derivative on every call, exactly as the media route itself
 * would, so a caller can only refresh what it could already fetch.
 */
export async function refreshMediaUrls(options: {
  derivativeIds: readonly string[];
  actorUserId: string;
}): Promise<{ readonly media: RefreshedMediaUrl[] }> {
  if (options.derivativeIds.length > config.mediaTokenRefreshMax) {
    throw new AppError('TOO_MANY_DERIVATIVES', 'Too many media references in one request.', {
      status: 422,
      path: 'derivativeIds',
      details: { maximum: config.mediaTokenRefreshMax }
    });
  }
  const expiresAt = new Date(Date.now() + config.signedMediaTtlSeconds * 1000).toISOString();
  const media: RefreshedMediaUrl[] = [];
  const unique = [...new Set(options.derivativeIds)];
  for (const derivativeId of unique) {
    let derivative;
    try {
      derivative = await authorizeDerivative(derivativeId, options.actorUserId);
    } catch (error) {
      incrementMetric('media.token.denied', {
        reason: error instanceof AppError ? error.code : 'unknown'
      });
      throw error;
    }
    const path = formatMediaLocation(DEFAULT_MEDIA_DELIVERY_POLICY, {
      access: 'protected',
      experienceId: derivative.asset?.projectId ?? '',
      assetId: derivative.assetId,
      derivativeId: derivative.id
    });
    const token = createMediaToken({ derivativeId: derivative.id });
    media.push({
      assetId: derivative.assetId,
      derivativeId: derivative.id,
      kind: derivative.kind,
      url: `${path}?token=${encodeURIComponent(token)}`,
      expiresAt
    });
  }
  incrementMetric('media.token.refreshed', { surface: 'editor' });
  return { media };
}
