import { QueryTypes } from 'sequelize';

import { config } from '../config';
import { sequelize } from '../database';
import { AppError } from '../errors/app-error';
import { requireProjectRole } from './access-service';

/**
 * Creator-facing analytics over the runtime telemetry stream.
 *
 * Queries run against the event store behind the `AnalyticsStore` boundary. It
 * is PostgreSQL today, which the indexes on `runtime_events` are sized for; a
 * deployment with heavier telemetry can implement the same interface against a
 * dedicated analytics store without touching the API or authorization rules.
 */

export interface AnalyticsRange {
  readonly from: Date;
  readonly to: Date;
}

export interface AnalyticsQuery extends AnalyticsRange {
  readonly projectId: string;
  readonly publicationRevision?: number;
}

/**
 * Suppression threshold for audience breakdowns.
 *
 * At 1 nothing is actually suppressed. That is deliberate rather than
 * finished: the PRD lists the analytics retention/privacy model as an open
 * product decision, and the sprint plan forbids inventing a production
 * threshold without evidence. The seam is here so raising it is a
 * one-line change once the privacy constraints are agreed; until then no
 * suppression claim should be read into this value.
 */
const MIN_SESSIONS_FOR_BREAKDOWN = 1;
const MAX_ROWS = 500;

export interface AnalyticsStore {
  eventCounts(query: AnalyticsQuery): Promise<{ eventName: string; events: number; sessions: number }[]>;
  timingPercentiles(
    query: AnalyticsQuery,
    eventName: string
  ): Promise<{ samples: number; p50: number | null; p75: number | null; p95: number | null }>;
  timeseries(
    query: AnalyticsQuery,
    interval: 'hour' | 'day'
  ): Promise<{ bucket: string; eventName: string; events: number; sessions: number }[]>;
  payloadBreakdown(
    query: AnalyticsQuery,
    eventNames: readonly string[],
    payloadKey: string
  ): Promise<{ eventName: string; value: string; events: number; sessions: number }[]>;
  deviceBreakdown(query: AnalyticsQuery): Promise<{ value: string; sessions: number }[]>;
  viewerIntegrationBreakdown(
    query: AnalyticsQuery
  ): Promise<{ version: string; events: number; sessions: number }[]>;
}

interface CountRow {
  event_name: string;
  events: string | number;
  sessions: string | number;
}

function toNumber(value: string | number | null): number {
  return value === null ? 0 : Number(value);
}

function baseReplacements(query: AnalyticsQuery): Record<string, unknown> {
  return {
    projectId: query.projectId,
    from: query.from,
    to: query.to,
    publicationRevision: query.publicationRevision ?? null
  };
}

const REVISION_FILTER =
  'AND (:publicationRevision::int IS NULL OR publication_revision = :publicationRevision::int)';

class PostgresAnalyticsStore implements AnalyticsStore {
  async eventCounts(query: AnalyticsQuery) {
    const rows = await sequelize.query<CountRow>(
      `SELECT event_name,
              COUNT(*) AS events,
              COUNT(DISTINCT session_id) AS sessions
         FROM runtime_events
        WHERE experience_id = :projectId
          AND occurred_at >= :from
          AND occurred_at < :to
          ${REVISION_FILTER}
        GROUP BY event_name
        ORDER BY event_name`,
      { replacements: baseReplacements(query), type: QueryTypes.SELECT }
    );
    return rows.map((row) => ({
      eventName: row.event_name,
      events: toNumber(row.events),
      sessions: toNumber(row.sessions)
    }));
  }

