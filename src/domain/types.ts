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
}

export interface CanonicalInformationSettings extends JsonObject {
  readonly title?: string;
  readonly description?: string;
  readonly bodyHtml?: string;
  readonly externalUrl?: string;
}

export interface CanonicalProjectSettings extends JsonObject {
  readonly appearance?: CanonicalAppearanceSettings;
  readonly navigation?: CanonicalNavigationSettings;
  readonly information?: CanonicalInformationSettings;
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
  readonly connections?: readonly JsonObject[];
  readonly spatialData?: JsonObject;
  readonly runtimeHints?: JsonObject;
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
