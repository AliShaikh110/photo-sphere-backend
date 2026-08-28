import type {
  AssetDerivative,
  CanonicalAsset,
  CanonicalBranding,
  CanonicalHotspot,
  CanonicalInteractionGeometry,
  CanonicalOverlay,
  CanonicalPlan,
  CanonicalProject,
  CanonicalProjectSettings,
  CanonicalScene,
  CanonicalSpatialData,
  CanonicalTimelineInteraction,
  CanonicalViewpoint,
  JsonObject,
  JsonValue,
} from '@sphere/experience-schema';
import { jsonByteLength } from '@sphere/experience-schema';
import { resolvePanoramaQuality } from './quality-policy';
import { CAPABILITY_REGISTRY } from '@sphere/capability-registry';
import type { ValidationIssue } from '@sphere/experience-schema';
import { sanitizePlainText, sanitizeRichHtml } from '@sphere/experience-schema';
import { validateSafeUrl } from '@sphere/experience-schema';
import {
  DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY,
  DEFAULT_RUNTIME_CACHE_POLICY,
  DEFAULT_TOUR_STRATEGY_POLICY,
  HANDHELD_MAX_VIDEO_WIDTH,
  SCENE_TRANSITION_FAILURE_CATEGORIES,
  VIDEO_PLAYBACK_POLICY_VERSION,
  defaultCandidateOrder,
  resolveRuntimeCachePolicy,
  selectAdjacentScenePreloads,
  selectTourRuntimeStrategy,
} from '@sphere/experience-schema';
import type {
  AdjacentScenePreloadPolicyConfig,
  RuntimeCachePolicyConfig,
  TourStrategyPolicyConfig,
} from '@sphere/experience-schema';
import {
  requirePanoramaDerivatives,
  selectPanoramaFamilyDerivatives,
  selectPreferredReadyDerivative,
  selectSceneIndexThumbnail,
} from './derivative-selector';
import { preflightExperience } from './preflight';
import {
  readPanoramaCrop,
  readPanoramaInitialView,
  readPanoramaSphereCorrection,
} from './panorama-metadata';
import { readTiledPanoramaMetadata } from './tiled-panorama';
import { VIDEO_PLAYBACK_FAILURE_CATEGORIES } from '@sphere/telemetry-contract';
import {
  isHandheldSafeProfile,
  selectVideoDerivatives,
} from './video-derivative-selector';
import {
  BASELINE_TELEMETRY_EVENTS,
  SPATIAL_TELEMETRY_EVENTS,
  VIDEO_TELEMETRY_EVENTS,
} from '@sphere/telemetry-contract';
import {
  COMPILED_MANIFEST_VERSION,
  COMPILED_SCENE_VERSION,
} from './types';
import type {
  CompileExperienceInput,
  CompiledBranding,
  CompiledInteractionGeometry,
  CompiledOverlay,
  CompiledOverlayAppearance,
  CompiledPlan,
  CompiledSceneIndexEntry,
  CompiledSceneSpatial,
  CompiledSpatialIndex,
  CompiledTelemetryEvent,
  CompiledExperienceBundle,
  CompiledExperienceManifest,
  CompiledHotspot,
  CompiledHotspotAction,
  CompiledHotspotAppearance,
  CompiledHotspotContent,
  CompiledImageExperienceManifest,
  CompiledMediaReference,
  CompiledScene,
  CompiledTelemetryMetadata,
  CompiledTimelineAction,
  CompiledTimelineContent,
  CompiledTimelineInteraction,
  CompiledVideoExperienceManifest,
  CompiledVideoMedia,
  CompiledVideoPlaybackProfile,
  MediaAccess,
  PublicationVisibility,
  RuntimeCapabilityDeclaration,
  RuntimeDeclarations,
  ViewerIntegrationAdapter,
} from './types';
import { PhotoSphereViewerIntegrationAdapter } from '@sphere/viewer-integration';
import {
  DEFAULT_MEDIA_DELIVERY_POLICY,
  formatMediaLocation,
  type MediaDeliveryPolicy,
} from './media-delivery-policy';

export interface ExperienceCompilerDependencies {
  /** Where compiled media references point; defaults to the platform routes. */
  readonly mediaDeliveryPolicy?: MediaDeliveryPolicy;
  readonly viewerIntegrationAdapter?: ViewerIntegrationAdapter;
  readonly viewerIntegrationVersion?: string;
  readonly tourStrategyPolicy?: TourStrategyPolicyConfig;
  readonly preloadPolicy?: AdjacentScenePreloadPolicyConfig;
  readonly cachePolicy?: RuntimeCachePolicyConfig;
}

interface ResolutionContext {
  readonly input: CompileExperienceInput;
  readonly access: MediaAccess;
  readonly cache: Map<string, CompiledMediaReference>;
}

interface IssueLocation {
  readonly entityType: ValidationIssue['entityType'];
  readonly entityId: string;
  readonly path: string;
}

export class ExperienceCompilationError extends Error {
  readonly code = 'EXPERIENCE_COMPILATION_FAILED';
  readonly issues: readonly ValidationIssue[];
  readonly entityId?: string;
  readonly path?: string;
  readonly retryable: boolean;

  constructor(issues: readonly ValidationIssue[]) {
    super('The Experience could not be compiled.');
    this.name = 'ExperienceCompilationError';
    this.issues = Object.freeze([...issues]);
    const first = issues[0];
    if (first?.entityId !== undefined) {
      this.entityId = first.entityId;
    }
    if (first?.path !== undefined) {
      this.path = first.path;
    }
    this.retryable = issues.length > 0 && issues.every((issue) => issue.retryable);
  }
}

/** Shared compilation boundary used unchanged by draft preview and publication. */
export class ExperienceCompiler {
  private readonly mediaDeliveryPolicy: MediaDeliveryPolicy;
  private readonly viewerIntegrationAdapter: ViewerIntegrationAdapter;
  private readonly tourStrategyPolicy: TourStrategyPolicyConfig;
  private readonly preloadPolicy: AdjacentScenePreloadPolicyConfig;
  private readonly cachePolicy: RuntimeCachePolicyConfig;

  constructor(dependencies: ExperienceCompilerDependencies = {}) {
    this.mediaDeliveryPolicy = dependencies.mediaDeliveryPolicy ?? DEFAULT_MEDIA_DELIVERY_POLICY;
    this.viewerIntegrationAdapter = dependencies.viewerIntegrationAdapter
      ?? new PhotoSphereViewerIntegrationAdapter(dependencies.viewerIntegrationVersion);
    this.tourStrategyPolicy = dependencies.tourStrategyPolicy ?? DEFAULT_TOUR_STRATEGY_POLICY;
    this.preloadPolicy = dependencies.preloadPolicy ?? DEFAULT_ADJACENT_SCENE_PRELOAD_POLICY;
    this.cachePolicy = dependencies.cachePolicy ?? DEFAULT_RUNTIME_CACHE_POLICY;
    if (dependencies.viewerIntegrationVersion !== undefined
      && this.viewerIntegrationAdapter.viewerIntegrationVersion
        !== dependencies.viewerIntegrationVersion) {
      throw new Error('The injected viewer integration version does not match the adapter.');
    }
  }

  preflight(input: CompileExperienceInput): ReturnType<typeof preflightExperience> {
    return preflightExperience(input);
  }

  compile(input: CompileExperienceInput): CompiledExperienceManifest {
    return this.compileBundle(input).manifest;
  }

