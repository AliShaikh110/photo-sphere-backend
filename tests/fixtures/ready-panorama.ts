import { randomUUID } from 'node:crypto';

import { sha256 } from '../helpers/image-fixture';

export type SeededPanorama = {
  assetId: string;
  thumbnailDerivativeId: string;
  lowResolutionDerivativeId: string;
  standardWebDerivativeId: string;
};

export async function seedReadyPanorama(options: {
  ownerId: string;
  projectId: string;
  bytes: Buffer;
}): Promise<SeededPanorama> {
  const { Asset, AssetDerivative } = await import('../../src/models');
  const { storage } = await import('../../src/integrations/storage');
  const assetId = randomUUID();
  const checksum = sha256(options.bytes);
  const sourceStorageKey = `test-fixtures/${assetId}/source.jpg`;
  await storage.put(sourceStorageKey, options.bytes, {
    contentType: 'image/jpeg',
    immutable: true,
    metadata: { checksumSha256: checksum }
  });
  await Asset.create({
    id: assetId,
    ownerId: options.ownerId,
    projectId: options.projectId,
    sourceStorageKey,
    sourceFilename: 'generated-panorama.jpg',
    sourceMimeType: 'image/jpeg',
    sourceSizeBytes: String(options.bytes.length),
    sourceChecksum: checksum,
    mediaType: 'panorama_image',
    projection: 'equirectangular',
    metadata: { width: 256, height: 128, is360: true, isFullSphere: true },
    processingStatus: 'ready',
    processingError: null
  });

  // The same derivative set the panorama pipeline produces, so a compiled
  // scene index can select the small thumbnail rather than the base image.
  const derivatives = await Promise.all([
    { kind: 'thumbnail' as const, suffix: 'thumb', width: 64, height: 32 },
    { kind: 'lowResolutionBase' as const, suffix: 'low', width: 256, height: 128 },
    { kind: 'standardWeb' as const, suffix: 'standard', width: 256, height: 128 }
  ].map(async ({ kind, suffix, width, height }) => {
    const storageKey = `test-fixtures/${assetId}/${suffix}.jpg`;
    await storage.put(storageKey, options.bytes, {
      contentType: 'image/jpeg',
      immutable: true,
      metadata: { checksumSha256: checksum }
    });
    return AssetDerivative.create({
      assetId,
      kind,
      version: 1,
      storageKey,
      mimeType: 'image/jpeg',
      width,
      height,
      sizeBytes: String(options.bytes.length),
      metadata: { checksumSha256: checksum }
    });
  }));

  return {
    assetId,
    thumbnailDerivativeId: derivatives[0]!.id,
    lowResolutionDerivativeId: derivatives[1]!.id,
    standardWebDerivativeId: derivatives[2]!.id
  };
}
