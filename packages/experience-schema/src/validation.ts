import { validateSafeUrl } from './security/url-validator';
import { validateExtensionPayload } from './extensions/payload-validator';
import type { ExtensionRegistrySnapshot } from './extensions/types';
import { ASSET_PROCESSING_STATUSES } from './asset-processing';
import {
  ASSET_DERIVATIVE_KINDS,
  ASSET_MEDIA_TYPES,
  ASSET_PROJECTIONS,
  CURRENT_EXPERIENCE_SCHEMA_VERSION,
  INTERACTION_GEOMETRY_KINDS,
  PROJECT_TYPES,
  SPATIAL_COORDINATE_SYSTEMS,
} from './types';
import type {
  CanonicalAsset,
  CanonicalAssetMediaType,
  CanonicalProject,
  CanonicalProjectType,
} from './types';

export const CANONICAL_VALIDATION_CODES = [
  'CANONICAL_PROJECT_REQUIRED',
  'REQUIRED_FIELD',
  'INVALID_FIELD',
  'UNSUPPORTED_SCHEMA_VERSION',
  'UNSUPPORTED_PROJECT_TYPE',
  'DUPLICATE_ENTITY_ID',
  'REFERENCE_NOT_FOUND',
  'REFERENCE_FORBIDDEN',
  'ASSET_NOT_READY',
  'ASSET_PROCESSING_FAILED',
  'ASSET_MEDIA_TYPE_MISMATCH',
  'INVALID_URL',
  'UNSUPPORTED_HOTSPOT_GEOMETRY',
  'UNSUPPORTED_HOTSPOT_ACTION',
  'UNSUPPORTED_OVERLAY_GEOMETRY',
  'INVALID_GEOMETRY',
  'SCENE_SPATIAL_DATA_INCOMPLETE',
  'MAP_SCENE_MAPPING_INVALID',
  'MAP_ASSET_NOT_READY',
  'PLAN_NOT_FOUND',
  'EXTENSION_NOT_REGISTERED',
  'EXTENSION_NOT_AVAILABLE',
  'EXTENSION_PAYLOAD_INVALID',
  'RENDERER_CONFIG_FORBIDDEN',
] as const;

export type CanonicalValidationCode = (typeof CANONICAL_VALIDATION_CODES)[number];
export type ValidationEntityType =
  | 'project'
  | 'scene'
  | 'hotspot'
  | 'overlay'
  | 'plan'
  | 'asset'
  | 'branding';

export interface ValidationIssue {
  readonly code: CanonicalValidationCode | string;
  readonly severity?: 'error' | 'warning';
  readonly message: string;
  readonly entityType: ValidationEntityType;
  readonly entityId?: string;
  readonly path: string;
  readonly retryable: boolean;
  readonly alternatives?: readonly string[];
}

export interface CanonicalValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface CanonicalValidationOptions {
  /** Supplying assets enables existence, ownership, readiness and media checks. */
  readonly assets?: readonly unknown[];
  readonly requireReadyAssets?: boolean;
  readonly supportedSchemaVersions?: readonly number[];
  readonly supportedProjectTypes?: readonly string[];
  /**
   * Supplying the registry enables custom-interaction payload validation.
   * Without it a custom geometry is rejected rather than trusted.
   */
  readonly extensions?: ExtensionRegistrySnapshot;
}

interface IssueContext {
  readonly entityType: ValidationEntityType;
  readonly entityId?: string;
  readonly path: string;
}

type UnknownRecord = Record<string, unknown>;

const forbiddenRendererKeys = new Set([
  'adapter',
  'plugin',
  'plugins',
  'psv',
  'psvconfig',
  'photosphereviewer',
  'rendererconfig',
  'viewerconfig',
  'viewerintegration',
]);
const colorPattern = /^#[\da-f]{6}$/iu;

export function validateCanonicalProject(
  value: unknown,
  options: CanonicalValidationOptions = {},
): CanonicalValidationResult {
  const issues: ValidationIssue[] = [];
  const project = asRecord(value);
  if (project === undefined) {
    issues.push(issue(
      'CANONICAL_PROJECT_REQUIRED',
      'A canonical project object is required.',
      { entityType: 'project', path: '' },
    ));
    return result(issues);
  }

  const projectId = optionalEntityId(project.id);
  const projectContext: IssueContext = {
    entityType: 'project',
    ...(projectId === undefined ? {} : { entityId: projectId }),
    path: '',
  };

  requireNonEmptyString(project.id, 'id', projectContext, issues);
  requireNonEmptyString(project.ownerId, 'ownerId', projectContext, issues);
  requireNonEmptyString(project.name, 'name', projectContext, issues);

  const schemaVersions = options.supportedSchemaVersions
    ?? [CURRENT_EXPERIENCE_SCHEMA_VERSION];
  if (!isPositiveInteger(project.schemaVersion) || !schemaVersions.includes(project.schemaVersion)) {
    issues.push(issue(
      'UNSUPPORTED_SCHEMA_VERSION',
      `schemaVersion must be one of: ${schemaVersions.join(', ')}.`,
      withPath(projectContext, 'schemaVersion'),
    ));
  }

  const projectTypes = options.supportedProjectTypes ?? PROJECT_TYPES;
  if (typeof project.type !== 'string' || !projectTypes.includes(project.type)) {
    issues.push(issue(
      'UNSUPPORTED_PROJECT_TYPE',
      `Project type must be one of: ${projectTypes.join(', ')}.`,
      withPath(projectContext, 'type'),
    ));
  }

  if (!isPositiveInteger(project.revision)) {
    issues.push(issue(
      'INVALID_FIELD',
      'revision must be a positive integer.',
      withPath(projectContext, 'revision'),
    ));
  }

  validateSettings(project.settings, projectContext, issues);
  validateBranding(project.branding, projectContext, issues);
  scanForRendererConfiguration(project, projectContext, issues);

  const assets = buildAssetIndex(options.assets, issues);
  const branding = asRecord(project.branding);
  if (branding !== undefined) {
    for (const brandingAssetField of [
      'logoAssetId',
      'faviconAssetId',
      'watermarkAssetId',
    ] as const) {
      const brandingAssetId = branding[brandingAssetField];
      if (typeof brandingAssetId === 'string') {
        validateAssetReference(
          brandingAssetId,
          ['image', 'logo'],
          `branding.${brandingAssetField}`,
          { ...projectContext, entityType: 'branding' },
          project,
          assets,
          options,
          issues,
        );
      }
    }
  }
  const scenes = Array.isArray(project.scenes) ? project.scenes : undefined;
  if (scenes === undefined || scenes.length === 0) {
    issues.push(issue(
      'REQUIRED_FIELD',
      'At least one scene is required.',
      withPath(projectContext, 'scenes'),
    ));
    return result(issues);
  }

  const planIds = validatePlans(project, assets, options, issues);
  const sceneIds = new Set<string>();
  const hotspotIds = new Set<string>();
  const overlayIds = new Set<string>();
  const connectionIds = new Set<string>();
  for (const [sceneIndex, sceneValue] of scenes.entries()) {
    const scenePath = `scenes[${sceneIndex}]`;
    const scene = asRecord(sceneValue);
    if (scene === undefined) {
      issues.push(issue(
        'INVALID_FIELD',
        'Scene must be an object.',
        { entityType: 'scene', path: scenePath },
      ));
      continue;
    }

    const sceneId = optionalEntityId(scene.id);
    const sceneContext: IssueContext = {
      entityType: 'scene',
      ...(sceneId === undefined ? {} : { entityId: sceneId }),
      path: scenePath,
    };
    requireNonEmptyString(scene.id, `${scenePath}.id`, sceneContext, issues, true);
    requireNonEmptyString(scene.name, `${scenePath}.name`, sceneContext, issues, true);
    requireNonEmptyString(
      scene.panoramaAssetId,
      `${scenePath}.panoramaAssetId`,
      sceneContext,
      issues,
      true,
    );

    if (sceneId !== undefined) {
      if (sceneIds.has(sceneId)) {
        issues.push(issue(
          'DUPLICATE_ENTITY_ID',
          'Scene IDs must be unique within a project.',
          { ...sceneContext, path: `${scenePath}.id` },
        ));
      }
      sceneIds.add(sceneId);
    }

    if (typeof project.id === 'string'
      && (typeof scene.projectId !== 'string' || scene.projectId !== project.id)) {
      issues.push(issue(
        'REFERENCE_FORBIDDEN',
        'The scene projectId must match its containing project.',
        { ...sceneContext, path: `${scenePath}.projectId` },
      ));
    }

    if (typeof scene.panoramaAssetId === 'string') {
      validateAssetReference(
        scene.panoramaAssetId,
        ['panorama_image'],
        `${scenePath}.panoramaAssetId`,
        sceneContext,
        project,
        assets,
        options,
        issues,
      );
    }

    validateInitialView(scene.initialView, `${scenePath}.initialView`, sceneContext, issues);
    validateViewLimits(scene.viewLimits, `${scenePath}.viewLimits`, sceneContext, issues);
    validateConnections(
      scene.connections,
      sceneId,
      scenePath,
      sceneContext,
      connectionIds,
      issues,
    );
    validateRuntimeHints(scene.runtimeHints, scenePath, sceneContext, issues);
    validateSpatialData(scene.spatialData, scenePath, sceneContext, planIds, issues);
    validateOverlays(
      scene.overlays,
      scenePath,
      sceneId,
      project,
      assets,
      options,
      overlayIds,
      issues,
    );

    const hotspots = Array.isArray(scene.hotspots) ? scene.hotspots : undefined;
    if (hotspots === undefined) {
      issues.push(issue(
        'INVALID_FIELD',
        'hotspots must be an array.',
        { ...sceneContext, path: `${scenePath}.hotspots` },
      ));
      continue;
    }

    for (const [hotspotIndex, hotspotValue] of hotspots.entries()) {
      validateHotspot(
        hotspotValue,
        `${scenePath}.hotspots[${hotspotIndex}]`,
        sceneId,
        project,
        assets,
        options,
        hotspotIds,
        issues,
      );
    }
  }

  validateSceneReferences(project, sceneIds, hotspotIds, issues);
  return result(issues);
}

