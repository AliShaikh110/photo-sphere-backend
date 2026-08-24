import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bearer, registerIdentity } from '../helpers/api-client';
import { buildHandheldSafe360Mp4, buildMp4Fixture } from '../helpers/video-fixture';
import { generatedEquirectangularJpeg } from '../helpers/image-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';

describe.sequential('Sprint 03 timed-content security boundaries', () => {
  let context: IntegrationTestContext;
  let video: Buffer;

  beforeAll(async () => {
    context = await startIntegrationTestContext();
    video = buildHandheldSafe360Mp4();
  }, 60_000);

  afterAll(async () => {
    await context?.stop();
  }, 60_000);

  beforeEach(async () => {
    await truncateApplicationData(context);
  });

  async function readyVideoProject(label: string): Promise<{
    token: string;
    projectId: string;
    assetId: string;
    revision: number;
  }> {
    const owner = await registerIdentity(context.app, label);
    const auth = bearer(owner.accessToken);
    const project = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ type: 'video360', name: 'Secure Video' })
      .expect(201);
    const projectId = project.body.data.project.id as string;

    const session = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({
        projectId,
        mediaType: 'video360',
        filename: 'secure.mp4',
        mimeType: 'video/mp4',
        sizeBytes: video.byteLength
      })
      .expect(201);
    const assetId = session.body.data.asset.id as string;
    await request(context.app)
      .put(session.body.data.upload.url as string)
      .set(auth)
      .set('Content-Type', 'video/mp4')
      .send(video)
      .expect(200);
    await request(context.app)
      .post(`/api/v1/assets/${assetId}/complete`)
      .set(auth)
      .set('Idempotency-Key', `complete-${randomUUID()}`)
      .send({ uploadSessionId: session.body.data.upload.sessionId })
      .expect(202);
    const { drainMediaJobs } = await import('../../src/services/media-worker-service');
    await drainMediaJobs({ maxJobs: 5 });

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({ revision: 1, videoAssetId: assetId })
      .expect(200);

    return { token: owner.accessToken, projectId, assetId, revision: 2 };
  }

  it('routes timed content through the shared sanitizer and URL policy', async () => {
    const { token, projectId, revision } = await readyVideoProject('timed-content-author');
    const auth = bearer(token);

    const created = await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({
        projectRevision: revision,
        kind: 'cta',
        timeMs: 1_000,
        content: {
          title: '<svg onload=alert(1)>Book now</svg>',
          description: '<img src=x onerror=steal()>Limited offer',
          bodyHtml: '<p onclick="steal()">Book</p>'
            + '<a href="javascript:alert(1)">unsafe</a><script>alert(1)</script>',
          ctaLabel: '<b>Reserve</b>',
          ctaUrl: 'https://EXAMPLE.com/book'
        }
      })
      .expect(201);

    const content = created.body.data.interaction.content;
    expect(content.title).toBe('Book now');
    expect(content.description).toBe('Limited offer');
    expect(content.bodyHtml).not.toContain('onclick');
    expect(content.bodyHtml).not.toContain('javascript:');
    expect(content.bodyHtml).not.toContain('<script');
    expect(content.ctaLabel).toBe('Reserve');
    expect(content.ctaUrl).toBe('https://example.com/book');
  }, 120_000);

  it('rejects disallowed URL schemes in timed actions and calls to action', async () => {
    const { token, projectId, revision } = await readyVideoProject('timed-url-author');
    const auth = bearer(token);

    for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.com/insecure']) {
      await request(context.app)
        .post(`/api/v1/projects/${projectId}/timeline/interactions`)
        .set(auth)
        .send({
          projectRevision: revision,
          kind: 'link',
          timeMs: 500,
          action: { kind: 'openUrl', url }
        })
        .expect(422)
        .expect(({ body }) => expect(body.error.path).toBe('action.url'));

      await request(context.app)
        .post(`/api/v1/projects/${projectId}/timeline/interactions`)
        .set(auth)
        .send({
          projectRevision: revision,
          kind: 'cta',
          timeMs: 500,
          content: { ctaLabel: 'Book', ctaUrl: url }
        })
        .expect(422)
        .expect(({ body }) => expect(body.error.path).toBe('content.ctaUrl'));
    }
  }, 120_000);

  it('refuses timed references to media the owner cannot use', async () => {
    const { token, projectId, revision } = await readyVideoProject('timed-reference-author');
    const auth = bearer(token);
    const stranger = await registerIdentity(context.app, 'timed-reference-stranger');

    // Another owner's asset is never reachable through a timed interaction.
    const strangerPanorama = await generatedEquirectangularJpeg();
    const strangerSession = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(bearer(stranger.accessToken))
      .send({
        mediaType: 'image',
        filename: 'stranger.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: strangerPanorama.byteLength
      })
      .expect(201);
    const strangerAssetId = strangerSession.body.data.asset.id as string;

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({
        projectRevision: revision,
        kind: 'image',
        timeMs: 1_000,
        content: { imageAssetId: strangerAssetId }
      })
      .expect(422)
      .expect(({ body }) => expect(body.error).toMatchObject({
        code: 'TIMELINE_REFERENCE_INVALID',
        path: 'content.imageAssetId'
      }));

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({
        projectRevision: revision,
        kind: 'image',
        timeMs: 1_000,
        content: { imageAssetId: randomUUID() }
      })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('TIMELINE_REFERENCE_INVALID'));
  }, 120_000);

  it('rejects renderer configuration and unsupported geometry in timed payloads', async () => {
    const { token, projectId, revision } = await readyVideoProject('timed-renderer-author');
    const auth = bearer(token);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({
        projectRevision: revision,
        kind: 'hotspot',
        timeMs: 1_000,
        position: { longitudeDegrees: 0, latitudeDegrees: 0 },
        geometry: { kind: 'polygon' }
      })
      .expect(422);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({
        projectRevision: revision,
        kind: 'information',
        timeMs: 1_000,
        content: { title: 'Fine' },
        plugins: ['markers']
      })
      .expect(422);
  }, 120_000);

  it('rejects a video upload whose bytes are not a supported container', async () => {
    const owner = await registerIdentity(context.app, 'video-signature-author');
    const auth = bearer(owner.accessToken);
    const disguised = Buffer.concat([
      await generatedEquirectangularJpeg(),
      buildMp4Fixture({ payloadBytes: 16 })
    ]);

    const session = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({
        mediaType: 'video360',
        filename: 'disguised.mp4',
        mimeType: 'video/mp4',
        sizeBytes: disguised.byteLength
      })
      .expect(201);

    await request(context.app)
      .put(session.body.data.upload.url as string)
      .set(auth)
      .set('Content-Type', 'video/mp4')
      .send(disguised)
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('UNSUPPORTED_VIDEO_TYPE'));
  }, 120_000);

  it('keeps private video playback profiles behind authorization', async () => {
    const { token, projectId, revision } = await readyVideoProject('private-video-author');
    const auth = bearer(token);
    const other = await registerIdentity(context.app, 'private-video-intruder');

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `publish-${randomUUID()}`)
      .send({ revision, slug: 'private-video-tour', visibility: 'private' })
      .expect(201);

    await request(context.app)
      .get('/view/private-video-tour/manifest')
      .expect(401);
    await request(context.app)
      .get('/view/private-video-tour/manifest')
      .set(bearer(other.accessToken))
      .expect(403);
    await request(context.app)
      .post('/view/private-video-tour/playback-profile')
      .send({ handheld: true })
      .expect(401);

    const manifest = await request(context.app)
      .get('/view/private-video-tour/manifest')
      .set(auth)
      .expect(200)
      .expect('Cache-Control', /private, no-store/);
    const profileUrl = manifest.body.data.manifest.video.profiles[0].media.url as string;
    expect(profileUrl).toContain('token=');

    await request(context.app)
      .get(profileUrl.split('?')[0]!)
      .expect(403);
    await request(context.app).get(profileUrl).expect(200);

    const selection = await request(context.app)
      .post('/view/private-video-tour/playback-profile')
      .set(auth)
      .send({ handheld: true })
      .expect(200);
    expect(selection.body.data.selection.selected.media.url).toContain('token=');
  }, 120_000);
});
