import { AppError } from '../errors/app-error';
import type { JsonObject } from '../models/model.types';

/**
 * Where a published experience may be framed, and what the origin should send
 * as its content security policy.
 *
 * This is product data — "which sites may embed my tour" — not renderer or
 * hosting configuration. It is authored on the project, frozen onto each
 * publication, and translated into headers at delivery time.
 */
export interface EmbedPolicy {
  /** `anywhere` keeps the open default; `allowlist` restricts framing origins. */
  readonly mode: 'anywhere' | 'allowlist' | 'disabled';
  readonly allowedOrigins: readonly string[];
  /** Additional origins permitted to read the manifest cross-origin. */
  readonly allowedApiOrigins: readonly string[];
}

export const DEFAULT_EMBED_POLICY: EmbedPolicy = Object.freeze({
  mode: 'anywhere',
  allowedOrigins: Object.freeze([]),
  allowedApiOrigins: Object.freeze([])
}) as EmbedPolicy;

const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/iu;
const MAX_ORIGINS = 50;

/**
 * Accepts only a scheme/host/port origin. A path, wildcard or credential in an
 * allowlist entry would silently widen the policy, so it is rejected instead.
 */
export function normalizeEmbedOrigin(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new AppError('INVALID_EMBED_ORIGIN', 'An allowed origin must be a URL origin.', {
      status: 422,
      path
    });
  }
  const trimmed = value.trim().replace(/\/$/, '');
  if (!ORIGIN_PATTERN.test(trimmed)) {
    throw new AppError(
      'INVALID_EMBED_ORIGIN',
      'Use a site address such as https://example.com, without a path or wildcard.',
      { status: 422, path, details: { value: trimmed.slice(0, 200) } }
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError('INVALID_EMBED_ORIGIN', 'That site address is not valid.', {
      status: 422,
      path
    });
  }
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new AppError('INVALID_EMBED_ORIGIN', 'Use only the site address, without a path.', {
      status: 422,
      path
    });
  }
  return parsed.origin.toLowerCase();
}

export function normalizeEmbedPolicy(input: unknown, path = 'embedPolicy'): EmbedPolicy {
  if (input === undefined || input === null) return DEFAULT_EMBED_POLICY;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('INVALID_EMBED_POLICY', 'The embed settings are not valid.', {
      status: 422,
      path
    });
  }
  const record = input as Record<string, unknown>;
  const mode = record.mode ?? 'anywhere';
  if (mode !== 'anywhere' && mode !== 'allowlist' && mode !== 'disabled') {
    throw new AppError('INVALID_EMBED_POLICY', 'Choose where this experience may be embedded.', {
      status: 422,
      path: `${path}.mode`
    });
  }
  const readOrigins = (value: unknown, originPath: string): string[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      throw new AppError('INVALID_EMBED_POLICY', 'Allowed sites must be a list.', {
        status: 422,
        path: originPath
      });
    }
    if (value.length > MAX_ORIGINS) {
      throw new AppError('INVALID_EMBED_POLICY', `Add at most ${MAX_ORIGINS} sites.`, {
        status: 422,
        path: originPath
      });
    }
    return [...new Set(value.map((entry, index) => normalizeEmbedOrigin(entry, `${originPath}[${index}]`)))];
  };
  const allowedOrigins = readOrigins(record.allowedOrigins, `${path}.allowedOrigins`);
  const allowedApiOrigins = readOrigins(record.allowedApiOrigins, `${path}.allowedApiOrigins`);
  if (mode === 'allowlist' && allowedOrigins.length === 0) {
    throw new AppError(
      'INVALID_EMBED_POLICY',
      'Add at least one site, or allow embedding anywhere.',
      { status: 422, path: `${path}.allowedOrigins` }
    );
  }
  return { mode, allowedOrigins, allowedApiOrigins };
}

/** Reads a stored policy, tolerating rows written before the policy existed. */
export function resolveEmbedPolicy(stored: unknown): EmbedPolicy {
  try {
    return normalizeEmbedPolicy(stored);
  } catch {
    return DEFAULT_EMBED_POLICY;
  }
}

export function embedPolicyToJson(policy: EmbedPolicy): JsonObject {
  return {
    mode: policy.mode,
    allowedOrigins: [...policy.allowedOrigins],
    allowedApiOrigins: [...policy.allowedApiOrigins]
  };
}

/**
 * The `frame-ancestors` directive for a published experience. `'none'` blocks
 * framing entirely; an allowlist names the permitted embedding sites.
 */
export function frameAncestorsDirective(policy: EmbedPolicy): string {
  if (policy.mode === 'disabled') return "'none'";
  if (policy.mode === 'allowlist') return ["'self'", ...policy.allowedOrigins].join(' ');
  return '*';
}

export function contentSecurityPolicyHeader(policy: EmbedPolicy): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestorsDirective(policy)}`
  ].join('; ');
}

export interface EmbedOriginDecision {
  readonly allowed: boolean;
  readonly reason: 'no-origin' | 'policy-open' | 'origin-allowed' | 'origin-denied' | 'embedding-disabled';
}

/**
 * Decides whether a cross-origin caller may read this experience. A same-origin
 * or direct navigation carries no `Origin` header and is always allowed: the
 * allowlist restricts embedding, not the canonical link.
 */
export function evaluateEmbedOrigin(
  policy: EmbedPolicy,
  origin: string | undefined
): EmbedOriginDecision {
  const normalized = typeof origin === 'string' && origin !== 'null'
    ? origin.trim().toLowerCase().replace(/\/$/, '')
    : undefined;
  if (normalized === undefined) {
    return { allowed: policy.mode !== 'disabled', reason: policy.mode === 'disabled' ? 'embedding-disabled' : 'no-origin' };
  }
  if (policy.mode === 'disabled') return { allowed: false, reason: 'embedding-disabled' };
  if (policy.mode === 'anywhere') return { allowed: true, reason: 'policy-open' };
  const permitted = new Set([...policy.allowedOrigins, ...policy.allowedApiOrigins]);
  return permitted.has(normalized)
    ? { allowed: true, reason: 'origin-allowed' }
    : { allowed: false, reason: 'origin-denied' };
}

export function embedOriginDenied(): AppError {
  return new AppError('EMBED_ORIGIN_DENIED', 'This experience cannot be embedded on this site.', {
    status: 403
  });
}