export function validateCanonicalAsset(value: unknown): CanonicalValidationResult {
  const issues: ValidationIssue[] = [];
  const asset = asRecord(value);
  if (asset === undefined) {
    issues.push(issue('INVALID_FIELD', 'Asset must be an object.', {
      entityType: 'asset',
      path: '',
    }));
    return result(issues);
  }

  const assetId = optionalEntityId(asset.id);
  const context: IssueContext = {
    entityType: 'asset',
    ...(assetId === undefined ? {} : { entityId: assetId }),
    path: '',
  };
  requireNonEmptyString(asset.id, 'id', context, issues);
  requireNonEmptyString(asset.ownerId, 'ownerId', context, issues);
  if (typeof asset.mediaType !== 'string' || !ASSET_MEDIA_TYPES.includes(
    asset.mediaType as (typeof ASSET_MEDIA_TYPES)[number],
  )) {
    issues.push(issue('INVALID_FIELD', 'mediaType is not supported.', withPath(context, 'mediaType')));
  }
  if (typeof asset.projection !== 'string' || !ASSET_PROJECTIONS.includes(
    asset.projection as (typeof ASSET_PROJECTIONS)[number],
  )) {
    issues.push(issue('INVALID_FIELD', 'projection is not supported.', withPath(context, 'projection')));
  }
  if (typeof asset.processingStatus !== 'string' || !ASSET_PROCESSING_STATUSES.includes(
    asset.processingStatus as (typeof ASSET_PROCESSING_STATUSES)[number],
  )) {
    issues.push(issue(
      'INVALID_FIELD',
      'processingStatus is not supported.',
      withPath(context, 'processingStatus'),
    ));
  }
  if (!Array.isArray(asset.derivatives)) {
    issues.push(issue('INVALID_FIELD', 'derivatives must be an array.', withPath(context, 'derivatives')));
  } else {
    const identities = new Set<string>();
    for (const [index, derivativeValue] of asset.derivatives.entries()) {
      validateDerivative(derivativeValue, `derivatives[${index}]`, context, identities, issues);
    }
  }
  return result(issues);
}

function validateSettings(
  value: unknown,
  projectContext: IssueContext,
  issues: ValidationIssue[],
): void {
  const settings = asRecord(value);
  if (settings === undefined) {
    issues.push(issue(
      'INVALID_FIELD',
      'settings must be an object.',
      withPath(projectContext, 'settings'),
    ));
    return;
  }
  const appearance = asRecord(settings.appearance);
  if (settings.appearance !== undefined && appearance === undefined) {
    issues.push(issue(
      'INVALID_FIELD',
      'settings.appearance must be an object.',
      withPath(projectContext, 'settings.appearance'),
    ));
  } else if (appearance !== undefined) {
    if (appearance.theme !== undefined
      && !['light', 'dark', 'custom'].includes(String(appearance.theme))) {
      issues.push(issue(
        'INVALID_FIELD',
        'theme must be light, dark, or custom.',
        withPath(projectContext, 'settings.appearance.theme'),
      ));
    }
    validateOptionalColor(
      appearance.primaryColor,
      'settings.appearance.primaryColor',
      projectContext,
      issues,
    );
    validateOptionalColor(
      appearance.backgroundColor,
      'settings.appearance.backgroundColor',
      projectContext,
      issues,
    );
    for (const key of ['hotspotStyle', 'typography'] as const) {
      if (appearance[key] !== undefined && typeof appearance[key] !== 'string') {
        issues.push(issue(
          'INVALID_FIELD',
          `${key} must be a string.`,
          withPath(projectContext, `settings.appearance.${key}`),
        ));
      }
    }
  }

  validateBooleanObject(
    settings.navigation,
    ['mouse', 'touch', 'zoom', 'keyboard', 'fullscreen', 'navigationButtons', 'sceneNavigation'],
    'settings.navigation',
    projectContext,
    issues,
  );

  validateBooleanObject(
    settings.gallery,
    ['enabled', 'showSceneNames', 'showThumbnails'],
    'settings.gallery',
    projectContext,
    issues,
  );
  validateBooleanObject(
    settings.compass,
    ['enabled'],
    'settings.compass',
    projectContext,
    issues,
  );

  const autorotation = asRecord(settings.autorotation);
  if (settings.autorotation !== undefined && autorotation === undefined) {
    issues.push(issue(
      'INVALID_FIELD',
      'settings.autorotation must be an object.',
      withPath(projectContext, 'settings.autorotation'),
    ));
  } else if (autorotation !== undefined) {
    for (const field of ['enabled', 'startAutomatically'] as const) {
      if (autorotation[field] !== undefined && typeof autorotation[field] !== 'boolean') {
        issues.push(issue(
          'INVALID_FIELD',
          `${field} must be a boolean.`,
          withPath(projectContext, `settings.autorotation.${field}`),
        ));
      }
    }
    if (autorotation.speedDegreesPerSecond !== undefined) {
      validateNumberRange(
        autorotation.speedDegreesPerSecond,
        0.1,
        30,
        'settings.autorotation.speedDegreesPerSecond',
        projectContext,
        issues,
      );
    }
    if (autorotation.direction !== undefined
      && !['clockwise', 'counterclockwise'].includes(String(autorotation.direction))) {
      issues.push(issue(
        'INVALID_FIELD',
        'direction must be clockwise or counterclockwise.',
        withPath(projectContext, 'settings.autorotation.direction'),
      ));
    }
  }

  const quality = asRecord(settings.quality);
  if (settings.quality !== undefined && quality === undefined) {
    issues.push(issue(
      'INVALID_FIELD',
      'settings.quality must be an object.',
      withPath(projectContext, 'settings.quality'),
    ));
  } else if (quality?.preference !== undefined
    && !['automatic', 'standard', 'high'].includes(String(quality.preference))) {
    issues.push(issue(
      'INVALID_FIELD',
      'quality preference must be automatic, standard, or high.',
      withPath(projectContext, 'settings.quality.preference'),
    ));
  }

  validateSpatialSettings(settings, projectContext, issues);
  validateImmersiveSettings(settings, projectContext, issues);

  const information = asRecord(settings.information);
  if (settings.information !== undefined && information === undefined) {
    issues.push(issue(
      'INVALID_FIELD',
      'settings.information must be an object.',
      withPath(projectContext, 'settings.information'),
    ));
  } else if (information !== undefined) {
    for (const key of ['title', 'description', 'bodyHtml'] as const) {
      if (information[key] !== undefined && typeof information[key] !== 'string') {
        issues.push(issue(
          'INVALID_FIELD',
          `${key} must be a string.`,
          withPath(projectContext, `settings.information.${key}`),
        ));
      }
    }
    if (information.externalUrl !== undefined) {
      const url = validateSafeUrl(information.externalUrl, { allowInternalRelative: true });
      if (!url.valid) {
        issues.push(issue(
          'INVALID_URL',
          url.message,
          withPath(projectContext, 'settings.information.externalUrl'),
        ));
      }
    }
  }
}

