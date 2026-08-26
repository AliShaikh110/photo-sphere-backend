import { Op } from 'sequelize';
import { verifyTelemetryToken } from '../auth/tokens';
import { AppError } from '../errors/app-error';
import { Publication, RuntimeEvent } from '../models';
import type { JsonObject, RuntimeEventName } from '../models/model.types';
import { incrementMetric } from '../observability';

export type RuntimeEventInput = {
  eventId: string;
  eventName: RuntimeEventName;
  experienceId: string;
  publicationRevision: number;
  viewerIntegrationVersion: string;
  sessionId: string;
  deviceContext: Record<string, unknown>;
  runtimeContext?: Record<string, unknown>;
  payload: Record<string, unknown>;
  occurredAt: string;
};

/**
 * How the caller proved it may report against a publication: with the ingest
 * token issued alongside a manifest, or as a signed-in creator with access to
 * the project (which is how preview and diagnostic replay report).
 */
export type TelemetryAuthorization =
  | { readonly kind: 'sessionToken'; readonly token: string }
  | {
    readonly kind: 'creator';
    readonly authorizeProject: (experienceId: string) => Promise<void>;
  };

function telemetryUnauthorized(): AppError {
  incrementMetric('runtime.event.rejected', { errorCode: 'TELEMETRY_TOKEN_REQUIRED' });
  return new AppError(
    'TELEMETRY_TOKEN_REQUIRED',
    'Runtime telemetry requires the session token issued with the experience manifest.',
    { status: 401, path: 'headers.X-Telemetry-Token' }
  );
}

/**
 * Rejects a batch whose events do not all belong to the authorized session.
 *
 * The scope is checked per event rather than per batch: one valid token must
 * not become a way to write events against a different experience or revision.
 */
async function authorizeRuntimeEvents(
  events: readonly RuntimeEventInput[],
  authorization: TelemetryAuthorization | undefined
): Promise<void> {
  if (authorization === undefined) throw telemetryUnauthorized();
  if (authorization.kind === 'creator') {
    for (const experienceId of new Set(events.map((event) => event.experienceId))) {
      await authorization.authorizeProject(experienceId);
    }
    return;
  }
  const session = verifyTelemetryToken(authorization.token);
  const mismatched = events.find((event) => (
    event.experienceId !== session.experienceId
    || event.publicationRevision !== session.publicationRevision
    || event.viewerIntegrationVersion !== session.viewerIntegrationVersion
  ));
  if (mismatched) {
    incrementMetric('runtime.event.rejected', { errorCode: 'TELEMETRY_SCOPE_MISMATCH' });
    throw new AppError(
      'TELEMETRY_SCOPE_MISMATCH',
      'The telemetry event does not belong to the authorized session.',
      {
        status: 403,
        entityId: mismatched.experienceId,
        path: 'events.experienceId'
      }
    );
  }
}

export async function ingestRuntimeEvents(
  events: RuntimeEventInput[],
  authorization?: TelemetryAuthorization
): Promise<Record<string, unknown>> {
  await authorizeRuntimeEvents(events, authorization);
  const uniqueEvents = [...new Map(events.map((event) => [event.eventId, event])).values()];
  const publicationKeys = new Map<string, { experienceId: string; publicationRevision: number }>();
  for (const event of uniqueEvents) {
    publicationKeys.set(`${event.experienceId}:${event.publicationRevision}`, {
      experienceId: event.experienceId,
      publicationRevision: event.publicationRevision
    });
  }
  for (const key of publicationKeys.values()) {
    const publication = await Publication.findOne({
      where: {
        projectId: key.experienceId,
        publicationRevision: key.publicationRevision,
        status: { [Op.in]: ['published', 'retired'] }
      },
      attributes: ['id', 'compiledManifest']
    });
    if (!publication) {
      incrementMetric('runtime.event.rejected', { errorCode: 'PUBLICATION_NOT_FOUND' });
      throw new AppError('PUBLICATION_NOT_FOUND', 'The telemetry event references an unknown publication.', {
        status: 422,
        entityId: key.experienceId,
        path: 'events.publicationRevision'
      });
    }
    const expectedViewerIntegrationVersion = publication.compiledManifest?.viewerIntegrationVersion;
    if (
      typeof expectedViewerIntegrationVersion !== 'string'
      || uniqueEvents.some((event) => (
        event.experienceId === key.experienceId
        && event.publicationRevision === key.publicationRevision
        && event.viewerIntegrationVersion !== expectedViewerIntegrationVersion
      ))
    ) {
      incrementMetric('runtime.event.rejected', {
        errorCode: 'VIEWER_INTEGRATION_VERSION_MISMATCH'
      });
      throw new AppError(
        'VIEWER_INTEGRATION_VERSION_MISMATCH',
        'The telemetry event does not match the published viewer integration.',
        {
          status: 422,
          entityId: key.experienceId,
          path: 'events.viewerIntegrationVersion',
          details: { expectedViewerIntegrationVersion }
        }
      );
    }
  }
  const ids = uniqueEvents.map((event) => event.eventId);
  const existing = await RuntimeEvent.findAll({
    where: { eventId: { [Op.in]: ids } },
    attributes: ['eventId']
  });
  const existingIds = new Set(existing.map((event) => event.eventId));
  const newEvents = uniqueEvents.filter((event) => !existingIds.has(event.eventId));
  let accepted = 0;
  if (newEvents.length > 0) {
    const inserted = await RuntimeEvent.bulkCreate(
      newEvents.map((event) => ({
        eventId: event.eventId,
        eventName: event.eventName,
        experienceId: event.experienceId,
        publicationRevision: event.publicationRevision,
        viewerIntegrationVersion: event.viewerIntegrationVersion,
        sessionId: event.sessionId,
        deviceContext: event.deviceContext as JsonObject,
        runtimeContext: (event.runtimeContext ?? {}) as JsonObject,
        payload: event.payload as JsonObject,
        occurredAt: new Date(event.occurredAt),
        receivedAt: new Date()
      })),
      { ignoreDuplicates: true, returning: ['eventId'] }
    );
    accepted = inserted.length;
    for (const event of newEvents) {
      incrementMetric('runtime.event.ingested', { eventName: event.eventName });
      // A capability that fell back is an operational signal, not engagement:
      // it means a visitor did not get the experience that was published.
      if (event.eventName === 'capability_fallback') {
        incrementMetric('runtime.capability_fallback', {
          capabilityId: String(event.payload.capabilityId ?? 'unknown'),
          reason: String(event.payload.reason ?? 'unknown')
        });
      }
    }
  }
  return { accepted, duplicates: events.length - accepted };
}