  async timingPercentiles(query: AnalyticsQuery, eventName: string) {
    const rows = await sequelize.query<{
      samples: string | number;
      p50: string | number | null;
      p75: string | number | null;
      p95: string | number | null;
    }>(
      `SELECT COUNT(*) AS samples,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
              PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY duration_ms) AS p75,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
         FROM (
           SELECT (payload->>'durationMs')::numeric AS duration_ms
             FROM runtime_events
            WHERE experience_id = :projectId
              AND event_name = :eventName
              AND occurred_at >= :from
              AND occurred_at < :to
              ${REVISION_FILTER}
              AND payload ? 'durationMs'
              AND jsonb_typeof(payload->'durationMs') = 'number'
         ) AS samples_table`,
      {
        replacements: { ...baseReplacements(query), eventName },
        type: QueryTypes.SELECT
      }
    );
    const row = rows[0];
    return {
      samples: toNumber(row?.samples ?? 0),
      p50: row?.p50 === null || row?.p50 === undefined ? null : Math.round(Number(row.p50)),
      p75: row?.p75 === null || row?.p75 === undefined ? null : Math.round(Number(row.p75)),
      p95: row?.p95 === null || row?.p95 === undefined ? null : Math.round(Number(row.p95))
    };
  }

  async timeseries(query: AnalyticsQuery, interval: 'hour' | 'day') {
    const rows = await sequelize.query<CountRow & { bucket: Date }>(
      `SELECT date_trunc(:interval, occurred_at) AS bucket,
              event_name,
              COUNT(*) AS events,
              COUNT(DISTINCT session_id) AS sessions
         FROM runtime_events
        WHERE experience_id = :projectId
          AND occurred_at >= :from
          AND occurred_at < :to
          ${REVISION_FILTER}
        GROUP BY bucket, event_name
        ORDER BY bucket ASC, event_name ASC
        LIMIT :maxRows`,
      {
        replacements: { ...baseReplacements(query), interval, maxRows: MAX_ROWS * 4 },
        type: QueryTypes.SELECT
      }
    );
    return rows.map((row) => ({
      bucket: new Date(row.bucket).toISOString(),
      eventName: row.event_name,
      events: toNumber(row.events),
      sessions: toNumber(row.sessions)
    }));
  }

  async payloadBreakdown(
    query: AnalyticsQuery,
    eventNames: readonly string[],
    payloadKey: string
  ) {
    if (eventNames.length === 0) return [];
    const rows = await sequelize.query<CountRow & { value: string }>(
      `SELECT event_name,
              payload->>:payloadKey AS value,
              COUNT(*) AS events,
              COUNT(DISTINCT session_id) AS sessions
         FROM runtime_events
        WHERE experience_id = :projectId
          AND event_name IN (:eventNames)
          AND occurred_at >= :from
          AND occurred_at < :to
          ${REVISION_FILTER}
          AND payload->>:payloadKey IS NOT NULL
        GROUP BY event_name, value
        ORDER BY events DESC
        LIMIT :maxRows`,
      {
        replacements: {
          ...baseReplacements(query),
          eventNames: [...eventNames],
          payloadKey,
          maxRows: MAX_ROWS
        },
        type: QueryTypes.SELECT
      }
    );
    return rows.map((row) => ({
      eventName: row.event_name,
      value: row.value,
      events: toNumber(row.events),
      sessions: toNumber(row.sessions)
    }));
  }

  async deviceBreakdown(query: AnalyticsQuery) {
    const rows = await sequelize.query<{ value: string | null; sessions: string | number }>(
      `SELECT COALESCE(device_context->>'deviceClass', 'unknown') AS value,
              COUNT(DISTINCT session_id) AS sessions
         FROM runtime_events
        WHERE experience_id = :projectId
          AND occurred_at >= :from
          AND occurred_at < :to
          ${REVISION_FILTER}
        GROUP BY value
        ORDER BY sessions DESC
        LIMIT 20`,
      { replacements: baseReplacements(query), type: QueryTypes.SELECT }
    );
    return rows.map((row) => ({ value: row.value ?? 'unknown', sessions: toNumber(row.sessions) }));
  }

