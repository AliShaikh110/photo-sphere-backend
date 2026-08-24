import { randomUUID } from 'node:crypto';

import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';

import { config } from '../config';
import { logger } from '../config/logger';
import { sequelize } from '../database';
import { AppError } from '../errors/app-error';
import { storage as defaultStorage } from '../integrations/storage';
import type { StorageProvider } from '../integrations/storage';
import { StorageDeletionJob } from '../models';
import type { JsonObject } from '../models/model.types';

const INITIAL_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1_000;

export async function enqueueStorageDeletions(options: {
  assetId: string;
  storageKeys: string[];
  transaction: Transaction;
}): Promise<void> {
  const storageKeys = [...new Set(options.storageKeys)];
  if (storageKeys.length === 0) return;
  await StorageDeletionJob.bulkCreate(
    storageKeys.map((storageKey) => ({
      assetId: options.assetId,
      storageKey,
      status: 'queued',
      attempt: 0,
      availableAt: new Date(),
      lockedAt: null,
      leaseToken: null,
      lastError: null,
      completedAt: null,
    })),
    { transaction: options.transaction },
  );
}

function retryDelayMs(attempt: number): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 10);
  return Math.min(INITIAL_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

function deletionError(error: unknown): JsonObject {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message.slice(0, 1_000),
      retryable: true,
    };
  }
  return {
    code: 'STORAGE_DELETE_FAILED',
    message: (error instanceof Error ? error.message : 'Unknown storage deletion failure').slice(0, 1_000),
    retryable: true,
  };
}

async function claimStorageDeletionJob(assetId?: string): Promise<StorageDeletionJob | null> {
  const expiredBefore = new Date(Date.now() - config.mediaJobLeaseSeconds * 1_000);
  return sequelize.transaction(async (transaction) => {
    await StorageDeletionJob.update(
      {
        status: 'queued',
        availableAt: new Date(),
        lockedAt: null,
        leaseToken: null,
      },
      {
        where: {
          status: 'running',
          lockedAt: { [Op.lt]: expiredBefore },
        },
        transaction,
      },
    );

    const job = await StorageDeletionJob.findOne({
      where: {
        status: 'queued',
        availableAt: { [Op.lte]: new Date() },
        ...(assetId === undefined ? {} : { assetId }),
      },
      order: [['availableAt', 'ASC'], ['createdAt', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true,
    });
    if (!job) return null;
    await job.update(
      {
        status: 'running',
        attempt: job.attempt + 1,
        lockedAt: new Date(),
        leaseToken: randomUUID(),
      },
      { transaction },
    );
    return job;
  });
}

async function completeLeasedDeletion(job: StorageDeletionJob): Promise<void> {
  const [updated] = await StorageDeletionJob.update(
    {
      status: 'succeeded',
      lockedAt: null,
      leaseToken: null,
      lastError: null,
      completedAt: new Date(),
    },
    { where: { id: job.id, status: 'running', leaseToken: job.leaseToken } },
  );
  if (updated !== 1) {
    logger.warn({ storageDeletionJobId: job.id }, 'storage deletion completed after its lease was lost');
  }
}

async function retryLeasedDeletion(job: StorageDeletionJob, error: unknown): Promise<void> {
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(job.attempt));
  const [updated] = await StorageDeletionJob.update(
    {
      status: 'queued',
      availableAt: nextAttemptAt,
      lockedAt: null,
      leaseToken: null,
      lastError: deletionError(error),
    },
    { where: { id: job.id, status: 'running', leaseToken: job.leaseToken } },
  );
  if (updated === 1) {
    logger.warn(
      { err: error, storageDeletionJobId: job.id, storageKey: job.storageKey, nextAttemptAt },
      'storage deletion deferred for retry',
    );
  }
}

export async function processNextStorageDeletionJob(
  storage: StorageProvider = defaultStorage,
  assetId?: string,
): Promise<boolean> {
  const job = await claimStorageDeletionJob(assetId);
  if (!job) return false;
  try {
    // StorageProvider.delete is required to be idempotent. Re-delivery can occur
    // after a worker crash between the provider call and the database update.
    await storage.delete(job.storageKey);
    await completeLeasedDeletion(job);
  } catch (error) {
    await retryLeasedDeletion(job, error);
  }
  return true;
}

export async function drainStorageDeletionJobs(options: {
  storage?: StorageProvider;
  maxJobs?: number;
  assetId?: string;
} = {}): Promise<number> {
  const maxJobs = options.maxJobs ?? 100;
  let processed = 0;
  while (
    processed < maxJobs
    && await processNextStorageDeletionJob(options.storage ?? defaultStorage, options.assetId)
  ) {
    processed += 1;
  }
  return processed;
}