function validateSpatialSettings(
  settings: UnknownRecord,
  projectContext: IssueContext,
  issues: ValidationIssue[],
): void {
  const map = asRecord(settings.map);
  if (settings.map !== undefined && map === undefined) {
    issues.push(issue('INVALID_FIELD', 'settings.map must be an object.', withPath(projectContext, 'settings.map')));
  } else if (map !== undefined) {
    for (const field of ['enabled', 'showSceneMarkers', 'showHeadingCone'] as const) {
      if (map[field] !== undefined && typeof map[field] !== 'boolean') {
        issues.push(issue('INVALID_FIELD', `${field} must be a boolean.`, withPath(projectContext, `settings.map.${field}`)));
      }
    }
    if (map.defaultZoom !== undefined) {
      validateNumberRange(map.defaultZoom, 0, 22, 'settings.map.defaultZoom', projectContext, issues);
    }
  }

  const plan = asRecord(settings.plan);
  if (settings.plan !== undefined && plan === undefined) {
    issues.push(issue('INVALID_FIELD', 'settings.plan must be an object.', withPath(projectContext, 'settings.plan')));
  } else if (plan !== undefined) {
    for (const field of ['enabled', 'showSceneMarkers', 'showHeadingCone'] as const) {
      if (plan[field] !== undefined && typeof plan[field] !== 'boolean') {
        issues.push(issue('INVALID_FIELD', `${field} must be a boolean.`, withPath(projectContext, `settings.plan.${field}`)));
      }
    }
    if (plan.defaultPlanId !== undefined && typeof plan.defaultPlanId !== 'string') {
      issues.push(issue('INVALID_FIELD', 'defaultPlanId must be a string.', withPath(projectContext, 'settings.plan.defaultPlanId')));
    }
  }
}

function validateImmersiveSettings(
  settings: UnknownRecord,
  projectContext: IssueContext,
  issues: ValidationIssue[],
): void {
  validateBooleanObject(
    settings.motionNavigation,
    ['enabled', 'requestPermissionOnStart'],
    'settings.motionNavigation',
    projectContext,
    issues,
  );
  validateBooleanObject(
    settings.immersiveViewing,
    ['stereoEnabled', 'immersiveEnabled'],
    'settings.immersiveViewing',
    projectContext,
    issues,
  );
}

function validateBranding(
  value: unknown,
  projectContext: IssueContext,
  issues: ValidationIssue[],
): void {
  const branding = asRecord(value);
  if (branding === undefined) {
    issues.push(issue(
      'INVALID_FIELD',
      'branding must be an object.',
      withPath(projectContext, 'branding'),
    ));
    return;
  }
  for (const key of [
    'companyName',
    'logoAssetId',
    'faviconAssetId',
    'watermarkAssetId',
    'welcomeMessage',
    'loadingMessage',
  ] as const) {
    if (branding[key] !== undefined && typeof branding[key] !== 'string') {
      issues.push(issue(
        'INVALID_FIELD',
        `${key} must be a string.`,
        withPath(projectContext, `branding.${key}`),
      ));
    }
  }
  validateOptionalColor(branding.primaryColor, 'branding.primaryColor', projectContext, issues);
}

function validateConnections(
  value: unknown,
  sourceSceneId: string | undefined,
  scenePath: string,
  context: IssueContext,
  connectionIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    issues.push(issue(
      'INVALID_FIELD',
      'connections must be an array.',
      { ...context, path: `${scenePath}.connections` },
    ));
    return;
  }
  for (const [index, connectionValue] of value.entries()) {
    const connection = asRecord(connectionValue);
    const path = `${scenePath}.connections[${index}]`;
    if (connection === undefined) {
      issues.push(issue('INVALID_FIELD', 'Connection must be an object.', { ...context, path }));
      continue;
    }
    requireNonEmptyString(connection.id, `${path}.id`, context, issues, true);
    if (typeof connection.id === 'string') {
      if (connectionIds.has(connection.id)) {
        issues.push(issue(
          'DUPLICATE_ENTITY_ID',
          'Connection IDs must be unique within a project.',
          { ...context, path: `${path}.id` },
        ));
      }
      connectionIds.add(connection.id);
    }
    requireNonEmptyString(
      connection.sourceSceneId,
      `${path}.sourceSceneId`,
      context,
      issues,
      true,
    );
    requireNonEmptyString(
      connection.targetSceneId,
      `${path}.targetSceneId`,
      context,
      issues,
      true,
    );
    if (sourceSceneId !== undefined && connection.sourceSceneId !== sourceSceneId) {
      issues.push(issue(
        'REFERENCE_FORBIDDEN',
        'The connection source must match its containing scene.',
        { ...context, path: `${path}.sourceSceneId` },
      ));
    }
    for (const field of ['triggerHotspotId', 'label'] as const) {
      if (connection[field] !== undefined && typeof connection[field] !== 'string') {
        issues.push(issue(
          'INVALID_FIELD',
          `${field} must be a string.`,
          { ...context, path: `${path}.${field}` },
        ));
      }
    }
    if (connection.importance !== undefined) {
      validateNumberRange(connection.importance, 0, 100, `${path}.importance`, context, issues);
    }
    if (connection.preloadHint !== undefined
      && !['none', 'normal', 'high'].includes(String(connection.preloadHint))) {
      issues.push(issue(
        'INVALID_FIELD',
        'preloadHint must be none, normal, or high.',
        { ...context, path: `${path}.preloadHint` },
      ));
    }
    const content = asRecord(connection.content);
    if (connection.content !== undefined && content === undefined) {
      issues.push(issue(
        'INVALID_FIELD',
        'Connection content must be an object.',
        { ...context, path: `${path}.content` },
      ));
    } else if (content !== undefined) {
      for (const field of ['title', 'description'] as const) {
        if (content[field] !== undefined && typeof content[field] !== 'string') {
          issues.push(issue(
            'INVALID_FIELD',
            `${field} must be a string.`,
            { ...context, path: `${path}.content.${field}` },
          ));
        }
      }
    }
  }
}

function validateRuntimeHints(
  value: unknown,
  scenePath: string,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  const hints = asRecord(value);
  const path = `${scenePath}.runtimeHints`;
  if (hints === undefined) {
    issues.push(issue('INVALID_FIELD', 'runtimeHints must be an object.', { ...context, path }));
    return;
  }
  if (hints.preloadPriority !== undefined) {
    validateNumberRange(hints.preloadPriority, 0, 100, `${path}.preloadPriority`, context, issues);
  }
  if (hints.qualityPreference !== undefined
    && !['automatic', 'standard', 'high'].includes(String(hints.qualityPreference))) {
    issues.push(issue(
      'INVALID_FIELD',
      'qualityPreference must be automatic, standard, or high.',
      { ...context, path: `${path}.qualityPreference` },
    ));
  }
  if (hints.likelyNextSceneIds !== undefined
    && (!Array.isArray(hints.likelyNextSceneIds)
      || hints.likelyNextSceneIds.some((id) => typeof id !== 'string'))) {
    issues.push(issue(
      'INVALID_FIELD',
      'likelyNextSceneIds must be an array of scene IDs.',
      { ...context, path: `${path}.likelyNextSceneIds` },
    ));
  }
}

