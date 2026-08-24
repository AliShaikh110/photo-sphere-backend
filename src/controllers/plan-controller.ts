import type { Request, Response } from 'express';

import {
  createPlan,
  deletePlan,
  listPlans,
  reorderPlans,
  updatePlan
} from '../services/plan-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';

function userId(request: Request): string {
  return request.auth!.userId;
}

export async function list(request: Request, response: Response): Promise<void> {
  const plans = await listPlans(routeParam(request, 'projectId'), userId(request));
  sendData(response, { plans });
}

export async function create(request: Request, response: Response): Promise<void> {
  const result = await createPlan(routeParam(request, 'projectId'), userId(request), {
    projectRevision: request.body.projectRevision as number,
    name: request.body.name as string,
    ...(request.body.assetId === undefined ? {} : { assetId: request.body.assetId as string | null }),
    ...(request.body.coordinateSystem === undefined
      ? {}
      : { coordinateSystem: request.body.coordinateSystem as 'plan_normalized' | 'plan_pixels' }),
    ...(request.body.metadata === undefined
      ? {}
      : { metadata: request.body.metadata as Record<string, unknown> })
  });
  sendData(response, result, { status: 201, message: 'Plan added.' });
}

export async function patch(request: Request, response: Response): Promise<void> {
  const result = await updatePlan(
    routeParam(request, 'projectId'),
    routeParam(request, 'planId'),
    userId(request),
    {
      projectRevision: request.body.projectRevision as number,
      ...(request.body.name === undefined ? {} : { name: request.body.name as string }),
      ...(request.body.assetId === undefined
        ? {}
        : { assetId: request.body.assetId as string | null }),
      ...(request.body.coordinateSystem === undefined
        ? {}
        : { coordinateSystem: request.body.coordinateSystem as 'plan_normalized' | 'plan_pixels' }),
      ...(request.body.metadata === undefined
        ? {}
        : { metadata: request.body.metadata as Record<string, unknown> })
    }
  );
  sendData(response, result);
}

export async function remove(request: Request, response: Response): Promise<void> {
  const result = await deletePlan(
    routeParam(request, 'projectId'),
    routeParam(request, 'planId'),
    userId(request),
    request.body.projectRevision as number
  );
  sendData(response, result);
}

export async function reorder(request: Request, response: Response): Promise<void> {
  const result = await reorderPlans(routeParam(request, 'projectId'), userId(request), {
    projectRevision: request.body.projectRevision as number,
    planIds: request.body.planIds as string[]
  });
  sendData(response, result);
}
