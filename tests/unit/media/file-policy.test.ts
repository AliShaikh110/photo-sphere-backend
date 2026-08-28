import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { detectImageMime, safeUploadFilename, validateImageUpload } from '../../../apps/api/src/media/file-policy';

describe('image upload policy', () => {
  it('detects content signatures and accepts a matching panorama image', async () => {
    const bytes = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#336699' }
    }).jpeg().toBuffer();

    expect(detectImageMime(bytes)).toBe('image/jpeg');
    expect(validateImageUpload({
      bytes,
      filename: 'panorama.jpg',
      claimedMimeType: 'image/jpeg',
      maxBytes: 1_000_000
    })).toMatchObject({ mimeType: 'image/jpeg', extension: '.jpg', sizeBytes: bytes.byteLength });
  });

  it('rejects MIME and extension mismatches instead of trusting the filename', async () => {
    const bytes = await sharp({
      create: { width: 200, height: 100, channels: 3, background: '#000000' }
    }).png().toBuffer();

    expect(() => validateImageUpload({
      bytes,
      filename: 'renamed.jpg',
      claimedMimeType: 'image/jpeg',
      maxBytes: 1_000_000
    })).toThrowError(expect.objectContaining({ code: 'UPLOAD_MIME_MISMATCH' }));
  });

  it('normalizes unsafe names and enforces the configured size limit', async () => {
    const bytes = await sharp({
      create: { width: 20, height: 10, channels: 3, background: '#ffffff' }
    }).webp().toBuffer();

    expect(safeUploadFilename('../../my pano.webp')).toBe('my_pano.webp');
    expect(safeUploadFilename('lobby..final.webp')).toBe('lobby..final.webp');
    expect(() => validateImageUpload({
      bytes,
      filename: 'pano.webp',
      claimedMimeType: 'image/webp',
      maxBytes: bytes.byteLength - 1
    })).toThrowError(expect.objectContaining({ code: 'UPLOAD_TOO_LARGE' }));
  });
});
