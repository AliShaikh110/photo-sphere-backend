import { sanitizeRichHtml } from '../security/html-sanitizer';
import type { JsonObject, JsonValue } from '../domain/types';
import type {
  CompiledHotspot,
  CompiledInteractionGeometry,
  CompiledOverlay,
  CompiledPlan,
  CompiledScene,
  CompiledSpatialIndex,
  CompiledTimelineInteraction,
  ViewerIntegrationAdapter,
  ViewerIntegrationInput,
  ViewerIntegrationOutput,
  ViewerSceneIntegrationOutput,
  ViewerVideoIntegrationInput,
} from './types';

export const PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION = 'psv-5.14.3-adapter-2' as const;

/**
 * The sole renderer translation boundary. No canonical entity imports or
 * persistence shape should contain the keys emitted in this adapter.
 */
export class PhotoSphereViewerIntegrationAdapter implements ViewerIntegrationAdapter {
  readonly viewerIntegrationVersion: string;

  constructor(viewerIntegrationVersion: string = PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION) {
    if (viewerIntegrationVersion.trim().length === 0) {
      throw new Error('viewerIntegrationVersion must be a non-empty string.');
    }
    this.viewerIntegrationVersion = viewerIntegrationVersion;
  }

  adapt(input: ViewerIntegrationInput): ViewerIntegrationOutput {
    const initialScene = input.scenes.find((scene) => scene.id === input.initialSceneId);
    if (initialScene === undefined) {
      throw new Error('Viewer adapter could not resolve the initial scene.');
    }

    const sceneCount = input.sceneIndex?.length ?? input.scenes.length;
    const capabilities = new Set(input.capabilities ?? []);
    const config: JsonObject = {
      adapter: selectAdapter(initialScene),
      initialSceneId: input.initialSceneId,
      navbar: buildNavbar(input, capabilities),
      mousewheel: input.settings.navigation?.zoom ?? true,
      mousemove: input.settings.navigation?.mouse ?? true,
      touchControlsEnabled: input.settings.navigation?.touch ?? true,
      keyboard: input.settings.navigation?.keyboard ?? true,
      sceneNavigation: input.settings.navigation?.sceneNavigation ?? sceneCount > 1,
      ...(input.settings.gallery?.enabled === true
        ? { gallery: buildGalleryConfiguration(input) }
        : {}),
      ...(input.settings.compass?.enabled === true
        ? { compass: { enabled: true } }
        : {}),
      ...(input.settings.autorotation?.enabled === true
        ? { autorotation: buildAutorotationConfiguration(input) }
        : {}),
      ...(capabilities.has('map') && input.spatialIndex !== undefined
        ? { map: buildMapConfiguration(input, input.spatialIndex) }
        : {}),
      ...(capabilities.has('plan') && input.plans !== undefined && input.plans.length > 0
        ? { plan: buildPlanConfiguration(input, input.plans) }
        : {}),
      ...(capabilities.has('gyroscope')
        ? {
          gyroscope: {
            enabled: true,
            touchmove: true,
            absolutePosition: false,
            requestPermissionOnStart:
              input.settings.motionNavigation?.requestPermissionOnStart ?? true,
          },
        }
        : {}),
      ...(capabilities.has('stereo') || capabilities.has('vr')
        ? {
          stereo: {
            enabled: true,
            immersive: capabilities.has('vr'),
          },
        }
        : {}),
      startup: buildSceneConfiguration(initialScene),
      scenes: input.scenes.map(buildSceneConfiguration),
    };

    return Object.freeze({
      rendererId: 'photo-sphere-viewer',
      viewerIntegrationVersion: this.viewerIntegrationVersion,
      config: deepFreeze(config),
    });
  }

  adaptScene(scene: CompiledScene): ViewerSceneIntegrationOutput {
    return Object.freeze({
      rendererId: 'photo-sphere-viewer',
      viewerIntegrationVersion: this.viewerIntegrationVersion,
      sceneId: scene.id,
      config: deepFreeze(buildSceneConfiguration(scene)),
    });
  }

