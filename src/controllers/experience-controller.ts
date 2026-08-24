import type { Request, Response } from 'express';
import { storage } from '../integrations/storage';
import {
  authorizeDerivative,
  authorizePublishedDerivative,
  listPublications,
  previewExperience,
  publishExperience,
  resolveDerivativeTile,
  resolveManifest,
  resolvePublishedScene,
  validateExperience
} from '../services/experience-service';
import { requireIdempotencyKey, withIdempotency } from '../services/idempotency-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';

function ownerId(request: Request): string {
  return request.auth!.userId;
}

export async function validateDraft(request: Request, response: Response): Promise<void> {
  const result = await validateExperience(
    routeParam(request, 'projectId'),
    ownerId(request),
    request.body.revision as number
  );
  sendData(response, result);
}

export async function preview(request: Request, response: Response): Promise<void> {
  const manifest = await previewExperience(
    routeParam(request, 'projectId'),
    ownerId(request),
    request.body.revision as number
  );
  sendData(response, { manifest });
}

export async function publish(request: Request, response: Response): Promise<void> {
  const key = requireIdempotencyKey(request.header('idempotency-key'));
  const projectId = routeParam(request, 'projectId');
  const operation = await withIdempotency({
    ownerId: ownerId(request),
    operation: 'project.publish',
    key,
    request: { projectId, ...request.body },
    responseStatus: 201,
    resourceType: 'project',
    resourceId: () => projectId,
    execute: (idempotencyRecord) => publishExperience({
      projectId,
      ownerId: ownerId(request),
      expectedRevision: request.body.revision as number,
      slug: request.body.slug as string,
      visibility: request.body.visibility as 'public' | 'private',
      idempotencyRecord
    })
  });
  response.setHeader('idempotency-replayed', String(operation.replayed));
  sendData(response, operation.result, { status: 201, message: 'Experience published.' });
}

export async function publicationHistory(request: Request, response: Response): Promise<void> {
  const publications = await listPublications(routeParam(request, 'projectId'), ownerId(request));
  sendData(response, { publications });
}

export async function manifest(request: Request, response: Response): Promise<void> {
  const result = await resolveManifest(routeParam(request, 'slug'), request.auth?.userId);
  response.setHeader(
    'cache-control',
    result.publication.visibility === 'public'
      ? 'public, max-age=0, must-revalidate'
      : 'private, no-store'
  );
  sendData(response, result);
}

async function sendPublishedScene(
  request: Request,
  response: Response,
  publicationRevision?: number
): Promise<void> {
  const result = await resolvePublishedScene({
    slug: routeParam(request, 'slug'),
    sceneId: routeParam(request, 'sceneId'),
    ...(publicationRevision === undefined ? {} : { publicationRevision }),
    ...(request.auth?.userId === undefined
      ? {}
      : { authenticatedUserId: request.auth.userId })
  });
  response.setHeader(
    'cache-control',
    result.visibility === 'public'
      ? result.revisionPinned
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate'
      : 'private, no-store'
  );
  if (result.visibility === 'public') {
    response.setHeader('etag', `"${result.checksum}"`);
  }
  sendData(response, { sceneDefinition: result.sceneDefinition });
}

export async function publishedScene(request: Request, response: Response): Promise<void> {
  await sendPublishedScene(request, response);
}

export async function revisionedPublishedScene(request: Request, response: Response): Promise<void> {
  await sendPublishedScene(request, response, Number(routeParam(request, 'publicationRevision')));
}

async function sendTile(
  response: Response,
  derivative: Awaited<ReturnType<typeof authorizeDerivative>>,
  level: number,
  x: number,
  y: number,
  cacheControl: string
): Promise<void> {
  const tile = resolveDerivativeTile(derivative, level, x, y);
  const object = await storage.get(tile.storageKey);
  response.setHeader('content-type', object.contentType ?? tile.mimeType);
  response.setHeader('content-length', String(object.sizeBytes));
  response.setHeader('cache-control', cacheControl);
  response.setHeader('etag', `"${object.metadata.checksumSha256 ?? tile.checksumSha256}"`);
  response.status(200).send(object.body);
}

export async function media(request: Request, response: Response): Promise<void> {
  const token = typeof request.query.token === 'string' ? request.query.token : undefined;
  const derivative = await authorizeDerivative(
    routeParam(request, 'derivativeId'),
    request.auth?.userId,
    token
  );
  const object = await storage.get(derivative.storageKey);
  response.setHeader('content-type', object.contentType ?? derivative.mimeType);
  response.setHeader('content-length', String(object.sizeBytes));
  response.setHeader('cache-control', 'private, no-store');
  const checksum = object.metadata.checksumSha256;
  if (checksum) response.setHeader('etag', `"${checksum}"`);
  response.status(200).send(object.body);
}

export async function mediaTile(request: Request, response: Response): Promise<void> {
  const token = typeof request.query.token === 'string' ? request.query.token : undefined;
  const derivative = await authorizeDerivative(
    routeParam(request, 'derivativeId'),
    request.auth?.userId,
    token
  );
  await sendTile(
    response,
    derivative,
    Number(routeParam(request, 'level')),
    Number(routeParam(request, 'x')),
    Number(routeParam(request, 'y')),
    'private, no-store'
  );
}

export async function publicationMedia(request: Request, response: Response): Promise<void> {
  const derivative = await authorizePublishedDerivative({
    projectId: routeParam(request, 'projectId'),
    publicationRevision: Number(routeParam(request, 'publicationRevision')),
    derivativeId: routeParam(request, 'derivativeId')
  });
  const object = await storage.get(derivative.storageKey);
  response.setHeader('content-type', object.contentType ?? derivative.mimeType);
  response.setHeader('content-length', String(object.sizeBytes));
  response.setHeader('cache-control', 'public, max-age=31536000, immutable');
  const checksum = object.metadata.checksumSha256;
  if (checksum) response.setHeader('etag', `"${checksum}"`);
  response.status(200).send(object.body);
}

export async function publicationMediaTile(request: Request, response: Response): Promise<void> {
  const derivative = await authorizePublishedDerivative({
    projectId: routeParam(request, 'projectId'),
    publicationRevision: Number(routeParam(request, 'publicationRevision')),
    derivativeId: routeParam(request, 'derivativeId')
  });
  await sendTile(
    response,
    derivative,
    Number(routeParam(request, 'level')),
    Number(routeParam(request, 'x')),
    Number(routeParam(request, 'y')),
    'public, max-age=31536000, immutable'
  );
}
