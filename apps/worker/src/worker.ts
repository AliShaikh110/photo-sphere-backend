import {
  config,
  connectDatabase,
  disconnectDatabase,
  logger,
  mediaWorker,
  migrator
} from '@alishaikh110/api';

async function startWorker(): Promise<void> {
  await connectDatabase();
  if (config.autoMigrate) await migrator.up();
  mediaWorker.start({ unref: false });
  logger.info('media worker started');
}

async function stopWorker(signal: string): Promise<void> {
  logger.info({ signal }, 'media worker stopping');
  mediaWorker.stop();
  await disconnectDatabase();
}

if (require.main === module) {
  void startWorker().catch((error: unknown) => {
    logger.fatal({ err: error }, 'media worker startup failed');
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stopWorker(signal).catch((error: unknown) => {
        logger.fatal({ err: error }, 'media worker shutdown failed');
        process.exitCode = 1;
      });
    });
  }
}
