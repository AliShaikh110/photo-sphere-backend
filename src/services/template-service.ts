import { randomUUID } from 'node:crypto';
import { Op, type Transaction } from 'sequelize';

import { CURRENT_EXPERIENCE_SCHEMA_VERSION } from '../domain';
import { sequelize } from '../database';
import { AppError, notFound } from '../errors/app-error';
import {
  Hotspot,
  Overlay,
  Plan,
  Project,
  Scene,
  SceneConnection,
  Template,
  TimelineInteraction,
  Workspace,
  WorkspaceMembership
} from '../models';
import type {
  InteractionGeometryKind,
  JsonObject,
  JsonValue,
  ProjectType,
  TemplateAssetPolicy,
  TemplateStatus,
  TemplateVisibility
} from '../models/model.types';
import { copyAssetForOwner } from './asset-service';
import { requireProjectRole, requireWorkspaceRole } from './access-service';
import { recordAudit } from './audit-service';
import {
  sanitizeBranding,
  sanitizeHotspotAction,
  sanitizeHotspotAppearance,
  sanitizeHotspotContent,
  sanitizeProjectSettings,
  sanitizeRequiredPlainText,
  sanitizeTimelineAction,
  sanitizeTimelineContent
} from './content-service';
import { sanitizePlainText } from '../security';

/* --------------------------------------------------------------------- */
/* Blueprint shape                                                        */
/* --------------------------------------------------------------------- */

/**
 * A template stores a canonical Experience blueprint: the same product data a
 * project holds, with blueprint-local identifiers. Instantiating one mints
 * fresh stable IDs, so two projects from the same template share nothing.
 */
interface BlueprintHotspot {
  readonly key: string;
  readonly geometry: JsonObject;
  readonly position: JsonObject;
  readonly appearance: JsonObject;
  readonly content: JsonObject;
  readonly action: JsonObject;
  readonly visibilityRules: JsonObject;
  readonly sortOrder: number;
}

interface BlueprintOverlay {
  readonly key: string;
  readonly name: string | null;
  readonly geometryKind: InteractionGeometryKind;
  readonly geometry: JsonObject;
  readonly position: JsonObject;
  readonly appearance: JsonObject;
  readonly content: JsonObject;
  readonly action: JsonObject;
  readonly visibilityRules: JsonObject;
  readonly extensionId: string | null;
  readonly extensionVersion: string | null;
  readonly sortOrder: number;
}

interface BlueprintConnection {
  readonly sourceSceneKey: string;
  readonly targetSceneKey: string;
  readonly triggerHotspotKey: string | null;
  readonly label: string | null;
  readonly content: JsonObject;
  readonly importance: number | null;
  readonly preloadHint: string | null;
}

interface BlueprintScene {
  readonly key: string;
  readonly name: string;
  readonly panoramaAssetKey: string | null;
  readonly sortOrder: number;
  readonly isPrimary: boolean;
  readonly initialView: JsonObject;
  readonly viewLimits: JsonObject;
  readonly spatialData: JsonObject;
  readonly runtimeHints: JsonObject;
  readonly hotspots: readonly BlueprintHotspot[];
  readonly overlays: readonly BlueprintOverlay[];
}

interface BlueprintPlan {
  readonly key: string;
  readonly name: string;
  readonly assetKey: string | null;
  readonly coordinateSystem: 'plan_normalized' | 'plan_pixels';
  readonly metadata: JsonObject;
  readonly sortOrder: number;
}

interface BlueprintTimelineInteraction {
  readonly key: string;
  readonly kind: string;
  readonly timeMs: number;
  readonly endTimeMs: number | null;
  readonly geometry: JsonObject;
  readonly position: JsonObject;
  readonly viewpoint: JsonObject;
  readonly appearance: JsonObject;
  readonly content: JsonObject;
  readonly action: JsonObject;
  readonly visibilityRules: JsonObject;
  readonly sortOrder: number;
}

interface Blueprint {
  readonly blueprintVersion: 1;
  readonly experienceType: ProjectType;
  readonly settings: JsonObject;
  readonly branding: JsonObject;
  readonly videoSettings: JsonObject;
  readonly videoAssetKey: string | null;
  readonly scenes: readonly BlueprintScene[];
  readonly plans: readonly BlueprintPlan[];
  readonly connections: readonly BlueprintConnection[];
  readonly timeline: readonly BlueprintTimelineInteraction[];
  /** Blueprint-local asset keys mapped to the source asset they came from. */
  readonly assets: Readonly<Record<string, string>>;
}

