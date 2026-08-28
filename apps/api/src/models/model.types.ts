/**
 * The runtime telemetry and interaction vocabularies are declared once, in the
 * shared telemetry contract, and re-exported here so persisted enums and the
 * events a player reports can never drift apart.
 */
export {
  CAPABILITY_FALLBACK_REASONS,
  INTERACTION_GEOMETRY_KINDS,
  RUNTIME_EVENT_NAMES,
  TIMELINE_INTERACTION_KINDS,
  VIDEO_PLAYBACK_FAILURE_CATEGORIES,
} from '@sphere/telemetry-contract';
export type {
  CapabilityFallbackReason,
  InteractionGeometryKind,
  RuntimeEventName,
  TimelineInteractionKind,
  VideoPlaybackFailureCategory,
} from '@sphere/telemetry-contract';

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Platform-level role. `member` is every ordinary creator; `platform_admin`
 * gates operator surfaces such as the extension registry and the viewer
 * integration rollout. Project and workspace permissions are separate.
 */
export const PLATFORM_ROLES = ['member', 'platform_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PROJECT_TYPES = ['image360', 'video360'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const ASSET_MEDIA_TYPES = [
  'panorama_image',
  'image',
  'video360',
  'video',
  'audio',
  'logo',
  'plan_image',
  'other',
] as const;
export type AssetMediaType = (typeof ASSET_MEDIA_TYPES)[number];

export const ASSET_PROJECTIONS = [
  'equirectangular',
  'cropped_equirectangular',
  'cubemap',
  'dual_fisheye',
  'unknown',
] as const;
export type AssetProjection = (typeof ASSET_PROJECTIONS)[number];

export const ASSET_PROCESSING_STATUSES = [
  'uploaded',
  'inspecting',
  'processing',
  'ready',
  'failed',
] as const;
export type AssetProcessingStatus = (typeof ASSET_PROCESSING_STATUSES)[number];

export const ASSET_DERIVATIVE_KINDS = [
  'thumbnail',
  'lowResolutionBase',
  'standardWeb',
  'tiledLevels',
  'cubemap',
  'tiledCubemap',
  'normalizedPanorama',
  'planImage',
  'videoPoster',
  'desktopVideoProfile',
  'mobileVideoProfile',
] as const;
export type AssetDerivativeKind = (typeof ASSET_DERIVATIVE_KINDS)[number];

export const UPLOAD_SESSION_STATUSES = [
  'pending',
  'uploaded',
  'completed',
  'expired',
  'aborted',
  'failed',
] as const;
export type UploadSessionStatus = (typeof UPLOAD_SESSION_STATUSES)[number];

export const MEDIA_JOB_TYPES = ['inspect', 'process', 'reprocess'] as const;
export type MediaJobType = (typeof MEDIA_JOB_TYPES)[number];

export const MEDIA_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type MediaJobStatus = (typeof MEDIA_JOB_STATUSES)[number];

/**
 * Child stages tracked inside a single logical media job. Video processing
 * needs per-profile status so one failed playback profile stays actionable
 * without discarding the profiles that succeeded.
 */
export const MEDIA_JOB_STAGE_NAMES = [
  'inspect',
  // Panorama pipeline stages, one per generated image derivative.
  'thumbnail',
  'lowResolutionBase',
  'standardWeb',
  'tiledLevels',
  // Video pipeline stages.
  'poster',
  'transcodeDesktop',
  'transcodeMobile',
  'derivatives',
  'finalize',
] as const;
export type MediaJobStageName = (typeof MEDIA_JOB_STAGE_NAMES)[number];

export const MEDIA_JOB_STAGE_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
] as const;
export type MediaJobStageStatus = (typeof MEDIA_JOB_STAGE_STATUSES)[number];

export const STORAGE_DELETION_JOB_STATUSES = ['queued', 'running', 'succeeded'] as const;
export type StorageDeletionJobStatus = (typeof STORAGE_DELETION_JOB_STATUSES)[number];

export const PUBLICATION_VISIBILITIES = ['public', 'private', 'unlisted'] as const;
export type PublicationVisibility = (typeof PUBLICATION_VISIBILITIES)[number];

export const PUBLICATION_STATUSES = ['publishing', 'published', 'publish_failed', 'retired'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const IDEMPOTENCY_STATUSES = ['in_progress', 'completed', 'failed'] as const;
export type IdempotencyStatus = (typeof IDEMPOTENCY_STATUSES)[number];

export const PLAN_COORDINATE_SYSTEMS = ['plan_normalized', 'plan_pixels'] as const;
export type PlanCoordinateSystem = (typeof PLAN_COORDINATE_SYSTEMS)[number];

/** Workspace and project roles, ordered from least to most privileged. */
export const ACCESS_ROLES = ['viewer', 'editor', 'admin', 'owner'] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'revoked'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const TEMPLATE_VISIBILITIES = ['platform', 'workspace', 'private'] as const;
export type TemplateVisibility = (typeof TEMPLATE_VISIBILITIES)[number];

export const TEMPLATE_STATUSES = ['draft', 'published', 'retired'] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** How a template's referenced assets reach the instantiated project. */
export const TEMPLATE_ASSET_POLICIES = ['reference', 'copy', 'omit'] as const;
export type TemplateAssetPolicy = (typeof TEMPLATE_ASSET_POLICIES)[number];

export const EXTENSION_STATUSES = ['draft', 'active', 'deprecated', 'disabled'] as const;
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

/** Outcome of a reference experience suite run against a viewer integration. */
export const VIEWER_INTEGRATION_CHECK_STATUSES = ['running', 'passed', 'failed'] as const;
export type ViewerIntegrationCheckStatus = (typeof VIEWER_INTEGRATION_CHECK_STATUSES)[number];

/** Durable operational settings keys. Kept closed so typos cannot create rows. */
export const PLATFORM_SETTING_KEYS = ['viewerIntegrationRollout'] as const;
export type PlatformSettingKey = (typeof PLATFORM_SETTING_KEYS)[number];

export const AUDIT_ACTIONS = [
  'project.created',
  'project.deleted',
  'project.published',
  'project.unpublished',
  'project.access_granted',
  'project.access_revoked',
  'workspace.member_invited',
  'workspace.member_role_changed',
  'workspace.member_removed',
  'asset.deleted',
  'template.instantiated',
  'publication.share_token_created',
  'publication.share_token_revoked',
  'publication.embed_policy_changed',
  'extension.status_changed',
  'viewer_integration.rollout_changed',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const emptyJsonObject = (): JsonObject => ({});
export const emptyJsonArray = (): JsonValue[] => [];
