/**
 * The API application's public surface.
 *
 * Only another deployable in this repository consumes it — the worker process
 * starts the same media pipeline the embedded worker runs, so there is one
 * implementation of job handling rather than one per process.
 */
export { app, createApp } from './app';
export { config } from './config';
export { logger } from './config/logger';
export { connectDatabase, disconnectDatabase, sequelize } from './database';
export { migrator } from './database/migrate';
export { mediaWorker } from './services/media-worker-service';
export { startServer } from './server';
