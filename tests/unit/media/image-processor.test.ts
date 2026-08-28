import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  generateDisplayImageDerivatives,
  generatePanoramaDerivatives,
  inspectPanorama
} from '../../../apps/api/src/media/image-processor';
import { extractGpanoMetadata } from '../../../apps/api/src/media/xmp';

describe('panorama processing', () => {
  it('inspects a full 2:1 equirectangular panorama and creates all baseline derivatives', async () => {
    const bytes = await sharp({
      create: { width: 800, height: 400, channels: 3, background: '#204060' }
    }).jpeg({ quality: 90 }).toBuffer();

    const inspection = await inspectPanorama({
      bytes,
      mimeType: 'image/jpeg',
      maxPixels: 1_000_000
    });
    expect(inspection).toMatchObject({
      width: 800,
      height: 400,
      aspectRatio: 2,
      projection: 'equirectangular',
      is360: true,
      isFullSphere: true
    });

    const derivatives = await generatePanoramaDerivatives({
      assetId: 'asset-test',
      version: 2,
      bytes,
      maxPixels: 1_000_000
    });
    expect(derivatives.map((item) => item.kind)).toEqual([
      'thumbnail',
      'lowResolutionBase',
      'standardWeb'
    ]);
    expect(derivatives.every((item) => item.version === 2 && item.storageKey.includes('/v2/'))).toBe(true);
    expect(derivatives.every((item) => item.mimeType === 'image/jpeg' && item.storageKey.endsWith('.jpg'))).toBe(true);
    expect(new Set(derivatives.map((item) => item.checksum)).size).toBeGreaterThan(0);
  });

  it.each([
    { mimeType: 'image/png' as const, extension: '.png' },
    { mimeType: 'image/webp' as const, extension: '.webp' }
  ])('preserves alpha in $mimeType display derivatives', async ({ mimeType, extension }) => {
    const source = sharp({
      create: {
        width: 800,
        height: 400,
        channels: 4,
        background: { r: 32, g: 64, b: 96, alpha: 0.25 }
      }
    });
    const bytes = mimeType === 'image/png'
      ? await source.png().toBuffer()
      : await source.webp({ lossless: true }).toBuffer();

    const derivatives = await generateDisplayImageDerivatives({
      assetId: 'asset-display',
      version: 3,
      bytes,
      maxPixels: 1_000_000,
      mimeType
    });

    expect(derivatives.map((item) => item.kind)).toEqual([
      'thumbnail',
      'lowResolutionBase',
      'standardWeb'
    ]);
    for (const derivative of derivatives) {
      expect(derivative).toMatchObject({ mimeType, version: 3 });
      expect(derivative.storageKey).toMatch(new RegExp(`\\${extension}$`));
      await expect(sharp(derivative.body).metadata()).resolves.toMatchObject({ hasAlpha: true });
    }
  });

  it('extracts cropped GPano and pose metadata from XMP', () => {
    const xmp = Buffer.from(`
      <rdf:Description GPano:ProjectionType="equirectangular"
        GPano:CroppedAreaImageWidthPixels="3000"
        GPano:CroppedAreaImageHeightPixels="1500"
        GPano:FullPanoWidthPixels="4000"
        GPano:FullPanoHeightPixels="2000"
        GPano:CroppedAreaLeftPixels="500"
        GPano:CroppedAreaTopPixels="250"
        GPano:PoseHeadingDegrees="42.5" />
    `, 'latin1');

    expect(extractGpanoMetadata(xmp)).toMatchObject({
      projectionType: 'equirectangular',
      croppedAreaImageWidthPixels: 3000,
      fullPanoWidthPixels: 4000,
      croppedAreaLeftPixels: 500,
      poseHeadingDegrees: 42.5
    });
  });

  it('inspects an embedded cropped GPano fixture end to end', async () => {
    const xmp = `
      <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
          <rdf:Description xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"
            GPano:ProjectionType="equirectangular"
            GPano:CroppedAreaImageWidthPixels="300"
            GPano:CroppedAreaImageHeightPixels="150"
            GPano:FullPanoWidthPixels="400"
            GPano:FullPanoHeightPixels="200"
            GPano:CroppedAreaLeftPixels="50"
            GPano:CroppedAreaTopPixels="25" />
        </rdf:RDF>
      </x:xmpmeta>`;
    const bytes = await sharp({
      create: { width: 300, height: 150, channels: 3, background: '#204060' }
    }).jpeg().withXmp(xmp).toBuffer();

    await expect(inspectPanorama({
      bytes,
      mimeType: 'image/jpeg',
      maxPixels: 1_000_000
    })).resolves.toMatchObject({
      width: 300,
      height: 150,
      projection: 'cropped_equirectangular',
      is360: true,
      isFullSphere: false,
      xmp: {
        fullPanoWidthPixels: 400,
        fullPanoHeightPixels: 200,
        croppedAreaImageWidthPixels: 300,
        croppedAreaImageHeightPixels: 150,
        croppedAreaLeftPixels: 50,
        croppedAreaTopPixels: 25
      }
    });
  });

  it('rejects GPano crop dimensions that disagree with the decoded image', async () => {
    const xmp = `
      <x:xmpmeta xmlns:x="adobe:ns:meta/">
        <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
          <rdf:Description xmlns:GPano="http://ns.google.com/photos/1.0/panorama/"
            GPano:ProjectionType="equirectangular"
            GPano:CroppedAreaImageWidthPixels="600"
            GPano:CroppedAreaImageHeightPixels="300"
            GPano:FullPanoWidthPixels="800"
            GPano:FullPanoHeightPixels="400"
            GPano:CroppedAreaLeftPixels="100"
            GPano:CroppedAreaTopPixels="50" />
        </rdf:RDF>
      </x:xmpmeta>`;
    const bytes = await sharp({
      create: { width: 300, height: 150, channels: 3, background: '#204060' }
    }).jpeg().withXmp(xmp).toBuffer();

    await expect(inspectPanorama({
      bytes,
      mimeType: 'image/jpeg',
      maxPixels: 1_000_000
    })).rejects.toMatchObject({ code: 'PANORAMA_METADATA_INVALID' });
  });

  it('classifies and persists dimensions after EXIF orientation normalization', async () => {
    const bytes = await sharp({
      create: { width: 400, height: 800, channels: 3, background: '#204060' }
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const inspection = await inspectPanorama({
      bytes,
      mimeType: 'image/jpeg',
      maxPixels: 1_000_000
    });
    expect(inspection).toMatchObject({
      width: 800,
      height: 400,
      aspectRatio: 2,
      orientation: 6,
      projection: 'equirectangular'
    });
  });

  it('rejects a non-panorama aspect ratio', async () => {
    const bytes = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#ffffff' }
    }).jpeg().toBuffer();

    await expect(inspectPanorama({
      bytes,
      mimeType: 'image/jpeg',
      maxPixels: 1_000_000
    })).rejects.toMatchObject({ code: 'PANORAMA_NOT_DETECTED' });
  });
});
