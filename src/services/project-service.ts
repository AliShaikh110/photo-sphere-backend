import { Op, type Transaction } from 'sequelize';
import { sequelize } from '../database';
import { AppError, conflict, notFound } from '../errors/app-error';
import {
  Asset,
  Hotspot,
  Overlay,
  Plan,
  Project,
  Scene,
  SceneConnection,
  TimelineInteraction,
  User
} from '../models';
import type { AccessRole, JsonObject } from '../models/model.types';
import { sanitizePlainText } from '../security';
import { accessibleProjectFilter, requireProjectRole } from './access-service';
import {
  overlayPayload,
  sanitizeInteractionGeometry,
  type GeometryInput
} from './overlay-service';
import { planPayload } from './plan-service';
import { timelineInteractionPayload } from './timeline-service';
import {
  sanitizeBranding,
  sanitizeHotspotAction,
  sanitizeHotspotAppearance,
  sanitizeHotspotContent,
  sanitizeProjectSettings,
  sanitizeRequiredPlainText
} from './content-service';

type ProjectCreateInput = {
  type: 'image360' | 'video360';
  name: string;
  settings?: Record<string, unknown>;
  branding?: Record<string, unknown>;
  videoSettings?: Record<string, unknown>;
};

type ProjectUpdateInput = {
  revision: number;
  name?: string;
  settings?: Record<string, unknown>;
  branding?: Record<string, unknown>;
  videoAssetId?: string | null;
  videoSettings?: Record<string, unknown>;
};

/**
 * Loads a project the caller may act on at the given role. Ownership,
 * workspace membership and per-project grants are all resolved by the access
 * service, so every mutation path here is server-enforced.
 */
export async function getAccessibleProject(
  projectId: string,
  userId: string,
  required: AccessRole,
  transaction?: Transaction
): Promise<Project> {
  const decision = await requireProjectRole(projectId, userId, required, transaction);
  if (transaction) {
    // The owner row is the serialization anchor for a project's writes, so it
    // is locked before the project itself regardless of who is editing.
    await User.findByPk(decision.ownerId, { transaction, lock: transaction.LOCK.UPDATE });
  }
  const project = await Project.findOne({
    where: { id: projectId },
    ...(transaction === undefined ? {} : { transaction, lock: transaction.LOCK.UPDATE })
  });
  if (!project) throw notFound('project', projectId);
  return project;
}

/** Retained for callers that still express intent as "the project I own". */
export async function getOwnedProject(
  projectId: string,
  userId: string,
  transaction?: Transaction
): Promise<Project> {
  return getAccessibleProject(projectId, userId, 'editor', transaction);
}

async function revisionFailure(projectId: string, expectedRevision: number): Promise<never> {
  const project = await Project.findOne({ where: { id: projectId }, attributes: ['id', 'revision'] });
  if (!project) throw notFound('project', projectId);
  throw conflict('REVISION_CONFLICT', 'The project was changed by another editor.', {
    expectedRevision,
    currentRevision: project.revision
  });
}

export async function bumpProjectRevision(options: {
  projectId: string;
  expectedRevision: number;
  transaction: Transaction;
}): Promise<number> {
  const nextRevision = options.expectedRevision + 1;
  const [affected] = await Project.update(
    { revision: nextRevision },
    {
      where: {
        id: options.projectId,
        revision: options.expectedRevision
      },
      transaction: options.transaction
    }
  );
  if (affected !== 1) {
    await revisionFailure(options.projectId, options.expectedRevision);
  }
  return nextRevision;
}

