import type {
  CapabilityAssetReference,
  CapabilityId,
  CapabilityResolutionInput,
  MediaRequirement,
} from '@sphere/capability-registry';
import type {
  CanonicalAsset,
  CanonicalInteractionGeometry,
  CanonicalOverlay,
  CanonicalProject,
  CanonicalScene,
} from '@sphere/experience-schema';
import { selectPanoramaDerivatives, selectPanoramaFamilyDerivatives } from './derivative-selector';
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

interface SpatialAnalysis {
  readonly mappedSceneCount: number;
  readonly planPositionedSceneCount: number;
  readonly usedPlanIds: ReadonlySet<string>;
}

function analyzeSpatialData(project: CanonicalProject): SpatialAnalysis {
  const usedPlanIds = new Set<string>();
  let mappedSceneCount = 0;
  let planPositionedSceneCount = 0;
  for (const scene of project.scenes) {
    const spatial = scene.spatialData;
    if (spatial === undefined) continue;
    if (typeof spatial.latitude === 'number' && typeof spatial.longitude === 'number') {
      mappedSceneCount += 1;
    }
    if (typeof spatial.planId === 'string'
      && typeof spatial.mapX === 'number'
      && typeof spatial.mapY === 'number') {
      planPositionedSceneCount += 1;
      usedPlanIds.add(spatial.planId);
    }
  }
  return { mappedSceneCount, planPositionedSceneCount, usedPlanIds };
}

interface GeometryAnalysis {
  readonly advancedGeometryCount: number;
  readonly customInteractionCount: number;
}

