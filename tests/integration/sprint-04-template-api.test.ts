import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedReadyPanorama } from '../fixtures/ready-panorama';
import { bearer, registerIdentity } from '../helpers/api-client';
import { generatedEquirectangularJpeg } from '../helpers/image-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';

/**
 * Templates carry a canonical Experience blueprint, so instantiation is the
 * point where every stored interaction contract has to survive a round trip
 * into a brand new project. The custom-geometry case is the strictest: the
 * hotspot's pinned extension is enforced by a database constraint, so losing
 * it turns a product action into an unexplained failure.
 */
describe.sequential('Sprint 04 — templates and instantiation', () => {
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

  const vertex = (longitudeDegrees: number, latitudeDegrees: number) => ({
    coordinateSystem: 'spherical_degrees' as const,
    longitudeDegrees,
    latitudeDegrees
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

  async function instantiate(
    auth: { Authorization: string },
    templateId: string,
    name: string
  ): Promise<request.Response> {
    return request(context.app)
      .post(`/api/v1/templates/${templateId}/instantiate`)
      .set(auth)
      .set('Idempotency-Key', randomUUID())
      .send({ name });
  }

  it('instantiates a template whose hotspot pins a custom extension', async () => {
    const { auth, projectId, sceneId } = await seedProject('template-custom');

    const customGeometry = {
      kind: 'custom',
      extensionId: 'platform.measurement-label',
      extensionVersion: '1.0.0',
      payload: { label: 'Ceiling height', value: 3.2, unit: 'm' }
    };
    const sourceHotspot = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: 2,
        position: vertex(10, 5),
        geometry: customGeometry,
        action: { kind: 'showInformation' },
        content: { title: 'Atrium' }
      })
      .expect(201);
    const sourceHotspotId = sourceHotspot.body.data.hotspot.id as string;

    const template = await request(context.app)
      .post('/api/v1/templates')
      .set(auth)
      .send({ projectId, name: 'Measured lobby' })
      .expect(201);
    const templateId = template.body.data.template.id as string;

    // The regression: this used to fail the hotspots_custom_extension_check
    // constraint and surface as an opaque 500.
    const instantiated = await instantiate(auth, templateId, 'Measured lobby copy');
    expect(instantiated.status).toBe(201);

    const newProjectId = instantiated.body.data.project.id as string;
    expect(newProjectId).not.toBe(projectId);
    expect(instantiated.body.data.project.revision).toBe(1);

    const scenes = await request(context.app)
      .get(`/api/v1/projects/${newProjectId}/scenes`)
      .set(auth)
      .expect(200);
    const newSceneId = scenes.body.data.scenes[0].id as string;
    expect(newSceneId).not.toBe(sceneId);

    const project = await request(context.app)
      .get(`/api/v1/projects/${newProjectId}`)
      .set(auth)
      .expect(200);
    const newScene = project.body.data.project.scenes[0];
    const copiedHotspot = newScene.hotspots[0];

    // Fresh mutable identity, identical canonical interaction contract.
    expect(copiedHotspot.id).not.toBe(sourceHotspotId);
    expect(copiedHotspot.geometry).toEqual(customGeometry);
    expect(copiedHotspot.content.title).toBe('Atrium');

    // The denormalized extension pair must agree with the geometry, which is
    // what the database constraint exists to guarantee.
    const { Hotspot } = await import('../../src/models');
    const stored = await Hotspot.findByPk(copiedHotspot.id as string);
    expect(stored?.geometryKind).toBe('custom');
    expect(stored?.extensionId).toBe('platform.measurement-label');
    expect(stored?.extensionVersion).toBe('1.0.0');
  }, 120_000);

  it('copies a full experience into a clean project with fresh mutable ids', async () => {
    const { auth, projectId, sceneId, assetId } = await seedProject('template-full');

    const secondScene = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 2, name: 'Pool', panoramaAssetId: assetId })
      .expect(201);
    const secondSceneId = secondScene.body.data.scene.id as string;

    const hotspot = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: 3,
        position: vertex(0, 0),
        geometry: { kind: 'point' },
        action: { kind: 'goToScene', sceneId: secondSceneId }
      })
      .expect(201);
    const hotspotId = hotspot.body.data.hotspot.id as string;

    const overlay = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
      .set(auth)
      .send({
        projectRevision: 4,
        geometry: { kind: 'polygon', vertices: [vertex(0, 0), vertex(10, 0), vertex(10, 10)] },
        name: 'Reception desk'
      })
      .expect(201);
    const overlayId = overlay.body.data.overlay.id as string;

    const plan = await request(context.app)
      .post(`/api/v1/projects/${projectId}/plans`)
      .set(auth)
      .send({ projectRevision: 5, name: 'Ground floor', coordinateSystem: 'plan_normalized' })
      .expect(201);
    const planId = plan.body.data.plan.id as string;

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .send({
        projectRevision: 6,
        spatialData: {
          coordinateSystem: 'plan_normalized',
          planId,
          mapX: 0.25,
          mapY: 0.75
        }
      })
      .expect(200);

    const template = await request(context.app)
      .post('/api/v1/templates')
      .set(auth)
      .send({ projectId, name: 'Hotel blueprint', description: 'Two scenes and a plan' })
      .expect(201);
    const templateId = template.body.data.template.id as string;
    expect(template.body.data.template.blueprint.sceneCount).toBe(2);
    expect(template.body.data.template.blueprint.planCount).toBe(1);

    const instantiated = await instantiate(auth, templateId, 'Hotel copy');
    expect(instantiated.status).toBe(201);
    const newProjectId = instantiated.body.data.project.id as string;
    expect(instantiated.body.data.project.name).toBe('Hotel copy');

    const project = await request(context.app)
      .get(`/api/v1/projects/${newProjectId}`)
      .set(auth)
      .expect(200);
    const copied = project.body.data.project;
    expect(copied.scenes).toHaveLength(2);

    const copiedScene = copied.scenes[0];
    const copiedPlanId = copiedScene.spatialData.planId as string;
    expect(copiedScene.id).not.toBe(sceneId);
    expect(copiedScene.hotspots[0].id).not.toBe(hotspotId);
    expect(copiedScene.overlays[0].id).not.toBe(overlayId);
    expect(copiedScene.overlays[0].name).toBe('Reception desk');

    // Every internal reference is rewritten to the new project's own ids.
    expect(copiedPlanId).not.toBe(planId);
    const copiedPlans = await request(context.app)
      .get(`/api/v1/projects/${newProjectId}/plans`)
      .set(auth)
      .expect(200);
    expect(copiedPlans.body.data.plans.map((entry: { id: string }) => entry.id))
      .toContain(copiedPlanId);

    // A scene link must point inside the new project, never back at the
    // project the template was captured from.
    const sceneAction = copiedScene.hotspots[0].action as { kind: string; sceneId?: string };
    expect(sceneAction.kind).toBe('goToScene');
    expect(sceneAction.sceneId).toBe(copied.scenes[1].id);
    expect(sceneAction.sceneId).not.toBe(secondSceneId);
    for (const sourceId of [projectId, sceneId, secondSceneId, hotspotId, overlayId, planId]) {
      expect(JSON.stringify(copied)).not.toContain(sourceId);
    }

    // The copy must be publishable on its own, with no dangling references.
    const validated = await request(context.app)
      .post(`/api/v1/projects/${newProjectId}/validate`)
      .set(auth)
      .send({ revision: copied.revision })
      .expect(200);
    const referenceIssues = (validated.body.data.issues as { code: string }[])
      .filter((entry) => entry.code === 'REFERENCE_NOT_FOUND');
    expect(referenceIssues).toEqual([]);

    // The copy is an ordinary editable draft, not a published or locked one.
    expect(copied.revision).toBe(1);
    expect(copied.publication ?? {}).not.toHaveProperty('slug');
  }, 120_000);

  it('omits source media by default and never references another creator asset', async () => {
    const author = await seedProject('template-author');
    const template = await request(context.app)
      .post('/api/v1/templates')
      .set(author.auth)
      .send({ projectId: author.projectId, name: 'Shared layout', visibility: 'private' })
      .expect(201);
    const templateId = template.body.data.template.id as string;

    // A private template belongs to its author: nobody else can read or use it.
    const stranger = await registerIdentity(context.app, 'template-stranger');
    const strangerAuth = bearer(stranger.accessToken);
    await request(context.app)
      .get(`/api/v1/templates/${templateId}`)
      .set(strangerAuth)
      .expect(404);
    const denied = await instantiate(strangerAuth, templateId, 'Stolen layout');
    expect(denied.status).toBe(404);

    // The author's own copy keeps the structure but drops the source panorama
    // under the default `omit` asset policy.
    const instantiated = await instantiate(author.auth, templateId, 'Layout copy');
    expect(instantiated.status).toBe(201);
    expect(instantiated.body.data.assetPolicy).toBe('omit');

    const newProjectId = instantiated.body.data.project.id as string;
    const project = await request(context.app)
      .get(`/api/v1/projects/${newProjectId}`)
      .set(author.auth)
      .expect(200);
    expect(project.body.data.project.scenes[0].panoramaAssetId).toBeNull();
    expect(JSON.stringify(project.body.data)).not.toContain(author.assetId);
  }, 120_000);

  it('replays a retried instantiation instead of creating a second project', async () => {
    const { auth, projectId } = await seedProject('template-idempotent');
    const template = await request(context.app)
      .post('/api/v1/templates')
      .set(auth)
      .send({ projectId, name: 'Retryable' })
      .expect(201);
    const templateId = template.body.data.template.id as string;

    const key = randomUUID();
    const send = () => request(context.app)
      .post(`/api/v1/templates/${templateId}/instantiate`)
      .set(auth)
      .set('Idempotency-Key', key)
      .send({ name: 'Retryable copy' });

    const first = await send();
    expect(first.status).toBe(201);
    expect(first.headers['idempotency-replayed']).toBe('false');

    const second = await send();
    expect(second.status).toBe(201);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(second.body.data.project.id).toBe(first.body.data.project.id);

    const projects = await request(context.app).get('/api/v1/projects').set(auth).expect(200);
    const copies = (projects.body.data.projects as { name: string }[])
      .filter((entry) => entry.name === 'Retryable copy');
    expect(copies).toHaveLength(1);
  }, 120_000);
});
