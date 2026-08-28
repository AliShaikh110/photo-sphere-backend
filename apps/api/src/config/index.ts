import './env';
import path from 'node:path';
import { z } from 'zod';
import type { PanoramaTilingPolicy } from '../media/panorama-quality-policy';
import type { VideoTranscodingPolicy } from '../media/video-profile-policy';
import type { TourStrategyPolicyConfig } from '@alishaikh110/experience-schema';

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
    DB_HOST: z.string().min(1).default('127.0.0.1'),
    DB_PORT: z.coerce.number().int().positive().max(65_535).default(5432),
    DB_NAME: z.string().min(1).default('sphere'),
    DB_USER: z.string().min(1).default('sphere'),
    DB_PASSWORD: z.string().default('sphere'),
    DB_SSL: booleanFromString,
    // Optional single-string override for managed hosts and CI; the discrete
    // DB_* settings are the normal path.
    DATABASE_URL: z.string().min(1).optional(),
    JWT_SECRET: z.string().min(32).default('development-only-secret-change-me-now'),
    JWT_EXPIRES_IN: z.string().min(1).default('1h'),
    PUBLIC_BASE_URL: z.url().default('http://localhost:4000'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    // Browser-direct access policy. Each group defaults to CORS_ORIGINS, so a
    // deployment that does not split its front ends behaves exactly as before.
    EDITOR_ORIGINS: z.string().optional(),
    PLAYER_ORIGINS: z.string().optional(),
    EMBED_ORIGINS: z.string().default(''),
    EDITOR_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    EVENT_STREAM_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    EVENT_STREAM_HEARTBEAT_MS: z.coerce.number().int().positive().default(20_000),
    EVENT_STREAM_MAX_PER_PROJECT: z.coerce.number().int().positive().default(20),
    EVENT_STREAM_MAX_PER_USER: z.coerce.number().int().positive().default(8),
    EVENT_STREAM_REPLAY_BUFFER: z.coerce.number().int().positive().max(1_000).default(200),
    MEDIA_TOKEN_REFRESH_MAX: z.coerce.number().int().positive().max(500).default(200),
    STORAGE_ROOT: z.string().default('./storage'),
    MAX_IMAGE_UPLOAD_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
    MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(80_000_000),
    MAX_VIDEO_UPLOAD_BYTES: z.coerce.number().int().positive().default(1_024 * 1024 * 1024),
    MAX_VIDEO_DURATION_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
    MAX_VIDEO_DERIVATIVE_BYTES: z.coerce.number().int().positive().default(1_024 * 1024 * 1024),
    VIDEO_TRANSCODER: z.enum(['auto', 'ffmpeg', 'compatibility']).default('auto'),
    FFMPEG_PATH: z.string().min(1).optional(),
    VIDEO_TRANSCODE_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
    VIDEO_POSTER_PLACEHOLDER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    VIDEO_POSTER_TIME_MS: z.coerce.number().int().nonnegative().default(1_000),
    VIDEO_DESKTOP_MAX_WIDTH: z.coerce.number().int().positive().default(8_192),
    VIDEO_DESKTOP_MAX_FRAME_RATE: z.coerce.number().int().positive().default(60),
    VIDEO_DESKTOP_TARGET_BITRATE: z.coerce.number().int().positive().default(16_000_000),
    VIDEO_MOBILE_MAX_WIDTH: z.coerce.number().int().positive().default(4_096),
    VIDEO_MOBILE_MAX_FRAME_RATE: z.coerce.number().int().positive().default(30),
    VIDEO_MOBILE_TARGET_BITRATE: z.coerce.number().int().positive().default(6_000_000),
    VIDEO_AUDIO_BITRATE: z.coerce.number().int().positive().default(128_000),
    VIDEO_CODEC: z.string().min(1).default('h264'),
    VIDEO_AUDIO_CODEC: z.string().min(1).default('aac'),
    PANORAMA_TILING_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    PANORAMA_TILING_MIN_WIDTH: z.coerce.number().int().positive().default(6_144),
    PANORAMA_TILING_MIN_SOURCE_BYTES: z.coerce.number().int().positive().default(12 * 1024 * 1024),
    PANORAMA_TILING_MIN_LEVEL_WIDTH: z.coerce.number().int().positive().default(4_096),
    PANORAMA_TILE_SIZE: z.coerce.number().int().min(128).max(2_048).default(512),
    PANORAMA_TILE_QUALITY: z.coerce.number().int().min(1).max(100).default(82),
    PANORAMA_TILE_MAX_LEVELS: z.coerce.number().int().min(1).max(8).default(4),
    TOUR_INLINE_MAX_SCENES: z.coerce.number().int().nonnegative().default(32),
    TOUR_INLINE_MAX_MANIFEST_BYTES: z.coerce.number().int().nonnegative().default(1_048_576),
    TOUR_INLINE_MAX_CONNECTIONS: z.coerce.number().int().nonnegative().default(128),
    TOUR_INLINE_MAX_AVERAGE_CONNECTIONS: z.coerce.number().nonnegative().default(5),
    UPLOAD_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    SIGNED_MEDIA_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    // Long enough to cover one viewing session, since a visitor reports
    // experience_exited against the token they were served at load.
    TELEMETRY_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(6 * 60 * 60),
    MEDIA_WORKER_MODE: z.enum(['embedded', 'external', 'disabled']).default('embedded'),
    MEDIA_WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
    MEDIA_JOB_LEASE_SECONDS: z.coerce.number().int().positive().default(900),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: booleanFromString,
    AUTO_MIGRATE: booleanFromString,
    // Must name a viewer integration this build can emit; see the compiler's
    // viewer integration registry.
    VIEWER_INTEGRATION_VERSION: z.string().default('psv-5.14.3-adapter-2'),
    /** Deterministic share of projects compiled with the rollout candidate. */
    VIEWER_INTEGRATION_ROLLOUT_PERCENT: z.coerce.number().int().min(0).max(100).default(0),
    VIEWER_INTEGRATION_CANDIDATE_VERSION: z.string().min(1).optional(),
    DUAL_FISHEYE_INGEST_ENABLED: booleanFromString,
    LIVE_SOURCE_ENABLED: booleanFromString,
    LIVE_SOURCE_ALLOWED_HOSTS: z.string().default(''),
    ANALYTICS_MAX_RANGE_DAYS: z.coerce.number().int().positive().max(400).default(92),
    PUBLISH_MAX_SCENES: z.coerce.number().int().positive().default(500),
    PUBLISH_MAX_MANIFEST_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
    PUBLISH_MAX_SCENE_DEFINITION_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024)
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
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    ssl: boolean;
    url: string | undefined;
  };
  jwtSecret: string;
  jwtExpiresIn: string;
  publicBaseUrl: string;
  corsOrigins: string[];
  editorOrigins: string[];
  playerOrigins: string[];
  embedOrigins: string[];
  editorSessionTtlSeconds: number;
  eventStream: {
    enabled: boolean;
    heartbeatMs: number;
    maxConnectionsPerProject: number;
    maxConnectionsPerUser: number;
    replayBufferSize: number;
  };
  mediaTokenRefreshMax: number;
  storageRoot: string;
  maxImageUploadBytes: number;
  maxImagePixels: number;
  maxVideoUploadBytes: number;
  maxVideoDurationMs: number;
  maxVideoDerivativeBytes: number;
  maxUploadBytes: number;
  videoTranscoderMode: 'auto' | 'ffmpeg' | 'compatibility';
  ffmpegPath: string | undefined;
  videoTranscodeTimeoutMs: number;
  videoPosterPlaceholderEnabled: boolean;
  videoPosterTimeMs: number;
  videoTranscodingPolicy: VideoTranscodingPolicy;
  panoramaTilingPolicy: PanoramaTilingPolicy;
  tourStrategyPolicy: TourStrategyPolicyConfig;
  uploadSessionTtlSeconds: number;
  signedMediaTtlSeconds: number;
  telemetryTokenTtlSeconds: number;
  mediaWorkerMode: 'embedded' | 'external' | 'disabled';
  mediaWorkerPollMs: number;
  mediaJobLeaseSeconds: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  trustProxy: boolean;
  autoMigrate: boolean;
  viewerIntegrationVersion: string;
  viewerIntegrationCandidateVersion: string | undefined;
  viewerIntegrationRolloutPercent: number;
  dualFisheyeIngestEnabled: boolean;
  liveSourceEnabled: boolean;
  liveSourceAllowedHosts: string[];
  analyticsMaxRangeDays: number;
  publishLimits: {
    maxScenes: number;
    maxManifestBytes: number;
    maxSceneDefinitionBytes: number;
  };
};

