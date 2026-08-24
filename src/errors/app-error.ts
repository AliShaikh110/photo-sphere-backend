export type ErrorDetails = Record<string, unknown>;

export type AppErrorOptions = {
  status?: number;
  entityId?: string;
  path?: string;
  retryable?: boolean;
  idempotencyReplayed?: boolean;
  details?: ErrorDetails;
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly entityId: string | undefined;
  readonly path: string | undefined;
  readonly retryable: boolean;
  readonly idempotencyReplayed: boolean | undefined;
  readonly details: ErrorDetails;
  override readonly cause: unknown;

  constructor(code: string, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? 400;
    this.entityId = options.entityId;
    this.path = options.path;
    this.retryable = options.retryable ?? false;
    this.idempotencyReplayed = options.idempotencyReplayed;
    this.details = options.details ?? {};
    this.cause = options.cause;
  }
}

export function notFound(entity: string, entityId?: string): AppError {
  const stableEntityCode = entity.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return new AppError(`${stableEntityCode}_NOT_FOUND`, `${entity} was not found.`, {
    status: 404,
    ...(entityId === undefined ? {} : { entityId })
  });
}

export function forbidden(): AppError {
  return new AppError('FORBIDDEN', 'You do not have access to this resource.', { status: 403 });
}

export function conflict(code: string, message: string, details: ErrorDetails = {}): AppError {
  return new AppError(code, message, { status: 409, details });
}
