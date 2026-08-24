import { Op, type Transaction } from 'sequelize';
import { sequelize } from '../database';
import { AppError, notFound } from '../errors/app-error';
import { validateExtensionPayload } from '../extensions';
import { Asset, Overlay, Scene } from '../models';
import type { InteractionGeometryKind, JsonObject } from '../models/model.types';
import {
  sanitizeHotspotAction,
  sanitizeHotspotContent
} from './content-service';
import { requireProjectRole } from './access-service';
import { loadExtensionRegistry } from './extension-service';
import { bumpProjectRevision, getAccessibleProject } from './project-service';
import { sanitizePlainText } from '../security';

export type GeometryInput = Record<string, unknown> & { kind: InteractionGeometryKind };

export type OverlayInput = {
  projectRevision: number;
  name?: string | null;
  geometry?: GeometryInput;
  position?: Record<string, unknown>;
  appearance?: Record<string, unknown>;
  content?: Record<string, unknown>;
  action?: Record<string, unknown>;
  visibilityRules?: Record<string, unknown>;
};

export function overlayPayload(overlay: Overlay): Record<string, unknown> {
  return {
    id: overlay.id,
    sceneId: overlay.sceneId,
    ...(overlay.name === null ? {} : { name: overlay.name }),
    geometry: overlay.geometry,
    position: overlay.position,
    appearance: overlay.appearance,
    content: overlay.content,
    action: overlay.action,
    visibilityRules: overlay.visibilityRules,
    sortOrder: overlay.sortOrder,
    createdAt: overlay.createdAt,
    updatedAt: overlay.updatedAt
  };
}

export interface SanitizedGeometry {
  readonly geometry: JsonObject;
  readonly kind: InteractionGeometryKind;
  readonly extensionId: string | null;
  readonly extensionVersion: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function assertLayerAsset(
  assetId: string,
  kind: 'imageLayer' | 'videoLayer',
  projectId: string,
  ownerId: string,
  transaction: Transaction
): Promise<void> {
  const mediaTypes = kind === 'imageLayer'
    ? ['panorama_image', 'image', 'logo']
    : ['video', 'video360'];
  const asset = await Asset.findOne({
    where: {
      id: assetId,
      ownerId,
      mediaType: { [Op.in]: mediaTypes },
      [Op.or]: [{ projectId }, { projectId: null }]
    },
    transaction,
    lock: transaction.LOCK.KEY_SHARE
  });
  if (!asset) {
    throw new AppError('INVALID_ASSET_REFERENCE', 'The layer media is not available to this project.', {
      status: 422,
      entityId: assetId,
      path: 'geometry.assetId'
    });
  }
}

/**
 * Normalizes an authored geometry into canonical form. Custom payloads are
 * validated and sanitized against the registered extension schema, so nothing
 * unvalidated ever reaches persistence or the compiler.
 */
export async function sanitizeInteractionGeometry(
  input: GeometryInput,
  options: {
    projectId: string;
    ownerId: string;
    experienceType: 'image360' | 'video360';
    transaction: Transaction;
    allowPoint: boolean;
  }
): Promise<SanitizedGeometry> {
  const kind = input.kind;
  if (kind === 'point') {
    if (!options.allowPoint) {
      throw new AppError('UNSUPPORTED_OVERLAY_GEOMETRY', 'An overlay needs an area, line or layer.', {
        status: 422,
        path: 'geometry.kind'
      });
    }
    return { geometry: { kind: 'point' }, kind, extensionId: null, extensionVersion: null };
  }

  if (kind === 'polygon' || kind === 'polyline') {
    const vertices = Array.isArray(input.vertices) ? input.vertices : [];
    const minimum = kind === 'polygon' ? 3 : 2;
    if (vertices.length < minimum) {
      throw new AppError(
        'INVALID_GEOMETRY',
        kind === 'polygon' ? 'An area needs at least three points.' : 'A line needs at least two points.',
        { status: 422, path: 'geometry.vertices' }
      );
    }
    return {
      geometry: { kind, vertices: vertices as JsonObject[] } as unknown as JsonObject,
      kind,
      extensionId: null,
      extensionVersion: null
    };
  }

  if (kind === 'imageLayer' || kind === 'videoLayer') {
    const assetId = input.assetId;
    const anchor = asRecord(input.anchor);
    if (typeof assetId !== 'string' || anchor === undefined) {
      throw new AppError('INVALID_GEOMETRY', 'A media layer needs media and placement.', {
        status: 422,
        path: 'geometry'
      });
    }
    await assertLayerAsset(assetId, kind, options.projectId, options.ownerId, options.transaction);
    return {
      geometry: { kind, assetId, anchor: anchor as JsonObject } as unknown as JsonObject,
      kind,
      extensionId: null,
      extensionVersion: null
    };
  }

  const extensionId = input.extensionId;
  const extensionVersion = input.extensionVersion;
  if (typeof extensionId !== 'string' || typeof extensionVersion !== 'string') {
    throw new AppError('INVALID_GEOMETRY', 'A custom interaction needs an extension and version.', {
      status: 422,
      path: 'geometry.extensionId'
    });
  }
  const registry = await loadExtensionRegistry();
  const extension = registry.get(extensionId, extensionVersion);
  if (!extension) {
    throw new AppError('EXTENSION_NOT_REGISTERED', 'That custom interaction is not registered.', {
      status: 422,
      entityId: `${extensionId}@${extensionVersion}`,
      path: 'geometry.extensionId'
    });
  }
  if (extension.status === 'disabled' || extension.status === 'draft') {
    throw new AppError('EXTENSION_NOT_AVAILABLE', 'That custom interaction is not available.', {
      status: 422,
      entityId: `${extensionId}@${extensionVersion}`,
      path: 'geometry.extensionId'
    });
  }
  if (!extension.supportedExperienceTypes.includes(options.experienceType)) {
    throw new AppError(
      'EXTENSION_NOT_AVAILABLE',
      'That custom interaction is not available for this experience type.',
      { status: 422, entityId: extensionId, path: 'geometry.extensionId' }
    );
  }
  const validation = validateExtensionPayload(extension, input.payload ?? {});
  if (!validation.valid) {
    throw new AppError('EXTENSION_PAYLOAD_INVALID', 'The custom interaction settings are invalid.', {
      status: 422,
      entityId: extensionId,
      path: 'geometry.payload',
      details: { issues: validation.issues }
    });
  }
  return {
    geometry: {
      kind: 'custom',
      extensionId: extension.extensionId,
      extensionVersion: extension.version,
      payload: validation.sanitizedPayload as unknown as JsonObject
    } as unknown as JsonObject,
    kind: 'custom',
    extensionId: extension.extensionId,
    extensionVersion: extension.version
  };
}

function sanitizeOverlayAppearance(input: Record<string, unknown>): JsonObject {
  const output = structuredClone(input) as Record<string, unknown>;
  if (output.label !== undefined) {
    const label = sanitizePlainText(output.label).trim();
    if (label) output.label = label;
    else delete output.label;
  }
  return output as JsonObject;
}

async function loadSceneForProject(
  projectId: string,
  sceneId: string,
  transaction: Transaction
): Promise<Scene> {
  const scene = await Scene.findOne({ where: { id: sceneId, projectId }, transaction });
  if (!scene) throw notFound('scene', sceneId);
  return scene;
}

export async function listOverlays(
  projectId: string,
  sceneId: string,
  userId: string
): Promise<Record<string, unknown>[]> {
  await requireProjectRole(projectId, userId, 'viewer');
  const scene = await Scene.findOne({ where: { id: sceneId, projectId }, attributes: ['id'] });
  if (!scene) throw notFound('scene', sceneId);
  const overlays = await Overlay.findAll({
    where: { sceneId },
    order: [['sortOrder', 'ASC'], ['id', 'ASC']]
  });
  return overlays.map(overlayPayload);
}

export async function createOverlay(
  projectId: string,
  sceneId: string,
  userId: string,
  input: OverlayInput & { geometry: GeometryInput }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getAccessibleProject(projectId, userId, 'editor', transaction);
    await loadSceneForProject(projectId, sceneId, transaction);
    const geometry = await sanitizeInteractionGeometry(input.geometry, {
      projectId,
      ownerId: project.ownerId,
      experienceType: project.type,
      transaction,
      allowPoint: false
    });
    const action = input.action === undefined ? {} : sanitizeHotspotAction(input.action);
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    const maxSort = Number((await Overlay.max('sortOrder', { where: { sceneId }, transaction })) ?? -1);
    const overlay = await Overlay.create(
      {
        sceneId,
        name: input.name === undefined || input.name === null
          ? null
          : sanitizePlainText(input.name).trim() || null,
        geometryKind: geometry.kind,
        geometry: geometry.geometry,
        position: (input.position ?? {}) as JsonObject,
        appearance: sanitizeOverlayAppearance(input.appearance ?? {}),
        content: sanitizeHotspotContent(input.content ?? {}),
        action,
        visibilityRules: (input.visibilityRules ?? {}) as JsonObject,
        extensionId: geometry.extensionId,
        extensionVersion: geometry.extensionVersion,
        sortOrder: maxSort + 1
      },
      { transaction }
    );
    return { overlay: overlayPayload(overlay), projectRevision: revision };
  });
}