  compileBundle(input: CompileExperienceInput): CompiledExperienceBundle {
    const preflight = this.preflight(input);
    if (!preflight.valid) {
      throw new ExperienceCompilationError(preflight.issues);
    }
    if (input.project.type === 'video360') {
      return this.compileVideoBundle(input, preflight.capabilityResolution);
    }
    const capabilityResolution = preflight.capabilityResolution;
    const tiledPanoramaEnabled = capabilityResolution.capabilities.includes('tiledPanorama');

    const visibility = resolveVisibility(input);
    const access: MediaAccess = input.target === 'preview' || visibility === 'private'
      ? 'protected'
      : 'public';
    const context: ResolutionContext = { input, access, cache: new Map() };
    const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
    const initialSceneId = input.project.scenes.find((scene) => scene.isPrimary)?.id
      ?? input.project.scenes[0]!.id;
    const settings = deepFreeze(compileCanonicalSettings(input.project.settings));
    const branding = deepFreeze(this.compileBranding(
      input.project.branding,
      input.project.id,
      assetsById,
      context,
    ));

    const scenes: CompiledScene[] = [];
    // Scene-index thumbnails are kept beside the compiled scenes rather than
    // inside them: only the index and gallery need them.
    const sceneIndexThumbnails = new Map<string, CompiledMediaReference>();
    for (const [sceneIndex, scene] of input.project.scenes.entries()) {
      const panoramaAsset = assetsById.get(scene.panoramaAssetId!)!;
      const derivatives = requirePanoramaDerivatives(panoramaAsset);
      const base = this.resolveDerivative(
        panoramaAsset,
        derivatives.lowResolutionBase,
        context,
        {
          entityType: 'scene',
          entityId: scene.id,
          path: `scenes[${sceneIndex}].panoramaAssetId`,
        },
      );
      const primary = this.resolveDerivative(
        panoramaAsset,
        derivatives.standardWeb,
        context,
        {
          entityType: 'scene',
          entityId: scene.id,
          path: `scenes[${sceneIndex}].panoramaAssetId`,
        },
      );
      sceneIndexThumbnails.set(scene.id, this.resolveDerivative(
        panoramaAsset,
        selectSceneIndexThumbnail(panoramaAsset, derivatives),
        context,
        {
          entityType: 'scene',
          entityId: scene.id,
          path: `scenes[${sceneIndex}].panoramaAssetId`,
        },
      ));
      const qualityPreference = scene.runtimeHints?.qualityPreference
        ?? input.project.settings.quality?.preference
        ?? 'automatic';
      let tiles: CompiledScene['panorama']['tiles'];
      if (tiledPanoramaEnabled
        && qualityPreference !== 'standard'
        && derivatives.tiledLevels !== undefined) {
        const tileMetadata = readTiledPanoramaMetadata(derivatives.tiledLevels)!;
        const tileManifest = this.resolveDerivative(
          panoramaAsset,
          derivatives.tiledLevels,
          context,
          {
            entityType: 'scene',
            entityId: scene.id,
            path: `scenes[${sceneIndex}].panoramaAssetId`,
          },
        );
        tiles = {
          manifest: tileManifest,
          tileUrlTemplate: buildTileUrlTemplate(tileManifest.url),
          tileSize: tileMetadata.tileSize,
          levels: tileMetadata.levels,
        };
      }

      const hotspots: CompiledHotspot[] = [];
      for (const [hotspotIndex, hotspot] of scene.hotspots.entries()) {
        hotspots.push(this.compileHotspot(
          hotspot,
          `scenes[${sceneIndex}].hotspots[${hotspotIndex}]`,
          assetsById,
          context,
        ));
      }
      const overlays: CompiledOverlay[] = [];
      for (const [overlayIndex, overlay] of (scene.overlays ?? []).entries()) {
        overlays.push(this.compileOverlay(
          overlay,
          `scenes[${sceneIndex}].overlays[${overlayIndex}]`,
          assetsById,
          context,
        ));
      }

      // Preflight narrows this at runtime; this cast only reflects that invariant to TypeScript.
      const projection = panoramaAsset.projection as
        'equirectangular' | 'cropped_equirectangular' | 'cubemap';
      const families = selectPanoramaFamilyDerivatives(panoramaAsset);
      const quality = resolvePanoramaQuality({
        requested: qualityPreference === 'high'
          ? 'high'
          : qualityPreference === 'standard' ? 'standard' : 'automatic',
        available: {
          standardEquirectangular: families.standardEquirectangular !== undefined,
          tiledEquirectangular: tiles !== undefined,
          cubemap: families.cubemap !== undefined,
          tiledCubemap: families.tiledCubemap !== undefined
            && capabilityResolution.capabilities.includes('cubemapPanorama'),
        },
        ...(derivatives.standardWeb.width === null
          ? {}
          : { sourceWidth: derivatives.standardWeb.width }),
      });
      const cubemapDerivative = families.tiledCubemap ?? families.cubemap;
      const cubemap = cubemapDerivative === undefined
        || !capabilityResolution.capabilities.includes('cubemapPanorama')
        ? undefined
        : this.resolveDerivative(panoramaAsset, cubemapDerivative, context, {
          entityType: 'scene',
          entityId: scene.id,
          path: `scenes[${sceneIndex}].panoramaAssetId`,
        });
      // A scene's own framing wins; otherwise the capture device's recorded
      // initial view is a better first impression than due north at 90 degrees.
      const capturedInitialView = readPanoramaInitialView(panoramaAsset) ?? {};
      const authoredInitialView = scene.initialView ?? {};
      const initialView = {
        headingDegrees: authoredInitialView.headingDegrees
          ?? capturedInitialView.headingDegrees
          ?? 0,
        pitchDegrees: authoredInitialView.pitchDegrees
          ?? capturedInitialView.pitchDegrees
          ?? 0,
        horizontalFovDegrees: authoredInitialView.horizontalFovDegrees
          ?? capturedInitialView.horizontalFovDegrees
          ?? 90,
      };
      const sphereCorrection = readPanoramaSphereCorrection(panoramaAsset);
      scenes.push({
        id: scene.id,
        name: sanitizePlainText(scene.name),
        sortOrder: scene.sortOrder ?? sceneIndex,
        isPrimary: scene.id === initialSceneId,
        panorama: {
          assetId: panoramaAsset.id,
          projection,
          family: quality.family,
          fallbackFamilies: quality.fallbackFamilies,
          ...(projection === 'cropped_equirectangular'
            ? { crop: readPanoramaCrop(panoramaAsset)! }
            : {}),
          ...(sphereCorrection === undefined ? {} : { sphereCorrection }),
          base,
          primary,
          ...(tiles === undefined ? {} : { tiles }),
          ...(cubemap === undefined ? {} : { cubemap }),
        },
        initialView: { ...initialView },
        ...(scene.viewLimits === undefined || Object.keys(scene.viewLimits).length === 0
          ? {}
          : { viewLimits: { ...scene.viewLimits } }),
        hotspots,
        overlays,
        connections: cloneJsonArray(scene.connections ?? []),
        spatialData: compileSpatialData(scene.spatialData),
        runtimeHints: cloneJsonObject(scene.runtimeHints ?? {}),
        preloadSceneIds: [],
      });
    }

    const scenePreloadPriorities = Object.fromEntries(scenes.flatMap((scene) => (
      typeof scene.runtimeHints.preloadPriority === 'number'
        ? [[scene.id, scene.runtimeHints.preloadPriority] as const]
        : []
    )));
    const scenesWithPreloads = scenes.map((scene) => ({
      ...scene,
      preloadSceneIds: selectAdjacentScenePreloads({
        currentSceneId: scene.id,
        connections: scene.connections.flatMap((connection) => {
          const sourceSceneId = connection.sourceSceneId;
          const targetSceneId = connection.targetSceneId;
          if (typeof sourceSceneId !== 'string' || typeof targetSceneId !== 'string') return [];
          return [{
            sourceSceneId,
            targetSceneId,
            ...(typeof connection.importance === 'number'
              ? { importance: connection.importance }
              : {}),
            ...(connection.preloadHint === 'none'
              || connection.preloadHint === 'normal'
              || connection.preloadHint === 'high'
              ? { preloadHint: connection.preloadHint }
              : {}),
          }];
        }),
        likelyNextSceneIds: readStringArray(scene.runtimeHints.likelyNextSceneIds),
        scenePreloadPriorities,
      }, this.preloadPolicy),
    }));
    const frozenScenes = deepFreeze(scenesWithPreloads);
    const connectionCount = frozenScenes.reduce(
      (total, scene) => total + scene.connections.length,
      0,
    );
    const tourDecision = selectTourRuntimeStrategy({
      sceneCount: frozenScenes.length,
      estimatedManifestBytes: jsonByteLength(frozenScenes),
      connectionCount,
    }, this.tourStrategyPolicy);
    const progressive = input.target === 'publication'
      && tourDecision.sceneDelivery === 'progressive';
    const manifestScenes = progressive
      ? frozenScenes.filter((scene) => scene.id === initialSceneId)
      : frozenScenes;
    const sceneIndexVersion = `scene-index-${COMPILED_SCENE_VERSION}-${input.publicationRevision ?? input.project.revision}`;
    const sceneIndex: CompiledSceneIndexEntry[] = frozenScenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      sortOrder: scene.sortOrder,
      isPrimary: scene.isPrimary,
      panoramaAssetId: scene.panorama.assetId,
      thumbnail: sceneIndexThumbnails.get(scene.id) ?? scene.panorama.base,
      hasHotspots: scene.hotspots.length > 0,
      hasOverlays: scene.overlays.length > 0,
      ...(Object.keys(scene.spatialData).length === 0
        ? {}
        : { spatial: scene.spatialData }),
      connectionTargetSceneIds: scene.connections.flatMap((connection) => (
        typeof connection.targetSceneId === 'string' ? [connection.targetSceneId] : []
      )),
    }));
    // A very large index is itself a startup cost, so beyond the segment
    // threshold the manifest carries only the first segment and the player
    // pages the rest from the published scene-index route.
    const sceneIndexSegmented = progressive && sceneIndex.length > SCENE_INDEX_SEGMENT_THRESHOLD;
    const inlineSceneIndex = sceneIndexSegmented
      ? sceneIndex.slice(0, SCENE_INDEX_SEGMENT_THRESHOLD)
      : sceneIndex;
    const plans = deepFreeze(this.compilePlans(
      input.project.plans ?? [],
      input.project.scenes,
      assetsById,
      context,
      capabilityResolution.capabilities.includes('plan'),
    ));
    const spatialIndex = deepFreeze(buildSpatialIndex(frozenScenes));
    const capabilities = buildCapabilityDeclarations(capabilityResolution, 'basicPanorama');
    const runtimeModules = capabilityResolution.runtimeModules;
    const adapterOutput = this.viewerIntegrationAdapter.adapt({
      initialSceneId,
      settings,
      branding,
      scenes: manifestScenes,
      sceneIndex: inlineSceneIndex,
      plans,
      spatialIndex,
      capabilities: capabilityResolution.capabilities,
    });
    if (adapterOutput.viewerIntegrationVersion
      !== this.viewerIntegrationAdapter.viewerIntegrationVersion) {
      throw new ExperienceCompilationError([{
        code: 'VIEWER_INTEGRATION_VERSION_MISMATCH',
        message: 'The viewer integration adapter emitted an inconsistent version.',
        entityType: 'project',
        entityId: input.project.id,
        path: 'viewerIntegrationVersion',
        retryable: false,
      }]);
    }

    const publicationRevision = input.target === 'publication'
      ? input.publicationRevision!
      : null;
    const viewerIntegrationVersion = this.viewerIntegrationAdapter.viewerIntegrationVersion;
    const manifest: CompiledImageExperienceManifest = {
      manifestVersion: COMPILED_MANIFEST_VERSION,
      schemaVersion: input.project.schemaVersion,
      experienceId: input.project.id,
      experienceName: sanitizePlainText(input.project.name),
      experienceType: 'image360',
      projectRevision: input.project.revision,
      publicationRevision,
      target: input.target,
      visibility,
      viewerIntegrationVersion,
      initialSceneId,
      settings,
      branding,
      scenes: manifestScenes,
      tour: {
        strategy: progressive ? 'progressive' : 'embedded',
        sceneIndexVersion,
        sceneIndex: inlineSceneIndex,
        sceneCount: frozenScenes.length,
        ...(progressive
          ? {
            sceneDefinitionUrlTemplate: publishedSceneUrlTemplate(input),
            sceneIndexUrl: publishedSceneIndexUrl(input),
            sceneIndexSegmented,
            ...(sceneIndexSegmented ? { sceneIndexSegmentSize: SCENE_INDEX_SEGMENT_THRESHOLD } : {}),
          }
          : {}),
      },
      plans,
      spatialIndex,
      capabilities: deepFreeze(capabilities),
      runtime: {
        modules: runtimeModules,
        moduleDeclarations: capabilityResolution.moduleDeclarations,
        capabilityFallbacks: capabilityResolution.fallbacks,
        deferredDeviceCapabilities: capabilityResolution.deferredDeviceCapabilities,
        preload: {
          strategy: 'selective-adjacent',
          maxScenesPerSource: 2,
          content: 'scene-definition-and-base-media',
        },
        cache: {
          defaultProfile: 'standard',
          profiles: {
            constrained: resolveRuntimeCachePolicy(
              { deviceClass: 'constrained', mediaClass: 'image-tour' },
              this.cachePolicy,
            ),
            standard: resolveRuntimeCachePolicy(
              { deviceClass: 'standard', mediaClass: 'image-tour' },
              this.cachePolicy,
            ),
            capable: resolveRuntimeCachePolicy(
              { deviceClass: 'capable', mediaClass: 'image-tour' },
              this.cachePolicy,
            ),
          },
        },
        fallbackPolicy: {
          panorama: 'low-resolution-base-then-standard-or-tiled-detail',
          optionalCapabilities: 'continue-without-capability',
          immersive: 'continue-in-normal-360',
        },
      },
      telemetry: {
        enabled: true,
        experienceId: input.project.id,
        projectRevision: input.project.revision,
        publicationRevision,
        viewerIntegrationVersion,
        events: imageTelemetryEvents(capabilityResolution.capabilities),
        sceneTransitionFailureCategories: [...SCENE_TRANSITION_FAILURE_CATEGORIES],
      },
      pinnedExtensions: collectPinnedExtensions(input.project),
      viewerIntegration: adapterOutput,
    };
    const sceneDefinitions = input.target === 'publication'
      ? frozenScenes.map((scene) => ({
        sceneDefinitionVersion: COMPILED_SCENE_VERSION,
        experienceId: input.project.id,
        publicationRevision: input.publicationRevision!,
        viewerIntegrationVersion,
        scene,
        viewerIntegration: this.viewerIntegrationAdapter.adaptScene(scene),
      }))
      : [];

    // The complete index travels with the bundle even when the manifest ships
    // only a segment, so the publisher can persist it for the paged route.
    return deepFreeze({ manifest, sceneDefinitions, sceneIndex });
  }

  /**
   * Compiles a video360 experience. It shares the preflight, capability
   * resolution, media resolution, sanitization and integration-adapter path
   * used by image experiences; only the media and timeline shapes differ.
   */
  private compileVideoBundle(
    input: CompileExperienceInput,
    capabilityResolution: ReturnType<typeof preflightExperience>['capabilityResolution'],
  ): CompiledExperienceBundle {
    const visibility = resolveVisibility(input);
    const access: MediaAccess = input.target === 'preview' || visibility === 'private'
      ? 'protected'
      : 'public';
    const context: ResolutionContext = { input, access, cache: new Map() };
    const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
    const settings = deepFreeze(compileCanonicalSettings(input.project.settings));
    const branding = deepFreeze(this.compileBranding(
      input.project.branding,
      input.project.id,
      assetsById,
      context,
    ));

    const videoAsset = assetsById.get(input.project.videoAssetId!)!;
    const video = deepFreeze(this.compileVideoMedia(videoAsset, input, context));
    const timeline: CompiledTimelineInteraction[] = [];
    for (const [index, interaction] of (input.project.timeline ?? []).entries()) {
      timeline.push(this.compileTimelineInteraction(
        interaction,
        `timeline[${index}]`,
        assetsById,
        context,
      ));
    }
    const frozenTimeline = deepFreeze(sortTimeline(timeline));

    const adapterOutput = this.viewerIntegrationAdapter.adaptVideo({
      settings,
      branding,
      video,
      timeline: frozenTimeline,
    });
    if (adapterOutput.viewerIntegrationVersion
      !== this.viewerIntegrationAdapter.viewerIntegrationVersion) {
      throw new ExperienceCompilationError([{
        code: 'VIEWER_INTEGRATION_VERSION_MISMATCH',
        message: 'The viewer integration adapter emitted an inconsistent version.',
        entityType: 'project',
        entityId: input.project.id,
        path: 'viewerIntegrationVersion',
        retryable: false,
      }]);
    }

    const publicationRevision = input.target === 'publication'
      ? input.publicationRevision!
      : null;
    const viewerIntegrationVersion = this.viewerIntegrationAdapter.viewerIntegrationVersion;
    const capabilities = buildCapabilityDeclarations(capabilityResolution, 'video360');
    const telemetry: CompiledTelemetryMetadata = {
      enabled: true,
      experienceId: input.project.id,
      projectRevision: input.project.revision,
      publicationRevision,
      viewerIntegrationVersion,
      events: [...BASELINE_TELEMETRY_EVENTS, ...VIDEO_TELEMETRY_EVENTS],
      sceneTransitionFailureCategories: [...SCENE_TRANSITION_FAILURE_CATEGORIES],
      videoPlaybackFailureCategories: [...VIDEO_PLAYBACK_FAILURE_CATEGORIES],
    };
    const runtime: RuntimeDeclarations = {
      modules: capabilityResolution.runtimeModules,
      moduleDeclarations: capabilityResolution.moduleDeclarations,
      capabilityFallbacks: capabilityResolution.fallbacks,
      deferredDeviceCapabilities: capabilityResolution.deferredDeviceCapabilities,
      preload: {
        strategy: 'video-progressive',
        maxScenesPerSource: 0,
        content: 'poster-and-first-video-segments',
      },
      cache: {
        defaultProfile: 'standard',
        profiles: {
          constrained: resolveRuntimeCachePolicy(
            { deviceClass: 'constrained', mediaClass: 'video-tour' },
            this.cachePolicy,
          ),
          standard: resolveRuntimeCachePolicy(
            { deviceClass: 'standard', mediaClass: 'video-tour' },
            this.cachePolicy,
          ),
          capable: resolveRuntimeCachePolicy(
            { deviceClass: 'capable', mediaClass: 'video-tour' },
            this.cachePolicy,
          ),
        },
      },
      fallbackPolicy: {
        video: 'ordered-playback-profile-candidates',
        optionalCapabilities: 'continue-without-capability',
        immersive: 'continue-in-normal-360',
      },
    };

    const manifest: CompiledVideoExperienceManifest = {
      manifestVersion: COMPILED_MANIFEST_VERSION,
      schemaVersion: input.project.schemaVersion,
      experienceId: input.project.id,
      experienceName: sanitizePlainText(input.project.name),
      experienceType: 'video360',
      projectRevision: input.project.revision,
      publicationRevision,
      target: input.target,
      visibility,
      viewerIntegrationVersion,
      settings,
      branding,
      video,
      timeline: frozenTimeline,
      capabilities: deepFreeze(capabilities),
      runtime,
      telemetry,
      pinnedExtensions: collectPinnedExtensions(input.project),
      viewerIntegration: adapterOutput,
    };

    // A video experience has no progressively fetched scene definitions.
    return deepFreeze({ manifest, sceneDefinitions: [] });
  }

  private compileVideoMedia(
    videoAsset: CanonicalAsset,
    input: CompileExperienceInput,
    context: ResolutionContext,
  ): CompiledVideoMedia {
    const selected = selectVideoDerivatives(videoAsset);
    const profiles: CompiledVideoPlaybackProfile[] = [];
    for (const candidate of selected.profiles) {
      const media = this.resolveDerivative(videoAsset, candidate.derivative, context, {
        entityType: 'project',
        entityId: input.project.id,
        path: 'videoAssetId',
      });
      profiles.push({
        profileId: candidate.profileId,
        media,
        constraints: {
          maxWidth: candidate.derivative.width ?? HANDHELD_MAX_VIDEO_WIDTH,
          handheldSafe: isHandheldSafeProfile(candidate.derivative),
          mimeType: candidate.derivative.mimeType,
        },
      });
    }
    if (profiles.length === 0) {
      throw new ExperienceCompilationError([{
        code: 'VIDEO_PROFILE_UNAVAILABLE',
        message: 'The 360 video has no compatible playback profile.',
        entityType: 'asset',
        entityId: videoAsset.id,
        path: 'videoAssetId',
        retryable: true,
      }]);
    }
    // Ordered so a player that simply takes the first playable entry is safe
    // on a handheld device.
    const ordered = defaultCandidateOrder(profiles.map((profile) => ({
      profileId: profile.profileId,
      derivativeId: profile.media.derivativeId,
      mimeType: profile.constraints.mimeType,
      width: profile.media.width ?? profile.constraints.maxWidth,
      height: profile.media.height ?? 0,
      handheldSafe: profile.constraints.handheldSafe,
    })));
    const orderedProfiles = ordered.map(
      (candidate) => profiles.find((profile) => profile.profileId === candidate.profileId)!,
    );
    const poster = selected.poster === undefined
      ? undefined
      : this.resolveDerivative(videoAsset, selected.poster, context, {
        entityType: 'project',
        entityId: input.project.id,
        path: 'videoAssetId',
      });

    const metadata = videoAsset.metadata ?? {};
    const defaultProfileId = orderedProfiles[0]!.profileId;
    const handheldSafeProfile = orderedProfiles.find(
      (profile) => profile.constraints.handheldSafe,
    ) ?? orderedProfiles[orderedProfiles.length - 1]!;
    return {
      assetId: videoAsset.id,
      projection: videoAsset.projection === 'cubemap' ? 'cubemap' : 'equirectangular',
      durationMs: readCompiledNumber(metadata.durationMs) ?? 0,
      width: readCompiledNumber(metadata.width) ?? 0,
      height: readCompiledNumber(metadata.height) ?? 0,
      ...(readCompiledNumber(metadata.frameRate) === undefined
        ? {}
        : { frameRate: readCompiledNumber(metadata.frameRate)! }),
      audioPresent: metadata.audioPresent === true,
      stereoMode: metadata.stereoMode === 'top-bottom' || metadata.stereoMode === 'left-right'
        ? metadata.stereoMode
        : 'mono',
      ...(poster === undefined ? {} : { poster }),
      profiles: orderedProfiles,
      selectionPolicy: {
        policyVersion: VIDEO_PLAYBACK_POLICY_VERSION,
        strategy: 'ordered-candidates-client-selects',
        handheldMaxWidth: HANDHELD_MAX_VIDEO_WIDTH,
        defaultProfileId,
        fallbackProfileId: handheldSafeProfile.profileId,
        ...(input.target === 'publication' && input.publicationSlug !== undefined
          ? { selectionUrl: `/view/${input.publicationSlug}/playback-profile` }
          : {}),
      },
    };
  }

  private compileTimelineInteraction(
    interaction: CanonicalTimelineInteraction,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): CompiledTimelineInteraction {
    const appearance = this.compileHotspotAppearance(
      { ...interaction, sceneId: '', geometry: { kind: 'point' } } as unknown as CanonicalHotspot,
      path,
      assetsById,
      context,
    );
    const baseContent = interaction.content === undefined
      ? undefined
      : this.compileHotspotContent(
        {
          id: interaction.id,
          sceneId: '',
          geometry: { kind: 'point' },
          position: interaction.position ?? {
            coordinateSystem: 'spherical_degrees',
            longitudeDegrees: 0,
            latitudeDegrees: 0,
          },
          content: interaction.content,
          action: { kind: 'none' },
        },
        path,
        assetsById,
        context,
      );
    const content: CompiledTimelineContent | undefined = baseContent === undefined
      ? undefined
      : {
        ...baseContent,
        ...(interaction.content?.ctaLabel === undefined
          ? {}
          : { ctaLabel: sanitizePlainText(interaction.content.ctaLabel) }),
        ...(interaction.content?.ctaUrl === undefined
          ? {}
          : { ctaUrl: normalizeTrustedUrl(interaction.content.ctaUrl) }),
        properties: {
          ...baseContent.properties,
          ...(interaction.content?.ctaLabel === undefined
            ? {}
            : { ctaLabel: sanitizePlainText(interaction.content.ctaLabel) }),
          ...(interaction.content?.ctaUrl === undefined
            ? {}
            : { ctaUrl: normalizeTrustedUrl(interaction.content.ctaUrl) }),
        },
      };

    let action: CompiledTimelineAction;
    switch (interaction.action.kind) {
      case 'openUrl':
        action = { kind: 'openUrl', url: normalizeTrustedUrl(interaction.action.url) };
        break;
      case 'openAsset':
        action = {
          kind: 'openAsset',
          media: this.resolveDisplayAsset(
            interaction.action.assetId,
            assetsById,
            context,
            { entityType: 'project', entityId: interaction.id, path: `${path}.action.assetId` },
          ),
        };
        break;
      case 'setViewpoint':
        action = { kind: 'setViewpoint' };
        break;
      case 'showInformation':
        action = { kind: 'showInformation' };
        break;
      default:
        action = { kind: 'none' };
    }

    return {
      id: interaction.id,
      kind: interaction.kind,
      timeMs: interaction.timeMs,
      endTimeMs: interaction.endTimeMs ?? null,
      sortOrder: interaction.sortOrder ?? 0,
      ...(interaction.geometry?.kind === 'point' ? { geometry: { kind: 'point' as const } } : {}),
      ...(interaction.position === undefined ? {} : { position: { ...interaction.position } }),
      ...(interaction.viewpoint === undefined
        ? {}
        : { viewpoint: compileViewpoint(interaction.viewpoint) }),
      ...(appearance === undefined ? {} : { appearance }),
      ...(content === undefined ? {} : { content }),
      action,
      enabled: interaction.visibilityRules?.enabled ?? true,
      visibilityRules: {
        ...(interaction.visibilityRules?.enabled === undefined
          ? {}
          : { enabled: interaction.visibilityRules.enabled }),
        ...(interaction.visibilityRules?.persistUntilDismissed === undefined
          ? {}
          : { persistUntilDismissed: interaction.visibilityRules.persistUntilDismissed }),
        ...(interaction.visibilityRules?.pauseVideoWhenShown === undefined
          ? {}
          : { pauseVideoWhenShown: interaction.visibilityRules.pauseVideoWhenShown }),
      },
    };
  }

  private compileBranding(
    branding: CanonicalBranding,
    projectId: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): CompiledBranding {
    const properties: Record<string, JsonValue> = {
      ...(branding.companyName === undefined
        ? {}
        : { companyName: sanitizePlainText(branding.companyName) }),
      ...(branding.logoAssetId === undefined ? {} : { logoAssetId: branding.logoAssetId }),
      ...(branding.faviconAssetId === undefined ? {} : { faviconAssetId: branding.faviconAssetId }),
      ...(branding.watermarkAssetId === undefined ? {} : { watermarkAssetId: branding.watermarkAssetId }),
      ...(branding.primaryColor === undefined ? {} : { primaryColor: branding.primaryColor }),
      ...(branding.welcomeMessage === undefined
        ? {}
        : { welcomeMessage: sanitizeRichHtml(branding.welcomeMessage) }),
      ...(branding.loadingMessage === undefined
        ? {}
        : { loadingMessage: sanitizeRichHtml(branding.loadingMessage) }),
    };
    const compiled: CompiledBranding = {
      ...(branding.companyName === undefined
        ? {}
        : { companyName: sanitizePlainText(branding.companyName) }),
      ...(branding.logoAssetId === undefined ? {} : { logoAssetId: branding.logoAssetId }),
      ...(branding.faviconAssetId === undefined
        ? {}
        : { faviconAssetId: branding.faviconAssetId }),
      ...(branding.watermarkAssetId === undefined
        ? {}
        : { watermarkAssetId: branding.watermarkAssetId }),
      ...(branding.primaryColor === undefined ? {} : { primaryColor: branding.primaryColor }),
      ...(branding.welcomeMessage === undefined
        ? {}
        : { welcomeMessage: sanitizeRichHtml(branding.welcomeMessage) }),
      ...(branding.loadingMessage === undefined
        ? {}
        : { loadingMessage: sanitizeRichHtml(branding.loadingMessage) }),
      properties,
    };

    const resolved: {
      logo?: CompiledMediaReference;
      favicon?: CompiledMediaReference;
      watermark?: CompiledMediaReference;
    } = {};
    for (const [field, outputField] of [
      ['logoAssetId', 'logo'],
      ['faviconAssetId', 'favicon'],
      ['watermarkAssetId', 'watermark'],
    ] as const) {
      const assetId = branding[field];
      if (assetId === undefined) {
        continue;
      }
      const asset = assetsById.get(assetId);
      if (asset === undefined || asset.processingStatus !== 'ready') continue;
      const derivative = selectPreferredReadyDerivative(asset);
      if (derivative === undefined) continue;
      resolved[outputField] = this.resolveDerivative(asset, derivative, context, {
        entityType: 'branding',
        entityId: projectId,
        path: `branding.${field}`,
      });
    }
    return { ...compiled, ...resolved };
  }

  private compileHotspot(
    hotspot: CanonicalHotspot,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): CompiledHotspot {
    const appearance = this.compileHotspotAppearance(
      hotspot,
      path,
      assetsById,
      context,
    );
    const content = this.compileHotspotContent(hotspot, path, assetsById, context);
    const action = this.compileHotspotAction(
      hotspot,
      path,
      assetsById,
      context,
    );

    return {
      id: hotspot.id,
      geometry: this.compileGeometry(
        hotspot.geometry,
        `${path}.geometry`,
        hotspot.id,
        'hotspot',
        assetsById,
        context,
      ),
      position: { ...hotspot.position },
      ...(appearance === undefined ? {} : { appearance }),
      ...(content === undefined ? {} : { content }),
      action,
      enabled: hotspot.visibilityRules?.enabled ?? true,
      visibilityRules: hotspot.visibilityRules?.enabled === undefined
        ? {}
        : { enabled: hotspot.visibilityRules.enabled },
    };
  }

  /**
   * Compiles an overlay through exactly the same content, action and
   * sanitization boundary as a hotspot. Only the geometry family differs.
   */
  private compileOverlay(
    overlay: CanonicalOverlay,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): CompiledOverlay {
    const asHotspot: CanonicalHotspot = {
      id: overlay.id,
      sceneId: overlay.sceneId,
      geometry: overlay.geometry,
      position: overlay.position ?? {
        coordinateSystem: 'spherical_degrees',
        longitudeDegrees: 0,
        latitudeDegrees: 0,
      },
      ...(overlay.content === undefined ? {} : { content: overlay.content }),
      action: overlay.action,
    };
    const content = this.compileHotspotContent(asHotspot, path, assetsById, context);
    const action = this.compileHotspotAction(asHotspot, path, assetsById, context);
    const geometry = this.compileGeometry(
      overlay.geometry,
      `${path}.geometry`,
      overlay.id,
      'overlay',
      assetsById,
      context,
    );

    return {
      id: overlay.id,
      ...(overlay.name === undefined ? {} : { name: sanitizePlainText(overlay.name) }),
      geometry,
      ...(overlay.position === undefined ? {} : { position: { ...overlay.position } }),
      ...(overlay.appearance === undefined
        ? {}
        : { appearance: compileOverlayAppearance(overlay.appearance) }),
      ...(content === undefined ? {} : { content }),
      action,
      enabled: overlay.visibilityRules?.enabled ?? true,
      visibilityRules: overlay.visibilityRules?.enabled === undefined
        ? {}
        : { enabled: overlay.visibilityRules.enabled },
    };
  }

  /**
   * Resolves an interaction geometry into delivery-ready form. A custom
   * geometry is only compiled when its extension resolves in the registry
   * snapshot, so a published revision can never name unregistered client code.
   */
  private compileGeometry(
    geometry: CanonicalInteractionGeometry,
    path: string,
    entityId: string,
    entityType: IssueLocation['entityType'],
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): CompiledInteractionGeometry {
    switch (geometry.kind) {
      case 'point':
        return { kind: 'point' };
      case 'polygon':
        return { kind: 'polygon', vertices: geometry.vertices.map((vertex) => ({ ...vertex })) };
      case 'polyline':
        return { kind: 'polyline', vertices: geometry.vertices.map((vertex) => ({ ...vertex })) };
      case 'imageLayer':
      case 'videoLayer': {
        const media = this.resolveDisplayAsset(
          geometry.assetId,
          assetsById,
          context,
          { entityType, entityId, path: `${path}.assetId` },
        );
        return {
          kind: geometry.kind,
          media,
          anchor: { ...geometry.anchor },
        };
      }
      case 'custom': {
        const extension = context.input.extensions?.get(
          geometry.extensionId,
          geometry.extensionVersion,
        );
        if (extension === undefined) {
          throw new ExperienceCompilationError([{
            code: 'EXTENSION_NOT_REGISTERED',
            message: 'This custom interaction is not registered on the platform.',
            entityType,
            entityId,
            path: `${path}.extensionId`,
            retryable: false,
          }]);
        }
        return {
          kind: 'custom',
          extensionId: extension.extensionId,
          extensionVersion: extension.version,
          runtimeModule: extension.runtimeModule,
          payload: cloneJsonObject(
            geometry.payload,
          ) as unknown as JsonObject,
        };
      }
    }
  }

  /**
   * Plans are compiled with their image derivative and the scenes placed on
   * them, so a plan view needs no extra round trips.
   */
  private compilePlans(
    plans: readonly CanonicalPlan[],
    scenes: readonly CanonicalScene[],
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
    planCapabilityEnabled: boolean,
  ): CompiledPlan[] {
    if (!planCapabilityEnabled) return [];
    const compiled: CompiledPlan[] = [];
    for (const [index, plan] of [...plans]
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
      .entries()) {
      const asset = plan.assetId === null || plan.assetId === undefined
        ? undefined
        : assetsById.get(plan.assetId);
      const derivative = asset === undefined || asset.processingStatus !== 'ready'
        ? undefined
        : selectPreferredReadyDerivative(asset);
      const image = asset === undefined || derivative === undefined
        ? undefined
        : this.resolveDerivative(asset, derivative, context, {
          entityType: 'plan',
          entityId: plan.id,
          path: `plans.${plan.id}.assetId`,
        });
      compiled.push({
        id: plan.id,
        name: sanitizePlainText(plan.name),
        coordinateSystem: plan.coordinateSystem,
        sortOrder: plan.sortOrder ?? index,
        ...(image === undefined ? {} : { image }),
        sceneIds: scenes
          .filter((scene) => scene.spatialData?.planId === plan.id)
          .map((scene) => scene.id),
        metadata: cloneJsonObject(plan.metadata ?? {}),
      });
    }
    return compiled;
  }

  private compileHotspotAppearance(
    hotspot: CanonicalHotspot,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): CompiledHotspotAppearance | undefined {
    const appearance = hotspot.appearance;
    if (appearance === undefined) {
      return undefined;
    }
    const compiled = compileHotspotAppearanceValues(appearance);
    if (appearance.iconAssetId === undefined) {
      return compiled;
    }
    const asset = assetsById.get(appearance.iconAssetId)!;
    const derivative = selectPreferredReadyDerivative(asset)!;
    const icon = this.resolveDerivative(asset, derivative, context, {
      entityType: 'hotspot',
      entityId: hotspot.id,
      path: `${path}.appearance.iconAssetId`,
    });
    return { ...compiled, icon };
  }

  private compileHotspotContent(
    hotspot: CanonicalHotspot,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): CompiledHotspotContent | undefined {
    const content = hotspot.content;
    if (content === undefined) {
      return undefined;
    }
    const { properties, ...fields } = compileHotspotContentValues(content);
    const image = content.imageAssetId === undefined
      ? undefined
      : this.resolveDisplayAsset(
        content.imageAssetId,
        assetsById,
        context,
        {
          entityType: 'hotspot',
          entityId: hotspot.id,
          path: `${path}.content.imageAssetId`,
        },
      );
    const video = content.videoAssetId === undefined
      ? undefined
      : this.resolveDisplayAsset(
        content.videoAssetId,
        assetsById,
        context,
        {
          entityType: 'hotspot',
          entityId: hotspot.id,
          path: `${path}.content.videoAssetId`,
        },
      );
    return {
      ...fields,
      ...(image === undefined ? {} : { image }),
      ...(video === undefined ? {} : { video }),
      properties,
    };
  }

  private compileHotspotAction(
    hotspot: CanonicalHotspot,
    path: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
  ): CompiledHotspotAction {
    const action = hotspot.action;
    switch (action.kind) {
      case 'none':
        return { kind: 'none' };
      case 'showInformation':
        return { kind: 'showInformation' };
      case 'openUrl':
        return { kind: 'openUrl', url: normalizeTrustedUrl(action.url) };
      case 'goToScene':
        return { kind: 'goToScene', sceneId: action.sceneId };
      case 'openAsset': {
        const media = this.resolveDisplayAsset(
          action.assetId,
          assetsById,
          context,
          {
            entityType: 'hotspot',
            entityId: hotspot.id,
            path: `${path}.action.assetId`,
          },
        );
        return { kind: 'openAsset', media };
      }
    }
  }

  private resolveDisplayAsset(
    assetId: string,
    assetsById: ReadonlyMap<string, CanonicalAsset>,
    context: ResolutionContext,
    location: IssueLocation,
  ): CompiledMediaReference {
    const asset = assetsById.get(assetId)!;
    const derivative = selectPreferredReadyDerivative(
      asset,
      asset.mediaType === 'video' || asset.mediaType === 'video360'
        // Timed video content plays back through the same generated profiles,
        // handheld-safe first; the original upload is never a candidate.
        ? ['mobileVideoProfile', 'desktopVideoProfile']
        : undefined,
    )!;
    return this.resolveDerivative(asset, derivative, context, location);
  }

  private resolveDerivative(
    asset: CanonicalAsset,
    derivative: AssetDerivative,
    context: ResolutionContext,
    location: IssueLocation,
  ): CompiledMediaReference {
    const cacheKey = `${context.access}:${asset.id}:${derivative.id}:${derivative.version}`;
    const cached = context.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    const resolution = this.resolveDerivativeUncached(asset, derivative, context, location);
    context.cache.set(cacheKey, resolution);
    return resolution;
  }

  private resolveDerivativeUncached(
    asset: CanonicalAsset,
    derivative: AssetDerivative,
    context: ResolutionContext,
    location: IssueLocation,
  ): CompiledMediaReference {
    // A logical delivery location, never a credential. Signing this reference
    // is a server-side hydration step performed after compilation, which is
    // what keeps the compiler safe to run in a browser.
    const rawUrl = formatMediaLocation(this.mediaDeliveryPolicy, {
      access: context.access,
      experienceId: context.input.project.id,
      assetId: asset.id,
      derivativeId: derivative.id,
      ...(context.input.publicationRevision === undefined
        ? {}
        : { publicationRevision: context.input.publicationRevision }),
    });
    const url = validateSafeUrl(rawUrl, { allowInternalRelative: true });
    if (!url.valid) {
      throw new ExperienceCompilationError([{
        code: 'MEDIA_URL_INVALID',
        message: 'The media delivery policy produced a URL outside the delivery policy.',
        ...location,
        retryable: false,
      }]);
    }
    return Object.freeze({
      assetId: asset.id,
      derivativeId: derivative.id,
      kind: derivative.kind,
      version: derivative.version,
      mimeType: derivative.mimeType,
      width: derivative.width,
      height: derivative.height,
      url: url.normalizedUrl,
      access: context.access,
    });
  }
}

