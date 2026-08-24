import type {
  AssetDerivative,
  AssetDerivativeKind,
  CanonicalAsset,
  CanonicalInitialView,
  CanonicalLayerAnchor,
  CanonicalProject,
  CanonicalProjectSettings,
  CanonicalSpatialData,
  CanonicalSpatialCoordinateSystem,
  CanonicalTimelineInteraction,
  CanonicalTimelineInteractionKind,
  CanonicalViewpoint,
  CanonicalViewLimits,
  JsonObject,
  PanoramaDerivativeFamily,
  SphericalPosition,
} from '../domain/types';
import type {
  AppliedCapabilityFallback,
  CapabilityId,
  DeferredDeviceCapability,
  DeviceRequirement,
  RuntimeModuleDeclaration,
} from '../capabilities/types';
import type {
  CompiledRuntimeCachePolicy,
  SceneTransitionFailureCategory,
  VideoPlaybackProfileId,
  VideoProfileCandidate,
} from '../runtime';
import type { ExtensionRegistrySnapshot } from '../extensions/types';
import type { CompiledPanoramaCrop } from './panorama-metadata';

export type { CompiledPanoramaCrop } from './panorama-metadata';

export const COMPILED_MANIFEST_VERSION = 4 as const;
export const COMPILED_SCENE_VERSION = 2 as const;

export type CompileTarget = 'preview' | 'publication';
export type PublicationVisibility = 'public' | 'private';
export type MediaAccess = 'protected' | 'public';

export interface CompileExperienceInput {
  readonly project: CanonicalProject;
  readonly assets: readonly CanonicalAsset[];
  readonly target: CompileTarget;
  readonly publicationRevision?: number;
  readonly visibility?: PublicationVisibility;
  /** Required for revision-pinned progressive scene URLs in published output. */
  readonly publicationSlug?: string;
  /** Enables custom interaction validation and runtime module allow-listing. */
  readonly extensions?: ExtensionRegistrySnapshot;
}

export interface MediaUrlResolutionRequest {
  readonly experienceId: string;
  readonly assetId: string;
  readonly derivative: AssetDerivative;
  readonly access: MediaAccess;
  readonly target: CompileTarget;
  readonly publicationRevision?: number;
}

export interface ResolvedMediaUrl {
  readonly url: string;
  readonly expiresAt?: string;
}

export type MediaUrlResolution = string | ResolvedMediaUrl;

export interface MediaUrlResolver {
  resolve(request: MediaUrlResolutionRequest): MediaUrlResolution | Promise<MediaUrlResolution>;
}

export interface CompiledMediaReference {
  readonly assetId: string;
  readonly derivativeId: string;
  readonly kind: AssetDerivativeKind;
  readonly version: number;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly url: string;
  readonly access: MediaAccess;
  readonly expiresAt?: string;
}

export interface CompiledPanoramaMedia {
  readonly assetId: string;
  readonly projection: 'equirectangular' | 'cropped_equirectangular' | 'cubemap';
  /** The delivery family chosen by the quality policy for this scene. */
  readonly family: PanoramaDerivativeFamily;
  readonly fallbackFamilies: readonly PanoramaDerivativeFamily[];
  readonly crop?: CompiledPanoramaCrop;
  readonly base: CompiledMediaReference;
  readonly primary: CompiledMediaReference;
  readonly tiles?: CompiledTiledPanoramaMedia;
  readonly cubemap?: CompiledMediaReference;
}

export interface CompiledTileLevel {
  readonly level: number;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
}

export interface CompiledTiledPanoramaMedia {
  readonly manifest: CompiledMediaReference;
  /** A delivery URL template using {level}, {x}, and {y} placeholders. */
  readonly tileUrlTemplate: string;
  readonly tileSize: number;
  readonly levels: readonly CompiledTileLevel[];
}

export interface CompiledInformationButton {
  readonly label: string;
  readonly url: string;
}

export type CompiledHotspotAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'showInformation' }
  | { readonly kind: 'openUrl'; readonly url: string }
  | {
      readonly kind: 'openAsset';
      readonly media: CompiledMediaReference;
    }
  | { readonly kind: 'goToScene'; readonly sceneId: string };

