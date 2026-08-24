/**
 * Renderer-independent contracts for the canonical Experience model.
 *
 * Deliberately keep renderer terminology (for example PSV adapter/plugin
 * configuration and yaw/pitch radians) out of this module. The compiler's
 * integration adapter is the only boundary that may introduce those details.
 */

import type { AssetProcessingFailure, AssetProcessingStatus } from './asset-processing';

export const CURRENT_EXPERIENCE_SCHEMA_VERSION = 1 as const;

export const PROJECT_TYPES = ['image360', 'video360'] as const;
export type CanonicalProjectType = (typeof PROJECT_TYPES)[number];

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface CanonicalAppearanceSettings extends JsonObject {
  readonly theme?: 'light' | 'dark' | 'custom';
  readonly backgroundColor?: string;
  readonly primaryColor?: string;
  readonly hotspotStyle?: string;
  readonly typography?: string;
}

export interface CanonicalNavigationSettings extends JsonObject {
  readonly mouse?: boolean;
  readonly touch?: boolean;
  readonly zoom?: boolean;
  readonly keyboard?: boolean;
  readonly fullscreen?: boolean;
  readonly navigationButtons?: boolean;
  readonly sceneNavigation?: boolean;
}

export interface CanonicalGallerySettings extends JsonObject {
  readonly enabled?: boolean;
  readonly showSceneNames?: boolean;
  readonly showThumbnails?: boolean;
}

export interface CanonicalAutorotationSettings extends JsonObject {
  readonly enabled?: boolean;
  /** Product-level angular speed; renderer-specific units are resolved by the adapter. */
  readonly speedDegreesPerSecond?: number;
  readonly direction?: 'clockwise' | 'counterclockwise';
  readonly startAutomatically?: boolean;
}

export interface CanonicalCompassSettings extends JsonObject {
  readonly enabled?: boolean;
}

export interface CanonicalQualitySettings extends JsonObject {
  readonly preference?: 'automatic' | 'standard' | 'high';
}

export interface CanonicalInformationSettings extends JsonObject {
  readonly title?: string;
  readonly description?: string;
  readonly bodyHtml?: string;
  readonly externalUrl?: string;
}

/**
 * Product-level playback preferences. Codecs, bitrate ladders, container
 * choices and transcoder vendor settings are deliberately absent: those are
 * infrastructure configuration resolved by the media pipeline, never project
 * data.
 */
export interface CanonicalVideoSettings extends JsonObject {
  readonly autoplay?: boolean;
  readonly loop?: boolean;
  readonly muted?: boolean;
  readonly showControls?: boolean;
  readonly showTimeline?: boolean;
  readonly startAtMs?: number;
  /** Product-level bias; the runtime still applies device capability policy. */
  readonly qualityPreference?: 'automatic' | 'dataSaver' | 'high';
}

export interface CanonicalProjectSettings extends JsonObject {
  readonly appearance?: CanonicalAppearanceSettings;
  readonly navigation?: CanonicalNavigationSettings;
  readonly gallery?: CanonicalGallerySettings;
  readonly autorotation?: CanonicalAutorotationSettings;
  readonly compass?: CanonicalCompassSettings;
  readonly quality?: CanonicalQualitySettings;
  readonly information?: CanonicalInformationSettings;
  readonly video?: CanonicalVideoSettings;
}

export interface CanonicalBranding extends JsonObject {
  readonly companyName?: string;
  readonly logoAssetId?: string;
  readonly faviconAssetId?: string;
  readonly watermarkAssetId?: string;
  readonly primaryColor?: string;
  readonly welcomeMessage?: string;
  readonly loadingMessage?: string;
}

/** Product-level orientation. Values are degrees, not renderer radians. */
export interface SphericalPosition {
  readonly coordinateSystem: 'spherical_degrees';
  readonly longitudeDegrees: number;
  readonly latitudeDegrees: number;
}

export interface CanonicalInitialView extends JsonObject {
  readonly headingDegrees?: number;
  readonly pitchDegrees?: number;
  readonly horizontalFovDegrees?: number;
}

