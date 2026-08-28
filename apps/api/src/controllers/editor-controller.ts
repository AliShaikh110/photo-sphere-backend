import type { Request, Response } from 'express';

import { config } from '../config';
import { AppError } from '../errors/app-error';
import { incrementMetric } from '../observability';
import { verifyEditorSessionToken } from '../auth/tokens';
import { decodeAccessToken } from '../middlewares/auth';
import { editorBootstrap } from '../services/editor-service';
import { refreshMediaUrls } from '../services/media-token-service';
import { requireProjectRole } from '../services/access-service';
import {
  EventStreamLimitError,
  eventsAfter,
  subscribeToProject,
  type ProjectEvent
} from '../services/project-events-service';
import { bulkUpdateHotspots } from '../services/project-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';

function ownerId(request: Request): string {
  return request.auth!.userId;
}

export async function bootstrap(request: Request, response: Response): Promise<void> {
  sendData(response, await editorBootstrap(routeParam(request, 'projectId'), ownerId(request)));
}

export async function patchHotspots(request: Request, response: Response): Promise<void> {
  const body = request.body as {
    projectRevision: number;
    hotspots: { id: string }[];
  };
  sendData(response, await bulkUpdateHotspots(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    ownerId(request),
    body as Parameters<typeof bulkUpdateHotspots>[3]
  ));
}

export async function refreshMediaTokens(request: Request, response: Response): Promise<void> {
  const body = request.body as { derivativeIds: string[] };
  sendData(response, await refreshMediaUrls({
    derivativeIds: body.derivativeIds,
    actorUserId: ownerId(request)
  }));
}

/**
 * Resolves who is calling a browser-direct route.
 *
 * `EventSource` cannot set an Authorization header, which is exactly why the
 * short-lived, project-scoped editor session token exists and may travel as a
 * query parameter. It is checked against the project being opened, so a token
 * for one project cannot open another's stream.
 */
function streamIdentity(request: Request, projectId: string): {
  userId: string;
  via: 'bearer' | 'editor-session';
} {
  const bearer = /^Bearer\s+(.+)$/i.exec(request.header('authorization') ?? '')?.[1];
  if (bearer !== undefined) {
    return { userId: decodeAccessToken(bearer).sub, via: 'bearer' };
  }
  const token = typeof request.query.token === 'string' ? request.query.token : undefined;
  if (token === undefined) {
    throw new AppError('AUTHENTICATION_REQUIRED', 'Authentication is required.', { status: 401 });
  }
  const session = verifyEditorSessionToken(token);
  if (session.projectId !== projectId) {
    throw new AppError('EDITOR_SESSION_INVALID', 'The editing session is invalid or expired.', {
      status: 401
    });
  }
  return { userId: session.userId, via: 'editor-session' };
}

function writeEvent(response: Response, event: ProjectEvent): void {
  const payload = JSON.stringify({
    id: event.id,
    type: event.type,
    projectId: event.projectId,
    actorUserId: event.actorUserId,
    occurredAt: event.occurredAt,
    data: event.data
  });
  // One write per frame: a client must never see half an event because the
  // socket flushed between two writes.
  response.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${payload}\n\n`);
}

/**
 * The project event stream.
 *
 * One way, server to client, and purely an optimization: every fact it carries
 * is also readable from a polling route, so a deployment that cannot stream
 * turns it off and loses latency rather than function.
 */
export async function events(request: Request, response: Response): Promise<void> {
  const projectId = routeParam(request, 'projectId');
  if (!config.eventStream.enabled) {
    incrementMetric('events.stream.rejected', { reason: 'disabled' });
    throw new AppError('EVENT_STREAM_DISABLED', 'Live updates are turned off; poll instead.', {
      status: 503,
      retryable: false
    });
  }
  const identity = streamIdentity(request, projectId);
  try {
    await requireProjectRole(projectId, identity.userId, 'viewer');
  } catch (error) {
    incrementMetric('events.stream.rejected', { reason: 'not-permitted' });
    throw error;
  }

  const lastEventHeader = request.header('last-event-id');
  const parsedLastEventId = lastEventHeader === undefined
    ? Number.NaN
    : Number.parseInt(lastEventHeader, 10);
  const resumable = Number.isFinite(parsedLastEventId)
    ? eventsAfter(projectId, parsedLastEventId)
    : [];

  let unsubscribe: () => void;
  try {
    unsubscribe = subscribeToProject({
      projectId,
      userId: identity.userId,
      deliver: (event) => writeEvent(response, event)
    });
  } catch (error) {
    if (error instanceof EventStreamLimitError) {
      incrementMetric('events.stream.rejected', { reason: `limit-${error.scope}` });
      throw new AppError(
        'EVENT_STREAM_LIMIT_REACHED',
        'Too many live updates are already open; close one and try again.',
        { status: 429, retryable: true, details: { scope: error.scope } }
      );
    }
    throw error;
  }

  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Some reverse proxies buffer streamed responses; this asks them not to.
    'X-Accel-Buffering': 'no'
  });
  // A comment line is a valid SSE frame that clients ignore; it proves the
  // connection is alive to any proxy counting idle seconds.
  response.write(': open\n\n');
  incrementMetric('events.stream.opened', {
    resumed: resumable === undefined ? 'gap' : String(resumable.length > 0)
  });

  if (resumable === undefined) {
    // The gap is longer than the replay buffer. Say so rather than deliver a
    // partial history a client would mistake for the whole story.
    response.write('event: stream.gap\ndata: {"reason":"replay-buffer-exceeded"}\n\n');
  } else {
    for (const event of resumable) writeEvent(response, event);
  }

  const heartbeat = setInterval(() => {
    response.write(': heartbeat\n\n');
  }, config.eventStream.heartbeatMs);
  heartbeat.unref();

  const close = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.on('close', close);
  response.on('close', close);

  // The handler resolves while the stream stays open; the connection is closed
  // by the client, or by the process shutting down.
  await Promise.resolve();
}
