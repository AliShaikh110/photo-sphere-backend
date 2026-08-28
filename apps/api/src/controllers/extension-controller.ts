import type { Request, Response } from 'express';

import {
  getExtension,
  listExtensions,
  registerExtension,
  setExtensionStatus
} from '../services/extension-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';
import { extensionStatusSchema, registerExtensionSchema } from '../validators/request-schemas';

function userId(request: Request): string {
  return request.auth!.userId;
}

export async function list(_request: Request, response: Response): Promise<void> {
  const extensions = await listExtensions();
  sendData(response, { extensions });
}

export async function read(request: Request, response: Response): Promise<void> {
  const extension = await getExtension(
    routeParam(request, 'extensionId'),
    routeParam(request, 'version')
  );
  sendData(response, { extension });
}

export async function register(request: Request, response: Response): Promise<void> {
  const input = registerExtensionSchema.parse(request.body ?? {});
  const extension = await registerExtension(
    {
      extensionId: input.extensionId,
      version: input.version,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      supportedExperienceTypes: input.supportedExperienceTypes,
      schema: input.schema as Record<string, unknown>,
      requiredCapabilities: input.requiredCapabilities,
      runtimeModule: input.runtimeModule,
      ...(input.securityPolicy === undefined
        ? {}
        : { securityPolicy: input.securityPolicy as Record<string, unknown> }),
      ...(input.status === undefined ? {} : { status: input.status })
    },
    userId(request)
  );
  sendData(response, { extension }, { status: 201, message: 'Extension registered.' });
}

export async function patchStatus(request: Request, response: Response): Promise<void> {
  const input = extensionStatusSchema.parse(request.body ?? {});
  const extension = await setExtensionStatus(
    routeParam(request, 'extensionId'),
    routeParam(request, 'version'),
    input.status,
    userId(request)
  );
  sendData(response, { extension });
}
