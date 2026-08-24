import { resolveCapabilities, type CapabilityResolutionResult } from '../capabilities';
import { validateCanonicalProject } from '../domain/validation';
import { validateSafeUrl } from '../security/url-validator';
import type { ValidationIssue } from '../domain/validation';
import type { CanonicalAsset, CanonicalProject } from '../domain/types';
import {
  selectPanoramaDerivatives,
  selectPreferredReadyDerivative,
} from './derivative-selector';
import type { CompileExperienceInput } from './types';
import { readPanoramaCrop } from './panorama-metadata';
import { readTiledPanoramaMetadata } from './tiled-panorama';
import { analyzeProjectCapabilities } from './capability-analysis';
import { hasPublishableVideoProfile } from './video-derivative-selector';

export interface CompilerPreflightResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
  readonly capabilityResolution: CapabilityResolutionResult;
}

export function preflightExperience(input: CompileExperienceInput): CompilerPreflightResult {
  return input.project.type === 'video360'
    ? preflightVideoExperience(input)
    : preflightImageExperience(input);
}

function preflightImageExperience(input: CompileExperienceInput): CompilerPreflightResult {
  const validation = validateCanonicalProject(input.project, {
    assets: input.assets,
    requireReadyAssets: true,
    supportedProjectTypes: ['image360'],
  });
  const optionalBrandingFailures = new Set([
    'REFERENCE_NOT_FOUND',
    'ASSET_NOT_READY',
    'ASSET_PROCESSING_FAILED',
    'ASSET_MEDIA_TYPE_MISMATCH',
  ]);
  const issues: ValidationIssue[] = validation.issues.filter((issue) => !(
    issue.entityType === 'branding' && optionalBrandingFailures.has(issue.code)
  ));
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));

  if (input.target === 'publication'
    && (!Number.isInteger(input.publicationRevision) || (input.publicationRevision ?? 0) < 1)) {
    issues.push(projectIssue(
      input.project.id,
      'INVALID_FIELD',
      'publicationRevision must be a positive integer for publication compilation.',
      'publicationRevision',
    ));
  }
  if (input.target === 'publication'
    && (input.publicationSlug === undefined
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.publicationSlug))) {
    issues.push(projectIssue(
      input.project.id,
      'INVALID_FIELD',
      'publicationSlug must be a valid publication slug.',
      'publicationSlug',
    ));
  }

  for (const [sceneIndex, scene] of input.project.scenes.entries()) {
    for (const [field, value] of [
      ['overlays', scene.overlays ?? []],
      ['spatialData', scene.spatialData ?? {}],
    ] as const) {
      if (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0) {
        issues.push({
          code: 'CAPABILITY_UNSUPPORTED',
          message: `${field} is reserved for a later experience capability.`,
          entityType: 'scene',
          entityId: scene.id,
          path: `scenes[${sceneIndex}].${field}`,
          retryable: false,
        });
      }
    }
    const panorama = scene.panoramaAssetId === null
      ? undefined
      : assetsById.get(scene.panoramaAssetId);
    if (panorama !== undefined && panorama.processingStatus === 'ready') {
      if (panorama.projection !== 'equirectangular'
        && panorama.projection !== 'cropped_equirectangular') {
        issues.push({
          code: 'UNSUPPORTED_PANORAMA_PROJECTION',
          message: 'This release supports equirectangular panoramas only.',
          entityType: 'scene',
          entityId: scene.id,
          path: `scenes[${sceneIndex}].panoramaAssetId`,
          retryable: false,
        });
      }
      if (panorama.projection === 'cropped_equirectangular' && readPanoramaCrop(panorama) === undefined) {
        issues.push({
          code: 'INVALID_PANORAMA_CROP_METADATA',
          message: 'The cropped panorama requires valid GPano crop geometry.',
          entityType: 'asset',
          entityId: panorama.id,
          path: `assets.${panorama.id}.metadata.xmp`,
          retryable: false,
        });
      }
      if (selectPanoramaDerivatives(panorama) === undefined) {
        issues.push({
          code: 'REQUIRED_DERIVATIVE_MISSING',
          message: 'The panorama requires ready low-resolution and standard-web derivatives.',
          entityType: 'scene',
          entityId: scene.id,
          path: `scenes[${sceneIndex}].panoramaAssetId`,
          retryable: true,
        });
      }
      const tiled = selectPanoramaDerivatives(panorama)?.tiledLevels;
      if (tiled !== undefined && readTiledPanoramaMetadata(tiled) === undefined) {
        issues.push({
          code: 'TILED_DERIVATIVE_INVALID',
          message: 'The optimized high-quality panorama metadata is incomplete.',
          entityType: 'asset',
          entityId: panorama.id,
          path: `assets.${panorama.id}.derivatives.${tiled.id}`,
          retryable: true,
        });
      }
    }

    for (const [hotspotIndex, hotspot] of scene.hotspots.entries()) {
      const path = `scenes[${sceneIndex}].hotspots[${hotspotIndex}]`;
      if (hotspot.geometry.kind !== 'point') {
        issues.push({
          code: 'CAPABILITY_UNSUPPORTED',
          message: 'Sprint 01 compilation supports point hotspots only.',
          entityType: 'hotspot',
          entityId: hotspot.id,
          path: `${path}.geometry.kind`,
          retryable: false,
        });
      }
      const referencedImages = [
        hotspot.appearance?.iconAssetId,
        hotspot.content?.imageAssetId,
        hotspot.action.kind === 'openAsset' ? hotspot.action.assetId : undefined,
      ];
      for (const referencedId of referencedImages) {
        if (referencedId !== undefined) {
          requireDisplayDerivative(referencedId, path, hotspot.id, assetsById, issues);
        }
      }
      if (hotspot.content?.videoAssetId !== undefined) {
        requireDisplayDerivative(
          hotspot.content.videoAssetId,
          `${path}.content.videoAssetId`,
          hotspot.id,
          assetsById,
          issues,
        );
      }
    }
  }

  const capabilityResolution = resolveCapabilities(
    analyzeProjectCapabilities(input.project, input.assets),
  );
  issues.push(...capabilityResolution.issues.map((capabilityIssue): ValidationIssue => ({
    code: capabilityIssue.code,
    severity: capabilityIssue.severity,
    message: capabilityIssue.message,
    entityType: validationEntityType(capabilityIssue.path),
    entityId: capabilityIssue.entityId,
    path: capabilityIssue.path,
    retryable: ['CONTENT_ASSET_NOT_READY', 'FEATURE_MEDIA_REQUIRED'].includes(capabilityIssue.code),
    alternatives: capabilityIssue.alternatives,
  })));

  return Object.freeze({
    valid: issues.every((issue) => issue.severity === 'warning'),
    issues: Object.freeze(issues),
    capabilityResolution,
  });
}

