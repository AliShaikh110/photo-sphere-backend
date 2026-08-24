import type { Request, Response } from 'express';

import {
  createTemplateFromProject,
  getTemplate,
  instantiateTemplate,
  listTemplates,
  setTemplateStatus
} from '../services/template-service';
import { requireIdempotencyKey, withIdempotency } from '../services/idempotency-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';
import {
  createTemplateSchema,
  instantiateTemplateSchema,
  listTemplatesQuerySchema,
  templateStatusSchema
} from '../validators/request-schemas';

function userId(request: Request): string {
  return request.auth!.userId;
}

export async function list(request: Request, response: Response): Promise<void> {
  const query = listTemplatesQuerySchema.parse(request.query ?? {});
  const templates = await listTemplates(userId(request), {
    ...(query.experienceType === undefined ? {} : { experienceType: query.experienceType })
  });
  sendData(response, { templates });
}

export async function read(request: Request, response: Response): Promise<void> {
  const template = await getTemplate(routeParam(request, 'templateId'), userId(request));
  sendData(response, { template });
}

export async function create(request: Request, response: Response): Promise<void> {
  const input = createTemplateSchema.parse(request.body ?? {});
  const result = await createTemplateFromProject(userId(request), {
    projectId: input.projectId,
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.assetPolicy === undefined ? {} : { assetPolicy: input.assetPolicy }),
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    ...(input.status === undefined ? {} : { status: input.status })
  });
  sendData(response, result, { status: 201, message: 'Template saved.' });
}

export async function patchStatus(request: Request, response: Response): Promise<void> {
  const input = templateStatusSchema.parse(request.body ?? {});
  const result = await setTemplateStatus(
    routeParam(request, 'templateId'),
    userId(request),
    input.status
  );
  sendData(response, result);
}

/**
 * Instantiation copies media and writes a full project graph, so it is
 * idempotent: a retried request returns the first project rather than a second.
 */
export async function instantiate(request: Request, response: Response): Promise<void> {
  const templateId = routeParam(request, 'templateId');
  const input = instantiateTemplateSchema.parse(request.body ?? {});
  const key = requireIdempotencyKey(request.header('idempotency-key'));
  const operation = await withIdempotency({
    ownerId: userId(request),
    operation: 'template.instantiate',
    key,
    request: { templateId, ...input },
    responseStatus: 201,
    resourceType: 'template',
    resourceId: () => templateId,
    execute: () => instantiateTemplate(templateId, userId(request), {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId })
    })
  });
  response.setHeader('idempotency-replayed', String(operation.replayed));
  sendData(response, operation.result, { status: 201, message: 'Project created from template.' });
}