  /**
   * The 360 video translation. Playback profile candidates stay ordered so
   * the runtime can pick, and the timeline is emitted as renderer-neutral
   * timed markers rather than plugin event wiring.
   */
  adaptVideo(input: ViewerVideoIntegrationInput): ViewerIntegrationOutput {
    const video = input.video;
    const videoSettings = input.settings.video;
    const config: JsonObject = {
      adapter: video.projection === 'cubemap'
        ? 'cubemap-video'
        : 'equirectangular-video',
      panorama: {
        source: video.profiles[0]!.media.url,
        sources: video.profiles.map((profile) => ({
          profileId: profile.profileId,
          url: profile.media.url,
          type: profile.constraints.mimeType,
          width: profile.media.width,
          height: profile.media.height,
          handheldSafe: profile.constraints.handheldSafe,
        })),
        ...(video.poster === undefined ? {} : { poster: video.poster.url }),
      },
      navbar: buildVideoNavbar(input),
      mousewheel: input.settings.navigation?.zoom ?? true,
      mousemove: input.settings.navigation?.mouse ?? true,
      touchControlsEnabled: input.settings.navigation?.touch ?? true,
      keyboard: input.settings.navigation?.keyboard ?? true,
      video: {
        autoplay: videoSettings?.autoplay ?? false,
        loop: videoSettings?.loop ?? false,
        muted: videoSettings?.muted ?? (videoSettings?.autoplay ?? false),
        progressbar: videoSettings?.showControls ?? true,
        bigbutton: videoSettings?.showControls ?? true,
        durationMs: video.durationMs,
        ...(videoSettings?.startAtMs === undefined
          ? {}
          : { startAtMs: videoSettings.startAtMs }),
      },
      timeline: input.timeline.map(buildTimelineConfiguration),
      markers: input.timeline
        .filter((interaction) => interaction.position !== undefined)
        .map(buildTimedMarkerConfiguration),
    };

    return Object.freeze({
      rendererId: 'photo-sphere-viewer',
      viewerIntegrationVersion: this.viewerIntegrationVersion,
      config: deepFreeze(config),
    });
  }
}

function buildVideoNavbar(input: ViewerVideoIntegrationInput): JsonValue[] {
  const controls = input.settings.navigation;
  const navbar: JsonValue[] = [];
  if (input.settings.video?.showControls ?? true) {
    navbar.push('video');
    navbar.push('videoTime');
  }
  if (controls?.zoom ?? true) navbar.push('zoom');
  if (controls?.fullscreen ?? true) navbar.push('fullscreen');
  return navbar;
}

function buildTimelineConfiguration(interaction: CompiledTimelineInteraction): JsonObject {
  return {
    id: interaction.id,
    kind: interaction.kind,
    startTime: interaction.timeMs / 1000,
    ...(interaction.endTimeMs === null ? {} : { endTime: interaction.endTimeMs / 1000 }),
    visible: interaction.enabled,
    ...(interaction.viewpoint === undefined
      ? {}
      : {
        viewpoint: {
          yaw: degreesToRadians(interaction.viewpoint.headingDegrees),
          pitch: degreesToRadians(interaction.viewpoint.pitchDegrees),
          ...(interaction.viewpoint.horizontalFovDegrees === undefined
            ? {}
            : { zoom: fieldOfViewToZoomLevel(interaction.viewpoint.horizontalFovDegrees) }),
          transition: interaction.viewpoint.transition === 'cut'
            ? false
            : interaction.viewpoint.transitionMs ?? true,
        },
      }),
    data: {
      action: toJsonValue(interaction.action),
      ...(interaction.content === undefined
        ? {}
        : { content: toJsonValue(interaction.content.properties) }),
    },
  };
}

function buildTimedMarkerConfiguration(interaction: CompiledTimelineInteraction): JsonObject {
  const content = interaction.content;
  const candidateHtml = content?.tooltip
    ?? content?.bodyHtml
    ?? content?.description
    ?? content?.title
    ?? interaction.appearance?.label
    ?? '';
  const html = sanitizeRichHtml(candidateHtml) || '<span aria-hidden="true">&#9679;</span>';
  return {
    id: interaction.id,
    position: {
      yaw: degreesToRadians(interaction.position!.longitudeDegrees),
      pitch: degreesToRadians(interaction.position!.latitudeDegrees),
    },
    html,
    visible: interaction.enabled,
    data: {
      timelineInteractionId: interaction.id,
      action: toJsonValue(interaction.action),
    },
  };
}