/**
 * A video360 experience validates its single logical video, the timeline, and
 * the capability graph. It deliberately does not run the scene/tour rules.
 */
function preflightVideoExperience(input: CompileExperienceInput): CompilerPreflightResult {
  const project = input.project;
  const issues: ValidationIssue[] = [];
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));

  if (project.schemaVersion !== 1) {
    issues.push(projectIssue(
      project.id,
      'UNSUPPORTED_SCHEMA_VERSION',
      'schemaVersion must be 1.',
      'schemaVersion',
    ));
  }
  if (!Number.isInteger(project.revision) || project.revision < 1) {
    issues.push(projectIssue(project.id, 'INVALID_FIELD', 'revision must be a positive integer.', 'revision'));
  }
  if (project.scenes.length > 0) {
    issues.push(projectIssue(
      project.id,
      'CAPABILITY_UNSUPPORTED',
      'A 360 video experience cannot contain panorama scenes.',
      'scenes',
    ));
  }
  if (input.target === 'publication'
    && (!Number.isInteger(input.publicationRevision) || (input.publicationRevision ?? 0) < 1)) {
    issues.push(projectIssue(
      project.id,
      'INVALID_FIELD',
      'publicationRevision must be a positive integer for publication compilation.',
      'publicationRevision',
    ));
  }
  if (input.target === 'publication'
    && (input.publicationSlug === undefined
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.publicationSlug))) {
    issues.push(projectIssue(
      project.id,
      'INVALID_FIELD',
      'publicationSlug must be a valid publication slug.',
      'publicationSlug',
    ));
  }

  const videoAssetId = project.videoAssetId ?? null;
  const videoAsset = videoAssetId === null ? undefined : assetsById.get(videoAssetId);
  if (videoAssetId === null) {
    issues.push(projectIssue(
      project.id,
      'REQUIRED_FIELD',
      'A 360 video experience requires a video.',
      'videoAssetId',
    ));
  } else if (videoAsset === undefined) {
    issues.push(projectIssue(
      project.id,
      'REFERENCE_NOT_FOUND',
      'The referenced 360 video does not exist.',
      'videoAssetId',
    ));
  } else {
    if (videoAsset.ownerId !== project.ownerId) {
      issues.push(projectIssue(
        project.id,
        'REFERENCE_FORBIDDEN',
        'The referenced 360 video is not owned by this project owner.',
        'videoAssetId',
      ));
    }
    if (videoAsset.mediaType !== 'video360') {
      issues.push(projectIssue(
        project.id,
        'ASSET_MEDIA_TYPE_MISMATCH',
        'The referenced asset must be a 360 video.',
        'videoAssetId',
      ));
    }
    if (videoAsset.processingStatus !== 'ready') {
      issues.push({
        code: videoAsset.processingStatus === 'failed'
          ? 'VIDEO_ASSET_PROCESSING_FAILED'
          : 'VIDEO_ASSET_NOT_READY',
        message: videoAsset.processingStatus === 'failed'
          ? 'The 360 video failed processing.'
          : 'The 360 video is still being prepared.',
        entityType: 'project',
        entityId: project.id,
        path: 'videoAssetId',
        retryable: videoAsset.processingStatus !== 'failed',
      });
    } else if (!hasPublishableVideoProfile(videoAsset)) {
      issues.push({
        code: 'VIDEO_PROFILE_UNAVAILABLE',
        message: 'The 360 video has no compatible playback profile.',
        entityType: 'asset',
        entityId: videoAsset.id,
        path: 'videoAssetId',
        retryable: true,
      });
    }
  }

  const durationMs = typeof videoAsset?.metadata?.durationMs === 'number'
    ? videoAsset.metadata.durationMs
    : undefined;
  const timeline = project.timeline ?? [];
  if (timeline.length > 0 && durationMs === undefined) {
    issues.push({
      code: 'VIDEO_DURATION_UNKNOWN',
      message: 'The 360 video duration is not available yet.',
      entityType: 'project',
      entityId: project.id,
      path: 'timeline',
      retryable: true,
    });
  }

  const interactionIds = new Set<string>();
  for (const [index, interaction] of timeline.entries()) {
    const path = `timeline[${index}]`;
    if (interactionIds.has(interaction.id)) {
      issues.push({
        code: 'DUPLICATE_ENTITY_ID',
        message: 'Timeline interaction IDs must be unique within a project.',
        entityType: 'project',
        entityId: interaction.id,
        path: `${path}.id`,
        retryable: false,
      });
    }
    interactionIds.add(interaction.id);

    if (!Number.isFinite(interaction.timeMs) || interaction.timeMs < 0
      || (durationMs !== undefined && interaction.timeMs > durationMs)) {
      issues.push({
        code: 'TIMELINE_TIME_OUT_OF_RANGE',
        message: 'The interaction time is outside the video.',
        entityType: 'project',
        entityId: interaction.id,
        path: `${path}.timeMs`,
        retryable: false,
      });
    }
    const endTimeMs = interaction.endTimeMs;
    if (typeof endTimeMs === 'number'
      && (endTimeMs < interaction.timeMs
        || (durationMs !== undefined && endTimeMs > durationMs))) {
      issues.push({
        code: 'TIMELINE_TIME_OUT_OF_RANGE',
        message: 'The interaction end time is outside the video.',
        entityType: 'project',
        entityId: interaction.id,
        path: `${path}.endTimeMs`,
        retryable: false,
      });
    }
    if (interaction.geometry !== undefined && interaction.geometry.kind !== 'point') {
      issues.push({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Timed interactions support point placement only.',
        entityType: 'project',
        entityId: interaction.id,
        path: `${path}.geometry.kind`,
        retryable: false,
      });
    }
    for (const [field, url] of [
      ['content.externalUrl', interaction.content?.externalUrl],
      ['content.ctaUrl', interaction.content?.ctaUrl],
      ['action.url', interaction.action.kind === 'openUrl' ? interaction.action.url : undefined],
    ] as const) {
      if (url === undefined) continue;
      const validated = validateSafeUrl(url, { allowInternalRelative: true });
      if (!validated.valid) {
        issues.push({
          code: 'INVALID_URL',
          message: validated.message,
          entityType: 'project',
          entityId: interaction.id,
          path: `${path}.${field}`,
          retryable: false,
        });
      }
    }
    for (const [field, assetId] of [
      ['content.imageAssetId', interaction.content?.imageAssetId],
      ['content.videoAssetId', interaction.content?.videoAssetId],
      ['appearance.iconAssetId', interaction.appearance?.iconAssetId],
      ['action.assetId', interaction.action.kind === 'openAsset' ? interaction.action.assetId : undefined],
    ] as const) {
      if (assetId === undefined) continue;
      const referenced = assetsById.get(assetId);
      if (referenced === undefined) {
        issues.push({
          code: 'TIMELINE_REFERENCE_INVALID',
          message: 'The referenced media does not exist.',
          entityType: 'project',
          entityId: interaction.id,
          path: `${path}.${field}`,
          retryable: false,
        });
        continue;
      }
      if (referenced.processingStatus !== 'ready') {
        issues.push({
          code: 'TIMELINE_REFERENCE_INVALID',
          message: 'The referenced media is not ready.',
          entityType: 'project',
          entityId: interaction.id,
          path: `${path}.${field}`,
          retryable: referenced.processingStatus !== 'failed',
        });
        continue;
      }
      requireDisplayDerivative(
        assetId,
        `${path}.${field}`,
        interaction.id,
        assetsById,
        issues,
        'project',
      );
    }
  }

  scanVideoProjectForRendererConfiguration(project, issues);

  const capabilityResolution = resolveCapabilities(
    analyzeProjectCapabilities(project, input.assets),
  );
  issues.push(...capabilityResolution.issues.map((capabilityIssue): ValidationIssue => ({
    code: capabilityIssue.code,
    severity: capabilityIssue.severity,
    message: capabilityIssue.message,
    entityType: 'project',
    entityId: capabilityIssue.entityId,
    path: capabilityIssue.path,
    retryable: ['CONTENT_ASSET_NOT_READY', 'FEATURE_MEDIA_REQUIRED'].includes(capabilityIssue.code),
    alternatives: capabilityIssue.alternatives,
  })));

  return Object.freeze({
    valid: issues.every((issue) => issue.severity === 'warning'),
    issues: Object.freeze(issues),
    capabilityResolution,
  });
}

