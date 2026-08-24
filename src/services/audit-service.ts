import type { Transaction } from 'sequelize';
import { logger } from '../config/logger';
import { AuditLog } from '../models';
import type { AuditAction, JsonObject } from '../models/model.types';

export type AuditEntry = {
  action: AuditAction;
  actorUserId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  transaction?: Transaction;
};

/**
 * Appends an audit record. Auditing must never break the operation it
 * describes, so a write failure is logged rather than propagated — except
 * inside a caller-supplied transaction, where the caller owns the outcome.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const values = {
    action: entry.action,
    actorUserId: entry.actorUserId ?? null,
    workspaceId: entry.workspaceId ?? null,
    projectId: entry.projectId ?? null,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    metadata: (entry.metadata ?? {}) as JsonObject,
    occurredAt: new Date()
  };

  if (entry.transaction) {
    await AuditLog.create(values, { transaction: entry.transaction });
    return;
  }

  try {
    await AuditLog.create(values);
  } catch (error) {
    logger.error({ err: error, action: entry.action }, 'Failed to write audit log entry');
  }
}

export async function listProjectAuditLog(
  projectId: string,
  options: { limit?: number } = {}
): Promise<Record<string, unknown>[]> {
  const rows = await AuditLog.findAll({
    where: { projectId },
    order: [['occurredAt', 'DESC']],
    limit: Math.min(Math.max(options.limit ?? 100, 1), 500)
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorUserId: row.actorUserId,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    occurredAt: row.occurredAt
  }));
}

export async function listWorkspaceAuditLog(
  workspaceId: string,
  options: { limit?: number } = {}
): Promise<Record<string, unknown>[]> {
  const rows = await AuditLog.findAll({
    where: { workspaceId },
    order: [['occurredAt', 'DESC']],
    limit: Math.min(Math.max(options.limit ?? 100, 1), 500)
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorUserId: row.actorUserId,
    projectId: row.projectId,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    occurredAt: row.occurredAt
  }));
}
