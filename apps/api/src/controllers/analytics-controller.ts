import type { Request, Response } from 'express';

import {
  experienceSummary,
  experienceTimeseries,
  interactionAnalytics,
  reliabilityAnalytics,
  sceneAnalytics,
  videoAnalytics,
  type AnalyticsRequest
} from '../services/analytics-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';
import { analyticsQuerySchema } from '../validators/request-schemas';

function userId(request: Request): string {
  return request.auth!.userId;
}

function analyticsRequest(request: Request): AnalyticsRequest {
  const query = analyticsQuerySchema.parse(request.query ?? {});
  return {
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    ...(query.publicationRevision === undefined
      ? {}
      : { publicationRevision: query.publicationRevision }),
    ...(query.interval === undefined ? {} : { interval: query.interval })
  };
}

/** Aggregates are derived per request, so they are never cached at the edge. */
function noStore(response: Response): void {
  response.setHeader('cache-control', 'private, no-store');
}

export async function summary(request: Request, response: Response): Promise<void> {
  const result = await experienceSummary(
    routeParam(request, 'projectId'),
    userId(request),
    analyticsRequest(request)
  );
  noStore(response);
  sendData(response, result);
}

export async function timeseries(request: Request, response: Response): Promise<void> {
  const result = await experienceTimeseries(
    routeParam(request, 'projectId'),
    userId(request),
    analyticsRequest(request)
  );
  noStore(response);
  sendData(response, result);
}

export async function scenes(request: Request, response: Response): Promise<void> {
  const result = await sceneAnalytics(
    routeParam(request, 'projectId'),
    userId(request),
    analyticsRequest(request)
  );
  noStore(response);
  sendData(response, result);
}

export async function interactions(request: Request, response: Response): Promise<void> {
  const result = await interactionAnalytics(
    routeParam(request, 'projectId'),
    userId(request),
    analyticsRequest(request)
  );
  noStore(response);
  sendData(response, result);
}

export async function video(request: Request, response: Response): Promise<void> {
  const result = await videoAnalytics(
    routeParam(request, 'projectId'),
    userId(request),
    analyticsRequest(request)
  );
  noStore(response);
  sendData(response, result);
}

export async function reliability(request: Request, response: Response): Promise<void> {
  const result = await reliabilityAnalytics(
    routeParam(request, 'projectId'),
    userId(request),
    analyticsRequest(request)
  );
  noStore(response);
  sendData(response, result);
}
