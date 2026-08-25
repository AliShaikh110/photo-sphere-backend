import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION
} from '../../src/compiler/viewer-integration-adapter';
import { seedReadyPanorama } from '../fixtures/ready-panorama';
import { bearer, registerIdentity } from '../helpers/api-client';
import { generatedEquirectangularJpeg } from '../helpers/image-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';

describe.sequential('Sprint 04 — spatial data, advanced geometry and immersive fallback', () => {
  let context: IntegrationTestContext;
  let panorama: Buffer;

  beforeAll(async () => {
    context = await startIntegrationTestContext();
    panorama = await generatedEquirectangularJpeg();
  }, 60_000);

  afterAll(async () => {
    await context?.stop();
  }, 60_000);

  beforeEach(async () => {
    await truncateApplicationData(context);
  });

  async function seedProject(label: string): Promise<{
    auth: { Authorization: string };
    ownerId: string;
    projectId: string;
    assetId: string;
    sceneId: string;
  }> {
    const owner = await registerIdentity(context.app, label);
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: `${label} project` })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });
    const scene = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 1, name: 'Lobby', panoramaAssetId: seeded.assetId })
      .expect(201);
    return {
      auth,
      ownerId: owner.id,
      projectId,
      assetId: seeded.assetId,
      sceneId: scene.body.data.scene.id as string
    };
  }

  it('accepts GPS or floor-plan placement without requiring both', async () => {
    const { auth, projectId, sceneId } = await seedProject('spatial');

    // GPS only.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .send({
        projectRevision: 2,
        spatialData: { coordinateSystem: 'wgs84', latitude: 48.8584, longitude: 2.2945 }
      })
      .expect(200);

    // Plan coordinates only — a floor-plan experience never invents GPS.
    const plan = await request(context.app)
      .post(`/api/v1/projects/${projectId}/plans`)
      .set(auth)
      .send({ projectRevision: 3, name: 'Ground floor', coordinateSystem: 'plan_normalized' })
      .expect(201);
    const planId = plan.body.data.plan.id as string;

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .send({
        projectRevision: 4,
        spatialData: { coordinateSystem: 'plan_normalized', planId, mapX: 0.25, mapY: 0.75 }
      })
      .expect(200);

    // Half a coordinate pair is refused in both systems.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .send({ projectRevision: 5, spatialData: { latitude: 48.8584 } })
      .expect(422);
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .send({ projectRevision: 5, spatialData: { planId, mapX: 0.25 } })
      .expect(422);
  }, 120_000);

  it('persists every advanced geometry kind and publishes them canonically', async () => {
    const { auth, projectId, sceneId, assetId } = await seedProject('geometry');

    const vertex = (longitudeDegrees: number, latitudeDegrees: number) => ({
      coordinateSystem: 'spherical_degrees' as const,
      longitudeDegrees,
      latitudeDegrees
    });

    const geometries = [
      { kind: 'polygon', vertices: [vertex(0, 0), vertex(10, 0), vertex(10, 10)] },
      { kind: 'polyline', vertices: [vertex(-20, 5), vertex(-10, 15)] },
      {
        kind: 'imageLayer',
        assetId,
        anchor: { widthDegrees: 30, heightDegrees: 20, opacity: 0.8 }
      }
    ];

    let revision = 2;
    for (const geometry of geometries) {
      await request(context.app)
        .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
        .set(auth)
        .send({ projectRevision: revision, geometry })
        .expect(201);
      revision += 1;
    }

    // A point is a hotspot, not an overlay; and degenerate shapes are refused.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
      .set(auth)
      .send({ projectRevision: revision, geometry: { kind: 'point' } })
      .expect(422);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
      .set(auth)
      .send({
        projectRevision: revision,
        geometry: { kind: 'polygon', vertices: [vertex(0, 0), vertex(5, 5)] }
      })
      .expect(422);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
      .set(auth)
      .send({
        projectRevision: revision,
        geometry: { kind: 'polyline', vertices: [vertex(0, 0)] }
      })
      .expect(422);

    // Point geometry remains available where it belongs — on a hotspot.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: revision,
        geometry: { kind: 'point' },
        position: { coordinateSystem: 'spherical_degrees', longitudeDegrees: 5, latitudeDegrees: 5 }
      })
      .expect(201);
    revision += 1;

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `geometry-${randomUUID()}`)
      .send({ revision, slug: 'sprint04-geometry', visibility: 'public' })
      .expect(201);

    const manifest = await request(context.app)
      .get('/view/sprint04-geometry/manifest')
      .expect(200);
    const scene = manifest.body.data.manifest.scenes[0];
    const kinds = (scene.overlays as { geometry: { kind: string } }[])
      .map((overlay) => overlay.geometry.kind)
      .sort();
    expect(kinds).toEqual(['imageLayer', 'polygon', 'polyline']);
    expect(scene.hotspots[0].geometry.kind).toBe('point');

    // Canonical geometry, not renderer plumbing.
    const serialized = JSON.stringify(scene.overlays);
    expect(serialized).not.toContain('MarkerPlugin');
    expect(serialized).not.toContain('polygonRad');
  }, 120_000);

  it('declares immersive capabilities as device-deferred with a normal 360 fallback', async () => {
    const { auth, projectId } = await seedProject('immersive');

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({
        revision: 2,
        settings: {
          motionNavigation: { enabled: true, requestPermissionOnStart: true },
          immersiveViewing: { stereoEnabled: true, immersiveEnabled: true }
        }
      })
      .expect(200);

    // Immersive features must never block publication.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `immersive-${randomUUID()}`)
      .send({ revision: 3, slug: 'sprint04-immersive', visibility: 'public' })
      .expect(201);

    const manifest = await request(context.app)
      .get('/view/sprint04-immersive/manifest')
      .expect(200);
    const runtime = manifest.body.data.manifest.runtime;

    // The backend resolves policy; the player decides actual device support.
    const deferred = runtime.deferredDeviceCapabilities as { capabilityId: string }[];
    const deferredIds = deferred.map((entry) => entry.capabilityId);
    expect(deferredIds).toEqual(expect.arrayContaining(['gyroscope', 'stereo']));
    expect(runtime.fallbackPolicy.immersive).toBe('continue-in-normal-360');
    expect(runtime.fallbackPolicy.optionalCapabilities).toBe('continue-without-capability');
  }, 120_000);

  it('hides map and plan until the spatial data behind them is real', async () => {
    const { auth, projectId, sceneId } = await seedProject('map-gating');

    // Map enabled with no scene coordinates anywhere is not a publishable map.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({ revision: 2, settings: { map: { enabled: true, showSceneMarkers: true } } })
      .expect(200);

    const withoutSpatial = await request(context.app)
      .post(`/api/v1/projects/${projectId}/validate`)
      .set(auth)
      .send({ revision: 3 })
      .expect(200);
    const capabilitiesWithout = withoutSpatial.body.data.capabilities?.capabilities ?? [];
    expect(capabilitiesWithout).not.toContain('map');

    // Give the scene genuine coordinates and the capability becomes available.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .send({
        projectRevision: 3,
        spatialData: { coordinateSystem: 'wgs84', latitude: 51.5007, longitude: -0.1246 }
      })
      .expect(200);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `map-${randomUUID()}`)
      .send({ revision: 4, slug: 'sprint04-map', visibility: 'public' })
      .expect(201);

    const manifest = await request(context.app)
      .get('/view/sprint04-map/manifest')
      .expect(200);
    const capabilityIds = (manifest.body.data.manifest.capabilities as { id: string }[])
      .map((capability) => capability.id);
    expect(capabilityIds).toContain('map');
  }, 120_000);

  it('records the viewer integration version on the publication it compiled', async () => {
    const { auth, projectId } = await seedProject('integration-version');
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `version-${randomUUID()}`)
      .send({ revision: 2, slug: 'sprint04-version', visibility: 'public' })
      .expect(201);

    const manifest = await request(context.app)
      .get('/view/sprint04-version/manifest')
      .expect(200);
    expect(manifest.body.data.manifest.viewerIntegrationVersion)
      .toBe(PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION);

    const { Publication } = await import('../../src/models');
    const publication = await Publication.findOne({ where: { projectId, isCurrent: true } });
    expect(publication?.viewerIntegrationVersion).toBe(PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION);

    // The platform can report which integration versions exist and which is live.
    const versions = await request(context.app)
      .get('/api/v1/platform/viewer-integrations')
      .set(auth)
      .expect(200);
    const listed = versions.body.data.versions as { version: string; status: string }[];
    expect(listed.map((entry) => entry.version)).toContain(PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION);
  }, 120_000);
});