export async function updateOverlay(
  projectId: string,
  sceneId: string,
  overlayId: string,
  userId: string,
  input: OverlayInput
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getAccessibleProject(projectId, userId, 'editor', transaction);
    await loadSceneForProject(projectId, sceneId, transaction);
    const overlay = await Overlay.findOne({ where: { id: overlayId, sceneId }, transaction });
    if (!overlay) throw notFound('overlay', overlayId);
    const geometry = input.geometry === undefined
      ? undefined
      : await sanitizeInteractionGeometry(input.geometry, {
        projectId,
        ownerId: project.ownerId,
        experienceType: project.type,
        transaction,
        allowPoint: false
      });
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: input.projectRevision,
      transaction
    });
    await overlay.update(
      {
        ...(input.name === undefined
          ? {}
          : {
            name: input.name === null
              ? null
              : sanitizePlainText(input.name).trim() || null
          }),
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
          : { appearance: sanitizeOverlayAppearance(input.appearance) }),
        ...(input.content === undefined ? {} : { content: sanitizeHotspotContent(input.content) }),
        ...(input.action === undefined ? {} : { action: sanitizeHotspotAction(input.action) }),
        ...(input.visibilityRules === undefined
          ? {}
          : { visibilityRules: input.visibilityRules as JsonObject })
      },
      { transaction }
    );
    return { overlay: overlayPayload(overlay), projectRevision: revision };
  });
}

export async function deleteOverlay(
  projectId: string,
  sceneId: string,
  overlayId: string,
  userId: string,
  projectRevision: number
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getAccessibleProject(projectId, userId, 'editor', transaction);
    await loadSceneForProject(projectId, sceneId, transaction);
    const overlay = await Overlay.findOne({ where: { id: overlayId, sceneId }, transaction });
    if (!overlay) throw notFound('overlay', overlayId);
    const revision = await bumpProjectRevision({
      projectId,
      expectedRevision: projectRevision,
      transaction
    });
    await overlay.destroy({ transaction });
    return { deleted: true, overlayId, projectRevision: revision };
  });
}
