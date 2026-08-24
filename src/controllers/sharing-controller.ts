import type { Request, Response } from 'express';

import {
  createShareToken,
  listShareTokens,
  revokeShareToken
} from '../services/share-token-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';
import { createShareTokenSchema } from '../validators/request-schemas';

function userId(request: Request): string {
  return request.auth!.userId;
}

export async function list(request: Request, response: Response): Promise<void> {
  const shareTokens = await listShareTokens(routeParam(request, 'projectId'), userId(request));
  sendData(response, { shareTokens });
}

export async function create(request: Request, response: Response): Promise<void> {
  const input = createShareTokenSchema.parse(request.body ?? {});
  const result = await createShareToken(routeParam(request, 'projectId'), userId(request), {
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.expiresInHours === undefined ? {} : { expiresInHours: input.expiresInHours }),
    ...(input.publicationRevision === undefined
      ? {}
      : { publicationRevision: input.publicationRevision })
  });
  // The secret appears once, in this response body only.
  response.setHeader('cache-control', 'private, no-store');
  sendData(response, result, { status: 201, message: 'Share link created.' });
}

export async function revoke(request: Request, response: Response): Promise<void> {
  const result = await revokeShareToken(
    routeParam(request, 'projectId'),
    userId(request),
    routeParam(request, 'shareTokenId')
  );
  sendData(response, result);
}