function originList(value: string): string[] {
  return value.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const value = envSchema.parse(environment);
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    database: {
      host: value.DB_HOST,
      port: value.DB_PORT,
      name: value.DB_NAME,
      user: value.DB_USER,
      password: value.DB_PASSWORD,
      ssl: value.DB_SSL,
      url: value.DATABASE_URL
    },
    jwtSecret: value.JWT_SECRET,
    jwtExpiresIn: value.JWT_EXPIRES_IN,
    publicBaseUrl: value.PUBLIC_BASE_URL.replace(/\/$/, ''),
    corsOrigins: originList(value.CORS_ORIGINS),
    editorOrigins: originList(value.EDITOR_ORIGINS ?? value.CORS_ORIGINS),
    playerOrigins: originList(value.PLAYER_ORIGINS ?? value.CORS_ORIGINS),
    embedOrigins: originList(value.EMBED_ORIGINS),
    editorSessionTtlSeconds: value.EDITOR_SESSION_TTL_SECONDS,
    eventStream: {
      enabled: value.EVENT_STREAM_ENABLED,
      heartbeatMs: value.EVENT_STREAM_HEARTBEAT_MS,
      maxConnectionsPerProject: value.EVENT_STREAM_MAX_PER_PROJECT,
      maxConnectionsPerUser: value.EVENT_STREAM_MAX_PER_USER,
      replayBufferSize: value.EVENT_STREAM_REPLAY_BUFFER
    },
    mediaTokenRefreshMax: value.MEDIA_TOKEN_REFRESH_MAX,
    storageRoot: path.resolve(value.STORAGE_ROOT),
    maxImageUploadBytes: value.MAX_IMAGE_UPLOAD_BYTES,
    maxImagePixels: value.MAX_IMAGE_PIXELS,
    maxVideoUploadBytes: value.MAX_VIDEO_UPLOAD_BYTES,
    maxVideoDurationMs: value.MAX_VIDEO_DURATION_MS,
    maxVideoDerivativeBytes: value.MAX_VIDEO_DERIVATIVE_BYTES,
    maxUploadBytes: Math.max(value.MAX_IMAGE_UPLOAD_BYTES, value.MAX_VIDEO_UPLOAD_BYTES),
    videoTranscoderMode: value.VIDEO_TRANSCODER,
    ffmpegPath: value.FFMPEG_PATH,
    videoTranscodeTimeoutMs: value.VIDEO_TRANSCODE_TIMEOUT_MS,
    videoPosterPlaceholderEnabled: value.VIDEO_POSTER_PLACEHOLDER_ENABLED,
    videoPosterTimeMs: value.VIDEO_POSTER_TIME_MS,
    videoTranscodingPolicy: {
      version: 1,
      desktopMaxWidth: value.VIDEO_DESKTOP_MAX_WIDTH,
      desktopMaxFrameRate: value.VIDEO_DESKTOP_MAX_FRAME_RATE,
      desktopTargetBitrate: value.VIDEO_DESKTOP_TARGET_BITRATE,
      mobileMaxWidth: value.VIDEO_MOBILE_MAX_WIDTH,
      mobileMaxFrameRate: value.VIDEO_MOBILE_MAX_FRAME_RATE,
      mobileTargetBitrate: value.VIDEO_MOBILE_TARGET_BITRATE,
      audioBitrate: value.VIDEO_AUDIO_BITRATE,
      videoCodec: value.VIDEO_CODEC,
      audioCodec: value.VIDEO_AUDIO_CODEC,
      posterEnabled: true
    },
    panoramaTilingPolicy: {
      enabled: value.PANORAMA_TILING_ENABLED,
      minimumSourceWidth: value.PANORAMA_TILING_MIN_WIDTH,
      minimumSourceBytes: value.PANORAMA_TILING_MIN_SOURCE_BYTES,
      minimumLevelWidth: value.PANORAMA_TILING_MIN_LEVEL_WIDTH,
      tileSize: value.PANORAMA_TILE_SIZE,
      tileQuality: value.PANORAMA_TILE_QUALITY,
      maximumLevels: value.PANORAMA_TILE_MAX_LEVELS
    },
    tourStrategyPolicy: {
      version: 1,
      maxInlineSceneCount: value.TOUR_INLINE_MAX_SCENES,
      maxInlineManifestBytes: value.TOUR_INLINE_MAX_MANIFEST_BYTES,
      maxInlineConnectionCount: value.TOUR_INLINE_MAX_CONNECTIONS,
      maxInlineAverageConnectionsPerScene: value.TOUR_INLINE_MAX_AVERAGE_CONNECTIONS
    },
    uploadSessionTtlSeconds: value.UPLOAD_SESSION_TTL_SECONDS,
    signedMediaTtlSeconds: value.SIGNED_MEDIA_TTL_SECONDS,
    telemetryTokenTtlSeconds: value.TELEMETRY_TOKEN_TTL_SECONDS,
    mediaWorkerMode: value.MEDIA_WORKER_MODE,
    mediaWorkerPollMs: value.MEDIA_WORKER_POLL_MS,
    mediaJobLeaseSeconds: value.MEDIA_JOB_LEASE_SECONDS,
    logLevel: value.LOG_LEVEL,
    trustProxy: value.TRUST_PROXY,
    autoMigrate: value.AUTO_MIGRATE,
    viewerIntegrationVersion: value.VIEWER_INTEGRATION_VERSION,
    viewerIntegrationCandidateVersion: value.VIEWER_INTEGRATION_CANDIDATE_VERSION,
    viewerIntegrationRolloutPercent: value.VIEWER_INTEGRATION_ROLLOUT_PERCENT,
    dualFisheyeIngestEnabled: value.DUAL_FISHEYE_INGEST_ENABLED,
    liveSourceEnabled: value.LIVE_SOURCE_ENABLED,
    liveSourceAllowedHosts: value.LIVE_SOURCE_ALLOWED_HOSTS
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    analyticsMaxRangeDays: value.ANALYTICS_MAX_RANGE_DAYS,
    publishLimits: {
      maxScenes: value.PUBLISH_MAX_SCENES,
      maxManifestBytes: value.PUBLISH_MAX_MANIFEST_BYTES,
      maxSceneDefinitionBytes: value.PUBLISH_MAX_SCENE_DEFINITION_BYTES
    }
  };
}

export const config = loadConfig();
