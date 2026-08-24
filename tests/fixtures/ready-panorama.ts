import { randomUUID } from 'node:crypto';

import { sha256 } from '../helpers/image-fixture';

export type SeededPanorama = {
  assetId: string;
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

  const derivatives = await Promise.all([
    { kind: 'lowResolutionBase' as const, suffix: 'low' },
    { kind: 'standardWeb' as const, suffix: 'standard' }
  ].map(async ({ kind, suffix }) => {
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
      width: 256,
      height: 128,
      sizeBytes: String(options.bytes.length),
      metadata: { checksumSha256: checksum }
    });
  }));

  return {
    assetId,
    lowResolutionDerivativeId: derivatives[0]!.id,
    standardWebDerivativeId: derivatives[1]!.id
  };
}
