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
  inspectPanorama,
  type GeneratedDerivative,
  type GeneratedStorageObject,
  type PanoramaInspection
} from '../media/image-processor';
import { validateImageUpload, validateVideoUpload } from '../media/file-policy';
import {
  generateVideoDerivatives,
  VIDEO_STAGE_BY_DERIVATIVE_KIND
} from '../media/video-derivatives';
import { inspectVideo, videoInspectionMetadata } from '../media/video-processor';
import { videoTranscoder as defaultVideoTranscoder } from '../integrations/video';
import { Asset, AssetDerivative, MediaJob, MediaJobStage } from '../models';
import { MEDIA_JOB_STAGE_NAMES } from '../models/model.types';
import type {
  AssetDerivativeKind,
  AssetProcessingStatus,
  JsonObject,
  MediaJobStageName,
  MediaJobStageStatus
} from '../models/model.types';
import { incrementMetric, observeMetric } from '../observability';
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
    if (['UNSUPPORTED_VIDEO_TYPE', 'VIDEO_360_NOT_DETECTED', 'VIDEO_TOO_LONG'].includes(error.code)) {
      return 'UNSUPPORTED_MEDIA_TYPE';
    }
    if (error.code === 'VIDEO_DECODE_FAILED') return 'VIDEO_DECODE_FAILED';
    if (error.code === 'VIDEO_DURATION_UNKNOWN') return 'VIDEO_DURATION_UNKNOWN';
    if (error.code === 'VIDEO_PROFILE_UNAVAILABLE') return 'VIDEO_PROFILE_UNAVAILABLE';
    if (['IMAGE_METADATA_MISSING', 'PANORAMA_METADATA_INVALID', 'VIDEO_METADATA_MISSING'].includes(error.code)) {
      return 'METADATA_INSPECTION_FAILED';
    }
    if (error.code.includes('DERIVATIVE')) return 'DERIVATIVE_GENERATION_FAILED';
    if (error.code.includes('STORAGE') || error.code.includes('OBJECT')) return 'STORAGE_ERROR';
  }
  return 'UNKNOWN_PROCESSING_ERROR';
}

