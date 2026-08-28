import { describe, expect, it } from 'vitest';

import { interactionGeometrySchema } from '../../../apps/api/src/validators/request-schemas';

/**
 * Sprint 04 requires the canonical geometry union to carry point, polygon,
 * polyline, imageLayer, videoLayer and custom. The API-level tests exercise the
 * kinds an image project can author directly; this covers the union itself so
 * `videoLayer` cannot quietly fall out of the schema.
 */
describe('Canonical interaction geometry', () => {
  const vertex = (longitudeDegrees: number, latitudeDegrees: number) => ({
    coordinateSystem: 'spherical_degrees' as const,
    longitudeDegrees,
    latitudeDegrees
  });
  const assetId = '11111111-2222-4000-8000-000000000001';
  const anchor = { widthDegrees: 40, heightDegrees: 25 };

  it('accepts every canonical kind', () => {
    const geometries = [
      { kind: 'point' },
      { kind: 'polygon', vertices: [vertex(0, 0), vertex(10, 0), vertex(10, 10)] },
      { kind: 'polyline', vertices: [vertex(0, 0), vertex(10, 10)] },
      { kind: 'imageLayer', assetId, anchor },
      { kind: 'videoLayer', assetId, anchor },
      {
        kind: 'custom',
        extensionId: 'platform.measurement-label',
        extensionVersion: '1.0.0',
        payload: { label: 'Span' }
      }
    ];

    const parsed = geometries.map((geometry) => interactionGeometrySchema.parse(geometry));
    expect(parsed.map((geometry) => geometry.kind)).toEqual([
      'point',
      'polygon',
      'polyline',
      'imageLayer',
      'videoLayer',
      'custom'
    ]);
  });

  it('keeps a media layer bound to a logical asset ID rather than a URL', () => {
    const parsed = interactionGeometrySchema.parse({ kind: 'videoLayer', assetId, anchor });
    expect(parsed).toMatchObject({ kind: 'videoLayer', assetId });
    expect(JSON.stringify(parsed)).not.toContain('http');

    expect(() => interactionGeometrySchema.parse({
      kind: 'videoLayer',
      assetId: 'https://cdn.example.test/clip.mp4',
      anchor
    })).toThrowError();
  });

  it('rejects degenerate and non-finite geometry', () => {
    // Below the minimum vertex counts.
    expect(() => interactionGeometrySchema.parse({
      kind: 'polygon',
      vertices: [vertex(0, 0), vertex(1, 1)]
    })).toThrowError();
    expect(() => interactionGeometrySchema.parse({
      kind: 'polyline',
      vertices: [vertex(0, 0)]
    })).toThrowError();

    // Out-of-range and non-finite coordinates.
    expect(() => interactionGeometrySchema.parse({
      kind: 'polyline',
      vertices: [vertex(0, 0), vertex(200, 0)]
    })).toThrowError();
    expect(() => interactionGeometrySchema.parse({
      kind: 'polyline',
      vertices: [vertex(0, 0), vertex(0, Number.NaN)]
    })).toThrowError();

    // A layer needs a real extent.
    expect(() => interactionGeometrySchema.parse({
      kind: 'imageLayer',
      assetId,
      anchor: { widthDegrees: 0, heightDegrees: 25 }
    })).toThrowError();
  });

  it('rejects an unknown geometry kind rather than passing it through', () => {
    expect(() => interactionGeometrySchema.parse({ kind: 'rendererMesh', config: {} }))
      .toThrowError();
    expect(() => interactionGeometrySchema.parse({})).toThrowError();
  });
});
