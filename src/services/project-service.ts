import { Op, type Transaction } from 'sequelize';
import { sequelize } from '../database';
import { AppError, conflict, notFound } from '../errors/app-error';
import { Asset, Hotspot, Project, Scene, User } from '../models';
import type { JsonObject, JsonValue } from '../models/model.types';
import {
  sanitizeBranding,
  sanitizeHotspotAction,
  sanitizeHotspotAppearance,
  sanitizeHotspotContent,
  sanitizeProjectSettings,
  sanitizeRequiredPlainText
} from './content-service';

type ProjectCreateInput = {
  type: 'image360';
  name: string;
  settings?: Record<string, unknown>;
  branding?: Record<string, unknown>;
};

type ProjectUpdateInput = {
  revision: number;
  name?: string;
  settings?: Record<string, unknown>;
  branding?: Record<string, unknown>;
};

export async function getOwnedProject(projectId: string, ownerId: string, transaction?: Transaction): Promise<Project> {
  if (transaction) {
    await User.findByPk(ownerId, { transaction, lock: transaction.LOCK.UPDATE });
  }
  const project = await Project.findOne({
    where: { id: projectId, ownerId },
    ...(transaction === undefined ? {} : { transaction, lock: transaction.LOCK.UPDATE })
  });
  if (!project) throw notFound('project', projectId);
  return project;
}

async function revisionFailure(projectId: string, ownerId: string, expectedRevision: number): Promise<never> {
  const project = await Project.findOne({ where: { id: projectId, ownerId }, attributes: ['id', 'revision'] });
  if (!project) throw notFound('project', projectId);
  throw conflict('REVISION_CONFLICT', 'The project was changed by another editor.', {
    expectedRevision,
    currentRevision: project.revision
  });
}

async function bumpProjectRevision(options: {
  projectId: string;
  ownerId: string;
  expectedRevision: number;
  transaction: Transaction;
}): Promise<number> {
  const nextRevision = options.expectedRevision + 1;
  const [affected] = await Project.update(
    { revision: nextRevision },
    {
      where: {
        id: options.projectId,
        ownerId: options.ownerId,
        revision: options.expectedRevision
      },
      transaction: options.transaction
    }
  );
  if (affected !== 1) {
    await revisionFailure(options.projectId, options.ownerId, options.expectedRevision);
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
    overlays: scene.overlays,
    connections: scene.connections,
    spatialData: scene.spatialData,
    runtimeHints: scene.runtimeHints,
    hotspots: scene.hotspots?.map(hotspotPayload) ?? [],
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt
  };
}

export async function listProjects(ownerId: string): Promise<Record<string, unknown>[]> {
  const projects = await Project.findAll({
    where: { ownerId },
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
  if (input.type !== 'image360') {
    throw new AppError('PROJECT_TYPE_NOT_AVAILABLE', 'Only 360 image projects are available in this release.', {
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
      type: 'image360',
      name: sanitizeRequiredPlainText(input.name, 'name'),
      schemaVersion: 1,
      revision: 1,
      settings: sanitizeProjectSettings(input.settings ?? {}),
      branding,
      publicationMetadata: {}
    }, { transaction });
  });
  return { ...projectSummary(project), settings: project.settings, branding: project.branding, scenes: [], assets: [] };
}

export async function readProject(projectId: string, ownerId: string): Promise<Record<string, unknown>> {
  const project = await Project.findOne({
    where: { id: projectId, ownerId },
    include: [
      { model: Scene, as: 'scenes', include: [{ model: Hotspot, as: 'hotspots' }] },
      { model: Asset, as: 'assets' }
    ],
    order: [
      [{ model: Scene, as: 'scenes' }, 'sortOrder', 'ASC'],
      [{ model: Scene, as: 'scenes' }, { model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC']
    ]
  });
  if (!project) throw notFound('project', projectId);
  return {
    ...projectSummary(project),
    settings: project.settings,
    branding: project.branding,
    scenes: project.scenes?.map(scenePayload) ?? [],
    assets: project.assets?.map(assetSummary) ?? []
  };
}

export async function updateProject(
  projectId: string,
  ownerId: string,
  input: ProjectUpdateInput
): Promise<Record<string, unknown>> {
  await sequelize.transaction(async (transaction) => {
    await getOwnedProject(projectId, ownerId, transaction);
    const values: Partial<{ name: string; settings: JsonObject; branding: JsonObject; revision: number }> = {
      revision: input.revision + 1
    };
    if (input.name !== undefined) values.name = sanitizeRequiredPlainText(input.name, 'name');
    if (input.settings !== undefined) values.settings = sanitizeProjectSettings(input.settings);
    if (input.branding !== undefined) {
      values.branding = sanitizeBranding(input.branding);
      await assertBrandingAssets(values.branding, projectId, ownerId, transaction);
    }
    const [affected] = await Project.update(values, {
      where: { id: projectId, ownerId, revision: input.revision },
      transaction
    });
    if (affected !== 1) await revisionFailure(projectId, ownerId, input.revision);
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
}

export async function listScenes(projectId: string, ownerId: string): Promise<Record<string, unknown>[]> {
  await getOwnedProject(projectId, ownerId);
  const scenes = await Scene.findAll({
    where: { projectId },
    include: [{ model: Hotspot, as: 'hotspots' }],
    order: [['sortOrder', 'ASC'], [{ model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC']]
  });
  return scenes.map(scenePayload);
}

export async function getScene(projectId: string, sceneId: string, ownerId: string): Promise<Record<string, unknown>> {
  await getOwnedProject(projectId, ownerId);
  const scene = await Scene.findOne({
    where: { id: sceneId, projectId },
    include: [{ model: Hotspot, as: 'hotspots' }]
  });
  if (!scene) throw notFound('scene', sceneId);
  return scenePayload(scene);
}

type SceneInput = {
  projectRevision: number;
  name?: string;
  panoramaAssetId?: string | null;
  initialView?: Record<string, unknown>;
  viewLimits?: Record<string, unknown>;
  overlays?: Record<string, unknown>[];
  connections?: Record<string, unknown>[];
  spatialData?: Record<string, unknown>;
  runtimeHints?: Record<string, unknown>;
};

export async function createScene(
  projectId: string,
  ownerId: string,
  input: SceneInput & { name: string }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getOwnedProject(projectId, ownerId, transaction);
    await assertPanoramaAsset(input.panoramaAssetId, projectId, ownerId, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: input.projectRevision,
      transaction
    });
    const count = await Scene.count({ where: { projectId }, transaction });
    const maxSort = Number((await Scene.max('sortOrder', { where: { projectId }, transaction })) ?? -1);
    const scene = await Scene.create(
      {
        projectId,
        name: sanitizeRequiredPlainText(input.name, 'name'),
        panoramaAssetId: input.panoramaAssetId ?? null,
        sortOrder: maxSort + 1,
        isPrimary: count === 0,
        initialView: (input.initialView ?? {}) as JsonObject,
        viewLimits: (input.viewLimits ?? {}) as JsonObject,
        overlays: (input.overlays ?? []) as JsonValue[],
        connections: (input.connections ?? []) as JsonValue[],
        spatialData: (input.spatialData ?? {}) as JsonObject,
        runtimeHints: (input.runtimeHints ?? {}) as JsonObject
      },
      { transaction }
    );
    return { scene: scenePayload(scene), projectRevision: revision };
  });
}

export async function updateScene(
  projectId: string,
  sceneId: string,
  ownerId: string,
  input: SceneInput
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getOwnedProject(projectId, ownerId, transaction);
    const scene = await Scene.findOne({ where: { id: sceneId, projectId }, transaction });
    if (!scene) {
      throw notFound('scene', sceneId);
    }
    await assertPanoramaAsset(input.panoramaAssetId, projectId, ownerId, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
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
        ...(input.overlays === undefined ? {} : { overlays: input.overlays as JsonValue[] }),
        ...(input.connections === undefined ? {} : { connections: input.connections as JsonValue[] }),
        ...(input.spatialData === undefined ? {} : { spatialData: input.spatialData as JsonObject }),
        ...(input.runtimeHints === undefined ? {} : { runtimeHints: input.runtimeHints as JsonObject })
      },
      { transaction }
    );
    return { scene: scenePayload(scene), projectRevision: revision };
  });
}

function sceneReferencesTarget(scene: Scene, targetSceneId: string): boolean {
  return scene.connections.some((connection) => {
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)) return false;
    return (connection as JsonObject).targetSceneId === targetSceneId;
  });
}

