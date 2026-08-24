import { Op, type Transaction } from 'sequelize';

import { sequelize } from '../database';
import { AppError, conflict, notFound } from '../errors/app-error';
import { Asset, Project, TimelineInteraction, User } from '../models';
import type { JsonObject, TimelineInteractionKind } from '../models/model.types';
import {
  sanitizeHotspotAppearance,
  sanitizeTimelineAction,
  sanitizeTimelineContent
} from './content-service';

export type TimelineInteractionInput = {
  kind: TimelineInteractionKind;
  timeMs: number;
  endTimeMs?: number | null;
  geometry?: Record<string, unknown>;
  position?: Record<string, unknown>;
  viewpoint?: Record<string, unknown>;
  appearance?: Record<string, unknown>;
  content?: Record<string, unknown>;
  action?: Record<string, unknown>;
  visibilityRules?: Record<string, unknown>;
};

export type TimelineInteractionPatch = Partial<TimelineInteractionInput>;

/** Kinds that are meaningless without a placement on the sphere. */
const POSITIONED_KINDS = new Set<TimelineInteractionKind>(['hotspot']);

export function timelineInteractionPayload(
  interaction: TimelineInteraction
): Record<string, unknown> {
  return {
    id: interaction.id,
    projectId: interaction.projectId,
    kind: interaction.kind,
    timeMs: interaction.timeMs,
    endTimeMs: interaction.endTimeMs,
    geometry: interaction.geometry,
    position: interaction.position,
    viewpoint: interaction.viewpoint,
    appearance: interaction.appearance,
    content: interaction.content,
    action: interaction.action,
    visibilityRules: interaction.visibilityRules,
    sortOrder: interaction.sortOrder,
    createdAt: interaction.createdAt,
    updatedAt: interaction.updatedAt
  };
}

async function getOwnedVideoProject(
  projectId: string,
  ownerId: string,
  transaction?: Transaction
): Promise<Project> {
  if (transaction) {
    await User.findByPk(ownerId, { transaction, lock: transaction.LOCK.UPDATE });
  }
  const project = await Project.findOne({
    where: { id: projectId, ownerId },
    ...(transaction === undefined ? {} : { transaction, lock: transaction.LOCK.UPDATE })
  });
  if (!project) throw notFound('project', projectId);
  if (project.type !== 'video360') {
    throw new AppError('TIMELINE_NOT_AVAILABLE', 'Timelines are only available on 360 video experiences.', {
      status: 422,
      entityId: projectId,
      path: 'type'
    });
  }
  return project;
}

export interface VideoTimelineBounds {
  readonly videoAssetId: string;
  readonly durationMs: number;
}

/**
 * Timeline times are validated against the inspected media duration, so a
 * project must reference a video asset whose duration is already known.
 */
export async function resolveTimelineBounds(
  project: Project,
  transaction?: Transaction
): Promise<VideoTimelineBounds> {
  if (!project.videoAssetId) {
    throw new AppError('VIDEO_ASSET_NOT_ASSIGNED', 'Add a 360 video to this experience first.', {
      status: 422,
      entityId: project.id,
      path: 'videoAssetId'
    });
  }
  const asset = await Asset.findOne({
    where: { id: project.videoAssetId },
    ...(transaction === undefined ? {} : { transaction })
  });
  if (!asset) throw notFound('asset', project.videoAssetId);
  if (asset.processingStatus !== 'ready') {
    throw new AppError('VIDEO_ASSET_NOT_READY', 'The 360 video is still being prepared.', {
      status: 409,
      entityId: asset.id,
      retryable: asset.processingStatus !== 'failed',
      details: { processingStatus: asset.processingStatus }
    });
  }
  const durationMs = asset.metadata.durationMs;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    throw new AppError('VIDEO_DURATION_UNKNOWN', 'The 360 video duration is not available yet.', {
      status: 409,
      entityId: asset.id,
      retryable: true
    });
  }
  return { videoAssetId: asset.id, durationMs: Math.round(durationMs) };
}

function assertTimeWithinDuration(
  timeMs: number,
  endTimeMs: number | null,
  bounds: VideoTimelineBounds,
  path: string
): void {
  if (timeMs < 0 || timeMs > bounds.durationMs) {
    throw new AppError('TIMELINE_TIME_OUT_OF_RANGE', 'The interaction time is outside the video.', {
      status: 422,
      path,
      details: { timeMs, durationMs: bounds.durationMs }
    });
  }
  if (endTimeMs !== null) {
    if (endTimeMs < timeMs || endTimeMs > bounds.durationMs) {
      throw new AppError('TIMELINE_TIME_OUT_OF_RANGE', 'The interaction end time is outside the video.', {
        status: 422,
        path: path.replace(/timeMs$/u, 'endTimeMs'),
        details: { timeMs, endTimeMs, durationMs: bounds.durationMs }
      });
    }
  }
}