export interface CompiledHotspotContent {
  readonly title?: string;
  readonly description?: string;
  readonly bodyHtml?: string;
  readonly tooltip?: string;
  readonly buttonLabel?: string;
  readonly externalUrl?: string;
  readonly imageAssetId?: string;
  readonly videoAssetId?: string;
  readonly image?: CompiledMediaReference;
  readonly video?: CompiledMediaReference;
  readonly properties: JsonObject;
}

export interface CompiledHotspotAppearance {
  readonly label?: string;
  readonly iconAssetId?: string;
  readonly color?: string;
  readonly emphasis?: 'normal' | 'prominent' | 'subtle';
  readonly properties: JsonObject;
  readonly icon?: CompiledMediaReference;
}

/**
 * Compiled interaction geometry. Layer assets are already resolved to delivery
 * references, and a custom geometry carries the allow-listed runtime module
 * rather than an arbitrary client entry point.
 */
export type CompiledInteractionGeometry =
  | { readonly kind: 'point' }
  | { readonly kind: 'polygon'; readonly vertices: readonly SphericalPosition[] }
  | { readonly kind: 'polyline'; readonly vertices: readonly SphericalPosition[] }
  | {
      readonly kind: 'imageLayer';
      readonly media: CompiledMediaReference;
      readonly anchor: CanonicalLayerAnchor;
    }
  | {
      readonly kind: 'videoLayer';
      readonly media: CompiledMediaReference;
      readonly anchor: CanonicalLayerAnchor;
    }
  | {
      readonly kind: 'custom';
      readonly extensionId: string;
      readonly extensionVersion: string;
      readonly runtimeModule: string;
      readonly payload: JsonObject;
    };

export interface CompiledHotspot {
  readonly id: string;
  readonly geometry: CompiledInteractionGeometry;
  readonly position: SphericalPosition;
  readonly appearance?: CompiledHotspotAppearance;
  readonly content?: CompiledHotspotContent;
  readonly action: CompiledHotspotAction;
  readonly enabled: boolean;
  readonly visibilityRules: JsonObject;
}

export interface CompiledOverlayAppearance {
  readonly label?: string;
  readonly color?: string;
  readonly fillOpacity?: number;
  readonly strokeWidth?: number;
  readonly emphasis?: 'normal' | 'prominent' | 'subtle';
  readonly properties: JsonObject;
}

export interface CompiledOverlay {
  readonly id: string;
  readonly name?: string;
  readonly geometry: CompiledInteractionGeometry;
  readonly position?: SphericalPosition;
  readonly appearance?: CompiledOverlayAppearance;
  readonly content?: CompiledHotspotContent;
  readonly action: CompiledHotspotAction;
  readonly enabled: boolean;
  readonly visibilityRules: JsonObject;
}

/** A scene's position in the world and/or on a plan, ready for the player. */
export interface CompiledSceneSpatial {
  readonly coordinateSystem?: CanonicalSpatialCoordinateSystem;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly altitudeMeters?: number;
  readonly headingDegrees?: number;
  readonly planId?: string;
  readonly mapX?: number;
  readonly mapY?: number;
}

export interface CompiledPlan {
  readonly id: string;
  readonly name: string;
  readonly coordinateSystem: Exclude<CanonicalSpatialCoordinateSystem, 'wgs84'>;
  readonly sortOrder: number;
  readonly image?: CompiledMediaReference;
  readonly sceneIds: readonly string[];
  readonly metadata: JsonObject;
}

export interface CompiledSpatialIndexEntry {
  readonly sceneId: string;
  readonly name: string;
  readonly spatial: CompiledSceneSpatial;
}

/**
 * Everything the map and plan views need without fetching scene definitions.
 * A large tour can therefore draw its whole map from the initial manifest.
 */
export interface CompiledSpatialIndex {
  readonly hasWorldCoordinates: boolean;
  readonly hasPlanCoordinates: boolean;
  readonly entries: readonly CompiledSpatialIndexEntry[];
  readonly bounds?: {
    readonly minLatitude: number;
    readonly maxLatitude: number;
    readonly minLongitude: number;
    readonly maxLongitude: number;
  };
}

