import { z } from 'zod';

import {
  CAPABILITY_FALLBACK_REASONS,
  INTERACTION_GEOMETRY_KINDS,
  SCENE_TRANSITION_FAILURE_CATEGORIES,
  TIMELINE_INTERACTION_KINDS,
  VIDEO_PLAYBACK_FAILURE_CATEGORIES,
  VIDEO_PLAYBACK_PROFILE_IDS,
} from './events';

/**
 * The payload shape of every telemetry event.
 *
 * Ingest validates against these schemas and a player builds against them, so
 * both sides of the wire are described once. They are ordinary zod schemas
 * with no server dependency, which is what lets a browser build share them.
 */

const id = z.string().uuid();
const databaseRevision = z.number().int().positive().max(2_147_483_647);
const jsonRecord = z.record(z.string(), z.unknown());
const profileId = z.enum(VIDEO_PLAYBACK_PROFILE_IDS);

export const runtimeEventNameSchema = z.enum([
  'experience_load_started',
  'first_panorama_visible',
  'time_to_interactive',
  'scene_changed',
  'hotspot_clicked',
  'asset_failed',
  'scene_transition_failed',
  'viewer_error',
  'experience_exited',
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
  'capability_fallback',
  'overlay_clicked',
  'map_interaction'
]);

const runtimeEventBaseSchema = z
  .object({
    eventId: id,
    experienceId: id,
    publicationRevision: databaseRevision,
    viewerIntegrationVersion: z.string().trim().min(1).max(64),
    sessionId: z.string().trim().min(8).max(128),
    deviceContext: jsonRecord.default({}),
    runtimeContext: jsonRecord.default({}),
    occurredAt: z.iso.datetime({ offset: true })
  });

const existingRuntimeEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.enum([
      'experience_load_started',
      'first_panorama_visible',
      'time_to_interactive',
      'scene_changed',
      'hotspot_clicked',
      'asset_failed',
      'viewer_error',
      'experience_exited'
    ]),
    // `durationMs` is the timing convention these events report against; it is
    // optional so an older player keeps reporting, and analytics aggregates the
    // samples that carry it.
    payload: jsonRecord
      .and(
        z
          .object({ durationMs: z.number().int().min(0).max(3_600_000).optional() })
          .passthrough()
      )
      .default({})
  })
  .strict();

const capabilityFallbackEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('capability_fallback'),
    payload: z
      .object({
        capabilityId: z.string().trim().min(1).max(64),
        reason: z.enum(CAPABILITY_FALLBACK_REASONS),
        fallbackApplied: z.string().trim().max(120).optional()
      })
      .passthrough()
  })
  .strict();

const overlayClickedEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('overlay_clicked'),
    payload: z
      .object({
        overlayId: id,
        sceneId: id.optional(),
        geometryKind: z.enum(INTERACTION_GEOMETRY_KINDS).optional()
      })
      .passthrough()
  })
  .strict();

const mapInteractionEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('map_interaction'),
    payload: z
      .object({
        surface: z.enum(['map', 'plan']),
        action: z.enum(['scene_selected', 'zoom', 'pan', 'opened', 'closed']),
        sceneId: id.optional(),
        planId: id.optional()
      })
      .passthrough()
  })
  .strict();

const videoPlaybackPayloadSchema = z
  .object({
    assetId: id.optional(),
    derivativeId: id.optional(),
    profileId: profileId.optional(),
    currentTimeMs: z.number().int().min(0).optional(),
    durationMs: z.number().int().min(0).optional()
  })
  .passthrough();

const videoPlaybackEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.enum([
      'video_started',
      'video_paused',
      'video_resumed',
      'video_seeked',
      'video_stalled',
      'video_ended'
    ]),
    payload: videoPlaybackPayloadSchema
  })
  .strict();

export const videoProfileSelectedPayloadSchema = z
  .object({
    assetId: id,
    derivativeId: id,
    profileId,
    reason: z.string().trim().max(120).optional(),
    candidateProfileIds: z.array(profileId).max(4).optional()
  })
  .passthrough();

const videoProfileSelectedEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('video_profile_selected'),
    payload: videoProfileSelectedPayloadSchema
  })
  .strict();

export const videoPlaybackFailurePayloadSchema = z
  .object({
    assetId: id,
    derivativeId: id.optional(),
    profileId: profileId.optional(),
    failureCategory: z.enum(VIDEO_PLAYBACK_FAILURE_CATEGORIES),
    currentTimeMs: z.number().int().min(0).optional()
  })
  .passthrough();

const videoPlaybackFailedEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('video_playback_failed'),
    payload: videoPlaybackFailurePayloadSchema
  })
  .strict();

const timelineInteractionEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.enum(['timeline_interaction_shown', 'timeline_interaction_clicked']),
    payload: z
      .object({
        interactionId: id,
        kind: z.enum(TIMELINE_INTERACTION_KINDS),
        timeMs: z.number().int().min(0).optional()
      })
      .passthrough()
  })
  .strict();

export const sceneTransitionFailurePayloadSchema = z
  .object({
    sourceSceneId: id,
    targetSceneId: id,
    failureCategory: z.enum(SCENE_TRANSITION_FAILURE_CATEGORIES),
    assetId: id.optional()
  })
  .passthrough();

const sceneTransitionFailureEventSchema = runtimeEventBaseSchema
  .extend({
    eventName: z.literal('scene_transition_failed'),
    payload: sceneTransitionFailurePayloadSchema
  })
  .strict();

export const runtimeEventSchema = z.discriminatedUnion('eventName', [
  existingRuntimeEventSchema,
  sceneTransitionFailureEventSchema,
  videoPlaybackEventSchema,
  videoProfileSelectedEventSchema,
  videoPlaybackFailedEventSchema,
  timelineInteractionEventSchema,
  capabilityFallbackEventSchema,
  overlayClickedEventSchema,
  mapInteractionEventSchema
]);

/** A single event, or a batch of up to a hundred. */
export const runtimeEventsSchema = z.union([
  runtimeEventSchema.transform((event) => ({ events: [event] })),
  z.object({ events: z.array(runtimeEventSchema).min(1).max(100) }).strict()
]);
