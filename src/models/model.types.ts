export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PROJECT_TYPES = ['image360', 'video360'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const ASSET_MEDIA_TYPES = [
  'panorama_image',
  'image',
  'video360',
  'video',
  'audio',
  'logo',
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

export const TIMELINE_INTERACTION_KINDS = [
  'information',
  'hotspot',
  'viewpoint',
  'image',
  'video',
  'link',
  'cta',
] as const;
export type TimelineInteractionKind = (typeof TIMELINE_INTERACTION_KINDS)[number];

export const STORAGE_DELETION_JOB_STATUSES = ['queued', 'running', 'succeeded'] as const;
export type StorageDeletionJobStatus = (typeof STORAGE_DELETION_JOB_STATUSES)[number];

export const PUBLICATION_VISIBILITIES = ['public', 'private', 'unlisted'] as const;
export type PublicationVisibility = (typeof PUBLICATION_VISIBILITIES)[number];

export const PUBLICATION_STATUSES = ['publishing', 'published', 'publish_failed', 'retired'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const IDEMPOTENCY_STATUSES = ['in_progress', 'completed', 'failed'] as const;
export type IdempotencyStatus = (typeof IDEMPOTENCY_STATUSES)[number];

export const RUNTIME_EVENT_NAMES = [
  'experience_load_started',
  'first_panorama_visible',
  'time_to_interactive',
  'scene_changed',
  'hotspot_clicked',
  'video_started',
  'video_stalled',
  'asset_failed',
  'scene_transition_failed',
  'viewer_error',
  'experience_exited',
  'video_paused',
  'video_resumed',
  'video_seeked',
  'video_ended',
  'video_profile_selected',
  'video_playback_failed',
  'timeline_interaction_shown',
  'timeline_interaction_clicked',
] as const;
export type RuntimeEventName = (typeof RUNTIME_EVENT_NAMES)[number];

/** Stable, product-level categories accepted by video playback telemetry. */
export const VIDEO_PLAYBACK_FAILURE_CATEGORIES = [
  'profile_unavailable',
  'media_unavailable',
  'decode_failed',
  'codec_unsupported',
  'network_error',
  'autoplay_blocked',
  'viewer_error',
  'unknown',
] as const;
export type VideoPlaybackFailureCategory = (typeof VIDEO_PLAYBACK_FAILURE_CATEGORIES)[number];

export const emptyJsonObject = (): JsonObject => ({});
export const emptyJsonArray = (): JsonValue[] => [];
