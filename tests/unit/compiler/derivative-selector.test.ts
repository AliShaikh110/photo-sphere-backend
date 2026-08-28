import { describe, expect, it } from 'vitest';

import {
  DerivativeSelectionError,
  requirePanoramaDerivatives,
  selectLatestReadyDerivative,
  selectPreferredReadyDerivative,
} from '@alishaikh110/experience-compiler';
import { derivative, panoramaAsset } from './fixtures';

describe('deterministic derivative selection', () => {
  it('selects the highest ready version independent of input order', () => {
    const oldVersion = derivative('asset', 'standardWeb', 1);
    const latestFailed = derivative('asset', 'standardWeb', 3, { readiness: 'failed' });
    const selected = derivative('asset', 'standardWeb', 2);

    expect(selectLatestReadyDerivative(
      [latestFailed, selected, oldVersion],
      'standardWeb',
    )).toBe(selected);
    expect(selectLatestReadyDerivative(
      [oldVersion, latestFailed, selected],
      'standardWeb',
    )).toBe(selected);
  });

  it('uses a lexical stable tie-breaker for malformed duplicate catalogs', () => {
    const b = derivative('asset', 'standardWeb', 2, { id: 'b' });
    const a = derivative('asset', 'standardWeb', 2, { id: 'a' });
    expect(selectLatestReadyDerivative([b, a], 'standardWeb')).toBe(a);
  });

  it('prefers standard web, then low base, then thumbnail', () => {
    const thumbnail = derivative('asset', 'thumbnail');
    const low = derivative('asset', 'lowResolutionBase');
    expect(selectPreferredReadyDerivative({ derivatives: [thumbnail, low] })).toBe(low);
  });

  it('selects a transparency-preserving display derivative without constraining its MIME type', () => {
    const transparentWeb = derivative('asset-logo', 'standardWeb', 2, {
      mimeType: 'image/webp',
      storageKey: 'derivatives/asset-logo/v2/standardWeb.webp',
    });
    expect(selectPreferredReadyDerivative({ derivatives: [transparentWeb] })).toBe(transparentWeb);
  });

  it('requires both baseline panorama derivatives', () => {
    const asset = panoramaAsset({
      derivatives: [derivative('asset-panorama', 'standardWeb')],
    });
    expect(() => requirePanoramaDerivatives(asset)).toThrow(DerivativeSelectionError);
    try {
      requirePanoramaDerivatives(asset);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'REQUIRED_DERIVATIVE_MISSING',
        assetId: 'asset-panorama',
        missingKinds: ['lowResolutionBase'],
      });
    }
  });
});
