import { Op, UniqueConstraintError, type Transaction } from 'sequelize';
import { AppError } from '../errors/app-error';
import { IdempotencyRecord } from '../models/idempotency-record.model';
import type { JsonObject } from '../models/model.types';
import { hashRequest } from '../utils/hash';

const keyPattern = /^[A-Za-z0-9._:-]{8,255}$/;
const operationLeaseMilliseconds = 5 * 60 * 1000;

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value || !keyPattern.test(value)) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required for this operation.',
      { status: 400, path: 'headers.Idempotency-Key' }
    );
  }
  return value;
}

async function loadRecord(ownerId: string, operation: string, key: string): Promise<IdempotencyRecord | null> {
  return IdempotencyRecord.findOne({ where: { ownerId, operation, key } });
}

function requestInProgress(): AppError {
  return new AppError('REQUEST_IN_PROGRESS', 'An identical request is still being processed.', {
    status: 409,
    retryable: true
  });
}

function assertFingerprint(record: IdempotencyRecord, requestFingerprint: string): void {
  if (record.requestFingerprint !== requestFingerprint) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was already used with a different request.',
      { status: 409 }
    );
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storedFailure(record: IdempotencyRecord): AppError | undefined {
  if (record.status !== 'failed' || !isJsonObject(record.responseBody)) return undefined;
  const body = record.responseBody;
  if (typeof body.code !== 'string' || typeof body.message !== 'string') return undefined;
  const status = typeof body.status === 'number'
    ? body.status
    : (record.responseStatus ?? 500);
  return new AppError(body.code, body.message, {
    status,
    ...(typeof body.entityId === 'string' ? { entityId: body.entityId } : {}),
    ...(typeof body.path === 'string' ? { path: body.path } : {}),
    retryable: typeof body.retryable === 'boolean' ? body.retryable : false,
    idempotencyReplayed: true,
    details: isJsonObject(body.details) ? body.details : {}
  });
}

async function claimExistingRecord(
  record: IdempotencyRecord,
  requestFingerprint: string
): Promise<IdempotencyRecord> {
  assertFingerprint(record, requestFingerprint);
  if (record.status === 'completed' && record.responseBody) return record;
  if (storedFailure(record)) return record;

  const now = new Date();
  const leaseUntil = new Date(now.getTime() + operationLeaseMilliseconds);
  const [claimed] = await IdempotencyRecord.update(
    {
      status: 'in_progress',
      lockedUntil: leaseUntil,
      responseBody: null,
      responseStatus: null
    },
    {
      where: {
        id: record.id,
        requestFingerprint,
        [Op.or]: [
          { status: 'failed' },
          {
            status: 'in_progress',
            [Op.or]: [
              { lockedUntil: null },
              { lockedUntil: { [Op.lte]: now } }
            ]
          }
        ]
      }
    }
  );
  if (claimed !== 1) {
    const current = await IdempotencyRecord.findByPk(record.id);
    if (current) {
      assertFingerprint(current, requestFingerprint);
      if (current.status === 'completed' && current.responseBody) return current;
      if (storedFailure(current)) return current;
    }
    throw requestInProgress();
  }
  await record.reload();
  return record;
}

export async function completeIdempotencyLease<T extends Record<string, unknown>>(
  record: IdempotencyRecord,
  result: T,
  options: {
    responseStatus: number;
    resourceType?: string;
    resourceId?: string;
    transaction?: Transaction;
  }
): Promise<void> {
  const ownedLease = record.lockedUntil;
  if (!ownedLease) throw requestInProgress();
  const [completed] = await IdempotencyRecord.update(
    {
      status: 'completed',
      responseStatus: options.responseStatus,
      responseBody: result as unknown as JsonObject,
      resourceType: options.resourceType ?? record.resourceType,
      resourceId: options.resourceId ?? null,
      lockedUntil: null
    },
    {
      where: { id: record.id, status: 'in_progress', lockedUntil: ownedLease },
      ...(options.transaction === undefined ? {} : { transaction: options.transaction })
    }
  );
  if (completed !== 1) throw requestInProgress();
}

export async function failIdempotencyLeasePersisted(
  record: IdempotencyRecord,
  error: AppError,
  options: {
    resourceType?: string;
    resourceId?: string;
    transaction?: Transaction;
  } = {}
): Promise<void> {
  const ownedLease = record.lockedUntil;
  if (!ownedLease) throw requestInProgress();
  const responseBody: JsonObject = {
    code: error.code,
    message: error.message,
    status: error.status,
    retryable: error.retryable,
    details: error.details as JsonObject,
    ...(error.entityId === undefined ? {} : { entityId: error.entityId }),
    ...(error.path === undefined ? {} : { path: error.path })
  };
  const [failed] = await IdempotencyRecord.update(
    {
      status: 'failed',
      responseStatus: error.status,
      responseBody,
      resourceType: options.resourceType ?? record.resourceType,
      resourceId: options.resourceId ?? record.resourceId,
      lockedUntil: null
    },
    {
      where: { id: record.id, status: 'in_progress', lockedUntil: ownedLease },
      ...(options.transaction === undefined ? {} : { transaction: options.transaction })
    }
  );
  if (failed !== 1) throw requestInProgress();
}

async function failIdempotencyLease(record: IdempotencyRecord): Promise<void> {
  if (!record.lockedUntil) return;
  await IdempotencyRecord.update(
    { status: 'failed', lockedUntil: null },
    { where: { id: record.id, status: 'in_progress', lockedUntil: record.lockedUntil } }
  ).catch(() => undefined);
}

export async function withIdempotency<T extends Record<string, unknown>>(options: {
  ownerId: string;
  operation: string;
  key: string;
  request: unknown;
  execute: (record: IdempotencyRecord) => Promise<T>;
  responseStatus?: number;
  resourceType?: string;
  resourceId?: (result: T) => string | undefined;
}): Promise<{ result: T; replayed: boolean }> {
  const requestFingerprint = hashRequest(options.request);
  let record = await loadRecord(options.ownerId, options.operation, options.key);

  if (record) {
    record = await claimExistingRecord(record, requestFingerprint);
    if (record.status === 'completed' && record.responseBody) {
      return { result: record.responseBody as unknown as T, replayed: true };
    }
    const failure = storedFailure(record);
    if (failure) throw failure;
  } else {
    try {
      record = await IdempotencyRecord.create({
        ownerId: options.ownerId,
        operation: options.operation,
        key: options.key,
        requestFingerprint,
        status: 'in_progress',
        responseStatus: null,
        responseBody: null,
        resourceType: options.resourceType ?? null,
        resourceId: null,
        lockedUntil: new Date(Date.now() + operationLeaseMilliseconds),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;
      const raced = await loadRecord(options.ownerId, options.operation, options.key);
      if (!raced) {
        throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key is already in use.', {
          status: 409
        });
      }
      record = await claimExistingRecord(raced, requestFingerprint);
      if (record.status === 'completed' && record.responseBody) {
        return { result: record.responseBody as unknown as T, replayed: true };
      }
      const failure = storedFailure(record);
      if (failure) throw failure;
    }
  }

  try {
    const result = await options.execute(record);
    await record.reload();
    if (record.status !== 'completed') {
      await completeIdempotencyLease(record, result, {
        responseStatus: options.responseStatus ?? 200,
        ...(options.resourceType === undefined ? {} : { resourceType: options.resourceType }),
        ...(options.resourceId?.(result) === undefined
          ? {}
          : { resourceId: options.resourceId(result)! })
      });
    }
    return { result, replayed: false };
  } catch (error) {
    await failIdempotencyLease(record);
    throw error;
  }
}