export interface CanonicalViewLimits extends JsonObject {
  readonly minHeadingDegrees?: number;
  readonly maxHeadingDegrees?: number;
  readonly minPitchDegrees?: number;
  readonly maxPitchDegrees?: number;
}

export type CanonicalHotspotGeometry =
  | { readonly kind: 'point' }
  | {
      readonly kind: 'polygon';
      readonly vertices: readonly SphericalPosition[];
    }
  | {
      readonly kind: 'polyline';
      readonly vertices: readonly SphericalPosition[];
    }
  | {
      readonly kind: 'layer';
      readonly layerAssetId: string;
    };

export interface CanonicalHotspotAppearance extends JsonObject {
  readonly label?: string;
  readonly iconAssetId?: string;
  readonly color?: string;
  readonly emphasis?: 'normal' | 'prominent' | 'subtle';
}

export interface CanonicalHotspotContent extends JsonObject {
  readonly title?: string;
  readonly description?: string;
  readonly bodyHtml?: string;
  readonly tooltip?: string;
  readonly buttonLabel?: string;
  readonly externalUrl?: string;
  readonly imageAssetId?: string;
  readonly videoAssetId?: string;
}

export type CanonicalHotspotAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'showInformation' }
  | {
      readonly kind: 'openUrl';
      readonly url: string;
    }
  | { readonly kind: 'openAsset'; readonly assetId: string }
  | { readonly kind: 'goToScene'; readonly sceneId: string };

export interface CanonicalVisibilityRules extends JsonObject {
  readonly enabled?: boolean;
}

export interface CanonicalHotspot {
  readonly id: string;
  readonly sceneId: string;
  readonly geometry: CanonicalHotspotGeometry;
  readonly position: SphericalPosition;
  readonly appearance?: CanonicalHotspotAppearance;
  readonly content?: CanonicalHotspotContent;
  readonly action: CanonicalHotspotAction;
  readonly visibilityRules?: CanonicalVisibilityRules;
}

export interface CanonicalSceneConnectionContent extends JsonObject {
  readonly title?: string;
  readonly description?: string;
}

export interface CanonicalSceneConnection {
  readonly id: string;
  readonly sourceSceneId: string;
  readonly targetSceneId: string;
  readonly triggerHotspotId?: string;
  readonly label?: string;
  readonly content?: CanonicalSceneConnectionContent;
  /** A portable product hint from 0 (ordinary) through 100 (strongest). */
  readonly importance?: number;
  readonly preloadHint?: 'none' | 'normal' | 'high';
  readonly createdAt?: Date | string;
}

export interface CanonicalSceneRuntimeHints extends JsonObject {
  readonly preloadPriority?: number;
  readonly likelyNextSceneIds?: string[];
  readonly qualityPreference?: 'automatic' | 'standard' | 'high';
}

export interface CanonicalScene {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly panoramaAssetId: string | null;
  readonly sortOrder?: number;
  readonly isPrimary?: boolean;
  readonly initialView?: CanonicalInitialView;
  readonly viewLimits?: CanonicalViewLimits;
  readonly hotspots: readonly CanonicalHotspot[];
  readonly overlays?: readonly JsonObject[];
  readonly connections?: readonly CanonicalSceneConnection[];
  readonly spatialData?: JsonObject;
  readonly runtimeHints?: CanonicalSceneRuntimeHints;
}

/**
 * Product vocabulary for timed video interactions. These are creator-facing
 * concepts, not renderer plugin or viewer event names.
 */
export const TIMELINE_INTERACTION_KINDS = [
  'information',
  'hotspot',
  'viewpoint',
  'image',
  'video',
  'link',
  'cta',
] as const;
export type CanonicalTimelineInteractionKind = (typeof TIMELINE_INTERACTION_KINDS)[number];

/** A product-level camera target expressed in degrees, not renderer radians. */
export interface CanonicalViewpoint extends JsonObject {
  readonly headingDegrees: number;
  readonly pitchDegrees: number;
  readonly horizontalFovDegrees?: number;
  readonly transition?: 'cut' | 'smooth';
  readonly transitionMs?: number;
}