function failureStage(error: unknown): AssetProcessingStage {
  if (error instanceof AppError) {
    if (error.code.startsWith('UPLOAD_')
      || error.code === 'UNSUPPORTED_IMAGE_TYPE'
      || error.code === 'UNSUPPORTED_VIDEO_TYPE') return 'upload_validation';
    if (error.code.includes('METADATA')
      || error.code.includes('DECODE')
      || error.code === 'PANORAMA_NOT_DETECTED'
      || error.code === 'VIDEO_360_NOT_DETECTED'
      || error.code === 'VIDEO_DURATION_UNKNOWN') {
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

function primaryStorageObject(derivative: GeneratedDerivative): GeneratedStorageObject {
  return {
    storageKey: derivative.storageKey,
    mimeType: derivative.mimeType,
    sizeBytes: derivative.body.byteLength,
    checksum: derivative.checksum,
    body: derivative.body,
    metadata: {
      checksumSha256: derivative.checksum,
      role: derivative.kind === 'tiledLevels' ? 'panorama-tile-manifest' : 'derivative',
      derivativeKind: derivative.kind
    }
  };
}

async function persistImmutableObject(
  object: GeneratedStorageObject,
  derivative: Pick<GeneratedDerivative, 'kind' | 'version'>,
  storage: StorageProvider
): Promise<void> {
  if (object.body.byteLength !== object.sizeBytes || sha256(object.body) !== object.checksum) {
    throw new AppError('DERIVATIVE_GENERATION_FAILED', 'Generated derivative object metadata is inconsistent.', {
      status: 500,
      retryable: true,
      details: { kind: derivative.kind, version: derivative.version, storageKey: object.storageKey }
    });
  }

  if (await storage.exists(object.storageKey)) {
    const stored = await storage.get(object.storageKey);
    if (sha256(stored.body) !== object.checksum) {
      throw new AppError('DERIVATIVE_STORAGE_CONFLICT', 'A derivative storage conflict occurred.', {
        status: 500,
        retryable: false,
        details: { kind: derivative.kind, version: derivative.version, storageKey: object.storageKey }
      });
    }
    return;
  }

  try {
    await storage.put(object.storageKey, object.body, {
      contentType: object.mimeType,
      immutable: true,
      metadata: object.metadata
    });
  } catch (error) {
    // An overlapping lease/retry may win the immutable create between exists
    // and put. Treat it as success only after verifying the winning object.
    if (!(error instanceof AppError) || error.code !== 'IMMUTABLE_OBJECT_EXISTS') throw error;
    const stored = await storage.get(object.storageKey);
    if (sha256(stored.body) !== object.checksum) {
      throw new AppError('DERIVATIVE_STORAGE_CONFLICT', 'A derivative storage conflict occurred.', {
        status: 500,
        retryable: false,
        details: { kind: derivative.kind, version: derivative.version, storageKey: object.storageKey }
      });
    }
  }
}

async function persistDerivative(
  assetId: string,
  derivative: GeneratedDerivative,
  storage: StorageProvider
): Promise<void> {
  // A visible manifest must never point at tile objects which have not yet
  // been durably stored. Retries verify already-created objects by checksum.
  for (const object of derivative.supportingObjects ?? []) {
    await persistImmutableObject(object, derivative, storage);
  }
  await persistImmutableObject(primaryStorageObject(derivative), derivative, storage);

  const [catalogEntry, created] = await AssetDerivative.findOrCreate({
    where: { assetId, kind: derivative.kind, version: derivative.version },
    defaults: {
      assetId,
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
  if (!created && (
    catalogEntry.storageKey !== derivative.storageKey
    || catalogEntry.mimeType !== derivative.mimeType
    || catalogEntry.width !== derivative.width
    || catalogEntry.height !== derivative.height
    || String(catalogEntry.sizeBytes) !== String(derivative.sizeBytes)
    || catalogEntry.metadata.checksumSha256 !== derivative.checksum
  )) {
    throw new AppError('DERIVATIVE_CATALOG_CONFLICT', 'An immutable derivative catalog conflict occurred.', {
      status: 500,
      retryable: false,
      details: { kind: derivative.kind, version: derivative.version }
    });
  }
}

async function processClaimedJob(job: MediaJob, storage: StorageProvider): Promise<void> {
  const asset = await Asset.findByPk(job.assetId);
  if (!asset) {
    incrementMetric('media.job.failed', {
      jobType: job.type,
      errorCode: 'ASSET_MISSING'
    });
    await updateLeasedJob(job, {
      status: 'failed',
      error: { category: 'UNKNOWN_PROCESSING_ERROR', message: 'Asset no longer exists.' },
      finishedAt: new Date(),
      lockedAt: null,
      leaseToken: null
    });
    return;
  }
  // How long the job waited for a worker, and how long the work then took, are
  // the two numbers that separate a backlog from a slow pipeline.
  observeMetric('media.job.queue_delay', Math.max(0, Date.now() - job.availableAt.getTime()), {
    jobType: job.type,
    mediaType: asset.mediaType
  });
  if (job.attempt > 1) {
    incrementMetric('media.job.retry', { jobType: job.type, mediaType: asset.mediaType });
  }
  const startedAt = Date.now();
  try {
    if (isVideoAsset(asset)) {
      await processVideoAsset(asset, job, storage);
    } else {
      await processImageAsset(asset, job, storage);
    }
    observeMetric('media.job.duration', Date.now() - startedAt, {
      jobType: job.type,
      mediaType: asset.mediaType,
      status: 'succeeded'
    });
    logger.info({ assetId: asset.id, jobId: job.id, derivativeVersion: job.derivativeVersion }, 'media job completed');
  } catch (error) {
    observeMetric('media.job.duration', Date.now() - startedAt, {
      jobType: job.type,
      mediaType: asset.mediaType,
      status: 'failed'
    });
    incrementMetric('media.job.failed', {
      jobType: job.type,
      mediaType: asset.mediaType,
      errorCode: error instanceof AppError ? error.code : 'UNKNOWN_PROCESSING_ERROR'
    });
    logger.error({ err: error, assetId: asset.id, jobId: job.id }, 'media job failed');
    await persistFailure(asset, job, error);
  }
}

function isVideoAsset(asset: Asset): boolean {
  return asset.mediaType === 'video360' || asset.mediaType === 'video';
}

async function processImageAsset(
  asset: Asset,
  job: MediaJob,
  storage: StorageProvider
): Promise<void> {
  {
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
      ? await generatePanoramaDerivatives({
        ...derivativeOptions,
        inspection: inspection as PanoramaInspection,
        tilingPolicy: config.panoramaTilingPolicy
      })
      : await generateDisplayImageDerivatives({
        ...derivativeOptions,
        mimeType: validated.mimeType
      });
    for (const derivative of derivatives) {
      await updateLeasedJob(job, { lockedAt: new Date() });
      await persistDerivative(asset.id, derivative, storage);
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
  }
}

const VIDEO_PLAYBACK_DERIVATIVE_KINDS = ['desktopVideoProfile', 'mobileVideoProfile'] as const;

function requestedVideoStages(job: MediaJob): MediaJobStageName[] {
  const requested = job.payload.stages;
  if (!Array.isArray(requested)) {
    return ['poster', 'transcodeDesktop', 'transcodeMobile'];
  }
  const allowed = new Set<string>(MEDIA_JOB_STAGE_NAMES);
  return requested.filter(
    (stage): stage is MediaJobStageName => typeof stage === 'string' && allowed.has(stage)
  );
}

async function recordStage(
  job: MediaJob,
  assetId: string,
  stage: MediaJobStageName,
  values: {
    status: MediaJobStageStatus;
    derivativeKind?: AssetDerivativeKind;
    required?: boolean;
    error?: JsonObject | null;
    diagnostics?: JsonObject;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  }
): Promise<void> {
  const [row] = await MediaJobStage.findOrCreate({
    where: { mediaJobId: job.id, stage },
    defaults: {
      mediaJobId: job.id,
      assetId,
      stage,
      status: values.status,
      derivativeKind: values.derivativeKind ?? null,
      derivativeVersion: job.derivativeVersion,
      attempt: job.attempt,
      required: values.required ?? true,
      error: values.error ?? null,
      diagnostics: values.diagnostics ?? {},
      startedAt: values.startedAt ?? null,
      finishedAt: values.finishedAt ?? null
    }
  });
  await row.update({
    status: values.status,
    attempt: job.attempt,
    derivativeVersion: job.derivativeVersion,
    ...(values.derivativeKind === undefined ? {} : { derivativeKind: values.derivativeKind }),
    ...(values.required === undefined ? {} : { required: values.required }),
    ...(values.error === undefined ? {} : { error: values.error }),
    ...(values.diagnostics === undefined ? {} : { diagnostics: values.diagnostics }),
    ...(values.startedAt === undefined ? {} : { startedAt: values.startedAt }),
    ...(values.finishedAt === undefined ? {} : { finishedAt: values.finishedAt })
  });
}

async function processVideoAsset(
  asset: Asset,
  job: MediaJob,
  storage: StorageProvider
): Promise<void> {
  if (asset.processingStatus !== 'processing') {
    await setAssetStatus(asset, 'inspecting');
  }
  await updateLeasedJob(job, { stage: 'inspection', progress: 10, lockedAt: new Date() });
  await recordStage(job, asset.id, 'inspect', { status: 'running', startedAt: new Date() });

  const source = await storage.get(asset.sourceStorageKey);
  const validated = validateVideoUpload({
    bytes: source.body,
    filename: asset.sourceFilename,
    claimedMimeType: asset.sourceMimeType,
    maxBytes: config.maxVideoUploadBytes
  });
  const inspection = inspectVideo({
    bytes: source.body,
    mimeType: validated.mimeType,
    require360: asset.mediaType === 'video360',
    maxDurationMs: config.maxVideoDurationMs
  });
  await recordStage(job, asset.id, 'inspect', {
    status: 'succeeded',
    finishedAt: new Date(),
    diagnostics: {
      container: inspection.container,
      width: inspection.width,
      height: inspection.height,
      durationMs: inspection.durationMs,
      projectionSource: inspection.projectionSource
    }
  });

  await updateLeasedJob(job, { lockedAt: new Date(), progress: 25 });
  await asset.update({
    projection: inspection.projection === 'cubemap'
      ? 'cubemap'
      : inspection.is360 ? 'equirectangular' : 'unknown',
    metadata: videoInspectionMetadata(inspection) as unknown as JsonObject
  });
  if (asset.processingStatus !== 'processing') {
    await setAssetStatus(asset, 'processing');
  }
  await updateLeasedJob(job, { stage: 'processing', progress: 35, lockedAt: new Date() });

  // A retried attempt must not re-encode a derivative that is already stored:
  // re-encoding is not byte-deterministic and would collide with the immutable
  // catalog entry created by the previous attempt.
  const existingAtVersion = await AssetDerivative.findAll({
    where: { assetId: asset.id, version: job.derivativeVersion },
    attributes: ['kind']
  });
  const alreadyStored = new Set<string>(existingAtVersion.map((entry) => entry.kind));
  const stages = requestedVideoStages(job).filter((stage) => {
    const kind = Object.entries(VIDEO_STAGE_BY_DERIVATIVE_KIND)
      .find(([, stageName]) => stageName === stage)?.[0];
    return kind === undefined || !alreadyStored.has(kind);
  });

  const outcomes = await generateVideoDerivatives({
    assetId: asset.id,
    version: job.derivativeVersion,
    bytes: source.body,
    inspection,
    transcoder: defaultVideoTranscoder,
    policy: config.videoTranscodingPolicy,
    posterTimeMs: config.videoPosterTimeMs,
    stages
  });

  let retryableStageFailure: AppError | undefined;
  for (const outcome of outcomes) {
    await updateLeasedJob(job, { lockedAt: new Date() });
    if (outcome.status === 'succeeded' && outcome.derivative) {
      await persistDerivative(asset.id, outcome.derivative, storage);
      await recordStage(job, asset.id, outcome.stage, {
        status: 'succeeded',
        ...(outcome.derivativeKind === undefined ? {} : { derivativeKind: outcome.derivativeKind }),
        required: outcome.required,
        error: null,
        diagnostics: outcome.diagnostics as unknown as JsonObject,
        finishedAt: new Date()
      });
      continue;
    }
    if (outcome.status === 'skipped') {
      await recordStage(job, asset.id, outcome.stage, {
        status: 'skipped',
        ...(outcome.derivativeKind === undefined ? {} : { derivativeKind: outcome.derivativeKind }),
        required: outcome.required,
        diagnostics: outcome.diagnostics as unknown as JsonObject,
        finishedAt: new Date()
      });
      continue;
    }
    await recordStage(job, asset.id, outcome.stage, {
      status: 'failed',
      ...(outcome.derivativeKind === undefined ? {} : { derivativeKind: outcome.derivativeKind }),
      required: outcome.required,
      error: (outcome.failure ?? null) as unknown as JsonObject | null,
      diagnostics: outcome.diagnostics as unknown as JsonObject,
      finishedAt: new Date()
    });
    if (outcome.failure?.retryable === true) {
      retryableStageFailure = new AppError(
        'VIDEO_DERIVATIVE_GENERATION_FAILED',
        outcome.failure.message,
        { status: 500, retryable: true, entityId: asset.id }
      );
    }
  }
  // Re-encoding infrastructure faults are worth another attempt; already-stored
  // derivatives are skipped above so the retry stays idempotent.
  if (retryableStageFailure) throw retryableStageFailure;

  await recordStage(job, asset.id, 'finalize', { status: 'running', startedAt: new Date() });
  const playbackDerivatives = await AssetDerivative.findAll({
    where: { assetId: asset.id, kind: { [Op.in]: [...VIDEO_PLAYBACK_DERIVATIVE_KINDS] } },
    order: [['version', 'DESC']]
  });
  if (playbackDerivatives.length === 0) {
    await recordStage(job, asset.id, 'finalize', {
      status: 'failed',
      finishedAt: new Date(),
      diagnostics: { publishableProfiles: 0 }
    });
    throw new AppError(
      'VIDEO_PROFILE_UNAVAILABLE',
      'No compatible playback profile could be produced for this video.',
      { status: 422, entityId: asset.id, retryable: false }
    );
  }

  const posterReady = await AssetDerivative.count({
    where: { assetId: asset.id, kind: 'videoPoster' }
  }) > 0;
  const profileSummary = summarizePlaybackProfiles(playbackDerivatives);
  const stageRows = await MediaJobStage.findAll({ where: { mediaJobId: job.id } });
  const unavailableProfiles = stageRows
    .filter((row) => row.status === 'failed' && row.derivativeKind !== null)
    .map((row) => ({
      derivativeKind: row.derivativeKind,
      stage: row.stage,
      reason: (row.error as JsonObject | null)?.message ?? 'The playback profile is unavailable.'
    }));

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
      {
        processingStatus: 'ready',
        processingError: null,
        metadata: {
          ...lockedAsset.metadata,
          posterAvailable: posterReady,
          playbackProfiles: profileSummary,
          ...(unavailableProfiles.length === 0
            ? {}
            : { unavailablePlaybackProfiles: unavailableProfiles })
        } as unknown as JsonObject
      },
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
  await recordStage(job, asset.id, 'finalize', {
    status: 'succeeded',
    finishedAt: new Date(),
    diagnostics: { publishableProfiles: profileSummary.length, posterAvailable: posterReady }
  });
}

function summarizePlaybackProfiles(derivatives: readonly AssetDerivative[]): JsonObject[] {
  const latestByKind = new Map<string, AssetDerivative>();
  for (const derivative of derivatives) {
    const current = latestByKind.get(derivative.kind);
    if (!current || derivative.version > current.version) latestByKind.set(derivative.kind, derivative);
  }
  return [...latestByKind.values()].map((derivative) => ({
    derivativeKind: derivative.kind,
    profileId: typeof derivative.metadata.profileId === 'string' ? derivative.metadata.profileId : null,
    version: derivative.version,
    width: derivative.width,
    height: derivative.height,
    mimeType: derivative.mimeType,
    handheldSafe: derivative.metadata.handheldSafe === true
  }));
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
