import type { ErrorRequestHandler, RequestHandler } from 'express';
import { UniqueConstraintError, ValidationError as SequelizeValidationError } from 'sequelize';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error';

export const routeNotFound: RequestHandler = (request, _response, next) => {
  next(new AppError('ROUTE_NOT_FOUND', 'The requested route was not found.', {
    status: 404,
    details: { method: request.method, path: request.path }
  }));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  void _next;
  let mapped: AppError;
  if (error instanceof AppError) {
    mapped = error;
  } else if (error instanceof ZodError) {
    const first = error.issues[0];
    mapped = new AppError('VALIDATION_FAILED', 'The request contains invalid data.', {
      status: 422,
      ...(first?.path.length ? { path: first.path.join('.') } : {}),
      details: {
        issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      }
    });
  } else if (error instanceof UniqueConstraintError) {
    mapped = new AppError('CONFLICT', 'A resource with the same unique value already exists.', {
      status: 409,
      details: { fields: error.fields }
    });
  } else if (error instanceof SequelizeValidationError) {
    mapped = new AppError('VALIDATION_FAILED', 'The resource could not be saved.', {
      status: 422,
      details: { fields: error.errors.map((item) => item.path).filter(Boolean) }
    });
  } else if (
    typeof error === 'object'
    && error !== null
    && 'type' in error
    && (error as { type?: unknown }).type === 'entity.too.large'
  ) {
    mapped = new AppError('REQUEST_BODY_TOO_LARGE', 'The request body exceeds the configured limit.', {
      status: 413
    });
  } else if (
    typeof error === 'object'
    && error !== null
    && 'type' in error
    && (error as { type?: unknown }).type === 'entity.parse.failed'
  ) {
    mapped = new AppError('INVALID_JSON', 'The request body contains invalid JSON.', { status: 400 });
  } else {
    mapped = new AppError('INTERNAL_ERROR', 'An unexpected error occurred.', { status: 500 });
  }

  if (mapped.status >= 500) {
    request.log.error({ err: error }, 'request failed');
  } else {
    request.log.warn({ errorCode: mapped.code, statusCode: mapped.status }, 'request rejected');
  }

  if (request.header('idempotency-key')) {
    response.setHeader('idempotency-replayed', String(mapped.idempotencyReplayed ?? false));
  }

  response.status(mapped.status).json({
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.entityId === undefined ? {} : { entityId: mapped.entityId }),
      ...(mapped.path === undefined ? {} : { path: mapped.path }),
      retryable: mapped.retryable,
      details: mapped.details,
      requestId: request.requestId
    }
  });
};
