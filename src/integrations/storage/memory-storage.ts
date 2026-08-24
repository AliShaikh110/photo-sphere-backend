import { sha256 } from '../../utils/hash';
import {
  immutableObjectExists,
  normalizeObjectMetadata,
  normalizeStorageKey,
  storageObjectNotFound,
  type PutObjectOptions,
  type PutObjectResult,
  type StorageProvider,
  type StoredObject
} from './storage-provider';

interface MemoryRecord {
  readonly body: Buffer;
  readonly contentType: string | undefined;
  readonly metadata: Record<string, string>;
  readonly immutable: boolean;
  readonly createdAt: Date;
}

/**
 * In-process storage for tests and controlled diagnostics. It honours the same
 * immutability and key rules as the durable providers so a test cannot pass
 * against semantics production does not have.
 */
export class MemoryStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, MemoryRecord>();

  async put(key: string, body: Buffer, options: PutObjectOptions = {}): Promise<PutObjectResult> {
    const normalized = normalizeStorageKey(key);
    const checksum = sha256(body);
    const existing = this.objects.get(normalized);
    if (options.immutable === true && existing !== undefined) {
      if (sha256(existing.body) !== checksum) throw immutableObjectExists(key);
      return { key: normalized, sizeBytes: body.byteLength, checksumSha256: checksum };
    }
    this.objects.set(normalized, {
      body: Buffer.from(body),
      contentType: options.contentType,
      metadata: { checksumSha256: checksum, ...normalizeObjectMetadata(options.metadata) },
      immutable: options.immutable === true,
      createdAt: new Date()
    });
    return { key: normalized, sizeBytes: body.byteLength, checksumSha256: checksum };
  }

  async get(key: string): Promise<StoredObject> {
    const normalized = normalizeStorageKey(key);
    const record = this.objects.get(normalized);
    if (record === undefined) throw storageObjectNotFound(key);
    return {
      key: normalized,
      body: Buffer.from(record.body),
      contentType: record.contentType,
      sizeBytes: record.body.byteLength,
      metadata: record.metadata,
      createdAt: record.createdAt
    };
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(normalizeStorageKey(key));
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(normalizeStorageKey(key));
  }

  /** Test affordance: the logical keys currently held. */
  keys(): string[] {
    return [...this.objects.keys()].sort();
  }
}
