import { isIP } from 'node:net';

import { AppError } from '../../errors/app-error';
import { validateSafeUrl } from '../../security/url-validator';
import type { JsonObject } from '../../models/model.types';

/**
 * Live 360 input.
 *
 * The transport is a deployment decision, so the platform defines only the
 * contract: authorize a source, validate it against an allow-list, resolve a
 * runtime playback reference, check health, and revoke. No streaming vendor is
 * assumed, and no provider may fetch an operator-supplied URL on its own.
 */

export type LiveSourceKind = 'rtmp-ingest' | 'hls-pull' | 'webrtc' | 'media-stream';

export interface LiveSourceRequest {
  readonly projectId: string;
  readonly kind: LiveSourceKind;
  /** Only used by pull-based kinds; must resolve to an allow-listed host. */
  readonly sourceUrl?: string;
  readonly requestedByUserId: string;
}

export interface LiveSourceAuthorization {
  readonly sourceId: string;
  readonly kind: LiveSourceKind;
  /** Where the broadcaster publishes, when the provider is ingest-based. */
  readonly ingestUrl?: string;
  readonly expiresAt: string;
}

export interface LiveSourceValidation {
  readonly valid: boolean;
  readonly reason?: string;
  readonly diagnostics: JsonObject;
}

export interface ResolvedLiveSource {
  readonly sourceId: string;
  /** The playback reference the compiled manifest may hand to a player. */
  readonly playbackUrl: string;
  readonly mimeType: string;
  readonly expiresAt: string;
}

export interface LiveSourceHealth {
  readonly sourceId: string;
  readonly status: 'live' | 'idle' | 'degraded' | 'unavailable';
  readonly checkedAt: string;
  readonly diagnostics: JsonObject;
}

export interface LiveSourceProvider {
  readonly id: string;
  readonly supportedKinds: readonly LiveSourceKind[];
  authorizeSource(request: LiveSourceRequest): Promise<LiveSourceAuthorization>;
  validateSource(request: LiveSourceRequest): Promise<LiveSourceValidation>;
  resolveRuntimeSource(sourceId: string): Promise<ResolvedLiveSource>;
  healthCheck(sourceId: string): Promise<LiveSourceHealth>;
  revoke(sourceId: string): Promise<void>;
}

export class LiveSourceUnsupportedError extends AppError {
  constructor(message = 'Live 360 input is not enabled on this deployment.') {
    super('LIVE_SOURCE_NOT_SUPPORTED', message, { status: 501 });
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata', 'metadata.google.internal']);

/**
 * Rejects any source URL that could reach the platform's own network.
 *
 * Literal private addresses and known metadata hosts are refused outright, and
 * an explicit host allow-list is required: without one, no pull source is
 * accepted at all. Providers must never follow an operator-supplied URL that
 * has not passed through here.
 */
export function assertAllowedLiveSourceUrl(
  sourceUrl: string,
  allowedHosts: readonly string[]
): URL {
  const validation = validateSafeUrl(sourceUrl, {
    allowedHosts,
    allowSubdomainsOfAllowedHosts: false
  });
  if (!validation.valid || validation.kind !== 'https') {
    throw new AppError('LIVE_SOURCE_NOT_ALLOWED', 'That stream address is not allowed.', {
      status: 422,
      path: 'sourceUrl',
      details: { reason: validation.valid ? 'scheme' : validation.code }
    });
  }
  if (allowedHosts.length === 0) {
    throw new AppError('LIVE_SOURCE_NOT_ALLOWED', 'No stream providers are configured.', {
      status: 422,
      path: 'sourceUrl'
    });
  }
  const parsed = new URL(validation.normalizedUrl);
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new AppError('LIVE_SOURCE_NOT_ALLOWED', 'That stream address is not allowed.', {
      status: 422,
      path: 'sourceUrl'
    });
  }
  if (isIP(hostname) !== 0 && isPrivateAddress(hostname)) {
    throw new AppError('LIVE_SOURCE_NOT_ALLOWED', 'That stream address is not allowed.', {
      status: 422,
      path: 'sourceUrl'
    });
  }
  return parsed;
}

function isPrivateAddress(hostname: string): boolean {
  if (isIP(hostname) === 6) {
    const address = hostname.toLowerCase();
    // Loopback, unique-local and link-local ranges.
    return address === '::1' || address.startsWith('fc') || address.startsWith('fd')
      || address.startsWith('fe80');
  }
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;
  const [first, second] = octets as [number, number, number, number];
  if (first === 10 || first === 127 || first === 0) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 169 && second === 254) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return first >= 224;
}

/**
 * The provider used until a streaming integration is approved. It performs the
 * full validation path so the security contract is exercised, then declines.
 */
export class UnavailableLiveSourceProvider implements LiveSourceProvider {
  readonly id = 'unavailable';
  readonly supportedKinds: readonly LiveSourceKind[] = [];

  private readonly allowedHosts: readonly string[];

  constructor(allowedHosts: readonly string[] = []) {
    this.allowedHosts = allowedHosts;
  }

  async authorizeSource(): Promise<LiveSourceAuthorization> {
    throw new LiveSourceUnsupportedError();
  }

  async validateSource(request: LiveSourceRequest): Promise<LiveSourceValidation> {
    if (request.sourceUrl !== undefined) {
      assertAllowedLiveSourceUrl(request.sourceUrl, this.allowedHosts);
    }
    return {
      valid: false,
      reason: 'No live 360 provider is configured.',
      diagnostics: { providerId: this.id, kind: request.kind }
    };
  }

  async resolveRuntimeSource(): Promise<ResolvedLiveSource> {
    throw new LiveSourceUnsupportedError();
  }

  async healthCheck(sourceId: string): Promise<LiveSourceHealth> {
    return {
      sourceId,
      status: 'unavailable',
      checkedAt: new Date().toISOString(),
      diagnostics: { providerId: this.id }
    };
  }

  async revoke(): Promise<void> {
    // Nothing was ever granted, so revocation is a no-op rather than an error.
  }
}
