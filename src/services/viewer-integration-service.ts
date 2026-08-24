import { createHash } from 'node:crypto';

import {
  defaultViewerIntegrationVersion,
  isSupportedViewerIntegrationVersion,
  listViewerIntegrationVersions,
  viewerIntegrationRegistration
} from '../compiler';
import { config } from '../config';
import { AppError, notFound } from '../errors/app-error';
import { PlatformSetting, ViewerIntegrationCheck } from '../models';
import type { JsonObject, JsonValue } from '../models/model.types';
import { incrementMetric } from '../observability';
import { runReferenceExperienceSuite, type ReferenceSuiteResult } from '../reference';
import { recordAudit } from './audit-service';

const ROLLOUT_SETTING_KEY = 'viewerIntegrationRollout';
const ROLLOUT_CACHE_TTL_MS = 15_000;

export interface ViewerIntegrationRollout {
  /** The version most publications compile against. */
  readonly activeVersion: string;
  /** A newer adapter being rolled out, or null when no rollout is running. */
  readonly candidateVersion: string | null;
  /** Deterministic share of projects, 0-100, compiled with the candidate. */
  readonly rolloutPercent: number;
  readonly updatedAt: string | null;
}

let cachedRollout: { rollout: ViewerIntegrationRollout; expiresAt: number } | undefined;

function configuredRollout(): ViewerIntegrationRollout {
  const activeVersion = isSupportedViewerIntegrationVersion(config.viewerIntegrationVersion)
    ? config.viewerIntegrationVersion
    : defaultViewerIntegrationVersion();
  const candidate = config.viewerIntegrationCandidateVersion;
  const candidateVersion =
    candidate !== undefined
    && candidate !== activeVersion
    && isSupportedViewerIntegrationVersion(candidate)
      ? candidate
      : null;
  return {
    activeVersion,
    candidateVersion,
    rolloutPercent: candidateVersion === null ? 0 : config.viewerIntegrationRolloutPercent,
    updatedAt: null
  };
}

function parseRollout(value: unknown): ViewerIntegrationRollout | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const activeVersion = record.activeVersion;
  if (typeof activeVersion !== 'string' || !isSupportedViewerIntegrationVersion(activeVersion)) {
    return undefined;
  }
  const candidate = record.candidateVersion;
  const candidateVersion =
    typeof candidate === 'string'
    && candidate !== activeVersion
    && isSupportedViewerIntegrationVersion(candidate)
      ? candidate
      : null;
  const percent = Number(record.rolloutPercent ?? 0);
  return {
    activeVersion,
    candidateVersion,
    rolloutPercent:
      candidateVersion === null || !Number.isFinite(percent)
        ? 0
        : Math.min(100, Math.max(0, Math.round(percent))),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null
  };
}

export function invalidateViewerIntegrationCache(): void {
  cachedRollout = undefined;
}

/**
 * The durable rollout, falling back to configuration when nothing has been set
 * through the operations API. Reads are cached briefly so a publish does not
 * pay for a settings lookup.
 */
export async function getViewerIntegrationRollout(): Promise<ViewerIntegrationRollout> {
  const nowMs = Date.now();
  if (cachedRollout && cachedRollout.expiresAt > nowMs) return cachedRollout.rollout;
  let rollout = configuredRollout();
  try {
    const stored = await PlatformSetting.findByPk(ROLLOUT_SETTING_KEY);
    rollout = (stored && parseRollout(stored.value)) ?? rollout;
  } catch {
    // Before the platform settings migration runs, configuration is the truth.
  }
  cachedRollout = { rollout, expiresAt: nowMs + ROLLOUT_CACHE_TTL_MS };
  return rollout;
}

/**
 * Stable bucketing so a project keeps compiling against the same integration
 * version across republishes while a rollout is in progress.
 */
function rolloutBucket(projectId: string): number {
  const digest = createHash('sha256').update(`viewer-integration:${projectId}`).digest();
  return digest.readUInt16BE(0) % 100;
}