function buildNavbar(
  input: ViewerIntegrationInput,
  capabilities: ReadonlySet<string>,
): JsonValue[] {
  const controls = input.settings.navigation;
  const navbar: JsonValue[] = [];
  if (controls?.navigationButtons ?? true) {
    navbar.push('move');
  }
  if (controls?.zoom ?? true) {
    navbar.push('zoom');
  }
  if (capabilities.has('gyroscope')) {
    navbar.push('gyroscope');
  }
  if (capabilities.has('stereo') || capabilities.has('vr')) {
    navbar.push('stereo');
  }
  if (controls?.fullscreen ?? true) {
    navbar.push('fullscreen');
  }
  if (input.settings.compass?.enabled ?? false) {
    navbar.push('compass');
  }
  if (input.settings.gallery?.enabled ?? false) {
    navbar.push('gallery');
  }
  return navbar;
}

/**
 * Map and plan views are driven by the compiled spatial index, so the renderer
 * never needs to fetch scene definitions to draw them.
 */
function buildMapConfiguration(
  input: ViewerIntegrationInput,
  spatialIndex: CompiledSpatialIndex,
): JsonObject {
  const settings = input.settings.map;
  return {
    enabled: true,
    coordinateSystem: 'wgs84',
    ...(settings?.defaultZoom === undefined ? {} : { defaultZoom: settings.defaultZoom }),
    showHeadingCone: settings?.showHeadingCone ?? true,
    ...(spatialIndex.bounds === undefined ? {} : { bounds: { ...spatialIndex.bounds } }),
    hotspots: (settings?.showSceneMarkers ?? true)
      ? spatialIndex.entries.flatMap((entry) => {
        if (typeof entry.spatial.latitude !== 'number'
          || typeof entry.spatial.longitude !== 'number') return [];
        return [{
          id: entry.sceneId,
          nodeId: entry.sceneId,
          tooltip: entry.name,
          gps: [entry.spatial.longitude, entry.spatial.latitude],
          ...(entry.spatial.headingDegrees === undefined
            ? {}
            : { yaw: degreesToRadians(entry.spatial.headingDegrees) }),
        }];
      })
      : [],
  };
}

function buildPlanConfiguration(
  input: ViewerIntegrationInput,
  plans: readonly CompiledPlan[],
): JsonObject {
  const settings = input.settings.plan;
  const defaultPlanId = settings?.defaultPlanId ?? plans[0]?.id;
  return {
    enabled: true,
    ...(defaultPlanId === undefined ? {} : { defaultPlanId }),
    showHeadingCone: settings?.showHeadingCone ?? true,
    layers: plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      coordinateSystem: plan.coordinateSystem,
      ...(plan.image === undefined ? {} : { imageUrl: plan.image.url }),
      hotspots: (settings?.showSceneMarkers ?? true)
        ? (input.spatialIndex?.entries ?? []).flatMap((entry) => {
          if (entry.spatial.planId !== plan.id
            || typeof entry.spatial.mapX !== 'number'
            || typeof entry.spatial.mapY !== 'number') return [];
          return [{
            id: entry.sceneId,
            nodeId: entry.sceneId,
            tooltip: entry.name,
            x: entry.spatial.mapX,
            y: entry.spatial.mapY,
            ...(entry.spatial.headingDegrees === undefined
              ? {}
              : { yaw: degreesToRadians(entry.spatial.headingDegrees) }),
          }];
        })
        : [],
    })),
  };
}

function selectAdapter(scene: CompiledScene): string {
  switch (scene.panorama.family) {
    case 'tiledEquirectangular':
      return 'equirectangular-tiles';
    case 'tiledCubemap':
      return 'cubemap-tiles';
    case 'cubemap':
      return 'cubemap';
    default:
      return 'equirectangular';
  }
}

function buildGalleryConfiguration(input: ViewerIntegrationInput): JsonObject {
  const gallery = input.settings.gallery;
  const index = input.sceneIndex ?? input.scenes;
  return {
    enabled: gallery?.enabled ?? false,
    showSceneNames: gallery?.showSceneNames ?? true,
    showThumbnails: gallery?.showThumbnails ?? true,
    items: (gallery?.enabled ?? false)
      ? index.map((entry) => {
        const compiledScene = input.scenes.find((scene) => scene.id === entry.id);
        const thumbnail = 'thumbnail' in entry
          ? entry.thumbnail.url
          : compiledScene?.panorama.base.url;
        return {
          id: entry.id,
          name: entry.name,
          ...(thumbnail === undefined ? {} : { thumbnail }),
        };
      })
      : [],
  };
}