export interface CompiledScene {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isPrimary: boolean;
  readonly panorama: CompiledPanoramaMedia;
  readonly initialView: CanonicalInitialView;
  readonly viewLimits?: CanonicalViewLimits;
  readonly hotspots: readonly CompiledHotspot[];
  readonly overlays: readonly CompiledOverlay[];
  readonly connections: readonly JsonObject[];
  readonly spatialData: CompiledSceneSpatial;
  readonly runtimeHints: JsonObject;
  readonly preloadSceneIds: readonly string[];
}

export interface CompiledSceneIndexEntry {
  readonly id: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isPrimary: boolean;
  readonly panoramaAssetId: string;
  /** Lightweight/base media used by gallery UIs without fetching the full scene definition. */
  readonly thumbnail: CompiledMediaReference;
  readonly hasHotspots: boolean;
  readonly hasOverlays: boolean;
  readonly spatial?: CompiledSceneSpatial;
  readonly connectionTargetSceneIds: readonly string[];
}

export type TourDeliveryStrategy = 'embedded' | 'progressive';

export interface CompiledTourDelivery {
  readonly strategy: TourDeliveryStrategy;
  readonly sceneIndexVersion: string;
  /** The whole index, or only its first segment when `sceneIndexSegmented`. */
  readonly sceneIndex: readonly CompiledSceneIndexEntry[];
  readonly sceneDefinitionUrlTemplate?: string;
  /** Present when the index is too large to ship whole; see `sceneIndexUrl`. */
  readonly sceneIndexSegmented?: boolean;
  readonly sceneIndexSegmentSize?: number;
  readonly sceneIndexUrl?: string;
  readonly sceneCount: number;
}

export interface CompiledBranding {
  readonly companyName?: string;
  readonly logoAssetId?: string;
  readonly faviconAssetId?: string;
  readonly watermarkAssetId?: string;
  readonly primaryColor?: string;
  readonly welcomeMessage?: string;
  readonly loadingMessage?: string;
  readonly properties: JsonObject;
  readonly logo?: CompiledMediaReference;
  readonly favicon?: CompiledMediaReference;
  readonly watermark?: CompiledMediaReference;
}

export interface RuntimeCapabilityDeclaration {
  readonly id: CapabilityId;
  readonly required: boolean;
  readonly fallback?: string;
  /** Requirements the player must confirm before enabling the capability. */
  readonly deviceRequirements?: readonly DeviceRequirement[];
  readonly resolution: 'compile-time' | 'runtime';
}

export interface CompiledRuntimeCacheContract {
  readonly defaultProfile: 'standard';
  readonly profiles: {
    readonly constrained: CompiledRuntimeCachePolicy;
    readonly standard: CompiledRuntimeCachePolicy;
    readonly capable: CompiledRuntimeCachePolicy;
  };
}

export interface RuntimePreloadDeclaration {
  readonly strategy: 'selective-adjacent' | 'video-progressive';
  readonly maxScenesPerSource: number;
  readonly content: 'scene-definition-and-base-media' | 'poster-and-first-video-segments';
}

export interface RuntimeFallbackPolicy {
  readonly panorama?: 'low-resolution-base-then-standard-or-tiled-detail';
  readonly video?: 'ordered-playback-profile-candidates';
  readonly optionalCapabilities: 'continue-without-capability';
  /** Motion, stereo and immersive viewing always degrade to normal 360. */
  readonly immersive?: 'continue-in-normal-360';
}

export interface RuntimeDeclarations {
  readonly modules: readonly string[];
  readonly moduleDeclarations: readonly RuntimeModuleDeclaration[];
  readonly capabilityFallbacks: readonly AppliedCapabilityFallback[];
  /** Capabilities whose device support the player decides, with their fallback. */
  readonly deferredDeviceCapabilities: readonly DeferredDeviceCapability[];
  readonly preload: RuntimePreloadDeclaration;
  readonly cache: CompiledRuntimeCacheContract;
  readonly fallbackPolicy: RuntimeFallbackPolicy;
}

