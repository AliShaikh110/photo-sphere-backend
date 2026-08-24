import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';
import { observeMetric } from '../observability';

const safeRequestId = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Collapses a concrete path into a route shape so metric labels stay bounded.
 * `/api/v1/projects/<uuid>/scenes` becomes `/api/v1/projects/:id/scenes`.
 */
function routeLabel(request: Request): string {
  const path = request.route?.path;
  const base = typeof request.baseUrl === 'string' ? request.baseUrl : '';
  if (typeof path === 'string') return `${base}${path}`;
  return request.path
    .split('/')
    .map((segment) => (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)
      || /^\d+$/.test(segment)
        ? ':id'
        : segment
    ))
    .join('/');
}

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const supplied = request.header('x-request-id');
  request.requestId = supplied && safeRequestId.test(supplied) ? supplied : randomUUID();
  request.log = logger.child({ requestId: request.requestId });
  response.setHeader('x-request-id', request.requestId);
  const started = performance.now();
  response.on('finish', () => {
    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    request.log.info(
      {
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs
      },
      'request completed'
    );
    observeMetric('api.request.duration', durationMs, {
      route: routeLabel(request),
      method: request.method,
      status: response.statusCode
    });
  });
  next();
}
