import express, { Router } from 'express';
import { config } from '../config';
import { complete, createUpload, read, remove, reprocess, uploadContent } from '../controllers/asset-controller';
import { requireAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  assetIdParams,
  completeUploadSchema,
  uploadSessionParams,
  uploadSessionSchema
} from '../validators/request-schemas';

export const assetRouter = Router();

assetRouter.use(requireAuth);
assetRouter.post('/uploads', validate('body', uploadSessionSchema), asyncHandler(createUpload));
assetRouter.put(
  '/uploads/:uploadSessionId/content',
  validate('params', uploadSessionParams),
  express.raw({ type: () => true, limit: config.maxImageUploadBytes }),
  asyncHandler(uploadContent)
);
assetRouter.post(
  '/:assetId/complete',
  validate('params', assetIdParams),
  validate('body', completeUploadSchema),
  asyncHandler(complete)
);
assetRouter.get('/:assetId', validate('params', assetIdParams), asyncHandler(read));
assetRouter.post('/:assetId/reprocess', validate('params', assetIdParams), asyncHandler(reprocess));
assetRouter.delete('/:assetId', validate('params', assetIdParams), asyncHandler(remove));
