import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const knownUnsafeProductionJwtSecrets = new Set([
  'development-only-secret-change-me-now',
  'replace-with-at-least-32-random-characters'
]);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65_535).default(4000),
    DATABASE_URL: z
      .string()
      .min(1)
      .default('postgres://sphere:sphere@127.0.0.1:5432/sphere'),
    JWT_SECRET: z.string().min(32).default('development-only-secret-change-me-now'),
    JWT_EXPIRES_IN: z.string().min(1).default('1h'),
    PUBLIC_BASE_URL: z.url().default('http://localhost:4000'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    STORAGE_ROOT: z.string().default('./storage'),
    MAX_IMAGE_UPLOAD_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
    MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(80_000_000),
    UPLOAD_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    SIGNED_MEDIA_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    MEDIA_WORKER_MODE: z.enum(['embedded', 'external', 'disabled']).default('embedded'),
    MEDIA_WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
    MEDIA_JOB_LEASE_SECONDS: z.coerce.number().int().positive().default(900),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: booleanFromString,
    AUTO_MIGRATE: booleanFromString,
    VIEWER_INTEGRATION_VERSION: z.string().default('psv-5.14.3-adapter-1')
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === 'production'
      && (
        knownUnsafeProductionJwtSecrets.has(value.JWT_SECRET.toLowerCase())
        || value.JWT_SECRET.toLowerCase().includes('development-only')
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'JWT_SECRET must be explicitly configured in production'
      });
    }
  });

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  publicBaseUrl: string;
  corsOrigins: string[];
  storageRoot: string;
  maxImageUploadBytes: number;
  maxImagePixels: number;
  uploadSessionTtlSeconds: number;
  signedMediaTtlSeconds: number;
  mediaWorkerMode: 'embedded' | 'external' | 'disabled';
  mediaWorkerPollMs: number;
  mediaJobLeaseSeconds: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  trustProxy: boolean;
  autoMigrate: boolean;
  viewerIntegrationVersion: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const value = envSchema.parse(environment);
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    jwtSecret: value.JWT_SECRET,
    jwtExpiresIn: value.JWT_EXPIRES_IN,
    publicBaseUrl: value.PUBLIC_BASE_URL.replace(/\/$/, ''),
    corsOrigins: value.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    storageRoot: path.resolve(value.STORAGE_ROOT),
    maxImageUploadBytes: value.MAX_IMAGE_UPLOAD_BYTES,
    maxImagePixels: value.MAX_IMAGE_PIXELS,
    uploadSessionTtlSeconds: value.UPLOAD_SESSION_TTL_SECONDS,
    signedMediaTtlSeconds: value.SIGNED_MEDIA_TTL_SECONDS,
    mediaWorkerMode: value.MEDIA_WORKER_MODE,
    mediaWorkerPollMs: value.MEDIA_WORKER_POLL_MS,
    mediaJobLeaseSeconds: value.MEDIA_JOB_LEASE_SECONDS,
    logLevel: value.LOG_LEVEL,
    trustProxy: value.TRUST_PROXY,
    autoMigrate: value.AUTO_MIGRATE,
    viewerIntegrationVersion: value.VIEWER_INTEGRATION_VERSION
  };
}

export const config = loadConfig();
