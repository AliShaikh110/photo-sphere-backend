import type { Request, Response } from 'express';
import { ingestRuntimeEvents, type RuntimeEventInput } from '../services/telemetry-service';
import { sendData } from '../utils/http-response';

export async function ingest(request: Request, response: Response): Promise<void> {
  const body = request.body as { events: RuntimeEventInput[] };
  sendData(response, await ingestRuntimeEvents(body.events), {
    status: 202,
    message: 'Runtime telemetry accepted.'
  });
}
