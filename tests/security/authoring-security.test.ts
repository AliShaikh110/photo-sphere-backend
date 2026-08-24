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

describe.sequential('Sprint 01 authoring security boundaries', () => {
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

  it('sanitizes authored HTML and enforces the centralized URL policy at the API boundary', async () => {
    const owner = await registerIdentity(context.app, 'security-author');
    const auth = bearer(owner.accessToken);

    await request(context.app)
      .post('/api/v1/auth/register')
      .send({
        email: `empty-name-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
        displayName: '<script></script>'
      })
      .expect(422)
      .expect(({ body }) => expect(body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        path: 'displayName'
      }));

    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({
        name: 'Security Tour',
        settings: {
          information: {
            description: '<svg onload=alert(1)>Description</svg>',
            bodyHtml: '<p style="background:url(javascript:alert(1))" onclick="steal()">Safe</p>'
              + '<a href="javascript:alert(1)" target="_blank">unsafe link</a>'
              + '<a href="/help" target="_blank">help</a>',
            externalUrl: '/internal/help'
          }
        },
        branding: {
          welcomeMessage: '<strong>Welcome</strong><iframe src="https://evil.example"></iframe>'
        }
      })
      .expect(201);
    const project = created.body.data.project as {
      id: string;
      revision: number;
      settings: { information: { description: string; bodyHtml: string; externalUrl: string } };
      branding: { welcomeMessage: string };
    };
    expect(project.settings.information.description).toBe('Description');
    expect(project.settings.information.bodyHtml).toBe(
      '<p>Safe</p><a>unsafe link</a><a href="/help" target="_blank" rel="noopener noreferrer nofollow">help</a>'
    );
    expect(project.settings.information.externalUrl).toBe('/internal/help');
    expect(project.branding.welcomeMessage).toBe('<strong>Welcome</strong>');

    for (const unsafeUrl of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://example.test/insecure',
      '//evil.example/path'
    ]) {
      await request(context.app)
        .patch(`/api/v1/projects/${project.id}`)
        .set(auth)
        .send({ revision: project.revision, settings: { information: { externalUrl: unsafeUrl } } })
        .expect(422)
        .expect(({ body }) => expect(body.error.code).toMatch(/^URL_/));
    }

    await request(context.app)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('INVALID_JSON'));
  });

  it('does not authorize private media when its UUID appears only in authored manifest JSON', async () => {
    const victim = await registerIdentity(context.app, 'private-owner');
    const attacker = await registerIdentity(context.app, 'public-attacker');

    const victimProjectResponse = await request(context.app)
      .post('/api/v1/projects')
      .set(bearer(victim.accessToken))
      .send({ name: 'Private Tour' })
      .expect(201);
    const victimProjectId = victimProjectResponse.body.data.project.id as string;
    const victimPanorama = await seedReadyPanorama({
      ownerId: victim.id,
      projectId: victimProjectId,
      bytes: panorama
    });
    await request(context.app)
      .post(`/api/v1/projects/${victimProjectId}/scenes`)
      .set(bearer(victim.accessToken))
      .send({ projectRevision: 1, name: 'Private Scene', panoramaAssetId: victimPanorama.assetId })
      .expect(201);
    await request(context.app)
      .post(`/api/v1/projects/${victimProjectId}/publish`)
      .set(bearer(victim.accessToken))
      .set('Idempotency-Key', `private-${randomUUID()}`)
      .send({ revision: 2, slug: 'private-security-tour', visibility: 'private' })
      .expect(201);

    await request(context.app)
      .get(`/api/v1/media/${victimPanorama.standardWebDerivativeId}`)
      .expect(403);
    await request(context.app)
      .get(`/api/v1/media/${victimPanorama.standardWebDerivativeId}`)
      .set(bearer(victim.accessToken))
      .expect(200);

    const attackerProjectResponse = await request(context.app)
      .post('/api/v1/projects')
      .set(bearer(attacker.accessToken))
      .send({ name: 'Attacker Public Tour' })
      .expect(201);
    const attackerProjectId = attackerProjectResponse.body.data.project.id as string;
    const attackerPanorama = await seedReadyPanorama({
      ownerId: attacker.id,
      projectId: attackerProjectId,
      bytes: panorama
    });
    await request(context.app)
      .post(`/api/v1/projects/${attackerProjectId}/scenes`)
      .set(bearer(attacker.accessToken))
      .send({
        projectRevision: 1,
        name: 'Public Scene',
        panoramaAssetId: attackerPanorama.assetId
      })
      .expect(201);
    await request(context.app)
      .post(`/api/v1/projects/${attackerProjectId}/publish`)
      .set(bearer(attacker.accessToken))
      .set('Idempotency-Key', `public-${randomUUID()}`)
      .send({ revision: 2, slug: 'attacker-public-tour', visibility: 'public' })
      .expect(201);

    await request(context.app)
      .get(`/api/v1/media/${attackerPanorama.standardWebDerivativeId}`)
      .expect(403);
    await request(context.app)
      .get(`/api/v1/publications/${attackerProjectId}/1/media/${attackerPanorama.standardWebDerivativeId}`)
      .expect(200)
      .expect('Cache-Control', /public/);
    // A derivative UUID cannot be substituted into another publication-scoped URL.
    await request(context.app)
      .get(`/api/v1/publications/${attackerProjectId}/1/media/${victimPanorama.standardWebDerivativeId}`)
      .expect(403);
    await request(context.app)
      .get(`/api/v1/media/${victimPanorama.standardWebDerivativeId}`)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('MEDIA_ACCESS_DENIED'));
  }, 60_000);

  it('keeps renderer configuration and unsupported scene bags out of runtime manifests', async () => {
    const owner = await registerIdentity(context.app, 'capability-author');
    const auth = bearer(owner.accessToken);
    const created = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ name: 'Capability Boundary Tour' })
      .expect(201);
    const projectId = created.body.data.project.id as string;
    const seeded = await seedReadyPanorama({ ownerId: owner.id, projectId, bytes: panorama });

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({
        projectRevision: 1,
        name: 'Renderer Smuggling Attempt',
        panoramaAssetId: seeded.assetId,
        runtimeHints: { viewerConfig: { plugins: ['unsafe-runtime-plugin'] } }
      })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_FAILED'));

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({
        projectRevision: 1,
        name: 'Future Overlay',
        panoramaAssetId: seeded.assetId,
        overlays: [{ html: '<img src=x onerror=steal()>' }]
      })
      .expect(201);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/validate`)
      .set(auth)
      .send({ revision: 2 })
      .expect(200)
      .expect(({ body }) => expect(body.data).toMatchObject({
        valid: false,
        issues: [expect.objectContaining({
          code: 'CAPABILITY_UNSUPPORTED',
          path: 'scenes[0].overlays'
        })]
      }));
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/preview-manifest`)
      .set(auth)
      .send({ revision: 2 })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('EXPERIENCE_VALIDATION_FAILED'));
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `unsupported-${randomUUID()}`)
      .send({ revision: 2, slug: 'unsupported-runtime-bag', visibility: 'public' })
      .expect(422);

    const { Publication } = await import('../../src/models');
    expect(await Publication.findOne({ where: { projectId } })).toMatchObject({
      status: 'publish_failed',
      isCurrent: false,
      compiledManifest: null
    });
  }, 60_000);
});
