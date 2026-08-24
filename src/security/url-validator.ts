export const URL_VALIDATION_ERROR_CODES = [
  'URL_REQUIRED',
  'URL_TOO_LONG',
  'URL_CONTROL_CHARACTERS',
  'URL_PROTOCOL_RELATIVE_NOT_ALLOWED',
  'URL_RELATIVE_NOT_ALLOWED',
  'URL_SCHEME_NOT_ALLOWED',
  'URL_CREDENTIALS_NOT_ALLOWED',
  'URL_HOST_NOT_ALLOWED',
  'URL_INVALID',
] as const;

export type UrlValidationErrorCode = (typeof URL_VALIDATION_ERROR_CODES)[number];

export interface UrlValidationOptions {
  /** Allows same-origin root paths such as `/projects/123`; `//host/path` is never allowed. */
  readonly allowInternalRelative?: boolean;
  readonly allowedHosts?: readonly string[];
  readonly allowSubdomainsOfAllowedHosts?: boolean;
  readonly maxLength?: number;
}

export interface ValidUrl {
  readonly valid: true;
  readonly normalizedUrl: string;
  readonly kind: 'https' | 'internal-relative';
}

export interface InvalidUrl {
  readonly valid: false;
  readonly code: UrlValidationErrorCode;
  readonly message: string;
}

export type UrlValidationResult = ValidUrl | InvalidUrl;

const explicitScheme = /^[a-z][a-z\d+.-]*:/iu;
const defaultMaximumLength = 2_048;

/**
 * Central URL trust policy: HTTPS is the only external scheme. Callers may
 * additionally opt into same-origin, root-relative application paths.
 */
export function validateSafeUrl(
  input: unknown,
  options: UrlValidationOptions = {},
): UrlValidationResult {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return invalid('URL_REQUIRED', 'A URL is required.');
  }

  const candidate = input.trim();
  if (candidate.length > (options.maxLength ?? defaultMaximumLength)) {
    return invalid('URL_TOO_LONG', 'The URL is too long.');
  }
  if (containsControlCharacters(candidate)) {
    return invalid('URL_CONTROL_CHARACTERS', 'The URL contains invalid control characters.');
  }
  if (candidate.startsWith('//') || candidate.startsWith('\\')) {
    return invalid(
      'URL_PROTOCOL_RELATIVE_NOT_ALLOWED',
      'Protocol-relative URLs are not allowed.',
    );
  }

  if (!explicitScheme.test(candidate)) {
    return validateInternalPath(candidate, options);
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return invalid('URL_INVALID', 'The URL is invalid.');
  }

  if (parsed.protocol !== 'https:') {
    return invalid('URL_SCHEME_NOT_ALLOWED', 'Only HTTPS URLs are allowed.');
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return invalid('URL_CREDENTIALS_NOT_ALLOWED', 'URLs containing credentials are not allowed.');
  }
  if (parsed.hostname.length === 0) {
    return invalid('URL_INVALID', 'The URL must include a host.');
  }
  if (!hostIsAllowed(parsed.hostname, options)) {
    return invalid('URL_HOST_NOT_ALLOWED', 'The URL host is not allowed.');
  }

  return Object.freeze({
    valid: true,
    normalizedUrl: parsed.href,
    kind: 'https',
  });
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 31 || codePoint === 127) {
      return true;
    }
  }
  return false;
}

function validateInternalPath(
  candidate: string,
  options: UrlValidationOptions,
): UrlValidationResult {
  if (!options.allowInternalRelative) {
    return invalid('URL_RELATIVE_NOT_ALLOWED', 'Relative URLs are not allowed.');
  }
  if (!candidate.startsWith('/') || candidate.includes('\\')) {
    return invalid(
      'URL_RELATIVE_NOT_ALLOWED',
      'Only root-relative internal paths are allowed.',
    );
  }

  try {
    const base = new URL('https://internal.invalid/');
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) {
      return invalid(
        'URL_PROTOCOL_RELATIVE_NOT_ALLOWED',
        'Protocol-relative URLs are not allowed.',
      );
    }
    return Object.freeze({
      valid: true,
      normalizedUrl: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      kind: 'internal-relative',
    });
  } catch {
    return invalid('URL_INVALID', 'The URL is invalid.');
  }
}

function hostIsAllowed(hostname: string, options: UrlValidationOptions): boolean {
  if (options.allowedHosts === undefined) {
    return true;
  }

  const normalizedHostname = hostname.toLowerCase().replace(/\.$/u, '');
  return options.allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = allowedHost.toLowerCase().replace(/\.$/u, '');
    if (normalizedHostname === normalizedAllowedHost) {
      return true;
    }
    return options.allowSubdomainsOfAllowedHosts === true
      && normalizedHostname.endsWith(`.${normalizedAllowedHost}`);
  });
}

function invalid(code: UrlValidationErrorCode, message: string): InvalidUrl {
  return Object.freeze({ valid: false, code, message });
}

export class UnsafeUrlError extends Error {
  readonly code: UrlValidationErrorCode;

  constructor(result: InvalidUrl) {
    super(result.message);
    this.name = 'UnsafeUrlError';
    this.code = result.code;
  }
}

export function assertSafeUrl(input: unknown, options: UrlValidationOptions = {}): string {
  const result = validateSafeUrl(input, options);
  if (!result.valid) {
    throw new UnsafeUrlError(result);
  }
  return result.normalizedUrl;
}

export function isSafeUrl(input: unknown, options: UrlValidationOptions = {}): input is string {
  return validateSafeUrl(input, options).valid;
}

/** Short alias for callers that prefer policy-neutral naming. */
export const validateUrl = validateSafeUrl;