export const BASELINE_TELEMETRY_EVENTS = [
  'experience_load_started',
  'first_panorama_visible',
  'time_to_interactive',
  'scene_changed',
  'hotspot_clicked',
  'asset_failed',
  'scene_transition_failed',
  'viewer_error',
  'experience_exited',
  'capability_fallback',
] as const;

/** Added when an experience publishes advanced spatial or overlay features. */
export const SPATIAL_TELEMETRY_EVENTS = [
  'overlay_clicked',
  'map_interaction',
] as const;

/** Added for video360 experiences on top of the baseline event set. */
export const VIDEO_TELEMETRY_EVENTS = [
  'video_started',
  'video_paused',
  'video_resumed',
  'video_seeked',
  'video_stalled',
  'video_ended',
  'video_profile_selected',
  'video_playback_failed',
  'timeline_interaction_shown',
  'timeline_interaction_clicked',
] as const;

export type CompiledTelemetryEvent =
  | (typeof BASELINE_TELEMETRY_EVENTS)[number]
  | (typeof VIDEO_TELEMETRY_EVENTS)[number]
  | (typeof SPATIAL_TELEMETRY_EVENTS)[number];

export interface CompiledTelemetryMetadata {
  readonly enabled: true;
  readonly experienceId: string;
  readonly projectRevision: number;
  readonly publicationRevision: number | null;
  readonly viewerIntegrationVersion: string;
  readonly events: readonly CompiledTelemetryEvent[];
  readonly sceneTransitionFailureCategories: readonly SceneTransitionFailureCategory[];
  readonly videoPlaybackFailureCategories?: readonly string[];
}

/** This opaque JSON is renderer-specific and may only be created by an adapter. */
export interface ViewerIntegrationOutput {
  readonly rendererId: string;
  readonly viewerIntegrationVersion: string;
  readonly config: JsonObject;
}

export interface ViewerSceneIntegrationOutput {
  readonly rendererId: string;
  readonly viewerIntegrationVersion: string;
  readonly sceneId: string;
  readonly config: JsonObject;
}

export interface ViewerIntegrationInput {
  readonly initialSceneId: string;
  readonly settings: CanonicalProjectSettings;
  readonly branding: CompiledBranding;
  readonly scenes: readonly CompiledScene[];
  /** Complete lightweight index, including scenes delivered progressively. */
  readonly sceneIndex?: readonly CompiledSceneIndexEntry[];
  readonly plans?: readonly CompiledPlan[];
  readonly spatialIndex?: CompiledSpatialIndex;
  readonly capabilities?: readonly CapabilityId[];
}

export interface ViewerVideoIntegrationInput {
  readonly settings: CanonicalProjectSettings;
  readonly branding: CompiledBranding;
  readonly video: CompiledVideoMedia;
  readonly timeline: readonly CompiledTimelineInteraction[];
}

export interface ViewerIntegrationAdapter {
  readonly viewerIntegrationVersion: string;
  adapt(input: ViewerIntegrationInput): ViewerIntegrationOutput;
  adaptScene(scene: CompiledScene): ViewerSceneIntegrationOutput;
  adaptVideo(input: ViewerVideoIntegrationInput): ViewerIntegrationOutput;
}

/* --------------------------------------------------------------------- */
/* 360 video                                                              */
/* --------------------------------------------------------------------- */

export interface CompiledVideoPlaybackProfile {
  readonly profileId: VideoPlaybackProfileId;
  readonly media: CompiledMediaReference;
  readonly constraints: {
    readonly maxWidth: number;
    readonly handheldSafe: boolean;
    readonly mimeType: string;
  };
}

export interface CompiledVideoSelectionPolicy {
  readonly policyVersion: number;
  readonly strategy: 'ordered-candidates-client-selects';
  readonly handheldMaxWidth: number;
  readonly defaultProfileId: VideoPlaybackProfileId;
  readonly fallbackProfileId: VideoPlaybackProfileId;
  /** A server-side selection endpoint for players that prefer to delegate. */
  readonly selectionUrl?: string;
}

export interface CompiledVideoMedia {
  readonly assetId: string;
  readonly projection: 'equirectangular' | 'cubemap';
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate?: number;
  readonly audioPresent: boolean;
  readonly stereoMode: 'mono' | 'top-bottom' | 'left-right';
  readonly poster?: CompiledMediaReference;
  /** Ordered best-first; handheld-safe candidates lead the list. */
  readonly profiles: readonly CompiledVideoPlaybackProfile[];
  readonly selectionPolicy: CompiledVideoSelectionPolicy;
}

