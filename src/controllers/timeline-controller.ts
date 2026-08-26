import type { Request, Response } from 'express';

import {
  bulkUpdateTimeline,
  createTimelineInteraction,
  deleteTimelineInteraction,
  duplicateTimelineInteraction,
  listTimeline,
  updateTimelineInteraction
} from '../services/timeline-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';

function userId(request: Request): string {
  return request.auth!.userId;
}

export async function readTimeline(request: Request, response: Response): Promise<void> {
  const timeline = await listTimeline(routeParam(request, 'projectId'), userId(request));
  sendData(response, { timeline });
}

export async function addInteraction(request: Request, response: Response): Promise<void> {
  const result = await createTimelineInteraction(
    routeParam(request, 'projectId'),
    userId(request),
    request.body
  );
  sendData(response, result, { status: 201, message: 'Interaction created.' });
}

export async function patchInteraction(request: Request, response: Response): Promise<void> {
  const result = await updateTimelineInteraction(
    routeParam(request, 'projectId'),
    routeParam(request, 'interactionId'),
    userId(request),
    request.body
  );
  sendData(response, result, { message: 'Interaction saved.' });
}

export async function removeInteraction(request: Request, response: Response): Promise<void> {
  const result = await deleteTimelineInteraction(
    routeParam(request, 'projectId'),
    routeParam(request, 'interactionId'),
    userId(request),
    request.body.projectRevision as number
  );
  sendData(response, result, { message: 'Interaction deleted.' });
}

export async function duplicateInteraction(request: Request, response: Response): Promise<void> {
  const result = await duplicateTimelineInteraction(
    routeParam(request, 'projectId'),
    routeParam(request, 'interactionId'),
    userId(request),
    request.body
  );
  sendData(response, result, { status: 201, message: 'Interaction duplicated.' });
}

export async function patchTimeline(request: Request, response: Response): Promise<void> {
  const result = await bulkUpdateTimeline(
    routeParam(request, 'projectId'),
    userId(request),
    request.body
  );
  sendData(response, result, { message: 'Timeline saved.' });
}
