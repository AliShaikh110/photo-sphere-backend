import { randomUUID } from 'node:crypto';
import { Op } from 'sequelize';
import { config } from '../config';
import { logger } from '../config/logger';
import { sequelize } from '../database';
import { assertAssetProcessingTransition } from '../domain/asset-processing';
import { AppError, conflict, notFound } from '../errors/app-error';
import { storage as defaultStorage } from '../integrations/storage';
import type { StorageProvider } from '../integrations/storage';
import { malwareScanner as defaultMalwareScanner, type MalwareScanner } from '../integrations/malware-scanner';
import { validateImageUpload, safeUploadFilename } from '../media/file-policy';
import {
  Asset,
  AssetDerivative,
  Hotspot,
  MediaJob,
  Project,
  Publication,
  PublishedSceneDefinition,
  Scene,
  UploadSession,
  User
} from '../models';
import type { JsonObject } from '../models/model.types';
import { sha256 } from '../utils/hash';
import { getOwnedProject } from './project-service';
import {
  drainStorageDeletionJobs,
  enqueueStorageDeletions,
} from './storage-deletion-service';

export function serializeAsset(asset: Asset): Record<string, unknown> {
  return {
    id: asset.id,
    ownerId: asset.ownerId,
    projectId: asset.projectId,
    filename: asset.sourceFilename,
    mediaType: asset.mediaType,
    mimeType: asset.sourceMimeType,
    sizeBytes: Number(asset.sourceSizeBytes),
    projection: asset.projection,
    metadata: asset.metadata,
    processingStatus: asset.processingStatus,
    processingError: asset.processingError,
    derivatives: asset.derivatives?.map((derivative) => ({
      id: derivative.id,
      kind: derivative.kind,
      version: derivative.version,
      mimeType: derivative.mimeType,
      width: derivative.width,
      height: derivative.height,
      sizeBytes: Number(derivative.sizeBytes),
      metadata: derivative.metadata,
      createdAt: derivative.createdAt
    })) ?? [],
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  };
}

async function ownedAsset(assetId: string, ownerId: string): Promise<Asset> {
  const asset = await Asset.findOne({
    where: { id: assetId, ownerId },
    include: [{ model: AssetDerivative, as: 'derivatives' }],
    order: [[{ model: AssetDerivative, as: 'derivatives' }, 'version', 'ASC']]
  });
  if (!asset) throw notFound('asset', assetId);
  return asset;
}

export async function createUploadSession(
  ownerId: string,
  input: {
    projectId?: string;
    mediaType: 'panorama_image' | 'image' | 'logo';
    filename: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256?: string;
  }
): Promise<Record<string, unknown>> {
  if (input.sizeBytes > config.maxImageUploadBytes) {
    throw new AppError('UPLOAD_TOO_LARGE', 'The image exceeds the configured upload limit.', {
      status: 413,
      path: 'sizeBytes',
      details: { maxBytes: config.maxImageUploadBytes }
    });
  }
  if (input.projectId) await getOwnedProject(input.projectId, ownerId);
  const assetId = randomUUID();
  const filename = safeUploadFilename(input.filename);
  const storageKey = `originals/${ownerId}/${assetId}/${filename}`;
  const expiresAt = new Date(Date.now() + config.uploadSessionTtlSeconds * 1000);
  const result = await sequelize.transaction(async (transaction) => {
    const asset = await Asset.create(
      {
        id: assetId,
        ownerId,
        projectId: input.projectId ?? null,
        sourceStorageKey: storageKey,
        sourceFilename: filename,
        sourceMimeType: input.mimeType,
        sourceSizeBytes: String(input.sizeBytes),
        sourceChecksum: input.checksumSha256?.toLowerCase() ?? null,
        mediaType: input.mediaType,
        projection: 'unknown',
        metadata: {},
        processingStatus: 'uploaded',
        processingError: null
      },
      { transaction }
    );
    const uploadSession = await UploadSession.create(
      {
        ownerId,
        projectId: input.projectId ?? null,
        assetId: asset.id,
        status: 'pending',
        storageKey,
        providerUploadId: null,
        filename,
        declaredMimeType: input.mimeType,
        expectedSizeBytes: String(input.sizeBytes),
        metadata: (input.checksumSha256 ? { checksumSha256: input.checksumSha256.toLowerCase() } : {}) as JsonObject,
        expiresAt,
        completedAt: null
      },
      { transaction }
    );
    return { asset, uploadSession };
  });
  return {
    asset: serializeAsset(result.asset),
    upload: {
      sessionId: result.uploadSession.id,
      method: 'PUT',
      url: `/api/v1/assets/uploads/${result.uploadSession.id}/content`,
      headers: { 'Content-Type': input.mimeType },
      expiresAt
    }
  };
}