export function compileExperience(
  input: CompileExperienceInput,
  dependencies: ExperienceCompilerDependencies,
): CompiledExperienceManifest {
  return new ExperienceCompiler(dependencies).compile(input);
}

export function compileExperienceBundle(
  input: CompileExperienceInput,
  dependencies: ExperienceCompilerDependencies,
): CompiledExperienceBundle {
  return new ExperienceCompiler(dependencies).compileBundle(input);
}

export const compileExperienceManifest = compileExperience;


/**
 * The compiled form of an authored appearance, without its resolved icon.
 *
 * Exported because the live-patch contract rebuilds an appearance when a
 * creator recolours or retitles a hotspot. Sharing the builder is what makes
 * "patch equals recompile" true by construction rather than by inspection.
 */
export function compileHotspotAppearanceValues(
  appearance: NonNullable<CanonicalHotspot['appearance']>,
): CompiledHotspotAppearance {
  const values = {
    ...(appearance.label === undefined
      ? {}
      : { label: sanitizePlainText(appearance.label) }),
    ...(appearance.iconAssetId === undefined ? {} : { iconAssetId: appearance.iconAssetId }),
    ...(appearance.color === undefined ? {} : { color: appearance.color }),
    ...(appearance.emphasis === undefined ? {} : { emphasis: appearance.emphasis }),
  };
  return { ...values, properties: { ...values } };
}

