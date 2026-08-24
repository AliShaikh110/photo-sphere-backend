import { Op, type Transaction } from 'sequelize';
import { createMediaToken, verifyMediaToken } from '../auth/tokens';
import { config } from '../config';
import {
  ExperienceCompilationError,
  ExperienceCompiler,
  COMPILED_MANIFEST_VERSION,
  type CompileExperienceInput,
  type CompiledExperienceManifest,
  type CompilerPreflightResult,
  type MediaUrlResolver,
  type PublicationVisibility
} from '../compiler';
import type {
  CanonicalAsset,
  CanonicalBranding,
  CanonicalHotspot,
  CanonicalHotspotAction,
  CanonicalHotspotAppearance,
  CanonicalHotspotContent,
  CanonicalInitialView,
  CanonicalProject,
  CanonicalProjectSettings,
  CanonicalScene,
  CanonicalViewLimits,
  CanonicalVisibilityRules,
  JsonObject as CanonicalJsonObject,
  SphericalPosition
} from '../domain';
import { sequelize } from '../database';
import { AppError, conflict, notFound } from '../errors/app-error';
import { Asset, AssetDerivative, Hotspot, Project, Publication, Scene, User } from '../models';
import type { IdempotencyRecord } from '../models';
import type { JsonObject } from '../models/model.types';
import {
  completeIdempotencyLease,
  failIdempotencyLeasePersisted
} from './idempotency-service';