export async function storeUploadContent(options: {
  uploadSessionId: string;
  ownerId: string;
  bytes: Buffer;
  contentType: string;
  storage?: StorageProvider;
  malwareScanner?: MalwareScanner;
}): Promise<Record<string, unknown>> {
  const provider = options.storage ?? defaultStorage;
  const scanner = options.malwareScanner ?? defaultMalwareScanner;
  const uploadSession = await UploadSession.findOne({
    where: { id: options.uploadSessionId, ownerId: options.ownerId },
    include: [{ model: Asset, as: 'asset' }]
  });
  if (!uploadSession || !uploadSession.asset) throw notFound('upload session', options.uploadSessionId);
  if (uploadSession.expiresAt <= new Date() && uploadSession.status === 'pending') {
    await uploadSession.update({ status: 'expired' });
    throw new AppError('UPLOAD_SESSION_EXPIRED', 'The upload session has expired.', { status: 410 });
  }
  if (uploadSession.status === 'uploaded' || uploadSession.status === 'completed') {
    return {
      uploadSessionId: uploadSession.id,
      assetId: uploadSession.assetId,
      status: uploadSession.status
    };
  }
  if (uploadSession.status !== 'pending') {
    throw conflict('UPLOAD_SESSION_NOT_WRITABLE', 'The upload session cannot accept content.', {
      status: uploadSession.status
    });
  }
  const requestContentType = options.contentType.toLowerCase().split(';', 1)[0]?.trim();
  const declaredContentType = uploadSession.declaredMimeType === 'image/jpg'
    ? 'image/jpeg'
    : uploadSession.declaredMimeType;
  if ((requestContentType === 'image/jpg' ? 'image/jpeg' : requestContentType) !== declaredContentType) {
    throw new AppError('UPLOAD_CONTENT_TYPE_MISMATCH', 'The upload Content-Type does not match its session.', {
      status: 422,
      path: 'headers.Content-Type'
    });
  }
  if (options.bytes.byteLength !== Number(uploadSession.expectedSizeBytes)) {
    throw new AppError('UPLOAD_SIZE_MISMATCH', 'The uploaded byte count does not match the declared size.', {
      status: 422,
      details: {
        expectedSizeBytes: Number(uploadSession.expectedSizeBytes),
        receivedSizeBytes: options.bytes.byteLength
      }
    });
  }
  const validated = validateImageUpload({
    bytes: options.bytes,
    filename: uploadSession.filename,
    claimedMimeType: uploadSession.declaredMimeType,
    maxBytes: config.maxImageUploadBytes
  });
  const checksum = sha256(options.bytes);
  const expectedChecksum = uploadSession.metadata.checksumSha256;
  if (typeof expectedChecksum === 'string' && expectedChecksum !== checksum) {
    throw new AppError('UPLOAD_CHECKSUM_MISMATCH', 'The upload checksum does not match.', { status: 422 });
  }
  const malwareScan = await scanner.scan(options.bytes, {
    filename: uploadSession.filename,
    mimeType: validated.mimeType
  });
  if (malwareScan.verdict === 'infected') {
    throw new AppError('MALWARE_DETECTED', 'The uploaded file was rejected by the security scanner.', {
      status: 422
    });
  }
  if (await provider.exists(uploadSession.storageKey)) {
    const existing = await provider.get(uploadSession.storageKey);
    if (sha256(existing.body) !== checksum) {
      throw conflict('IMMUTABLE_SOURCE_CONFLICT', 'Different content already exists for this upload session.');
    }
  } else {
    await provider.put(uploadSession.storageKey, options.bytes, {
      contentType: validated.mimeType,
      immutable: true,
      metadata: {
        checksumSha256: checksum,
        originalFilename: uploadSession.filename,
        malwareScan: malwareScan.verdict
      }
    });
  }
  await sequelize.transaction(async (transaction) => {
    await uploadSession.update({ status: 'uploaded' }, { transaction });
    await uploadSession.asset!.update(
      {
        sourceMimeType: validated.mimeType,
        sourceSizeBytes: String(validated.sizeBytes),
        sourceChecksum: checksum
      },
      { transaction }
    );
  });
  return { uploadSessionId: uploadSession.id, assetId: uploadSession.assetId, status: 'uploaded' };
}

