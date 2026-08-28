import {
  createAssetProcessingFailure,
  type AssetProcessingFailure,
} from '../domain/asset-processing';
import type { AssetDerivativeKind } from '../domain/types';
import { VideoProfileUnavailableError, type VideoTranscoder } from '../integrations/video';
import type { MediaJobStageName } from '../models/model.types';
import { sha256 } from '../utils/hash';
import type { GeneratedDerivative } from './derivative-types';
import {
  DEFAULT_VIDEO_TRANSCODING_POLICY,
  planVideoProfileTargets,
  type VideoTranscodingPolicy,
} from './video-profile-policy';
import type { VideoInspection } from './video-processor';

export type SafeStageDiagnostics = Record<string, boolean | number | string>;

export interface VideoStageOutcome {
  readonly stage: MediaJobStageName;
  readonly derivativeKind?: AssetDerivativeKind;
  readonly required: boolean;
  readonly status: 'succeeded' | 'failed' | 'skipped';
  readonly derivative?: GeneratedDerivative;
  readonly failure?: AssetProcessingFailure;
  readonly diagnostics: SafeStageDiagnostics;
}

export const VIDEO_PROCESSING_STAGES = [
  'inspect',
  'poster',
  'transcodeDesktop',
  'transcodeMobile',
  'finalize',
] as const satisfies readonly MediaJobStageName[];

export const VIDEO_STAGE_BY_DERIVATIVE_KIND: Readonly<
  Record<'videoPoster' | 'desktopVideoProfile' | 'mobileVideoProfile', MediaJobStageName>
> = Object.freeze({
  videoPoster: 'poster',
  desktopVideoProfile: 'transcodeDesktop',
  mobileVideoProfile: 'transcodeMobile',
});

export interface GenerateVideoDerivativesOptions {
  readonly assetId: string;
  readonly version: number;
  readonly bytes: Buffer;
  readonly inspection: VideoInspection;
  readonly transcoder: VideoTranscoder;
  readonly policy?: VideoTranscodingPolicy;
  readonly posterTimeMs?: number;
  /** Restricts work to the named stages so one profile can be regenerated alone. */
  readonly stages?: readonly MediaJobStageName[];
}

/**
 * Produces the poster and playback derivatives for one logical video asset.
 *
 * Each stage is independent: a profile that cannot be produced is reported as
 * a failed stage with an actionable reason rather than aborting the profiles
 * that succeeded. The original upload is never emitted as a playback profile
 * unless it provably satisfies that profile's constraints.
 */
