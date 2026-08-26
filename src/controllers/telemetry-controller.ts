import type { Request, Response } from 'express';
import { requireProjectRole } from '../services/access-service';
import {
  ingestRuntimeEvents,
  type RuntimeEventInput,
  type TelemetryAuthorization
} from '../services/telemetry-service';
import { sendData } from '../utils/http-response';

/**
 * A visitor presents the ingest token issued with the manifest. A signed-in
 * creator may report without one, which covers preview sessions and replaying
 * a diagnostic session against their own experience.
 */
function telemetryAuthorization(request: Request): TelemetryAuthorization | undefined {
  const token = request.header('x-telemetry-token');
  if (token) return { kind: 'sessionToken', token };
  const userId = request.auth?.userId;
  if (userId === undefined) return undefined;
  return {
    kind: 'creator',
    authorizeProject: async (experienceId: string) => {
      await requireProjectRole(experienceId, userId, 'viewer');
    }
  };
}

export async function ingest(request: Request, response: Response): Promise<void> {
  const body = request.body as { events: RuntimeEventInput[] };
  sendData(response, await ingestRuntimeEvents(body.events, telemetryAuthorization(request)), {
    status: 202,
    message: 'Runtime telemetry accepted.'
  });
}
