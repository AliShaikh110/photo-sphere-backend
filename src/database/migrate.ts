import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { SequelizeStorage, Umzug } from 'umzug';
import type { QueryInterface, Sequelize } from 'sequelize';
import type { MigrationFn, Resolver } from 'umzug';

import { sequelize } from './index';

interface MigrationModule {
  up: MigrationFn<QueryInterface>;
  down?: MigrationFn<QueryInterface>;
}

export const REQUIRED_MIGRATION_NAME = '20260824020000-sprint-03-video-timeline';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function loadMigration(migrationPath: string): Promise<MigrationModule> {
  const imported: unknown = await import(pathToFileURL(migrationPath).href);
  const candidate =
    isRecord(imported) && isRecord(imported.default) ? imported.default : imported;

  if (!isRecord(candidate) || typeof candidate.up !== 'function') {
    throw new TypeError(`Migration ${migrationPath} does not export an up function`);
  }

  return {
    up: candidate.up as MigrationFn<QueryInterface>,
    ...(typeof candidate.down === 'function'
      ? { down: candidate.down as MigrationFn<QueryInterface> }
      : {}),
  };
}

const resolveMigration: Resolver<QueryInterface> = ({ name, path: migrationPath }) => {
  if (migrationPath === undefined) {
    throw new TypeError(`Migration ${name} has no file path`);
  }

  return {
    name: path.parse(name).name,
    path: migrationPath,
    up: async (params) => (await loadMigration(migrationPath)).up(params),
    down: async (params) => {
      const down = (await loadMigration(migrationPath)).down;
      if (down === undefined) {
        throw new TypeError(`Migration ${name} does not export a down function`);
      }
      return down(params);
    },
  };
};

export function createMigrator(database: Sequelize): Umzug<QueryInterface> {
  const runningFromTypeScript = __filename.endsWith('.ts');
  const migrationDirectory = runningFromTypeScript
    ? path.resolve(process.cwd(), 'migrations')
    : path.resolve(process.cwd(), 'dist', 'migrations');
  return new Umzug({
    migrations: {
      glob: [runningFromTypeScript ? '*.ts' : '*.js', { cwd: migrationDirectory }],
      resolve: resolveMigration,
    },
    context: database.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize: database }),
    logger: console,
  });
}

export const migrator = createMigrator(sequelize);

export async function runMigrationCommand(command: string | undefined): Promise<void> {
  try {
    if (command === 'up') {
      await migrator.up();
      return;
    }

    if (command === 'down') {
      await migrator.down();
      return;
    }

    throw new Error('Usage: tsx src/database/migrate.ts <up|down>');
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  runMigrationCommand(process.argv[2]).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
