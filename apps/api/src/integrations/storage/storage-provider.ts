import { AppError } from '../../errors/app-error';

/**
 * The platform's object-storage contract. Originals, derivatives and tiles are
 * addressed by opaque logical keys; nothing in the application layer may assume
 * a filesystem path, a bucket name, or a publicly reachable URL.
 */
export interface StoredObject {
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string | undefined;
  readonly sizeBytes: number;
  /** Provider-side metadata recorded at write time, for example the checksum. */
  readonly metadata: Readonly<Record<string, string | undefined>>;
  readonly createdAt: Date;
}

export interface PutObjectOptions {
  readonly contentType?: string;
  /**
   * Immutable objects may be created once. A second write of identical bytes is
   * a no-op; a write of different bytes fails with `IMMUTABLE_OBJECT_EXISTS`.
   */
  readonly immutable?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface PutObjectResult {
  readonly key: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
}

export interface StorageProvider {
  put(key: string, body: Buffer, options?: PutObjectOptions): Promise<PutObjectResult>;
  get(key: string): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  /** Deleting a key that is already absent must succeed. */
  delete(key: string): Promise<void>;
}

const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const MAX_KEY_LENGTH = 512;

export function invalidStorageKey(key: string, reason: string): AppError {
  return new AppError('INVALID_STORAGE_KEY', 'The storage key is not valid.', {
    status: 500,
    details: { reason, keyLength: key.length }
  });
}

/**
 * Normalizes and validates a logical key. Traversal segments are rejected
 * outright rather than resolved away, so a caller can never reach outside the
 * storage root even when a key is assembled from user-influenced values. Dots
 * inside a segment stay legal: `lobby..final.jpg` is an ordinary filename.
 */
export function normalizeStorageKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) {
    throw invalidStorageKey(String(key), 'empty');
  }
  if (key.length > MAX_KEY_LENGTH) throw invalidStorageKey(key, 'too-long');
  if (key.includes('\0') || key.includes('\\')) throw invalidStorageKey(key, 'illegal-character');
  const segments = key.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw invalidStorageKey(key, 'traversal-or-empty-segment');
    }
    if (!SEGMENT_PATTERN.test(segment)) throw invalidStorageKey(key, 'unsupported-segment');
  }
  return segments.join('/');
}

export function storageObjectNotFound(key: string): AppError {
  return new AppError('STORAGE_OBJECT_NOT_FOUND', 'The stored media object is no longer available.', {
    status: 404,
    details: { keyLength: key.length }
  });
}

export function immutableObjectExists(key: string): AppError {
  return new AppError('IMMUTABLE_OBJECT_EXISTS', 'A different object already exists at this key.', {
    status: 409,
    details: { keyLength: key.length }
  });
}

/** Provider metadata is a flat string map; anything richer is JSON encoded. */
export function normalizeObjectMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(metadata ?? {})) {
    if (value === undefined || value === null) continue;
    normalized[name] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return normalized;
}