/** The compiled form of authored content, without its resolved media. */
export function compileHotspotContentValues(
  content: NonNullable<CanonicalHotspot['content']>,
): CompiledHotspotContent {
  const values = {
    ...(content.title === undefined ? {} : { title: sanitizePlainText(content.title) }),
    ...(content.description === undefined
      ? {}
      : { description: sanitizePlainText(content.description) }),
    ...(content.bodyHtml === undefined
      ? {}
      : { bodyHtml: sanitizeRichHtml(content.bodyHtml) }),
    ...(content.tooltip === undefined ? {} : { tooltip: sanitizePlainText(content.tooltip) }),
    ...(content.buttonLabel === undefined
      ? {}
      : { buttonLabel: sanitizePlainText(content.buttonLabel) }),
    ...(content.externalUrl === undefined
      ? {}
      : { externalUrl: normalizeTrustedUrl(content.externalUrl) }),
    ...(content.imageAssetId === undefined ? {} : { imageAssetId: content.imageAssetId }),
    ...(content.videoAssetId === undefined ? {} : { videoAssetId: content.videoAssetId }),
  };
  return { ...values, properties: { ...values } };
}

/** Segmented delivery keeps the initial manifest small for enterprise tours. */
export const SCENE_INDEX_SEGMENT_THRESHOLD = 250;