export interface CompiledTimelineInteraction {
  readonly id: string;
  readonly kind: CanonicalTimelineInteractionKind;
  readonly timeMs: number;
  readonly endTimeMs: number | null;
  readonly geometry?: { readonly kind: 'point' };
  readonly position?: SphericalPosition;
  readonly viewpoint?: CanonicalViewpoint;
  readonly appearance?: CompiledHotspotAppearance;
  readonly content?: CompiledTimelineContent;
  readonly action: CompiledTimelineAction;
  readonly enabled: boolean;
  readonly visibilityRules: JsonObject;
}

export interface CompiledTimelineContent extends CompiledHotspotContent {
  readonly ctaLabel?: string;
  readonly ctaUrl?: string;
}

export type CompiledTimelineAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'showInformation' }
  | { readonly kind: 'openUrl'; readonly url: string }
  | { readonly kind: 'openAsset'; readonly media: CompiledMediaReference }
  | { readonly kind: 'setViewpoint' };

export type {
  CanonicalLayerAnchor,
  CanonicalSpatialData,
  CanonicalTimelineInteraction,
  VideoProfileCandidate,
};

export interface CompiledPublishedSceneDefinition {
  readonly sceneDefinitionVersion: typeof COMPILED_SCENE_VERSION;
  readonly experienceId: string;
  readonly publicationRevision: number;
  readonly viewerIntegrationVersion: string;
  readonly scene: CompiledScene;
  readonly viewerIntegration: ViewerSceneIntegrationOutput;
}

export interface CompiledExperienceBundle {
  readonly manifest: CompiledExperienceManifest;
  readonly sceneDefinitions: readonly CompiledPublishedSceneDefinition[];
  /**
   * Every scene index entry, including those the manifest omits when the index
   * is segmented. Empty for video experiences, which have no scene index.
   */
  readonly sceneIndex?: readonly CompiledSceneIndexEntry[];
}

export interface CompiledExperienceManifestBase {
  readonly manifestVersion: typeof COMPILED_MANIFEST_VERSION;
  readonly schemaVersion: number;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly projectRevision: number;
  readonly publicationRevision: number | null;
  readonly target: CompileTarget;
  readonly visibility: PublicationVisibility;
  readonly viewerIntegrationVersion: string;
  readonly settings: CanonicalProjectSettings;
  readonly branding: CompiledBranding;
  readonly capabilities: readonly RuntimeCapabilityDeclaration[];
  readonly runtime: RuntimeDeclarations;
  readonly telemetry: CompiledTelemetryMetadata;
  /** Extension id to version, pinned so a later registry change cannot alter this revision. */
  readonly pinnedExtensions: Readonly<Record<string, string>>;
  readonly viewerIntegration: ViewerIntegrationOutput;
}

export interface CompiledImageExperienceManifest extends CompiledExperienceManifestBase {
  readonly experienceType: 'image360';
  readonly initialSceneId: string;
  /** All definitions for embedded tours; only the initial definition for progressive tours. */
  readonly scenes: readonly CompiledScene[];
  readonly tour: CompiledTourDelivery;
  readonly plans: readonly CompiledPlan[];
  readonly spatialIndex: CompiledSpatialIndex;
}

export interface CompiledVideoExperienceManifest extends CompiledExperienceManifestBase {
  readonly experienceType: 'video360';
  readonly video: CompiledVideoMedia;
  readonly timeline: readonly CompiledTimelineInteraction[];
}

export type CompiledExperienceManifest =
  | CompiledImageExperienceManifest
  | CompiledVideoExperienceManifest;

export function isImageExperienceManifest(
  manifest: CompiledExperienceManifest,
): manifest is CompiledImageExperienceManifest {
  return manifest.experienceType === 'image360';
}

export function isVideoExperienceManifest(
  manifest: CompiledExperienceManifest,
): manifest is CompiledVideoExperienceManifest {
  return manifest.experienceType === 'video360';
}
