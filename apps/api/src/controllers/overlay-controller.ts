import type { Request, Response } from 'express';

import {
  createOverlay,
  deleteOverlay,
  listOverlays,
  updateOverlay,
  type GeometryInput
} from '../services/overlay-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';

function userId(request: Request): string {
  return request.auth!.userId;
}

function overlayInput(body: Record<string, unknown>): Record<string, unknown> {
  return {
    projectRevision: body.projectRevision as number,
    ...(body.name === undefined ? {} : { name: body.name as string | null }),
    ...(body.geometry === undefined ? {} : { geometry: body.geometry as GeometryInput }),
    ...(body.position === undefined
      ? {}
      : { position: body.position as Record<string, unknown> }),
    ...(body.appearance === undefined
      ? {}
      : { appearance: body.appearance as Record<string, unknown> }),
    ...(body.content === undefined ? {} : { content: body.content as Record<string, unknown> }),
    ...(body.action === undefined ? {} : { action: body.action as Record<string, unknown> }),
    ...(body.visibilityRules === undefined
      ? {}
      : { visibilityRules: body.visibilityRules as Record<string, unknown> })
  };
}

export async function list(request: Request, response: Response): Promise<void> {
  const overlays = await listOverlays(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    userId(request)
  );
  sendData(response, { overlays });
}

export async function create(request: Request, response: Response): Promise<void> {
  const result = await createOverlay(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    userId(request),
    overlayInput(request.body as Record<string, unknown>) as Parameters<typeof createOverlay>[3]
  );
  sendData(response, result, { status: 201, message: 'Overlay added.' });
}

export async function patch(request: Request, response: Response): Promise<void> {
  const result = await updateOverlay(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    routeParam(request, 'overlayId'),
    userId(request),
    overlayInput(request.body as Record<string, unknown>) as Parameters<typeof updateOverlay>[4]
  );
  sendData(response, result);
}

export async function remove(request: Request, response: Response): Promise<void> {
  const result = await deleteOverlay(
    routeParam(request, 'projectId'),
    routeParam(request, 'sceneId'),
    routeParam(request, 'overlayId'),
    userId(request),
    request.body.projectRevision as number
  );
  sendData(response, result);
}