async function assertReferencedAsset(
  assetId: string,
  mediaTypes: readonly string[],
  projectId: string,
  ownerId: string,
  path: string,
  transaction: Transaction
): Promise<void> {
  const asset = await Asset.findOne({
    where: {
      id: assetId,
      ownerId,
      mediaType: { [Op.in]: [...mediaTypes] },
      [Op.or]: [{ projectId }, { projectId: null }]
    },
    transaction,
    lock: transaction.LOCK.KEY_SHARE
  });
  if (!asset) {
    throw new AppError('TIMELINE_REFERENCE_INVALID', 'The referenced media is not available to this experience.', {
      status: 422,
      entityId: assetId,
      path
    });
  }
  if (asset.processingStatus !== 'ready') {
    throw new AppError('TIMELINE_REFERENCE_INVALID', 'The referenced media is not ready yet.', {
      status: 422,
      entityId: assetId,
      path,
      retryable: asset.processingStatus !== 'failed',
      details: { processingStatus: asset.processingStatus }
    });
  }
}

interface NormalizedInteraction {
  kind: TimelineInteractionKind;
  timeMs: number;
  endTimeMs: number | null;
  geometry: JsonObject;
  position: JsonObject;
  viewpoint: JsonObject;
  appearance: JsonObject;
  content: JsonObject;
  action: JsonObject;
  visibilityRules: JsonObject;
}

function payloadError(message: string, path: string): AppError {
  return new AppError('TIMELINE_PAYLOAD_INVALID', message, { status: 422, path });
}

/**
 * Enforces the product meaning of each interaction kind. Changing a kind must
 * never leave incompatible fields behind, so unrelated payload sections are
 * cleared rather than carried over.
 */
function normalizeInteraction(
  kind: TimelineInteractionKind,
  input: TimelineInteractionInput | (TimelineInteractionPatch & { timeMs: number }),
  current?: TimelineInteraction
): NormalizedInteraction {
  const timeMs = Math.round(input.timeMs);
  const endTimeMs = input.endTimeMs === undefined
    ? current?.endTimeMs ?? null
    : input.endTimeMs === null ? null : Math.round(input.endTimeMs);

  const content = sanitizeTimelineContent(
    input.content ?? (current === undefined ? {} : (current.content as Record<string, unknown>))
  );
  const appearance = sanitizeHotspotAppearance(
    input.appearance ?? (current === undefined ? {} : (current.appearance as Record<string, unknown>))
  );
  const rawAction = input.action
    ?? (current === undefined ? undefined : (current.action as Record<string, unknown>));
  const action = rawAction === undefined || rawAction.kind === undefined
    ? defaultActionForKind(kind)
    : sanitizeTimelineAction(rawAction);
  const visibilityRules = (input.visibilityRules
    ?? (current === undefined ? {} : current.visibilityRules)) as JsonObject;

  const position = (POSITIONED_KINDS.has(kind)
    ? input.position ?? (current === undefined ? undefined : current.position)
    : undefined) as JsonObject | undefined;
  const geometry = (POSITIONED_KINDS.has(kind)
    ? input.geometry
      ?? (current === undefined ? undefined : current.geometry)
      ?? { kind: 'point' }
    : undefined) as JsonObject | undefined;
  const viewpoint = (kind === 'viewpoint'
    ? input.viewpoint ?? (current === undefined ? undefined : current.viewpoint)
    : input.viewpoint ?? (current === undefined ? undefined : current.viewpoint)) as
      JsonObject | undefined;

  if (POSITIONED_KINDS.has(kind)) {
    if (position === undefined || position.coordinateSystem !== 'spherical_degrees') {
      throw payloadError('A hotspot interaction requires a placement on the video sphere.', 'position');
    }
    if (geometry === undefined || geometry.kind !== 'point') {
      throw payloadError('Timed hotspots support point placement only.', 'geometry.kind');
    }
  }
  if (kind === 'viewpoint') {
    if (viewpoint === undefined
      || typeof viewpoint.headingDegrees !== 'number'
      || typeof viewpoint.pitchDegrees !== 'number') {
      throw payloadError('A viewpoint interaction requires a viewing direction.', 'viewpoint');
    }
  }
  if (kind === 'image' && typeof content.imageAssetId !== 'string') {
    throw payloadError('An image interaction requires an image.', 'content.imageAssetId');
  }
  if (kind === 'video' && typeof content.videoAssetId !== 'string') {
    throw payloadError('A video interaction requires a video.', 'content.videoAssetId');
  }
  if (kind === 'link' && action.kind !== 'openUrl') {
    throw payloadError('A link interaction requires a destination link.', 'action.kind');
  }
  if (kind === 'cta'
    && typeof content.ctaLabel !== 'string'
    && action.kind !== 'openUrl') {
    throw payloadError('A call to action requires a button label or a destination link.', 'content.ctaLabel');
  }

  return {
    kind,
    timeMs,
    endTimeMs,
    geometry: geometry ?? {},
    position: position ?? {},
    viewpoint: kind === 'viewpoint' || viewpoint !== undefined ? viewpoint ?? {} : {},
    appearance,
    content,
    action,
    visibilityRules
  };
}

