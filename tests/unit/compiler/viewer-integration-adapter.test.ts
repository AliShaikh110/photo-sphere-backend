import { describe, expect, it } from 'vitest';

import {
  PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
  PhotoSphereViewerIntegrationAdapter,
} from '../../../src/compiler/viewer-integration-adapter';
import type { ViewerIntegrationInput } from '../../../src/compiler/types';

function adapterInput(): ViewerIntegrationInput {
  return {
    initialSceneId: 'scene-1',
    settings: { navigation: { zoom: true, fullscreen: false } },
    branding: { companyName: 'Brand', properties: {} },
    scenes: [{
      id: 'scene-1',
      name: 'Lobby',
      sortOrder: 0,
      isPrimary: true,
      panorama: {
        assetId: 'asset-1',
        projection: 'equirectangular',
        base: {
          assetId: 'asset-1',
          derivativeId: 'low',
          kind: 'lowResolutionBase',
          version: 1,
          mimeType: 'image/jpeg',
          width: 1024,
          height: 512,
          url: '/media/low',
          access: 'protected',
        },
        primary: {
          assetId: 'asset-1',
          derivativeId: 'standard',
          kind: 'standardWeb',
          version: 1,
          mimeType: 'image/jpeg',
          width: 4096,
          height: 2048,
          url: '/media/standard',
          access: 'protected',
        },
      },
      initialView: { headingDegrees: 180, pitchDegrees: -45, horizontalFovDegrees: 90 },
      hotspots: [{
        id: 'hotspot-1',
        geometry: { kind: 'point' },
        position: {
          coordinateSystem: 'spherical_degrees',
          longitudeDegrees: 90,
          latitudeDegrees: 30,
        },
        content: { title: '<img src=x onerror=bad()>Point', properties: {} },
        action: { kind: 'none' },
        enabled: true,
        visibilityRules: {},
      }],
      overlays: [],
      connections: [],
      spatialData: {},
      runtimeHints: {},
  preloadSceneIds: [],
    }],
  };
}

describe('Photo Sphere Viewer integration adapter', () => {
  it('is the versioned boundary that emits renderer coordinates/config', () => {
    const output = new PhotoSphereViewerIntegrationAdapter().adapt(adapterInput());
    expect(output.viewerIntegrationVersion).toBe(PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION);
    expect(output.rendererId).toBe('photo-sphere-viewer');
    expect(output.config.startup).toMatchObject({
      panorama: '/media/standard',
      basePanorama: '/media/low',
      defaultYaw: Math.PI,
      defaultPitch: -Math.PI / 4,
    });
    expect(JSON.stringify(output.config)).not.toContain('onerror');
  });

  it('accepts the configured integration version and emits it unchanged', () => {
    const output = new PhotoSphereViewerIntegrationAdapter('custom-adapter-9').adapt(adapterInput());
    expect(output.viewerIntegrationVersion).toBe('custom-adapter-9');
  });
});