export async function generateVideoDerivatives(
  options: GenerateVideoDerivativesOptions,
): Promise<readonly VideoStageOutcome[]> {
  const policy = options.policy ?? DEFAULT_VIDEO_TRANSCODING_POLICY;
  const requested = new Set<MediaJobStageName>(
    options.stages ?? ['poster', 'transcodeDesktop', 'transcodeMobile'],
  );
  const source = {
    assetId: options.assetId,
    bytes: options.bytes,
    inspection: options.inspection,
  };
  const outcomes: VideoStageOutcome[] = [];

  if (policy.posterEnabled) {
    outcomes.push(await runStage({
      stage: 'poster',
      derivativeKind: 'videoPoster',
      // A missing poster degrades presentation; it must not block playback.
      required: false,
      skipped: !requested.has('poster'),
      run: async () => {
        const poster = await options.transcoder.generatePoster(source, {
          timeMs: Math.min(options.posterTimeMs ?? 1_000, Math.max(0, options.inspection.durationMs - 1)),
        });
        return {
          derivative: describeDerivative({
            assetId: options.assetId,
            version: options.version,
            kind: 'videoPoster',
            body: poster.body,
            mimeType: poster.mimeType,
            width: poster.width,
            height: poster.height,
            extension: '.jpg',
            metadata: {
              role: 'video-poster',
              posterTimeMs: options.posterTimeMs ?? 1_000,
              ...poster.diagnostics,
            },
          }),
          diagnostics: poster.diagnostics,
        };
      },
    }));
  }

  for (const target of planVideoProfileTargets(options.inspection, policy)) {
    const stage = VIDEO_STAGE_BY_DERIVATIVE_KIND[target.profile.derivativeKind];
    outcomes.push(await runStage({
      stage,
      derivativeKind: target.profile.derivativeKind,
      // Neither profile alone is mandatory; finalize enforces that at least
      // one publishable playback profile exists.
      required: false,
      skipped: !requested.has(stage),
      run: async () => {
        const transcoded = await options.transcoder.transcode(source, target);
        return {
          derivative: describeDerivative({
            assetId: options.assetId,
            version: options.version,
            kind: target.profile.derivativeKind,
            body: transcoded.body,
            mimeType: transcoded.mimeType,
            width: transcoded.width,
            height: transcoded.height,
            extension: transcoded.mimeType === 'video/webm' ? '.webm' : '.mp4',
            metadata: {
              role: 'video-playback-profile',
              profileId: target.profile.id,
              policyVersion: policy.version,
              maxWidth: target.profile.maxWidth,
              maxFrameRate: target.profile.maxFrameRate,
              handheldSafe: target.profile.handheldSafe
                && transcoded.width <= target.profile.maxWidth,
              sourceAlreadyCompliant: target.sourceAlreadyCompliant,
              ...transcoded.diagnostics,
            },
          }),
          diagnostics: {
            profileId: target.profile.id,
            outputWidth: transcoded.width,
            outputHeight: transcoded.height,
            ...transcoded.diagnostics,
          },
        };
      },
    }));
  }

  return Object.freeze(outcomes);
}

async function runStage(options: {
  stage: MediaJobStageName;
  derivativeKind: AssetDerivativeKind;
  required: boolean;
  skipped: boolean;
  run: () => Promise<{ derivative: GeneratedDerivative; diagnostics: SafeStageDiagnostics }>;
}): Promise<VideoStageOutcome> {
  if (options.skipped) {
    return {
      stage: options.stage,
      derivativeKind: options.derivativeKind,
      required: options.required,
      status: 'skipped',
      diagnostics: { reason: 'not-requested-by-job' },
    };
  }
  try {
    const result = await options.run();
    return {
      stage: options.stage,
      derivativeKind: options.derivativeKind,
      required: options.required,
      status: 'succeeded',
      derivative: result.derivative,
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    return {
      stage: options.stage,
      derivativeKind: options.derivativeKind,
      required: options.required,
      status: 'failed',
      failure: stageFailure(options.stage, error),
      diagnostics: {
        reason: error instanceof VideoProfileUnavailableError ? error.reason : 'unexpected-error',
      },
    };
  }
}

function stageFailure(stage: MediaJobStageName, error: unknown): AssetProcessingFailure {
  if (error instanceof VideoProfileUnavailableError) {
    return createAssetProcessingFailure(
      'DERIVATIVE_GENERATION_FAILED',
      'processing',
      error.message,
      {
        retryable: error.retryable,
        diagnostics: { stage, profileId: error.profileId },
        occurredAt: new Date().toISOString(),
      },
    );
  }
  return createAssetProcessingFailure(
    'DERIVATIVE_GENERATION_FAILED',
    'processing',
    `The ${stage} stage failed.`,
    {
      retryable: true,
      diagnostics: { stage },
      occurredAt: new Date().toISOString(),
    },
  );
}

function describeDerivative(options: {
  assetId: string;
  version: number;
  kind: AssetDerivativeKind;
  body: Buffer;
  mimeType: string;
  width: number;
  height: number;
  extension: string;
  metadata: Record<string, unknown>;
}): GeneratedDerivative {
  const checksum = sha256(options.body);
  return {
    kind: options.kind,
    version: options.version,
    storageKey: `derivatives/${options.assetId}/v${options.version}/${options.kind}-${checksum.slice(0, 16)}${options.extension}`,
    mimeType: options.mimeType,
    width: options.width,
    height: options.height,
    sizeBytes: options.body.byteLength,
    checksum,
    body: options.body,
    metadata: options.metadata,
  };
}
