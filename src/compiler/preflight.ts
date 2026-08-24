import { validateCanonicalProject } from '../domain/validation';
import type { ValidationIssue } from '../domain/validation';
import type { CanonicalAsset } from '../domain/types';
import {
  selectPanoramaDerivatives,
  selectPreferredReadyDerivative,
} from './derivative-selector';
import type { CompileExperienceInput } from './types';
import { readPanoramaCrop } from './panorama-metadata';

export interface CompilerPreflightResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export function preflightExperience(input: CompileExperienceInput): CompilerPreflightResult {
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

  for (const [sceneIndex, scene] of input.project.scenes.entries()) {
    for (const [field, value] of [
      ['overlays', scene.overlays ?? []],
      ['connections', scene.connections ?? []],
      ['spatialData', scene.spatialData ?? {}],
      ['runtimeHints', scene.runtimeHints ?? {}],
      ['viewLimits', scene.viewLimits ?? {}],
    ] as const) {
      if (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0) {
        issues.push({
          code: 'CAPABILITY_UNSUPPORTED',
          message: `${field} is persisted for forward compatibility but is not supported by Sprint 01 runtime compilation.`,
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
          message: 'Sprint 01 supports equirectangular panoramas only.',
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
      if (hotspot.action.kind === 'goToScene' || hotspot.action.kind === 'openAsset') {
        issues.push({
          code: 'CAPABILITY_UNSUPPORTED',
          message: 'Sprint 01 runtime supports information and safe-link hotspot actions only.',
          entityType: 'hotspot',
          entityId: hotspot.id,
          path: `${path}.action.kind`,
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
    }
  }

  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
  });
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
  if (selectPreferredReadyDerivative(asset) === undefined) {
    issues.push({
      code: 'REQUIRED_DERIVATIVE_MISSING',
      message: 'The referenced image requires a ready web derivative.',
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