  async viewerIntegrationBreakdown(query: AnalyticsQuery) {
    const rows = await sequelize.query<{
      version: string;
      events: string | number;
      sessions: string | number;
    }>(
      `SELECT viewer_integration_version AS version,
              COUNT(*) AS events,
              COUNT(DISTINCT session_id) AS sessions
         FROM runtime_events
        WHERE experience_id = :projectId
          AND occurred_at >= :from
          AND occurred_at < :to
          ${REVISION_FILTER}
        GROUP BY version
        ORDER BY events DESC
        LIMIT 20`,
      { replacements: baseReplacements(query), type: QueryTypes.SELECT }
    );
    return rows.map((row) => ({
      version: row.version,
      events: toNumber(row.events),
      sessions: toNumber(row.sessions)
    }));
  }
}

let store: AnalyticsStore = new PostgresAnalyticsStore();

/** Point creator analytics at a dedicated analytics store. */
export function setAnalyticsStore(replacement: AnalyticsStore): void {
  store = replacement;
}

/* --------------------------------------------------------------------- */
/* Request handling                                                       */
/* --------------------------------------------------------------------- */

export interface AnalyticsRequest {
  readonly from?: string;
  readonly to?: string;
  readonly publicationRevision?: number;
  readonly interval?: 'hour' | 'day';
}

const DAY_MS = 86_400_000;

/**
 * Bounds the requested window. An unbounded analytics scan is a denial of
 * service on the event store, so the range is always explicit and capped.
 */
export function resolveRange(request: AnalyticsRequest): AnalyticsRange {
  const to = request.to === undefined ? new Date() : new Date(request.to);
  const from = request.from === undefined
    ? new Date(to.getTime() - 30 * DAY_MS)
    : new Date(request.from);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AppError('INVALID_DATE_RANGE', 'Enter a valid date range.', {
      status: 422,
      path: 'from'
    });
  }
  if (from >= to) {
    throw new AppError('INVALID_DATE_RANGE', 'The start date must be before the end date.', {
      status: 422,
      path: 'from'
    });
  }
  const maximumMs = config.analyticsMaxRangeDays * DAY_MS;
  if (to.getTime() - from.getTime() > maximumMs) {
    throw new AppError('DATE_RANGE_TOO_LARGE', 'Choose a shorter date range.', {
      status: 422,
      path: 'from',
      details: { maximumDays: config.analyticsMaxRangeDays }
    });
  }
  return { from, to };
}

async function authorizedQuery(
  projectId: string,
  userId: string,
  request: AnalyticsRequest
): Promise<AnalyticsQuery> {
  await requireProjectRole(projectId, userId, 'viewer');
  const range = resolveRange(request);
  return {
    projectId,
    from: range.from,
    to: range.to,
    ...(request.publicationRevision === undefined
      ? {}
      : { publicationRevision: request.publicationRevision })
  };
}

function rangePayload(query: AnalyticsQuery): Record<string, unknown> {
  return {
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    ...(query.publicationRevision === undefined
      ? {}
      : { publicationRevision: query.publicationRevision })
  };
}

function countsByName(
  counts: { eventName: string; events: number; sessions: number }[]
): Map<string, { events: number; sessions: number }> {
  return new Map(counts.map((entry) => [entry.eventName, entry]));
}

/** Runtime failures, kept separate from engagement so one cannot be read as the other. */
const RELIABILITY_EVENTS = [
  'asset_failed',
  'scene_transition_failed',
  'viewer_error',
  'video_stalled',
  'video_playback_failed',
  'capability_fallback'
] as const;

