export const CAPABILITY_IDS = [
  'basicPanorama',
  'hotspots',
  'sceneNavigation',
  'gallery',
  'autorotation',
  'compass',
  'viewLimits',
  'tiledPanorama',
  'highResolution',
  'imageContent',
  'videoContent',
  'externalLink',
  'video360',
  'videoTimeline',
  'timedHotspots',
  'timedViewpoint',
  'cta',
  'map',
  'plan',
  'gyroscope',
  'stereo',
  'vr',
  'advancedOverlay',
  'advancedGeometry',
  'cubemapPanorama',
  'customInteraction',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export const IMAGE_CAPABILITY_IDS = CAPABILITY_IDS.slice(0, 12) as readonly CapabilityId[];
export const VIDEO_CAPABILITY_IDS = CAPABILITY_IDS.slice(12, 17) as readonly CapabilityId[];
/** Advanced immersive, spatial and extension capabilities. */
export const ADVANCED_CAPABILITY_IDS = CAPABILITY_IDS.slice(17) as readonly CapabilityId[];

/** Retained alias for the capability set introduced with the first release. */
export const INITIAL_CAPABILITY_IDS = IMAGE_CAPABILITY_IDS;

export const DEVICE_REQUIREMENTS = [
  'video-playback',
  'device-orientation',
  'stereo-rendering',
  'immersive-runtime',
] as const;

export type DeviceRequirement = (typeof DEVICE_REQUIREMENTS)[number];

/**
 * Whether a device requirement can be decided while compiling, or only once a
 * browser is running. Runtime-resolved requirements are declared in the
 * manifest and never block a publication: the player applies the fallback.
 */
export type DeviceRequirementResolution = 'compile-time' | 'runtime';

export const MEDIA_REQUIREMENTS = [
  'ready-panorama',
  'tiled-panorama-derivatives',
  'high-resolution-derivative',
  'cubemap-derivatives',
  'tiled-cubemap-derivatives',
  'ready-image-content',
  'ready-video-content',
  'ready-video360-source',
  'ready-video360-playback-profile',
  'known-video-duration',
  'map-spatial-data',
  'plan-spatial-data',
  'ready-plan-asset',
  'ready-overlay-asset',
  'registered-extension',
] as const;

export type MediaRequirement = (typeof MEDIA_REQUIREMENTS)[number];

export type CapabilityAvailability = 'available' | 'reserved';
export type CapabilityFallbackBehavior = 'disable-capability';

export interface CapabilityFallback {
  readonly behavior: CapabilityFallbackBehavior;
  readonly message: string;
  readonly alternatives: readonly string[];
}

export interface CapabilityDefinition<Id extends CapabilityId = CapabilityId> {
  readonly id: Id;
  readonly productFeature: string;
  readonly availability: CapabilityAvailability;
  /** Internal integration metadata. It must not be copied into product-facing issues. */
  readonly rendererModule: string;
  readonly dependencies: readonly CapabilityId[];
  readonly incompatibilities: readonly CapabilityId[];
  readonly deviceRequirements: readonly DeviceRequirement[];
  readonly deviceRequirementResolution: DeviceRequirementResolution;
  readonly mediaRequirements: readonly MediaRequirement[];
  /** Module identifier when this capability can be loaded on demand. */
  readonly lazyLoadModule: string | null;
  readonly fallback: CapabilityFallback | null;
}

export type CapabilityRegistry = {
  readonly [Id in CapabilityId]: CapabilityDefinition<Id>;
};

export type CapabilityIssueSeverity = 'error' | 'warning';

export type CapabilityIssueCode =
  | 'FEATURE_UNAVAILABLE'
  | 'FEATURE_DEPENDENCY_UNAVAILABLE'
  | 'FEATURE_COMBINATION_UNAVAILABLE'
  | 'FEATURE_DEVICE_UNAVAILABLE'
  | 'FEATURE_MEDIA_REQUIRED'
  | 'FEATURE_CONFIGURATION_INVALID'
  | 'FEATURE_NOT_CONFIGURED'
  | 'FEATURE_FALLBACK_APPLIED'
  | 'CONTENT_ASSET_NOT_FOUND'
  | 'CONTENT_ASSET_NOT_READY';

export interface CapabilityIssue {
  readonly code: CapabilityIssueCode;
  readonly severity: CapabilityIssueSeverity;
  readonly entityId: string;
  readonly path: string;
  readonly message: string;
  readonly alternatives: readonly string[];
  readonly capabilityIds: readonly CapabilityId[];
}

export interface CapabilityViewLimits {
  readonly minHeadingDegrees?: number;
  readonly maxHeadingDegrees?: number;
  readonly minPitchDegrees?: number;
  readonly maxPitchDegrees?: number;
}

export interface CapabilitySemanticConfiguration {
  readonly compassEnabled?: boolean;
  readonly viewLimits?: CapabilityViewLimits;
  readonly timelineInteractionCount?: number;
  readonly videoDurationMs?: number;
  /** Scenes carrying usable world coordinates. */
  readonly mappedSceneCount?: number;
  /** Scenes positioned on a plan whose image asset is ready. */
  readonly planPositionedSceneCount?: number;
  readonly overlayCount?: number;
  readonly advancedGeometryCount?: number;
  readonly customInteractionCount?: number;
  readonly motionNavigationRequested?: boolean;
  readonly stereoRequested?: boolean;
  readonly immersiveRequested?: boolean;
}

export type CapabilityAssetState = 'missing' | 'processing' | 'failed' | 'ready';

export interface CapabilityAssetReference {
  readonly assetId: string;
  readonly capabilityId: CapabilityId;
  readonly requirement: MediaRequirement;
  readonly state: CapabilityAssetState;
  readonly entityId?: string;
  readonly path?: string;
}

export type CapabilityFallbackMode = 'apply' | 'reject';

export interface CapabilityResolutionInput {
  readonly projectId: string;
  readonly requestedCapabilities: readonly CapabilityId[];
  readonly availableDeviceRequirements?: readonly DeviceRequirement[];
  readonly availableMediaRequirements?: readonly MediaRequirement[];
  readonly assetReferences?: readonly CapabilityAssetReference[];
  readonly configuration?: CapabilitySemanticConfiguration;
  readonly fallbackMode?: CapabilityFallbackMode;
}

export interface AppliedCapabilityFallback {
  readonly capabilityId: CapabilityId;
  readonly behavior: CapabilityFallbackBehavior;
  readonly reason: CapabilityIssueCode;
  readonly message: string;
}

export interface RuntimeModuleDeclaration {
  readonly id: string;
  readonly load: 'eager' | 'lazy';
  readonly capabilities: readonly CapabilityId[];
}

/**
 * A capability that compiled successfully but whose device support can only be
 * confirmed by the player. The manifest carries the requirement and the
 * fallback so an unsupported device degrades instead of failing.
 */
export interface DeferredDeviceCapability {
  readonly capabilityId: CapabilityId;
  readonly deviceRequirements: readonly DeviceRequirement[];
  readonly fallbackMessage: string;
  readonly alternatives: readonly string[];
}

export interface CapabilityResolutionResult {
  readonly valid: boolean;
  readonly capabilities: readonly CapabilityId[];
  /** Compatibility shape for the compiler/player manifest. */
  readonly runtimeModules: readonly string[];
  readonly moduleDeclarations: readonly RuntimeModuleDeclaration[];
  readonly issues: readonly CapabilityIssue[];
  readonly fallbacks: readonly AppliedCapabilityFallback[];
  readonly deferredDeviceCapabilities: readonly DeferredDeviceCapability[];
}
