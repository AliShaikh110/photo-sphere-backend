import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, Socket } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import { newDb } from 'pg-mem';
import type { Express } from 'express';
import { Sequelize } from 'sequelize';
import { vi } from 'vitest';

const execFileAsync = promisify(execFile);

export type IntegrationTestContext = {
  app: Express;
  database: { sequelize: Sequelize };
  databaseKind: 'postgres' | 'pg-mem';
  stop: () => Promise<void>;
};

function postgresBinary(name: 'initdb' | 'postgres'): string | undefined {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const configured = process.env.POSTGRES_BIN;
  if (configured) {
    const candidate = path.join(configured, executable);
    if (existsSync(candidate)) return candidate;
  }
  if (process.platform === 'win32') {
    const postgresRoot = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PostgreSQL');
    if (existsSync(postgresRoot)) {
      const versions = readdirSync(postgresRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
      for (const version of versions) {
        const candidate = path.join(postgresRoot, version, 'bin', executable);
        if (existsSync(candidate)) return candidate;
      }
    }
    return undefined;
  }
  return executable;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to allocate a PostgreSQL test port.');
  }
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const client = new Socket();
      client.setTimeout(250);
      client.once('connect', () => {
        client.destroy();
        resolve(true);
      });
      const failed = (): void => {
        client.destroy();
        resolve(false);
      };
      client.once('error', failed);
      client.once('timeout', failed);
      client.connect(port, '127.0.0.1');
    });
    if (connected) return;
    await delay(100);
  }
  throw new Error(`PostgreSQL did not listen on port ${port} within ${timeoutMs}ms.`);
}

async function removeSafeTemporaryRoot(root: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const workspaceDirectory = `${path.resolve(process.cwd())}${path.sep}`;
  if (!resolvedRoot.startsWith(workspaceDirectory) || !path.basename(resolvedRoot).startsWith('.sphere-pg-')) {
    throw new Error(`Refusing to remove unsafe PostgreSQL test path: ${resolvedRoot}`);
  }
  await rm(resolvedRoot, { recursive: true, force: true });
}