function validateHotspot(
  value: unknown,
  hotspotPath: string,
  sceneId: string | undefined,
  project: UnknownRecord,
  assets: ReadonlyMap<string, UnknownRecord> | undefined,
  options: CanonicalValidationOptions,
  hotspotIds: Set<string>,
  issues: ValidationIssue[],
): void {
  const hotspot = asRecord(value);
  if (hotspot === undefined) {
    issues.push(issue('INVALID_FIELD', 'Hotspot must be an object.', {
      entityType: 'hotspot',
      path: hotspotPath,
    }));
    return;
  }

  const hotspotId = optionalEntityId(hotspot.id);
  const context: IssueContext = {
    entityType: 'hotspot',
    ...(hotspotId === undefined ? {} : { entityId: hotspotId }),
    path: hotspotPath,
  };
  requireNonEmptyString(hotspot.id, `${hotspotPath}.id`, context, issues, true);
  if (hotspotId !== undefined) {
    if (hotspotIds.has(hotspotId)) {
      issues.push(issue(
        'DUPLICATE_ENTITY_ID',
        'Hotspot IDs must be unique within a project.',
        { ...context, path: `${hotspotPath}.id` },
      ));
    }
    hotspotIds.add(hotspotId);
  }
  if (sceneId !== undefined && hotspot.sceneId !== sceneId) {
    issues.push(issue(
      'REFERENCE_FORBIDDEN',
      'The hotspot sceneId must match its containing scene.',
      { ...context, path: `${hotspotPath}.sceneId` },
    ));
  }

  validateInteractionGeometry(
    hotspot.geometry,
    `${hotspotPath}.geometry`,
    context,
    project,
    assets,
    options,
    issues,
    { allowPoint: true, unsupportedCode: 'UNSUPPORTED_HOTSPOT_GEOMETRY' },
  );

  validateSphericalPosition(hotspot.position, `${hotspotPath}.position`, context, issues);
  validateHotspotAppearance(
    hotspot.appearance,
    hotspotPath,
    context,
    project,
    assets,
    options,
    issues,
  );
  validateHotspotContent(
    hotspot.content,
    hotspotPath,
    context,
    project,
    assets,
    options,
    issues,
  );
  validateHotspotAction(hotspot.action, hotspotPath, context, project, assets, options, issues);
}

interface GeometryValidationOptions {
  readonly allowPoint: boolean;
  readonly unsupportedCode: 'UNSUPPORTED_HOTSPOT_GEOMETRY' | 'UNSUPPORTED_OVERLAY_GEOMETRY';
}

/**
 * The one geometry gate for hotspots and overlays. Renderer meshes, marker
 * plugin options and shader parameters are deliberately absent: only product
 * shapes, angular sizes and validated references are accepted.
 */
function validateInteractionGeometry(
  value: unknown,
  geometryPath: string,
  context: IssueContext,
  project: UnknownRecord,
  assets: ReadonlyMap<string, UnknownRecord> | undefined,
  options: CanonicalValidationOptions,
  issues: ValidationIssue[],
  geometryOptions: GeometryValidationOptions,
): void {
  const geometry = asRecord(value);
  if (geometry === undefined || typeof geometry.kind !== 'string') {
    issues.push(issue(
      'INVALID_FIELD',
      'Interaction geometry must declare a kind.',
      { ...context, path: geometryPath },
    ));
    return;
  }
  const kind = geometry.kind;
  if (!INTERACTION_GEOMETRY_KINDS.includes(kind as (typeof INTERACTION_GEOMETRY_KINDS)[number])) {
    issues.push(issue(
      geometryOptions.unsupportedCode,
      'The interaction geometry kind is not supported.',
      { ...context, path: `${geometryPath}.kind` },
    ));
    return;
  }
  if (kind === 'point') {
    if (!geometryOptions.allowPoint) {
      issues.push(issue(
        geometryOptions.unsupportedCode,
        'An overlay requires an area, line or layer geometry.',
        { ...context, path: `${geometryPath}.kind` },
      ));
    }
    return;
  }

  if (kind === 'polygon' || kind === 'polyline') {
    validateGeometryVertices(geometry.vertices, kind, geometryPath, context, issues);
    return;
  }

  if (kind === 'imageLayer' || kind === 'videoLayer') {
    requireNonEmptyString(geometry.assetId, `${geometryPath}.assetId`, context, issues, true);
    if (typeof geometry.assetId === 'string') {
      validateAssetReference(
        geometry.assetId,
        kind === 'imageLayer'
          ? ['panorama_image', 'image', 'logo']
          : ['video', 'video360'],
        `${geometryPath}.assetId`,
        context,
        project,
        assets,
        options,
        issues,
      );
    }
    validateLayerAnchor(geometry.anchor, `${geometryPath}.anchor`, context, issues);
    return;
  }

  validateCustomGeometry(geometry, geometryPath, context, project, options, issues);
}

function validateGeometryVertices(
  value: unknown,
  kind: 'polygon' | 'polyline',
  geometryPath: string,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  const minimumVertices = kind === 'polygon' ? 3 : 2;
  if (!Array.isArray(value)) {
    issues.push(issue(
      'INVALID_FIELD',
      'Area and line geometry requires vertices.',
      { ...context, path: `${geometryPath}.vertices` },
    ));
    return;
  }
  if (value.length < minimumVertices) {
    issues.push(issue(
      'INVALID_GEOMETRY',
      kind === 'polygon'
        ? 'An area needs at least three points.'
        : 'A line needs at least two points.',
      { ...context, path: `${geometryPath}.vertices` },
    ));
  }
  if (value.length > 512) {
    issues.push(issue(
      'INVALID_GEOMETRY',
      'This shape has too many points.',
      { ...context, path: `${geometryPath}.vertices` },
    ));
  }
  for (const [index, vertex] of value.entries()) {
    validateSphericalPosition(vertex, `${geometryPath}.vertices[${index}]`, context, issues);
  }
}

function validateLayerAnchor(
  value: unknown,
  anchorPath: string,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  const anchor = asRecord(value);
  if (anchor === undefined) {
    issues.push(issue(
      'REQUIRED_FIELD',
      'A media layer requires placement information.',
      { ...context, path: anchorPath },
    ));
    return;
  }
  validateNumberRange(anchor.widthDegrees, 0.1, 360, `${anchorPath}.widthDegrees`, context, issues);
  validateNumberRange(anchor.heightDegrees, 0.1, 180, `${anchorPath}.heightDegrees`, context, issues);
  if (anchor.rotationDegrees !== undefined) {
    validateNumberRange(anchor.rotationDegrees, -180, 180, `${anchorPath}.rotationDegrees`, context, issues);
  }
  if (anchor.opacity !== undefined) {
    validateNumberRange(anchor.opacity, 0, 1, `${anchorPath}.opacity`, context, issues);
  }
  validateOptionalColor(anchor.chromaKeyColor, `${anchorPath}.chromaKeyColor`, context, issues);
}

/**
 * A custom interaction is only accepted when its extension is registered,
 * enabled, and its payload passes the registered schema. Unvalidated JSON is
 * never persisted as executable custom behaviour.
 */
