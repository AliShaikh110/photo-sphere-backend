import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { sha256 } from '../../utils/hash';
import {
  immutableObjectExists,
  invalidStorageKey,
  normalizeObjectMetadata,
  normalizeStorageKey,
  storageObjectNotFound,
  type PutObjectOptions,
  type PutObjectResult,
  type StorageProvider,
  type StoredObject
} from './storage-provider';

interface SidecarRecord {
  readonly contentType?: string;
  readonly metadata: Record<string, string>;
  readonly sizeBytes: number;
  readonly immutable: boolean;
  readonly createdAt: string;
}

const SIDECAR_SUFFIX = '.meta.json';

/**
 * Private filesystem storage for development and single-host deployments.
 *
 * The root directory is never served statically: every byte reaches a visitor
 * through an authorized API route. Multi-host deployments replace this provider
 * with shared private object storage behind the same interface.
 */
export class LocalStorageProvider implements StorageProvider {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const normalized = normalizeStorageKey(key);
    const absolute = path.resolve(this.root, normalized);
    const rootWithSeparator = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;
    // Defence in depth: the key grammar already excludes traversal, but a
    // symlinked or case-folded root must not widen the write surface either.
    if (!absolute.startsWith(rootWithSeparator)) {
      throw invalidStorageKey(key, 'outside-storage-root');
    }
    return absolute;
  }

  private static sidecarPath(objectPath: string): string {
    return `${objectPath}${SIDECAR_SUFFIX}`;
  }

  private async readSidecar(objectPath: string): Promise<SidecarRecord | undefined> {
    try {
      const raw = await readFile(LocalStorageProvider.sidecarPath(objectPath), 'utf8');
      return JSON.parse(raw) as SidecarRecord;
    } catch {
      return undefined;
    }
  }

  async put(key: string, body: Buffer, options: PutObjectOptions = {}): Promise<PutObjectResult> {
    const objectPath = this.resolve(key);
    const checksum = sha256(body);
    if (options.immutable === true && (await this.exists(key))) {
      const existing = await readFile(objectPath);
      if (sha256(existing) !== checksum) throw immutableObjectExists(key);
      return { key: normalizeStorageKey(key), sizeBytes: body.byteLength, checksumSha256: checksum };
    }

    await mkdir(path.dirname(objectPath), { recursive: true });
    const sidecar: SidecarRecord = {
      ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
      metadata: { checksumSha256: checksum, ...normalizeObjectMetadata(options.metadata) },
      sizeBytes: body.byteLength,
      immutable: options.immutable === true,
      createdAt: new Date().toISOString()
    };
    // Write to a unique temporary name and rename, so a crashed or concurrent
    // write can never leave a half-written object visible under the real key.
    const temporaryPath = `${objectPath}.${randomUUID()}.partial`;
    try {
      await writeFile(temporaryPath, body, { mode: 0o600 });
      await writeFile(
        `${temporaryPath}${SIDECAR_SUFFIX}`,
        JSON.stringify(sidecar),
        { mode: 0o600 }
      );
      await rename(`${temporaryPath}${SIDECAR_SUFFIX}`, LocalStorageProvider.sidecarPath(objectPath));
      await rename(temporaryPath, objectPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      await rm(`${temporaryPath}${SIDECAR_SUFFIX}`, { force: true });
      throw error;
    }
    return { key: normalizeStorageKey(key), sizeBytes: body.byteLength, checksumSha256: checksum };
  }

  async get(key: string): Promise<StoredObject> {
    const objectPath = this.resolve(key);
    let body: Buffer;
    try {
      body = await readFile(objectPath);
    } catch {
      throw storageObjectNotFound(key);
    }
    const sidecar = await this.readSidecar(objectPath);
    return {
      key: normalizeStorageKey(key),
      body,
      contentType: sidecar?.contentType,
      sizeBytes: body.byteLength,
      metadata: sidecar?.metadata ?? { checksumSha256: sha256(body) },
      createdAt: sidecar === undefined ? new Date(0) : new Date(sidecar.createdAt)
    };
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key), fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const objectPath = this.resolve(key);
    await rm(objectPath, { force: true });
    await rm(LocalStorageProvider.sidecarPath(objectPath), { force: true });
  }
}
