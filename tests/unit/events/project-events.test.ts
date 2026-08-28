import { afterEach, describe, expect, it } from 'vitest';

import { config } from '../../../apps/api/src/config';
import {
  EventStreamLimitError,
  eventsAfter,
  openStreamCount,
  publishProjectEvent,
  resetProjectEvents,
  subscribeToProject,
  type ProjectEvent
} from '../../../apps/api/src/services/project-events-service';

const FIRST = '11111111-1111-4000-8000-000000000001';
const SECOND = '11111111-1111-4000-8000-000000000002';

function collector(projectId: string, userId: string): {
  received: ProjectEvent[];
  subscriber: Parameters<typeof subscribeToProject>[0];
} {
  const received: ProjectEvent[] = [];
  return {
    received,
    subscriber: { projectId, userId, deliver: (event) => received.push(event) }
  };
}

describe('project event channel', () => {
  afterEach(() => {
    resetProjectEvents();
  });

  it('delivers only to subscribers of the project that changed', () => {
    const watching = collector(FIRST, 'user-1');
    const elsewhere = collector(SECOND, 'user-2');
    const stopWatching = subscribeToProject(watching.subscriber);
    const stopElsewhere = subscribeToProject(elsewhere.subscriber);

    publishProjectEvent({
      type: 'project.revision.changed',
      projectId: FIRST,
      actorUserId: 'user-1',
      data: { revision: 4 }
    });

    expect(watching.received).toHaveLength(1);
    expect(watching.received[0]).toMatchObject({
      id: 1,
      type: 'project.revision.changed',
      actorUserId: 'user-1',
      data: { revision: 4 }
    });
    expect(elsewhere.received).toHaveLength(0);
    stopWatching();
    stopElsewhere();
    expect(openStreamCount()).toBe(0);
  });

  it('numbers events per project so a resume is unambiguous', () => {
    for (const projectId of [FIRST, SECOND]) {
      publishProjectEvent({ type: 'asset.ready', projectId, data: { assetId: 'a' } });
      publishProjectEvent({ type: 'asset.ready', projectId, data: { assetId: 'b' } });
    }
    expect(eventsAfter(FIRST, 0)!.map((event) => event.id)).toEqual([1, 2]);
    expect(eventsAfter(SECOND, 1)!.map((event) => event.id)).toEqual([2]);
    expect(eventsAfter(FIRST, 2)).toEqual([]);
    // A project nobody has touched has nothing to replay, not a gap.
    expect(eventsAfter('11111111-1111-4000-8000-00000000000f', 0)).toEqual([]);
  });

  it('reports a gap rather than a partial history it cannot complete', () => {
    const bufferSize = config.eventStream.replayBufferSize;
    try {
      (config.eventStream as { replayBufferSize: number }).replayBufferSize = 3;
      for (let index = 0; index < 6; index += 1) {
        publishProjectEvent({ type: 'asset.ready', projectId: FIRST, data: { index } });
      }
      // Events 1 to 3 are gone, so resuming from 1 cannot be answered honestly.
      expect(eventsAfter(FIRST, 1)).toBeUndefined();
      expect(eventsAfter(FIRST, 4)!.map((event) => event.id)).toEqual([5, 6]);
    } finally {
      (config.eventStream as { replayBufferSize: number }).replayBufferSize = bufferSize;
    }
  });

  it('bounds connections per project and per user', () => {
    const perProject = config.eventStream.maxConnectionsPerProject;
    const perUser = config.eventStream.maxConnectionsPerUser;
    const stops: (() => void)[] = [];
    try {
      (config.eventStream as { maxConnectionsPerProject: number }).maxConnectionsPerProject = 2;
      (config.eventStream as { maxConnectionsPerUser: number }).maxConnectionsPerUser = 3;
      stops.push(subscribeToProject(collector(FIRST, 'user-a').subscriber));
      stops.push(subscribeToProject(collector(FIRST, 'user-b').subscriber));
      expect(() => subscribeToProject(collector(FIRST, 'user-c').subscriber))
        .toThrow(EventStreamLimitError);

      stops.push(subscribeToProject(collector(SECOND, 'user-a').subscriber));
      stops.push(subscribeToProject(collector(SECOND, 'user-a').subscriber));
      // A third stream for the same person, anywhere, is one too many.
      expect(() => subscribeToProject(collector(SECOND, 'user-a').subscriber))
        .toThrow(EventStreamLimitError);
    } finally {
      for (const stop of stops) stop();
      (config.eventStream as { maxConnectionsPerProject: number })
        .maxConnectionsPerProject = perProject;
      (config.eventStream as { maxConnectionsPerUser: number }).maxConnectionsPerUser = perUser;
    }
  });

  it('keeps delivering to healthy subscribers when one connection breaks', () => {
    const healthy = collector(FIRST, 'user-healthy');
    const stopBroken = subscribeToProject({
      projectId: FIRST,
      userId: 'user-broken',
      deliver: () => {
        throw new Error('socket closed');
      }
    });
    const stopHealthy = subscribeToProject(healthy.subscriber);

    publishProjectEvent({ type: 'publication.completed', projectId: FIRST, data: {} });

    expect(healthy.received).toHaveLength(1);
    stopBroken();
    stopHealthy();
  });
});
