import { describe, expect, it } from 'vitest';

import { CompatibilityVideoTranscoder } from '../../../apps/api/src/integrations/video/compatibility-transcoder';
import {
  buildPosterArguments,
  buildTranscodeArguments
} from '../../../apps/api/src/integrations/video/ffmpeg-transcoder';
import { generateVideoDerivatives } from '../../../apps/api/src/media/video-derivatives';
import {
  DEFAULT_VIDEO_TRANSCODING_POLICY,
  planVideoProfileTargets
} from '../../../apps/api/src/media/video-profile-policy';
import { inspectVideo } from '../../../apps/api/src/media/video-processor';
import { buildHandheldSafe360Mp4, buildOversized360Mp4 } from '../../helpers/video-fixture';

function inspect(bytes: Buffer): ReturnType<typeof inspectVideo> {
  return inspectVideo({ bytes, mimeType: 'video/mp4', require360: true });
}

describe('video playback profile policy', () => {
  it('caps the mobile profile at the documented handheld width', () => {
    const targets = planVideoProfileTargets(inspect(buildOversized360Mp4()));
    const mobile = targets.find((target) => target.profile.id === 'mobile')!;
    const desktop = targets.find((target) => target.profile.id === 'desktop')!;

    expect(mobile.profile.maxWidth).toBe(4_096);
    expect(mobile.outputWidth).toBe(4_096);
    expect(mobile.outputHeight).toBe(2_048);
    expect(mobile.requiresResize).toBe(true);
    expect(mobile.sourceAlreadyCompliant).toBe(false);
    expect(desktop.outputWidth).toBe(8_192);
    expect(desktop.sourceAlreadyCompliant).toBe(true);
  });

  it('recognises a source that already satisfies both profiles', () => {
    const targets = planVideoProfileTargets(inspect(buildHandheldSafe360Mp4()));
    expect(targets.every((target) => target.sourceAlreadyCompliant)).toBe(true);
  });

  it('keeps codec and bitrate settings in policy configuration, not in the target geometry', () => {
    const targets = planVideoProfileTargets(inspect(buildHandheldSafe360Mp4()), {
      ...DEFAULT_VIDEO_TRANSCODING_POLICY,
      videoCodec: 'libx265',
      mobileTargetBitrate: 3_000_000
    });
    const mobile = targets.find((target) => target.profile.id === 'mobile')!;
    expect(mobile.profile.videoCodec).toBe('libx265');
    expect(mobile.profile.targetVideoBitrate).toBe(3_000_000);
  });
});

describe('compatibility transcoder', () => {
  it('emits both playback profiles and a poster for a compliant source', async () => {
    const bytes = buildHandheldSafe360Mp4();
    const outcomes = await generateVideoDerivatives({
      assetId: 'asset-1',
      version: 1,
      bytes,
      inspection: inspect(bytes),
      transcoder: new CompatibilityVideoTranscoder()
    });

    expect(outcomes.map((outcome) => [outcome.stage, outcome.status])).toEqual([
      ['poster', 'succeeded'],
      ['transcodeDesktop', 'succeeded'],
      ['transcodeMobile', 'succeeded']
    ]);
    const mobile = outcomes.find((outcome) => outcome.stage === 'transcodeMobile')!;
    expect(mobile.derivative).toMatchObject({
      kind: 'mobileVideoProfile',
      version: 1,
      mimeType: 'video/mp4',
      width: 4_096
    });
    expect(mobile.derivative?.metadata).toMatchObject({
      profileId: 'mobile',
      handheldSafe: true,
      sourceAlreadyCompliant: true
    });
    expect(outcomes[0]!.derivative?.kind).toBe('videoPoster');
  });

  it('never publishes an oversized original as the handheld profile', async () => {
    const bytes = buildOversized360Mp4();
    const outcomes = await generateVideoDerivatives({
      assetId: 'asset-2',
      version: 1,
      bytes,
      inspection: inspect(bytes),
      transcoder: new CompatibilityVideoTranscoder()
    });

    const mobile = outcomes.find((outcome) => outcome.stage === 'transcodeMobile')!;
    expect(mobile.status).toBe('failed');
    expect(mobile.derivative).toBeUndefined();
    expect(mobile.failure).toMatchObject({
      category: 'DERIVATIVE_GENERATION_FAILED',
      retryable: false
    });
    expect(mobile.failure?.message).toContain('4096x2048');
    // The desktop profile is unaffected by the handheld shortfall.
    expect(outcomes.find((outcome) => outcome.stage === 'transcodeDesktop')?.status)
      .toBe('succeeded');
  });

  it('regenerates only the requested stage so other profiles keep their version', async () => {
    const bytes = buildHandheldSafe360Mp4();
    const outcomes = await generateVideoDerivatives({
      assetId: 'asset-3',
      version: 4,
      bytes,
      inspection: inspect(bytes),
      transcoder: new CompatibilityVideoTranscoder(),
      stages: ['transcodeMobile']
    });

    expect(outcomes.map((outcome) => [outcome.stage, outcome.status])).toEqual([
      ['poster', 'skipped'],
      ['transcodeDesktop', 'skipped'],
      ['transcodeMobile', 'succeeded']
    ]);
    expect(outcomes[2]!.derivative?.version).toBe(4);
  });

  it('marks a placeholder poster so it is never mistaken for an extracted frame', async () => {
    const bytes = buildHandheldSafe360Mp4();
    const outcomes = await generateVideoDerivatives({
      assetId: 'asset-4',
      version: 1,
      bytes,
      inspection: inspect(bytes),
      transcoder: new CompatibilityVideoTranscoder(),
      stages: ['poster']
    });

    expect(outcomes[0]!.derivative?.metadata).toMatchObject({
      strategy: 'placeholder',
      frameExtracted: false
    });
  });
});

describe('ffmpeg command construction', () => {
  it('encodes the profile ladder as arguments rather than project data', () => {
    const target = planVideoProfileTargets(inspect(buildOversized360Mp4()))
      .find((candidate) => candidate.profile.id === 'mobile')!;
    const args = buildTranscodeArguments({
      inputPath: '/tmp/in.mp4',
      outputPath: '/tmp/out.mp4',
      target
    });

    expect(args).toContain('-movflags');
    expect(args).toContain('+faststart');
    expect(args.join(' ')).toContain('scale=4096:2048');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });

  it('extracts a poster frame at the requested timestamp', () => {
    const args = buildPosterArguments({
      inputPath: '/tmp/in.mp4',
      outputPath: '/tmp/poster.jpg',
      timeMs: 1_500,
      width: 1_280
    });

    expect(args).toContain('-ss');
    expect(args[args.indexOf('-ss') + 1]).toBe('1.500');
    expect(args.join(' ')).toContain('scale=1280:-2');
  });
});
