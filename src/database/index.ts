import { createSequelize } from './connection';
import { initializeModels } from '../models';

export { createSequelize, DEFAULT_DATABASE_URL } from './connection';
export type { DatabaseConnectionOptions } from './connection';
export { initializeModels } from '../models';
export type { ModelRegistry } from '../models';

export const sequelize = createSequelize();
export const models = initializeModels(sequelize);

export const db = {
  sequelize,
  ...models,
} as const;

export async function connectDatabase(): Promise<void> {
  await sequelize.authenticate();
}

export async function disconnectDatabase(): Promise<void> {
  await sequelize.close();
}

export default db;