function buildCapabilityDeclarations(
  capabilityResolution: ReturnType<typeof preflightExperience>['capabilityResolution'],
  requiredCapabilityId: string,
): RuntimeCapabilityDeclaration[] {
  return capabilityResolution.capabilities.map((id) => {
    const fallback = capabilityResolution.fallbacks.find(
      (candidate) => candidate.capabilityId === id,
    );
    const definition = CAPABILITY_REGISTRY[id];
    const deferred = definition.deviceRequirementResolution === 'runtime';
    return {
      id,
      required: id === requiredCapabilityId,
      resolution: definition.deviceRequirementResolution,
      ...(definition.deviceRequirements.length === 0
        ? {}
        : { deviceRequirements: [...definition.deviceRequirements] }),
      ...(fallback !== undefined
        ? { fallback: fallback.message }
        : deferred && definition.fallback !== null
          ? { fallback: definition.fallback.message }
          : {}),
    };
  });
}

function imageTelemetryEvents(
  capabilities: readonly string[],
): CompiledTelemetryEvent[] {
  const spatial = capabilities.includes('map')
    || capabilities.includes('plan')
    || capabilities.includes('advancedOverlay');
  return spatial
    ? [...BASELINE_TELEMETRY_EVENTS, ...SPATIAL_TELEMETRY_EVENTS]
    : [...BASELINE_TELEMETRY_EVENTS];
}