function validateCustomGeometry(
  geometry: UnknownRecord,
  geometryPath: string,
  context: IssueContext,
  project: UnknownRecord,
  options: CanonicalValidationOptions,
  issues: ValidationIssue[],
): void {
  requireNonEmptyString(geometry.extensionId, `${geometryPath}.extensionId`, context, issues, true);
  requireNonEmptyString(
    geometry.extensionVersion,
    `${geometryPath}.extensionVersion`,
    context,
    issues,
    true,
  );
  if (typeof geometry.extensionId !== 'string' || typeof geometry.extensionVersion !== 'string') {
    return;
  }
  if (options.extensions === undefined) {
    issues.push(issue(
      'EXTENSION_NOT_REGISTERED',
      'Custom interactions cannot be validated in this context.',
      { ...context, path: `${geometryPath}.extensionId` },
    ));
    return;
  }
  const extension = options.extensions.get(geometry.extensionId, geometry.extensionVersion);
  if (extension === undefined) {
    issues.push(issue(
      'EXTENSION_NOT_REGISTERED',
      'This custom interaction is not registered on the platform.',
      { ...context, path: `${geometryPath}.extensionId` },
    ));
    return;
  }
  if (extension.status === 'disabled' || extension.status === 'draft') {
    issues.push(issue(
      'EXTENSION_NOT_AVAILABLE',
      'This custom interaction is not available.',
      { ...context, path: `${geometryPath}.extensionId` },
    ));
    return;
  }
  const projectType = typeof project.type === 'string'
    ? project.type as CanonicalProjectType
    : undefined;
  if (projectType !== undefined
    && !extension.supportedExperienceTypes.includes(projectType)) {
    issues.push(issue(
      'EXTENSION_NOT_AVAILABLE',
      'This custom interaction is not available for this experience type.',
      { ...context, path: `${geometryPath}.extensionId` },
    ));
    return;
  }
  const payload = validateExtensionPayload(extension, geometry.payload ?? {});
  for (const payloadIssue of payload.issues) {
    issues.push(issue(
      'EXTENSION_PAYLOAD_INVALID',
      payloadIssue.message,
      {
        ...context,
        path: payloadIssue.field.length === 0
          ? `${geometryPath}.payload`
          : `${geometryPath}.payload.${payloadIssue.field}`,
      },
    ));
  }
}

function validatePlans(
  project: UnknownRecord,
  assets: ReadonlyMap<string, UnknownRecord> | undefined,
  options: CanonicalValidationOptions,
  issues: ValidationIssue[],
): ReadonlySet<string> {
  const planIds = new Set<string>();
  const plans = project.plans;
  if (plans === undefined) return planIds;
  if (!Array.isArray(plans)) {
    issues.push(issue('INVALID_FIELD', 'plans must be an array.', {
      entityType: 'plan',
      path: 'plans',
    }));
    return planIds;
  }

  for (const [index, planValue] of plans.entries()) {
    const planPath = `plans[${index}]`;
    const plan = asRecord(planValue);
    if (plan === undefined) {
      issues.push(issue('INVALID_FIELD', 'A plan must be an object.', {
        entityType: 'plan',
        path: planPath,
      }));
      continue;
    }
    const planId = optionalEntityId(plan.id);
    const context: IssueContext = {
      entityType: 'plan',
      ...(planId === undefined ? {} : { entityId: planId }),
      path: planPath,
    };
    requireNonEmptyString(plan.id, `${planPath}.id`, context, issues, true);
    requireNonEmptyString(plan.name, `${planPath}.name`, context, issues, true);
    if (planId !== undefined) {
      if (planIds.has(planId)) {
        issues.push(issue('DUPLICATE_ENTITY_ID', 'Plan IDs must be unique within a project.', {
          ...context,
          path: `${planPath}.id`,
        }));
      }
      planIds.add(planId);
    }
    if (typeof project.id === 'string'
      && (typeof plan.projectId !== 'string' || plan.projectId !== project.id)) {
      issues.push(issue('REFERENCE_FORBIDDEN', 'The plan projectId must match its project.', {
        ...context,
        path: `${planPath}.projectId`,
      }));
    }
    if (typeof plan.coordinateSystem !== 'string'
      || !['plan_normalized', 'plan_pixels'].includes(plan.coordinateSystem)) {
      issues.push(issue(
        'INVALID_FIELD',
        'A plan coordinate system must be plan_normalized or plan_pixels.',
        { ...context, path: `${planPath}.coordinateSystem` },
      ));
    }
    if (typeof plan.assetId === 'string') {
      validateAssetReference(
        plan.assetId,
        ['plan_image', 'image'],
        `${planPath}.assetId`,
        context,
        project,
        assets,
        options,
        issues,
      );
    } else if (plan.assetId !== null && plan.assetId !== undefined) {
      issues.push(issue('INVALID_FIELD', 'assetId must be a string.', {
        ...context,
        path: `${planPath}.assetId`,
      }));
    }
  }
  return planIds;
}

/**
 * GPS and plan coordinates are independent families. A scene may carry either,
 * both, or neither; what it may not do is carry half of one.
 */
function validateSpatialData(
  value: unknown,
  scenePath: string,
  context: IssueContext,
  planIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  const path = `${scenePath}.spatialData`;
  const spatial = asRecord(value);
  if (spatial === undefined) {
    issues.push(issue('INVALID_FIELD', 'spatialData must be an object.', { ...context, path }));
    return;
  }
  if (Object.keys(spatial).length === 0) return;

  const coordinateSystem = spatial.coordinateSystem;
  if (coordinateSystem !== undefined
    && (typeof coordinateSystem !== 'string'
      || !SPATIAL_COORDINATE_SYSTEMS.includes(
        coordinateSystem as (typeof SPATIAL_COORDINATE_SYSTEMS)[number],
      ))) {
    issues.push(issue(
      'INVALID_FIELD',
      `coordinateSystem must be one of: ${SPATIAL_COORDINATE_SYSTEMS.join(', ')}.`,
      { ...context, path: `${path}.coordinateSystem` },
    ));
    return;
  }

  const hasLatitude = spatial.latitude !== undefined;
  const hasLongitude = spatial.longitude !== undefined;
  if (hasLatitude !== hasLongitude) {
    issues.push(issue(
      'SCENE_SPATIAL_DATA_INCOMPLETE',
      'A scene location needs both a latitude and a longitude.',
      { ...context, path },
    ));
  }
  if (hasLatitude) {
    validateNumberRange(spatial.latitude, -90, 90, `${path}.latitude`, context, issues);
  }
  if (hasLongitude) {
    validateNumberRange(spatial.longitude, -180, 180, `${path}.longitude`, context, issues);
  }
  if (spatial.altitudeMeters !== undefined) {
    validateNumberRange(spatial.altitudeMeters, -12_000, 12_000, `${path}.altitudeMeters`, context, issues);
  }
  if (spatial.headingDegrees !== undefined) {
    validateNumberRange(spatial.headingDegrees, 0, 360, `${path}.headingDegrees`, context, issues);
  }

  const planFields = ['planId', 'mapX', 'mapY'] as const;
  const providedPlanFields = planFields.filter((field) => spatial[field] !== undefined);
  if (providedPlanFields.length > 0 && providedPlanFields.length < planFields.length) {
    issues.push(issue(
      'SCENE_SPATIAL_DATA_INCOMPLETE',
      'Placing a scene on a plan needs the plan and both plan coordinates.',
      { ...context, path },
    ));
    return;
  }
  if (providedPlanFields.length === 0) {
    if (coordinateSystem === 'plan_normalized' || coordinateSystem === 'plan_pixels') {
      issues.push(issue(
        'SCENE_SPATIAL_DATA_INCOMPLETE',
        'Plan coordinates are declared but the scene is not placed on a plan.',
        { ...context, path },
      ));
    }
    return;
  }

  if (typeof spatial.planId !== 'string' || spatial.planId.length === 0) {
    issues.push(issue('INVALID_FIELD', 'planId must be a string.', {
      ...context,
      path: `${path}.planId`,
    }));
    return;
  }
  if (!planIds.has(spatial.planId)) {
    issues.push(issue('PLAN_NOT_FOUND', 'The scene references a plan that does not exist.', {
      ...context,
      path: `${path}.planId`,
    }));
    return;
  }
  if (coordinateSystem === 'wgs84') {
    issues.push(issue(
      'MAP_SCENE_MAPPING_INVALID',
      'Plan coordinates cannot use the world coordinate system.',
      { ...context, path: `${path}.coordinateSystem` },
    ));
    return;
  }
  const normalized = coordinateSystem !== 'plan_pixels';
  for (const field of ['mapX', 'mapY'] as const) {
    validateNumberRange(
      spatial[field],
      0,
      normalized ? 1 : 1_000_000,
      `${path}.${field}`,
      context,
      issues,
    );
  }
}

