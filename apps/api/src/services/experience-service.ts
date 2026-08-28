import { Op, type Transaction } from 'sequelize';
import { createMediaToken, createTelemetryToken, verifyMediaToken } from '../auth/tokens';
import { config } from '../config';
import { logger } from '../config/logger';
import { LIVE_PATCH_CONTRACT_VERSION } from '@sphere/live-patch';
import {
  COMPILER_VERSION,
  DEFAULT_MEDIA_DELIVERY_POLICY,
  ExperienceCompilationError,
  ExperienceCompiler,
  COMPILED_MANIFEST_VERSION,
  contentHash,
  createViewerIntegrationAdapter,
  type CompileExperienceInput,
  type CompiledExperienceBundle,
  type CompilerPreflightResult,
  type PublicationVisibility
} from '@sphere/experience-compiler';
import type {
  CanonicalAsset,
  CanonicalBranding,
  CanonicalHotspot,
  CanonicalOverlay,
  CanonicalOverlayAppearance,
  CanonicalPlan,
  CanonicalSpatialData,
  CanonicalTimelineAction,
  CanonicalTimelineContent,
  CanonicalTimelineInteraction,
  CanonicalTimelineVisibilityRules,
  CanonicalViewpoint,
  CanonicalHotspotAction,
  CanonicalHotspotAppearance,
  CanonicalHotspotContent,
  CanonicalInitialView,
  CanonicalInteractionGeometry,
  CanonicalProject,
  CanonicalProjectSettings,
  CanonicalScene,
  CanonicalSceneConnection,
  CanonicalSceneConnectionContent,
  CanonicalViewLimits,
  CanonicalVisibilityRules,
  JsonObject as CanonicalJsonObject,
  SphericalPosition
} from '@sphere/experience-schema';
import { sequelize } from '../database';
import { AppError, conflict, notFound } from '../errors/app-error';
import {
  Asset,
  AssetDerivative,
  Hotspot,
  Overlay,
  Plan,
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
import type { AccessRole } from '../models/model.types';
import { incrementMetric, observeMetric } from '../observability';
import { requireProjectRole } from './access-service';
import { recordAudit } from './audit-service';
import { loadExtensionRegistry } from './extension-service';
import {
  contentSecurityPolicyHeader,
  embedOriginDenied,
  embedPolicyToJson,
  evaluateEmbedOrigin,
  normalizeEmbedPolicy,
  resolveEmbedPolicy,
  type EmbedPolicy
} from './embed-policy-service';
import { publishProjectEvent } from './project-events-service';
import { verifyShareToken } from './share-token-service';
import { resolveViewerIntegrationVersion } from './viewer-integration-service';
import {
  NoCompatibleVideoProfileError,
  selectVideoPlaybackProfile,
  type VideoDeviceCapabilities,
  type VideoProfileCandidate
} from '@sphere/experience-schema';
import { sha256, stableJson } from '../utils/hash';
import {
  completeIdempotencyLease,
  failIdempotencyLeasePersisted
} from './idempotency-service';

const compilersByVersion = new Map<string, ExperienceCompiler>();

/**
 * One compiler per viewer integration version. A rollout can therefore compile
 * some projects with a candidate adapter without a second code path, and a
 * publication always records the exact version it was built with.
 */
function compilerFor(viewerIntegrationVersion: string): ExperienceCompiler {
  const existing = compilersByVersion.get(viewerIntegrationVersion);
  if (existing) return existing;
  const created = new ExperienceCompiler({
    // The compiler emits logical delivery locations only. Signing them is a
    // server-side hydration step performed after compilation, which is what
    // keeps the compiled output free of credentials and safe to reproduce.
    mediaDeliveryPolicy: DEFAULT_MEDIA_DELIVERY_POLICY,
    viewerIntegrationAdapter: createViewerIntegrationAdapter(viewerIntegrationVersion),
    tourStrategyPolicy: config.tourStrategyPolicy
  });
  compilersByVersion.set(viewerIntegrationVersion, created);
  return created;
}

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

function mapOverlay(overlay: Overlay): CanonicalOverlay {
  const position = overlay.position as unknown as SphericalPosition;
  return {
    id: overlay.id,
    sceneId: overlay.sceneId,
    ...(overlay.name === null ? {} : { name: overlay.name }),
    geometry: overlay.geometry as unknown as CanonicalInteractionGeometry,
    ...(overlay.position.coordinateSystem === 'spherical_degrees' ? { position } : {}),
    appearance: overlay.appearance as unknown as CanonicalOverlayAppearance,
    content: overlay.content as unknown as CanonicalHotspotContent,
    action: overlay.action as unknown as CanonicalHotspotAction,
    visibilityRules: overlay.visibilityRules as unknown as CanonicalVisibilityRules,
    sortOrder: overlay.sortOrder,
    createdAt: overlay.createdAt,
    updatedAt: overlay.updatedAt
  };
}

function mapPlan(plan: Plan): CanonicalPlan {
  return {
    id: plan.id,
    projectId: plan.projectId,
    name: plan.name,
    assetId: plan.assetId,
    coordinateSystem: plan.coordinateSystem,
    metadata: asCanonicalJson(plan.metadata),
    sortOrder: plan.sortOrder,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt
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
    overlays: (scene.overlays ?? []).map(mapOverlay),
    connections: (scene.connections ?? []).map(mapSceneConnection),
    spatialData: scene.spatialData as unknown as CanonicalSpatialData,
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

/**
 * Loads the canonical Experience for compilation.
 *
 * `actorUserId` is who is asking; the project's own owner is who the media
 * library belongs to. Keeping the two apart is what lets a workspace editor
 * preview and publish a project they do not personally own.
 */
/**
 * Loads a project and its assets in the canonical shape the compiler takes.
 *
 * Exported so the editor bootstrap assembles its payload from exactly the same
 * data publish and preview compile from; a second loader is a second truth.
 */
export async function loadCompilableExperience(options: {
  projectId: string;
  actorUserId: string;
  requiredRole: AccessRole;
  transaction?: Transaction;
  lockProject?: boolean;
}): Promise<{ project: Project; inputProject: CanonicalProject; assets: CanonicalAsset[] }> {
  const access = await requireProjectRole(
    options.projectId,
    options.actorUserId,
    options.requiredRole,
    options.transaction
  );
  const ownerId = access.ownerId;
  // PostgreSQL cannot apply a blanket FOR UPDATE to the nullable side of the
  // LEFT JOINs used to hydrate scenes and hotspots. Lock the aggregate root in
  // a small, separate query, then read the graph while that row lock is held.
  if (options.lockProject && options.transaction) {
    await User.findByPk(ownerId, {
      transaction: options.transaction,
      lock: options.transaction.LOCK.UPDATE
    });
    const lockedProject = await Project.findOne({
      where: { id: options.projectId },
      attributes: ['id'],
      transaction: options.transaction,
      lock: options.transaction.LOCK.UPDATE
    });
    if (!lockedProject) throw notFound('project', options.projectId);
  }
  const project = await Project.findOne({
    where: { id: options.projectId },
    include: [{
      model: Scene,
      as: 'scenes',
      include: [
        { model: Hotspot, as: 'hotspots' },
        { model: Overlay, as: 'overlays' },
        { model: SceneConnection, as: 'connections' }
      ]
    }],
    order: [
      [{ model: Scene, as: 'scenes' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, 'id', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: Overlay, as: 'overlays' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: SceneConnection, as: 'connections' }, 'id', 'ASC']
    ],
    ...(options.transaction === undefined ? {} : { transaction: options.transaction })
  });
  if (!project) throw notFound('project', options.projectId);
  const assets = await Asset.findAll({
    where: {
      ownerId,
      [Op.or]: [{ projectId: options.projectId }, { projectId: null }]
    },
    include: [{ model: AssetDerivative, as: 'derivatives' }],
    ...(options.transaction === undefined ? {} : { transaction: options.transaction })
  });
  const plans = project.type === 'image360'
    ? await Plan.findAll({
      where: { projectId: options.projectId },
      order: [['sortOrder', 'ASC'], ['id', 'ASC']],
      ...(options.transaction === undefined ? {} : { transaction: options.transaction })
    })
    : [];
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
    ...(project.type === 'image360' ? { plans: plans.map(mapPlan) } : {}),
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

const loadExperience = loadCompilableExperience;

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
  actorUserId: string,
  expectedRevision: number
): Promise<CompilerPreflightResult> {
  const loaded = await loadExperience({ projectId, actorUserId, requiredRole: 'viewer' });
  assertRevision(loaded.project, expectedRevision);
  const viewerIntegrationVersion = await resolveViewerIntegrationVersion(projectId);
  const result = compilerFor(viewerIntegrationVersion).preflight({
    project: loaded.inputProject,
    assets: loaded.assets,
    target: 'preview',
    extensions: await loadExtensionRegistry()
  });
  if (!result.valid) {
    for (const issue of result.issues) {
      incrementMetric('compile.validation_failed', {
        experienceType: loaded.project.type,
        issueCode: issue.code
      });
    }
  }
  return result;
}

export async function previewExperience(
  projectId: string,
  actorUserId: string,
  expectedRevision: number
): Promise<JsonObject> {
  const loaded = await loadExperience({ projectId, actorUserId, requiredRole: 'editor' });
  assertRevision(loaded.project, expectedRevision);
  const viewerIntegrationVersion = await resolveViewerIntegrationVersion(projectId);
  const startedAt = Date.now();
  try {
    const compiled = compilerFor(viewerIntegrationVersion).compile({
      project: loaded.inputProject,
      assets: loaded.assets,
      target: 'preview',
      extensions: await loadExtensionRegistry()
    });
    observeMetric('compile.duration', Date.now() - startedAt, {
      experienceType: loaded.project.type,
      target: 'preview'
    });
    // The compiled manifest carries logical delivery locations. A creator's
    // preview needs media it can actually fetch, so the signed, expiring URLs
    // are applied here — after compilation, where the clock and the signing key
    // live.
    return hydrateProtectedMediaUrls(
      compiled as unknown as JsonObject,
      undefined,
      signedMediaExpiry()
    );
  } catch (error) {
    if (error instanceof ExperienceCompilationError) {
      incrementMetric('compile.validation_failed', {
        experienceType: loaded.project.type,
        issueCode: error.issues[0]?.code ?? 'EXPERIENCE_COMPILATION_FAILED'
      });
    }
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

/**
 * Guards the compiler against experiences that would exceed the platform's
 * publish budget. Rejecting early keeps a runaway project from turning into an
 * unserveable manifest or an out-of-memory publish.
 */
function assertPublishBudget(bundle: CompiledExperienceBundle, experienceType: string): void {
  const limits = config.publishLimits;
  const sceneCount = bundle.sceneDefinitions.length;
  if (sceneCount > limits.maxScenes) {
    throw new AppError('EXPERIENCE_TOO_LARGE', 'This experience has too many scenes to publish.', {
      status: 422,
      details: { sceneCount, maximumScenes: limits.maxScenes }
    });
  }
  const manifestBytes = Buffer.byteLength(JSON.stringify(bundle.manifest), 'utf8');
  observeMetric('compile.manifest_bytes', manifestBytes, { experienceType });
  observeMetric('compile.scene_count', sceneCount, { experienceType });
  if (manifestBytes > limits.maxManifestBytes) {
    throw new AppError('EXPERIENCE_TOO_LARGE', 'This experience is too large to publish.', {
      status: 422,
      details: { manifestBytes, maximumManifestBytes: limits.maxManifestBytes }
    });
  }
  let sceneDefinitionBytes = 0;
  for (const definition of bundle.sceneDefinitions) {
    const bytes = Buffer.byteLength(JSON.stringify(definition), 'utf8');
    sceneDefinitionBytes += bytes;
    if (bytes > limits.maxSceneDefinitionBytes) {
      throw new AppError('SCENE_TOO_LARGE', 'One scene is too large to publish.', {
        status: 422,
        entityId: definition.scene.id,
        details: { sceneBytes: bytes, maximumSceneBytes: limits.maxSceneDefinitionBytes }
      });
    }
  }
  observeMetric('publish.scene_definition_bytes', sceneDefinitionBytes, { experienceType });
}

/** Extension versions this revision depends on, frozen so a later registry change cannot alter it. */
function pinnedExtensions(bundle: CompiledExperienceBundle): JsonObject {
  return { ...(bundle.manifest.pinnedExtensions as unknown as JsonObject) };
}

/**
 * Compares a client's locally computed content hash with the server's.
 *
 * The client's value is advisory and nothing else: publish always recompiles
 * server-side and stores its own result. A disagreement means a browser
 * compiled something different from what was published, which is a bug worth
 * an operational alert — but never a reason to publish the client's answer, or
 * to fail a publish that is otherwise correct.
 */
function recordAdvisoryHash(options: {
  projectId: string;
  projectRevision: number;
  experienceType: string;
  viewerIntegrationVersion: string;
  bundle: CompiledExperienceBundle;
  clientContentHash?: string;
}): void {
  if (options.clientContentHash === undefined) return;
  const serverContentHash = contentHash({
    manifest: options.bundle.manifest,
    sceneDefinitions: options.bundle.sceneDefinitions,
    sceneIndex: options.bundle.sceneIndex ?? []
  });
  if (serverContentHash === options.clientContentHash) return;
  incrementMetric('publish.hash_drift', { experienceType: options.experienceType });
  logger.warn(
    {
      projectId: options.projectId,
      projectRevision: options.projectRevision,
      compilerVersion: COMPILER_VERSION,
      livePatchContractVersion: LIVE_PATCH_CONTRACT_VERSION,
      viewerIntegrationVersion: options.viewerIntegrationVersion,
      serverContentHash,
      clientContentHash: options.clientContentHash
    },
    'client-computed content hash disagreed with the server; the server result was published'
  );
}

export async function publishExperience(options: {
  projectId: string;
  ownerId: string;
  expectedRevision: number;
  slug: string;
  visibility: PublicationVisibility;
  embedPolicy?: unknown;
  /** Advisory only: used to detect drift, never to decide what is published. */
  clientContentHash?: string;
  idempotencyRecord?: IdempotencyRecord;
}): Promise<Record<string, unknown>> {
  const publishStartedAt = Date.now();
  const viewerIntegrationVersion = await resolveViewerIntegrationVersion(options.projectId);
  const extensions = await loadExtensionRegistry();
  try {
    const outcome = await sequelize.transaction(async (transaction) => {
      const loaded = await loadExperience({
        projectId: options.projectId,
        actorUserId: options.ownerId,
        requiredRole: 'admin',
        transaction,
        lockProject: true
      });
      assertRevision(loaded.project, options.expectedRevision);
      const embedPolicy = options.embedPolicy === undefined
        ? resolveEmbedPolicy(
          (loaded.project.publicationMetadata as { embedPolicy?: unknown }).embedPolicy
        )
        : normalizeEmbedPolicy(options.embedPolicy);
      const publicationRevision = await nextPublicationRevision(options.projectId, transaction);
      const compileInput: CompileExperienceInput = {
        project: loaded.inputProject,
        assets: loaded.assets,
        target: 'publication',
        publicationRevision,
        visibility: options.visibility,
        publicationSlug: options.slug,
        extensions
      };
      let bundle: CompiledExperienceBundle;
      try {
        const compileStartedAt = Date.now();
        bundle = compilerFor(viewerIntegrationVersion).compileBundle(compileInput);
        observeMetric('compile.duration', Date.now() - compileStartedAt, {
          experienceType: loaded.project.type,
          target: 'publication'
        });
        assertPublishBudget(bundle, loaded.project.type);
        recordAdvisoryHash({
          projectId: options.projectId,
          projectRevision: loaded.project.revision,
          experienceType: loaded.project.type,
          viewerIntegrationVersion,
          bundle,
          ...(options.clientContentHash === undefined
            ? {}
            : { clientContentHash: options.clientContentHash })
        });
      } catch (error) {
        const compilation = error instanceof ExperienceCompilationError ? error : undefined;
        // A budget rejection is also a publish failure: it must leave a
        // diagnosable record and keep the previous revision live.
        const budget = error instanceof AppError
          && (error.code === 'EXPERIENCE_TOO_LARGE' || error.code === 'SCENE_TOO_LARGE')
          ? error
          : undefined;
        if (compilation === undefined && budget === undefined) throw error;
        const publishError = compilation === undefined
          ? budget!
          : compilationAppError(compilation);
        incrementMetric('publish.failed', {
          experienceType: loaded.project.type,
          errorCode: publishError.code
        });
        const failedPublication = await Publication.create(
          {
            projectId: options.projectId,
            projectRevision: loaded.project.revision,
            publicationRevision,
            slug: options.slug,
            visibility: options.visibility,
            compiledManifestVersion: String(COMPILED_MANIFEST_VERSION),
            compiledManifest: null,
            viewerIntegrationVersion,
            embedPolicy: embedPolicyToJson(embedPolicy),
            pinnedExtensions: {},
            status: 'publish_failed',
            isCurrent: false,
            shareMetadata: shareMetadata(options.slug),
            failureError: compilation === undefined
              ? {
                code: publishError.code,
                retryable: publishError.retryable,
                issues: [{
                  code: publishError.code,
                  message: publishError.message,
                  entityType: 'project',
                  ...(publishError.entityId === undefined ? {} : { entityId: publishError.entityId }),
                  path: publishError.path ?? 'project',
                  retryable: publishError.retryable
                }]
              }
              : {
                code: compilation.code,
                retryable: compilation.retryable,
                issues: compilation.issues.map((issue) => ({
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
          await failIdempotencyLeasePersisted(options.idempotencyRecord, publishError, {
            resourceType: 'publication',
            resourceId: failedPublication.id,
            transaction
          });
        }
        transaction.afterCommit(() => {
          publishProjectEvent({
            type: 'publication.failed',
            projectId: options.projectId,
            actorUserId: options.ownerId,
            data: {
              publicationId: failedPublication.id,
              publicationRevision,
              errorCode: publishError.code
            }
          });
        });
        return { compilationError: publishError };
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
          viewerIntegrationVersion: manifest.viewerIntegrationVersion,
          embedPolicy: embedPolicyToJson(embedPolicy),
          pinnedExtensions: pinnedExtensions(bundle),
          sceneIndex: (bundle.sceneIndex ?? []) as unknown as JsonObject[],
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
            publicationRevision,
            embedPolicy: embedPolicyToJson(embedPolicy)
          }
        },
        { transaction }
      );
      await recordAudit({
        action: 'project.published',
        actorUserId: options.ownerId,
        projectId: options.projectId,
        workspaceId: loaded.project.workspaceId,
        entityType: 'publication',
        entityId: publication.id,
        metadata: {
          publicationRevision,
          visibility: options.visibility,
          slug: options.slug,
          viewerIntegrationVersion: manifest.viewerIntegrationVersion,
          sceneCount: bundle.sceneDefinitions.length
        },
        transaction
      });
      incrementMetric('publish.succeeded', {
        experienceType: loaded.project.type,
        visibility: options.visibility,
        viewerIntegrationVersion: manifest.viewerIntegrationVersion
      });
      transaction.afterCommit(() => {
        publishProjectEvent({
          type: 'publication.completed',
          projectId: options.projectId,
          actorUserId: options.ownerId,
          data: {
            publicationId: publication.id,
            publicationRevision,
            slug: options.slug,
            visibility: options.visibility
          }
        });
      });
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
    observeMetric('publish.duration', Date.now() - publishStartedAt, { target: 'publication' });
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
    viewerIntegrationVersion: publication.viewerIntegrationVersion,
    embedPolicy: publication.embedPolicy,
    pinnedExtensions: publication.pinnedExtensions,
    status: publication.status,
    isCurrent: publication.isCurrent,
    share: publication.shareMetadata,
    publishedAt: publication.publishedAt,
    createdAt: publication.createdAt
  };
}

export async function listPublications(
  projectId: string,
  actorUserId: string
): Promise<Record<string, unknown>[]> {
  await requireProjectRole(projectId, actorUserId, 'viewer');
  const publications = await Publication.findAll({
    where: { projectId },
    order: [['publicationRevision', 'DESC']]
  });
  return publications.map(serializePublication);
}

/**
 * Changes where a published experience may be embedded without recompiling it.
 * The project keeps the policy as the authored default; the current publication
 * is updated so the change takes effect for visitors immediately.
 */
export async function updateEmbedPolicy(
  projectId: string,
  actorUserId: string,
  input: unknown
): Promise<Record<string, unknown>> {
  const decision = await requireProjectRole(projectId, actorUserId, 'admin');
  const policy = normalizeEmbedPolicy(input);
  const stored = embedPolicyToJson(policy);
  await sequelize.transaction(async (transaction) => {
    const project = await Project.findByPk(projectId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!project) throw notFound('project', projectId);
    await project.update(
      { publicationMetadata: { ...project.publicationMetadata, embedPolicy: stored } },
      { transaction }
    );
    await Publication.update(
      { embedPolicy: stored },
      { where: { projectId, isCurrent: true }, transaction }
    );
  });
  await recordAudit({
    action: 'publication.embed_policy_changed',
    actorUserId,
    projectId,
    workspaceId: decision.workspaceId,
    entityType: 'project',
    entityId: projectId,
    metadata: { mode: policy.mode, allowedOriginCount: policy.allowedOrigins.length }
  });
  return { embedPolicy: stored };
}

/**
 * Withdraws the current publication. The revision history and its compiled
 * artifacts are retained so republishing or auditing stays possible.
 */
export async function unpublishExperience(
  projectId: string,
  actorUserId: string
): Promise<Record<string, unknown>> {
  const decision = await requireProjectRole(projectId, actorUserId, 'admin');
  const result = await sequelize.transaction(async (transaction) => {
    const project = await Project.findByPk(projectId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!project) throw notFound('project', projectId);
    const publication = await Publication.findOne({
      where: { projectId, isCurrent: true, status: 'published' },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!publication) {
      throw new AppError('PUBLICATION_NOT_LIVE', 'This experience is not currently published.', {
        status: 409,
        entityId: projectId
      });
    }
    await publication.update({ status: 'retired', isCurrent: false }, { transaction });
    const metadata = { ...project.publicationMetadata };
    delete metadata.publicationId;
    delete metadata.publicationRevision;
    await project.update({ publicationMetadata: metadata }, { transaction });
    return {
      unpublished: true,
      projectId,
      publicationRevision: publication.publicationRevision
    };
  });
  await recordAudit({
    action: 'project.unpublished',
    actorUserId,
    projectId,
    workspaceId: decision.workspaceId,
    entityType: 'publication',
    entityId: projectId,
    metadata: { publicationRevision: result.publicationRevision }
  });
  return result;
}

export interface PublishedAccessRequest {
  readonly authenticatedUserId?: string;
  /** A share link presented by a visitor, as a token string. */
  readonly shareToken?: string;
  /** The requesting page's origin, when the request is cross-origin. */
  readonly origin?: string;
}

export interface PublishedAccessDecision {
  readonly embedPolicy: EmbedPolicy;
  readonly contentSecurityPolicy: string;
  readonly grantedBy: 'public' | 'owner' | 'collaborator' | 'share-token';
}

/**
 * The single access decision for everything a visitor can reach through a
 * publication: the manifest, progressive scene definitions and media.
 *
 * Ownership, project/workspace collaboration and share links are all resolved
 * here, and the embed origin allowlist is enforced on every surface so a
 * restricted experience cannot be framed by way of a scene or media endpoint.
 */
async function authorizePublishedAccess(
  publication: Publication,
  request: PublishedAccessRequest,
  surface: 'manifest' | 'scene' | 'media' | 'playback-profile'
): Promise<PublishedAccessDecision> {
  const embedPolicy = resolveEmbedPolicy(publication.embedPolicy);
  const originDecision = evaluateEmbedOrigin(embedPolicy, request.origin);
  if (!originDecision.allowed) {
    incrementMetric('access.embed_origin_denied', { surface });
    throw embedOriginDenied();
  }
  const decision = (grantedBy: PublishedAccessDecision['grantedBy']): PublishedAccessDecision => ({
    embedPolicy,
    contentSecurityPolicy: contentSecurityPolicyHeader(embedPolicy),
    grantedBy
  });

  if (publication.visibility !== 'private') return decision('public');
  if (request.authenticatedUserId !== undefined) {
    if (publication.project?.ownerId === request.authenticatedUserId) return decision('owner');
    try {
      await requireProjectRole(publication.projectId, request.authenticatedUserId, 'viewer');
      return decision('collaborator');
    } catch {
      // Fall through: a share link may still authorize this visitor.
    }
  }
  const grant = await verifyShareToken(publication.projectId, request.shareToken);
  if (grant !== undefined
    && (grant.publicationRevision === null
      || grant.publicationRevision === publication.publicationRevision)) {
    return decision('share-token');
  }
  incrementMetric('access.private_denied', {
    surface,
    reason: request.authenticatedUserId === undefined ? 'unauthenticated' : 'not-permitted'
  });
  throw new AppError(
    'PRIVATE_PUBLICATION_ACCESS_DENIED',
    'Authentication is required for this private experience.',
    { status: request.authenticatedUserId ? 403 : 401 }
  );
}

export async function resolveManifest(
  slug: string,
  request: PublishedAccessRequest = {}
): Promise<{
  manifest: JsonObject;
  publication: Record<string, unknown>;
  access: PublishedAccessDecision;
}> {
  const publication = await Publication.findOne({
    where: { slug, isCurrent: true, status: 'published' },
    include: [{ model: Project, as: 'project', attributes: ['id', 'ownerId'] }]
  });
  if (!publication || !publication.compiledManifest || !publication.project) {
    throw notFound('publication');
  }
  const access = await authorizePublishedAccess(publication, request, 'manifest');
  const manifest = publication.visibility === 'private'
    ? hydrateProtectedMediaUrls(publication.compiledManifest, publication.id)
    : publication.compiledManifest;
  return {
    manifest: withTelemetrySession(manifest, publication),
    publication: serializePublication(publication),
    access
  };
}

/**
 * Issues the ingest credential alongside the manifest.
 *
 * The stored manifest is immutable, so the credential cannot be baked in at
 * publish time without expiring in place. It is minted per manifest read, which
 * also means revoking a publication stops new sessions from reporting against
 * it once outstanding tokens age out.
 */
function withTelemetrySession(manifest: JsonObject, publication: Publication): JsonObject {
  const telemetry = record(manifest.telemetry);
  if (telemetry === undefined) return manifest;
  return {
    ...manifest,
    telemetry: {
      ...telemetry,
      ingestToken: createTelemetryToken({
        experienceId: publication.projectId,
        publicationRevision: publication.publicationRevision,
        viewerIntegrationVersion: publication.viewerIntegrationVersion
      }),
      ingestTokenExpiresAt: new Date(
        Date.now() + config.telemetryTokenTtlSeconds * 1000
      ).toISOString()
    }
  };
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

export const MAX_SCENE_INDEX_PAGE = 250;

/**
 * Serves the compiled scene index in pages for a large tour.
 *
 * A 100+ scene experience should not have to carry its whole index at startup,
 * and should not have to fetch every scene definition just to draw a gallery.
 */
export async function resolvePublishedSceneIndex(options: {
  slug: string;
  publicationRevision?: number;
  offset?: number;
  limit?: number;
  access?: PublishedAccessRequest;
}): Promise<{
  entries: JsonObject[];
  offset: number;
  limit: number;
  total: number;
  sceneIndexVersion: string | null;
  revisionPinned: boolean;
  visibility: PublicationVisibility;
  access: PublishedAccessDecision;
}> {
  const publication = await publishedScenePublication(options);
  const access = await authorizePublishedAccess(publication, options.access ?? {}, 'scene');
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(MAX_SCENE_INDEX_PAGE, Math.max(1, Math.trunc(options.limit ?? MAX_SCENE_INDEX_PAGE)));
  const stored = Array.isArray(publication.sceneIndex) ? publication.sceneIndex : [];
  const page = stored.slice(offset, offset + limit) as JsonObject[];
  const entries = publication.visibility === 'private'
    ? page.map((entry) => hydrateProtectedMediaUrls(entry, publication.id))
    : page;
  const tour = record(record(publication.compiledManifest ?? {})?.tour);
  return {
    entries,
    offset,
    limit,
    total: stored.length,
    sceneIndexVersion: typeof tour?.sceneIndexVersion === 'string' ? tour.sceneIndexVersion : null,
    revisionPinned: options.publicationRevision !== undefined,
    visibility: publication.visibility === 'public' ? 'public' : 'private',
    access
  };
}

export async function resolvePublishedScene(options: {
  slug: string;
  sceneId: string;
  publicationRevision?: number;
  access?: PublishedAccessRequest;
}): Promise<{
  sceneDefinition: JsonObject;
  checksum: string;
  revisionPinned: boolean;
  visibility: PublicationVisibility;
  access: PublishedAccessDecision;
}> {
  const startedAt = Date.now();
  const publication = await publishedScenePublication(options);
  const access = await authorizePublishedAccess(publication, options.access ?? {}, 'scene');
  const definition = await PublishedSceneDefinition.findOne({
    where: {
      publicationId: publication.id,
      projectId: publication.projectId,
      publicationRevision: publication.publicationRevision,
      sceneId: options.sceneId
    }
  });
  if (!definition) {
    incrementMetric('scene_definition.failed', { errorCode: 'PUBLISHED_SCENE_NOT_FOUND' });
    throw notFound('published scene', options.sceneId);
  }
  const sceneDefinition = publication.visibility === 'private'
    ? hydrateProtectedMediaUrls(definition.compiledScene, publication.id)
    : definition.compiledScene;
  incrementMetric('scene_definition.served', {
    visibility: publication.visibility,
    revisionPinned: options.publicationRevision !== undefined
  });
  observeMetric('scene_definition.latency', Date.now() - startedAt, {
    visibility: publication.visibility
  });
  return {
    sceneDefinition,
    checksum: definition.checksum,
    revisionPinned: options.publicationRevision !== undefined,
    visibility: publication.visibility === 'public' ? 'public' : 'private',
    access
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

/** When a signed media URL issued now stops working. */
function signedMediaExpiry(): string {
  return new Date(Date.now() + config.signedMediaTtlSeconds * 1000).toISOString();
}

/**
 * Turns the compiler's logical delivery locations into fetchable ones.
 *
 * This is the only place a media credential is created. The compiler emits a
 * reference and nothing more, so a manifest can be stored immutably, compiled
 * again anywhere, and compared byte for byte; the signature that makes it
 * fetchable is applied per read, against the clock and key this process holds.
 *
 * A tile template is rewritten too: it is derived from the same media path, so
 * it has to carry the same credential.
 */
function hydrateProtectedMediaUrls(
  manifest: JsonObject,
  publicationId?: string,
  expiresAt?: string
): JsonObject {
  const replacements = new Map<string, string>();
  for (const reference of compilerOwnedMediaReferences(manifest)) {
    const derivativeId = reference.derivativeId as string;
    const currentUrl = reference.url as string;
    const token = createMediaToken({
      derivativeId,
      ...(publicationId === undefined ? {} : { publicationId })
    });
    const queryIndex = currentUrl.indexOf('?');
    const mediaPath = queryIndex === -1 ? currentUrl : currentUrl.slice(0, queryIndex);
    replacements.set(mediaPath, encodeURIComponent(token));
  }
  const hydrated = JSON.parse(JSON.stringify(manifest, (_key, value: unknown) => {
    if (typeof value !== 'string') return value;
    for (const [mediaPath, token] of replacements) {
      if (value === mediaPath || value.startsWith(`${mediaPath}/`)) {
        return `${value}${value.includes('?') ? '&' : '?'}token=${token}`;
      }
    }
    return value;
  })) as JsonObject;
  if (expiresAt !== undefined) {
    for (const reference of compilerOwnedMediaReferences(hydrated)) {
      reference.expiresAt = expiresAt;
    }
  }
  return hydrated;
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
  // A collaborator on the asset's project reads the same media library as the
  // owner; permissions live on the project, not on the upload.
  if (authenticatedUserId && derivative.asset.projectId) {
    try {
      await requireProjectRole(derivative.asset.projectId, authenticatedUserId, 'viewer');
      return derivative;
    } catch {
      // Fall through to the signed-link check.
    }
  }
  if (mediaToken) {
    verifyMediaToken(mediaToken, derivativeId);
    return derivative;
  }
  incrementMetric('access.private_denied', { surface: 'media', reason: 'not-permitted' });
  throw new AppError('MEDIA_ACCESS_DENIED', 'You do not have access to this media.', { status: 403 });
}

export async function authorizePublishedDerivative(options: {
  projectId: string;
  publicationRevision: number;
  derivativeId: string;
  origin?: string;
}): Promise<AssetDerivative> {
  const publication = await Publication.findOne({
    where: {
      projectId: options.projectId,
      publicationRevision: options.publicationRevision,
      visibility: 'public',
      status: { [Op.in]: ['published', 'retired'] }
    },
    attributes: ['id', 'compiledManifest', 'embedPolicy', 'sceneIndex']
  });
  if (!publication) {
    throw new AppError('MEDIA_ACCESS_DENIED', 'You do not have access to this media.', { status: 403 });
  }
  // A restricted experience must not become embeddable through its media URLs.
  const originDecision = evaluateEmbedOrigin(resolveEmbedPolicy(publication.embedPolicy), options.origin);
  if (!originDecision.allowed) {
    incrementMetric('access.embed_origin_denied', { surface: 'media' });
    throw embedOriginDenied();
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
  // A segmented large-tour manifest carries only the first index segment, so a
  // scene-index thumbnail beyond it is reachable only through the stored index.
  if (!referenced) {
    referenced = manifestReferencesDerivative(publication.sceneIndex, options.derivativeId);
  }
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
  access?: PublishedAccessRequest;
}): Promise<PlaybackProfileResolution> {
  const publication = await Publication.findOne({
    where: { slug: options.slug, isCurrent: true, status: 'published' },
    include: [{ model: Project, as: 'project', attributes: ['id', 'ownerId'] }]
  });
  if (!publication?.compiledManifest || !publication.project) throw notFound('publication');
  await authorizePublishedAccess(publication, options.access ?? {}, 'playback-profile');

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
