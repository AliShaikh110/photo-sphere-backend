import { config } from '../config';
import { logger } from '../config/logger';
import { incrementMetric } from '../observability';
import type { JsonObject } from '../models/model.types';

/**
 * The server-push channel for a live authoring session.
 *
 * It is an optimization, never a dependency: every fact published here is also
 * readable from a polling route, so a deployment behind a proxy that blocks
 * streaming loses latency and nothing else.
 *
 * Delivery is in-process. A multi-process deployment fans out through whatever
 * the platform already uses for that; the publisher API below is the seam.
 */

export const PROJECT_EVENT_TYPES = [
  'asset.processing.progress',
  'asset.ready',
  'asset.failed',
  'project.revision.changed',
  'publication.completed',
  'publication.failed'
] as const;

export type ProjectEventType = (typeof PROJECT_EVENT_TYPES)[number];

export interface ProjectEvent {
  /** Monotonic per project, so `Last-Event-ID` can resume without gaps. */
  readonly id: number;
  readonly type: ProjectEventType;
  readonly projectId: string;
  /** Who caused it, so a client can ignore the echo of its own write. */
  readonly actorUserId: string | null;
  readonly occurredAt: string;
  readonly data: JsonObject;
}

export interface ProjectEventSubscriber {
  readonly projectId: string;
  readonly userId: string;
  deliver(event: ProjectEvent): void;
}

interface ProjectChannel {
  nextId: number;
  readonly buffer: ProjectEvent[];
  readonly subscribers: Set<ProjectEventSubscriber>;
}

const channels = new Map<string, ProjectChannel>();

function channelFor(projectId: string): ProjectChannel {
  const existing = channels.get(projectId);
  if (existing) return existing;
  const created: ProjectChannel = { nextId: 1, buffer: [], subscribers: new Set() };
  channels.set(projectId, created);
  return created;
}

function connectionsForUser(userId: string): number {
  let total = 0;
  for (const channel of channels.values()) {
    for (const subscriber of channel.subscribers) {
      if (subscriber.userId === userId) total += 1;
    }
  }
  return total;
}

export class EventStreamLimitError extends Error {
  readonly code: 'EVENT_STREAM_LIMIT_REACHED';
  readonly scope: 'project' | 'user';

  constructor(scope: 'project' | 'user') {
    super('Too many open event streams.');
    this.name = 'EventStreamLimitError';
    this.code = 'EVENT_STREAM_LIMIT_REACHED';
    this.scope = scope;
  }
}

/**
 * Publishes an event to everyone watching a project.
 *
 * A project nobody is watching still advances its event id and keeps a bounded
 * replay buffer, so a client that connects mid-flight can tell whether it
 * missed anything.
 */
export function publishProjectEvent(input: {
  type: ProjectEventType;
  projectId: string;
  actorUserId?: string | null;
  occurredAt?: string;
  data?: JsonObject;
}): ProjectEvent {
  const channel = channelFor(input.projectId);
  const event: ProjectEvent = {
    id: channel.nextId,
    type: input.type,
    projectId: input.projectId,
    actorUserId: input.actorUserId ?? null,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    data: input.data ?? {}
  };
  channel.nextId += 1;
  channel.buffer.push(event);
  if (channel.buffer.length > config.eventStream.replayBufferSize) {
    channel.buffer.splice(0, channel.buffer.length - config.eventStream.replayBufferSize);
  }
  incrementMetric('events.published', { eventType: event.type });
  for (const subscriber of channel.subscribers) {
    try {
      subscriber.deliver(event);
    } catch (error) {
      // One broken connection must not stop the others being told.
      logger.warn({ err: error, projectId: input.projectId }, 'event delivery failed');
    }
  }
  return event;
}

/**
 * Events a resuming client missed, or `undefined` when the gap is longer than
 * the replay buffer and the client must reload rather than be told a
 * half-truth.
 */
export function eventsAfter(projectId: string, lastEventId: number): ProjectEvent[] | undefined {
  const channel = channels.get(projectId);
  if (!channel) return [];
  const oldest = channel.buffer[0];
  if (oldest !== undefined && oldest.id > lastEventId + 1) return undefined;
  return channel.buffer.filter((event) => event.id > lastEventId);
}

export function subscribeToProject(subscriber: ProjectEventSubscriber): () => void {
  const channel = channelFor(subscriber.projectId);
  if (channel.subscribers.size >= config.eventStream.maxConnectionsPerProject) {
    throw new EventStreamLimitError('project');
  }
  if (connectionsForUser(subscriber.userId) >= config.eventStream.maxConnectionsPerUser) {
    throw new EventStreamLimitError('user');
  }
  channel.subscribers.add(subscriber);
  return () => {
    channel.subscribers.delete(subscriber);
    if (channel.subscribers.size === 0 && channel.buffer.length === 0) {
      channels.delete(subscriber.projectId);
    }
  };
}

export function openStreamCount(projectId?: string): number {
  if (projectId !== undefined) return channels.get(projectId)?.subscribers.size ?? 0;
  let total = 0;
  for (const channel of channels.values()) total += channel.subscribers.size;
  return total;
}

/** Test and shutdown seam; a closed process should not hold subscribers. */
export function resetProjectEvents(): void {
  channels.clear();
}