export interface CanonicalTimelineContent extends CanonicalHotspotContent {
  readonly ctaLabel?: string;
  readonly ctaUrl?: string;
}

export type CanonicalTimelineAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'showInformation' }
  | { readonly kind: 'openUrl'; readonly url: string }
  | { readonly kind: 'openAsset'; readonly assetId: string }
  | { readonly kind: 'setViewpoint' };

export interface CanonicalTimelineVisibilityRules extends JsonObject {
  readonly enabled?: boolean;
  /** Keep the interaction on screen until dismissed rather than until endTimeMs. */
  readonly persistUntilDismissed?: boolean;
  readonly pauseVideoWhenShown?: boolean;
}

export interface CanonicalTimelineInteraction {
  readonly id: string;
  readonly projectId: string;
  readonly kind: CanonicalTimelineInteractionKind;
  readonly timeMs: number;
  readonly endTimeMs?: number | null;
  readonly geometry?: CanonicalHotspotGeometry;
  readonly position?: SphericalPosition;
  readonly viewpoint?: CanonicalViewpoint;
  readonly appearance?: CanonicalHotspotAppearance;
  readonly content?: CanonicalTimelineContent;
  readonly action: CanonicalTimelineAction;
  readonly visibilityRules?: CanonicalTimelineVisibilityRules;
  /** Deterministic tie-break when two interactions share a timestamp. */
  readonly sortOrder?: number;
  readonly createdAt?: Date | string;
  readonly updatedAt?: Date | string;
}

export interface CanonicalPublicationMetadata extends JsonObject {
  readonly slug?: string;
  readonly visibility?: 'public' | 'private' | 'unlisted';
}

export interface CanonicalProject {
  readonly id: string;
  readonly ownerId: string;
  readonly type: CanonicalProjectType;
  readonly name: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly settings: CanonicalProjectSettings;
  readonly branding: CanonicalBranding;
  readonly scenes: readonly CanonicalScene[];
  /** Present for `video360` projects; the primary logical 360 video asset. */
  readonly videoAssetId?: string | null;
  /** Present for `video360` projects; ordered by time then deterministic key. */
  readonly timeline?: readonly CanonicalTimelineInteraction[];
  readonly publication?: CanonicalPublicationMetadata;
}

export const ASSET_MEDIA_TYPES = [
  'panorama_image',
  'image',
  'video360',
  'video',
  'audio',
  'logo',
  'other',
] as const;
export type CanonicalAssetMediaType = (typeof ASSET_MEDIA_TYPES)[number];

export const ASSET_PROJECTIONS = [
  'equirectangular',
  'cropped_equirectangular',
  'cubemap',
  'dual_fisheye',
  'unknown',
] as const;
export type CanonicalAssetProjection = (typeof ASSET_PROJECTIONS)[number];

export const ASSET_DERIVATIVE_KINDS = [
  'thumbnail',
  'lowResolutionBase',
  'standardWeb',
  'tiledLevels',
  'cubemap',
  'videoPoster',
  'desktopVideoProfile',
  'mobileVideoProfile',
] as const;
export type AssetDerivativeKind = (typeof ASSET_DERIVATIVE_KINDS)[number];

export type AssetDerivativeReadiness = 'ready' | 'processing' | 'failed';

export interface AssetDerivative {
  readonly id: string;
  readonly assetId: string;
  readonly kind: AssetDerivativeKind;
  readonly version: number;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly sizeBytes: number | string;
  /** Existing catalogs without per-derivative state are treated as ready. */
  readonly readiness?: AssetDerivativeReadiness;
  readonly metadata?: JsonObject;
  readonly createdAt?: Date | string;
}

export interface CanonicalAsset {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId?: string | null;
  readonly mediaType: CanonicalAssetMediaType;
  readonly projection: CanonicalAssetProjection;
  readonly processingStatus: AssetProcessingStatus;
  readonly processingError?: AssetProcessingFailure | JsonObject | null;
  readonly derivatives: readonly AssetDerivative[];
  readonly metadata?: JsonObject;
}
