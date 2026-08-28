import type { RequestHandler } from 'express';

/**
 * The public API versioning contract.
 *
 * The version lives in the path (`/api/v1/...`). A new major version is added
 * alongside the current one rather than changing it in place, and a version is
 * announced as deprecated through response headers well before it is removed,
 * so an integration always learns from the API itself.
 */
export const API_VERSION = 'v1' as const;

export interface ApiVersionDescriptor {
  readonly version: string;
  readonly status: 'current' | 'deprecated' | 'sunset';
  /** RFC 9745 deprecation date, when one has been announced. */
  readonly deprecatedAt?: string;
  /** RFC 8594 sunset date, after which the version stops responding. */
  readonly sunsetAt?: string;
  readonly documentationUrl: string;
}

export const SUPPORTED_API_VERSIONS: readonly ApiVersionDescriptor[] = Object.freeze([
  Object.freeze({
    version: 'v1',
    status: 'current' as const,
    documentationUrl: 'https://docs.invalid/sphere/api/v1'
  })
]);

const descriptorsByVersion = new Map(
  SUPPORTED_API_VERSIONS.map((descriptor) => [descriptor.version, descriptor])
);

/**
 * Advertises the version handling a request, and any deprecation timetable, on
 * every response. Clients can therefore detect a pending removal without
 * reading release notes.
 */
export function apiVersion(version: string): RequestHandler {
  const descriptor = descriptorsByVersion.get(version);
  return (_request, response, next) => {
    response.setHeader('x-api-version', version);
    if (descriptor?.status === 'deprecated' || descriptor?.status === 'sunset') {
      response.setHeader('deprecation', descriptor.deprecatedAt ?? 'true');
      if (descriptor.sunsetAt !== undefined) response.setHeader('sunset', descriptor.sunsetAt);
      response.setHeader('link', `<${descriptor.documentationUrl}>; rel="deprecation"`);
    }
    next();
  };
}
