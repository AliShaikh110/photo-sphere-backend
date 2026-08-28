/**
 * The platform's operational metric contract.
 *
 * Metric names, their kind, unit and label set are declared here so dashboards
 * and alerts can be written against a stable contract rather than against
 * whatever a log line happened to include. The default sink is the structured
 * logger; a deployment can install a Prometheus/OTLP sink without touching a
 * single call site.
 */

export type MetricKind = 'counter' | 'gauge' | 'histogram';
export type MetricUnit = 'count' | 'milliseconds' | 'bytes';

export type MetricName =
  /* Media pipeline */
  | 'media.job.queue_delay'
  | 'media.job.duration'
  | 'media.job.stage_duration'
  | 'media.job.retry'
  | 'media.job.failed'
  | 'media.derivative.failed'
  /* Compiler and publishing */
  | 'compile.duration'
  | 'compile.validation_failed'
  | 'compile.manifest_bytes'
  | 'compile.scene_count'
  | 'publish.succeeded'
  | 'publish.failed'
  | 'publish.duration'
  | 'publish.scene_definition_bytes'
  /* Progressive delivery */
  | 'scene_definition.served'
  | 'scene_definition.latency'
  | 'scene_definition.failed'
  /* Runtime telemetry rollup */
  | 'runtime.event.ingested'
  | 'runtime.event.rejected'
  | 'runtime.capability_fallback'
  /* API surface */
  | 'api.request.duration'
  | 'api.request.failed'
  | 'api.auth.failed'
  | 'api.concurrency_conflict'
  | 'api.idempotency_replay'
  | 'api.rate_limited'
  /* Access and sharing */
  | 'access.private_denied'
  | 'access.share_token_used'
  | 'access.embed_origin_denied'
  /* Viewer integration rollout */
  | 'viewer_integration.reference_suite_run'
  | 'viewer_integration.promoted';

export interface MetricDefinition {
  readonly name: MetricName;
  readonly kind: MetricKind;
  readonly unit: MetricUnit;
  readonly description: string;
  /** Label keys a sink may rely on. Values must never carry personal data. */
  readonly labels: readonly string[];
}

function define(
  name: MetricName,
  kind: MetricKind,
  unit: MetricUnit,
  description: string,
  labels: readonly string[]
): MetricDefinition {
  return Object.freeze({ name, kind, unit, description, labels: Object.freeze([...labels]) });
}

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = Object.freeze([
  define('media.job.queue_delay', 'histogram', 'milliseconds', 'Time a media job waited before a worker claimed it.', ['jobType', 'mediaType']),
  define('media.job.duration', 'histogram', 'milliseconds', 'Wall-clock duration of a claimed media job.', ['jobType', 'mediaType', 'status']),
  define('media.job.stage_duration', 'histogram', 'milliseconds', 'Duration of one media job stage.', ['stage', 'status']),
  define('media.job.retry', 'counter', 'count', 'Media job attempts beyond the first.', ['jobType', 'mediaType']),
  define('media.job.failed', 'counter', 'count', 'Media jobs that ended in failure.', ['jobType', 'mediaType', 'errorCode']),
  define('media.derivative.failed', 'counter', 'count', 'Derivative generations that failed.', ['derivativeKind', 'errorCode']),

  define('compile.duration', 'histogram', 'milliseconds', 'Experience compilation duration.', ['experienceType', 'target', 'strategy']),
  define('compile.validation_failed', 'counter', 'count', 'Compilations rejected during validation or capability resolution.', ['experienceType', 'issueCode']),
  define('compile.manifest_bytes', 'histogram', 'bytes', 'Serialized size of a compiled manifest.', ['experienceType', 'strategy']),
  define('compile.scene_count', 'histogram', 'count', 'Scenes in a compiled experience.', ['experienceType', 'strategy']),
  define('publish.succeeded', 'counter', 'count', 'Publications that reached the published state.', ['experienceType', 'visibility', 'viewerIntegrationVersion']),
  define('publish.failed', 'counter', 'count', 'Publish attempts that failed.', ['experienceType', 'errorCode']),
  define('publish.duration', 'histogram', 'milliseconds', 'End-to-end publish duration.', ['experienceType', 'strategy']),
  define('publish.scene_definition_bytes', 'histogram', 'bytes', 'Serialized size of all compiled scene definitions.', ['experienceType', 'strategy']),

  define('scene_definition.served', 'counter', 'count', 'Progressive scene definitions served to players.', ['visibility', 'revisionPinned']),
  define('scene_definition.latency', 'histogram', 'milliseconds', 'Time to resolve a progressive scene definition.', ['visibility']),
  define('scene_definition.failed', 'counter', 'count', 'Progressive scene definition lookups that failed.', ['errorCode']),

  define('runtime.event.ingested', 'counter', 'count', 'Runtime telemetry events accepted.', ['eventName']),
  define('runtime.event.rejected', 'counter', 'count', 'Runtime telemetry events rejected.', ['errorCode']),
  define('runtime.capability_fallback', 'counter', 'count', 'Capability fallbacks reported by players.', ['capabilityId', 'reason']),

  define('api.request.duration', 'histogram', 'milliseconds', 'API request duration.', ['route', 'method', 'status']),
  define('api.request.failed', 'counter', 'count', 'API requests answered with an error.', ['route', 'method', 'status', 'errorCode']),
  define('api.auth.failed', 'counter', 'count', 'Authentication or authorization failures.', ['reason']),
  define('api.concurrency_conflict', 'counter', 'count', 'Optimistic concurrency conflicts.', ['entityType']),
  define('api.idempotency_replay', 'counter', 'count', 'Idempotent operations answered from a stored result.', ['operation']),
  define('api.rate_limited', 'counter', 'count', 'Requests rejected by a rate limiter.', ['scope']),

  define('access.private_denied', 'counter', 'count', 'Private experience accesses denied.', ['surface', 'reason']),
  define('access.share_token_used', 'counter', 'count', 'Private accesses granted by a share token.', ['surface']),
  define('access.embed_origin_denied', 'counter', 'count', 'Embed attempts blocked by the origin allowlist.', ['surface']),

  define('viewer_integration.reference_suite_run', 'counter', 'count', 'Reference experience suite runs.', ['version', 'status']),
  define('viewer_integration.promoted', 'counter', 'count', 'Viewer integration versions promoted to active.', ['version'])
]);

const definitionsByName = new Map(METRIC_DEFINITIONS.map((definition) => [definition.name, definition]));

export function metricDefinition(name: MetricName): MetricDefinition {
  const definition = definitionsByName.get(name);
  if (definition === undefined) throw new Error(`Unknown metric: ${name}`);
  return definition;
}

export type MetricLabels = Readonly<Record<string, string | number | boolean | undefined>>;

export interface MetricSink {
  record(definition: MetricDefinition, value: number, labels: MetricLabels): void;
}