function buildAutorotationConfiguration(input: ViewerIntegrationInput): JsonObject {
  const autorotation = input.settings.autorotation;
  const direction = autorotation?.direction ?? 'clockwise';
  const speed = autorotation?.speedDegreesPerSecond ?? 1;
  return {
    enabled: autorotation?.enabled ?? false,
    startAutomatically: autorotation?.startAutomatically ?? false,
    speedDegreesPerSecond: direction === 'counterclockwise' ? -speed : speed,
  };
}

function buildSceneConfiguration(scene: CompiledScene): JsonObject {
  const initialView = scene.initialView;
  const tiles = scene.panorama.tiles;
  const usesTiles = tiles !== undefined && scene.panorama.family === 'tiledEquirectangular';
  return {
    id: scene.id,
    adapter: selectAdapter(scene),
    panorama: !usesTiles
      ? scene.panorama.family === 'cubemap' && scene.panorama.cubemap !== undefined
        ? scene.panorama.cubemap.url
        : scene.panorama.primary.url
      : {
        baseUrl: scene.panorama.base.url,
        tileUrlTemplate: tiles.tileUrlTemplate,
        tileSize: tiles.tileSize,
        levels: tiles.levels.map((level) => ({ ...level })),
      },
    basePanorama: scene.panorama.base.url,
    ...(scene.panorama.crop === undefined
      ? {}
      : { panoData: buildPanoData(scene) }),
    ...(scene.panorama.sphereCorrection === undefined
      ? {}
      : { sphereCorrection: buildSphereCorrection(scene) }),
    defaultYaw: degreesToRadians(initialView.headingDegrees ?? 0),
    defaultPitch: degreesToRadians(initialView.pitchDegrees ?? 0),
    defaultZoomLvl: fieldOfViewToZoomLevel(initialView.horizontalFovDegrees),
    ...(scene.viewLimits === undefined ? {} : { visibleRange: buildVisibleRange(scene) }),
    markers: [
      ...scene.hotspots.map(buildMarkerConfiguration),
      ...scene.overlays.map(buildOverlayConfiguration),
    ],
    links: scene.connections.flatMap((connection) => {
      const targetSceneId = connection.targetSceneId;
      if (typeof targetSceneId !== 'string') return [];
      return [{
        id: typeof connection.id === 'string' ? connection.id : `${scene.id}:${targetSceneId}`,
        nodeId: targetSceneId,
        ...(typeof connection.label === 'string' ? { label: connection.label } : {}),
      }];
    }),
    preloadSceneIds: [...scene.preloadSceneIds],
  };
}

function buildVisibleRange(scene: CompiledScene): JsonObject {
  const limits = scene.viewLimits!;
  return {
    longitude: [
      degreesToRadians(limits.minHeadingDegrees ?? -180),
      degreesToRadians(limits.maxHeadingDegrees ?? 180),
    ],
    latitude: [
      degreesToRadians(limits.minPitchDegrees ?? -90),
      degreesToRadians(limits.maxPitchDegrees ?? 90),
    ],
  };
}

/**
 * The renderer applies the inverse of the capture pose, so a panorama shot with
 * the camera rolled 5 degrees right is rendered 5 degrees back to level.
 */
function buildSphereCorrection(scene: CompiledScene): JsonObject {
  const correction = scene.panorama.sphereCorrection!;
  return {
    pan: degreesToRadians(-correction.headingDegrees),
    tilt: degreesToRadians(-correction.pitchDegrees),
    roll: degreesToRadians(-correction.rollDegrees),
  };
}

function buildPanoData(scene: CompiledScene): JsonObject {
  const crop = scene.panorama.crop!;
  const renderedWidth = scene.panorama.primary.width ?? crop.croppedWidthPixels;
  const renderedHeight = scene.panorama.primary.height ?? crop.croppedHeightPixels;
  const horizontalScale = renderedWidth / crop.croppedWidthPixels;
  const verticalScale = renderedHeight / crop.croppedHeightPixels;
  return {
    fullWidth: Math.round(crop.fullWidthPixels * horizontalScale),
    fullHeight: Math.round(crop.fullHeightPixels * verticalScale),
    croppedWidth: renderedWidth,
    croppedHeight: renderedHeight,
    croppedX: Math.round(crop.croppedLeftPixels * horizontalScale),
    croppedY: Math.round(crop.croppedTopPixels * verticalScale),
  };
}