function validateOverlays(
  value: unknown,
  scenePath: string,
  sceneId: string | undefined,
  project: UnknownRecord,
  assets: ReadonlyMap<string, UnknownRecord> | undefined,
  options: CanonicalValidationOptions,
  overlayIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(issue('INVALID_FIELD', 'overlays must be an array.', {
      entityType: 'overlay',
      path: `${scenePath}.overlays`,
    }));
    return;
  }
  for (const [index, overlayValue] of value.entries()) {
    validateOverlay(
      overlayValue,
      `${scenePath}.overlays[${index}]`,
      sceneId,
      project,
      assets,
      options,
      overlayIds,
      issues,
    );
  }
}

function validateOverlay(
  value: unknown,
  overlayPath: string,
  sceneId: string | undefined,
  project: UnknownRecord,
  assets: ReadonlyMap<string, UnknownRecord> | undefined,
  options: CanonicalValidationOptions,
  overlayIds: Set<string>,
  issues: ValidationIssue[],
): void {
  const overlay = asRecord(value);
  if (overlay === undefined) {
    issues.push(issue('INVALID_FIELD', 'An overlay must be an object.', {
      entityType: 'overlay',
      path: overlayPath,
    }));
    return;
  }
  const overlayId = optionalEntityId(overlay.id);
  const context: IssueContext = {
    entityType: 'overlay',
    ...(overlayId === undefined ? {} : { entityId: overlayId }),
    path: overlayPath,
  };
  requireNonEmptyString(overlay.id, `${overlayPath}.id`, context, issues, true);
  if (overlayId !== undefined) {
    if (overlayIds.has(overlayId)) {
      issues.push(issue('DUPLICATE_ENTITY_ID', 'Overlay IDs must be unique within a project.', {
        ...context,
        path: `${overlayPath}.id`,
      }));
    }
    overlayIds.add(overlayId);
  }
  if (sceneId !== undefined && overlay.sceneId !== sceneId) {
    issues.push(issue('REFERENCE_FORBIDDEN', 'The overlay sceneId must match its scene.', {
      ...context,
      path: `${overlayPath}.sceneId`,
    }));
  }
  if (overlay.name !== undefined && typeof overlay.name !== 'string') {
    issues.push(issue('INVALID_FIELD', 'name must be a string.', {
      ...context,
      path: `${overlayPath}.name`,
    }));
  }

  validateInteractionGeometry(
    overlay.geometry,
    `${overlayPath}.geometry`,
    context,
    project,
    assets,
    options,
    issues,
    { allowPoint: false, unsupportedCode: 'UNSUPPORTED_OVERLAY_GEOMETRY' },
  );
  if (overlay.position !== undefined) {
    validateSphericalPosition(overlay.position, `${overlayPath}.position`, context, issues);
  }
  validateOverlayAppearance(overlay.appearance, overlayPath, context, issues);
  validateHotspotContent(overlay.content, overlayPath, context, project, assets, options, issues);
  validateHotspotAction(overlay.action, overlayPath, context, project, assets, options, issues);
}

function validateOverlayAppearance(
  value: unknown,
  overlayPath: string,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  const appearance = asRecord(value);
  const path = `${overlayPath}.appearance`;
  if (appearance === undefined) {
    issues.push(issue('INVALID_FIELD', 'Overlay appearance must be an object.', {
      ...context,
      path,
    }));
    return;
  }
  if (appearance.label !== undefined && typeof appearance.label !== 'string') {
    issues.push(issue('INVALID_FIELD', 'Overlay label must be a string.', {
      ...context,
      path: `${path}.label`,
    }));
  }
  validateOptionalColor(appearance.color, `${path}.color`, context, issues);
  if (appearance.fillOpacity !== undefined) {
    validateNumberRange(appearance.fillOpacity, 0, 1, `${path}.fillOpacity`, context, issues);
  }
  if (appearance.strokeWidth !== undefined) {
    validateNumberRange(appearance.strokeWidth, 0, 24, `${path}.strokeWidth`, context, issues);
  }
  if (appearance.emphasis !== undefined
    && !['normal', 'prominent', 'subtle'].includes(String(appearance.emphasis))) {
    issues.push(issue(
      'INVALID_FIELD',
      'Overlay emphasis must be normal, prominent, or subtle.',
      { ...context, path: `${path}.emphasis` },
    ));
  }
}

function validateHotspotAppearance(
  value: unknown,
  hotspotPath: string,
  context: IssueContext,
  project: UnknownRecord,
  assets: ReadonlyMap<string, UnknownRecord> | undefined,
  options: CanonicalValidationOptions,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    return;
  }
  const appearance = asRecord(value);
  if (appearance === undefined) {
    issues.push(issue(
      'INVALID_FIELD',
      'Hotspot appearance must be an object.',
      { ...context, path: `${hotspotPath}.appearance` },
    ));
    return;
  }
  if (appearance.label !== undefined && typeof appearance.label !== 'string') {
    issues.push(issue(
      'INVALID_FIELD',
      'Hotspot label must be a string.',
      { ...context, path: `${hotspotPath}.appearance.label` },
    ));
  }
  validateOptionalColor(appearance.color, `${hotspotPath}.appearance.color`, context, issues);
  if (appearance.emphasis !== undefined
    && !['normal', 'prominent', 'subtle'].includes(String(appearance.emphasis))) {
    issues.push(issue(
      'INVALID_FIELD',
      'Hotspot emphasis must be normal, prominent, or subtle.',
      { ...context, path: `${hotspotPath}.appearance.emphasis` },
    ));
  }
  if (appearance.iconAssetId !== undefined) {
    if (typeof appearance.iconAssetId !== 'string') {
      issues.push(issue(
        'INVALID_FIELD',
        'iconAssetId must be a string.',
        { ...context, path: `${hotspotPath}.appearance.iconAssetId` },
      ));
    } else {
      validateAssetReference(
        appearance.iconAssetId,
        ['image', 'logo'],
        `${hotspotPath}.appearance.iconAssetId`,
        context,
        project,
        assets,
        options,
        issues,
      );
    }
  }
}

function validateHotspotContent(
  value: unknown,
  hotspotPath: string,
  context: IssueContext,
  project: UnknownRecord,
  assets: ReadonlyMap<string, UnknownRecord> | undefined,
  options: CanonicalValidationOptions,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    return;
  }
  const content = asRecord(value);
  if (content === undefined) {
    issues.push(issue(
      'INVALID_FIELD',
      'Hotspot content must be an object.',
      { ...context, path: `${hotspotPath}.content` },
    ));
    return;
  }
  for (const key of [
    'title',
    'description',
    'bodyHtml',
    'tooltip',
    'buttonLabel',
    'externalUrl',
    'imageAssetId',
    'videoAssetId',
  ] as const) {
    if (content[key] !== undefined && typeof content[key] !== 'string') {
      issues.push(issue(
        'INVALID_FIELD',
        `${key} must be a string.`,
        { ...context, path: `${hotspotPath}.content.${key}` },
      ));
    }
  }
  if (content.externalUrl !== undefined) {
    const url = validateSafeUrl(content.externalUrl, { allowInternalRelative: true });
    if (!url.valid) {
      issues.push(issue(
        'INVALID_URL',
        url.message,
        { ...context, path: `${hotspotPath}.content.externalUrl` },
      ));
    }
  }
  if (typeof content.imageAssetId === 'string') {
    validateAssetReference(
      content.imageAssetId,
      ['panorama_image', 'image', 'logo'],
      `${hotspotPath}.content.imageAssetId`,
      context,
      project,
      assets,
      options,
      issues,
    );
  }
  if (typeof content.videoAssetId === 'string') {
    validateAssetReference(
      content.videoAssetId,
      ['video'],
      `${hotspotPath}.content.videoAssetId`,
      context,
      project,
      assets,
      options,
      issues,
    );
  }
}

