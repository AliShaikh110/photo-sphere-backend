import type { Request, Response } from 'express';
import { config } from '../config';
import { AppError } from '../errors/app-error';
import {
  completeUpload,
  createUploadSession,
  deleteAsset,
  readAsset,
  reprocessAsset,
  storeUploadContent
} from '../services/asset-service';
import { requireIdempotencyKey, withIdempotency } from '../services/idempotency-service';
import { mediaWorker } from '../services/media-worker-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';

function ownerId(request: Request): string {
  return request.auth!.userId;
}

export async function createUpload(request: Request, response: Response): Promise<void> {
  const result = await createUploadSession(ownerId(request), request.body);
  sendData(response, result, { status: 201, message: 'Upload session created.' });
}

export async function uploadContent(request: Request, response: Response): Promise<void> {
  if (!Buffer.isBuffer(request.body)) {
    throw new AppError('UPLOAD_BODY_REQUIRED', 'The request body must contain the image bytes.', { status: 400 });
  }
  const result = await storeUploadContent({
    uploadSessionId: routeParam(request, 'uploadSessionId'),
    ownerId: ownerId(request),
    bytes: request.body,
    contentType: request.header('content-type') ?? 'application/octet-stream'
  });
  sendData(response, result, { message: 'Upload received.' });
}

export async function complete(request: Request, response: Response): Promise<void> {
  const key = requireIdempotencyKey(request.header('idempotency-key'));
  const assetId = routeParam(request, 'assetId');
  const operation = await withIdempotency({
    ownerId: ownerId(request),
    operation: 'asset.upload.complete',
    key,
    request: { assetId, ...request.body },
    responseStatus: 202,
    resourceType: 'asset',
    resourceId: () => assetId,
    execute: () => completeUpload({
      assetId,
      uploadSessionId: request.body.uploadSessionId as string,
      ownerId: ownerId(request)
    })
  });
  if (config.mediaWorkerMode === 'embedded' && !operation.replayed) mediaWorker.kick();
  response.setHeader('idempotency-replayed', String(operation.replayed));
  sendData(response, operation.result, { status: 202, message: 'Media processing queued.' });
}

export async function read(request: Request, response: Response): Promise<void> {
  sendData(response, { asset: await readAsset(routeParam(request, 'assetId'), ownerId(request)) });
}

export async function reprocess(request: Request, response: Response): Promise<void> {
  const key = requireIdempotencyKey(request.header('idempotency-key'));
  const assetId = routeParam(request, 'assetId');
  const operation = await withIdempotency({
    ownerId: ownerId(request),
    operation: 'asset.reprocess',
    key,
    request: { assetId },
    responseStatus: 202,
    resourceType: 'asset',
    resourceId: () => assetId,
    execute: () => reprocessAsset({ assetId, ownerId: ownerId(request), operationKey: key })
  });
  if (config.mediaWorkerMode === 'embedded' && !operation.replayed) mediaWorker.kick();
  response.setHeader('idempotency-replayed', String(operation.replayed));
  sendData(response, operation.result, { status: 202, message: 'Media reprocessing queued.' });
}

export async function remove(request: Request, response: Response): Promise<void> {
  sendData(response, await deleteAsset(routeParam(request, 'assetId'), ownerId(request)), {
    message: 'Asset deleted.'
  });
}