function buildMarkerConfiguration(hotspot: CompiledHotspot): JsonObject {
  const content = hotspot.content;
  const candidateHtml = content?.tooltip
    ?? content?.bodyHtml
    ?? content?.description
    ?? content?.title
    ?? hotspot.appearance?.label
    ?? '';

  return {
    id: hotspot.id,
    position: {
      yaw: degreesToRadians(hotspot.position.longitudeDegrees),
      pitch: degreesToRadians(hotspot.position.latitudeDegrees),
    },
    ...buildGeometryConfiguration(hotspot.geometry, candidateHtml),
    visible: hotspot.enabled,
    data: {
      action: toJsonValue(hotspot.action),
    },
  };
}

function buildOverlayConfiguration(overlay: CompiledOverlay): JsonObject {
  const content = overlay.content;
  const candidateHtml = content?.tooltip
    ?? content?.bodyHtml
    ?? content?.description
    ?? content?.title
    ?? overlay.appearance?.label
    ?? '';
  const appearance = overlay.appearance;
  return {
    id: overlay.id,
    ...(overlay.position === undefined
      ? {}
      : {
        position: {
          yaw: degreesToRadians(overlay.position.longitudeDegrees),
          pitch: degreesToRadians(overlay.position.latitudeDegrees),
        },
      }),
    ...buildGeometryConfiguration(overlay.geometry, candidateHtml),
    ...(appearance === undefined
      ? {}
      : {
        style: {
          ...(appearance.color === undefined
            ? {}
            : { fill: appearance.color, stroke: appearance.color }),
          ...(appearance.fillOpacity === undefined
            ? {}
            : { fillOpacity: appearance.fillOpacity }),
          ...(appearance.strokeWidth === undefined
            ? {}
            : { strokeWidth: appearance.strokeWidth }),
        },
      }),
    visible: overlay.enabled,
    data: {
      overlayId: overlay.id,
      action: toJsonValue(overlay.action),
    },
  };
}

/**
 * The single place where a canonical geometry family becomes renderer marker
 * configuration. Adding a family here must never require a data migration.
 */
function buildGeometryConfiguration(
  geometry: CompiledInteractionGeometry,
  candidateHtml: string,
): JsonObject {
  switch (geometry.kind) {
    case 'polygon':
      return {
        polygon: geometry.vertices.map((vertex) => [
          degreesToRadians(vertex.longitudeDegrees),
          degreesToRadians(vertex.latitudeDegrees),
        ]),
        ...(candidateHtml.length === 0
          ? {}
          : { tooltip: sanitizeRichHtml(candidateHtml) }),
      };
    case 'polyline':
      return {
        polyline: geometry.vertices.map((vertex) => [
          degreesToRadians(vertex.longitudeDegrees),
          degreesToRadians(vertex.latitudeDegrees),
        ]),
        ...(candidateHtml.length === 0
          ? {}
          : { tooltip: sanitizeRichHtml(candidateHtml) }),
      };
    case 'imageLayer':
      return {
        imageLayer: geometry.media.url,
        size: {
          width: geometry.anchor.widthDegrees,
          height: geometry.anchor.heightDegrees,
        },
        ...(geometry.anchor.rotationDegrees === undefined
          ? {}
          : { rotation: degreesToRadians(geometry.anchor.rotationDegrees) }),
        ...(geometry.anchor.opacity === undefined ? {} : { opacity: geometry.anchor.opacity }),
      };
    case 'videoLayer':
      return {
        videoLayer: geometry.media.url,
        size: {
          width: geometry.anchor.widthDegrees,
          height: geometry.anchor.heightDegrees,
        },
        ...(geometry.anchor.chromaKeyColor === undefined
          ? {}
          : { chromaKey: { enabled: true, color: geometry.anchor.chromaKeyColor } }),
        ...(geometry.anchor.opacity === undefined ? {} : { opacity: geometry.anchor.opacity }),
      };
    case 'custom':
      return {
        element: {
          extensionId: geometry.extensionId,
          extensionVersion: geometry.extensionVersion,
          // Allow-listed at registration; the player loads nothing else.
          module: geometry.runtimeModule,
          payload: toJsonValue(geometry.payload),
        },
      };
    default:
      return {
        html: sanitizeRichHtml(candidateHtml) || '<span aria-hidden="true">&#9679;</span>',
      };
  }
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function fieldOfViewToZoomLevel(value: number | undefined): number {
  if (value === undefined) {
    return 50;
  }
  // PSV zoom is 0..100. The product model remains a portable field-of-view.
  return Math.round(Math.max(0, Math.min(100, (179 - value) / 178 * 100)) * 1_000) / 1_000;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
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
