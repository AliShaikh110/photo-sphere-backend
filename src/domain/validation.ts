import { validateSafeUrl } from '../security/url-validator';
import { ASSET_PROCESSING_STATUSES } from './asset-processing';
import {
  ASSET_DERIVATIVE_KINDS,
  ASSET_MEDIA_TYPES,
  ASSET_PROJECTIONS,
  CURRENT_EXPERIENCE_SCHEMA_VERSION,
  PROJECT_TYPES,
} from './types';
import type {
  CanonicalAsset,
  CanonicalAssetMediaType,
  CanonicalProject,
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
  'RENDERER_CONFIG_FORBIDDEN',
] as const;

export type CanonicalValidationCode = (typeof CANONICAL_VALIDATION_CODES)[number];
export type ValidationEntityType = 'project' | 'scene' | 'hotspot' | 'asset' | 'branding';

export interface ValidationIssue {
  readonly code: CanonicalValidationCode | string;
  readonly message: string;
  readonly entityType: ValidationEntityType;
  readonly entityId?: string;
  readonly path: string;
  readonly retryable: boolean;
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

  const sceneIds = new Set<string>();
  const hotspotIds = new Set<string>();
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
    validateConnections(scene.connections, scenePath, sceneContext, issues);

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

  validateSceneReferences(project, sceneIds, issues);
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
    ['mouse', 'touch', 'zoom', 'keyboard', 'fullscreen', 'navigationButtons'],
    'settings.navigation',
    projectContext,
    issues,
  );

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
  scenePath: string,
  context: IssueContext,
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
    if (connection.id !== undefined) {
      requireNonEmptyString(connection.id, `${path}.id`, context, issues, true);
    }
    if (connection.targetSceneId !== undefined) {
      requireNonEmptyString(
        connection.targetSceneId,
        `${path}.targetSceneId`,
        context,
        issues,
        true,
      );
    }
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

  const geometry = asRecord(hotspot.geometry);
  if (geometry === undefined || typeof geometry.kind !== 'string') {
    issues.push(issue(
      'INVALID_FIELD',
      'Hotspot geometry must declare a kind.',
      { ...context, path: `${hotspotPath}.geometry` },
    ));
  } else if (!['point', 'polygon', 'polyline', 'layer'].includes(geometry.kind)) {
    issues.push(issue(
      'UNSUPPORTED_HOTSPOT_GEOMETRY',
      'The hotspot geometry kind is not supported.',
      { ...context, path: `${hotspotPath}.geometry.kind` },
    ));
  } else if ((geometry.kind === 'polygon' || geometry.kind === 'polyline')) {
    if (!Array.isArray(geometry.vertices)) {
      issues.push(issue(
        'INVALID_FIELD',
        'Polygon and polyline geometry requires vertices.',
        { ...context, path: `${hotspotPath}.geometry.vertices` },
      ));
    } else {
      for (const [index, vertex] of geometry.vertices.entries()) {
        validateSphericalPosition(
          vertex,
          `${hotspotPath}.geometry.vertices[${index}]`,
          context,
          issues,
        );
      }
    }
  } else if (geometry.kind === 'layer') {
    requireNonEmptyString(
      geometry.layerAssetId,
      `${hotspotPath}.geometry.layerAssetId`,
      context,
      issues,
      true,
    );
  }

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