const mediaUrlResolver: MediaUrlResolver = {
  resolve: ({ derivative, access, target, experienceId, publicationRevision }) => {
    const mediaPath = `/api/v1/media/${derivative.id}`;
    if (access === 'public' && target === 'publication') {
      if (publicationRevision === undefined) {
        throw new Error('Public publication media requires a publication revision.');
      }
      return `/api/v1/publications/${experienceId}/${publicationRevision}/media/${derivative.id}`;
    }
    if (access !== 'protected' || target !== 'preview') return mediaPath;
    const token = createMediaToken({ derivativeId: derivative.id });
    return {
      url: `${mediaPath}?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + config.signedMediaTtlSeconds * 1000).toISOString()
    };
  }
};

const compiler = new ExperienceCompiler({
  mediaUrlResolver,
  viewerIntegrationVersion: config.viewerIntegrationVersion
});

function asCanonicalJson(value: JsonObject): CanonicalJsonObject {
  return value as unknown as CanonicalJsonObject;
}

function mapHotspot(hotspot: Hotspot): CanonicalHotspot {
  return {
    id: hotspot.id,
    sceneId: hotspot.sceneId,
    geometry: hotspot.geometry as unknown as CanonicalHotspot['geometry'],
    position: hotspot.position as unknown as SphericalPosition,
    appearance: hotspot.appearance as unknown as CanonicalHotspotAppearance,
    content: hotspot.content as unknown as CanonicalHotspotContent,
    action: hotspot.action as unknown as CanonicalHotspotAction,
    visibilityRules: hotspot.visibilityRules as unknown as CanonicalVisibilityRules
  };
}

function mapScene(scene: Scene): CanonicalScene {
  return {
    id: scene.id,
    projectId: scene.projectId,
    name: scene.name,
    panoramaAssetId: scene.panoramaAssetId,
    sortOrder: scene.sortOrder,
    isPrimary: scene.isPrimary,
    initialView: scene.initialView as unknown as CanonicalInitialView,
    viewLimits: scene.viewLimits as unknown as CanonicalViewLimits,
    hotspots: (scene.hotspots ?? []).map(mapHotspot),
    overlays: scene.overlays as unknown as readonly CanonicalJsonObject[],
    connections: scene.connections as unknown as readonly CanonicalJsonObject[],
    spatialData: asCanonicalJson(scene.spatialData),
    runtimeHints: asCanonicalJson(scene.runtimeHints)
  };
}

function mapAsset(asset: Asset): CanonicalAsset {
  return {
    id: asset.id,
    ownerId: asset.ownerId,
    projectId: asset.projectId,
    mediaType: asset.mediaType,
    projection: asset.projection,
    processingStatus: asset.processingStatus,
    processingError: asset.processingError as unknown as Exclude<CanonicalAsset['processingError'], undefined>,
    metadata: asCanonicalJson(asset.metadata),
    derivatives: (asset.derivatives ?? []).map((derivative) => ({
      id: derivative.id,
      assetId: derivative.assetId,
      kind: derivative.kind,
      version: derivative.version,
      storageKey: derivative.storageKey,
      mimeType: derivative.mimeType,
      width: derivative.width,
      height: derivative.height,
      sizeBytes: derivative.sizeBytes,
      readiness: 'ready',
      metadata: asCanonicalJson(derivative.metadata),
      createdAt: derivative.createdAt
    }))
  };
}

async function loadExperience(options: {
  projectId: string;
  ownerId: string;
  transaction?: Transaction;
  lockProject?: boolean;
}): Promise<{ project: Project; inputProject: CanonicalProject; assets: CanonicalAsset[] }> {
  // PostgreSQL cannot apply a blanket FOR UPDATE to the nullable side of the
  // LEFT JOINs used to hydrate scenes and hotspots. Lock the aggregate root in
  // a small, separate query, then read the graph while that row lock is held.
  if (options.lockProject && options.transaction) {
    await User.findByPk(options.ownerId, {
      transaction: options.transaction,
      lock: options.transaction.LOCK.UPDATE
    });
    const lockedProject = await Project.findOne({
      where: { id: options.projectId, ownerId: options.ownerId },
      attributes: ['id'],
      transaction: options.transaction,
      lock: options.transaction.LOCK.UPDATE
    });
    if (!lockedProject) throw notFound('project', options.projectId);
  }
  const project = await Project.findOne({
    where: { id: options.projectId, ownerId: options.ownerId },
    include: [{
      model: Scene,
      as: 'scenes',
      include: [{ model: Hotspot, as: 'hotspots' }]
    }],
    order: [
      [{ model: Scene, as: 'scenes' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC']
    ],
    ...(options.transaction === undefined ? {} : { transaction: options.transaction })
  });
  if (!project) throw notFound('project', options.projectId);
  const assets = await Asset.findAll({
    where: {
      ownerId: options.ownerId,
      [Op.or]: [{ projectId: options.projectId }, { projectId: null }]
    },
    include: [{ model: AssetDerivative, as: 'derivatives' }],
    ...(options.transaction === undefined ? {} : { transaction: options.transaction })
  });
  const inputProject: CanonicalProject = {
    id: project.id,
    ownerId: project.ownerId,
    type: project.type,
    name: project.name,
    schemaVersion: project.schemaVersion,
    revision: project.revision,
    settings: project.settings as unknown as CanonicalProjectSettings,
    branding: project.branding as unknown as CanonicalBranding,
    scenes: (project.scenes ?? []).map(mapScene),
    publication: project.publicationMetadata as unknown as NonNullable<CanonicalProject['publication']>
  };
  return { project, inputProject, assets: assets.map(mapAsset) };
}

function assertRevision(project: Project, expectedRevision: number): void {
  if (project.revision !== expectedRevision) {
    throw conflict('REVISION_CONFLICT', 'The project was changed by another editor.', {
      expectedRevision,
      currentRevision: project.revision
    });
  }
}

function compilationAppError(error: ExperienceCompilationError): AppError {
  return new AppError('EXPERIENCE_VALIDATION_FAILED', 'The experience cannot be compiled yet.', {
    status: 422,
    ...(error.entityId === undefined ? {} : { entityId: error.entityId }),
    ...(error.path === undefined ? {} : { path: error.path }),
    retryable: error.retryable,
    details: { issues: error.issues }
  });
}

function mapCompilationError(error: unknown): never {
  if (error instanceof ExperienceCompilationError) throw compilationAppError(error);
  throw error;
}

export async function validateExperience(
  projectId: string,
  ownerId: string,
  expectedRevision: number
): Promise<CompilerPreflightResult> {
  const loaded = await loadExperience({ projectId, ownerId });
  assertRevision(loaded.project, expectedRevision);
  return compiler.preflight({
    project: loaded.inputProject,
    assets: loaded.assets,
    target: 'preview'
  });
}

export async function previewExperience(
  projectId: string,
  ownerId: string,
  expectedRevision: number
): Promise<CompiledExperienceManifest> {
  const loaded = await loadExperience({ projectId, ownerId });
  assertRevision(loaded.project, expectedRevision);
  try {
    return await compiler.compile({
      project: loaded.inputProject,
      assets: loaded.assets,
      target: 'preview'
    });
  } catch (error) {
    return mapCompilationError(error);
  }
}

function shareMetadata(slug: string): JsonObject {
  const directUrl = `${config.publicBaseUrl}/view/${slug}`;
  return {
    directUrl,
    embedUrl: directUrl,
    embedHtml: `<iframe src="${directUrl}" loading="lazy" allowfullscreen></iframe>`,
    qrTarget: directUrl
  };
}

async function nextPublicationRevision(projectId: string, transaction: Transaction): Promise<number> {
  const maximum = await Publication.max('publicationRevision', { where: { projectId }, transaction });
  return Number(maximum ?? 0) + 1;
}

export async function publishExperience(options: {
  projectId: string;
  ownerId: string;
  expectedRevision: number;
  slug: string;
  visibility: PublicationVisibility;
  idempotencyRecord?: IdempotencyRecord;
}): Promise<Record<string, unknown>> {
  try {
    const outcome = await sequelize.transaction(async (transaction) => {
      const loaded = await loadExperience({
        projectId: options.projectId,
        ownerId: options.ownerId,
        transaction,
        lockProject: true
      });
      assertRevision(loaded.project, options.expectedRevision);
      const publicationRevision = await nextPublicationRevision(options.projectId, transaction);
      const compileInput: CompileExperienceInput = {
        project: loaded.inputProject,
        assets: loaded.assets,
        target: 'publication',
        publicationRevision,
        visibility: options.visibility
      };
      let manifest: CompiledExperienceManifest;
      try {
        manifest = await compiler.compile(compileInput);
      } catch (error) {
        if (!(error instanceof ExperienceCompilationError)) throw error;
        const compilationError = compilationAppError(error);
        const failedPublication = await Publication.create(
          {
            projectId: options.projectId,
            projectRevision: loaded.project.revision,
            publicationRevision,
            slug: options.slug,
            visibility: options.visibility,
            compiledManifestVersion: String(COMPILED_MANIFEST_VERSION),
            compiledManifest: null,
            status: 'publish_failed',
            isCurrent: false,
            shareMetadata: shareMetadata(options.slug),
            failureError: {
              code: error.code,
              retryable: error.retryable,
              issues: error.issues.map((issue) => ({
                code: issue.code,
                message: issue.message,
                entityType: issue.entityType,
                ...(issue.entityId === undefined ? {} : { entityId: issue.entityId }),
                path: issue.path,
                retryable: issue.retryable
              }))
            },
            publishedAt: null
          },
          { transaction }
        );
        if (options.idempotencyRecord) {
          await failIdempotencyLeasePersisted(options.idempotencyRecord, compilationError, {
            resourceType: 'publication',
            resourceId: failedPublication.id,
            transaction
          });
        }
        return { compilationError };
      }
      const slugOwner = await Publication.findOne({
        where: {
          slug: options.slug,
          status: { [Op.in]: ['published', 'retired'] },
          projectId: { [Op.ne]: options.projectId }
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (slugOwner) {
        throw conflict('SLUG_ALREADY_EXISTS', 'That publication URL is already in use.', { slug: options.slug });
      }
      await Publication.update(
        { isCurrent: false, status: 'retired' },
        { where: { projectId: options.projectId, isCurrent: true }, transaction }
      );
      const share = shareMetadata(options.slug);
      const publication = await Publication.create(
        {
          projectId: options.projectId,
          projectRevision: loaded.project.revision,
          publicationRevision,
          slug: options.slug,
          visibility: options.visibility,
          compiledManifestVersion: String(manifest.manifestVersion),
          compiledManifest: manifest as unknown as JsonObject,
          status: 'published',
          isCurrent: true,
          shareMetadata: share,
          failureError: null,
          publishedAt: new Date()
        },
        { transaction }
      );
      await loaded.project.update(
        {
          publicationMetadata: {
            slug: options.slug,
            visibility: options.visibility,
            publicationId: publication.id,
            publicationRevision
          }
        },
        { transaction }
      );
      const result = {
        publication: serializePublication(publication),
        share
      };
      if (options.idempotencyRecord) {
        await completeIdempotencyLease(options.idempotencyRecord, result, {
          responseStatus: 201,
          resourceType: 'publication',
          resourceId: publication.id,
          transaction
        });
      }
      return { result };
    });
    if ('compilationError' in outcome) throw outcome.compilationError;
    return outcome.result;
  } catch (error) {
    return mapCompilationError(error);
  }
}

function serializePublication(publication: Publication): Record<string, unknown> {
  return {
    id: publication.id,
    projectId: publication.projectId,
    projectRevision: publication.projectRevision,
    publicationRevision: publication.publicationRevision,
    slug: publication.slug,
    visibility: publication.visibility,
    manifestVersion: publication.compiledManifestVersion,
    status: publication.status,
    isCurrent: publication.isCurrent,
    share: publication.shareMetadata,
    publishedAt: publication.publishedAt,
    createdAt: publication.createdAt
  };
}

export async function listPublications(projectId: string, ownerId: string): Promise<Record<string, unknown>[]> {
  const project = await Project.findOne({ where: { id: projectId, ownerId }, attributes: ['id'] });
  if (!project) throw notFound('project', projectId);
  const publications = await Publication.findAll({
    where: { projectId },
    order: [['publicationRevision', 'DESC']]
  });
  return publications.map(serializePublication);
}

export async function resolveManifest(
  slug: string,
  authenticatedUserId?: string
): Promise<{ manifest: JsonObject; publication: Record<string, unknown> }> {
  const publication = await Publication.findOne({
    where: { slug, isCurrent: true, status: 'published' },
    include: [{ model: Project, as: 'project', attributes: ['id', 'ownerId'] }]
  });
  if (!publication || !publication.compiledManifest || !publication.project) {
    throw notFound('publication');
  }
  if (publication.visibility === 'private' && publication.project.ownerId !== authenticatedUserId) {
    throw new AppError('PRIVATE_PUBLICATION_ACCESS_DENIED', 'Authentication is required for this private experience.', {
      status: authenticatedUserId ? 403 : 401
    });
  }
  const manifest = publication.visibility === 'private'
    ? hydrateProtectedMediaUrls(publication.compiledManifest, publication.id)
    : publication.compiledManifest;
  return { manifest, publication: serializePublication(publication) };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function mediaReferenceMatches(value: unknown, derivativeId: string): boolean {
  return record(value)?.derivativeId === derivativeId;
}

function compilerOwnedMediaReferences(value: unknown): Record<string, unknown>[] {
  const manifest = record(value);
  if (!manifest) return [];
  const references: Record<string, unknown>[] = [];
  const add = (candidate: unknown): void => {
    const reference = record(candidate);
    if (reference && typeof reference.derivativeId === 'string' && typeof reference.url === 'string') {
      references.push(reference);
    }
  };
  const branding = record(manifest.branding);
  add(branding?.logo);
  add(branding?.favicon);
  add(branding?.watermark);
  if (!Array.isArray(manifest.scenes)) return references;
  for (const sceneValue of manifest.scenes) {
    const scene = record(sceneValue);
    const panorama = record(scene?.panorama);
    add(panorama?.base);
    add(panorama?.primary);
    if (!Array.isArray(scene?.hotspots)) continue;
    for (const hotspotValue of scene.hotspots) {
      const hotspot = record(hotspotValue);
      add(record(hotspot?.appearance)?.icon);
      add(record(hotspot?.content)?.image);
      add(record(hotspot?.action)?.media);
    }
  }
  return references;
}

function hydrateProtectedMediaUrls(manifest: JsonObject, publicationId: string): JsonObject {
  const replacements = new Map<string, string>();
  for (const reference of compilerOwnedMediaReferences(manifest)) {
    const derivativeId = reference.derivativeId as string;
    const currentUrl = reference.url as string;
    const token = createMediaToken({ derivativeId, publicationId });
    replacements.set(currentUrl, `${currentUrl.split('?')[0]}?token=${encodeURIComponent(token)}`);
  }
  return JSON.parse(JSON.stringify(manifest, (_key, value: unknown) => (
    typeof value === 'string' ? replacements.get(value) ?? value : value
  ))) as JsonObject;
}

function manifestReferencesDerivative(value: unknown, derivativeId: string): boolean {
  const manifest = record(value);
  if (!manifest) return false;
  const branding = record(manifest.branding);
  if (
    mediaReferenceMatches(branding?.logo, derivativeId)
    || mediaReferenceMatches(branding?.favicon, derivativeId)
    || mediaReferenceMatches(branding?.watermark, derivativeId)
  ) return true;
  if (!Array.isArray(manifest.scenes)) return false;
  return manifest.scenes.some((sceneValue) => {
    const scene = record(sceneValue);
    const panorama = record(scene?.panorama);
    if (
      mediaReferenceMatches(panorama?.base, derivativeId)
      || mediaReferenceMatches(panorama?.primary, derivativeId)
    ) return true;
    if (!Array.isArray(scene?.hotspots)) return false;
    return scene.hotspots.some((hotspotValue) => {
      const hotspot = record(hotspotValue);
      const appearance = record(hotspot?.appearance);
      const content = record(hotspot?.content);
      const action = record(hotspot?.action);
      return mediaReferenceMatches(appearance?.icon, derivativeId)
        || mediaReferenceMatches(content?.image, derivativeId)
        || mediaReferenceMatches(action?.media, derivativeId);
    });
  });
}

export async function authorizeDerivative(
  derivativeId: string,
  authenticatedUserId?: string,
  mediaToken?: string
): Promise<AssetDerivative> {
  const derivative = await AssetDerivative.findByPk(derivativeId, {
    include: [{ model: Asset, as: 'asset' }]
  });
  if (!derivative || !derivative.asset) throw notFound('media');
  if (authenticatedUserId && derivative.asset.ownerId === authenticatedUserId) {
    return derivative;
  }
  if (mediaToken) {
    verifyMediaToken(mediaToken, derivativeId);
    return derivative;
  }
  throw new AppError('MEDIA_ACCESS_DENIED', 'You do not have access to this media.', { status: 403 });
}

export async function authorizePublishedDerivative(options: {
  projectId: string;
  publicationRevision: number;
  derivativeId: string;
}): Promise<AssetDerivative> {
  const publication = await Publication.findOne({
    where: {
      projectId: options.projectId,
      publicationRevision: options.publicationRevision,
      visibility: 'public',
      status: 'published',
      isCurrent: true
    },
    attributes: ['compiledManifest']
  });
  if (!publication?.compiledManifest
    || !manifestReferencesDerivative(publication.compiledManifest, options.derivativeId)) {
    throw new AppError('MEDIA_ACCESS_DENIED', 'You do not have access to this media.', { status: 403 });
  }
  const derivative = await AssetDerivative.findByPk(options.derivativeId);
  if (!derivative) throw notFound('media');
  return derivative;
}
