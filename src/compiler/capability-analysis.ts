import type {
  CapabilityAssetReference,
  CapabilityId,
  CapabilityResolutionInput,
  MediaRequirement,
} from '../capabilities/types';
import type { CanonicalAsset, CanonicalProject } from '../domain/types';
import { selectPanoramaDerivatives } from './derivative-selector';
import { hasPublishableVideoProfile } from './video-derivative-selector';

export function analyzeProjectCapabilities(
  project: CanonicalProject,
  assets: readonly CanonicalAsset[],
): CapabilityResolutionInput {
  return project.type === 'video360'
    ? analyzeVideoProjectCapabilities(project, assets)
    : analyzeImageProjectCapabilities(project, assets);
}

/**
 * A video360 experience is one video plus timed interactions; it never
 * requests panorama or tour capabilities.
 */
export function analyzeVideoProjectCapabilities(
  project: CanonicalProject,
  assets: readonly CanonicalAsset[],
): CapabilityResolutionInput {
  const requested = new Set<CapabilityId>(['video360']);
  const references: CapabilityAssetReference[] = [];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const videoAsset = project.videoAssetId === null || project.videoAssetId === undefined
    ? undefined
    : assetsById.get(project.videoAssetId);
  const videoAssetId = project.videoAssetId ?? `missing-video:${project.id}`;
  const durationMs = readNumber(videoAsset?.metadata?.durationMs);
  const playbackReady = videoAsset !== undefined && hasPublishableVideoProfile(videoAsset);

  references.push(assetReference({
    assetId: videoAssetId,
    capabilityId: 'video360',
    requirement: 'ready-video360-source',
    asset: videoAsset,
    entityId: project.id,
    path: 'videoAssetId',
  }));
  references.push(assetReference({
    assetId: videoAssetId,
    capabilityId: 'video360',
    requirement: 'ready-video360-playback-profile',
    asset: videoAsset,
    derivativeReady: playbackReady,
    entityId: project.id,
    path: 'videoAssetId',
  }));

  const timeline = project.timeline ?? [];
  if (timeline.length > 0) {
    requested.add('videoTimeline');
    references.push(assetReference({
      assetId: videoAssetId,
      capabilityId: 'videoTimeline',
      requirement: 'known-video-duration',
      asset: videoAsset,
      derivativeReady: durationMs !== undefined && durationMs > 0,
      entityId: project.id,
      path: 'timeline',
    }));
  }

  for (const [index, interaction] of timeline.entries()) {
    const path = `timeline[${index}]`;
    if (interaction.kind === 'hotspot') requested.add('timedHotspots');
    if (interaction.kind === 'viewpoint') requested.add('timedViewpoint');
    if (interaction.kind === 'cta') requested.add('cta');
    if (interaction.kind === 'link'
      || interaction.action.kind === 'openUrl'
      || interaction.content?.externalUrl !== undefined
      || interaction.content?.ctaUrl !== undefined) {
      requested.add('externalLink');
    }

    const imageAssetIds = [
      interaction.content?.imageAssetId,
      interaction.action.kind === 'openAsset' ? interaction.action.assetId : undefined,
    ].filter((assetId): assetId is string => assetId !== undefined);
    for (const assetId of imageAssetIds) {
      const asset = assetsById.get(assetId);
      const capabilityId: CapabilityId = asset?.mediaType === 'video' || asset?.mediaType === 'video360'
        ? 'videoContent'
        : 'imageContent';
      requested.add(capabilityId);
      references.push(assetReference({
        assetId,
        capabilityId,
        requirement: capabilityId === 'videoContent' ? 'ready-video-content' : 'ready-image-content',
        asset,
        entityId: interaction.id,
        path: `${path}.${interaction.action.kind === 'openAsset' ? 'action.assetId' : 'content.imageAssetId'}`,
      }));
    }
    if (interaction.content?.videoAssetId !== undefined) {
      requested.add('videoContent');
      const assetId = interaction.content.videoAssetId;
      references.push(assetReference({
        assetId,
        capabilityId: 'videoContent',
        requirement: 'ready-video-content',
        asset: assetsById.get(assetId),
        entityId: interaction.id,
        path: `${path}.content.videoAssetId`,
      }));
    }
  }

  if (project.settings.information?.externalUrl !== undefined) requested.add('externalLink');

  return {
    projectId: project.id,
    requestedCapabilities: [...requested],
    availableDeviceRequirements: ['video-playback'],
    availableMediaRequirements: mediaRequirementsSatisfied(references),
    assetReferences: references,
    configuration: {
      timelineInteractionCount: timeline.length,
      ...(durationMs === undefined ? {} : { videoDurationMs: durationMs }),
    },
    fallbackMode: 'apply',
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function analyzeImageProjectCapabilities(
  project: CanonicalProject,
  assets: readonly CanonicalAsset[],
): CapabilityResolutionInput {
  const requested = new Set<CapabilityId>(['basicPanorama']);
  const references: CapabilityAssetReference[] = [];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const globalQuality = project.settings.quality?.preference ?? 'automatic';

  let hasSceneNavigation = project.scenes.length > 1
    || (project.settings.navigation?.sceneNavigation ?? false);
  let hasViewLimits = false;
  let firstViewLimits: NonNullable<CapabilityResolutionInput['configuration']>['viewLimits'];

  for (const [sceneIndex, scene] of project.scenes.entries()) {
    const panorama = scene.panoramaAssetId === null
      ? undefined
      : assetsById.get(scene.panoramaAssetId);
    references.push(assetReference({
      assetId: scene.panoramaAssetId ?? `missing-panorama:${scene.id}`,
      capabilityId: 'basicPanorama',
      requirement: 'ready-panorama',
      asset: panorama,
      entityId: scene.id,
      path: `scenes[${sceneIndex}].panoramaAssetId`,
    }));

    const sceneQuality = scene.runtimeHints?.qualityPreference ?? globalQuality;
    const tiled = panorama === undefined
      ? undefined
      : selectPanoramaDerivatives(panorama)?.tiledLevels;
    if (sceneQuality === 'high' || (sceneQuality === 'automatic' && tiled !== undefined)) {
      requested.add('tiledPanorama');
      references.push(assetReference({
        assetId: scene.panoramaAssetId ?? `missing-panorama:${scene.id}`,
        capabilityId: 'tiledPanorama',
        requirement: 'tiled-panorama-derivatives',
        asset: panorama,
        derivativeReady: tiled !== undefined,
        entityId: scene.id,
        path: `scenes[${sceneIndex}].runtimeHints.qualityPreference`,
      }));
    }
    if (sceneQuality === 'high') {
      requested.add('highResolution');
      references.push(assetReference({
        assetId: scene.panoramaAssetId ?? `missing-panorama:${scene.id}`,
        capabilityId: 'highResolution',
        requirement: 'high-resolution-derivative',
        asset: panorama,
        derivativeReady: tiled !== undefined,
        entityId: scene.id,
        path: `scenes[${sceneIndex}].runtimeHints.qualityPreference`,
      }));
    }

    if (scene.hotspots.length > 0) requested.add('hotspots');
    if ((scene.connections?.length ?? 0) > 0) hasSceneNavigation = true;
    if (scene.viewLimits !== undefined && Object.keys(scene.viewLimits).length > 0) {
      requested.add('viewLimits');
      hasViewLimits = true;
      firstViewLimits ??= scene.viewLimits;
    }

    for (const [hotspotIndex, hotspot] of scene.hotspots.entries()) {
      const path = `scenes[${sceneIndex}].hotspots[${hotspotIndex}]`;
      if (hotspot.action.kind === 'goToScene') hasSceneNavigation = true;
      if (hotspot.action.kind === 'openUrl'
        || hotspot.content?.externalUrl !== undefined) requested.add('externalLink');

      const imageAssetIds = [
        hotspot.content?.imageAssetId,
        hotspot.action.kind === 'openAsset' ? hotspot.action.assetId : undefined,
      ].filter((assetId): assetId is string => assetId !== undefined);
      for (const assetId of imageAssetIds) {
        const asset = assetsById.get(assetId);
        const capabilityId: CapabilityId = asset?.mediaType === 'video'
          ? 'videoContent'
          : 'imageContent';
        const requirement: MediaRequirement = capabilityId === 'videoContent'
          ? 'ready-video-content'
          : 'ready-image-content';
        requested.add(capabilityId);
        references.push(assetReference({
          assetId,
          capabilityId,
          requirement,
          asset,
          entityId: hotspot.id,
          path: `${path}.${hotspot.action.kind === 'openAsset' ? 'action.assetId' : 'content.imageAssetId'}`,
        }));
      }
      if (hotspot.content?.videoAssetId !== undefined) {
        requested.add('videoContent');
        const assetId = hotspot.content.videoAssetId;
        references.push(assetReference({
          assetId,
          capabilityId: 'videoContent',
          requirement: 'ready-video-content',
          asset: assetsById.get(assetId),
          entityId: hotspot.id,
          path: `${path}.content.videoAssetId`,
        }));
      }
    }
  }

  if (hasSceneNavigation) requested.add('sceneNavigation');
  if (project.settings.gallery?.enabled ?? false) requested.add('gallery');
  if (project.settings.autorotation?.enabled ?? false) requested.add('autorotation');
  if (project.settings.compass?.enabled ?? false) requested.add('compass');
  if (project.settings.information?.externalUrl !== undefined) requested.add('externalLink');

  const availableMediaRequirements = mediaRequirementsSatisfied(references);
  return {
    projectId: project.id,
    requestedCapabilities: [...requested],
    // Ordinary embedded-video playback is a baseline player contract. Truly
    // device-specific capabilities remain unresolved until the browser runs.
    availableDeviceRequirements: ['video-playback'],
    availableMediaRequirements,
    assetReferences: references,
    configuration: {
      compassEnabled: project.settings.compass?.enabled ?? false,
      ...(hasViewLimits && firstViewLimits !== undefined ? { viewLimits: firstViewLimits } : {}),
    },
    fallbackMode: 'apply',
  };
}

function assetReference(options: {
  assetId: string;
  capabilityId: CapabilityId;
  requirement: MediaRequirement;
  asset: CanonicalAsset | undefined;
  derivativeReady?: boolean;
  entityId: string;
  path: string;
}): CapabilityAssetReference {
  return {
    assetId: options.assetId,
    capabilityId: options.capabilityId,
    requirement: options.requirement,
    state: assetState(options.asset, options.derivativeReady),
    entityId: options.entityId,
    path: options.path,
  };
}

function assetState(
  asset: CanonicalAsset | undefined,
  derivativeReady: boolean | undefined,
): CapabilityAssetReference['state'] {
  if (asset === undefined) return 'missing';
  if (asset.processingStatus === 'failed') return 'failed';
  if (asset.processingStatus !== 'ready') return 'processing';
  return derivativeReady === false ? 'missing' : 'ready';
}

function mediaRequirementsSatisfied(
  references: readonly CapabilityAssetReference[],
): MediaRequirement[] {
  const grouped = new Map<MediaRequirement, CapabilityAssetReference[]>();
  for (const reference of references) {
    const group = grouped.get(reference.requirement) ?? [];
    group.push(reference);
    grouped.set(reference.requirement, group);
  }
  return [...grouped.entries()]
    .filter(([, group]) => group.length > 0 && group.every((reference) => reference.state === 'ready'))
    .map(([requirement]) => requirement);
}
