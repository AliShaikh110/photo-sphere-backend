import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ingest } from '../controllers/telemetry-controller';
import { AppError } from '../errors/app-error';
import { optionalAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { runtimeEventsSchema } from '../validators/request-schemas';

export const telemetryRouter = Router();

telemetryRouter.post(
  '/events',
  optionalAuth,
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, _response, next) => next(
      new AppError('RATE_LIMITED', 'Too many telemetry requests.', {
        status: 429,
        retryable: true
      })
    )
  }),
  validate('body', runtimeEventsSchema),
  asyncHandler(ingest)
);