function defaultActionForKind(kind: TimelineInteractionKind): JsonObject {
  switch (kind) {
    case 'viewpoint':
      return { kind: 'setViewpoint' };
    case 'information':
    case 'cta':
      return { kind: 'showInformation' };
    default:
      return { kind: 'none' };
  }
}

async function assertInteractionReferences(
  normalized: NormalizedInteraction,
  projectId: string,
  ownerId: string,
  transaction: Transaction
): Promise<void> {
  const imageAssetId = normalized.content.imageAssetId;
  if (typeof imageAssetId === 'string') {
    await assertReferencedAsset(
      imageAssetId,
      ['panorama_image', 'image', 'logo'],
      projectId,
      ownerId,
      'content.imageAssetId',
      transaction
    );
  }
  const videoAssetId = normalized.content.videoAssetId;
  if (typeof videoAssetId === 'string') {
    await assertReferencedAsset(
      videoAssetId,
      ['video', 'video360'],
      projectId,
      ownerId,
      'content.videoAssetId',
      transaction
    );
  }
  const iconAssetId = normalized.appearance.iconAssetId;
  if (typeof iconAssetId === 'string') {
    await assertReferencedAsset(
      iconAssetId,
      ['image', 'logo'],
      projectId,
      ownerId,
      'appearance.iconAssetId',
      transaction
    );
  }
  if (normalized.action.kind === 'openAsset' && typeof normalized.action.assetId === 'string') {
    await assertReferencedAsset(
      normalized.action.assetId,
      ['panorama_image', 'image', 'logo', 'video', 'video360'],
      projectId,
      ownerId,
      'action.assetId',
      transaction
    );
  }
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
    const project = await Project.findOne({
      where: { id: options.projectId, ownerId: options.ownerId },
      attributes: ['id', 'revision']
    });
    if (!project) throw notFound('project', options.projectId);
    throw conflict('REVISION_CONFLICT', 'The project was changed by another editor.', {
      expectedRevision: options.expectedRevision,
      currentRevision: project.revision
    });
  }
  return nextRevision;
}

async function nextSortOrder(projectId: string, transaction: Transaction): Promise<number> {
  const maximum = await TimelineInteraction.max('sortOrder', {
    where: { projectId },
    transaction
  });
  return Number(maximum ?? -1) + 1;
}

async function loadTimeline(
  projectId: string,
  transaction?: Transaction
): Promise<TimelineInteraction[]> {
  return TimelineInteraction.findAll({
    where: { projectId },
    order: [['timeMs', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']],
    ...(transaction === undefined ? {} : { transaction })
  });
}

export async function listTimeline(
  projectId: string,
  ownerId: string
): Promise<Record<string, unknown>> {
  const project = await getOwnedVideoProject(projectId, ownerId);
  const interactions = await loadTimeline(projectId);
  let durationMs: number | null = null;
  try {
    durationMs = (await resolveTimelineBounds(project)).durationMs;
  } catch {
    // The timeline is readable while the video is still being prepared; the
    // duration simply is not known yet.
    durationMs = null;
  }
  return {
    projectId,
    projectRevision: project.revision,
    videoAssetId: project.videoAssetId,
    durationMs,
    interactions: interactions.map(timelineInteractionPayload)
  };
}

export async function createTimelineInteraction(
  projectId: string,
  ownerId: string,
  input: TimelineInteractionInput & { projectRevision: number }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getOwnedVideoProject(projectId, ownerId, transaction);
    const bounds = await resolveTimelineBounds(project, transaction);
    const normalized = normalizeInteraction(input.kind, input);
    assertTimeWithinDuration(normalized.timeMs, normalized.endTimeMs, bounds, 'timeMs');
    await assertInteractionReferences(normalized, projectId, ownerId, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: input.projectRevision,
      transaction
    });
    const interaction = await TimelineInteraction.create(
      {
        projectId,
        ...normalized,
        sortOrder: await nextSortOrder(projectId, transaction)
      },
      { transaction }
    );
    return {
      interaction: timelineInteractionPayload(interaction),
      projectRevision: revision
    };
  });
}

