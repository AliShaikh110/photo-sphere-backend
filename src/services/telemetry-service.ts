import { Op } from 'sequelize';
import { AppError } from '../errors/app-error';
import { Publication, RuntimeEvent } from '../models';
import type { JsonObject, RuntimeEventName } from '../models/model.types';

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

export async function ingestRuntimeEvents(events: RuntimeEventInput[]): Promise<Record<string, unknown>> {
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
  }
  return { accepted, duplicates: events.length - accepted };
}
