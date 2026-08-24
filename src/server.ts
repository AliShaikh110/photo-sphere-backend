import type { Server } from 'node:http';
import { app } from './app';
import { config } from './config';
import { logger } from './config/logger';
import { connectDatabase, disconnectDatabase } from './database';
import { migrator } from './database/migrate';
import { mediaWorker } from './services/media-worker-service';

export async function startServer(): Promise<Server> {
  await connectDatabase();
  if (config.autoMigrate) await migrator.up();
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'sphere backend listening');
  });
  if (config.mediaWorkerMode === 'embedded') mediaWorker.start();
  return server;
}

async function shutdown(server: Server, signal: string): Promise<void> {
  logger.info({ signal }, 'graceful shutdown started');
  mediaWorker.stop();
  const forced = setTimeout(() => {
    logger.error('graceful shutdown timed out');
    process.exitCode = 1;
    server.closeAllConnections();
  }, 10_000);
  forced.unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  clearTimeout(forced);
  await disconnectDatabase();
}

if (require.main === module) {
  void startServer()
    .then((server) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.once(signal, () => {
          void shutdown(server, signal).catch((error: unknown) => {
            logger.fatal({ err: error }, 'graceful shutdown failed');
            process.exitCode = 1;
          });
        });
      }
    })
    .catch((error: unknown) => {
      logger.fatal({ err: error }, 'server startup failed');
      process.exitCode = 1;
    });
}