const SUPPORTED_BLUEPRINT_VERSION = 1;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/* --------------------------------------------------------------------- */
/* Capture: project -> blueprint                                          */
/* --------------------------------------------------------------------- */

class AssetKeyMap {
  private readonly keysBySourceId = new Map<string, string>();

  key(assetId: string | null | undefined): string | null {
    if (!assetId) return null;
    const existing = this.keysBySourceId.get(assetId);
    if (existing) return existing;
    const key = `asset-${this.keysBySourceId.size + 1}`;
    this.keysBySourceId.set(assetId, key);
    return key;
  }

  toBlueprint(): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const [assetId, key] of this.keysBySourceId) mapping[key] = assetId;
    return mapping;
  }
}

/**
 * Rewrites every asset id inside an authored JSON blob to a blueprint-local
 * key, so no template ever carries another account's asset identifiers into a
 * different project.
 */
function remapAssetIds(
  value: JsonValue,
  translate: (assetId: string) => string | null
): JsonValue {
  if (Array.isArray(value)) {
    return value
      .map((entry) => remapAssetIds(entry, translate))
      .filter((entry) => entry !== undefined) as JsonValue[];
  }
  if (typeof value !== 'object' || value === null) return value;
  const output: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && /assetid$/i.test(key)) {
      const translated = translate(entry);
      if (translated !== null) output[key] = translated;
      continue;
    }
    output[key] = remapAssetIds(entry, translate);
  }
  return output;
}

