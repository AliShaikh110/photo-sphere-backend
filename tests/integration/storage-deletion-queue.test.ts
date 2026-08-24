import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { StorageProvider } from '../../src/integrations/storage';
import { MemoryStorageProvider } from '../../src/integrations/storage';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext,
} from '../helpers/postgres-test-context';

describe.sequential('durable storage deletion queue', () => {
  let context: IntegrationTestContext;

  beforeAll(async () => {
    context = await startIntegrationTestContext();
  }, 60_000);

  afterAll(async () => {
    await context?.stop();
  }, 60_000);

  beforeEach(async () => {
    await truncateApplicationData(context);
  });

  it('commits logical deletion and durably retries object cleanup after storage failure', async ({ skip }) => {
    if (context.databaseKind !== 'postgres') {
      skip('Outbox claiming requires PostgreSQL row locks.');
    }

    const { Asset, AssetDerivative, StorageDeletionJob, User } = await import('../../src/models');
    const { deleteAsset } = await import('../../src/services/asset-service');
    const { drainStorageDeletionJobs } = await import('../../src/services/storage-deletion-service');

    const owner = await User.create({
      email: `cleanup-${randomUUID()}@example.test`,
      passwordHash: null,
      displayName: 'Cleanup owner',
      status: 'active',
    });
    const asset = await Asset.create({
      ownerId: owner.id,
      projectId: null,
      sourceStorageKey: `originals/${owner.id}/${randomUUID()}/source.jpg`,
      sourceFilename: 'source.jpg',
      sourceMimeType: 'image/jpeg',
      sourceSizeBytes: '6',
      sourceChecksum: null,
      mediaType: 'image',
      projection: 'unknown',
      metadata: {},
      processingStatus: 'ready',
      processingError: null,
    });
    const derivative = await AssetDerivative.create({
      assetId: asset.id,
      kind: 'thumbnail',
      version: 1,
      storageKey: `derivatives/${asset.id}/v1/thumbnail.webp`,
      mimeType: 'image/webp',
      width: 32,
      height: 32,
      sizeBytes: '5',
      metadata: {},
    });
    const storage = new MemoryStorageProvider();
    await storage.put(asset.sourceStorageKey, Buffer.from('source'));
    await storage.put(derivative.storageKey, Buffer.from('thumb'));
    const unavailableStorage: StorageProvider = {
      put: (key, body, options) => storage.put(key, body, options),
      get: (key) => storage.get(key),
      exists: (key) => storage.exists(key),
      delete: async () => {
        throw new Error('object store temporarily unavailable');
      },
    };

    await expect(deleteAsset(asset.id, owner.id, { storage: unavailableStorage })).resolves.toEqual({
      deleted: true,
      assetId: asset.id,
    });

    expect(await Asset.findByPk(asset.id)).toBeNull();
    expect(await AssetDerivative.count({ where: { assetId: asset.id } })).toBe(0);
    const deferred = await StorageDeletionJob.findAll({
      where: { assetId: asset.id },
      order: [['storageKey', 'ASC']],
    });
    expect(deferred).toHaveLength(2);
    expect(deferred.map((job) => job.status)).toEqual(['queued', 'queued']);
    expect(deferred.map((job) => job.attempt)).toEqual([1, 1]);
    expect(deferred.every((job) => job.lastError?.code === 'STORAGE_DELETE_FAILED')).toBe(true);
    expect(await storage.exists(asset.sourceStorageKey)).toBe(true);
    expect(await storage.exists(derivative.storageKey)).toBe(true);

    await StorageDeletionJob.update(
      { availableAt: new Date(0) },
      { where: { assetId: asset.id, status: 'queued' } },
    );
    await expect(drainStorageDeletionJobs({ storage, maxJobs: 10 })).resolves.toBe(2);

    const completed = await StorageDeletionJob.findAll({ where: { assetId: asset.id } });
    expect(completed.map((job) => job.status)).toEqual(['succeeded', 'succeeded']);
    expect(completed.map((job) => job.attempt)).toEqual([2, 2]);
    expect(completed.every((job) => job.completedAt instanceof Date)).toBe(true);
    expect(await storage.exists(asset.sourceStorageKey)).toBe(false);
    expect(await storage.exists(derivative.storageKey)).toBe(false);
    await expect(drainStorageDeletionJobs({ storage, maxJobs: 10 })).resolves.toBe(0);
  });

  it('recovers an expired lease and safely redelivers an idempotent delete', async ({ skip }) => {
    if (context.databaseKind !== 'postgres') {
      skip('Outbox claiming requires PostgreSQL row locks.');
    }

    const { StorageDeletionJob } = await import('../../src/models');
    const { drainStorageDeletionJobs } = await import('../../src/services/storage-deletion-service');
    const storage = new MemoryStorageProvider();
    const storageKey = `derivatives/${randomUUID()}/expired.webp`;
    await storage.put(storageKey, Buffer.from('stale'));
    const job = await StorageDeletionJob.create({
      assetId: randomUUID(),
      storageKey,
      status: 'running',
      attempt: 1,
      availableAt: new Date(0),
      lockedAt: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      leaseToken: randomUUID(),
      lastError: null,
      completedAt: null,
    });

    await expect(drainStorageDeletionJobs({ storage, maxJobs: 1 })).resolves.toBe(1);
    await job.reload();
    expect(job).toMatchObject({ status: 'succeeded', attempt: 2 });
    expect(job.leaseToken).toBeNull();
    expect(job.completedAt).toBeInstanceOf(Date);
    expect(await storage.exists(storageKey)).toBe(false);
  });
});