export async function deleteScene(
  projectId: string,
  sceneId: string,
  ownerId: string,
  projectRevision: number
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getOwnedProject(projectId, ownerId, transaction);
    const scene = await Scene.findOne({ where: { id: sceneId, projectId }, transaction });
    if (!scene) {
      throw notFound('scene', sceneId);
    }
    const scenes = await Scene.findAll({ where: { projectId, id: { [Op.ne]: sceneId } }, transaction });
    const hotspots = await Hotspot.findAll({
      include: [{ model: Scene, as: 'scene', required: true, where: { projectId } }],
      transaction
    });
    const referenced = scenes.some((candidate) => sceneReferencesTarget(candidate, sceneId)) || hotspots.some(
      (hotspot) => hotspot.action.kind === 'goToScene' && hotspot.action.sceneId === sceneId
    );
    if (referenced) {
      throw conflict('SCENE_IN_USE', 'The scene is referenced by another scene or hotspot.', { sceneId });
    }
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: projectRevision,
      transaction
    });
    await scene.destroy({ transaction });
    if (scene.isPrimary && scenes[0]) await scenes[0].update({ isPrimary: true }, { transaction });
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
    await getOwnedProject(projectId, ownerId, transaction);
    const scene = await Scene.findOne({ where: { id: sceneId, projectId }, transaction });
    if (!scene) {
      throw notFound('scene', sceneId);
    }
    const action = await validateHotspotAction(input.action, projectId, ownerId, transaction);
    await validateHotspotAssetReferences(input, projectId, ownerId, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: input.projectRevision,
      transaction
    });
    const maxSort = Number((await Hotspot.max('sortOrder', { where: { sceneId }, transaction })) ?? -1);
    const hotspot = await Hotspot.create(
      {
        sceneId,
        geometry: input.geometry as JsonObject,
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
    await getOwnedProject(projectId, ownerId, transaction);
    const hotspot = await Hotspot.findOne({
      where: { id: hotspotId, sceneId },
      include: [{ model: Scene, as: 'scene', required: true, where: { projectId } }],
      transaction
    });
    if (!hotspot) {
      throw notFound('hotspot', hotspotId);
    }
    const action = await validateHotspotAction(input.action, projectId, ownerId, transaction);
    await validateHotspotAssetReferences(input, projectId, ownerId, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: input.projectRevision,
      transaction
    });
    await hotspot.update(
      {
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
    await getOwnedProject(projectId, ownerId, transaction);
    const hotspot = await Hotspot.findOne({
      where: { id: hotspotId, sceneId },
      include: [{ model: Scene, as: 'scene', required: true, where: { projectId } }],
      transaction
    });
    if (!hotspot) {
      throw notFound('hotspot', hotspotId);
    }
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: projectRevision,
      transaction
    });
    await hotspot.destroy({ transaction });
    return { deleted: true, hotspotId, projectRevision: revision };
  });
}