function validateHotspotAction(
  value: unknown,
  hotspotPath: string,
  context: IssueContext,
  project: UnknownRecord,
  assets: ReadonlyMap<string, UnknownRecord> | undefined,
  options: CanonicalValidationOptions,
  issues: ValidationIssue[],
): void {
  const action = asRecord(value);
  const actionPath = `${hotspotPath}.action`;
  if (action === undefined || typeof action.kind !== 'string') {
    issues.push(issue(
      'INVALID_FIELD',
      'Hotspot action must declare a kind.',
      { ...context, path: actionPath },
    ));
    return;
  }

  switch (action.kind) {
    case 'none':
      return;
    case 'openUrl': {
      const url = validateSafeUrl(action.url, { allowInternalRelative: true });
      if (!url.valid) {
        issues.push(issue(
          'INVALID_URL',
          url.message,
          { ...context, path: `${actionPath}.url` },
        ));
      }
      return;
    }
    case 'goToScene':
      requireNonEmptyString(action.sceneId, `${actionPath}.sceneId`, context, issues, true);
      return;
    case 'showInformation':
      return;
    case 'openAsset': {
      requireNonEmptyString(action.assetId, `${actionPath}.assetId`, context, issues, true);
      if (typeof action.assetId === 'string') {
        validateAssetReference(
          action.assetId,
          ['panorama_image', 'image', 'logo'],
          `${actionPath}.assetId`,
          context,
          project,
          assets,
          options,
          issues,
        );
      }
      return;
    }
    default:
      issues.push(issue(
        'UNSUPPORTED_HOTSPOT_ACTION',
        'The hotspot action kind is not supported.',
        { ...context, path: `${actionPath}.kind` },
      ));
  }
}

function validateSceneReferences(
  project: UnknownRecord,
  sceneIds: ReadonlySet<string>,
  hotspotIds: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(project.scenes)) {
    return;
  }
  for (const [sceneIndex, sceneValue] of project.scenes.entries()) {
    const scene = asRecord(sceneValue);
    if (scene === undefined) {
      continue;
    }
    const sceneId = optionalEntityId(scene.id);
    const sceneContext: IssueContext = {
      entityType: 'scene',
      ...(sceneId === undefined ? {} : { entityId: sceneId }),
      path: `scenes[${sceneIndex}]`,
    };
    if (Array.isArray(scene.connections)) {
      for (const [connectionIndex, connectionValue] of scene.connections.entries()) {
        const connection = asRecord(connectionValue);
        if (connection !== undefined && typeof connection.targetSceneId === 'string'
          && !sceneIds.has(connection.targetSceneId)) {
          issues.push(issue(
            'REFERENCE_NOT_FOUND',
            'The connection target scene does not exist.',
            {
              ...sceneContext,
              path: `scenes[${sceneIndex}].connections[${connectionIndex}].targetSceneId`,
            },
          ));
        }
        if (connection !== undefined && typeof connection.triggerHotspotId === 'string'
          && !hotspotIds.has(connection.triggerHotspotId)) {
          issues.push(issue(
            'REFERENCE_NOT_FOUND',
            'The connection trigger hotspot does not exist.',
            {
              ...sceneContext,
              path: `scenes[${sceneIndex}].connections[${connectionIndex}].triggerHotspotId`,
            },
          ));
        }
      }
    }
    const runtimeHints = asRecord(scene.runtimeHints);
    if (Array.isArray(runtimeHints?.likelyNextSceneIds)) {
      for (const [hintIndex, targetId] of runtimeHints.likelyNextSceneIds.entries()) {
        if (typeof targetId === 'string' && !sceneIds.has(targetId)) {
          issues.push(issue(
            'REFERENCE_NOT_FOUND',
            'The suggested next scene does not exist.',
            {
              ...sceneContext,
              path: `scenes[${sceneIndex}].runtimeHints.likelyNextSceneIds[${hintIndex}]`,
            },
          ));
        }
      }
    }
    if (!Array.isArray(scene.hotspots)) {
      continue;
    }
    for (const [hotspotIndex, hotspotValue] of scene.hotspots.entries()) {
      const hotspot = asRecord(hotspotValue);
      const action = hotspot === undefined ? undefined : asRecord(hotspot.action);
      if (action?.kind === 'goToScene' && typeof action.sceneId === 'string'
        && !sceneIds.has(action.sceneId)) {
        const hotspotId = optionalEntityId(hotspot?.id);
        issues.push(issue(
          'REFERENCE_NOT_FOUND',
          'The hotspot target scene does not exist.',
          {
            entityType: 'hotspot',
            ...(hotspotId === undefined ? {} : { entityId: hotspotId }),
            path: `scenes[${sceneIndex}].hotspots[${hotspotIndex}].action.sceneId`,
          },
        ));
      }
    }
  }
}

function validateAssetReference(
  assetId: string,
  expectedMediaTypes: readonly CanonicalAssetMediaType[],
  path: string,
  context: IssueContext,
  project: UnknownRecord,
  assets: ReadonlyMap<string, UnknownRecord> | undefined,
  options: CanonicalValidationOptions,
  issues: ValidationIssue[],
): void {
  if (assets === undefined) {
    return;
  }
  const asset = assets.get(assetId);
  if (asset === undefined) {
    issues.push(issue(
      'REFERENCE_NOT_FOUND',
      'The referenced asset does not exist.',
      { ...context, path },
    ));
    return;
  }
  if (typeof project.ownerId === 'string' && asset.ownerId !== project.ownerId) {
    issues.push(issue(
      'REFERENCE_FORBIDDEN',
      'The referenced asset is not owned by this project owner.',
      { ...context, path },
    ));
  }
  if (typeof project.id === 'string' && typeof asset.projectId === 'string'
    && asset.projectId !== project.id) {
    issues.push(issue(
      'REFERENCE_FORBIDDEN',
      'The referenced asset belongs to another project.',
      { ...context, path },
    ));
  }
  if (typeof asset.mediaType !== 'string'
    || !expectedMediaTypes.includes(asset.mediaType as CanonicalAssetMediaType)) {
    issues.push(issue(
      'ASSET_MEDIA_TYPE_MISMATCH',
      `The referenced asset must be one of: ${expectedMediaTypes.join(', ')}.`,
      { ...context, path },
    ));
  }
  if ((options.requireReadyAssets ?? true) && asset.processingStatus !== 'ready') {
    const failed = asset.processingStatus === 'failed';
    issues.push(issue(
      failed ? 'ASSET_PROCESSING_FAILED' : 'ASSET_NOT_READY',
      failed
        ? 'The referenced asset failed processing.'
        : 'The referenced asset is still processing.',
      { ...context, path },
      failed ? readRetryable(asset.processingError) : true,
    ));
  }
}

function buildAssetIndex(
  values: readonly unknown[] | undefined,
  issues: ValidationIssue[],
): ReadonlyMap<string, UnknownRecord> | undefined {
  if (values === undefined) {
    return undefined;
  }
  const result = new Map<string, UnknownRecord>();
  for (const [index, value] of values.entries()) {
    const validation = validateCanonicalAsset(value);
    for (const assetIssue of validation.issues) {
      issues.push({
        ...assetIssue,
        path: `assets[${index}]${assetIssue.path.length === 0 ? '' : `.${assetIssue.path}`}`,
      });
    }
    const asset = asRecord(value);
    const assetId = optionalEntityId(asset?.id);
    if (asset === undefined || assetId === undefined) {
      continue;
    }
    if (result.has(assetId)) {
      issues.push(issue(
        'DUPLICATE_ENTITY_ID',
        'Asset IDs must be unique in compiler input.',
        { entityType: 'asset', entityId: assetId, path: `assets[${index}].id` },
      ));
      continue;
    }
    result.set(assetId, asset);
  }
  return result;
}