export async function resolveViewerIntegrationVersion(projectId: string): Promise<string> {
  const rollout = await getViewerIntegrationRollout();
  if (rollout.candidateVersion === null || rollout.rolloutPercent <= 0) return rollout.activeVersion;
  return rolloutBucket(projectId) < rollout.rolloutPercent
    ? rollout.candidateVersion
    : rollout.activeVersion;
}

function serializeCheck(check: ViewerIntegrationCheck): Record<string, unknown> {
  return {
    id: check.id,
    viewerIntegrationVersion: check.viewerIntegrationVersion,
    status: check.status,
    totalCount: check.totalCount,
    passedCount: check.passedCount,
    failedCount: check.failedCount,
    results: check.results,
    startedAt: check.startedAt,
    finishedAt: check.finishedAt
  };
}

/** Runs the reference experience suite and records the outcome as a gate. */
export async function runViewerIntegrationCheck(
  version: string,
  actorUserId: string
): Promise<Record<string, unknown>> {
  if (!isSupportedViewerIntegrationVersion(version)) {
    throw new AppError(
      'VIEWER_INTEGRATION_NOT_SUPPORTED',
      'This build cannot produce that viewer integration version.',
      { status: 422, entityId: version, path: 'viewerIntegrationVersion' }
    );
  }
  const check = await ViewerIntegrationCheck.create({
    viewerIntegrationVersion: version,
    status: 'running',
    startedAt: new Date(),
    finishedAt: null,
    ranByUserId: actorUserId
  });
  let suite: ReferenceSuiteResult;
  try {
    suite = await runReferenceExperienceSuite(version);
  } catch (error) {
    await check.update({
      status: 'failed',
      finishedAt: new Date(),
      results: [
        {
          experienceId: 'suite',
          passed: false,
          failureMessage: error instanceof Error ? error.message : 'The suite could not run.'
        }
      ] as unknown as JsonValue[]
    });
    incrementMetric('viewer_integration.reference_suite_run', { version, status: 'failed' });
    throw error;
  }
  await check.update({
    status: suite.passed ? 'passed' : 'failed',
    totalCount: suite.totalCount,
    passedCount: suite.passedCount,
    failedCount: suite.failedCount,
    results: suite.results as unknown as JsonValue[],
    finishedAt: new Date()
  });
  incrementMetric('viewer_integration.reference_suite_run', {
    version,
    status: suite.passed ? 'passed' : 'failed'
  });
  return serializeCheck(check);
}

export async function listViewerIntegrationChecks(
  version?: string
): Promise<Record<string, unknown>[]> {
  const checks = await ViewerIntegrationCheck.findAll({
    ...(version === undefined ? {} : { where: { viewerIntegrationVersion: version } }),
    order: [['startedAt', 'DESC']],
    limit: 25
  });
  return checks.map(serializeCheck);
}

async function assertReferenceSuitePassed(version: string): Promise<void> {
  const passing = await ViewerIntegrationCheck.findOne({
    where: { viewerIntegrationVersion: version, status: 'passed' },
    order: [['finishedAt', 'DESC']]
  });
  if (!passing) {
    throw new AppError(
      'REFERENCE_SUITE_NOT_PASSED',
      'Run the reference experience suite against this version before rolling it out.',
      { status: 409, entityId: version, path: 'viewerIntegrationVersion' }
    );
  }
}

async function writeRollout(
  rollout: ViewerIntegrationRollout,
  actorUserId: string
): Promise<ViewerIntegrationRollout> {
  const value: JsonObject = {
    activeVersion: rollout.activeVersion,
    candidateVersion: rollout.candidateVersion,
    rolloutPercent: rollout.rolloutPercent,
    updatedAt: new Date().toISOString()
  };
  const existing = await PlatformSetting.findByPk(ROLLOUT_SETTING_KEY);
  if (existing) await existing.update({ value, updatedByUserId: actorUserId });
  else await PlatformSetting.create({ key: ROLLOUT_SETTING_KEY, value, updatedByUserId: actorUserId });
  invalidateViewerIntegrationCache();
  return { ...rollout, updatedAt: String(value.updatedAt) };
}

