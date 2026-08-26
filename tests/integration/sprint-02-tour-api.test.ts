import { randomUUID } from 'node:crypto';

// Lowered before the app is imported so a handful of scenes is enough to cross
// the progressive-delivery threshold; the production default is 32.
process.env.TOUR_INLINE_MAX_SCENES = '3';

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

describe.sequential('Sprint 02 — multi-scene tours, delivery strategy and capability resolution', () => {
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

  async function createTourProject(label: string): Promise<{
    auth: { Authorization: string };
    ownerId: string;
    projectId: string;
    assetId: string;
  }> {
    const owner = await registerIdentity(context.app, label);
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: `${label} tour` })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });
    return { auth, ownerId: owner.id, projectId, assetId: seeded.assetId };
  }

  async function addScene(
    auth: { Authorization: string },
    projectId: string,
    assetId: string,
    name: string,
    projectRevision: number
  ): Promise<string> {
    const response = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision, name, panoramaAssetId: assetId })
      .expect(201);
    return response.body.data.scene.id as string;
  }

  it('keeps scene IDs stable across reorder and blocks deletes that would orphan a connection', async () => {
    const { auth, projectId, assetId } = await createTourProject('tour-scenes');

    const lobby = await addScene(auth, projectId, assetId, 'Lobby', 1);
    const pool = await addScene(auth, projectId, assetId, 'Pool', 2);
    const spa = await addScene(auth, projectId, assetId, 'Spa', 3);

    // Connect Lobby -> Pool so Pool has an inbound reference.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${lobby}`)
      .set(auth)
      .send({
        projectRevision: 4,
        connections: [{ targetSceneId: pool, importance: 90, preloadHint: 'high' }]
      })
      .expect(200);

    // A connection to a scene that does not exist is refused outright.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${lobby}`)
      .set(auth)
      .send({ projectRevision: 5, connections: [{ targetSceneId: randomUUID() }] })
      .expect(422);

    // Reorder must not mint new scene IDs.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/reorder`)
      .set(auth)
      .send({ projectRevision: 5, sceneIds: [spa, pool, lobby] })
      .expect(200);
    const reordered = await request(context.app)
      .get(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .expect(200);
    expect(reordered.body.data.scenes.map((scene: { id: string }) => scene.id))
      .toEqual([spa, pool, lobby]);

    // Deleting a scene with an inbound connection must be refused, not silently
    // leave a dangling target behind.
    const blocked = await request(context.app)
      .delete(`/api/v1/projects/${projectId}/scenes/${pool}`)
      .set(auth)
      .send({ projectRevision: 6 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBeDefined();

    // Still present after the refused delete.
    await request(context.app)
      .get(`/api/v1/projects/${projectId}/scenes/${pool}`)
      .set(auth)
      .expect(200);
  }, 90_000);

  it('publishes a small tour inline and switches a larger tour to progressive delivery', async () => {
    const small = await createTourProject('small-tour');
    await addScene(small.auth, small.projectId, small.assetId, 'One', 1);
    await addScene(small.auth, small.projectId, small.assetId, 'Two', 2);

    await request(context.app)
      .post(`/api/v1/projects/${small.projectId}/publish`)
      .set(small.auth)
      .set('Idempotency-Key', `small-${randomUUID()}`)
      .send({ revision: 3, slug: 'small-tour-inline', visibility: 'public' })
      .expect(201);

    const smallManifest = await request(context.app)
      .get('/view/small-tour-inline/manifest')
      .expect(200);
    expect(smallManifest.body.data.manifest.tour.strategy).toBe('embedded');
    // Inline delivery ships the scene bodies themselves.
    expect(smallManifest.body.data.manifest.scenes.length).toBe(2);

    const large = await createTourProject('large-tour');
    const largeSceneIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      largeSceneIds.push(
        await addScene(large.auth, large.projectId, large.assetId, `Room ${index + 1}`, index + 1)
      );
    }
    await request(context.app)
      .post(`/api/v1/projects/${large.projectId}/publish`)
      .set(large.auth)
      .set('Idempotency-Key', `large-${randomUUID()}`)
      .send({ revision: 6, slug: 'large-tour-progressive', visibility: 'public' })
      .expect(201);

    const largeManifest = await request(context.app)
      .get('/view/large-tour-progressive/manifest')
      .expect(200);
    const tour = largeManifest.body.data.manifest.tour;
    expect(tour.strategy).toBe('progressive');
    // The index names every scene while the manifest carries only the entry scene.
    expect(tour.sceneIndex.length).toBe(5);
    expect(largeManifest.body.data.manifest.scenes.length).toBeLessThan(5);

    // Progressive scene definitions resolve from the published revision.
    const target = largeSceneIds[3]!;
    const definition = await request(context.app)
      .get(`/view/large-tour-progressive/scenes/${target}`)
      .expect(200);
    expect(definition.body.data.sceneDefinition.scene.id).toBe(target);
    // Progressive media stays publication-scoped rather than exposing storage.
    expect(definition.body.data.sceneDefinition.scene.panorama.primary.url)
      .toMatch(/^\/api\/v1\/publications\//);

    // A scene ID that is not part of this publication is not fetchable.
    await request(context.app)
      .get(`/view/large-tour-progressive/scenes/${randomUUID()}`)
      .expect(404);
  }, 120_000);

  it('protects progressive scene definitions of a private tour', async () => {
    const { auth, projectId, assetId } = await createTourProject('private-tour');
    const sceneIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      sceneIds.push(await addScene(auth, projectId, assetId, `Private ${index + 1}`, index + 1));
    }
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `private-${randomUUID()}`)
      .send({ revision: 6, slug: 'private-progressive-tour', visibility: 'private' })
      .expect(201);

    // Knowing the slug and a scene ID is not sufficient for a private tour:
    // the progressive route must not become a way around the manifest check.
    await request(context.app)
      .get('/view/private-progressive-tour/manifest')
      .expect(401);
    await request(context.app)
      .get(`/view/private-progressive-tour/scenes/${sceneIds[2]!}`)
      .expect(401);

    const stranger = await registerIdentity(context.app, 'private-tour-stranger');
    await request(context.app)
      .get(`/view/private-progressive-tour/scenes/${sceneIds[2]!}`)
      .set(bearer(stranger.accessToken))
      .expect(403);

    // The owner can still read it.
    await request(context.app)
      .get(`/view/private-progressive-tour/scenes/${sceneIds[2]!}`)
      .set(auth)
      .expect(200);
  }, 120_000);

  it('compiles tour settings as product concepts and declares only the modules in use', async () => {
    const { auth, projectId, assetId } = await createTourProject('tour-settings');
    const lobby = await addScene(auth, projectId, assetId, 'Lobby', 1);
    const pool = await addScene(auth, projectId, assetId, 'Pool', 2);

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${lobby}`)
      .set(auth)
      .send({
        projectRevision: 3,
        connections: [{ targetSceneId: pool, importance: 95, preloadHint: 'high' }],
        viewLimits: { minHeadingDegrees: -90, maxHeadingDegrees: 90 }
      })
      .expect(200);

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({
        revision: 4,
        settings: {
          gallery: { enabled: true },
          autorotation: { enabled: true, speedDegreesPerSecond: 2, direction: 'clockwise' },
          compass: { enabled: true }
        }
      })
      .expect(200);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `settings-${randomUUID()}`)
      .send({ revision: 5, slug: 'tour-settings-experience', visibility: 'public' })
      .expect(201);

    const published = await request(context.app)
      .get('/view/tour-settings-experience/manifest')
      .expect(200);
    const manifest = published.body.data.manifest;

    expect(manifest.viewerIntegrationVersion).toBe(PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION);
    expect(manifest.settings.gallery.enabled).toBe(true);
    expect(manifest.settings.autorotation.enabled).toBe(true);
    expect(manifest.settings.compass.enabled).toBe(true);

    // Runtime modules are declared, and only for capabilities actually in use.
    const modules: string[] = manifest.runtime.modules;
    expect(modules.length).toBeGreaterThan(0);
    expect(modules).not.toContain('stereo');
    expect(modules).not.toContain('map');

    // Preloading names likely neighbours, never the whole tour.
    for (const scene of manifest.scenes as { preloadSceneIds?: string[] }[]) {
      expect((scene.preloadSceneIds ?? []).length).toBeLessThanOrEqual(2);
    }

    // Cache policy is compiled and bounded rather than left to the player.
    expect(manifest.runtime.cache).toBeDefined();
    expect(manifest.runtime.preload.maxScenesPerSource).toBeLessThanOrEqual(2);
  }, 120_000);

  it('accepts scene_changed and scene_transition_failed telemetry with failure context', async () => {
    const { auth, projectId, assetId } = await createTourProject('tour-telemetry');
    const lobby = await addScene(auth, projectId, assetId, 'Lobby', 1);
    const pool = await addScene(auth, projectId, assetId, 'Pool', 2);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `telemetry-${randomUUID()}`)
      .send({ revision: 3, slug: 'tour-telemetry-experience', visibility: 'public' })
      .expect(201);

    const base = {
      experienceId: projectId,
      publicationRevision: 1,
      viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
      sessionId: `session-${randomUUID()}`,
      occurredAt: new Date().toISOString()
    };

    // The player reports with the ingest token issued alongside its manifest.
    const published = await request(context.app)
      .get('/view/tour-telemetry-experience/manifest')
      .expect(200);
    const ingestToken = published.body.data.manifest.telemetry.ingestToken as string;

    await request(context.app)
      .post('/api/v1/runtime/events')
      .set('x-telemetry-token', ingestToken)
      .send({
        events: [
          { ...base, eventId: randomUUID(), eventName: 'scene_changed', payload: { sceneId: pool } },
          {
            ...base,
            eventId: randomUUID(),
            eventName: 'scene_transition_failed',
            payload: {
              sourceSceneId: lobby,
              targetSceneId: pool,
              failureCategory: 'asset_unavailable'
            }
          }
        ]
      })
      .expect(202)
      .expect(({ body }) => expect(body.data).toEqual({ accepted: 2, duplicates: 0 }));

    // A transition failure without its stable failure category is not accepted,
    // because the event exists to make the failure diagnosable.
    await request(context.app)
      .post('/api/v1/runtime/events')
      .set('x-telemetry-token', ingestToken)
      .send({
        ...base,
        eventId: randomUUID(),
        eventName: 'scene_transition_failed',
        payload: { sourceSceneId: lobby, targetSceneId: pool }
      })
      .expect(422);
  }, 90_000);

  it('keeps a published scene definition immutable when the draft changes afterwards', async () => {
    const { auth, projectId, assetId } = await createTourProject('tour-immutable');
    const lobby = await addScene(auth, projectId, assetId, 'Lobby', 1);
    const pool = await addScene(auth, projectId, assetId, 'Pool', 2);
    for (let index = 0; index < 3; index += 1) {
      await addScene(auth, projectId, assetId, `Filler ${index + 1}`, index + 3);
    }

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `immutable-${randomUUID()}`)
      .send({ revision: 6, slug: 'immutable-tour', visibility: 'public' })
      .expect(201);

    const published = await request(context.app)
      .get(`/view/immutable-tour/scenes/${pool}`)
      .expect(200);
    expect(published.body.data.sceneDefinition.scene.name).toBe('Pool');

    // The creator keeps editing the draft after publishing.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${pool}`)
      .set(auth)
      .send({ projectRevision: 6, name: 'Rooftop Pool' })
      .expect(200);
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${lobby}`)
      .set(auth)
      .send({ projectRevision: 7, name: 'Grand Lobby' })
      .expect(200);

    // Visitors on the published revision must not see the unpublished edit.
    const afterEdit = await request(context.app)
      .get(`/view/immutable-tour/scenes/${pool}`)
      .expect(200);
    expect(afterEdit.body.data.sceneDefinition.scene.name).toBe('Pool');
    const manifest = await request(context.app)
      .get('/view/immutable-tour/manifest')
      .expect(200);
    const indexNames = (manifest.body.data.manifest.tour.sceneIndex as { name: string }[])
      .map((entry) => entry.name);
    expect(indexNames).toContain('Lobby');
    expect(indexNames).not.toContain('Grand Lobby');

    // The draft itself did change; only the published revision is frozen.
    const draft = await request(context.app)
      .get(`/api/v1/projects/${projectId}/scenes/${pool}`)
      .set(auth)
      .expect(200);
    expect(draft.body.data.scene.name).toBe('Rooftop Pool');

    // Republishing produces a new revision while the old one keeps its content.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `immutable-2-${randomUUID()}`)
      .send({ revision: 8, slug: 'immutable-tour', visibility: 'public' })
      .expect(201);
    await request(context.app)
      .get(`/view/immutable-tour/revisions/1/scenes/${pool}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.sceneDefinition.scene.name).toBe('Pool'));
    await request(context.app)
      .get(`/view/immutable-tour/revisions/2/scenes/${pool}`)
      .expect(200)
      .expect(({ body }) => expect(body.data.sceneDefinition.scene.name).toBe('Rooftop Pool'));
  }, 120_000);

  it('rejects an in-place rewrite of a stored published scene definition', async () => {
    const { auth, projectId, assetId } = await createTourProject('tour-scene-write');
    const lobby = await addScene(auth, projectId, assetId, 'Lobby', 1);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `frozen-${randomUUID()}`)
      .send({ revision: 2, slug: 'frozen-scene-tour', visibility: 'public' })
      .expect(201);

    const { PublishedSceneDefinition } = await import('../../src/models');
    const stored = await PublishedSceneDefinition.findOne({ where: { sceneId: lobby } });
    expect(stored).not.toBeNull();

    await expect(stored!.update({ compiledScene: { tampered: true } })).rejects.toThrow(
      /immutable/i
    );
    await expect(
      PublishedSceneDefinition.update(
        { publicationRevision: 99 },
        { where: { sceneId: lobby } }
      )
    ).rejects.toThrow(/immutable/i);
  }, 90_000);

  it('indexes scenes with the small thumbnail rather than the panorama base image', async () => {
    const { auth, ownerId, projectId, assetId } = await createTourProject('tour-thumbnails');
    await addScene(auth, projectId, assetId, 'Lobby', 1);
    await addScene(auth, projectId, assetId, 'Pool', 2);
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({ revision: 3, settings: { gallery: { enabled: true } } })
      .expect(200);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `thumbnails-${randomUUID()}`)
      .send({ revision: 4, slug: 'thumbnail-tour', visibility: 'public' })
      .expect(201);

    const { AssetDerivative } = await import('../../src/models');
    const thumbnail = await AssetDerivative.findOne({
      where: { assetId, kind: 'thumbnail' }
    });
    const base = await AssetDerivative.findOne({
      where: { assetId, kind: 'lowResolutionBase' }
    });
    expect(thumbnail).not.toBeNull();
    expect(ownerId).toBeTruthy();

    const manifest = await request(context.app)
      .get('/view/thumbnail-tour/manifest')
      .expect(200);
    const entries = manifest.body.data.manifest.tour.sceneIndex as {
      thumbnail: { derivativeId: string };
    }[];
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.thumbnail.derivativeId).toBe(thumbnail!.id);
      expect(entry.thumbnail.derivativeId).not.toBe(base!.id);
    }
    // The scene body still carries the larger base image for first render.
    const scenes = manifest.body.data.manifest.scenes as {
      panorama: { base: { derivativeId: string } };
    }[];
    expect(scenes[0]?.panorama.base.derivativeId).toBe(base!.id);

    // The indexed thumbnail is fetchable through the publication media route.
    const thumbnailUrl = entries[0]!.thumbnail as unknown as { url: string };
    await request(context.app).get((thumbnailUrl as { url: string }).url).expect(200);
  }, 120_000);
});
