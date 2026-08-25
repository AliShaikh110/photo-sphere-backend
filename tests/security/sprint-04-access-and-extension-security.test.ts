import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedReadyPanorama } from '../fixtures/ready-panorama';
import { bearer, registerIdentity, type TestIdentity } from '../helpers/api-client';
import { generatedEquirectangularJpeg } from '../helpers/image-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';

/**
 * Sprint 04 §22 names the security cases this sprint has to prove: private
 * scene/media bypass, role escalation, unauthorized analytics, template asset
 * leakage and custom-extension payload validation.
 */
describe.sequential('Sprint 04 — access, extension and analytics security', () => {
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
    owner: TestIdentity;
    auth: { Authorization: string };
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
      owner,
      auth,
      projectId,
      assetId: seeded.assetId,
      sceneId: scene.body.data.scene.id as string
    };
  }

  it('does not let a stranger reach a private publication through any delivery route', async () => {
    const { auth, projectId } = await seedProject('private-owner');
    const published = await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `private-${randomUUID()}`)
      .send({ revision: 2, slug: 'sprint04-private', visibility: 'private' })
      .expect(201);
    const publicationId = published.body.data.publication.id as string;

    const ownerManifest = await request(context.app)
      .get('/view/sprint04-private/manifest')
      .set(auth)
      .expect(200);
    const mediaUrl = ownerManifest.body.data.manifest.scenes[0].panorama.primary.url as string;
    const sceneId = ownerManifest.body.data.manifest.scenes[0].id as string;

    const stranger = await registerIdentity(context.app, 'private-stranger');
    const strangerAuth = bearer(stranger.accessToken);

    // Anonymous and cross-account access are both refused on every surface.
    for (const path of [
      '/view/sprint04-private/manifest',
      `/view/sprint04-private/scenes/${sceneId}`,
      '/view/sprint04-private/revisions/1/scene-index',
      `/view/sprint04-private/revisions/1/scenes/${sceneId}`
    ]) {
      const anonymous = await request(context.app).get(path);
      expect(anonymous.status, `anonymous ${path}`).toBeGreaterThanOrEqual(401);
      expect(anonymous.status, `anonymous ${path}`).toBeLessThan(500);

      const foreign = await request(context.app).get(path).set(strangerAuth);
      expect(foreign.status, `stranger ${path}`).toBeGreaterThanOrEqual(401);
      expect(foreign.status, `stranger ${path}`).toBeLessThan(500);
    }

    // Private media is delivered by a short-lived signed URL. Possession of the
    // signature is the grant, so what has to fail is using the derivative
    // without one, or with one that has been altered.
    const [mediaPath, mediaQuery] = mediaUrl.split('?');
    expect(mediaQuery, 'private media must be signed').toMatch(/token=/);
    await request(context.app).get(mediaPath!).expect(403);
    await request(context.app).get(mediaPath!).set(strangerAuth).expect(403);
    const tampered = await request(context.app).get(`${mediaPath}?${mediaQuery!.slice(0, -2)}xx`);
    expect(tampered.status, 'altered media signature must be refused').toBeGreaterThanOrEqual(401);
    expect(tampered.status).toBeLessThan(500);

    // Nor can a stranger enumerate the project behind the publication. A user
    // with no access at all is answered as if the project did not exist.
    await request(context.app)
      .get(`/api/v1/projects/${projectId}/publications`)
      .set(strangerAuth)
      .expect(404);
    expect(publicationId).toBeDefined();
  }, 120_000);

  it('enforces project roles on the server and refuses escalation by a viewer', async () => {
    const { owner, auth, projectId } = await seedProject('role-owner');
    const viewer = await registerIdentity(context.app, 'role-viewer');
    const viewerAuth = bearer(viewer.accessToken);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/access`)
      .set(auth)
      .send({ email: viewer.email, role: 'viewer' })
      .expect(201);

    // A viewer reads but cannot author.
    await request(context.app).get(`/api/v1/projects/${projectId}`).set(viewerAuth).expect(200);
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(viewerAuth)
      .send({ revision: 2, name: 'Renamed by viewer' })
      .expect(403);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(viewerAuth)
      .send({ projectRevision: 2, name: 'Viewer scene' })
      .expect(403);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(viewerAuth)
      .set('Idempotency-Key', `viewer-${randomUUID()}`)
      .send({ revision: 2, slug: 'viewer-publish', visibility: 'public' })
      .expect(403);

    // And cannot promote itself, nor grant anyone else access.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/access`)
      .set(viewerAuth)
      .send({ email: viewer.email, role: 'admin' })
      .expect(403);

    // The owner's own grant is unchanged by the attempt.
    const grants = await request(context.app)
      .get(`/api/v1/projects/${projectId}/access`)
      .set(auth)
      .expect(200);
    const viewerGrant = (grants.body.data.access as { role: string; userId?: string }[])
      .find((grant) => grant.userId === viewer.id);
    expect(viewerGrant?.role).toBe('viewer');
    expect(owner.id).not.toBe(viewer.id);
  }, 120_000);

  it('keeps creator analytics behind project authorization', async () => {
    const { auth, projectId } = await seedProject('analytics-owner');
    const stranger = await registerIdentity(context.app, 'analytics-stranger');
    const strangerAuth = bearer(stranger.accessToken);

    const surfaces = [
      'summary',
      'timeseries',
      'scenes',
      'interactions',
      'video',
      'reliability'
    ];
    for (const surface of surfaces) {
      const path = `/api/v1/projects/${projectId}/analytics/${surface}`;
      await request(context.app).get(path).expect(401);
      // A user with no access at all is answered as if the project did not
      // exist, so analytics cannot be used to discover projects.
      await request(context.app).get(path).set(strangerAuth).expect(404);
      await request(context.app).get(path).set(auth).expect(200);
    }

    // Date ranges are bounded rather than accepting an unbounded scan.
    await request(context.app)
      .get(`/api/v1/projects/${projectId}/analytics/timeseries`)
      .query({ from: '1970-01-01T00:00:00Z', to: '2999-01-01T00:00:00Z' })
      .set(auth)
      .expect(422);
  }, 120_000);

  it('validates custom extension payloads against the registered schema and allowlist', async () => {
    const { auth, projectId, sceneId } = await seedProject('extension-owner');

    // An unregistered extension can never be attached, so a publication can
    // never name client code the platform has not allow-listed.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
      .set(auth)
      .send({
        projectRevision: 2,
        geometry: {
          kind: 'custom',
          extensionId: 'attacker.arbitrary-code',
          extensionVersion: '1.0.0',
          payload: { run: 'anything' }
        }
      })
      .expect(422);

    // A registered extension with a payload that violates its schema is refused.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
      .set(auth)
      .send({
        projectRevision: 2,
        geometry: {
          kind: 'custom',
          extensionId: 'platform.measurement-label',
          extensionVersion: '1.0.0',
          payload: { label: 'Span', value: 'not-a-number', unit: 'm' }
        }
      })
      .expect(422);

    // An unknown field is rejected too: the schema disallows additional fields.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
      .set(auth)
      .send({
        projectRevision: 2,
        geometry: {
          kind: 'custom',
          extensionId: 'platform.measurement-label',
          extensionVersion: '1.0.0',
          payload: { label: 'Span', value: 3, unit: 'm', smuggled: '<script>x</script>' }
        }
      })
      .expect(422);

    // A conforming payload is accepted and its version is pinned on publish.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes/${sceneId}/overlays`)
      .set(auth)
      .send({
        projectRevision: 2,
        geometry: {
          kind: 'custom',
          extensionId: 'platform.measurement-label',
          extensionVersion: '1.0.0',
          payload: { label: 'Span', value: 3, unit: 'm' }
        }
      })
      .expect(201);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `extension-${randomUUID()}`)
      .send({ revision: 3, slug: 'sprint04-extension', visibility: 'public' })
      .expect(201);

    const manifest = await request(context.app)
      .get('/view/sprint04-extension/manifest')
      .expect(200);
    expect(manifest.body.data.manifest.pinnedExtensions)
      .toMatchObject({ 'platform.measurement-label': '1.0.0' });
  }, 120_000);

  it('does not leak another creator private asset through template instantiation', async () => {
    const victim = await seedProject('template-victim');
    const attacker = await registerIdentity(context.app, 'template-attacker');
    const attackerAuth = bearer(attacker.accessToken);

    const templates = await request(context.app)
      .get('/api/v1/templates')
      .set(attackerAuth)
      .expect(200);
    const available = templates.body.data.templates as { id: string }[];

    for (const template of available) {
      const instantiated = await request(context.app)
        .post(`/api/v1/templates/${template.id}/instantiate`)
        .set(attackerAuth)
        .send({ name: 'Copied experience' })
        .expect(201);
      const newProjectId = instantiated.body.data.project.id as string;

      // A fresh project, never the source project or the victim's.
      expect(newProjectId).not.toBe(victim.projectId);

      const serialized = JSON.stringify(instantiated.body);
      expect(serialized).not.toContain(victim.assetId);
      expect(serialized).not.toContain(victim.projectId);

      // And the attacker still cannot read the victim's project or asset.
      await request(context.app)
        .get(`/api/v1/projects/${victim.projectId}`)
        .set(attackerAuth)
        .expect(403);
      await request(context.app)
        .get(`/api/v1/assets/${victim.assetId}`)
        .set(attackerAuth)
        .expect(403);
    }
  }, 120_000);
});
