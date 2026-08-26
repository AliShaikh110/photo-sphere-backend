import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bearer, registerIdentity } from '../helpers/api-client';
import { buildHandheldSafe360Mp4, buildMp4Fixture } from '../helpers/video-fixture';
import {
  startIntegrationTestContext,
  truncateApplicationData,
  type IntegrationTestContext
} from '../helpers/postgres-test-context';
import { PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION } from '../../src/compiler/viewer-integration-adapter';

const VIDEO_DURATION_MS = 6_000;

describe.sequential('Sprint 03 — 360 video, timeline and device-aware playback', () => {
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

  async function uploadVideo(options: {
    token: string;
    projectId: string;
    bytes: Buffer;
    filename?: string;
  }): Promise<string> {
    const auth = bearer(options.token);
    const session = await request(context.app)
      .post('/api/v1/assets/uploads')
      .set(auth)
      .send({
        projectId: options.projectId,
        mediaType: 'video360',
        filename: options.filename ?? 'harbour.mp4',
        mimeType: 'video/mp4',
        sizeBytes: options.bytes.byteLength
      })
      .expect(201);
    const assetId = session.body.data.asset.id as string;
    const uploadUrl = session.body.data.upload.url as string;

    await request(context.app)
      .put(uploadUrl)
      .set(auth)
      .set('Content-Type', 'video/mp4')
      .send(options.bytes)
      .expect(200);

    await request(context.app)
      .post(`/api/v1/assets/${assetId}/complete`)
      .set(auth)
      .set('Idempotency-Key', `complete-${randomUUID()}`)
      .send({ uploadSessionId: session.body.data.upload.sessionId })
      .expect(202);

    const { drainMediaJobs } = await import('../../src/services/media-worker-service');
    await drainMediaJobs({ maxJobs: 5 });
    return assetId;
  }

  it('runs the full 360 video pipeline: upload, profiles, timeline, publish and playback', async () => {
    const owner = await registerIdentity(context.app, 'video-owner');
    const auth = bearer(owner.accessToken);

    const projectResponse = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({
        type: 'video360',
        name: '<b>Harbour</b> Tour',
        videoSettings: { autoplay: true, muted: true, showControls: true }
      })
      .expect(201);
    const projectId = projectResponse.body.data.project.id as string;
    expect(projectResponse.body.data.project).toMatchObject({
      type: 'video360',
      name: 'Harbour Tour',
      revision: 1,
      videoAssetId: null,
      videoSettings: { autoplay: true, muted: true }
    });

    // Scenes belong to image experiences only.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/scenes`)
      .set(auth)
      .send({ projectRevision: 1, name: 'Lobby' })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('PROJECT_TYPE_MISMATCH'));

    const assetId = await uploadVideo({ token: owner.accessToken, projectId, bytes: video });

    const asset = await request(context.app)
      .get(`/api/v1/assets/${assetId}`)
      .set(auth)
      .expect(200);
    expect(asset.body.data.asset).toMatchObject({
      mediaType: 'video360',
      projection: 'equirectangular',
      processingStatus: 'ready',
      metadata: {
        container: 'mp4',
        width: 4_096,
        height: 2_048,
        durationMs: VIDEO_DURATION_MS,
        frameRate: 30,
        audioPresent: true,
        audioCodec: 'mp4a',
        codec: 'avc1',
        is360: true,
        posterAvailable: true
      }
    });
    const derivativeKinds = (asset.body.data.asset.derivatives as { kind: string }[])
      .map((derivative) => derivative.kind)
      .sort();
    expect(derivativeKinds).toEqual([
      'desktopVideoProfile',
      'mobileVideoProfile',
      'videoPoster'
    ]);
    expect(asset.body.data.asset.processingStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'inspect', status: 'succeeded' }),
      expect.objectContaining({ stage: 'poster', status: 'succeeded' }),
      expect.objectContaining({ stage: 'transcodeDesktop', status: 'succeeded' }),
      expect.objectContaining({ stage: 'transcodeMobile', status: 'succeeded' }),
      expect.objectContaining({ stage: 'finalize', status: 'succeeded' })
    ]));

    // The timeline is unavailable until the project references its video.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({ projectRevision: 1, kind: 'information', timeMs: 1_000 })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('VIDEO_ASSET_NOT_ASSIGNED'));

    const linked = await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({ revision: 1, videoAssetId: assetId })
      .expect(200);
    expect(linked.body.data.project).toMatchObject({ revision: 2, videoAssetId: assetId });

    const timelineView = await request(context.app)
      .get(`/api/v1/projects/${projectId}/timeline`)
      .set(auth)
      .expect(200);
    expect(timelineView.body.data.timeline).toMatchObject({
      videoAssetId: assetId,
      durationMs: VIDEO_DURATION_MS,
      interactions: []
    });

    const information = await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({
        projectRevision: 2,
        kind: 'information',
        timeMs: 2_000,
        endTimeMs: 4_000,
        content: {
          title: '<b>Engine room</b>',
          bodyHtml: '<p onclick="steal()">Take a closer look</p><script>alert(1)</script>'
        },
        visibilityRules: { enabled: true, pauseVideoWhenShown: true }
      })
      .expect(201);
    const informationId = information.body.data.interaction.id as string;
    expect(information.body.data).toMatchObject({ projectRevision: 3 });
    expect(information.body.data.interaction.content).toMatchObject({
      title: 'Engine room',
      bodyHtml: '<p>Take a closer look</p>'
    });

    const hotspot = await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({
        projectRevision: 3,
        kind: 'hotspot',
        timeMs: 1_000,
        position: { longitudeDegrees: 30, latitudeDegrees: -10 },
        appearance: { label: 'Bridge' },
        action: { kind: 'openUrl', url: 'https://EXAMPLE.com/bridge' }
      })
      .expect(201);
    const hotspotId = hotspot.body.data.interaction.id as string;
    expect(hotspot.body.data.interaction.action).toEqual({
      kind: 'openUrl',
      url: 'https://example.com/bridge'
    });

    const viewpoint = await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({
        projectRevision: 4,
        kind: 'viewpoint',
        timeMs: 5_000,
        viewpoint: { headingDegrees: 90, pitchDegrees: 0, transition: 'smooth', transitionMs: 800 }
      })
      .expect(201);
    expect(viewpoint.body.data.interaction.action).toEqual({ kind: 'setViewpoint' });

    // Time validation is enforced against the inspected media duration.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({ projectRevision: 5, kind: 'information', timeMs: 999_000 })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('TIMELINE_TIME_OUT_OF_RANGE'));

    // A hotspot without a placement is rejected as an incomplete payload.
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({ projectRevision: 5, kind: 'hotspot', timeMs: 1_500 })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('TIMELINE_PAYLOAD_INVALID'));

    const duplicate = await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions/${hotspotId}/duplicate`)
      .set(auth)
      .send({ projectRevision: 5, timeMs: 3_000 })
      .expect(201);
    const duplicateId = duplicate.body.data.interaction.id as string;
    expect(duplicateId).not.toBe(hotspotId);
    expect(duplicate.body.data.interaction).toMatchObject({
      kind: 'hotspot',
      timeMs: 3_000,
      action: { kind: 'openUrl', url: 'https://example.com/bridge' }
    });

    // Drag-heavy editing moves several interactions atomically.
    const moved = await request(context.app)
      .patch(`/api/v1/projects/${projectId}/timeline`)
      .set(auth)
      .send({
        projectRevision: 6,
        interactions: [
          { id: hotspotId, timeMs: 500 },
          { id: informationId, timeMs: 2_500, endTimeMs: 3_500 }
        ]
      })
      .expect(200);
    expect(moved.body.data.projectRevision).toBe(7);
    expect((moved.body.data.interactions as { id: string; timeMs: number }[])
      .map((interaction) => interaction.timeMs))
      .toEqual([500, 2_500, 3_000, 5_000]);

    // A rejected batch leaves every interaction untouched.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/timeline`)
      .set(auth)
      .send({
        projectRevision: 7,
        interactions: [
          { id: hotspotId, timeMs: 750 },
          { id: informationId, timeMs: 900_000 }
        ]
      })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('TIMELINE_TIME_OUT_OF_RANGE'));
    const afterRejected = await request(context.app)
      .get(`/api/v1/projects/${projectId}/timeline`)
      .set(auth)
      .expect(200);
    expect(afterRejected.body.data.timeline.projectRevision).toBe(7);
    expect((afterRejected.body.data.timeline.interactions as { id: string; timeMs: number }[])
      .find((interaction) => interaction.id === hotspotId)?.timeMs)
      .toBe(500);

    await request(context.app)
      .delete(`/api/v1/projects/${projectId}/timeline/interactions/${duplicateId}`)
      .set(auth)
      .send({ projectRevision: 7 })
      .expect(200)
      .expect(({ body }) => expect(body.data).toMatchObject({
        deleted: true,
        projectRevision: 8
      }));

    // Concurrency: a stale revision never silently overwrites newer edits.
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/timeline/interactions/${hotspotId}`)
      .set(auth)
      .send({ projectRevision: 3, timeMs: 100 })
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('REVISION_CONFLICT'));

    const validated = await request(context.app)
      .post(`/api/v1/projects/${projectId}/validate`)
      .set(auth)
      .send({ revision: 8 })
      .expect(200);
    expect(validated.body.data.valid).toBe(true);
    expect(validated.body.data.capabilityResolution.capabilities).toEqual(
      expect.arrayContaining(['video360', 'videoTimeline', 'timedHotspots', 'timedViewpoint'])
    );

    const preview = await request(context.app)
      .post(`/api/v1/projects/${projectId}/preview-manifest`)
      .set(auth)
      .send({ revision: 8 })
      .expect(200);
    expect(preview.body.data.manifest).toMatchObject({
      experienceType: 'video360',
      target: 'preview',
      visibility: 'private'
    });
    expect(preview.body.data.manifest.video.profiles).toHaveLength(2);
    const previewProfileUrl = preview.body.data.manifest.video.profiles[0].media.url as string;
    expect(previewProfileUrl).toContain('token=');
    await request(context.app).get(previewProfileUrl).expect(200);

    const published = await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `publish-${randomUUID()}`)
      .send({ revision: 8, slug: 'harbour-tour', visibility: 'public' })
      .expect(201);
    expect(published.body.data.publication).toMatchObject({
      publicationRevision: 1,
      visibility: 'public',
      status: 'published'
    });

    const manifest = await request(context.app)
      .get('/view/harbour-tour/manifest')
      .expect(200);
    const videoManifest = manifest.body.data.manifest;
    expect(videoManifest).toMatchObject({
      experienceType: 'video360',
      publicationRevision: 1,
      visibility: 'public'
    });
    expect(videoManifest.video.durationMs).toBe(VIDEO_DURATION_MS);
    expect(videoManifest.video.poster.kind).toBe('videoPoster');
    expect(videoManifest.video.selectionPolicy).toMatchObject({
      strategy: 'ordered-candidates-client-selects',
      handheldMaxWidth: 4_096,
      selectionUrl: '/view/harbour-tour/playback-profile'
    });
    expect(videoManifest.timeline.map((interaction: { id: string }) => interaction.id))
      .toEqual([hotspotId, informationId, viewpoint.body.data.interaction.id]);
    expect(videoManifest.telemetry.events).toEqual(
      expect.arrayContaining(['video_started', 'video_stalled'])
    );
    // Renderer configuration exists only inside the integration adapter output.
    expect(videoManifest.viewerIntegration.config.adapter).toBe('equirectangular-video');
    expect(JSON.stringify(videoManifest.timeline)).not.toContain('yaw');

    const publicProfileUrl = videoManifest.video.profiles[0].media.url as string;
    await request(context.app)
      .get(publicProfileUrl)
      .expect(200)
      .expect('Content-Type', /video\/mp4/)
      .expect('Cache-Control', /immutable/);

    // Device-aware selection: a handheld device must never receive a profile
    // above the documented width ceiling.
    const handheldSelection = await request(context.app)
      .post('/view/harbour-tour/playback-profile')
      .send({ handheld: true, touch: true, viewportClass: 'constrained' })
      .expect(200)
      .expect('Cache-Control', /no-store/);
    expect(handheldSelection.body.data.selection.selected).toMatchObject({
      profileId: 'mobile',
      constraints: { handheldSafe: true }
    });

    const desktopSelection = await request(context.app)
      .post('/view/harbour-tour/playback-profile')
      .send({ viewportClass: 'capable' })
      .expect(200);
    expect(desktopSelection.body.data.selection.candidateProfileIds).toContain('desktop');

    await request(context.app)
      .post('/view/harbour-tour/playback-profile')
      .send({ supportedMimeTypes: ['video/ogg'] })
      .expect(422)
      .expect(({ body }) => expect(body.error.code)
        .toBe('VIDEO_PLAYBACK_CAPABILITY_UNSUPPORTED'));

    // Playback telemetry, including the mandatory start and stall events.
    const sessionId = `session-${randomUUID()}`;
    const ingestToken = videoManifest.telemetry.ingestToken as string;
    const telemetry = await request(context.app)
      .post('/api/v1/runtime/events')
      .set('x-telemetry-token', ingestToken)
      .send({
        events: [
          {
            eventId: randomUUID(),
            eventName: 'video_started',
            experienceId: projectId,
            publicationRevision: 1,
            viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
            sessionId,
            occurredAt: new Date().toISOString(),
            payload: { assetId, profileId: 'mobile', currentTimeMs: 0 }
          },
          {
            eventId: randomUUID(),
            eventName: 'video_stalled',
            experienceId: projectId,
            publicationRevision: 1,
            viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
            sessionId,
            occurredAt: new Date().toISOString(),
            payload: { assetId, currentTimeMs: 2_400 }
          },
          {
            eventId: randomUUID(),
            eventName: 'video_profile_selected',
            experienceId: projectId,
            publicationRevision: 1,
            viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
            sessionId,
            occurredAt: new Date().toISOString(),
            payload: {
              assetId,
              derivativeId: videoManifest.video.profiles[0].media.derivativeId,
              profileId: 'mobile',
              reason: 'handheld-width-constraint'
            }
          },
          {
            eventId: randomUUID(),
            eventName: 'video_playback_failed',
            experienceId: projectId,
            publicationRevision: 1,
            viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
            sessionId,
            occurredAt: new Date().toISOString(),
            payload: { assetId, failureCategory: 'codec_unsupported', currentTimeMs: 100 }
          },
          {
            eventId: randomUUID(),
            eventName: 'timeline_interaction_shown',
            experienceId: projectId,
            publicationRevision: 1,
            viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
            sessionId,
            occurredAt: new Date().toISOString(),
            payload: { interactionId: hotspotId, kind: 'hotspot', timeMs: 500 }
          }
        ]
      })
      .expect(202);
    expect(telemetry.body.data).toMatchObject({ accepted: 5 });

    await request(context.app)
      .post('/api/v1/runtime/events')
      .set('x-telemetry-token', ingestToken)
      .send({
        eventId: randomUUID(),
        eventName: 'video_playback_failed',
        experienceId: projectId,
        publicationRevision: 1,
        viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
        sessionId,
        occurredAt: new Date().toISOString(),
        payload: { assetId, failureCategory: 'not-a-category' }
      })
      .expect(422);

    // The published video is the primary asset and cannot be deleted from under
    // the experience.
    await request(context.app)
      .delete(`/api/v1/assets/${assetId}`)
      .set(auth)
      .expect(409)
      .expect(({ body }) => expect(body.error.code).toBe('ASSET_IN_USE'));
  }, 120_000);

  it('keeps the logical asset stable when one playback profile is regenerated', async () => {
    const owner = await registerIdentity(context.app, 'reprocess-owner');
    const auth = bearer(owner.accessToken);
    const project = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ type: 'video360', name: 'Reprocess' })
      .expect(201);
    const projectId = project.body.data.project.id as string;
    const assetId = await uploadVideo({ token: owner.accessToken, projectId, bytes: video });

    const before = await request(context.app)
      .get(`/api/v1/assets/${assetId}`)
      .set(auth)
      .expect(200);
    const mobileBefore = (before.body.data.asset.derivatives as { kind: string; id: string; version: number }[])
      .find((derivative) => derivative.kind === 'mobileVideoProfile')!;
    const desktopBefore = (before.body.data.asset.derivatives as { kind: string; id: string }[])
      .find((derivative) => derivative.kind === 'desktopVideoProfile')!;

    await request(context.app)
      .post(`/api/v1/assets/${assetId}/reprocess`)
      .set(auth)
      .set('Idempotency-Key', `reprocess-${randomUUID()}`)
      .send({ profiles: ['mobile'] })
      .expect(202);
    const { drainMediaJobs } = await import('../../src/services/media-worker-service');
    await drainMediaJobs({ maxJobs: 5 });

    const after = await request(context.app)
      .get(`/api/v1/assets/${assetId}`)
      .set(auth)
      .expect(200);
    expect(after.body.data.asset.id).toBe(assetId);
    expect(after.body.data.asset.processingStatus).toBe('ready');
    const derivatives = after.body.data.asset.derivatives as {
      kind: string;
      id: string;
      version: number;
    }[];
    const mobileVersions = derivatives
      .filter((derivative) => derivative.kind === 'mobileVideoProfile')
      .map((derivative) => derivative.version)
      .sort();
    expect(mobileVersions).toEqual([1, 2]);
    // The untouched desktop profile keeps its original identity and version.
    const desktopAfter = derivatives.filter(
      (derivative) => derivative.kind === 'desktopVideoProfile'
    );
    expect(desktopAfter).toHaveLength(1);
    expect(desktopAfter[0]!.id).toBe(desktopBefore.id);
    expect(mobileBefore.version).toBe(1);
    expect(after.body.data.asset.processingStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'transcodeDesktop', status: 'skipped' }),
      expect.objectContaining({ stage: 'transcodeMobile', status: 'succeeded' })
    ]));
  }, 120_000);

  it('records an actionable status when a handheld profile cannot be produced', async () => {
    const owner = await registerIdentity(context.app, 'oversized-owner');
    const auth = bearer(owner.accessToken);
    const project = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ type: 'video360', name: 'Oversized' })
      .expect(201);
    const projectId = project.body.data.project.id as string;
    const assetId = await uploadVideo({
      token: owner.accessToken,
      projectId,
      bytes: buildMp4Fixture({ width: 8_192, height: 4_096, durationMs: 4_000 })
    });

    const asset = await request(context.app)
      .get(`/api/v1/assets/${assetId}`)
      .set(auth)
      .expect(200);
    // Without a re-encoding transcoder the oversized source is published as a
    // desktop profile only; the handheld profile stays explicitly unavailable.
    expect(asset.body.data.asset.processingStatus).toBe('ready');
    expect(asset.body.data.asset.metadata.unavailablePlaybackProfiles).toEqual([
      expect.objectContaining({ derivativeKind: 'mobileVideoProfile' })
    ]);
    expect(asset.body.data.asset.processingStages).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'transcodeMobile', status: 'failed' })
    ]));
    const kinds = (asset.body.data.asset.derivatives as { kind: string }[])
      .map((derivative) => derivative.kind);
    expect(kinds).toContain('desktopVideoProfile');
    expect(kinds).not.toContain('mobileVideoProfile');

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({ revision: 1, videoAssetId: assetId })
      .expect(200);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `publish-${randomUUID()}`)
      .send({ revision: 2, slug: 'oversized-tour', visibility: 'public' })
      .expect(201);

    // Baseline playback still works; only handheld delivery is unavailable.
    const manifest = await request(context.app)
      .get('/view/oversized-tour/manifest')
      .expect(200);
    expect(manifest.body.data.manifest.video.profiles.map(
      (profile: { profileId: string }) => profile.profileId
    )).toEqual(['desktop']);
    await request(context.app)
      .post('/view/oversized-tour/playback-profile')
      .send({ handheld: true })
      .expect(422)
      .expect(({ body }) => expect(body.error.code)
        .toBe('VIDEO_PLAYBACK_CAPABILITY_UNSUPPORTED'));
  }, 120_000);

  it('keeps 360 image experiences free of timeline behaviour', async () => {
    const owner = await registerIdentity(context.app, 'image-owner');
    const auth = bearer(owner.accessToken);
    const project = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ type: 'image360', name: 'Panorama' })
      .expect(201);
    const projectId = project.body.data.project.id as string;

    expect(project.body.data.project.videoSettings).toBeUndefined();
    await request(context.app)
      .get(`/api/v1/projects/${projectId}/timeline`)
      .set(auth)
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('TIMELINE_NOT_AVAILABLE'));
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({ revision: 1, videoSettings: { autoplay: true } })
      .expect(422)
      .expect(({ body }) => expect(body.error.code).toBe('PROJECT_TYPE_MISMATCH'));
  }, 60_000);

  it('refuses a timeline write from another owner', async () => {
    const owner = await registerIdentity(context.app, 'timeline-owner');
    const other = await registerIdentity(context.app, 'timeline-intruder');
    const project = await request(context.app)
      .post('/api/v1/projects')
      .set(bearer(owner.accessToken))
      .send({ type: 'video360', name: 'Private Video' })
      .expect(201);
    const projectId = project.body.data.project.id as string;

    await request(context.app)
      .get(`/api/v1/projects/${projectId}/timeline`)
      .set(bearer(other.accessToken))
      .expect(404);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(bearer(other.accessToken))
      .send({ projectRevision: 1, kind: 'information', timeMs: 0 })
      .expect(404);
  }, 60_000);
  it('gives a project editor the same timeline access it gives every other project resource', async () => {
    const owner = await registerIdentity(context.app, 'timeline-grant-owner');
    const editor = await registerIdentity(context.app, 'timeline-grant-editor');
    const viewer = await registerIdentity(context.app, 'timeline-grant-viewer');
    const stranger = await registerIdentity(context.app, 'timeline-grant-stranger');
    const ownerAuth = bearer(owner.accessToken);

    const project = await request(context.app)
      .post('/api/v1/projects')
      .set(ownerAuth)
      .send({ type: 'video360', name: 'Shared Video' })
      .expect(201);
    const projectId = project.body.data.project.id as string;
    const assetId = await uploadVideo({ token: owner.accessToken, projectId, bytes: video });
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(ownerAuth)
      .send({ revision: 1, videoAssetId: assetId })
      .expect(200);

    for (const [identity, role] of [[editor, 'editor'], [viewer, 'viewer']] as const) {
      await request(context.app)
        .post(`/api/v1/projects/${projectId}/access`)
        .set(ownerAuth)
        .send({ email: identity.email, role })
        .expect(201);
    }

    // The editor reads and writes the timeline exactly like the owner does.
    const editorAuth = bearer(editor.accessToken);
    await request(context.app)
      .get(`/api/v1/projects/${projectId}/timeline`)
      .set(editorAuth)
      .expect(200)
      .expect(({ body }) => expect(body.data.timeline).toMatchObject({
        videoAssetId: assetId,
        durationMs: VIDEO_DURATION_MS
      }));

    const created = await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(editorAuth)
      .send({ projectRevision: 2, kind: 'information', timeMs: 1_000, content: { title: 'Bridge' } })
      .expect(201);
    const interactionId = created.body.data.interaction.id as string;

    await request(context.app)
      .patch(`/api/v1/projects/${projectId}/timeline/interactions/${interactionId}`)
      .set(editorAuth)
      .send({ projectRevision: created.body.data.projectRevision, timeMs: 2_000 })
      .expect(200)
      .expect(({ body }) => expect(body.data.interaction.timeMs).toBe(2_000));

    const duplicated = await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions/${interactionId}/duplicate`)
      .set(editorAuth)
      .send({ projectRevision: 4 })
      .expect(201);

    await request(context.app)
      .delete(`/api/v1/projects/${projectId}/timeline/interactions/${duplicated.body.data.interaction.id}`)
      .set(editorAuth)
      .send({ projectRevision: 5 })
      .expect(200);

    // A viewer reads but must not write, and a stranger sees nothing at all.
    const viewerAuth = bearer(viewer.accessToken);
    await request(context.app)
      .get(`/api/v1/projects/${projectId}/timeline`)
      .set(viewerAuth)
      .expect(200);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(viewerAuth)
      .send({ projectRevision: 6, kind: 'information', timeMs: 500 })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('PROJECT_ACCESS_DENIED'));

    await request(context.app)
      .get(`/api/v1/projects/${projectId}/timeline`)
      .set(bearer(stranger.accessToken))
      .expect(404);
    await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(bearer(stranger.accessToken))
      .send({ projectRevision: 6, kind: 'information', timeMs: 500 })
      .expect(404);
  }, 120_000);

  it('keeps the interaction time span when only the kind changes', async () => {
    const owner = await registerIdentity(context.app, 'timeline-kind-owner');
    const auth = bearer(owner.accessToken);
    const project = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ type: 'video360', name: 'Kind Change' })
      .expect(201);
    const projectId = project.body.data.project.id as string;
    const assetId = await uploadVideo({ token: owner.accessToken, projectId, bytes: video });
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({ revision: 1, videoAssetId: assetId })
      .expect(200);

    const created = await request(context.app)
      .post(`/api/v1/projects/${projectId}/timeline/interactions`)
      .set(auth)
      .send({
        projectRevision: 2,
        kind: 'information',
        timeMs: 1_000,
        endTimeMs: 3_000,
        content: { title: 'Engine room', bodyHtml: '<p>Look closer</p>' }
      })
      .expect(201);
    const interactionId = created.body.data.interaction.id as string;
    expect(created.body.data.interaction).toMatchObject({ timeMs: 1_000, endTimeMs: 3_000 });

    // Timing is placement, not kind payload: it survives the kind change even
    // though the information content is replaced by the call-to-action payload.
    const changed = await request(context.app)
      .patch(`/api/v1/projects/${projectId}/timeline/interactions/${interactionId}`)
      .set(auth)
      .send({ projectRevision: 3, kind: 'cta', content: { ctaLabel: 'Book a tour' } })
      .expect(200);
    expect(changed.body.data.interaction).toMatchObject({
      kind: 'cta',
      timeMs: 1_000,
      endTimeMs: 3_000
    });
    expect(changed.body.data.interaction.content.title).toBeUndefined();

    // An explicit null still clears the span.
    const cleared = await request(context.app)
      .patch(`/api/v1/projects/${projectId}/timeline/interactions/${interactionId}`)
      .set(auth)
      .send({ projectRevision: 4, endTimeMs: null })
      .expect(200);
    expect(cleared.body.data.interaction.endTimeMs).toBeNull();

    // And an explicit value is still applied alongside a kind change.
    const respanned = await request(context.app)
      .patch(`/api/v1/projects/${projectId}/timeline/interactions/${interactionId}`)
      .set(auth)
      .send({ projectRevision: 5, kind: 'information', endTimeMs: 4_500 })
      .expect(200);
    expect(respanned.body.data.interaction).toMatchObject({
      kind: 'information',
      timeMs: 1_000,
      endTimeMs: 4_500
    });
  }, 120_000);
  it('keeps same-timestamp interactions in one order across the editor, preview and publication', async () => {
    const owner = await registerIdentity(context.app, 'timeline-order-owner');
    const auth = bearer(owner.accessToken);
    const project = await request(context.app)
      .post('/api/v1/projects')
      .set(auth)
      .send({ type: 'video360', name: 'Order' })
      .expect(201);
    const projectId = project.body.data.project.id as string;
    const assetId = await uploadVideo({ token: owner.accessToken, projectId, bytes: video });
    await request(context.app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth)
      .send({ revision: 1, videoAssetId: assetId })
      .expect(200);

    // Three interactions share a timestamp, so only the authored order can
    // separate them. Random IDs make an ID-based tie-break visibly wrong.
    const ids: string[] = [];
    let revision = 2;
    for (const title of ['First', 'Second', 'Third']) {
      const created = await request(context.app)
        .post(`/api/v1/projects/${projectId}/timeline/interactions`)
        .set(auth)
        .send({ projectRevision: revision, kind: 'information', timeMs: 2_000, content: { title } })
        .expect(201);
      ids.push(created.body.data.interaction.id as string);
      revision = created.body.data.projectRevision as number;
    }

    const listed = await request(context.app)
      .get(`/api/v1/projects/${projectId}/timeline`)
      .set(auth)
      .expect(200);
    const editorOrder = (listed.body.data.timeline.interactions as { id: string }[])
      .map((interaction) => interaction.id);
    expect(editorOrder).toEqual(ids);

    const preview = await request(context.app)
      .post(`/api/v1/projects/${projectId}/preview-manifest`)
      .set(auth)
      .send({ revision })
      .expect(200);
    expect(preview.body.data.manifest.timeline.map((entry: { id: string }) => entry.id))
      .toEqual(editorOrder);

    await request(context.app)
      .post(`/api/v1/projects/${projectId}/publish`)
      .set(auth)
      .set('Idempotency-Key', `publish-${randomUUID()}`)
      .send({ revision, slug: 'timeline-order', visibility: 'public' })
      .expect(201);

    const manifest = await request(context.app).get('/view/timeline-order/manifest').expect(200);
    expect(manifest.body.data.manifest.timeline.map((entry: { id: string }) => entry.id))
      .toEqual(editorOrder);
  }, 120_000);
});
