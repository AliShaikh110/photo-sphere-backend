import { config } from '../../config';
import { LocalStorageProvider } from './local-storage';
import type { StorageProvider } from './storage-provider';

export { LocalStorageProvider } from './local-storage';
export { MemoryStorageProvider } from './memory-storage';
export {
  immutableObjectExists,
  invalidStorageKey,
  normalizeObjectMetadata,
  normalizeStorageKey,
  storageObjectNotFound
} from './storage-provider';
export type {
  PutObjectOptions,
  PutObjectResult,
  StorageProvider,
  StoredObject
} from './storage-provider';

/**
 * The process-wide provider. Swapping in shared private object storage for a
 * multi-host deployment is a change to this binding only.
 */
export const storage: StorageProvider = new LocalStorageProvider(config.storageRoot);
