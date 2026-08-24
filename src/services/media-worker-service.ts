import { randomUUID } from 'node:crypto';
import { col, Op, where } from 'sequelize';
import { config } from '../config';
import { logger } from '../config/logger';
import { sequelize } from '../database';
import {
  assertAssetProcessingTransition,
  createAssetProcessingFailure,
  type AssetProcessingFailureCategory,
  type AssetProcessingStage
} from '../domain/asset-processing';
import { AppError } from '../errors/app-error';
import { storage as defaultStorage } from '../integrations/storage';
import type { StorageProvider } from '../integrations/storage';
import {
  generateDisplayImageDerivatives,
  generatePanoramaDerivatives,
  inspectImage,
  inspectPanorama
} from '../media/image-processor';
import { validateImageUpload } from '../media/file-policy';
import { Asset, AssetDerivative, MediaJob } from '../models';
import type { AssetProcessingStatus, JsonObject } from '../models/model.types';
import { sha256 } from '../utils/hash';
import { drainStorageDeletionJobs } from './storage-deletion-service';

async function claimJob(): Promise<MediaJob | null> {
  const expiredBefore = new Date(Date.now() - config.mediaJobLeaseSeconds * 1000);
  await sequelize.transaction(async (transaction) => {
    const exhaustedJobs = await MediaJob.findAll({
      where: {
        status: 'running',
        lockedAt: { [Op.lt]: expiredBefore },
        [Op.and]: where(col('attempt'), Op.gte, col('max_attempts'))
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true
    });
    for (const expiredJob of exhaustedJobs) {
      const failure: JsonObject = {
        category: 'PROCESSING_TIMEOUT',
        message: 'The worker lease expired after the maximum number of attempts.',
        retryable: false,
        stage: expiredJob.stage,
        diagnostics: { jobId: expiredJob.id, attempt: expiredJob.attempt }
      };
      const expiredAsset = await Asset.findByPk(expiredJob.assetId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (expiredAsset && expiredAsset.processingStatus !== 'ready') {
        if (expiredAsset.processingStatus !== 'failed') {
          assertAssetProcessingTransition(expiredAsset.processingStatus, 'failed');
        }
        await expiredAsset.update(
          { processingStatus: 'failed', processingError: failure },
          { transaction }
        );
      }
      await expiredJob.update({
        status: 'failed',
        lockedAt: null,
        leaseToken: null,
        finishedAt: new Date(),
        error: failure
      }, { transaction });
    }
  });
  await MediaJob.update(
    {
      status: 'queued',
      lockedAt: null,
      leaseToken: null,
      availableAt: new Date(),
      error: {
        category: 'PROCESSING_TIMEOUT',
        message: 'The worker lease expired; the job was recovered.',
        retryable: true
      }
    },
    {
      where: {
        status: 'running',
        lockedAt: { [Op.lt]: expiredBefore },
        [Op.and]: where(col('attempt'), Op.lt, col('max_attempts'))
      }
    }
  );
  return sequelize.transaction(async (transaction) => {
    const job = await MediaJob.findOne({
      where: { status: 'queued', availableAt: { [Op.lte]: new Date() } },
      order: [['availableAt', 'ASC'], ['createdAt', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true
    });
    if (!job) return null;
    await job.update(
      {
        status: 'running',
        attempt: job.attempt + 1,
        lockedAt: new Date(),
        leaseToken: randomUUID(),
        startedAt: job.startedAt ?? new Date(),
        error: null
      },
      { transaction }
    );
    return job;
  });
}

type LeasedJobValues = Parameters<MediaJob['update']>[0];

async function updateLeasedJob(job: MediaJob, values: LeasedJobValues): Promise<void> {
  if (!job.leaseToken) throw new Error('The media job has no active lease token.');
  const [updated] = await MediaJob.update(
    values,
    { where: { id: job.id, status: 'running', leaseToken: job.leaseToken } }
  );
  if (updated !== 1) throw new Error('The media job lease was lost.');
}

async function setAssetStatus(
  asset: Asset,
  next: AssetProcessingStatus,
  processingError: JsonObject | null = null
): Promise<void> {
  assertAssetProcessingTransition(asset.processingStatus, next);
  await asset.update({ processingStatus: next, processingError });
}

function failureCategory(error: unknown): AssetProcessingFailureCategory {
  if (error instanceof AppError) {
    if (['UNSUPPORTED_IMAGE_TYPE', 'PANORAMA_NOT_DETECTED'].includes(error.code)) return 'UNSUPPORTED_MEDIA_TYPE';
    if (['UPLOAD_MIME_MISMATCH', 'UPLOAD_EXTENSION_MISMATCH'].includes(error.code)) return 'SIGNATURE_MISMATCH';
    if (error.code === 'UPLOAD_TOO_LARGE') return 'FILE_TOO_LARGE';
    if (error.code === 'IMAGE_DECODE_FAILED') return 'IMAGE_DECODE_FAILED';
    if (['IMAGE_METADATA_MISSING', 'PANORAMA_METADATA_INVALID'].includes(error.code)) {
      return 'METADATA_INSPECTION_FAILED';
    }
    if (error.code.includes('DERIVATIVE')) return 'DERIVATIVE_GENERATION_FAILED';
    if (error.code.includes('STORAGE') || error.code.includes('OBJECT')) return 'STORAGE_ERROR';
  }
  return 'UNKNOWN_PROCESSING_ERROR';
}

function failureStage(error: unknown): AssetProcessingStage {
  if (error instanceof AppError) {
    if (error.code.startsWith('UPLOAD_') || error.code === 'UNSUPPORTED_IMAGE_TYPE') return 'upload_validation';
    if (error.code.includes('METADATA') || error.code.includes('DECODE') || error.code === 'PANORAMA_NOT_DETECTED') {
      return 'inspection';
    }
    if (error.code.includes('STORAGE') || error.code.includes('OBJECT')) return 'storage';
  }
  return 'processing';
}

async function persistFailure(asset: Asset, job: MediaJob, error: unknown): Promise<void> {
  const category = failureCategory(error);
  const stage = failureStage(error);
  const appError = error instanceof AppError ? error : undefined;
  const failure = createAssetProcessingFailure(
    category,
    stage,
    appError?.message ?? 'Media processing failed.',
    {
      retryable: appError?.retryable ?? ['STORAGE_ERROR', 'DERIVATIVE_GENERATION_FAILED', 'UNKNOWN_PROCESSING_ERROR'].includes(category),
      diagnostics: { jobId: job.id, attempt: job.attempt },
      occurredAt: new Date().toISOString()
    }
  );
  const failureJson = failure as unknown as JsonObject;
  await sequelize.transaction(async (transaction) => {
    const lockedAsset = await Asset.findByPk(asset.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const lockedJob = await MediaJob.findOne({
      where: { id: job.id, status: 'running', leaseToken: job.leaseToken },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!lockedAsset || !lockedJob) return;
    if (lockedAsset.processingStatus !== 'failed') {
      assertAssetProcessingTransition(lockedAsset.processingStatus, 'failed');
      await lockedAsset.update(
        { processingStatus: 'failed', processingError: failureJson },
        { transaction }
      );
    } else {
      await lockedAsset.update({ processingError: failureJson }, { transaction });
    }
    if (failure.retryable && lockedJob.attempt < lockedJob.maxAttempts) {
      const backoffMs = Math.min(30_000, 1000 * 2 ** (lockedJob.attempt - 1));
      assertAssetProcessingTransition('failed', 'inspecting');
      await lockedAsset.update(
        { processingStatus: 'inspecting', processingError: null },
        { transaction }
      );
      await lockedJob.update({
        status: 'queued',
        stage,
        error: failureJson,
        availableAt: new Date(Date.now() + backoffMs),
        lockedAt: null,
        leaseToken: null
      }, { transaction });
    } else {
      await lockedJob.update({
        status: 'failed',
        stage,
        error: failureJson,
        finishedAt: new Date(),
        lockedAt: null,
        leaseToken: null
      }, { transaction });
    }
  });
}

async function processClaimedJob(job: MediaJob, storage: StorageProvider): Promise<void> {
  const asset = await Asset.findByPk(job.assetId);
  if (!asset) {
    await updateLeasedJob(job, {
      status: 'failed',
      error: { category: 'UNKNOWN_PROCESSING_ERROR', message: 'Asset no longer exists.' },
      finishedAt: new Date(),
      lockedAt: null,
      leaseToken: null
    });
    return;
  }
  try {
    if (asset.processingStatus !== 'processing') {
      await setAssetStatus(asset, 'inspecting');
    }
    await updateLeasedJob(job, { stage: 'inspection', progress: 10, lockedAt: new Date() });
    const source = await storage.get(asset.sourceStorageKey);
    const validated = validateImageUpload({
      bytes: source.body,
      filename: asset.sourceFilename,
      claimedMimeType: asset.sourceMimeType,
      maxBytes: config.maxImageUploadBytes
    });
    const inspection = await (asset.mediaType === 'panorama_image' ? inspectPanorama : inspectImage)({
      bytes: source.body,
      mimeType: validated.mimeType,
      maxPixels: config.maxImagePixels
    });
    await updateLeasedJob(job, { lockedAt: new Date(), progress: 25 });
    await asset.update({
      projection: inspection.projection,
      metadata: {
        width: inspection.width,
        height: inspection.height,
        aspectRatio: inspection.aspectRatio,
        format: inspection.format,
        mimeType: inspection.mimeType,
        sizeBytes: inspection.sizeBytes,
        hasAlpha: inspection.hasAlpha,
        is360: inspection.is360,
        isFullSphere: inspection.isFullSphere,
        ...(inspection.orientation === undefined ? {} : { orientation: inspection.orientation }),
        ...(inspection.xmp === undefined ? {} : { xmp: inspection.xmp })
      } as unknown as JsonObject
    });
    if (asset.processingStatus !== 'processing') {
      await setAssetStatus(asset, 'processing');
    }
    await updateLeasedJob(job, { stage: 'processing', progress: 35, lockedAt: new Date() });
    const derivativeOptions = {
      assetId: asset.id,
      version: job.derivativeVersion,
      bytes: source.body,
      maxPixels: config.maxImagePixels
    };
    const derivatives = asset.mediaType === 'panorama_image'
      ? await generatePanoramaDerivatives(derivativeOptions)
      : await generateDisplayImageDerivatives({
        ...derivativeOptions,
        mimeType: validated.mimeType
      });
    for (const derivative of derivatives) {
      await updateLeasedJob(job, { lockedAt: new Date() });
      if (await storage.exists(derivative.storageKey)) {
        const stored = await storage.get(derivative.storageKey);
        if (sha256(stored.body) !== derivative.checksum) {
          throw new AppError('DERIVATIVE_STORAGE_CONFLICT', 'A derivative storage conflict occurred.', {
            status: 500,
            retryable: false,
            details: { kind: derivative.kind, version: derivative.version }
          });
        }
      } else {
        await storage.put(derivative.storageKey, derivative.body, {
          contentType: derivative.mimeType,
          immutable: true,
          metadata: { checksumSha256: derivative.checksum }
        });
      }
      await AssetDerivative.findOrCreate({
        where: { assetId: asset.id, kind: derivative.kind, version: derivative.version },
        defaults: {
          assetId: asset.id,
          kind: derivative.kind,
          version: derivative.version,
          storageKey: derivative.storageKey,
          mimeType: derivative.mimeType,
          width: derivative.width,
          height: derivative.height,
          sizeBytes: String(derivative.sizeBytes),
          metadata: { ...derivative.metadata, checksumSha256: derivative.checksum } as JsonObject
        }
      });
    }
    await sequelize.transaction(async (transaction) => {
      const lockedJob = await MediaJob.findOne({
        where: { id: job.id, status: 'running', leaseToken: job.leaseToken },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!lockedJob) throw new Error('The media job lease was lost.');
      const lockedAsset = await Asset.findByPk(asset.id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!lockedAsset) throw new Error('The media asset no longer exists.');
      assertAssetProcessingTransition(lockedAsset.processingStatus, 'ready');
      await lockedAsset.update(
        { processingStatus: 'ready', processingError: null },
        { transaction }
      );
      await lockedJob.update({
        status: 'succeeded',
        stage: 'complete',
        progress: 100,
        error: null,
        finishedAt: new Date(),
        lockedAt: null,
        leaseToken: null
      }, { transaction });
    });
    logger.info({ assetId: asset.id, jobId: job.id, derivativeVersion: job.derivativeVersion }, 'media job completed');
  } catch (error) {
    logger.error({ err: error, assetId: asset.id, jobId: job.id }, 'media job failed');
    await persistFailure(asset, job, error);
  }
}

export async function processNextMediaJob(storage: StorageProvider = defaultStorage): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;
  await processClaimedJob(job, storage);
  return true;
}

export async function drainMediaJobs(options: {
  storage?: StorageProvider;
  maxJobs?: number;
} = {}): Promise<number> {
  const maxJobs = options.maxJobs ?? 100;
  let processed = 0;
  while (processed < maxJobs && await processNextMediaJob(options.storage ?? defaultStorage)) {
    processed += 1;
  }
  return processed;
}

export class MediaWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private pendingKick = false;

  start(options: { unref?: boolean } = {}): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.kick(), config.mediaWorkerPollMs);
    if (options.unref ?? true) this.timer.unref();
    this.kick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  kick(): void {
    if (this.running) {
      this.pendingKick = true;
      return;
    }
    this.running = true;
    void Promise.all([
      drainMediaJobs({ maxJobs: 10 }),
      drainStorageDeletionJobs({ maxJobs: 10 }),
    ])
      .catch((error: unknown) => logger.error({ err: error }, 'media worker poll failed'))
      .finally(() => {
        this.running = false;
        if (this.pendingKick) {
          this.pendingKick = false;
          this.kick();
        }
      });
  }
}

export const mediaWorker = new MediaWorker();
