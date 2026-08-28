/**
 * The runtime telemetry vocabulary.
 *
 * One definition serves the compiler that declares which events an experience
 * reports, the ingest endpoint that accepts them, and the player that emits
 * them. A player and a server that disagree about an event name is a silent
 * data-loss bug, so there is deliberately nowhere else to declare one.
 */

export const TELEMETRY_CONTRACT_VERSION = 'telemetry-contract-1' as const;

/** Reported by every experience, whatever its type or capabilities. */
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

/**
 * Every event ingest accepts, in the order the runtime event store records.
 * The order is persisted in a database enum, so entries are appended, never
 * reordered or removed.
 */
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
  'capability_fallback',
  'overlay_clicked',
  'map_interaction',
] as const;
export type RuntimeEventName = (typeof RUNTIME_EVENT_NAMES)[number];

/** Stable, product-level categories accepted by scene transition telemetry. */
export const SCENE_TRANSITION_FAILURE_CATEGORIES = [
  'scene_definition_unavailable',
  'scene_definition_invalid',
  'asset_unavailable',
  'asset_decode_failed',
  'unsupported_media',
  'viewer_error',
  'transition_timeout',
  'unknown',
] as const;
export type SceneTransitionFailureCategory =
  (typeof SCENE_TRANSITION_FAILURE_CATEGORIES)[number];

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
export type VideoPlaybackFailureCategory =
  (typeof VIDEO_PLAYBACK_FAILURE_CATEGORIES)[number];

/** Why an optional capability was not delivered to a visitor. */
export const CAPABILITY_FALLBACK_REASONS = [
  'device_unsupported',
  'permission_denied',
  'module_load_failed',
  'media_unavailable',
  'runtime_error',
  'unknown',
] as const;
export type CapabilityFallbackReason = (typeof CAPABILITY_FALLBACK_REASONS)[number];

/**
 * The interaction vocabulary telemetry reports against.
 *
 * It is the same vocabulary the canonical model persists; the schema package
 * re-exports these tuples rather than restating them, so an event payload and
 * a stored geometry can never name different things.
 */
export const INTERACTION_GEOMETRY_KINDS = [
  'point',
  'polygon',
  'polyline',
  'imageLayer',
  'videoLayer',
  'custom',
] as const;
export type InteractionGeometryKind = (typeof INTERACTION_GEOMETRY_KINDS)[number];

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

export const VIDEO_PLAYBACK_PROFILE_IDS = ['desktop', 'mobile'] as const;
export type VideoPlaybackProfileId = (typeof VIDEO_PLAYBACK_PROFILE_IDS)[number];
