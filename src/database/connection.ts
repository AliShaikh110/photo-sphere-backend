import '../config/env';
import { Sequelize } from 'sequelize';
import type { Options, PoolOptions } from 'sequelize';

export const DEFAULT_DATABASE_HOST = '127.0.0.1';
export const DEFAULT_DATABASE_PORT = 5432;
export const DEFAULT_DATABASE_NAME = 'sphere';
export const DEFAULT_DATABASE_USER = 'sphere';
export const DEFAULT_DATABASE_PASSWORD = 'sphere';

export interface DatabaseConnectionOptions {
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  /** Escape hatch for a full connection string; discrete settings win when absent. */
  url?: string;
  logging?: NonNullable<Options['logging']>;
  pool?: PoolOptions;
  dialectOptions?: Record<string, unknown>;
}

function readPort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : undefined;
}

export function createSequelize(
  input: string | DatabaseConnectionOptions = {},
): Sequelize {
  const connectionOptions = typeof input === 'string' ? { url: input } : input;

  const ssl = connectionOptions.ssl ?? process.env.DB_SSL === 'true';

  const options: Options = {
    dialect: 'postgres',
    host: connectionOptions.host ?? process.env.DB_HOST ?? DEFAULT_DATABASE_HOST,
    port:
      connectionOptions.port
      ?? readPort(process.env.DB_PORT)
      ?? DEFAULT_DATABASE_PORT,
    database: connectionOptions.database ?? process.env.DB_NAME ?? DEFAULT_DATABASE_NAME,
    username: connectionOptions.username ?? process.env.DB_USER ?? DEFAULT_DATABASE_USER,
    password: connectionOptions.password ?? process.env.DB_PASSWORD ?? DEFAULT_DATABASE_PASSWORD,
    logging: connectionOptions.logging ?? false,
    define: {
      freezeTableName: true,
      underscored: true,
    },
    pool: connectionOptions.pool ?? {
      max: 10,
      min: 0,
      acquire: 30_000,
      idle: 10_000,
    },
  };

  const dialectOptions = {
    ...(ssl ? { ssl: { require: true, rejectUnauthorized: false } } : {}),
    ...connectionOptions.dialectOptions,
  };

  if (Object.keys(dialectOptions).length > 0) {
    options.dialectOptions = dialectOptions;
  }

  // A connection string still wins when one is handed in explicitly or set in the
  // environment, so managed hosts and CI can keep injecting a single URL.
  const url = connectionOptions.url ?? process.env.DATABASE_URL;
  if (url !== undefined && url.trim() !== '') {
    return new Sequelize(url, options);
  }

  return new Sequelize(options);
}
