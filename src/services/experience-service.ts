import { Op, type Transaction } from 'sequelize';
import { createMediaToken, verifyMediaToken } from '../auth/tokens';
import { config } from '../config';
import {
  ExperienceCompilationError,
  ExperienceCompiler,
  COMPILED_MANIFEST_VERSION,
  type CompileExperienceInput,
  type CompiledExperienceBundle,
  type CompiledExperienceManifest,
  type CompilerPreflightResult,
  type MediaUrlResolver,
  type PublicationVisibility
} from '../compiler';
import type {
  CanonicalAsset,
  CanonicalBranding,
  CanonicalHotspot,
  CanonicalTimelineAction,
  CanonicalTimelineContent,
  CanonicalTimelineInteraction,
  CanonicalTimelineVisibilityRules,
  CanonicalViewpoint,
  CanonicalHotspotAction,
  CanonicalHotspotAppearance,
  CanonicalHotspotContent,
  CanonicalInitialView,
  CanonicalProject,
  CanonicalProjectSettings,
  CanonicalScene,
  CanonicalSceneConnection,
  CanonicalSceneConnectionContent,
  CanonicalViewLimits,
  CanonicalVisibilityRules,
  JsonObject as CanonicalJsonObject,
  SphericalPosition
} from '../domain';
import { sequelize } from '../database';
import { AppError, conflict, notFound } from '../errors/app-error';
import {
  Asset,
  AssetDerivative,
  Hotspot,
  Project,
  Publication,
  PublishedSceneDefinition,
  Scene,
  SceneConnection,
  TimelineInteraction,
  User
} from '../models';
import type { IdempotencyRecord } from '../models';
import type { JsonObject } from '../models/model.types';
import {
  NoCompatibleVideoProfileError,
  selectVideoPlaybackProfile,
  type VideoDeviceCapabilities,
  type VideoProfileCandidate
} from '../runtime';
import { sha256, stableJson } from '../utils/hash';
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
  viewerIntegrationVersion: config.viewerIntegrationVersion,
  tourStrategyPolicy: config.tourStrategyPolicy
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

function mapSceneConnection(connection: SceneConnection): CanonicalSceneConnection {
  return {
    id: connection.id,
    sourceSceneId: connection.sourceSceneId,
    targetSceneId: connection.targetSceneId,
    ...(connection.triggerHotspotId === null ? {} : { triggerHotspotId: connection.triggerHotspotId }),
    ...(connection.label === null ? {} : { label: connection.label }),
    content: connection.content as unknown as CanonicalSceneConnectionContent,
    ...(connection.importance === null ? {} : { importance: connection.importance }),
    ...(connection.preloadHint === null ? {} : { preloadHint: connection.preloadHint }),
    createdAt: connection.createdAt
  };
}