export async function experienceSummary(
  projectId: string,
  userId: string,
  request: AnalyticsRequest
): Promise<Record<string, unknown>> {
  const query = await authorizedQuery(projectId, userId, request);
  const counts = countsByName(await store.eventCounts(query));
  const [firstPanorama, timeToInteractive, devices, integrations] = await Promise.all([
    store.timingPercentiles(query, 'first_panorama_visible'),
    store.timingPercentiles(query, 'time_to_interactive'),
    store.deviceBreakdown(query),
    store.viewerIntegrationBreakdown(query)
  ]);
  const loads = counts.get('experience_load_started');
  const reliabilityEvents = RELIABILITY_EVENTS.reduce(
    (total, eventName) => total + (counts.get(eventName)?.events ?? 0),
    0
  );
  return {
    range: rangePayload(query),
    engagement: {
      experienceLoads: loads?.events ?? 0,
      sessions: loads?.sessions ?? 0,
      sceneTransitions: counts.get('scene_changed')?.events ?? 0,
      hotspotClicks: counts.get('hotspot_clicked')?.events ?? 0,
      overlayClicks: counts.get('overlay_clicked')?.events ?? 0,
      mapInteractions: counts.get('map_interaction')?.events ?? 0,
      videoStarts: counts.get('video_started')?.events ?? 0,
      timelineInteractionsShown: counts.get('timeline_interaction_shown')?.events ?? 0,
      timelineInteractionsClicked: counts.get('timeline_interaction_clicked')?.events ?? 0,
      exits: counts.get('experience_exited')?.events ?? 0
    },
    performance: {
      firstPanoramaVisibleMs: firstPanorama,
      timeToInteractiveMs: timeToInteractive
    },
    reliability: {
      totalFailureEvents: reliabilityEvents,
      assetFailures: counts.get('asset_failed')?.events ?? 0,
      sceneTransitionFailures: counts.get('scene_transition_failed')?.events ?? 0,
      viewerErrors: counts.get('viewer_error')?.events ?? 0,
      videoStalls: counts.get('video_stalled')?.events ?? 0,
      videoPlaybackFailures: counts.get('video_playback_failed')?.events ?? 0,
      capabilityFallbacks: counts.get('capability_fallback')?.events ?? 0
    },
    audience: {
      deviceClasses: devices.filter((device) => device.sessions >= MIN_SESSIONS_FOR_BREAKDOWN)
    },
    viewerIntegrationVersions: integrations
  };
}

export async function experienceTimeseries(
  projectId: string,
  userId: string,
  request: AnalyticsRequest
): Promise<Record<string, unknown>> {
  const query = await authorizedQuery(projectId, userId, request);
  const interval = request.interval ?? 'day';
  const points = await store.timeseries(query, interval);
  return { range: rangePayload(query), interval, points };
}

export async function sceneAnalytics(
  projectId: string,
  userId: string,
  request: AnalyticsRequest
): Promise<Record<string, unknown>> {
  const query = await authorizedQuery(projectId, userId, request);
  const [entered, failed] = await Promise.all([
    store.payloadBreakdown(query, ['scene_changed'], 'sceneId'),
    store.payloadBreakdown(query, ['scene_transition_failed'], 'targetSceneId')
  ]);
  const failuresBySceneId = new Map(failed.map((entry) => [entry.value, entry.events]));
  return {
    range: rangePayload(query),
    scenes: entered.map((entry) => ({
      sceneId: entry.value,
      views: entry.events,
      sessions: entry.sessions,
      transitionFailures: failuresBySceneId.get(entry.value) ?? 0
    }))
  };
}