function compileSpatialData(
  spatial: CanonicalSpatialData | undefined,
): CompiledSceneSpatial {
  if (spatial === undefined) return {};
  return {
    ...(spatial.coordinateSystem === undefined
      ? {}
      : { coordinateSystem: spatial.coordinateSystem }),
    ...(typeof spatial.latitude === 'number' ? { latitude: spatial.latitude } : {}),
    ...(typeof spatial.longitude === 'number' ? { longitude: spatial.longitude } : {}),
    ...(typeof spatial.altitudeMeters === 'number'
      ? { altitudeMeters: spatial.altitudeMeters }
      : {}),
    ...(typeof spatial.headingDegrees === 'number'
      ? { headingDegrees: spatial.headingDegrees }
      : {}),
    ...(typeof spatial.planId === 'string' ? { planId: spatial.planId } : {}),
    ...(typeof spatial.mapX === 'number' ? { mapX: spatial.mapX } : {}),
    ...(typeof spatial.mapY === 'number' ? { mapY: spatial.mapY } : {}),
  };
}

/**
 * A compact index of every scene's placement. Map and plan views can render
 * the whole experience from the manifest even when scenes load progressively.
 */
function buildSpatialIndex(scenes: readonly CompiledScene[]): CompiledSpatialIndex {
  const entries = scenes
    .filter((scene) => Object.keys(scene.spatialData).length > 0)
    .map((scene) => ({
      sceneId: scene.id,
      name: scene.name,
      spatial: scene.spatialData,
    }));
  const located = entries.filter((entry) => typeof entry.spatial.latitude === 'number'
    && typeof entry.spatial.longitude === 'number');
  const latitudes = located.map((entry) => entry.spatial.latitude!);
  const longitudes = located.map((entry) => entry.spatial.longitude!);
  return {
    hasWorldCoordinates: located.length > 0,
    hasPlanCoordinates: entries.some((entry) => typeof entry.spatial.planId === 'string'),
    entries,
    ...(located.length === 0
      ? {}
      : {
        bounds: {
          minLatitude: Math.min(...latitudes),
          maxLatitude: Math.max(...latitudes),
          minLongitude: Math.min(...longitudes),
          maxLongitude: Math.max(...longitudes),
        },
      }),
  };
}