const FORBIDDEN_RENDERER_KEYS = new Set([
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

function scanVideoProjectForRendererConfiguration(
  project: CanonicalProject,
  issues: ValidationIssue[],
): void {
  const visited = new WeakSet<object>();
  const visit = (value: unknown, path: string): void => {
    if (typeof value !== 'object' || value === null || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nestedPath = path.length === 0 ? key : `${path}.${key}`;
      if (FORBIDDEN_RENDERER_KEYS.has(key.toLowerCase())) {
        issues.push(projectIssue(
          project.id,
          'RENDERER_CONFIG_FORBIDDEN',
          'Renderer-specific configuration is not allowed in the canonical project.',
          nestedPath,
        ));
      }
      visit(nested, nestedPath);
    }
  };
  visit({ settings: project.settings, branding: project.branding, timeline: project.timeline ?? [] }, '');
}

function validationEntityType(path: string): ValidationIssue['entityType'] {
  if (path.includes('.hotspots') || path.startsWith('hotspots')) return 'hotspot';
  if (path.startsWith('scenes')) return 'scene';
  if (path.startsWith('assets')) return 'asset';
  if (path.startsWith('branding')) return 'branding';
  return 'project';
}

function requireDisplayDerivative(
  assetId: string,
  path: string,
  entityId: string,
  assetsById: ReadonlyMap<string, CanonicalAsset>,
  issues: ValidationIssue[],
  entityType: ValidationIssue['entityType'] = 'hotspot',
): void {
  const asset = assetsById.get(assetId);
  if (asset === undefined || asset.processingStatus !== 'ready') {
    return;
  }
  const isVideo = asset.mediaType === 'video' || asset.mediaType === 'video360';
  const derivative = selectPreferredReadyDerivative(
    asset,
    isVideo ? ['mobileVideoProfile', 'desktopVideoProfile'] : undefined,
  );
  if (derivative === undefined) {
    issues.push({
      code: 'REQUIRED_DERIVATIVE_MISSING',
      message: isVideo
        ? 'The referenced video requires a ready playback derivative.'
        : 'The referenced image requires a ready web derivative.',
      entityType,
      entityId,
      path,
      retryable: true,
    });
  }
}

function projectIssue(
  projectId: string,
  code: string,
  message: string,
  path: string,
): ValidationIssue {
  return {
    code,
    message,
    entityType: 'project',
    entityId: projectId,
    path,
    retryable: false,
  };
}
