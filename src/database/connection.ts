import { Sequelize } from 'sequelize';
import type { Options, PoolOptions } from 'sequelize';

export const DEFAULT_DATABASE_URL = 'postgres://sphere:sphere@127.0.0.1:5432/sphere';

export interface DatabaseConnectionOptions {
  url?: string;
  logging?: NonNullable<Options['logging']>;
  pool?: PoolOptions;
  dialectOptions?: Record<string, unknown>;
}

export function createSequelize(
  input: string | DatabaseConnectionOptions = {},
): Sequelize {
  const connectionOptions = typeof input === 'string' ? { url: input } : input;
  const url = connectionOptions.url ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

  const options: Options = {
    dialect: 'postgres',
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

  if (connectionOptions.dialectOptions !== undefined) {
    options.dialectOptions = connectionOptions.dialectOptions;
  }

  return new Sequelize(url, options);
}