export function compileOverlayAppearance(
  appearance: NonNullable<CanonicalOverlay['appearance']>,
): CompiledOverlayAppearance {
  const values = {
    ...(appearance.label === undefined ? {} : { label: sanitizePlainText(appearance.label) }),
    ...(appearance.color === undefined ? {} : { color: appearance.color }),
    ...(appearance.fillOpacity === undefined ? {} : { fillOpacity: appearance.fillOpacity }),
    ...(appearance.strokeWidth === undefined ? {} : { strokeWidth: appearance.strokeWidth }),
    ...(appearance.emphasis === undefined ? {} : { emphasis: appearance.emphasis }),
  };
  return { ...values, properties: { ...values } };
}

/**
 * Extension versions used by this revision. Pinning them means a later
 * registry change cannot alter or break an already published experience.
 */
function collectPinnedExtensions(
  project: CanonicalProject,
): Record<string, string> {
  const pinned: Record<string, string> = {};
  const record = (geometry: CanonicalInteractionGeometry | undefined): void => {
    if (geometry?.kind === 'custom') {
      pinned[geometry.extensionId] = geometry.extensionVersion;
    }
  };
  for (const scene of project.scenes) {
    for (const hotspot of scene.hotspots) record(hotspot.geometry);
    for (const overlay of scene.overlays ?? []) record(overlay.geometry);
  }
  return pinned;
}

function publishedSceneIndexUrl(input: CompileExperienceInput): string {
  if (input.publicationSlug === undefined || input.publicationRevision === undefined) {
    throw new Error('Progressive publication compilation requires a slug and revision.');
  }
  return `/view/${input.publicationSlug}/revisions/${input.publicationRevision}/scene-index`;
}

