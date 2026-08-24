import { sanitizeRichHtml } from '../security/html-sanitizer';
import type { JsonObject, JsonValue } from '../domain/types';
import type {
  CompiledHotspot,
  CompiledScene,
  ViewerIntegrationAdapter,
  ViewerIntegrationInput,
  ViewerIntegrationOutput,
} from './types';

export const PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION = 'psv-5.14.3-adapter-1' as const;

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

    const config: JsonObject = {
      adapter: 'equirectangular',
      initialSceneId: input.initialSceneId,
      navbar: buildNavbar(input),
      mousewheel: input.settings.navigation?.zoom ?? true,
      mousemove: (input.settings.navigation?.mouse ?? true)
        && (input.settings.navigation?.touch ?? true),
      keyboard: input.settings.navigation?.keyboard ?? true,
      startup: buildSceneConfiguration(initialScene),
      scenes: input.scenes.map(buildSceneConfiguration),
    };

    return Object.freeze({
      rendererId: 'photo-sphere-viewer',
      viewerIntegrationVersion: this.viewerIntegrationVersion,
      config: deepFreeze(config),
    });
  }
}

function buildNavbar(input: ViewerIntegrationInput): JsonValue[] {
  const controls = input.settings.navigation;
  const navbar: JsonValue[] = [];
  if (controls?.navigationButtons ?? true) {
    navbar.push('move');
  }
  if (controls?.zoom ?? true) {
    navbar.push('zoom');
  }
  if (controls?.fullscreen ?? true) {
    navbar.push('fullscreen');
  }
  return navbar;
}

function buildSceneConfiguration(scene: CompiledScene): JsonObject {
  const initialView = scene.initialView;
  return {
    id: scene.id,
    panorama: scene.panorama.primary.url,
    basePanorama: scene.panorama.base.url,
    ...(scene.panorama.crop === undefined
      ? {}
      : { panoData: buildPanoData(scene) }),
    defaultYaw: degreesToRadians(initialView.headingDegrees ?? 0),
    defaultPitch: degreesToRadians(initialView.pitchDegrees ?? 0),
    defaultZoomLvl: fieldOfViewToZoomLevel(initialView.horizontalFovDegrees),
    markers: scene.hotspots.map(buildMarkerConfiguration),
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
  const html = sanitizeRichHtml(candidateHtml) || '<span aria-hidden="true">&#9679;</span>';

  return {
    id: hotspot.id,
    position: {
      yaw: degreesToRadians(hotspot.position.longitudeDegrees),
      pitch: degreesToRadians(hotspot.position.latitudeDegrees),
    },
    html,
    visible: hotspot.enabled,
    data: {
      action: toJsonValue(hotspot.action),
    },
  };
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