async function startRealPostgres(): Promise<IntegrationTestContext | undefined> {
  const initdb = postgresBinary('initdb');
  const postgres = postgresBinary('postgres');
  if (!initdb || !postgres) return undefined;

  // On Windows, initdb cannot re-exec its restricted token across the sandboxed
  // user-profile temp path. A random, hidden workspace child remains disposable
  // and lets the real server exercise PostgreSQL locks and migration DDL.
  const clusterRoot = await mkdtemp(path.join(process.cwd(), '.sphere-pg-'));
  const dataDirectory = path.join(clusterRoot, 'data');
  const logPath = path.join(clusterRoot, 'postgres.log');
  const port = await availablePort();
  let started = false;
  let serverProcess: ReturnType<typeof spawn> | undefined;
  let serverDiagnostics = '';

  try {
    await execFileAsync(initdb, [
      '-D', dataDirectory,
      '--username=sphere_test',
      '--auth=trust',
      '--encoding=UTF8',
      '--no-sync'
    ], { windowsHide: true, timeout: 30_000 });
    serverProcess = spawn(postgres, ['-D', dataDirectory, '-h', '127.0.0.1', '-p', String(port), '-F'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const rememberDiagnostic = (chunk: Buffer): void => {
      serverDiagnostics = `${serverDiagnostics}${chunk.toString('utf8')}`.slice(-20_000);
    };
    serverProcess.stdout?.on('data', rememberDiagnostic);
    serverProcess.stderr?.on('data', rememberDiagnostic);
    await waitForPort(port);
    if (serverProcess.exitCode !== null) {
      throw new Error(`PostgreSQL exited during startup with code ${serverProcess.exitCode}.`);
    }
    started = true;
    process.env.DATABASE_URL = `postgres://sphere_test@127.0.0.1:${port}/postgres`;

    const database = await import('../../apps/api/src/database');
    await database.sequelize.authenticate();
    // Run the full migration chain: a disposable cluster must reach the same
    // schema the deployed database does, not just the initial sprint.
    const { createMigrator } = await import('../../apps/api/src/database/migrate');
    await createMigrator(database.sequelize).up();
    const { app } = await import('../../apps/api/src/app');

    return {
      app,
      database,
      databaseKind: 'postgres',
      stop: async () => {
        await database.sequelize.close();
        serverProcess?.kill('SIGTERM');
        for (let attempt = 0; attempt < 50 && serverProcess?.exitCode === null; attempt += 1) {
          await delay(100);
        }
        if (serverProcess?.exitCode === null) serverProcess.kill('SIGKILL');
        started = false;
        await removeSafeTemporaryRoot(clusterRoot);
      }
    };
  } catch (error) {
    const applicationSetupFailed = started;
    if (started || serverProcess?.exitCode === null) {
      serverProcess?.kill('SIGKILL');
      await delay(100);
    }
    const fileDiagnostics = existsSync(logPath) ? await readFile(logPath, 'utf8').catch(() => '') : '';
    const diagnostics = `${serverDiagnostics}\n${fileDiagnostics}`;
    await removeSafeTemporaryRoot(clusterRoot);
    if (applicationSetupFailed) {
      throw new Error(`Disposable PostgreSQL application setup failed. ${diagnostics}`, { cause: error });
    }
    if (process.env.SPHERE_REQUIRE_REAL_POSTGRES === 'true') {
      throw new Error(`Disposable PostgreSQL failed to start. ${diagnostics}`, { cause: error });
    }
    return undefined;
  }
}

async function startPgMem(): Promise<IntegrationTestContext> {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const dialectModule = memory.adapters.createPg();

  vi.doMock('../../apps/api/src/database', async () => {
    const { initializeModels } = await import('../../apps/api/src/models');
    const sequelize = new Sequelize('postgres://sphere_test@localhost/postgres', {
      dialect: 'postgres',
      dialectModule,
      logging: false,
      define: { freezeTableName: true, underscored: true }
    });
    const models = initializeModels(sequelize);
    return {
      sequelize,
      models,
      db: { sequelize, ...models },
      initializeModels,
      createSequelize: () => sequelize,
      connectDatabase: async () => sequelize.authenticate(),
      disconnectDatabase: async () => sequelize.close()
    };
  });

  const database = await import('../../apps/api/src/database');
  await database.sequelize.sync({ force: true });
  const { app } = await import('../../apps/api/src/app');
  return {
    app,
    database,
    databaseKind: 'pg-mem',
    stop: async () => database.sequelize.close()
  };
}

async function startConfiguredPostgres(): Promise<IntegrationTestContext> {
  const database = await import('../../apps/api/src/database');
  await database.sequelize.authenticate();
  const { createMigrator } = await import('../../apps/api/src/database/migrate');
  await createMigrator(database.sequelize).up();
  const { app } = await import('../../apps/api/src/app');
  return {
    app,
    database,
    databaseKind: 'postgres',
    stop: async () => database.sequelize.close()
  };
}

export async function startIntegrationTestContext(): Promise<IntegrationTestContext> {
  if (process.env.SPHERE_USE_PG_MEM === 'true') return startPgMem();
  if (process.env.SPHERE_USE_CONFIGURED_POSTGRES === 'true') return startConfiguredPostgres();
  return (await startRealPostgres()) ?? startPgMem();
}

export async function truncateApplicationData(context: IntegrationTestContext): Promise<void> {
  const tableNames = [
    'runtime_events',
    'idempotency_records',
    'published_scene_definitions',
    'publications',
    'timeline_interactions',
    'scene_connections',
    'hotspots',
    'scenes',
    'storage_deletion_jobs',
    'media_job_stages',
    'media_jobs',
    'upload_sessions',
    'asset_derivatives',
    'assets',
    'projects',
    'users'
  ];
  if (context.databaseKind === 'postgres') {
    await context.database.sequelize.query(
      `TRUNCATE TABLE ${tableNames.map((name) => `"${name}"`).join(', ')} RESTART IDENTITY CASCADE`
    );
    return;
  }
  await context.database.sequelize.truncate({ cascade: true });
}