export function compileCanonicalSettings(
  settings: CanonicalProjectSettings,
): CanonicalProjectSettings {
  const compiled: Record<string, JsonValue> = {};
  if (settings.appearance !== undefined) {
    compiled.appearance = {
      ...(settings.appearance.theme === undefined ? {} : { theme: settings.appearance.theme }),
      ...(settings.appearance.backgroundColor === undefined
        ? {}
        : { backgroundColor: settings.appearance.backgroundColor }),
      ...(settings.appearance.primaryColor === undefined
        ? {}
        : { primaryColor: settings.appearance.primaryColor }),
      ...(settings.appearance.hotspotStyle === undefined
        ? {}
        : { hotspotStyle: sanitizePlainText(settings.appearance.hotspotStyle) }),
      ...(settings.appearance.typography === undefined
        ? {}
        : { typography: sanitizePlainText(settings.appearance.typography) }),
    };
  }
  if (settings.navigation !== undefined) {
    compiled.navigation = {
      ...(settings.navigation.mouse === undefined ? {} : { mouse: settings.navigation.mouse }),
      ...(settings.navigation.touch === undefined ? {} : { touch: settings.navigation.touch }),
      ...(settings.navigation.zoom === undefined ? {} : { zoom: settings.navigation.zoom }),
      ...(settings.navigation.keyboard === undefined ? {} : { keyboard: settings.navigation.keyboard }),
      ...(settings.navigation.fullscreen === undefined ? {} : { fullscreen: settings.navigation.fullscreen }),
      ...(settings.navigation.navigationButtons === undefined
        ? {}
        : { navigationButtons: settings.navigation.navigationButtons }),
      ...(settings.navigation.sceneNavigation === undefined
        ? {}
        : { sceneNavigation: settings.navigation.sceneNavigation }),
    };
  }
  if (settings.gallery !== undefined) {
    compiled.gallery = {
      ...(settings.gallery.enabled === undefined ? {} : { enabled: settings.gallery.enabled }),
      ...(settings.gallery.showSceneNames === undefined
        ? {}
        : { showSceneNames: settings.gallery.showSceneNames }),
      ...(settings.gallery.showThumbnails === undefined
        ? {}
        : { showThumbnails: settings.gallery.showThumbnails }),
    };
  }
  if (settings.autorotation !== undefined) {
    compiled.autorotation = {
      ...(settings.autorotation.enabled === undefined
        ? {}
        : { enabled: settings.autorotation.enabled }),
      ...(settings.autorotation.speedDegreesPerSecond === undefined
        ? {}
        : { speedDegreesPerSecond: settings.autorotation.speedDegreesPerSecond }),
      ...(settings.autorotation.direction === undefined
        ? {}
        : { direction: settings.autorotation.direction }),
      ...(settings.autorotation.startAutomatically === undefined
        ? {}
        : { startAutomatically: settings.autorotation.startAutomatically }),
    };
  }
  if (settings.compass !== undefined) {
    compiled.compass = {
      ...(settings.compass.enabled === undefined ? {} : { enabled: settings.compass.enabled }),
    };
  }
  if (settings.quality !== undefined) {
    compiled.quality = {
      ...(settings.quality.preference === undefined
        ? {}
        : { preference: settings.quality.preference }),
    };
  }
  if (settings.video !== undefined) {
    compiled.video = {
      ...(settings.video.autoplay === undefined ? {} : { autoplay: settings.video.autoplay }),
      ...(settings.video.loop === undefined ? {} : { loop: settings.video.loop }),
      ...(settings.video.muted === undefined ? {} : { muted: settings.video.muted }),
      ...(settings.video.showControls === undefined
        ? {}
        : { showControls: settings.video.showControls }),
      ...(settings.video.showTimeline === undefined
        ? {}
        : { showTimeline: settings.video.showTimeline }),
      ...(settings.video.startAtMs === undefined ? {} : { startAtMs: settings.video.startAtMs }),
      ...(settings.video.qualityPreference === undefined
        ? {}
        : { qualityPreference: settings.video.qualityPreference }),
    };
  }
  if (settings.map !== undefined) {
    compiled.map = {
      ...(settings.map.enabled === undefined ? {} : { enabled: settings.map.enabled }),
      ...(settings.map.showSceneMarkers === undefined
        ? {}
        : { showSceneMarkers: settings.map.showSceneMarkers }),
      ...(settings.map.showHeadingCone === undefined
        ? {}
        : { showHeadingCone: settings.map.showHeadingCone }),
      ...(settings.map.defaultZoom === undefined ? {} : { defaultZoom: settings.map.defaultZoom }),
    };
  }
  if (settings.plan !== undefined) {
    compiled.plan = {
      ...(settings.plan.enabled === undefined ? {} : { enabled: settings.plan.enabled }),
      ...(settings.plan.defaultPlanId === undefined
        ? {}
        : { defaultPlanId: settings.plan.defaultPlanId }),
      ...(settings.plan.showSceneMarkers === undefined
        ? {}
        : { showSceneMarkers: settings.plan.showSceneMarkers }),
      ...(settings.plan.showHeadingCone === undefined
        ? {}
        : { showHeadingCone: settings.plan.showHeadingCone }),
    };
  }
  if (settings.motionNavigation !== undefined) {
    compiled.motionNavigation = {
      ...(settings.motionNavigation.enabled === undefined
        ? {}
        : { enabled: settings.motionNavigation.enabled }),
      ...(settings.motionNavigation.requestPermissionOnStart === undefined
        ? {}
        : { requestPermissionOnStart: settings.motionNavigation.requestPermissionOnStart }),
    };
  }
  if (settings.immersiveViewing !== undefined) {
    compiled.immersiveViewing = {
      ...(settings.immersiveViewing.stereoEnabled === undefined
        ? {}
        : { stereoEnabled: settings.immersiveViewing.stereoEnabled }),
      ...(settings.immersiveViewing.immersiveEnabled === undefined
        ? {}
        : { immersiveEnabled: settings.immersiveViewing.immersiveEnabled }),
    };
  }
  if (settings.information !== undefined) {
    compiled.information = {
      ...(settings.information.title === undefined
        ? {}
        : { title: sanitizePlainText(settings.information.title) }),
      ...(settings.information.description === undefined
        ? {}
        : { description: sanitizePlainText(settings.information.description) }),
      ...(settings.information.bodyHtml === undefined
        ? {}
        : { bodyHtml: sanitizeRichHtml(settings.information.bodyHtml) }),
      ...(settings.information.externalUrl === undefined
        ? {}
        : { externalUrl: normalizeTrustedUrl(settings.information.externalUrl) }),
    };
  }
  return compiled as CanonicalProjectSettings;
}

function normalizeTrustedUrl(url: string): string {
  const validation = validateSafeUrl(url, { allowInternalRelative: true });
  if (!validation.valid) {
    // Preflight guarantees this path; retain a fail-closed invariant if called independently.
    throw new Error('Attempted to compile an unsafe URL.');
  }
  return validation.normalizedUrl;
}

function resolveVisibility(input: CompileExperienceInput): PublicationVisibility {
  if (input.target === 'preview') {
    return 'private';
  }
  const visibility = input.visibility ?? input.project.publication?.visibility;
  return visibility === 'public' ? 'public' : 'private';
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function cloneJsonObject(value: JsonObject): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function cloneJsonArray(value: readonly unknown[]): JsonObject[] {
  return JSON.parse(JSON.stringify(value)) as JsonObject[];
}

function buildTileUrlTemplate(manifestUrl: string): string {
  const queryIndex = manifestUrl.indexOf('?');
  const path = queryIndex === -1 ? manifestUrl : manifestUrl.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : manifestUrl.slice(queryIndex);
  return `${path}/tiles/{level}/{x}/{y}${query}`;
}

function readStringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}

function compileViewpoint(viewpoint: CanonicalViewpoint): CanonicalViewpoint {
  return {
    headingDegrees: viewpoint.headingDegrees,
    pitchDegrees: viewpoint.pitchDegrees,
    ...(viewpoint.horizontalFovDegrees === undefined
      ? {}
      : { horizontalFovDegrees: viewpoint.horizontalFovDegrees }),
    ...(viewpoint.transition === undefined ? {} : { transition: viewpoint.transition }),
    ...(viewpoint.transitionMs === undefined ? {} : { transitionMs: viewpoint.transitionMs }),
  };
}

/**
 * Total, deterministic ordering even when interactions share a timestamp.
 *
 * The tie-break is the canonical `sortOrder` the editor assigns, so the
 * published order matches the order the creator sees; `id` only settles the
 * remaining tie between two interactions that also share a sort order.
 */
function sortTimeline(
  timeline: readonly CompiledTimelineInteraction[],
): CompiledTimelineInteraction[] {
  return [...timeline].sort((left, right) => {
    if (left.timeMs !== right.timeMs) return left.timeMs - right.timeMs;
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.id.localeCompare(right.id);
  });
}

function readCompiledNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function publishedSceneUrlTemplate(input: CompileExperienceInput): string {
  if (input.publicationSlug === undefined || input.publicationRevision === undefined) {
    throw new Error('Progressive publication compilation requires a slug and revision.');
  }
  return `/view/${input.publicationSlug}/revisions/${input.publicationRevision}/scenes/{sceneId}`;
}
