import { describe, expect, it } from 'vitest';

import { AppError } from '../../../src/errors/app-error';
import { detectVideoContainer } from '../../../src/media/video-container';
import { validateVideoUpload } from '../../../src/media/file-policy';
import { inspectVideo, videoInspectionMetadata } from '../../../src/media/video-processor';
import { buildMp4Fixture } from '../../helpers/video-fixture';

describe('video inspection', () => {
  it('extracts container, codec, geometry, duration, frame rate and audio facts', () => {
    const bytes = buildMp4Fixture({
      width: 4_096,
      height: 2_048,
      durationMs: 5_000,
      frameRate: 25,
      audio: true,
      payloadBytes: 250_000
    });

    const inspection = inspectVideo({ bytes, mimeType: 'video/mp4', require360: true });

    expect(inspection).toMatchObject({
      container: 'mp4',
      mimeType: 'video/mp4',
      width: 4_096,
      height: 2_048,
      aspectRatio: 2,
      durationMs: 5_000,
      frameRate: 25,
      videoCodec: 'avc1',
      audioPresent: true,
      audioCodec: 'mp4a',
      rotationDegrees: 0,
      stereoMode: 'mono',
      projection: 'equirectangular',
      is360: true,
      projectionSource: 'container-metadata'
    });
    expect(inspection.bitrateBitsPerSecond).toBeGreaterThan(0);
    expect(inspection.compatibility).toMatchObject({
      handheldSafeWidth: true,
      webVideoCodec: true,
      webAudioCodec: true,
      upright: true
    });
  });

  it('flags a source above the handheld width ceiling as unsafe for handheld delivery', () => {
    const inspection = inspectVideo({
      bytes: buildMp4Fixture({ width: 8_192, height: 4_096 }),
      mimeType: 'video/mp4',
      require360: true
    });

    expect(inspection.width).toBe(8_192);
    expect(inspection.compatibility.handheldSafeWidth).toBe(false);
  });

  it('reports a silent video and normalises rotated track geometry', () => {
    const inspection = inspectVideo({
      bytes: buildMp4Fixture({
        width: 2_048,
        height: 1_024,
        audio: false,
        rotationDegrees: 90,
        spherical: true
      }),
      mimeType: 'video/mp4',
      require360: true
    });

    expect(inspection.audioPresent).toBe(false);
    expect(inspection.rotationDegrees).toBe(90);
    // Rotation is applied so downstream policy reasons about displayed pixels.
    expect(inspection.width).toBe(1_024);
    expect(inspection.height).toBe(2_048);
    expect(inspection.compatibility.upright).toBe(false);
  });

  it('detects 360 content from the 2:1 shape when projection metadata is absent', () => {
    const inspection = inspectVideo({
      bytes: buildMp4Fixture({ width: 2_048, height: 1_024, spherical: false }),
      mimeType: 'video/mp4',
      require360: true
    });

    expect(inspection.projectionSource).toBe('aspect-ratio');
    expect(inspection.is360).toBe(true);
  });

  it('rejects a non-360 upload for a 360 video asset', () => {
    expect(() => inspectVideo({
      bytes: buildMp4Fixture({ width: 1_920, height: 1_080, spherical: false }),
      mimeType: 'video/mp4',
      require360: true
    })).toThrowError(expect.objectContaining({ code: 'VIDEO_360_NOT_DETECTED' }));
  });

  it('rejects an over-long video before any processing work is scheduled', () => {
    expect(() => inspectVideo({
      bytes: buildMp4Fixture({ durationMs: 60_000 }),
      mimeType: 'video/mp4',
      require360: true,
      maxDurationMs: 30_000
    })).toThrowError(expect.objectContaining({ code: 'VIDEO_TOO_LONG' }));
  });

  it('rejects bytes that are not a supported container', () => {
    expect(detectVideoContainer(Buffer.from('not a video at all'))).toBeUndefined();
    expect(() => inspectVideo({
      bytes: Buffer.from('not a video at all'),
      mimeType: 'video/mp4',
      require360: false
    })).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_VIDEO_TYPE' }));
  });

  it('exposes internal diagnostics through the persisted asset metadata shape', () => {
    const inspection = inspectVideo({
      bytes: buildMp4Fixture(),
      mimeType: 'video/mp4',
      require360: true
    });

    expect(videoInspectionMetadata(inspection)).toMatchObject({
      container: 'mp4',
      durationMs: 4_000,
      audioPresent: true,
      is360: true,
      compatibility: { handheldSafeWidth: true }
    });
  });
});

describe('video upload policy', () => {
  it('accepts a signature-matched MP4 upload', () => {
    const bytes = buildMp4Fixture();
    expect(validateVideoUpload({
      bytes,
      filename: 'tour.mp4',
      claimedMimeType: 'video/mp4',
      maxBytes: bytes.byteLength + 1
    })).toMatchObject({ mimeType: 'video/mp4', extension: '.mp4' });
  });

  it('rejects a video renamed to claim an unrelated media type', () => {
    expect(() => validateVideoUpload({
      bytes: buildMp4Fixture(),
      filename: 'tour.webm',
      claimedMimeType: 'video/webm',
      maxBytes: 10_000_000
    })).toThrowError(AppError);
  });

  it('rejects a file whose extension does not match its detected container', () => {
    expect(() => validateVideoUpload({
      bytes: buildMp4Fixture(),
      filename: 'tour.mov',
      claimedMimeType: 'video/mp4',
      maxBytes: 10_000_000
    })).toThrowError(expect.objectContaining({ code: 'UPLOAD_EXTENSION_MISMATCH' }));
  });

  it('enforces the configured size ceiling', () => {
    expect(() => validateVideoUpload({
      bytes: buildMp4Fixture(),
      filename: 'tour.mp4',
      claimedMimeType: 'video/mp4',
      maxBytes: 16
    })).toThrowError(expect.objectContaining({ code: 'UPLOAD_TOO_LARGE' }));
  });
});
