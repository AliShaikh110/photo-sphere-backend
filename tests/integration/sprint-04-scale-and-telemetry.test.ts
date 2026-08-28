import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../apps/api/src/config';
import { seedReadyPanorama } from '../fixtures/ready-panorama';
import { bearer, registerIdentity } from '../helpers/api-client';
import { generatedEquirectangularJpeg } from '../helpers/image-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';

const LARGE_TOUR_SCENES = 120;

/**
 * Sprint 04 §23 scale boundaries measured against the real publish path and
 * the real event store, rather than against the compiler alone.
 *
 * The assertions are deliberately generous ceilings: the sprint asks for
 * measurement to tune configuration, not for invented production thresholds.
 * What each one has to catch is a change of shape - a manifest that starts
 * carrying every scene, a query with no bound, an ingest path that fails
 * open - not a few percent of drift.
 */
describe.sequential('Sprint 04 — enterprise scale, analytics budget and ingest bursts', () => {
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

  async function seedLargeTour(sceneCount: number): Promise<{
    auth: { Authorization: string };
    projectId: string;
    revision: number;
  }> {
    const owner = await registerIdentity(context.app, 'scale-owner');
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'Enterprise tour' })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });

    // The scene graph is seeded directly: this test is about the publish and
    // delivery path at scale, not about repeating the authoring API 120 times.
    const { Scene, SceneConnection } = await import('../../apps/api/src/models');
    const scenes = await Scene.bulkCreate(
      Array.from({ length: sceneCount }, (_unused, index) => ({
        projectId,
        name: `Room ${index + 1}`,
        panoramaAssetId: seeded.assetId,
        sortOrder: index,
        isPrimary: index === 0
      })),
      { returning: true }
    );
    await SceneConnection.bulkCreate(
      scenes.slice(0, -1).map((scene, index) => ({
        sourceSceneId: scene.id,
        targetSceneId: scenes[index + 1]!.id,
        importance: 80,
        preloadHint: 'high' as const
      }))
    );
    return { auth, projectId, revision: created.body.data.project.revision as number };
  }

  it('publishes and progressively delivers a 100+ scene tour within a bounded budget', async () => {
    const { auth, projectId, revision } = await seedLargeTour(LARGE_TOUR_SCENES);
    const slug = 'sprint04-enterprise-tour';

    // Validation of a large project must stay usable in the editor.
    const validateStartedAt = Date.now();
    const validated = await request(context.app)
      .post(`/api/v1/projects/${projectId}/validate`)
      .set(auth)
      .send({ revision })
      .expect(200);
    const validateMs = Date.now() - validateStartedAt;
    expect(validated.body.data.valid).toBe(true);
    expect(validateMs).toBeLessThan(15_000);

    const heapBefore = process.memoryUsage().heapUsed;
    const publishStartedAt = Date.now();
    const published = await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send({ revision, slug, visibility: 'public' })
      .expect(201);
    const publishMs = Date.now() - publishStartedAt;
    const heapGrowth = process.memoryUsage().heapUsed - heapBefore;

    expect(published.body.data.publication.publicationRevision).toBe(1);
    expect(publishMs).toBeLessThan(30_000);
    // Compiling 120 scenes must not retain anything like a per-scene copy of
    // the process heap; a regression to holding every compiled scene at once
    // would blow far past this.
    expect(heapGrowth).toBeLessThan(256 * 1024 * 1024);

    const manifestResponse = await request(context.app).get(`/view/${slug}/manifest`).expect(200);
    const manifest = manifestResponse.body.data.manifest;
    const manifestBytes = Buffer.byteLength(JSON.stringify(manifest), 'utf8');

    // Progressive delivery: the startup payload carries the entry scene and an
    // index, never the full detail of all 120 scenes.
    expect(manifest.tour.strategy).toBe('progressive');
    expect(manifestBytes).toBeLessThan(config.publishLimits.maxManifestBytes);
    expect(manifest.scenes.length).toBeLessThan(LARGE_TOUR_SCENES);

    // The scene index is paged, and a page is bounded regardless of what the
    // caller asks for.
    const firstPage = await request(context.app)
      .get(`/view/${slug}/revisions/1/scene-index?limit=25`)
      .expect(200);
    expect(firstPage.body.data.page.total).toBe(LARGE_TOUR_SCENES);
    expect(firstPage.body.data.entries).toHaveLength(25);

    // The page ceiling is part of the contract: an over-large request is
    // refused outright rather than quietly answered with the whole index.
    await request(context.app)
      .get(`/view/${slug}/revisions/1/scene-index?limit=100000`)
      .expect(422);
    const defaultPage = await request(context.app)
      .get(`/view/${slug}/revisions/1/scene-index`)
      .expect(200);
    expect(defaultPage.body.data.page.limit).toBeLessThanOrEqual(250);
    expect(defaultPage.body.data.entries.length).toBeLessThanOrEqual(250);

    // An index entry stays a pointer: no hotspots, overlays or panorama body.
    const indexEntry = firstPage.body.data.entries[0];
    expect(indexEntry).not.toHaveProperty('hotspots');
    expect(indexEntry).not.toHaveProperty('overlays');
    const indexBytesPerScene = Buffer.byteLength(
      JSON.stringify(firstPage.body.data.entries),
      'utf8'
    ) / firstPage.body.data.entries.length;

    // A full scene definition is fetched on demand and is materially larger
    // than its index entry, which is what makes the index worth having.
    const sceneId = indexEntry.id as string;
    const sceneDefinition = await request(context.app)
      .get(`/view/${slug}/revisions/1/scenes/${sceneId}`)
      .expect(200);
    const sceneBytes = Buffer.byteLength(
      JSON.stringify(sceneDefinition.body.data.scene ?? sceneDefinition.body.data),
      'utf8'
    );
    expect(sceneBytes).toBeLessThan(config.publishLimits.maxSceneDefinitionBytes);
    expect(indexBytesPerScene).toBeLessThan(sceneBytes);
  }, 180_000);

  it('bounds the analytics query window and answers inside it', async () => {
    const owner = await registerIdentity(context.app, 'analytics-budget');
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'Analytics project' })
      .expect(201);
    const projectId = created.body.data.project.id as string;

    const to = new Date();
    const withinRange = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
    const beyondRange = new Date(
      to.getTime() - (config.analyticsMaxRangeDays + 5) * 24 * 60 * 60 * 1000
    );

    const routes = ['summary', 'timeseries', 'scenes', 'interactions', 'video', 'reliability'];
    for (const route of routes) {
      const rejected = await request(context.app)
        .get(`/api/v1/projects/${projectId}/analytics/${route}`)
        .query({ from: beyondRange.toISOString(), to: to.toISOString() })
        .set(auth);
      expect(rejected.status, `${route} over-long range`).toBe(422);
      expect(rejected.body.error.code, `${route} over-long range`).toBe('DATE_RANGE_TOO_LARGE');
      expect(rejected.body.error.details.maximumDays).toBe(config.analyticsMaxRangeDays);
    }

    const startedAt = Date.now();
    for (const route of routes) {
      const accepted = await request(context.app)
        .get(`/api/v1/projects/${projectId}/analytics/${route}`)
        .query({ from: withinRange.toISOString(), to: to.toISOString() })
        .set(auth);
      expect(accepted.status, `${route} in-range`).toBe(200);
      expect(accepted.body.data.range.from).toBe(withinRange.toISOString());
    }
    // Every creator-facing analytics view together stays inside one budget, so
    // an unbounded scan cannot hide behind a single endpoint looking fine.
    expect(Date.now() - startedAt).toBeLessThan(10_000);

    // A range with no explicit bounds still resolves to a bounded default.
    const defaulted = await request(context.app)
      .get(`/api/v1/projects/${projectId}/analytics/summary`)
      .set(auth)
      .expect(200);
    const range = defaulted.body.data.range;
    const spanDays = (Date.parse(range.to) - Date.parse(range.from)) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeLessThanOrEqual(config.analyticsMaxRangeDays);
  }, 120_000);

  it('absorbs a telemetry burst without partial writes or duplicate events', async () => {
    const owner = await registerIdentity(context.app, 'ingest-burst');
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'Burst project' })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 1, name: 'Lobby', panoramaAssetId: seeded.assetId })
      .expect(201);
    const slug = 'sprint04-burst';
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send({ revision: 2, slug, visibility: 'public' })
      .expect(201);

    const manifestResponse = await request(context.app).get(`/view/${slug}/manifest`).expect(200);
    const manifest = manifestResponse.body.data.manifest;
    const telemetryToken = manifest.telemetry.ingestToken as string;
    const viewerIntegrationVersion = manifest.viewerIntegrationVersion as string;

    const makeEvent = (index: number) => ({
      eventId: randomUUID(),
      eventName: 'hotspot_clicked' as const,
      experienceId: projectId,
      publicationRevision: 1,
      viewerIntegrationVersion,
      sessionId: `session-${index % 8}-${'0'.repeat(8)}`,
      occurredAt: new Date().toISOString(),
      payload: { hotspotId: randomUUID(), sceneId: randomUUID() }
    });

    // The documented batch ceiling is enforced rather than silently truncated.
    const oversized = await request(context.app)
      .post('/api/v1/runtime/events')
      .set('x-telemetry-token', telemetryToken)
      .send({ events: Array.from({ length: 101 }, (_unused, index) => makeEvent(index)) });
    expect(oversized.status).toBe(422);

    const batches = Array.from(
      { length: 12 },
      () => Array.from({ length: 50 }, (_unused, index) => makeEvent(index))
    );
    const responses = await Promise.all(batches.map((events) => request(context.app)
      .post('/api/v1/runtime/events')
      .set('x-telemetry-token', telemetryToken)
      .send({ events })));

    // Under burst every request either lands or is shed deliberately. A 5xx
    // would mean the ingest path fails under load instead of pushing back.
    for (const response of responses) {
      expect([202, 429]).toContain(response.status);
      if (response.status === 429) expect(response.body.error.code).toBe('RATE_LIMITED');
    }
    const acceptedBatches = responses.filter((response) => response.status === 202);
    expect(acceptedBatches.length).toBeGreaterThan(0);
    const acceptedEvents = acceptedBatches.reduce(
      (total, response) => total + (response.body.data.accepted as number),
      0
    );
    expect(acceptedEvents).toBe(acceptedBatches.length * 50);

    // Replaying an accepted batch is idempotent: a retrying player must not
    // double-count its own engagement.
    const replayed = await request(context.app)
      .post('/api/v1/runtime/events')
      .set('x-telemetry-token', telemetryToken)
      .send({ events: batches[0]! });
    expect([202, 429]).toContain(replayed.status);
    if (replayed.status === 202) {
      expect(replayed.body.data.accepted).toBe(0);
      expect(replayed.body.data.duplicates).toBe(50);
    }

    const { RuntimeEvent } = await import('../../apps/api/src/models');
    const stored = await RuntimeEvent.count({ where: { experienceId: projectId } });
    expect(stored).toBe(acceptedEvents);
  }, 120_000);
});