function analyzeImageProjectCapabilities(
  project: CanonicalProject,
  assets: readonly CanonicalAsset[],
): CapabilityResolutionInput {
  const requested = new Set<CapabilityId>(['basicPanorama']);
  const references: CapabilityAssetReference[] = [];
  const extraRequirements = new Set<MediaRequirement>();
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const globalQuality = project.settings.quality?.preference ?? 'automatic';

  let hasSceneNavigation = project.scenes.length > 1
    || (project.settings.navigation?.sceneNavigation ?? false);
  let hasViewLimits = false;
  let firstViewLimits: NonNullable<CapabilityResolutionInput['configuration']>['viewLimits'];
  let overlayCount = 0;
  let advancedGeometryCount = 0;
  let customInteractionCount = 0;

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
    const families = panorama === undefined
      ? undefined
      : selectPanoramaFamilyDerivatives(panorama);
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
    // A cubemap family is only requested when the pipeline actually produced
    // one; equirectangular delivery stays the default everywhere else.
    if (families?.cubemap !== undefined || families?.tiledCubemap !== undefined) {
      requested.add('cubemapPanorama');
      references.push(assetReference({
        assetId: scene.panoramaAssetId ?? `missing-panorama:${scene.id}`,
        capabilityId: 'cubemapPanorama',
        requirement: 'cubemap-derivatives',
        asset: panorama,
        derivativeReady: true,
        entityId: scene.id,
        path: `scenes[${sceneIndex}].panoramaAssetId`,
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

      const geometry = analyzeGeometry(
        hotspot.geometry,
        `${path}.geometry`,
        hotspot.id,
        assetsById,
        requested,
        references,
      );
      advancedGeometryCount += geometry.advancedGeometryCount;
      customInteractionCount += geometry.customInteractionCount;

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

    const overlays = scene.overlays ?? [];
    overlayCount += overlays.length;
    for (const [overlayIndex, overlay] of overlays.entries()) {
      const path = `scenes[${sceneIndex}].overlays[${overlayIndex}]`;
      requested.add('advancedOverlay');
      // A malformed record is reported by the compiler, which owns the stable
      // issue codes; analysis only has to survive long enough to get there.
      if (overlay.action?.kind === 'goToScene') hasSceneNavigation = true;
      if (overlay.action?.kind === 'openUrl'
        || overlay.content?.externalUrl !== undefined) requested.add('externalLink');
      const geometry = analyzeGeometry(
        overlay.geometry,
        `${path}.geometry`,
        overlay.id,
        assetsById,
        requested,
        references,
      );
      advancedGeometryCount += geometry.advancedGeometryCount;
      customInteractionCount += geometry.customInteractionCount;
      analyzeOverlayContent(overlay, path, assetsById, requested, references);
    }
  }

  if (hasSceneNavigation) requested.add('sceneNavigation');
  if (project.settings.gallery?.enabled ?? false) requested.add('gallery');
  if (project.settings.autorotation?.enabled ?? false) requested.add('autorotation');
  if (project.settings.compass?.enabled ?? false) requested.add('compass');
  if (project.settings.information?.externalUrl !== undefined) requested.add('externalLink');

  const spatial = analyzeSpatialData(project);
  const plans = project.plans ?? [];
  if (project.settings.map?.enabled ?? false) {
    requested.add('map');
    if (spatial.mappedSceneCount > 0) extraRequirements.add('map-spatial-data');
  }
  if (project.settings.plan?.enabled ?? false) {
    requested.add('plan');
    if (spatial.planPositionedSceneCount > 0) extraRequirements.add('plan-spatial-data');
    for (const plan of plans) {
      if (!spatial.usedPlanIds.has(plan.id)) continue;
      references.push(assetReference({
        assetId: plan.assetId ?? `missing-plan-image:${plan.id}`,
        capabilityId: 'plan',
        requirement: 'ready-plan-asset',
        asset: plan.assetId === null ? undefined : assetsById.get(plan.assetId),
        entityId: plan.id,
        path: `plans.${plan.id}.assetId`,
      }));
    }
  }

  // Motion, stereo and immersive viewing are creator intent. Device support is
  // declared to the player and resolved there, never at publish time.
  if (project.settings.motionNavigation?.enabled ?? false) requested.add('gyroscope');
  if (project.settings.immersiveViewing?.stereoEnabled ?? false) requested.add('stereo');
  if (project.settings.immersiveViewing?.immersiveEnabled ?? false) requested.add('vr');

  if (customInteractionCount > 0) extraRequirements.add('registered-extension');

  const availableMediaRequirements = [
    ...mediaRequirementsSatisfied(references),
    ...extraRequirements,
  ];
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
      mappedSceneCount: spatial.mappedSceneCount,
      planPositionedSceneCount: spatial.planPositionedSceneCount,
      overlayCount,
      advancedGeometryCount,
      customInteractionCount,
      motionNavigationRequested: project.settings.motionNavigation?.enabled ?? false,
      stereoRequested: project.settings.immersiveViewing?.stereoEnabled ?? false,
      immersiveRequested: project.settings.immersiveViewing?.immersiveEnabled ?? false,
    },
    fallbackMode: 'apply',
  };
}

/**
 * Advanced geometry brings its own capability and, for media layers, its own
 * asset readiness requirement.
 */
function analyzeGeometry(
  geometry: CanonicalInteractionGeometry | undefined,
  path: string,
  entityId: string,
  assetsById: ReadonlyMap<string, CanonicalAsset>,
  requested: Set<CapabilityId>,
  references: CapabilityAssetReference[],
): GeometryAnalysis {
  // A record without a recognizable geometry requests no capability here.
  // Preflight raises the stable issue for it; analysis just has to not throw.
  if (geometry?.kind === undefined) {
    return { advancedGeometryCount: 0, customInteractionCount: 0 };
  }
  switch (geometry.kind) {
    case 'point':
      return { advancedGeometryCount: 0, customInteractionCount: 0 };
    case 'polygon':
    case 'polyline':
      requested.add('advancedGeometry');
      return { advancedGeometryCount: 1, customInteractionCount: 0 };
    case 'imageLayer':
    case 'videoLayer': {
      requested.add('advancedGeometry');
      const capabilityId: CapabilityId = geometry.kind === 'videoLayer'
        ? 'videoContent'
        : 'imageContent';
      requested.add(capabilityId);
      references.push(assetReference({
        assetId: geometry.assetId,
        capabilityId,
        requirement: geometry.kind === 'videoLayer' ? 'ready-video-content' : 'ready-image-content',
        asset: assetsById.get(geometry.assetId),
        entityId,
        path: `${path}.assetId`,
      }));
      return { advancedGeometryCount: 1, customInteractionCount: 0 };
    }
    case 'custom':
      requested.add('customInteraction');
      return { advancedGeometryCount: 0, customInteractionCount: 1 };
  }
}

function analyzeOverlayContent(
  overlay: CanonicalOverlay,
  path: string,
  assetsById: ReadonlyMap<string, CanonicalAsset>,
  requested: Set<CapabilityId>,
  references: CapabilityAssetReference[],
): void {
  const imageAssetIds = [
    overlay.content?.imageAssetId,
    overlay.action?.kind === 'openAsset' ? overlay.action.assetId : undefined,
  ].filter((assetId): assetId is string => assetId !== undefined);
  for (const assetId of imageAssetIds) {
    const asset = assetsById.get(assetId);
    const capabilityId: CapabilityId = asset?.mediaType === 'video' ? 'videoContent' : 'imageContent';
    requested.add(capabilityId);
    references.push(assetReference({
      assetId,
      capabilityId,
      requirement: capabilityId === 'videoContent' ? 'ready-video-content' : 'ready-image-content',
      asset,
      entityId: overlay.id,
      path: `${path}.content.imageAssetId`,
    }));
  }
  if (overlay.content?.videoAssetId !== undefined) {
    requested.add('videoContent');
    references.push(assetReference({
      assetId: overlay.content.videoAssetId,
      capabilityId: 'videoContent',
      requirement: 'ready-video-content',
      asset: assetsById.get(overlay.content.videoAssetId),
      entityId: overlay.id,
      path: `${path}.content.videoAssetId`,
    }));
  }
}

/** Exported so the compiler and diagnostics can describe scene placement. */
export function sceneHasWorldCoordinates(scene: CanonicalScene): boolean {
  return typeof scene.spatialData?.latitude === 'number'
    && typeof scene.spatialData?.longitude === 'number';
}

export function sceneHasPlanCoordinates(scene: CanonicalScene): boolean {
  return typeof scene.spatialData?.planId === 'string'
    && typeof scene.spatialData?.mapX === 'number'
    && typeof scene.spatialData?.mapY === 'number';
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
