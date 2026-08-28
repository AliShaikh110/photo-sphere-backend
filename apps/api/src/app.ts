import cors from 'cors';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { QueryTypes } from 'sequelize';
import { config } from './config';
import { sequelize } from './database';
import { REQUIRED_MIGRATION_NAME } from './database/migrate';
import { AppError } from './errors/app-error';
import { errorHandler, routeNotFound } from './middlewares/error-handler';
import { requestContext } from './middlewares/request-context';
import { assetRouter } from './routes/asset-routes';
import { authRouter } from './routes/auth-routes';
import { extensionRouter, platformRouter } from './routes/platform-routes';
import { projectRouter } from './routes/project-routes';
import { telemetryRouter } from './routes/telemetry-routes';
import { templateRouter } from './routes/template-routes';
import { workspaceRouter } from './routes/workspace-routes';
import { mediaRouter, publicationMediaRouter, viewRouter } from './routes/experience-routes';
import { apiVersion, API_VERSION, SUPPORTED_API_VERSIONS } from './middlewares/api-version';
import { asyncHandler } from './utils/async-handler';
import { sendData } from './utils/http-response';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"]
        }
      }
    })
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
        else callback(new AppError('CORS_ORIGIN_DENIED', 'This origin is not allowed.', { status: 403 }));
      },
      credentials: false,
      allowedHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'X-Request-ID',
        'X-Share-Token',
        'X-Telemetry-Token'
      ],
      exposedHeaders: ['X-Request-ID', 'Idempotency-Replayed'],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']
    })
  );
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_request: Request, _response: Response, next: NextFunction) => next(
        new AppError('RATE_LIMITED', 'Too many requests.', { status: 429, retryable: true })
      )
    })
  );

  app.get('/health/live', (_request, response) => sendData(response, { status: 'ok' }));
  app.get(
    '/health/ready',
    asyncHandler(async (_request, response) => {
      try {
        await sequelize.authenticate();
        const migrations = await sequelize.query<{ name: string }>(
          'SELECT name FROM "SequelizeMeta" WHERE name = :name',
          {
            replacements: { name: REQUIRED_MIGRATION_NAME },
            type: QueryTypes.SELECT
          }
        );
        if (migrations.length !== 1) throw new Error('Required database migration is not applied.');
        await sequelize.query('SELECT 1 FROM "users" LIMIT 0');
        await mkdir(config.storageRoot, { recursive: true });
        await access(config.storageRoot, fsConstants.R_OK | fsConstants.W_OK);
        sendData(response, { status: 'ready' });
      } catch (cause) {
        throw new AppError('SERVICE_NOT_READY', 'A required service dependency is not ready.', {
          status: 503,
          retryable: true,
          cause
        });
      }
    })
  );
  app.get('/', (_request, response) => {
    sendData(response, {
      service: 'sphere-backend',
      apiVersion: API_VERSION,
      supportedApiVersions: SUPPORTED_API_VERSIONS,
      schemaVersion: 1,
      viewerIntegrationVersion: config.viewerIntegrationVersion
    });
  });

  app.use(express.json({ limit: '1mb', strict: true }));
  app.use('/api/v1', apiVersion('v1'));
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/projects', projectRouter);
  app.use('/api/v1/assets', assetRouter);
  app.use('/api/v1/templates', templateRouter);
  app.use('/api/v1/workspaces', workspaceRouter);
  app.use('/api/v1/extensions', extensionRouter);
  app.use('/api/v1/platform', platformRouter);
  app.use('/api/v1/media', mediaRouter);
  app.use('/api/v1/publications', publicationMediaRouter);
  app.use('/api/v1/runtime', telemetryRouter);
  app.use('/view', viewRouter);

  app.use(routeNotFound);
  app.use(errorHandler);
  return app;
}

export const app = createApp();