export async function completeUpload(options: {
  assetId: string;
  uploadSessionId: string;
  ownerId: string;
}): Promise<Record<string, unknown>> {
  await sequelize.transaction(async (transaction) => {
    const session = await UploadSession.findOne({
      where: {
        id: options.uploadSessionId,
        assetId: options.assetId,
        ownerId: options.ownerId
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!session) throw notFound('upload session', options.uploadSessionId);
    if (session.status === 'completed') return;
    if (session.status !== 'uploaded') {
      throw new AppError('UPLOAD_NOT_READY', 'The upload content must be stored before completion.', {
        status: 409,
        retryable: session.status === 'pending'
      });
    }
    await MediaJob.findOrCreate({
      where: { idempotencyKey: `upload-complete:${session.id}` },
      defaults: {
        assetId: options.assetId,
        type: 'inspect',
        stage: 'inspection',
        status: 'queued',
        derivativeVersion: 1,
        idempotencyKey: `upload-complete:${session.id}`,
        attempt: 0,
        maxAttempts: 3,
        progress: 0,
        payload: {},
        error: null,
        availableAt: new Date(),
        lockedAt: null,
        leaseToken: null,
        startedAt: null,
        finishedAt: null
      },
      transaction
    });
    await session.update({ status: 'completed', completedAt: new Date() }, { transaction });
  });
  const asset = await ownedAsset(options.assetId, options.ownerId);
  return { asset: serializeAsset(asset), jobQueued: true };
}

export async function readAsset(assetId: string, ownerId: string): Promise<Record<string, unknown>> {
  return serializeAsset(await ownedAsset(assetId, ownerId));
}

export async function reprocessAsset(options: {
  assetId: string;
  ownerId: string;
  operationKey: string;
}): Promise<Record<string, unknown>> {
  await sequelize.transaction(async (transaction) => {
    const asset = await Asset.findOne({
      where: { id: options.assetId, ownerId: options.ownerId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!asset) throw notFound('asset', options.assetId);
    const jobKey = `reprocess:${asset.id}:${sha256(options.operationKey)}`;
    const existingJob = await MediaJob.findOne({ where: { idempotencyKey: jobKey }, transaction });
    if (existingJob) return;
    if (!['failed', 'ready'].includes(asset.processingStatus)) {
      throw new AppError('ASSET_REPROCESS_NOT_ALLOWED', 'The asset cannot be reprocessed in its current state.', {
        status: 409,
        entityId: asset.id,
        retryable: asset.processingStatus === 'inspecting' || asset.processingStatus === 'processing',
        details: { processingStatus: asset.processingStatus }
      });
    }
    const activeJobCount = await MediaJob.count({
      where: { assetId: asset.id, status: { [Op.in]: ['queued', 'running'] } },
      transaction
    });
    if (activeJobCount > 0) {
      throw new AppError('ASSET_REPROCESS_NOT_ALLOWED', 'The asset already has an active media job.', {
        status: 409,
        entityId: asset.id,
        retryable: true
      });
    }
    const derivativeVersion = Number((await AssetDerivative.max('version', {
      where: { assetId: asset.id },
      transaction
    })) ?? 0);
    const jobVersion = Number((await MediaJob.max('derivativeVersion', {
      where: { assetId: asset.id },
      transaction
    })) ?? 0);
    await MediaJob.create(
      {
        assetId: asset.id,
        type: 'reprocess',
        stage: 'inspection',
        status: 'queued',
        derivativeVersion: Math.max(derivativeVersion, jobVersion) + 1,
        idempotencyKey: jobKey,
        attempt: 0,
        maxAttempts: 3,
        progress: 0,
        payload: {},
        error: null,
        availableAt: new Date(),
        lockedAt: null,
        leaseToken: null,
        startedAt: null,
        finishedAt: null
      },
      { transaction }
    );
    assertAssetProcessingTransition(asset.processingStatus, 'inspecting');
    await asset.update(
      { processingStatus: 'inspecting', processingError: null },
      { transaction }
    );
  });
  return { asset: await readAsset(options.assetId, options.ownerId), jobQueued: true };
}

function jsonContains(value: unknown, id: string): boolean {
  if (value === id) return true;
  if (Array.isArray(value)) return value.some((item) => jsonContains(item, id));
  if (value && typeof value === 'object') return Object.values(value).some((item) => jsonContains(item, id));
  return false;
}

function derivativeSupportingStorageKeys(metadata: JsonObject): string[] {
  const tiles = metadata.tiles;
  if (!Array.isArray(tiles)) return [];
  return tiles.flatMap((tile) => {
    if (!tile || typeof tile !== 'object' || Array.isArray(tile)) return [];
    return typeof tile.storageKey === 'string' && tile.storageKey.length > 0
      ? [tile.storageKey]
      : [];
  });
}

export async function deleteAsset(
  assetId: string,
  ownerId: string,
  options: { storage?: StorageProvider } = {},
): Promise<Record<string, unknown>> {
  const removedStorageKeys = await sequelize.transaction(async (transaction) => {
    await User.findByPk(ownerId, { transaction, lock: transaction.LOCK.UPDATE });
    const asset = await Asset.findOne({
      where: { id: assetId, ownerId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!asset) throw notFound('asset', assetId);
    if (!['ready', 'failed'].includes(asset.processingStatus)) {
      throw conflict('ASSET_BUSY', 'The asset cannot be deleted while upload or processing is active.', {
        assetId,
        processingStatus: asset.processingStatus
      });
    }
    const activeJobs = await MediaJob.count({
      where: { assetId, status: { [Op.in]: ['queued', 'running'] } },
      transaction
    });
    if (activeJobs > 0) {
      throw conflict('ASSET_BUSY', 'The asset has an active media job and cannot be deleted.', { assetId });
    }
    const derivatives = await AssetDerivative.findAll({ where: { assetId }, transaction });
    const projects = await Project.findAll({
      where: { ownerId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const projectIds = projects.map((project) => project.id);
    const sceneReference = await Scene.count({ where: { panoramaAssetId: assetId }, transaction });
    const scenes = projectIds.length === 0
      ? []
      : await Scene.findAll({
        where: { projectId: { [Op.in]: projectIds } },
        include: [{ model: Hotspot, as: 'hotspots' }],
        transaction
      });
    const embeddedReference = projects.some(
      (project) => jsonContains(project.branding, assetId) || jsonContains(project.settings, assetId)
    ) || scenes.some((scene) => (scene.hotspots ?? []).some(
      (hotspot) => jsonContains(hotspot.appearance, assetId)
        || jsonContains(hotspot.content, assetId)
        || jsonContains(hotspot.action, assetId)
    ));
    const derivativeIds = derivatives.map((derivative) => derivative.id);
    const publications = projectIds.length === 0
      ? []
      : await Publication.findAll({
        where: { projectId: { [Op.in]: projectIds }, status: { [Op.in]: ['published', 'retired'] } },
        attributes: ['compiledManifest'],
        transaction
      });
    const publishedSceneDefinitions = projectIds.length === 0
      ? []
      : await PublishedSceneDefinition.findAll({
        where: { projectId: { [Op.in]: projectIds } },
        attributes: ['compiledScene'],
        transaction
      });
    const publicationReference = publications.some((publication) =>
      jsonContains(publication.compiledManifest, assetId)
        || derivativeIds.some((derivativeId) => jsonContains(publication.compiledManifest, derivativeId))
    ) || publishedSceneDefinitions.some((definition) =>
      jsonContains(definition.compiledScene, assetId)
        || derivativeIds.some((derivativeId) => jsonContains(definition.compiledScene, derivativeId))
    );
    if (sceneReference > 0 || embeddedReference || publicationReference) {
      throw conflict('ASSET_IN_USE', 'The asset is referenced by an experience and cannot be deleted.', { assetId });
    }
    const storageKeys = [...new Set([
      asset.sourceStorageKey,
      ...derivatives.flatMap((derivative) => [
        derivative.storageKey,
        ...derivativeSupportingStorageKeys(derivative.metadata)
      ])
    ])];
    await enqueueStorageDeletions({ assetId, storageKeys, transaction });
    await MediaJob.destroy({ where: { assetId }, transaction });
    await AssetDerivative.destroy({ where: { assetId }, transaction });
    await UploadSession.destroy({ where: { assetId }, transaction });
    await asset.destroy({ transaction });
    return storageKeys;
  });
  try {
    await drainStorageDeletionJobs({
      storage: options.storage ?? defaultStorage,
      assetId,
      maxJobs: removedStorageKeys.length,
    });
  } catch (error) {
    // Logical deletion has committed. The durable queue is the source of truth
    // and a worker will safely retry physical cleanup.
    logger.error({ err: error, assetId }, 'inline asset storage cleanup failed');
  }
  return { deleted: true, assetId };
}
