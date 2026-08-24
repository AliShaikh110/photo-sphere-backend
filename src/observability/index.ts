import { logger } from '../config/logger';
import {
  metricDefinition,
  METRIC_DEFINITIONS,
  type MetricDefinition,
  type MetricLabels,
  type MetricName,
  type MetricSink
} from './metrics';

export { METRIC_DEFINITIONS, metricDefinition } from './metrics';
export type {
  MetricDefinition,
  MetricKind,
  MetricLabels,
  MetricName,
  MetricSink,
  MetricUnit
} from './metrics';

/**
 * Emits one structured line per measurement. It is deliberately the default:
 * every deployment has logs, so no metric is silently lost while a metrics
 * backend is still being chosen.
 */
class LoggingMetricSink implements MetricSink {
  record(definition: MetricDefinition, value: number, labels: MetricLabels): void {
    logger.debug(
      {
        metric: definition.name,
        kind: definition.kind,
        unit: definition.unit,
        value,
        labels
      },
      'metric'
    );
  }
}

/**
 * Keeps the most recent value and a running total per metric and label set so
 * `/health/metrics` can answer without a metrics backend attached. The map is
 * bounded: an unbounded label space must never become a memory leak.
 */
class InMemoryMetricSink implements MetricSink {
  private static readonly MAX_SERIES = 2_000;
  private readonly series = new Map<string, {
    readonly name: MetricName;
    readonly labels: MetricLabels;
    count: number;
    sum: number;
    min: number;
    max: number;
    last: number;
  }>();

  record(definition: MetricDefinition, value: number, labels: MetricLabels): void {
    const key = `${definition.name}|${JSON.stringify(labels)}`;
    const existing = this.series.get(key);
    if (existing) {
      existing.count += 1;
      existing.sum += value;
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
      existing.last = value;
      return;
    }
    if (this.series.size >= InMemoryMetricSink.MAX_SERIES) return;
    this.series.set(key, {
      name: definition.name,
      labels,
      count: 1,
      sum: value,
      min: value,
      max: value,
      last: value
    });
  }

  snapshot(): Record<string, unknown>[] {
    return [...this.series.values()].map((entry) => ({
      metric: entry.name,
      labels: entry.labels,
      count: entry.count,
      sum: entry.sum,
      min: entry.min,
      max: entry.max,
      last: entry.last
    }));
  }

  reset(): void {
    this.series.clear();
  }
}

const loggingSink = new LoggingMetricSink();
const inMemorySink = new InMemoryMetricSink();
const sinks: MetricSink[] = [loggingSink, inMemorySink];

/** Installs an additional sink, for example a Prometheus or OTLP exporter. */
export function addMetricSink(sink: MetricSink): void {
  sinks.push(sink);
}

function emit(name: MetricName, value: number, labels: MetricLabels): void {
  const definition = metricDefinition(name);
  const cleaned: Record<string, string | number | boolean> = {};
  for (const [key, label] of Object.entries(labels)) {
    if (label !== undefined) cleaned[key] = label;
  }
  for (const sink of sinks) {
    try {
      sink.record(definition, value, cleaned);
    } catch (error) {
      // Observability must never break the operation it is observing.
      logger.warn({ err: error, metric: name }, 'Metric sink failed');
    }
  }
}

export function incrementMetric(name: MetricName, labels: MetricLabels = {}, value = 1): void {
  emit(name, value, labels);
}

export function observeMetric(name: MetricName, value: number, labels: MetricLabels = {}): void {
  emit(name, value, labels);
}

/** Times an operation and records its duration and outcome. */
export async function measure<T>(
  name: MetricName,
  labels: MetricLabels,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    observeMetric(name, Date.now() - startedAt, { ...labels, status: 'succeeded' });
    return result;
  } catch (error) {
    observeMetric(name, Date.now() - startedAt, { ...labels, status: 'failed' });
    throw error;
  }
}

export function metricsSnapshot(): Record<string, unknown>[] {
  return inMemorySink.snapshot();
}

export function resetMetrics(): void {
  inMemorySink.reset();
}

/** The published contract, used by the operations documentation and dashboards. */
export function metricsContract(): Record<string, unknown>[] {
  return METRIC_DEFINITIONS.map((definition) => ({
    name: definition.name,
    kind: definition.kind,
    unit: definition.unit,
    description: definition.description,
    labels: definition.labels
  }));
}