function validateDerivative(
  value: unknown,
  path: string,
  context: IssueContext,
  identities: Set<string>,
  issues: ValidationIssue[],
): void {
  const derivative = asRecord(value);
  if (derivative === undefined) {
    issues.push(issue('INVALID_FIELD', 'Derivative must be an object.', { ...context, path }));
    return;
  }
  requireNonEmptyString(derivative.id, `${path}.id`, context, issues, true);
  requireNonEmptyString(derivative.assetId, `${path}.assetId`, context, issues, true);
  requireNonEmptyString(derivative.storageKey, `${path}.storageKey`, context, issues, true);
  requireNonEmptyString(derivative.mimeType, `${path}.mimeType`, context, issues, true);
  if (typeof derivative.kind !== 'string' || !ASSET_DERIVATIVE_KINDS.includes(
    derivative.kind as (typeof ASSET_DERIVATIVE_KINDS)[number],
  )) {
    issues.push(issue('INVALID_FIELD', 'Derivative kind is not supported.', {
      ...context,
      path: `${path}.kind`,
    }));
  }
  if (!isPositiveInteger(derivative.version)) {
    issues.push(issue('INVALID_FIELD', 'Derivative version must be a positive integer.', {
      ...context,
      path: `${path}.version`,
    }));
  }
  if (typeof derivative.kind === 'string' && typeof derivative.version === 'number') {
    const identity = `${derivative.kind}:${derivative.version}`;
    if (identities.has(identity)) {
      issues.push(issue(
        'DUPLICATE_ENTITY_ID',
        'Derivative kind and version must be unique for an asset.',
        { ...context, path },
      ));
    }
    identities.add(identity);
  }
}

function validateSphericalPosition(
  value: unknown,
  path: string,
  context: IssueContext,
  issues: ValidationIssue[],
  optional = false,
): void {
  if (value === undefined && optional) {
    return;
  }
  const position = asRecord(value);
  if (position === undefined || position.coordinateSystem !== 'spherical_degrees') {
    issues.push(issue(
      'INVALID_FIELD',
      'Position must use the spherical product coordinate space.',
      { ...context, path },
    ));
    return;
  }
  validateNumberRange(
    position.longitudeDegrees,
    -180,
    180,
    `${path}.longitudeDegrees`,
    context,
    issues,
  );
  validateNumberRange(
    position.latitudeDegrees,
    -90,
    90,
    `${path}.latitudeDegrees`,
    context,
    issues,
  );
}

function validateInitialView(
  value: unknown,
  path: string,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    return;
  }
  const initialView = asRecord(value);
  if (initialView === undefined) {
    issues.push(issue('INVALID_FIELD', 'initialView must be an object.', { ...context, path }));
    return;
  }
  for (const [key, min, max] of [
    ['headingDegrees', -180, 180],
    ['pitchDegrees', -90, 90],
    ['horizontalFovDegrees', 30, 120],
  ] as const) {
    if (initialView[key] !== undefined) {
      validateNumberRange(initialView[key], min, max, `${path}.${key}`, context, issues);
    }
  }
}

function validateViewLimits(
  value: unknown,
  path: string,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    return;
  }
  const limits = asRecord(value);
  if (limits === undefined) {
    issues.push(issue('INVALID_FIELD', 'viewLimits must be an object.', { ...context, path }));
    return;
  }
  const definitions = [
    ['minHeadingDegrees', -180, 180],
    ['maxHeadingDegrees', -180, 180],
    ['minPitchDegrees', -90, 90],
    ['maxPitchDegrees', -90, 90],
  ] as const;
  for (const [key, min, max] of definitions) {
    if (limits[key] !== undefined) {
      validateNumberRange(limits[key], min, max, `${path}.${key}`, context, issues);
    }
  }
  for (const [minKey, maxKey] of [
    ['minHeadingDegrees', 'maxHeadingDegrees'],
    ['minPitchDegrees', 'maxPitchDegrees'],
  ] as const) {
    if (typeof limits[minKey] === 'number' && typeof limits[maxKey] === 'number'
      && limits[minKey] > limits[maxKey]) {
      issues.push(issue(
        'INVALID_FIELD',
        `${minKey} cannot be greater than ${maxKey}.`,
        { ...context, path: `${path}.${minKey}` },
      ));
    }
  }
}

function validateNumberRange(
  value: unknown,
  min: number,
  max: number,
  path: string,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    issues.push(issue(
      'INVALID_FIELD',
      `Value must be a finite number between ${min} and ${max}.`,
      { ...context, path },
    ));
  }
}

function validateOptionalColor(
  value: unknown,
  path: string,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  if (value !== undefined && (typeof value !== 'string' || !colorPattern.test(value))) {
    issues.push(issue(
      'INVALID_FIELD',
      'Color must be a 6-digit hexadecimal value.',
      withPath(context, path),
    ));
  }
}

function validateBooleanObject(
  value: unknown,
  keys: readonly string[],
  path: string,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  if (value === undefined) {
    return;
  }
  const record = asRecord(value);
  if (record === undefined) {
    issues.push(issue('INVALID_FIELD', `${path} must be an object.`, withPath(context, path)));
    return;
  }
  for (const key of keys) {
    if (record[key] !== undefined && typeof record[key] !== 'boolean') {
      issues.push(issue(
        'INVALID_FIELD',
        `${key} must be a boolean.`,
        withPath(context, `${path}.${key}`),
      ));
    }
  }
}

function scanForRendererConfiguration(
  value: unknown,
  context: IssueContext,
  issues: ValidationIssue[],
): void {
  const visited = new WeakSet<object>();
  const visit = (current: unknown, path: string): void => {
    if (typeof current !== 'object' || current === null || visited.has(current)) {
      return;
    }
    visited.add(current);
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, nested] of Object.entries(current as UnknownRecord)) {
      const nestedPath = path.length === 0 ? key : `${path}.${key}`;
      if (forbiddenRendererKeys.has(key.toLowerCase())) {
        issues.push(issue(
          'RENDERER_CONFIG_FORBIDDEN',
          'Renderer-specific configuration is not allowed in the canonical project.',
          { ...context, path: nestedPath },
        ));
      }
      visit(nested, nestedPath);
    }
  };
  visit(value, '');
}

function requireNonEmptyString(
  value: unknown,
  path: string,
  context: IssueContext,
  issues: ValidationIssue[],
  absolutePath = false,
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(issue(
      'REQUIRED_FIELD',
      'A non-empty string is required.',
      absolutePath ? { ...context, path } : withPath(context, path),
    ));
  }
}

function readRetryable(value: unknown): boolean {
  const error = asRecord(value);
  return error?.retryable === true;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function optionalEntityId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function withPath(context: IssueContext, path: string): IssueContext {
  return { ...context, path };
}

function issue(
  code: CanonicalValidationCode | string,
  message: string,
  context: IssueContext,
  retryable = false,
): ValidationIssue {
  return Object.freeze({
    code,
    message,
    entityType: context.entityType,
    ...(context.entityId === undefined ? {} : { entityId: context.entityId }),
    path: context.path,
    retryable,
  });
}

function result(issues: readonly ValidationIssue[]): CanonicalValidationResult {
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze([...issues]) });
}

export class CanonicalValidationError extends Error {
  readonly code = 'CANONICAL_VALIDATION_FAILED';
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super('The canonical Experience contains validation errors.');
    this.name = 'CanonicalValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

export function assertCanonicalProject(
  value: unknown,
  options: CanonicalValidationOptions = {},
): asserts value is CanonicalProject {
  const validation = validateCanonicalProject(value, options);
  if (!validation.valid) {
    throw new CanonicalValidationError(validation.issues);
  }
}

/** Exposes the structural asset type for adapter/repository mapping helpers. */
export function asCanonicalAsset(value: unknown): CanonicalAsset {
  const validation = validateCanonicalAsset(value);
  if (!validation.valid) {
    throw new CanonicalValidationError(validation.issues);
  }
  return value as CanonicalAsset;
}