/**
 * Starts or adjusts a rollout. The candidate must have a passing reference
 * suite run, so an unverified adapter cannot reach customer publications.
 */
export async function setViewerIntegrationRollout(
  input: { candidateVersion: string | null; rolloutPercent: number },
  actorUserId: string
): Promise<Record<string, unknown>> {
  const current = await getViewerIntegrationRollout();
  if (input.candidateVersion !== null) {
    if (!isSupportedViewerIntegrationVersion(input.candidateVersion)) {
      throw new AppError(
        'VIEWER_INTEGRATION_NOT_SUPPORTED',
        'This build cannot produce that viewer integration version.',
        { status: 422, entityId: input.candidateVersion, path: 'candidateVersion' }
      );
    }
    if (input.candidateVersion === current.activeVersion) {
      throw new AppError(
        'VIEWER_INTEGRATION_ALREADY_ACTIVE',
        'That version is already the active viewer integration.',
        { status: 422, entityId: input.candidateVersion, path: 'candidateVersion' }
      );
    }
    await assertReferenceSuitePassed(input.candidateVersion);
  }
  const next: ViewerIntegrationRollout = {
    activeVersion: current.activeVersion,
    candidateVersion: input.candidateVersion,
    rolloutPercent: input.candidateVersion === null ? 0 : input.rolloutPercent,
    updatedAt: null
  };
  const stored = await writeRollout(next, actorUserId);
  await recordAudit({
    action: 'viewer_integration.rollout_changed',
    actorUserId,
    entityType: 'viewerIntegration',
    entityId: next.candidateVersion ?? next.activeVersion,
    metadata: {
      activeVersion: next.activeVersion,
      candidateVersion: next.candidateVersion,
      rolloutPercent: next.rolloutPercent,
      previous: {
        activeVersion: current.activeVersion,
        candidateVersion: current.candidateVersion,
        rolloutPercent: current.rolloutPercent
      }
    }
  });
  return { rollout: stored };
}

/** Makes the current candidate the active version and ends the rollout. */
export async function promoteViewerIntegration(
  version: string,
  actorUserId: string
): Promise<Record<string, unknown>> {
  if (!isSupportedViewerIntegrationVersion(version)) {
    throw new AppError(
      'VIEWER_INTEGRATION_NOT_SUPPORTED',
      'This build cannot produce that viewer integration version.',
      { status: 422, entityId: version, path: 'viewerIntegrationVersion' }
    );
  }
  await assertReferenceSuitePassed(version);
  const current = await getViewerIntegrationRollout();
  const stored = await writeRollout(
    { activeVersion: version, candidateVersion: null, rolloutPercent: 0, updatedAt: null },
    actorUserId
  );
  incrementMetric('viewer_integration.promoted', { version });
  await recordAudit({
    action: 'viewer_integration.rollout_changed',
    actorUserId,
    entityType: 'viewerIntegration',
    entityId: version,
    metadata: { promotedTo: version, previousActiveVersion: current.activeVersion }
  });
  return { rollout: stored };
}

/**
 * Rolls back to a previously active version. It is an ordinary promotion: the
 * gate still applies, so a rollback target must also pass the suite.
 */
export async function rollbackViewerIntegration(
  version: string,
  actorUserId: string
): Promise<Record<string, unknown>> {
  const registration = viewerIntegrationRegistration(version);
  if (registration === undefined) throw notFound('viewer integration version', version);
  return promoteViewerIntegration(version, actorUserId);
}

export function viewerIntegrationCatalog(): Record<string, unknown>[] {
  return listViewerIntegrationVersions().map((registration) => ({
    version: registration.version,
    rendererId: registration.rendererId,
    pinnedRendererVersion: registration.pinnedRendererVersion,
    status: registration.status,
    notes: registration.notes
  }));
}
