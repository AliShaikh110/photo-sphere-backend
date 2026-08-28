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

/** Markup and script that must never survive a write. */
const HOSTILE = '<img src=x onerror=steal()>Text<script>alert(1)</script>';

function expectSafe(value: unknown, field: string): void {
  expect(typeof value, field).toBe('string');
  const text = value as string;
  expect(text, field).not.toContain('<script');
  expect(text, field).not.toContain('onerror');
  expect(text, field).not.toContain('<img');
  expect(text, field).toContain('Text');
}

/**
 * The compiler is a shared, browser-runnable package, so it can never be the
 * only place a security control is applied. Canonical data has to be safe
 * where it is written; the compiler sanitizing again at publish is defence in
 * depth, not the control itself.
 *
 * Every assertion here reads back through the authoring routes, which never
 * touch the compiler, so a value that comes back safe was stored safe.
 */
describe.sequential('write-time sanitization', () => {
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

  it('stores canonical authoring text already sanitized, without the compiler', async () => {
    const owner = await registerIdentity(context.app, 'write-sanitization');
    const auth = bearer(owner.accessToken);

    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({
        name: `${HOSTILE} Tour`,
        settings: {
          appearance: { hotspotStyle: HOSTILE, typography: HOSTILE },
          information: { title: HOSTILE, description: HOSTILE, bodyHtml: HOSTILE }
        },
        branding: { companyName: HOSTILE, welcomeMessage: HOSTILE, loadingMessage: HOSTILE }
      })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });

    const scene = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 1, name: `${HOSTILE} Lobby`, panoramaAssetId: seeded.assetId })
      .expect(201);
    const sceneId = scene.body.data.scene.id as string;

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
      .set(auth)
      .send({
        projectRevision: 2,
        geometry: { kind: 'point' },
        position: { coordinateSystem: 'spherical_degrees', longitudeDegrees: 5, latitudeDegrees: 5 },
        appearance: { label: HOSTILE },
        content: { title: HOSTILE, description: HOSTILE, bodyHtml: HOSTILE, tooltip: HOSTILE },
        action: { kind: 'showInformation' }
      })
      .expect(201);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
      .set(auth)
      .send({
        projectRevision: 3,
        name: `${HOSTILE} Zone`,
        geometry: {
          kind: 'polygon',
          vertices: [
            { coordinateSystem: 'spherical_degrees', longitudeDegrees: 0, latitudeDegrees: 0 },
            { coordinateSystem: 'spherical_degrees', longitudeDegrees: 10, latitudeDegrees: 0 },
            { coordinateSystem: 'spherical_degrees', longitudeDegrees: 10, latitudeDegrees: 10 }
          ]
        },
        appearance: { label: HOSTILE },
        content: { title: HOSTILE, bodyHtml: HOSTILE }
      })
      .expect(201);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/plans`)
      .set(auth)
      .send({
        projectRevision: 4,
        name: `${HOSTILE} Ground floor`,
        coordinateSystem: 'plan_normalized'
      })
      .expect(201);

    // Everything below is read through the authoring routes, which never
    // compile anything.
    const project = await request(context.app)
      .get(`/api/v1/projects/${projectId}`)
      .set(auth)
      .expect(200);
    const stored = project.body.data.project as {
      name: string;
      settings: {
        appearance: { hotspotStyle: string; typography: string };
        information: { title: string; description: string; bodyHtml: string };
      };
      branding: { companyName: string; welcomeMessage: string; loadingMessage: string };
    };
    expectSafe(stored.name, 'project.name');
    expectSafe(stored.settings.appearance.hotspotStyle, 'settings.appearance.hotspotStyle');
    expectSafe(stored.settings.appearance.typography, 'settings.appearance.typography');
    expectSafe(stored.settings.information.title, 'settings.information.title');
    expectSafe(stored.settings.information.description, 'settings.information.description');
    expectSafe(stored.settings.information.bodyHtml, 'settings.information.bodyHtml');
    expectSafe(stored.branding.companyName, 'branding.companyName');
    expectSafe(stored.branding.welcomeMessage, 'branding.welcomeMessage');
    expectSafe(stored.branding.loadingMessage, 'branding.loadingMessage');

    const scenes = await request(context.app)
      .get(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .expect(200);
    const storedScene = scenes.body.data.scenes[0] as {
      name: string;
      hotspots: {
        appearance: { label: string };
        content: { title: string; description: string; bodyHtml: string; tooltip: string };
      }[];
      overlays: {
        name: string;
        appearance: { label: string };
        content: { title: string; bodyHtml: string };
      }[];
    };
    expectSafe(storedScene.name, 'scene.name');
    const hotspot = storedScene.hotspots[0]!;
    expectSafe(hotspot.appearance.label, 'hotspot.appearance.label');
    expectSafe(hotspot.content.title, 'hotspot.content.title');
    expectSafe(hotspot.content.description, 'hotspot.content.description');
    expectSafe(hotspot.content.bodyHtml, 'hotspot.content.bodyHtml');
    expectSafe(hotspot.content.tooltip, 'hotspot.content.tooltip');
    const overlay = storedScene.overlays[0]!;
    expectSafe(overlay.name, 'overlay.name');
    expectSafe(overlay.appearance.label, 'overlay.appearance.label');
    expectSafe(overlay.content.title, 'overlay.content.title');
    expectSafe(overlay.content.bodyHtml, 'overlay.content.bodyHtml');

    const plans = await request(context.app)
      .get(`/api/v1/projects/${projectId}/plans`)
      .set(auth)
      .expect(200);
    expectSafe((plans.body.data.plans[0] as { name: string }).name, 'plan.name');
  }, 90_000);

  it('refuses an unsafe URL at the write boundary rather than at publish', async () => {
    const owner = await registerIdentity(context.app, 'write-url-policy');
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'URL policy' })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });
    const scene = await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 1, name: 'Lobby', panoramaAssetId: seeded.assetId })
      .expect(201);
    const sceneId = scene.body.data.scene.id as string;

    for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', '//evil.example']) {
      await request(context.app)
        .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/hotspots`)
        .set(auth)
        .send({
          projectRevision: 2,
          geometry: { kind: 'point' },
          position: {
            coordinateSystem: 'spherical_degrees',
            longitudeDegrees: 0,
            latitudeDegrees: 0
          },
          action: { kind: 'openUrl', url }
        })
        .expect(422)
        .expect(({ body }) => expect(body.error.code).toMatch(/^URL_/));
    }

    // A rejected write leaves nothing behind for the compiler to have to catch.
    await request(context.app)
      .get(`/api/v1/projects/${projectId}/scenes/${sceneId}`)
      .set(auth)
      .expect(200)
      .expect(({ body }) => expect(body.data.scene.hotspots).toHaveLength(0));
  }, 90_000);
});