function mapTimelineInteraction(interaction: TimelineInteraction): CanonicalTimelineInteraction {
  const geometry = interaction.geometry as unknown as CanonicalHotspot['geometry'];
  const position = interaction.position as unknown as SphericalPosition;
  const viewpoint = interaction.viewpoint as unknown as CanonicalViewpoint;
  return {
    id: interaction.id,
    projectId: interaction.projectId,
    kind: interaction.kind,
    timeMs: interaction.timeMs,
    endTimeMs: interaction.endTimeMs,
    ...(typeof interaction.geometry.kind === 'string' ? { geometry } : {}),
    ...(interaction.position.coordinateSystem === 'spherical_degrees' ? { position } : {}),
    ...(typeof interaction.viewpoint.headingDegrees === 'number' ? { viewpoint } : {}),
    appearance: interaction.appearance as unknown as CanonicalHotspotAppearance,
    content: interaction.content as unknown as CanonicalTimelineContent,
    action: interaction.action as unknown as CanonicalTimelineAction,
    visibilityRules: interaction.visibilityRules as unknown as CanonicalTimelineVisibilityRules,
    sortOrder: interaction.sortOrder,
    createdAt: interaction.createdAt,
    updatedAt: interaction.updatedAt
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
    connections: (scene.connections ?? []).map(mapSceneConnection),
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
      include: [
        { model: Hotspot, as: 'hotspots' },
        { model: SceneConnection, as: 'connections' }
      ]
    }],
    order: [
      [{ model: Scene, as: 'scenes' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, 'id', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: SceneConnection, as: 'connections' }, 'id', 'ASC']
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
  const timeline = project.type === 'video360'
    ? await TimelineInteraction.findAll({
      where: { projectId: options.projectId },
      order: [['timeMs', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']],
      ...(options.transaction === undefined ? {} : { transaction: options.transaction })
    })
    : [];
  const inputProject: CanonicalProject = {
    id: project.id,
    ownerId: project.ownerId,
    type: project.type,
    name: project.name,
    schemaVersion: project.schemaVersion,
    revision: project.revision,
    settings: {
      ...(project.settings as unknown as CanonicalProjectSettings),
      // Product-level video playback settings live on the project row, not in
      // the generic settings blob; the canonical model presents them together.
      ...(project.type === 'video360'
        ? { video: project.videoSettings as unknown as NonNullable<CanonicalProjectSettings['video']> }
        : {})
    },
    branding: project.branding as unknown as CanonicalBranding,
    scenes: (project.scenes ?? []).map(mapScene),
    ...(project.type === 'video360'
      ? {
        videoAssetId: project.videoAssetId,
        timeline: timeline.map(mapTimelineInteraction)
      }
      : {}),
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
        visibility: options.visibility,
        publicationSlug: options.slug
      };
      let bundle: CompiledExperienceBundle;
      try {
        bundle = await compiler.compileBundle(compileInput);
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
      const manifest = bundle.manifest;
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
      await PublishedSceneDefinition.bulkCreate(
        bundle.sceneDefinitions.map((definition) => ({
          publicationId: publication.id,
          projectId: options.projectId,
          publicationRevision,
          sceneId: definition.scene.id,
          compiledSceneVersion: String(definition.sceneDefinitionVersion),
          compiledScene: definition as unknown as JsonObject,
          checksum: sha256(stableJson(definition))
        })),
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

async function publishedScenePublication(options: {
  slug: string;
  publicationRevision?: number;
}): Promise<Publication> {
  const revisionPinned = options.publicationRevision !== undefined;
  const publication = await Publication.findOne({
    where: {
      slug: options.slug,
      ...(revisionPinned
        ? {
            publicationRevision: options.publicationRevision,
            status: { [Op.in]: ['published', 'retired'] }
          }
        : { isCurrent: true, status: 'published' })
    },
    include: [{ model: Project, as: 'project', attributes: ['id', 'ownerId'] }]
  });
  if (!publication?.project) throw notFound('publication');
  return publication;
}

function assertPublicationAccess(publication: Publication, authenticatedUserId?: string): void {
  if (publication.visibility !== 'private') return;
  if (publication.project?.ownerId === authenticatedUserId) return;
  throw new AppError(
    'PRIVATE_PUBLICATION_ACCESS_DENIED',
    'Authentication is required for this private experience.',
    { status: authenticatedUserId ? 403 : 401 }
  );
}

export async function resolvePublishedScene(options: {
  slug: string;
  sceneId: string;
  publicationRevision?: number;
  authenticatedUserId?: string;
}): Promise<{
  sceneDefinition: JsonObject;
  checksum: string;
  revisionPinned: boolean;
  visibility: PublicationVisibility;
}> {
  const publication = await publishedScenePublication(options);
  assertPublicationAccess(publication, options.authenticatedUserId);
  const definition = await PublishedSceneDefinition.findOne({
    where: {
      publicationId: publication.id,
      projectId: publication.projectId,
      publicationRevision: publication.publicationRevision,
      sceneId: options.sceneId
    }
  });
  if (!definition) throw notFound('published scene', options.sceneId);
  const sceneDefinition = publication.visibility === 'private'
    ? hydrateProtectedMediaUrls(definition.compiledScene, publication.id)
    : definition.compiledScene;
  return {
    sceneDefinition,
    checksum: definition.checksum,
    revisionPinned: options.publicationRevision !== undefined,
    visibility: publication.visibility === 'public' ? 'public' : 'private'
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function compilerOwnedMediaReferences(value: unknown): Record<string, unknown>[] {
  const references: Record<string, unknown>[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const object = record(candidate);
    if (!object) return;
    if (typeof object.derivativeId === 'string' && typeof object.url === 'string') {
      references.push(object);
    }
    Object.values(object).forEach(visit);
  };
  visit(value);
  return references;
}

function hydrateProtectedMediaUrls(manifest: JsonObject, publicationId: string): JsonObject {
  const replacements = new Map<string, string>();
  for (const reference of compilerOwnedMediaReferences(manifest)) {
    const derivativeId = reference.derivativeId as string;
    const currentUrl = reference.url as string;
    const token = createMediaToken({ derivativeId, publicationId });
    const queryIndex = currentUrl.indexOf('?');
    const mediaPath = queryIndex === -1 ? currentUrl : currentUrl.slice(0, queryIndex);
    replacements.set(mediaPath, encodeURIComponent(token));
  }
  return JSON.parse(JSON.stringify(manifest, (_key, value: unknown) => {
    if (typeof value !== 'string') return value;
    for (const [mediaPath, token] of replacements) {
      if (value === mediaPath || value.startsWith(`${mediaPath}/`)) {
        return `${value}${value.includes('?') ? '&' : '?'}token=${token}`;
      }
    }
    return value;
  })) as JsonObject;
}

function manifestReferencesDerivative(value: unknown, derivativeId: string): boolean {
  return compilerOwnedMediaReferences(value).some(
    (reference) => reference.derivativeId === derivativeId
  );
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
      status: { [Op.in]: ['published', 'retired'] }
    },
    attributes: ['id', 'compiledManifest']
  });
  if (!publication) {
    throw new AppError('MEDIA_ACCESS_DENIED', 'You do not have access to this media.', { status: 403 });
  }
  // A retired public revision stays addressable only while the experience is
  // still published publicly. Republishing it as private revokes anonymous
  // origin access to every earlier public revision.
  const currentPublication = await Publication.findOne({
    where: { projectId: options.projectId, isCurrent: true, status: 'published' },
    attributes: ['visibility']
  });
  if (currentPublication?.visibility !== 'public') {
    throw new AppError('MEDIA_ACCESS_DENIED', 'You do not have access to this media.', { status: 403 });
  }
  let referenced = publication.compiledManifest !== null
    && manifestReferencesDerivative(publication.compiledManifest, options.derivativeId);
  if (!referenced) {
    const definitions = await PublishedSceneDefinition.findAll({
      where: {
        publicationId: publication.id,
        projectId: options.projectId,
        publicationRevision: options.publicationRevision
      },
      attributes: ['compiledScene']
    });
    referenced = definitions.some((definition) => (
      manifestReferencesDerivative(definition.compiledScene, options.derivativeId)
    ));
  }
  if (!referenced) {
    throw new AppError('MEDIA_ACCESS_DENIED', 'You do not have access to this media.', { status: 403 });
  }
  const derivative = await AssetDerivative.findByPk(options.derivativeId);
  if (!derivative) throw notFound('media');
  return derivative;
}

export interface PlaybackProfileResolution {
  readonly experienceId: string;
  readonly publicationRevision: number;
  readonly selection: Record<string, unknown>;
}

/**
 * Server-side playback profile selection. Players may instead choose from the
 * ordered candidate list embedded in the manifest; this endpoint exists so the
 * decision can also be made and observed on the platform side.
 */
export async function resolvePlaybackProfile(options: {
  slug: string;
  device: VideoDeviceCapabilities;
  authenticatedUserId?: string;
}): Promise<PlaybackProfileResolution> {
  const publication = await Publication.findOne({
    where: { slug: options.slug, isCurrent: true, status: 'published' },
    include: [{ model: Project, as: 'project', attributes: ['id', 'ownerId'] }]
  });
  if (!publication?.compiledManifest || !publication.project) throw notFound('publication');
  assertPublicationAccess(publication, options.authenticatedUserId);

  const manifest = publication.visibility === 'private'
    ? hydrateProtectedMediaUrls(publication.compiledManifest, publication.id)
    : publication.compiledManifest;
  if (manifest.experienceType !== 'video360') {
    throw new AppError('PLAYBACK_PROFILE_NOT_APPLICABLE', 'This experience is not a 360 video.', {
      status: 422,
      entityId: publication.projectId
    });
  }
  const video = record(manifest.video);
  const profiles = Array.isArray(video?.profiles) ? video.profiles : [];
  const candidates: VideoProfileCandidate[] = profiles.flatMap((entry) => {
    const profile = record(entry);
    const media = record(profile?.media);
    const constraints = record(profile?.constraints);
    if (!profile || !media || !constraints) return [];
    if (typeof profile.profileId !== 'string' || typeof media.derivativeId !== 'string') return [];
    return [{
      profileId: profile.profileId as VideoProfileCandidate['profileId'],
      derivativeId: media.derivativeId,
      mimeType: String(constraints.mimeType ?? media.mimeType ?? 'video/mp4'),
      width: Number(media.width ?? constraints.maxWidth ?? 0),
      height: Number(media.height ?? 0),
      handheldSafe: constraints.handheldSafe === true
    }];
  });

  let selection;
  try {
    selection = selectVideoPlaybackProfile(candidates, options.device);
  } catch (error) {
    if (!(error instanceof NoCompatibleVideoProfileError)) throw error;
    throw new AppError(
      'VIDEO_PLAYBACK_CAPABILITY_UNSUPPORTED',
      'No published playback profile is compatible with this device.',
      { status: 422, entityId: publication.projectId, details: { candidates: candidates.length } }
    );
  }
  const selectedProfile = profiles
    .map((entry) => record(entry))
    .find((profile) => profile?.profileId === selection.selected.profileId);

  return {
    experienceId: publication.projectId,
    publicationRevision: publication.publicationRevision,
    selection: {
      policyVersion: selection.policyVersion,
      reason: selection.reason,
      rejected: selection.rejected,
      selected: selectedProfile ?? null,
      candidateProfileIds: selection.ordered.map((candidate) => candidate.profileId)
    }
  };
}

export interface DerivativeTileDescriptor {
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
}

export function resolveDerivativeTile(
  derivative: AssetDerivative,
  level: number,
  x: number,
  y: number
): DerivativeTileDescriptor {
  if (derivative.kind !== 'tiledLevels' || !Array.isArray(derivative.metadata.tiles)) {
    throw notFound('media tile');
  }
  const match = derivative.metadata.tiles.find((candidate) => {
    const tile = record(candidate);
    return tile?.level === level && tile.x === x && tile.y === y;
  });
  const tile = record(match);
  if (
    typeof tile?.storageKey !== 'string'
    || typeof tile.mimeType !== 'string'
    || typeof tile.sizeBytes !== 'number'
    || typeof tile.checksumSha256 !== 'string'
  ) {
    throw notFound('media tile');
  }
  return {
    storageKey: tile.storageKey,
    mimeType: tile.mimeType,
    sizeBytes: tile.sizeBytes,
    checksumSha256: tile.checksumSha256
  };
}