function projectSummary(project: Project): Record<string, unknown> {
  return {
    id: project.id,
    type: project.type,
    name: project.name,
    schemaVersion: project.schemaVersion,
    revision: project.revision,
    publication: project.publicationMetadata,
    ...(project.type === 'video360'
      ? { videoAssetId: project.videoAssetId, videoSettings: project.videoSettings }
      : {}),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

function assetSummary(asset: Asset): Record<string, unknown> {
  return {
    id: asset.id,
    projectId: asset.projectId,
    mediaType: asset.mediaType,
    projection: asset.projection,
    metadata: asset.metadata,
    processingStatus: asset.processingStatus,
    processingError: asset.processingError,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  };
}

function hotspotPayload(hotspot: Hotspot): Record<string, unknown> {
  return {
    id: hotspot.id,
    sceneId: hotspot.sceneId,
    geometry: hotspot.geometry,
    position: hotspot.position,
    appearance: hotspot.appearance,
    content: hotspot.content,
    action: hotspot.action,
    visibilityRules: hotspot.visibilityRules,
    sortOrder: hotspot.sortOrder,
    createdAt: hotspot.createdAt,
    updatedAt: hotspot.updatedAt
  };
}

function connectionPayload(connection: SceneConnection): Record<string, unknown> {
  return {
    id: connection.id,
    sourceSceneId: connection.sourceSceneId,
    targetSceneId: connection.targetSceneId,
    ...(connection.triggerHotspotId === null ? {} : { triggerHotspotId: connection.triggerHotspotId }),
    ...(connection.label === null ? {} : { label: connection.label }),
    content: connection.content,
    ...(connection.importance === null ? {} : { importance: connection.importance }),
    ...(connection.preloadHint === null ? {} : { preloadHint: connection.preloadHint }),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt
  };
}

function scenePayload(scene: Scene): Record<string, unknown> {
  return {
    id: scene.id,
    projectId: scene.projectId,
    name: scene.name,
    panoramaAssetId: scene.panoramaAssetId,
    sortOrder: scene.sortOrder,
    isPrimary: scene.isPrimary,
    initialView: scene.initialView,
    viewLimits: scene.viewLimits,
    connections: scene.connections?.map(connectionPayload) ?? [],
    spatialData: scene.spatialData,
    runtimeHints: scene.runtimeHints,
    hotspots: scene.hotspots?.map(hotspotPayload) ?? [],
    overlays: scene.overlays?.map(overlayPayload) ?? [],
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt
  };
}

export async function listProjects(userId: string): Promise<Record<string, unknown>[]> {
  const projects = await Project.findAll({
    where: await accessibleProjectFilter(userId),
    order: [['updatedAt', 'DESC']],
    attributes: [
      'id',
      'type',
      'name',
      'schemaVersion',
      'revision',
      'publicationMetadata',
      'createdAt',
      'updatedAt'
    ]
  });
  return projects.map(projectSummary);
}

export async function createProject(ownerId: string, input: ProjectCreateInput): Promise<Record<string, unknown>> {
  if (input.type !== 'image360' && input.type !== 'video360') {
    throw new AppError('PROJECT_TYPE_NOT_AVAILABLE', 'That experience type is not available in this release.', {
      status: 422,
      path: 'type'
    });
  }
  const project = await sequelize.transaction(async (transaction) => {
    await User.findByPk(ownerId, { transaction, lock: transaction.LOCK.UPDATE });
    const branding = sanitizeBranding(input.branding ?? {});
    await assertBrandingAssets(branding, undefined, ownerId, transaction);
    return Project.create({
      ownerId,
      type: input.type,
      name: sanitizeRequiredPlainText(input.name, 'name'),
      schemaVersion: 1,
      revision: 1,
      settings: sanitizeProjectSettings(input.settings ?? {}),
      branding,
      videoAssetId: null,
      videoSettings: input.type === 'video360'
        ? ((input.videoSettings ?? {}) as JsonObject)
        : {},
      publicationMetadata: {}
    }, { transaction });
  });
  return {
    ...projectSummary(project),
    settings: project.settings,
    branding: project.branding,
    scenes: [],
    ...(project.type === 'video360' ? { timeline: [] } : {}),
    assets: []
  };
}

export async function readProject(projectId: string, userId: string): Promise<Record<string, unknown>> {
  await requireProjectRole(projectId, userId, 'viewer');
  const project = await Project.findOne({
    where: { id: projectId },
    include: [
      {
        model: Scene,
        as: 'scenes',
        include: [
          { model: Hotspot, as: 'hotspots' },
          { model: Overlay, as: 'overlays' },
          { model: SceneConnection, as: 'connections' }
        ]
      },
      { model: Asset, as: 'assets' }
    ],
    order: [
      [{ model: Scene, as: 'scenes' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, 'id', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: Overlay, as: 'overlays' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: SceneConnection, as: 'connections' }, 'id', 'ASC']
    ]
  });
  if (!project) throw notFound('project', projectId);
  const timeline = project.type === 'video360'
    ? await TimelineInteraction.findAll({
      where: { projectId },
      order: [['timeMs', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']]
    })
    : [];
  const plans = await Plan.findAll({
    where: { projectId },
    order: [['sortOrder', 'ASC'], ['id', 'ASC']]
  });
  return {
    ...projectSummary(project),
    settings: project.settings,
    branding: project.branding,
    scenes: project.scenes?.map(scenePayload) ?? [],
    plans: plans.map(planPayload),
    ...(project.type === 'video360'
      ? { timeline: timeline.map(timelineInteractionPayload) }
      : {}),
    assets: project.assets?.map(assetSummary) ?? []
  };
}

export async function updateProject(
  projectId: string,
  ownerId: string,
  input: ProjectUpdateInput
): Promise<Record<string, unknown>> {
  await sequelize.transaction(async (transaction) => {
    const project = await getAccessibleProject(projectId, ownerId, 'editor', transaction);
    const values: Partial<{
      name: string;
      settings: JsonObject;
      branding: JsonObject;
      videoAssetId: string | null;
      videoSettings: JsonObject;
      revision: number;
    }> = {
      revision: input.revision + 1
    };
    if (input.name !== undefined) values.name = sanitizeRequiredPlainText(input.name, 'name');
    if (input.settings !== undefined) values.settings = sanitizeProjectSettings(input.settings);
    if (input.branding !== undefined) {
      values.branding = sanitizeBranding(input.branding);
      await assertBrandingAssets(values.branding, projectId, project.ownerId, transaction);
    }
    if (input.videoSettings !== undefined || input.videoAssetId !== undefined) {
      if (project.type !== 'video360') {
        throw new AppError('PROJECT_TYPE_MISMATCH', 'Video settings are only available on 360 video experiences.', {
          status: 422,
          entityId: projectId,
          path: input.videoAssetId === undefined ? 'videoSettings' : 'videoAssetId'
        });
      }
      if (input.videoSettings !== undefined) {
        values.videoSettings = input.videoSettings as JsonObject;
      }
      if (input.videoAssetId !== undefined) {
        await assertPrimaryVideoAsset(input.videoAssetId, projectId, project.ownerId, transaction);
        values.videoAssetId = input.videoAssetId;
      }
    }
    const [affected] = await Project.update(values, {
      where: { id: projectId, revision: input.revision },
      transaction
    });
    if (affected !== 1) await revisionFailure(projectId, input.revision);
  });
  return readProject(projectId, ownerId);
}

async function assertBrandingAssets(
  branding: JsonObject,
  projectId: string | undefined,
  ownerId: string,
  transaction: Transaction
): Promise<void> {
  for (const field of ['logoAssetId', 'faviconAssetId', 'watermarkAssetId'] as const) {
    const assetId = branding[field];
    if (typeof assetId === 'string') {
      await assertDisplayAsset(assetId, projectId, ownerId, transaction, `branding.${field}`);
    }
  }
}

async function assertPanoramaAsset(
  assetId: string | null | undefined,
  projectId: string,
  ownerId: string,
  transaction: Transaction
): Promise<void> {
  if (!assetId) return;
  const asset = await Asset.findOne({
    where: {
      id: assetId,
      ownerId,
      mediaType: 'panorama_image',
      [Op.or]: [{ projectId }, { projectId: null }]
    },
    transaction,
    lock: transaction.LOCK.KEY_SHARE
  });
  if (!asset) {
    throw new AppError('INVALID_ASSET_REFERENCE', 'The panorama asset is not available to this project.', {
      status: 422,
      entityId: assetId,
      path: 'panoramaAssetId'
    });
  }
}

async function assertDisplayAsset(
  assetId: string,
  projectId: string | undefined,
  ownerId: string,
  transaction: Transaction,
  path = 'action.assetId'
): Promise<void> {
  const asset = await Asset.findOne({
    where: {
      id: assetId,
      ownerId,
      mediaType: { [Op.in]: ['panorama_image', 'image', 'logo'] },
      ...(projectId === undefined
        ? { projectId: null }
        : { [Op.or]: [{ projectId }, { projectId: null }] })
    },
    transaction,
    lock: transaction.LOCK.KEY_SHARE
  });
  if (!asset) {
    throw new AppError('INVALID_ASSET_REFERENCE', 'The display asset is not available to this project.', {
      status: 422,
      entityId: assetId,
      path
    });
  }
}

/** The primary 360 video of a video360 project. */
async function assertPrimaryVideoAsset(
  assetId: string | null,
  projectId: string,
  ownerId: string,
  transaction: Transaction
): Promise<void> {
  if (assetId === null) return;
  const asset = await Asset.findOne({
    where: {
      id: assetId,
      ownerId,
      mediaType: 'video360',
      [Op.or]: [{ projectId }, { projectId: null }]
    },
    transaction,
    lock: transaction.LOCK.KEY_SHARE
  });
  if (!asset) {
    throw new AppError('INVALID_ASSET_REFERENCE', 'The 360 video is not available to this project.', {
      status: 422,
      entityId: assetId,
      path: 'videoAssetId'
    });
  }
}

function assertSceneCapableProject(project: Project): void {
  if (project.type !== 'image360') {
    throw new AppError('PROJECT_TYPE_MISMATCH', 'Scenes are only available on 360 image experiences.', {
      status: 422,
      entityId: project.id,
      path: 'type'
    });
  }
}

async function assertVideoAsset(
  assetId: string,
  projectId: string,
  ownerId: string,
  transaction: Transaction,
  path: string
): Promise<void> {
  const asset = await Asset.findOne({
    where: {
      id: assetId,
      ownerId,
      mediaType: 'video',
      [Op.or]: [{ projectId }, { projectId: null }]
    },
    transaction,
    lock: transaction.LOCK.KEY_SHARE
  });
  if (!asset) {
    throw new AppError('INVALID_ASSET_REFERENCE', 'The video asset is not available to this project.', {
      status: 422,
      entityId: assetId,
      path
    });
  }
}

async function validateHotspotAssetReferences(
  input: HotspotInput,
  projectId: string,
  ownerId: string,
  transaction: Transaction
): Promise<void> {
  const iconAssetId = input.appearance?.iconAssetId;
  if (typeof iconAssetId === 'string') {
    await assertDisplayAsset(iconAssetId, projectId, ownerId, transaction, 'appearance.iconAssetId');
  }
  const imageAssetId = input.content?.imageAssetId;
  if (typeof imageAssetId === 'string') {
    await assertDisplayAsset(imageAssetId, projectId, ownerId, transaction, 'content.imageAssetId');
  }
  const videoAssetId = input.content?.videoAssetId;
  if (typeof videoAssetId === 'string') {
    await assertVideoAsset(videoAssetId, projectId, ownerId, transaction, 'content.videoAssetId');
  }
}

export async function listScenes(projectId: string, userId: string): Promise<Record<string, unknown>[]> {
  await requireProjectRole(projectId, userId, 'viewer');
  const scenes = await Scene.findAll({
    where: { projectId },
    include: [
      { model: Hotspot, as: 'hotspots' },
      { model: Overlay, as: 'overlays' },
      { model: SceneConnection, as: 'connections' }
    ],
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
      [{ model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC'],
      [{ model: Overlay, as: 'overlays' }, 'sortOrder', 'ASC'],
      [{ model: SceneConnection, as: 'connections' }, 'id', 'ASC']
    ]
  });
  return scenes.map(scenePayload);
}

export async function getScene(projectId: string, sceneId: string, userId: string): Promise<Record<string, unknown>> {
  await requireProjectRole(projectId, userId, 'viewer');
  const scene = await Scene.findOne({
    where: { id: sceneId, projectId },
    include: [
      { model: Hotspot, as: 'hotspots' },
      { model: Overlay, as: 'overlays' },
      { model: SceneConnection, as: 'connections' }
    ],
    order: [
      [{ model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC'],
      [{ model: Overlay, as: 'overlays' }, 'sortOrder', 'ASC'],
      [{ model: SceneConnection, as: 'connections' }, 'id', 'ASC']
    ]
  });
  if (!scene) throw notFound('scene', sceneId);
  return scenePayload(scene);
}

type SceneConnectionInput = {
  id?: string;
  sourceSceneId?: string;
  targetSceneId: string;
  triggerHotspotId?: string | null;
  label?: string | null;
  content?: Record<string, unknown>;
  importance?: number | null;
  preloadHint?: 'none' | 'normal' | 'high' | null;
};

type SceneInput = {
  projectRevision: number;
  name?: string;
  panoramaAssetId?: string | null;
  initialView?: Record<string, unknown>;
  viewLimits?: Record<string, unknown>;
  connections?: SceneConnectionInput[];
  spatialData?: Record<string, unknown>;
  runtimeHints?: Record<string, unknown>;
};

function sanitizeSceneConnection(input: SceneConnectionInput): {
  targetSceneId: string;
  triggerHotspotId: string | null;
  label: string | null;
  content: JsonObject;
  importance: number | null;
  preloadHint: 'none' | 'normal' | 'high' | null;
} {
  const label = input.label === undefined || input.label === null
    ? null
    : sanitizePlainText(input.label).trim() || null;
  const content: JsonObject = {};
  if (input.content?.title !== undefined) {
    content.title = sanitizePlainText(input.content.title).trim();
  }
  if (input.content?.description !== undefined) {
    content.description = sanitizePlainText(input.content.description).trim();
  }
  return {
    targetSceneId: input.targetSceneId,
    triggerHotspotId: input.triggerHotspotId ?? null,
    label,
    content,
    importance: input.importance ?? null,
    preloadHint: input.preloadHint ?? null
  };
}

async function validateSceneConnections(
  projectId: string,
  sourceSceneId: string,
  connections: readonly SceneConnectionInput[],
  transaction: Transaction
): Promise<void> {
  const inputIds = new Set<string>();
  for (const [index, connection] of connections.entries()) {
    if (connection.sourceSceneId !== undefined && connection.sourceSceneId !== sourceSceneId) {
      throw new AppError('INVALID_CONNECTION_SOURCE', 'The connection source must match the scene being saved.', {
        status: 422,
        entityId: connection.sourceSceneId,
        path: `connections[${index}].sourceSceneId`
      });
    }
    if (connection.targetSceneId === sourceSceneId) {
      throw new AppError('INVALID_SCENE_REFERENCE', 'A scene cannot connect to itself.', {
        status: 422,
        entityId: sourceSceneId,
        path: `connections[${index}].targetSceneId`
      });
    }
    if (connection.id !== undefined) {
      if (inputIds.has(connection.id)) {
        throw new AppError('DUPLICATE_CONNECTION_ID', 'Connection IDs must be unique within a scene.', {
          status: 422,
          entityId: connection.id,
          path: `connections[${index}].id`
        });
      }
      inputIds.add(connection.id);
    }
  }

  const targetIds = [...new Set(connections.map((connection) => connection.targetSceneId))];
  const targets = targetIds.length === 0
    ? []
    : await Scene.findAll({
      where: { id: { [Op.in]: targetIds }, projectId },
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.KEY_SHARE
    });
  const availableTargetIds = new Set(targets.map((target) => target.id));
  for (const [index, connection] of connections.entries()) {
    if (!availableTargetIds.has(connection.targetSceneId)) {
      throw new AppError('INVALID_SCENE_REFERENCE', 'The connection target scene does not exist in this project.', {
        status: 422,
        entityId: connection.targetSceneId,
        path: `connections[${index}].targetSceneId`
      });
    }
  }

  const triggerIds = [...new Set(connections.flatMap((connection) => (
    connection.triggerHotspotId ? [connection.triggerHotspotId] : []
  )))];
  const triggers = triggerIds.length === 0
    ? []
    : await Hotspot.findAll({
      where: { id: { [Op.in]: triggerIds }, sceneId: sourceSceneId },
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.KEY_SHARE
    });
  const availableTriggerIds = new Set(triggers.map((hotspot) => hotspot.id));
  for (const [index, connection] of connections.entries()) {
    if (connection.triggerHotspotId && !availableTriggerIds.has(connection.triggerHotspotId)) {
      throw new AppError(
        'INVALID_HOTSPOT_REFERENCE',
        'The connection trigger hotspot must belong to the source scene.',
        {
          status: 422,
          entityId: connection.triggerHotspotId,
          path: `connections[${index}].triggerHotspotId`
        }
      );
    }
  }

  if (inputIds.size > 0) {
    const ownedConnections = await SceneConnection.findAll({
      where: { id: { [Op.in]: [...inputIds] } },
      attributes: ['id', 'sourceSceneId'],
      transaction,
      lock: transaction.LOCK.KEY_SHARE
    });
    const conflicting = ownedConnections.find((connection) => connection.sourceSceneId !== sourceSceneId);
    if (conflicting) {
      const index = connections.findIndex((connection) => connection.id === conflicting.id);
      throw new AppError('CONNECTION_ID_CONFLICT', 'That connection ID belongs to a different scene.', {
        status: 409,
        entityId: conflicting.id,
        path: `connections[${index}].id`
      });
    }
  }
}

async function replaceSceneConnections(
  projectId: string,
  sourceSceneId: string,
  inputs: readonly SceneConnectionInput[],
  transaction: Transaction
): Promise<void> {
  await validateSceneConnections(projectId, sourceSceneId, inputs, transaction);
  const existing = await SceneConnection.findAll({
    where: { sourceSceneId },
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  const existingById = new Map(existing.map((connection) => [connection.id, connection]));
  const retainedIds = new Set<string>();

  for (const input of inputs) {
    const values = sanitizeSceneConnection(input);
    const current = input.id === undefined ? undefined : existingById.get(input.id);
    if (current) {
      retainedIds.add(current.id);
      await current.update(values, { transaction });
      continue;
    }
    const created = await SceneConnection.create(
      {
        ...(input.id === undefined ? {} : { id: input.id }),
        sourceSceneId,
        ...values
      },
      { transaction }
    );
    retainedIds.add(created.id);
  }

  const removedIds = existing
    .filter((connection) => !retainedIds.has(connection.id))
    .map((connection) => connection.id);
  if (removedIds.length > 0) {
    await SceneConnection.destroy({ where: { id: { [Op.in]: removedIds } }, transaction });
  }
}

async function loadSceneGraph(
  projectId: string,
  sceneId: string,
  transaction: Transaction
): Promise<Scene> {
  const scene = await Scene.findOne({
    where: { id: sceneId, projectId },
    include: [
      { model: Hotspot, as: 'hotspots' },
      { model: Overlay, as: 'overlays' },
      { model: SceneConnection, as: 'connections' }
    ],
    order: [
      [{ model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC'],
      [{ model: Overlay, as: 'overlays' }, 'sortOrder', 'ASC'],
      [{ model: SceneConnection, as: 'connections' }, 'id', 'ASC']
    ],
    transaction
  });
  if (!scene) throw notFound('scene', sceneId);
  return scene;
}

async function normalizeSceneRows(scenes: readonly Scene[], transaction: Transaction): Promise<void> {
  const primary = scenes.find((scene) => scene.isPrimary) ?? scenes[0];
  for (const [sortOrder, scene] of scenes.entries()) {
    const isPrimary = scene.id === primary?.id;
    if (scene.sortOrder !== sortOrder || scene.isPrimary !== isPrimary) {
      await scene.update({ sortOrder, isPrimary }, { transaction });
    }
  }
}

export async function createScene(
  projectId: string,
  ownerId: string,
  input: SceneInput & { name: string }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getAccessibleProject(projectId, ownerId, 'editor', transaction);
    assertSceneCapableProject(project);
    await assertPanoramaAsset(input.panoramaAssetId, projectId, project.ownerId, transaction);
    const existingScenes = await Scene.findAll({
      where: { projectId },
      order: [['sortOrder', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']],
      transaction
    });
    await normalizeSceneRows(existingScenes, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    const scene = await Scene.create(
      {
        projectId,
        name: sanitizeRequiredPlainText(input.name, 'name'),
        panoramaAssetId: input.panoramaAssetId ?? null,
        sortOrder: existingScenes.length,
        isPrimary: existingScenes.length === 0,
        initialView: (input.initialView ?? {}) as JsonObject,
        viewLimits: (input.viewLimits ?? {}) as JsonObject,
        spatialData: (input.spatialData ?? {}) as JsonObject,
        runtimeHints: (input.runtimeHints ?? {}) as JsonObject
      },
      { transaction }
    );
    await replaceSceneConnections(projectId, scene.id, input.connections ?? [], transaction);
    const hydrated = await loadSceneGraph(projectId, scene.id, transaction);
    return { scene: scenePayload(hydrated), projectRevision: revision };
  });
}

export async function updateScene(
  projectId: string,
  sceneId: string,
  ownerId: string,
  input: SceneInput
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getAccessibleProject(projectId, ownerId, 'editor', transaction);
    const scene = await Scene.findOne({ where: { id: sceneId, projectId }, transaction });
    if (!scene) {
      throw notFound('scene', sceneId);
    }
    await assertPanoramaAsset(input.panoramaAssetId, projectId, project.ownerId, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    await scene.update(
      {
        ...(input.name === undefined
          ? {}
          : { name: sanitizeRequiredPlainText(input.name, 'name') }),
        ...(input.panoramaAssetId === undefined ? {} : { panoramaAssetId: input.panoramaAssetId }),
        ...(input.initialView === undefined ? {} : { initialView: input.initialView as JsonObject }),
        ...(input.viewLimits === undefined ? {} : { viewLimits: input.viewLimits as JsonObject }),
        ...(input.spatialData === undefined ? {} : { spatialData: input.spatialData as JsonObject }),
        ...(input.runtimeHints === undefined ? {} : { runtimeHints: input.runtimeHints as JsonObject })
      },
      { transaction }
    );
    if (input.connections !== undefined) {
      await replaceSceneConnections(projectId, scene.id, input.connections, transaction);
    }
    const hydrated = await loadSceneGraph(projectId, scene.id, transaction);
    return { scene: scenePayload(hydrated), projectRevision: revision };
  });
}

export async function reorderScenes(
  projectId: string,
  ownerId: string,
  input: { projectRevision: number; sceneIds: string[] }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getAccessibleProject(projectId, ownerId, 'editor', transaction);
    const scenes = await Scene.findAll({
      where: { projectId },
      order: [['sortOrder', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']],
      transaction
    });
    const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
    const requestedIds = new Set(input.sceneIds);
    const missingSceneIds = scenes
      .filter((scene) => !requestedIds.has(scene.id))
      .map((scene) => scene.id);
    const unknownSceneIds = input.sceneIds.filter((sceneId) => !sceneById.has(sceneId));
    if (
      input.sceneIds.length !== scenes.length
      || requestedIds.size !== input.sceneIds.length
      || missingSceneIds.length > 0
      || unknownSceneIds.length > 0
    ) {
      throw new AppError('INVALID_SCENE_ORDER', 'The scene order must include every project scene exactly once.', {
        status: 422,
        path: 'sceneIds',
        details: { missingSceneIds, unknownSceneIds }
      });
    }
    const orderedScenes = input.sceneIds.map((sceneId) => sceneById.get(sceneId));
    if (orderedScenes.some((scene) => scene === undefined)) {
      throw new AppError('INVALID_SCENE_ORDER', 'The requested scene order is invalid.', {
        status: 422,
        path: 'sceneIds'
      });
    }
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    await normalizeSceneRows(orderedScenes as Scene[], transaction);
    const hydrated = await Scene.findAll({
      where: { projectId },
      include: [
        { model: Hotspot, as: 'hotspots' },
        { model: Overlay, as: 'overlays' },
        { model: SceneConnection, as: 'connections' }
      ],
      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC'],
        [{ model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC'],
        [{ model: Overlay, as: 'overlays' }, 'sortOrder', 'ASC'],
        [{ model: SceneConnection, as: 'connections' }, 'id', 'ASC']
      ],
      transaction
    });
    return { scenes: hydrated.map(scenePayload), projectRevision: revision };
  });
}

export async function deleteScene(
  projectId: string,
  sceneId: string,
  ownerId: string,
  projectRevision: number
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getAccessibleProject(projectId, ownerId, 'editor', transaction);
    const scene = await Scene.findOne({ where: { id: sceneId, projectId }, transaction });
    if (!scene) {
      throw notFound('scene', sceneId);
    }
    const scenes = await Scene.findAll({
      where: { projectId, id: { [Op.ne]: sceneId } },
      order: [['sortOrder', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']],
      transaction
    });
    const inboundConnections = await SceneConnection.findAll({
      where: { targetSceneId: sceneId },
      include: [{
        model: Scene,
        as: 'sourceScene',
        required: true,
        where: { projectId },
        attributes: ['id', 'name']
      }],
      order: [['id', 'ASC']],
      transaction
    });
    const hotspots = await Hotspot.findAll({
      include: [{
        model: Scene,
        as: 'scene',
        required: true,
        where: { projectId, id: { [Op.ne]: sceneId } }
      }],
      transaction
    });
    const referringHotspots = hotspots.filter(
      (hotspot) => hotspot.action.kind === 'goToScene' && hotspot.action.sceneId === sceneId
    );
    const runtimeHintReferences = scenes.flatMap((candidate) => {
      const likelyNextSceneIds = candidate.runtimeHints.likelyNextSceneIds;
      if (!Array.isArray(likelyNextSceneIds)) return [];
      return likelyNextSceneIds.flatMap((targetSceneId, index) => (
        targetSceneId === sceneId
          ? [{
              type: 'runtimeHint',
              sourceSceneId: candidate.id,
              path: `runtimeHints.likelyNextSceneIds[${index}]`
            }]
          : []
      ));
    });
    if (
      inboundConnections.length > 0
      || referringHotspots.length > 0
      || runtimeHintReferences.length > 0
    ) {
      throw conflict(
        'SCENE_IN_USE',
        'Remove the listed scene references before deleting this scene.',
        {
          sceneId,
          references: [
            ...inboundConnections.map((connection) => ({
              type: 'sceneConnection',
              id: connection.id,
              sourceSceneId: connection.sourceSceneId,
              ...(connection.label === null ? {} : { label: connection.label })
            })),
            ...referringHotspots.map((hotspot) => ({
              type: 'hotspotAction',
              id: hotspot.id,
              sourceSceneId: hotspot.sceneId,
              path: 'action.sceneId'
            })),
            ...runtimeHintReferences
          ]
        }
      );
    }
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: projectRevision,
      transaction
    });
    await scene.destroy({ transaction });
    await normalizeSceneRows(scenes, transaction);
    return { deleted: true, sceneId, projectRevision: revision };
  });
}

async function validateHotspotAction(
  action: Record<string, unknown> | undefined,
  projectId: string,
  ownerId: string,
  transaction: Transaction
): Promise<JsonObject | undefined> {
  if (!action) return undefined;
  const sanitized = sanitizeHotspotAction(action);
  if (sanitized.kind === 'goToScene' && typeof sanitized.sceneId === 'string') {
    const target = await Scene.findOne({ where: { id: sanitized.sceneId, projectId }, transaction });
    if (!target) {
      throw new AppError('INVALID_SCENE_REFERENCE', 'The target scene does not exist.', {
        status: 422,
        entityId: sanitized.sceneId,
        path: 'action.sceneId'
      });
    }
  }
  if (sanitized.kind === 'openAsset' && typeof sanitized.assetId === 'string') {
    await assertDisplayAsset(sanitized.assetId, projectId, ownerId, transaction);
  }
  return sanitized;
}

type HotspotInput = {
  projectRevision: number;
  geometry?: Record<string, unknown>;
  position?: Record<string, unknown>;
  appearance?: Record<string, unknown>;
  content?: Record<string, unknown>;
  action?: Record<string, unknown>;
  visibilityRules?: Record<string, unknown>;
};

export async function createHotspot(
  projectId: string,
  sceneId: string,
  ownerId: string,
  input: HotspotInput & { geometry: Record<string, unknown>; position: Record<string, unknown> }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getAccessibleProject(projectId, ownerId, 'editor', transaction);
    const scene = await Scene.findOne({ where: { id: sceneId, projectId }, transaction });
    if (!scene) {
      throw notFound('scene', sceneId);
    }
    const action = await validateHotspotAction(input.action, projectId, project.ownerId, transaction);
    await validateHotspotAssetReferences(input, projectId, project.ownerId, transaction);
    // Hotspots share the interaction geometry union with overlays, so a layer
    // or custom hotspot is validated by exactly the same rules.
    const geometry = await sanitizeInteractionGeometry(input.geometry as GeometryInput, {
      projectId,
      ownerId: project.ownerId,
      experienceType: project.type,
      transaction,
      allowPoint: true
    });
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    const maxSort = Number((await Hotspot.max('sortOrder', { where: { sceneId }, transaction })) ?? -1);
    const hotspot = await Hotspot.create(
      {
        sceneId,
        geometryKind: geometry.kind,
        geometry: geometry.geometry,
        extensionId: geometry.extensionId,
        extensionVersion: geometry.extensionVersion,
        position: input.position as JsonObject,
        appearance: sanitizeHotspotAppearance(input.appearance ?? {}),
        content: sanitizeHotspotContent(input.content ?? {}),
        action: action ?? {},
        visibilityRules: (input.visibilityRules ?? {}) as JsonObject,
        sortOrder: maxSort + 1
      },
      { transaction }
    );
    return { hotspot: hotspotPayload(hotspot), projectRevision: revision };
  });
}

export async function updateHotspot(
  projectId: string,
  sceneId: string,
  hotspotId: string,
  ownerId: string,
  input: HotspotInput
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getAccessibleProject(projectId, ownerId, 'editor', transaction);
    const hotspot = await Hotspot.findOne({
      where: { id: hotspotId, sceneId },
      include: [{ model: Scene, as: 'scene', required: true, where: { projectId } }],
      transaction
    });
    if (!hotspot) {
      throw notFound('hotspot', hotspotId);
    }
    const action = await validateHotspotAction(input.action, projectId, project.ownerId, transaction);
    await validateHotspotAssetReferences(input, projectId, project.ownerId, transaction);
    const geometry = input.geometry === undefined
      ? undefined
      : await sanitizeInteractionGeometry(input.geometry as GeometryInput, {
        projectId,
        ownerId: project.ownerId,
        experienceType: project.type,
        transaction,
        allowPoint: true
      });
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    await hotspot.update(
      {
        ...(geometry === undefined
          ? {}
          : {
            geometryKind: geometry.kind,
            geometry: geometry.geometry,
            extensionId: geometry.extensionId,
            extensionVersion: geometry.extensionVersion
          }),
        ...(input.position === undefined ? {} : { position: input.position as JsonObject }),
        ...(input.appearance === undefined
          ? {}
          : { appearance: sanitizeHotspotAppearance(input.appearance) }),
        ...(input.content === undefined ? {} : { content: sanitizeHotspotContent(input.content) }),
        ...(action === undefined ? {} : { action }),
        ...(input.visibilityRules === undefined
          ? {}
          : { visibilityRules: input.visibilityRules as JsonObject })
      },
      { transaction }
    );
    return { hotspot: hotspotPayload(hotspot), projectRevision: revision };
  });
}

export async function deleteHotspot(
  projectId: string,
  sceneId: string,
  hotspotId: string,
  ownerId: string,
  projectRevision: number
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getAccessibleProject(projectId, ownerId, 'editor', transaction);
    const hotspot = await Hotspot.findOne({
      where: { id: hotspotId, sceneId },
      include: [{ model: Scene, as: 'scene', required: true, where: { projectId } }],
      transaction
    });
    if (!hotspot) {
      throw notFound('hotspot', hotspotId);
    }
    const triggeredConnections = await SceneConnection.findAll({
      where: { sourceSceneId: sceneId, triggerHotspotId: hotspotId },
      attributes: ['id', 'targetSceneId', 'label'],
      order: [['id', 'ASC']],
      transaction
    });
    if (triggeredConnections.length > 0) {
      throw conflict(
        'HOTSPOT_IN_USE',
        'Remove this hotspot from the listed scene connections before deleting it.',
        {
          hotspotId,
          references: triggeredConnections.map((connection) => ({
            type: 'sceneConnectionTrigger',
            id: connection.id,
            targetSceneId: connection.targetSceneId,
            ...(connection.label === null ? {} : { label: connection.label })
          }))
        }
      );
    }
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: projectRevision,
      transaction
    });
    await hotspot.destroy({ transaction });
    return { deleted: true, hotspotId, projectRevision: revision };
  });
}