async function captureBlueprint(
  project: Project,
  transaction: Transaction
): Promise<Blueprint> {
  const assetKeys = new AssetKeyMap();
  const toKey = (assetId: string): string | null => assetKeys.key(assetId);

  const scenes = await Scene.findAll({
    where: { projectId: project.id },
    include: [
      { model: Hotspot, as: 'hotspots' },
      { model: Overlay, as: 'overlays' }
    ],
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
      [{ model: Hotspot, as: 'hotspots' }, 'sortOrder', 'ASC'],
      [{ model: Overlay, as: 'overlays' }, 'sortOrder', 'ASC']
    ],
    transaction
  });
  const sceneKeyById = new Map(scenes.map((scene, index) => [scene.id, `scene-${index + 1}`]));
  const hotspotKeyById = new Map<string, string>();
  for (const scene of scenes) {
    for (const [index, hotspot] of (scene.hotspots ?? []).entries()) {
      hotspotKeyById.set(hotspot.id, `${sceneKeyById.get(scene.id)}-hotspot-${index + 1}`);
    }
  }

  const blueprintScenes: BlueprintScene[] = scenes.map((scene, sceneIndex) => ({
    key: sceneKeyById.get(scene.id)!,
    name: scene.name,
    panoramaAssetKey: assetKeys.key(scene.panoramaAssetId),
    sortOrder: scene.sortOrder ?? sceneIndex,
    isPrimary: scene.isPrimary,
    initialView: scene.initialView,
    viewLimits: scene.viewLimits,
    // Plan placement is rewritten after plan keys exist.
    spatialData: scene.spatialData,
    runtimeHints: scene.runtimeHints,
    hotspots: (scene.hotspots ?? []).map((hotspot, index) => ({
      key: hotspotKeyById.get(hotspot.id)!,
      geometry: remapAssetIds(hotspot.geometry, toKey) as JsonObject,
      position: hotspot.position,
      appearance: remapAssetIds(hotspot.appearance, toKey) as JsonObject,
      content: remapAssetIds(hotspot.content, toKey) as JsonObject,
      action: remapAssetIds(hotspot.action, toKey) as JsonObject,
      visibilityRules: hotspot.visibilityRules,
      sortOrder: hotspot.sortOrder ?? index
    })),
    overlays: (scene.overlays ?? []).map((overlay, index) => ({
      key: `${sceneKeyById.get(scene.id)}-overlay-${index + 1}`,
      name: overlay.name,
      geometryKind: overlay.geometryKind,
      geometry: remapAssetIds(overlay.geometry, toKey) as JsonObject,
      position: overlay.position,
      appearance: remapAssetIds(overlay.appearance, toKey) as JsonObject,
      content: remapAssetIds(overlay.content, toKey) as JsonObject,
      action: remapAssetIds(overlay.action, toKey) as JsonObject,
      visibilityRules: overlay.visibilityRules,
      extensionId: overlay.extensionId,
      extensionVersion: overlay.extensionVersion,
      sortOrder: overlay.sortOrder ?? index
    }))
  }));

  const plans = await Plan.findAll({
    where: { projectId: project.id },
    order: [['sortOrder', 'ASC'], ['id', 'ASC']],
    transaction
  });
  const planKeyById = new Map(plans.map((plan, index) => [plan.id, `plan-${index + 1}`]));
  const blueprintPlans: BlueprintPlan[] = plans.map((plan, index) => ({
    key: planKeyById.get(plan.id)!,
    name: plan.name,
    assetKey: assetKeys.key(plan.assetId),
    coordinateSystem: plan.coordinateSystem,
    metadata: plan.metadata,
    sortOrder: plan.sortOrder ?? index
  }));

  const scenesWithPlanKeys = blueprintScenes.map((scene, index) => {
    const planId = scenes[index]?.spatialData.planId;
    if (typeof planId !== 'string') return scene;
    const planKey = planKeyById.get(planId);
    const spatialData = { ...scene.spatialData };
    if (planKey === undefined) delete spatialData.planId;
    else spatialData.planId = planKey;
    return { ...scene, spatialData };
  });

  const sceneIds = scenes.map((scene) => scene.id);
  const connections = sceneIds.length === 0
    ? []
    : await SceneConnection.findAll({
      where: { sourceSceneId: { [Op.in]: sceneIds } },
      order: [['id', 'ASC']],
      transaction
    });
  const blueprintConnections: BlueprintConnection[] = connections.flatMap((connection) => {
    const sourceSceneKey = sceneKeyById.get(connection.sourceSceneId);
    const targetSceneKey = sceneKeyById.get(connection.targetSceneId);
    if (sourceSceneKey === undefined || targetSceneKey === undefined) return [];
    return [{
      sourceSceneKey,
      targetSceneKey,
      triggerHotspotKey: connection.triggerHotspotId === null
        ? null
        : hotspotKeyById.get(connection.triggerHotspotId) ?? null,
      label: connection.label,
      content: connection.content,
      importance: connection.importance,
      preloadHint: connection.preloadHint
    }];
  });

  const timeline = project.type === 'video360'
    ? await TimelineInteraction.findAll({
      where: { projectId: project.id },
      order: [['timeMs', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']],
      transaction
    })
    : [];
  const blueprintTimeline: BlueprintTimelineInteraction[] = timeline.map((interaction, index) => ({
    key: `interaction-${index + 1}`,
    kind: interaction.kind,
    timeMs: interaction.timeMs,
    endTimeMs: interaction.endTimeMs,
    geometry: remapAssetIds(interaction.geometry, toKey) as JsonObject,
    position: interaction.position,
    viewpoint: interaction.viewpoint,
    appearance: remapAssetIds(interaction.appearance, toKey) as JsonObject,
    content: remapAssetIds(interaction.content, toKey) as JsonObject,
    action: remapAssetIds(interaction.action, toKey) as JsonObject,
    visibilityRules: interaction.visibilityRules,
    sortOrder: interaction.sortOrder ?? index
  }));

  return {
    blueprintVersion: SUPPORTED_BLUEPRINT_VERSION,
    experienceType: project.type,
    settings: remapAssetIds(project.settings, toKey) as JsonObject,
    branding: remapAssetIds(project.branding, toKey) as JsonObject,
    videoSettings: project.videoSettings,
    videoAssetKey: assetKeys.key(project.videoAssetId),
    scenes: scenesWithPlanKeys,
    plans: blueprintPlans,
    connections: blueprintConnections,
    timeline: blueprintTimeline,
    assets: assetKeys.toBlueprint()
  };
}

/* --------------------------------------------------------------------- */
/* Read the stored blueprint back                                         */
/* --------------------------------------------------------------------- */

function readBlueprint(stored: JsonObject): Blueprint {
  const record = asRecord(stored);
  if (Number(record.blueprintVersion) !== SUPPORTED_BLUEPRINT_VERSION) {
    throw new AppError('TEMPLATE_VERSION_UNSUPPORTED', 'This template cannot be used by this version.', {
      status: 422,
      details: { supportedBlueprintVersion: SUPPORTED_BLUEPRINT_VERSION }
    });
  }
  const experienceType = record.experienceType === 'video360' ? 'video360' : 'image360';
  return {
    blueprintVersion: SUPPORTED_BLUEPRINT_VERSION,
    experienceType,
    settings: asRecord(record.settings) as JsonObject,
    branding: asRecord(record.branding) as JsonObject,
    videoSettings: asRecord(record.videoSettings) as JsonObject,
    videoAssetKey: typeof record.videoAssetKey === 'string' ? record.videoAssetKey : null,
    scenes: asArray(record.scenes).map((entry) => {
      const scene = asRecord(entry);
      return {
        key: String(scene.key ?? randomUUID()),
        name: String(scene.name ?? 'Scene'),
        panoramaAssetKey: typeof scene.panoramaAssetKey === 'string' ? scene.panoramaAssetKey : null,
        sortOrder: Number(scene.sortOrder ?? 0),
        isPrimary: scene.isPrimary === true,
        initialView: asRecord(scene.initialView) as JsonObject,
        viewLimits: asRecord(scene.viewLimits) as JsonObject,
        spatialData: asRecord(scene.spatialData) as JsonObject,
        runtimeHints: asRecord(scene.runtimeHints) as JsonObject,
        hotspots: asArray(scene.hotspots).map((hotspotEntry, index) => {
          const hotspot = asRecord(hotspotEntry);
          return {
            key: String(hotspot.key ?? `${String(scene.key)}-hotspot-${index + 1}`),
            geometry: asRecord(hotspot.geometry) as JsonObject,
            position: asRecord(hotspot.position) as JsonObject,
            appearance: asRecord(hotspot.appearance) as JsonObject,
            content: asRecord(hotspot.content) as JsonObject,
            action: asRecord(hotspot.action) as JsonObject,
            visibilityRules: asRecord(hotspot.visibilityRules) as JsonObject,
            sortOrder: Number(hotspot.sortOrder ?? index)
          };
        }),
        overlays: asArray(scene.overlays).map((overlayEntry, index) => {
          const overlay = asRecord(overlayEntry);
          return {
            key: String(overlay.key ?? `${String(scene.key)}-overlay-${index + 1}`),
            name: typeof overlay.name === 'string' ? overlay.name : null,
            geometryKind: (overlay.geometryKind ?? 'polygon') as InteractionGeometryKind,
            geometry: asRecord(overlay.geometry) as JsonObject,
            position: asRecord(overlay.position) as JsonObject,
            appearance: asRecord(overlay.appearance) as JsonObject,
            content: asRecord(overlay.content) as JsonObject,
            action: asRecord(overlay.action) as JsonObject,
            visibilityRules: asRecord(overlay.visibilityRules) as JsonObject,
            extensionId: typeof overlay.extensionId === 'string' ? overlay.extensionId : null,
            extensionVersion:
              typeof overlay.extensionVersion === 'string' ? overlay.extensionVersion : null,
            sortOrder: Number(overlay.sortOrder ?? index)
          };
        })
      };
    }),
    plans: asArray(record.plans).map((entry, index) => {
      const plan = asRecord(entry);
      return {
        key: String(plan.key ?? `plan-${index + 1}`),
        name: String(plan.name ?? 'Plan'),
        assetKey: typeof plan.assetKey === 'string' ? plan.assetKey : null,
        coordinateSystem: plan.coordinateSystem === 'plan_pixels' ? 'plan_pixels' : 'plan_normalized',
        metadata: asRecord(plan.metadata) as JsonObject,
        sortOrder: Number(plan.sortOrder ?? index)
      };
    }),
    connections: asArray(record.connections).flatMap((entry) => {
      const connection = asRecord(entry);
      if (typeof connection.sourceSceneKey !== 'string'
        || typeof connection.targetSceneKey !== 'string') return [];
      return [{
        sourceSceneKey: connection.sourceSceneKey,
        targetSceneKey: connection.targetSceneKey,
        triggerHotspotKey:
          typeof connection.triggerHotspotKey === 'string' ? connection.triggerHotspotKey : null,
        label: typeof connection.label === 'string' ? connection.label : null,
        content: asRecord(connection.content) as JsonObject,
        importance:
          typeof connection.importance === 'number' ? connection.importance : null,
        preloadHint: typeof connection.preloadHint === 'string' ? connection.preloadHint : null
      }];
    }),
    timeline: asArray(record.timeline).map((entry, index) => {
      const interaction = asRecord(entry);
      return {
        key: String(interaction.key ?? `interaction-${index + 1}`),
        kind: String(interaction.kind ?? 'information'),
        timeMs: Number(interaction.timeMs ?? 0),
        endTimeMs: typeof interaction.endTimeMs === 'number' ? interaction.endTimeMs : null,
        geometry: asRecord(interaction.geometry) as JsonObject,
        position: asRecord(interaction.position) as JsonObject,
        viewpoint: asRecord(interaction.viewpoint) as JsonObject,
        appearance: asRecord(interaction.appearance) as JsonObject,
        content: asRecord(interaction.content) as JsonObject,
        action: asRecord(interaction.action) as JsonObject,
        visibilityRules: asRecord(interaction.visibilityRules) as JsonObject,
        sortOrder: Number(interaction.sortOrder ?? index)
      };
    }),
    assets: Object.fromEntries(
      Object.entries(asRecord(record.assets)).flatMap(([key, value]) =>
        typeof value === 'string' ? [[key, value]] : [])
    )
  };
}

/* --------------------------------------------------------------------- */
/* Visibility and listing                                                 */
/* --------------------------------------------------------------------- */

function serializeTemplate(
  template: Template,
  options: { includeBlueprint?: boolean } = {}
): Record<string, unknown> {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    schemaVersion: template.schemaVersion,
    experienceType: template.experienceType,
    assetPolicy: template.assetPolicy,
    visibility: template.visibility,
    status: template.status,
    previewAssetId: template.previewAssetId,
    workspaceId: template.workspaceId,
    ...(options.includeBlueprint === true
      ? {
        blueprint: {
          sceneCount: asArray(asRecord(template.canonicalBlueprint).scenes).length,
          planCount: asArray(asRecord(template.canonicalBlueprint).plans).length,
          timelineCount: asArray(asRecord(template.canonicalBlueprint).timeline).length,
          assetCount: Object.keys(asRecord(asRecord(template.canonicalBlueprint).assets)).length
        }
      }
      : {}),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

async function accessibleWorkspaceIds(userId: string): Promise<string[]> {
  const memberships = await WorkspaceMembership.findAll({
    where: { userId, status: 'active' },
    attributes: ['workspaceId']
  });
  const owned = await Workspace.findAll({ where: { ownerId: userId }, attributes: ['id'] });
  return [
    ...new Set([
      ...memberships.map((membership) => membership.workspaceId),
      ...owned.map((workspace) => workspace.id)
    ])
  ];
}

export async function listTemplates(
  userId: string,
  filter: { experienceType?: ProjectType } = {}
): Promise<Record<string, unknown>[]> {
  const workspaceIds = await accessibleWorkspaceIds(userId);
  const templates = await Template.findAll({
    where: {
      status: 'published',
      ...(filter.experienceType === undefined ? {} : { experienceType: filter.experienceType }),
      [Op.or]: [
        { visibility: 'platform' },
        { visibility: 'private', ownerId: userId },
        ...(workspaceIds.length === 0
          ? []
          : [{ visibility: 'workspace', workspaceId: { [Op.in]: workspaceIds } }])
      ]
    },
    order: [['name', 'ASC']]
  });
  return templates.map((template) => serializeTemplate(template));
}

async function readableTemplate(templateId: string, userId: string): Promise<Template> {
  const template = await Template.findByPk(templateId);
  if (!template) throw notFound('template', templateId);
  if (template.visibility === 'platform') {
    if (template.status !== 'published' && template.ownerId !== userId) {
      throw notFound('template', templateId);
    }
    return template;
  }
  if (template.visibility === 'private') {
    if (template.ownerId !== userId) throw notFound('template', templateId);
    return template;
  }
  if (template.workspaceId === null) throw notFound('template', templateId);
  await requireWorkspaceRole(template.workspaceId, userId, 'viewer');
  return template;
}

export async function getTemplate(
  templateId: string,
  userId: string
): Promise<Record<string, unknown>> {
  const template = await readableTemplate(templateId, userId);
  return serializeTemplate(template, { includeBlueprint: true });
}

/* --------------------------------------------------------------------- */
/* Authoring                                                              */
/* --------------------------------------------------------------------- */

export async function createTemplateFromProject(
  userId: string,
  input: {
    projectId: string;
    name: string;
    description?: string;
    visibility?: TemplateVisibility;
    assetPolicy?: TemplateAssetPolicy;
    workspaceId?: string | null;
    status?: TemplateStatus;
  }
): Promise<Record<string, unknown>> {
  await requireProjectRole(input.projectId, userId, 'admin');
  const visibility = input.visibility ?? 'private';
  if (visibility === 'workspace') {
    if (!input.workspaceId) {
      throw new AppError('WORKSPACE_REQUIRED', 'Choose a workspace to share this template with.', {
        status: 422,
        path: 'workspaceId'
      });
    }
    await requireWorkspaceRole(input.workspaceId, userId, 'admin');
  }
  if (visibility === 'platform') {
    // Platform templates are curated: an ordinary creator publishes to their
    // own account or workspace instead.
    throw new AppError('TEMPLATE_VISIBILITY_NOT_ALLOWED', 'Platform templates are curated.', {
      status: 403,
      path: 'visibility'
    });
  }
  const template = await sequelize.transaction(async (transaction) => {
    const project = await Project.findByPk(input.projectId, { transaction });
    if (!project) throw notFound('project', input.projectId);
    const blueprint = await captureBlueprint(project, transaction);
    return Template.create(
      {
        ownerId: userId,
        workspaceId: visibility === 'workspace' ? input.workspaceId! : null,
        name: sanitizeRequiredPlainText(input.name, 'name'),
        description: input.description === undefined
          ? null
          : sanitizePlainText(input.description).trim().slice(0, 2_000) || null,
        schemaVersion: CURRENT_EXPERIENCE_SCHEMA_VERSION,
        experienceType: project.type,
        canonicalBlueprint: blueprint as unknown as JsonObject,
        assetPolicy: input.assetPolicy ?? 'omit',
        visibility,
        status: input.status ?? 'published',
        previewAssetId: null
      },
      { transaction }
    );
  });
  return { template: serializeTemplate(template, { includeBlueprint: true }) };
}

export async function setTemplateStatus(
  templateId: string,
  userId: string,
  status: TemplateStatus
): Promise<Record<string, unknown>> {
  const template = await Template.findByPk(templateId);
  if (!template) throw notFound('template', templateId);
  if (template.ownerId !== userId) {
    if (template.workspaceId === null) throw notFound('template', templateId);
    await requireWorkspaceRole(template.workspaceId, userId, 'admin');
  }
  await template.update({ status });
  return { template: serializeTemplate(template) };
}

/* --------------------------------------------------------------------- */
/* Instantiation                                                          */
/* --------------------------------------------------------------------- */

type AssetResolution = Map<string, string>;

/**
 * Applies the template's asset policy.
 *
 * `reference` only keeps assets the instantiating user already owns, so a
 * template can never smuggle another account's private media into a new
 * project. `copy` duplicates the original through the media pipeline.
 */
async function applyAssetPolicy(
  blueprint: Blueprint,
  policy: TemplateAssetPolicy,
  userId: string,
  projectId: string
): Promise<AssetResolution> {
  const resolution: AssetResolution = new Map();
  if (policy === 'omit') return resolution;
  const { Asset } = await import('../models');
  for (const [key, sourceAssetId] of Object.entries(blueprint.assets)) {
    const source = await Asset.findByPk(sourceAssetId);
    if (!source || source.processingStatus !== 'ready') continue;
    if (policy === 'reference') {
      // Referencing is only safe for media the instantiating user owns.
      if (source.ownerId !== userId) continue;
      resolution.set(key, source.id);
      continue;
    }
    const copied = await copyAssetForOwner({
      sourceAssetId: source.id,
      targetOwnerId: userId,
      targetProjectId: projectId
    });
    resolution.set(key, copied.id);
  }
  return resolution;
}

function resolveAssetReferences(value: JsonObject, resolution: AssetResolution): JsonObject {
  return remapAssetIds(value, (key) => resolution.get(key) ?? null) as JsonObject;
}

export async function instantiateTemplate(
  templateId: string,
  userId: string,
  input: { name?: string; workspaceId?: string | null } = {}
): Promise<Record<string, unknown>> {
  const template = await readableTemplate(templateId, userId);
  if (template.status !== 'published') {
    throw new AppError('TEMPLATE_NOT_AVAILABLE', 'This template is not available.', {
      status: 409,
      entityId: templateId
    });
  }
  if (template.schemaVersion !== CURRENT_EXPERIENCE_SCHEMA_VERSION) {
    throw new AppError('TEMPLATE_SCHEMA_UNSUPPORTED', 'This template was built for another version.', {
      status: 422,
      entityId: templateId,
      details: { supportedSchemaVersion: CURRENT_EXPERIENCE_SCHEMA_VERSION }
    });
  }
  if (input.workspaceId) await requireWorkspaceRole(input.workspaceId, userId, 'editor');
  const blueprint = readBlueprint(template.canonicalBlueprint);

  const projectId = randomUUID();
  // Asset work happens before the project transaction: copying media is slow
  // and must not hold write locks on the project graph.
  const project = await Project.create({
    id: projectId,
    ownerId: userId,
    workspaceId: input.workspaceId ?? null,
    type: blueprint.experienceType,
    name: sanitizeRequiredPlainText(input.name ?? template.name, 'name'),
    schemaVersion: CURRENT_EXPERIENCE_SCHEMA_VERSION,
    revision: 1,
    settings: {},
    branding: {},
    videoAssetId: null,
    videoSettings: {},
    publicationMetadata: {}
  });

  let resolution: AssetResolution;
  try {
    resolution = await applyAssetPolicy(blueprint, template.assetPolicy, userId, projectId);
  } catch (error) {
    await project.destroy();
    throw error;
  }

  try {
    await sequelize.transaction(async (transaction) => {
      await project.update(
        {
          settings: sanitizeProjectSettings(
            resolveAssetReferences(blueprint.settings, resolution) as Record<string, unknown>
          ),
          branding: sanitizeBranding(
            resolveAssetReferences(blueprint.branding, resolution) as Record<string, unknown>
          ),
          ...(blueprint.experienceType === 'video360'
            ? {
              videoSettings: blueprint.videoSettings,
              videoAssetId: blueprint.videoAssetKey === null
                ? null
                : resolution.get(blueprint.videoAssetKey) ?? null
            }
            : {})
        },
        { transaction }
      );

      const planIdByKey = new Map<string, string>();
      for (const plan of [...blueprint.plans].sort((left, right) => left.sortOrder - right.sortOrder)) {
        const created = await Plan.create(
          {
            projectId,
            name: sanitizeRequiredPlainText(plan.name, 'name'),
            assetId: plan.assetKey === null ? null : resolution.get(plan.assetKey) ?? null,
            coordinateSystem: plan.coordinateSystem,
            metadata: plan.metadata,
            sortOrder: plan.sortOrder
          },
          { transaction }
        );
        planIdByKey.set(plan.key, created.id);
      }

      const sceneIdByKey = new Map<string, string>();
      const hotspotIdByKey = new Map<string, string>();
      const orderedScenes = [...blueprint.scenes].sort(
        (left, right) => left.sortOrder - right.sortOrder
      );
      for (const [index, scene] of orderedScenes.entries()) {
        const spatialData = { ...scene.spatialData };
        if (typeof spatialData.planId === 'string') {
          const planId = planIdByKey.get(spatialData.planId);
          if (planId === undefined) delete spatialData.planId;
          else spatialData.planId = planId;
        }
        const created = await Scene.create(
          {
            projectId,
            name: sanitizeRequiredPlainText(scene.name, 'name'),
            panoramaAssetId: scene.panoramaAssetKey === null
              ? null
              : resolution.get(scene.panoramaAssetKey) ?? null,
            sortOrder: index,
            isPrimary: index === 0 ? true : scene.isPrimary && index === 0,
            initialView: scene.initialView,
            viewLimits: scene.viewLimits,
            spatialData,
            runtimeHints: scene.runtimeHints
          },
          { transaction }
        );
        sceneIdByKey.set(scene.key, created.id);

        for (const hotspot of scene.hotspots) {
          const createdHotspot = await Hotspot.create(
            {
              sceneId: created.id,
              geometryKind: (asRecord(hotspot.geometry).kind ?? 'point') as InteractionGeometryKind,
              geometry: resolveAssetReferences(hotspot.geometry, resolution),
              position: hotspot.position,
              appearance: sanitizeHotspotAppearance(
                resolveAssetReferences(hotspot.appearance, resolution) as Record<string, unknown>
              ),
              content: sanitizeHotspotContent(
                resolveAssetReferences(hotspot.content, resolution) as Record<string, unknown>
              ),
              action: sanitizeHotspotAction(
                resolveAssetReferences(hotspot.action, resolution) as Record<string, unknown>
              ),
              visibilityRules: hotspot.visibilityRules,
              extensionId: null,
              extensionVersion: null,
              sortOrder: hotspot.sortOrder
            },
            { transaction }
          );
          hotspotIdByKey.set(hotspot.key, createdHotspot.id);
        }

        for (const overlay of scene.overlays) {
          await Overlay.create(
            {
              sceneId: created.id,
              name: overlay.name,
              geometryKind: overlay.geometryKind,
              geometry: resolveAssetReferences(overlay.geometry, resolution),
              position: overlay.position,
              appearance: sanitizeHotspotAppearance(
                resolveAssetReferences(overlay.appearance, resolution) as Record<string, unknown>
              ),
              content: sanitizeHotspotContent(
                resolveAssetReferences(overlay.content, resolution) as Record<string, unknown>
              ),
              action: sanitizeHotspotAction(
                resolveAssetReferences(overlay.action, resolution) as Record<string, unknown>
              ),
              visibilityRules: overlay.visibilityRules,
              extensionId: overlay.extensionId,
              extensionVersion: overlay.extensionVersion,
              sortOrder: overlay.sortOrder
            },
            { transaction }
          );
        }
      }

      for (const connection of blueprint.connections) {
        const sourceSceneId = sceneIdByKey.get(connection.sourceSceneKey);
        const targetSceneId = sceneIdByKey.get(connection.targetSceneKey);
        if (sourceSceneId === undefined || targetSceneId === undefined) continue;
        await SceneConnection.create(
          {
            sourceSceneId,
            targetSceneId,
            triggerHotspotId: connection.triggerHotspotKey === null
              ? null
              : hotspotIdByKey.get(connection.triggerHotspotKey) ?? null,
            label: connection.label,
            content: connection.content,
            importance: connection.importance,
            preloadHint: connection.preloadHint as 'none' | 'normal' | 'high' | null
          },
          { transaction }
        );
      }

      for (const interaction of blueprint.timeline) {
        await TimelineInteraction.create(
          {
            projectId,
            kind: interaction.kind as never,
            timeMs: interaction.timeMs,
            endTimeMs: interaction.endTimeMs,
            geometry: interaction.geometry,
            position: interaction.position,
            viewpoint: interaction.viewpoint,
            appearance: sanitizeHotspotAppearance(
              resolveAssetReferences(interaction.appearance, resolution) as Record<string, unknown>
            ),
            content: sanitizeTimelineContent(
              resolveAssetReferences(interaction.content, resolution) as Record<string, unknown>
            ),
            action: sanitizeTimelineAction(
              resolveAssetReferences(interaction.action, resolution) as Record<string, unknown>
            ),
            visibilityRules: interaction.visibilityRules,
            sortOrder: interaction.sortOrder
          },
          { transaction }
        );
      }
    });
  } catch (error) {
    // A half-built project would be worse than none: the creator can retry.
    await project.destroy().catch(() => undefined);
    throw error;
  }

  await recordAudit({
    action: 'template.instantiated',
    actorUserId: userId,
    projectId,
    workspaceId: input.workspaceId ?? null,
    entityType: 'template',
    entityId: templateId,
    metadata: {
      assetPolicy: template.assetPolicy,
      resolvedAssetCount: resolution.size,
      experienceType: blueprint.experienceType
    }
  });

  const created = await Project.findByPk(projectId);
  return {
    project: {
      id: projectId,
      type: created?.type,
      name: created?.name,
      schemaVersion: created?.schemaVersion,
      revision: created?.revision,
      workspaceId: created?.workspaceId ?? null
    },
    templateId,
    assetPolicy: template.assetPolicy,
    resolvedAssetCount: resolution.size
  };
}