export async function interactionAnalytics(
  projectId: string,
  userId: string,
  request: AnalyticsRequest
): Promise<Record<string, unknown>> {
  const query = await authorizedQuery(projectId, userId, request);
  const [hotspots, overlays, timeline, mapSurfaces] = await Promise.all([
    store.payloadBreakdown(query, ['hotspot_clicked'], 'hotspotId'),
    store.payloadBreakdown(query, ['overlay_clicked'], 'overlayId'),
    store.payloadBreakdown(
      query,
      ['timeline_interaction_shown', 'timeline_interaction_clicked'],
      'interactionId'
    ),
    store.payloadBreakdown(query, ['map_interaction'], 'surface')
  ]);
  const shown = new Map(
    timeline
      .filter((entry) => entry.eventName === 'timeline_interaction_shown')
      .map((entry) => [entry.value, entry.events])
  );
  const clicked = new Map(
    timeline
      .filter((entry) => entry.eventName === 'timeline_interaction_clicked')
      .map((entry) => [entry.value, entry.events])
  );
  return {
    range: rangePayload(query),
    hotspots: hotspots.map((entry) => ({
      hotspotId: entry.value,
      clicks: entry.events,
      sessions: entry.sessions
    })),
    overlays: overlays.map((entry) => ({
      overlayId: entry.value,
      clicks: entry.events,
      sessions: entry.sessions
    })),
    timelineInteractions: [...new Set([...shown.keys(), ...clicked.keys()])].map((interactionId) => ({
      interactionId,
      shown: shown.get(interactionId) ?? 0,
      clicked: clicked.get(interactionId) ?? 0
    })),
    spatial: mapSurfaces.map((entry) => ({
      surface: entry.value,
      interactions: entry.events,
      sessions: entry.sessions
    }))
  };
}

export async function videoAnalytics(
  projectId: string,
  userId: string,
  request: AnalyticsRequest
): Promise<Record<string, unknown>> {
  const query = await authorizedQuery(projectId, userId, request);
  const counts = countsByName(await store.eventCounts(query));
  const [profiles, failures] = await Promise.all([
    store.payloadBreakdown(query, ['video_profile_selected'], 'profileId'),
    store.payloadBreakdown(query, ['video_playback_failed'], 'failureCategory')
  ]);
  return {
    range: rangePayload(query),
    playback: {
      starts: counts.get('video_started')?.events ?? 0,
      pauses: counts.get('video_paused')?.events ?? 0,
      resumes: counts.get('video_resumed')?.events ?? 0,
      seeks: counts.get('video_seeked')?.events ?? 0,
      completions: counts.get('video_ended')?.events ?? 0,
      stalls: counts.get('video_stalled')?.events ?? 0,
      sessions: counts.get('video_started')?.sessions ?? 0
    },
    profileSelections: profiles.map((entry) => ({
      profileId: entry.value,
      selections: entry.events,
      sessions: entry.sessions
    })),
    failureCategories: failures.map((entry) => ({
      category: entry.value,
      events: entry.events,
      sessions: entry.sessions
    }))
  };
}

export async function reliabilityAnalytics(
  projectId: string,
  userId: string,
  request: AnalyticsRequest
): Promise<Record<string, unknown>> {
  const query = await authorizedQuery(projectId, userId, request);
  const counts = countsByName(await store.eventCounts(query));
  const [assetFailures, transitionFailures, capabilityFallbacks, integrations] = await Promise.all([
    store.payloadBreakdown(query, ['asset_failed'], 'failureCategory'),
    store.payloadBreakdown(query, ['scene_transition_failed'], 'failureCategory'),
    store.payloadBreakdown(query, ['capability_fallback'], 'capabilityId'),
    store.viewerIntegrationBreakdown(query)
  ]);
  const loads = counts.get('experience_load_started')?.events ?? 0;
  const failures = RELIABILITY_EVENTS.reduce(
    (total, eventName) => total + (counts.get(eventName)?.events ?? 0),
    0
  );
  return {
    range: rangePayload(query),
    // Operational health, deliberately reported apart from engagement metrics.
    totals: {
      experienceLoads: loads,
      failureEvents: failures,
      failureEventsPerLoad: loads === 0 ? null : Number((failures / loads).toFixed(4))
    },
    assetFailureCategories: assetFailures.map((entry) => ({
      category: entry.value,
      events: entry.events
    })),
    sceneTransitionFailureCategories: transitionFailures.map((entry) => ({
      category: entry.value,
      events: entry.events
    })),
    capabilityFallbacks: capabilityFallbacks.map((entry) => ({
      capabilityId: entry.value,
      events: entry.events,
      sessions: entry.sessions
    })),
    viewerIntegrationVersions: integrations
  };
}
