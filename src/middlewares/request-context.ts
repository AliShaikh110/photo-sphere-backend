import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';

const safeRequestId = /^[A-Za-z0-9._:-]{1,128}$/;

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const supplied = request.header('x-request-id');
  request.requestId = supplied && safeRequestId.test(supplied) ? supplied : randomUUID();
  request.log = logger.child({ requestId: request.requestId });
  response.setHeader('x-request-id', request.requestId);
  const started = performance.now();
  response.on('finish', () => {
    request.log.info(
      {
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round((performance.now() - started) * 100) / 100
      },
      'request completed'
    );
  });
  next();
}