export async function updateTimelineInteraction(
  projectId: string,
  interactionId: string,
  ownerId: string,
  input: TimelineInteractionPatch & { projectRevision: number }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getOwnedVideoProject(projectId, ownerId, transaction);
    const bounds = await resolveTimelineBounds(project, transaction);
    const interaction = await TimelineInteraction.findOne({
      where: { id: interactionId, projectId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!interaction) throw notFound('timeline interaction', interactionId);
    const kind = input.kind ?? interaction.kind;
    const normalized = normalizeInteraction(
      kind,
      { ...input, timeMs: input.timeMs ?? interaction.timeMs },
      // Changing kind must not inherit the previous kind's payload.
      kind === interaction.kind ? interaction : undefined
    );
    assertTimeWithinDuration(normalized.timeMs, normalized.endTimeMs, bounds, 'timeMs');
    await assertInteractionReferences(normalized, projectId, ownerId, transaction);
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: input.projectRevision,
      transaction
    });
    await interaction.update(normalized, { transaction });
    return {
      interaction: timelineInteractionPayload(interaction),
      projectRevision: revision
    };
  });
}

export async function duplicateTimelineInteraction(
  projectId: string,
  interactionId: string,
  ownerId: string,
  input: { projectRevision: number; timeMs?: number }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getOwnedVideoProject(projectId, ownerId, transaction);
    const bounds = await resolveTimelineBounds(project, transaction);
    const source = await TimelineInteraction.findOne({
      where: { id: interactionId, projectId },
      transaction
    });
    if (!source) throw notFound('timeline interaction', interactionId);
    const timeMs = input.timeMs === undefined ? source.timeMs : Math.round(input.timeMs);
    const shift = timeMs - source.timeMs;
    const endTimeMs = source.endTimeMs === null
      ? null
      : Math.min(bounds.durationMs, source.endTimeMs + shift);
    assertTimeWithinDuration(timeMs, endTimeMs, bounds, 'timeMs');
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: input.projectRevision,
      transaction
    });
    // A duplicate is a new entity: it always receives a fresh stable ID.
    const duplicate = await TimelineInteraction.create(
      {
        projectId,
        kind: source.kind,
        timeMs,
        endTimeMs,
        geometry: source.geometry,
        position: source.position,
        viewpoint: source.viewpoint,
        appearance: source.appearance,
        content: source.content,
        action: source.action,
        visibilityRules: source.visibilityRules,
        sortOrder: await nextSortOrder(projectId, transaction)
      },
      { transaction }
    );
    return {
      interaction: timelineInteractionPayload(duplicate),
      sourceInteractionId: source.id,
      projectRevision: revision
    };
  });
}

export async function deleteTimelineInteraction(
  projectId: string,
  interactionId: string,
  ownerId: string,
  projectRevision: number
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    await getOwnedVideoProject(projectId, ownerId, transaction);
    const interaction = await TimelineInteraction.findOne({
      where: { id: interactionId, projectId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!interaction) throw notFound('timeline interaction', interactionId);
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: projectRevision,
      transaction
    });
    await interaction.destroy({ transaction });
    return { deleted: true, interactionId, projectRevision: revision };
  });
}

/**
 * Atomic multi-move for drag-heavy editing. Every entry is validated before
 * any row is written, so a rejected batch leaves the timeline untouched.
 */
export async function bulkUpdateTimeline(
  projectId: string,
  ownerId: string,
  input: {
    projectRevision: number;
    interactions: { id: string; timeMs: number; endTimeMs?: number | null }[];
  }
): Promise<Record<string, unknown>> {
  return sequelize.transaction(async (transaction) => {
    const project = await getOwnedVideoProject(projectId, ownerId, transaction);
    const bounds = await resolveTimelineBounds(project, transaction);
    const rows = await TimelineInteraction.findAll({
      where: { projectId, id: { [Op.in]: input.interactions.map((entry) => entry.id) } },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    for (const [index, entry] of input.interactions.entries()) {
      const row = rowsById.get(entry.id);
      if (!row) throw notFound('timeline interaction', entry.id);
      const endTimeMs = entry.endTimeMs === undefined
        ? row.endTimeMs
        : entry.endTimeMs === null ? null : Math.round(entry.endTimeMs);
      assertTimeWithinDuration(
        Math.round(entry.timeMs),
        endTimeMs,
        bounds,
        `interactions[${index}].timeMs`
      );
    }
    const revision = await bumpProjectRevision({
      projectId,
      ownerId,
      expectedRevision: input.projectRevision,
      transaction
    });
    for (const entry of input.interactions) {
      const row = rowsById.get(entry.id)!;
      await row.update(
        {
          timeMs: Math.round(entry.timeMs),
          ...(entry.endTimeMs === undefined
            ? {}
            : { endTimeMs: entry.endTimeMs === null ? null : Math.round(entry.endTimeMs) })
        },
        { transaction }
      );
    }
    const interactions = await loadTimeline(projectId, transaction);
    return {
      interactions: interactions.map(timelineInteractionPayload),
      projectRevision: revision
    };
  });
}
