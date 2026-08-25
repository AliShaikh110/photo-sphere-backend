import { describe, expect, it, vi } from 'vitest';

import { ExperienceCompiler } from '../../../src/compiler/experience-compiler';
import {
  isVideoExperienceManifest,
  type CompileExperienceInput,
  type CompiledVideoExperienceManifest,
  type MediaUrlResolutionRequest
} from '../../../src/compiler/types';
import type { AssetDerivative, CanonicalAsset, CanonicalProject } from '../../../src/domain/types';
import { PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION } from '../../../src/compiler/viewer-integration-adapter';
import { COMPILED_MANIFEST_VERSION } from '../../../src/compiler/types';

function videoDerivative(
  kind: AssetDerivative['kind'],
  overrides: Partial<AssetDerivative> = {}
): AssetDerivative {
  const width = kind === 'mobileVideoProfile' ? 4_096 : kind === 'videoPoster' ? 1_280 : 8_192;
  return {
    id: `derivative-${kind}`,
    assetId: 'asset-video',
    kind,
    version: 1,
    storageKey: `private/asset-video/${kind}/v1.bin`,
    mimeType: kind === 'videoPoster' ? 'image/jpeg' : 'video/mp4',
    width,
    height: width / 2,
    sizeBytes: 4_096,
    metadata: kind === 'videoPoster'
      ? {}
      : { profileId: kind === 'mobileVideoProfile' ? 'mobile' : 'desktop', handheldSafe: width <= 4_096 },
    ...overrides
  };
}

function videoAsset(overrides: Partial<CanonicalAsset> = {}): CanonicalAsset {
  return {
    id: 'asset-video',
    ownerId: 'owner-1',
    projectId: 'project-1',
    mediaType: 'video360',
    projection: 'equirectangular',
    processingStatus: 'ready',
    metadata: {
      width: 8_192,
      height: 4_096,
      durationMs: 120_000,
      frameRate: 30,
      audioPresent: true,
      stereoMode: 'mono',
      is360: true
    },
    derivatives: [
      videoDerivative('videoPoster'),
      videoDerivative('desktopVideoProfile'),
      videoDerivative('mobileVideoProfile')
    ],
    ...overrides
  };
}

function videoProject(overrides: Partial<CanonicalProject> = {}): CanonicalProject {
  return {
    id: 'project-1',
    ownerId: 'owner-1',
    type: 'video360',
    name: 'Harbour Tour',
    schemaVersion: 1,
    revision: 3,
    settings: {
      navigation: { zoom: true, fullscreen: true },
      video: { autoplay: true, muted: true, showControls: true }
    },
    branding: { companyName: 'Harbour' },
    scenes: [],
    videoAssetId: 'asset-video',
    timeline: [
      {
        id: 'interaction-2',
        projectId: 'project-1',
        kind: 'information',
        timeMs: 45_000,
        endTimeMs: 50_000,
        content: {
          title: 'Engine room',
          bodyHtml: '<p>Take a closer look<script>steal()</script></p>'
        },
        action: { kind: 'showInformation' },
        visibilityRules: { enabled: true, pauseVideoWhenShown: true }
      },
      {
        id: 'interaction-1',
        projectId: 'project-1',
        kind: 'hotspot',
        timeMs: 12_000,
        geometry: { kind: 'point' },
        position: {
          coordinateSystem: 'spherical_degrees',
          longitudeDegrees: 30,
          latitudeDegrees: -10
        },
        appearance: { label: 'Bridge' },
        content: { tooltip: 'Visit the bridge' },
        action: { kind: 'openUrl', url: 'https://EXAMPLE.com/bridge' }
      },
      {
        id: 'interaction-3',
        projectId: 'project-1',
        kind: 'viewpoint',
        timeMs: 60_000,
        viewpoint: { headingDegrees: 90, pitchDegrees: 0, transition: 'smooth', transitionMs: 800 },
        action: { kind: 'setViewpoint' }
      }
    ],
    publication: { slug: 'harbour-tour', visibility: 'public' },
    ...overrides
  };
}

function compilerInput(overrides: Partial<CompileExperienceInput> = {}): CompileExperienceInput {
  return {
    project: videoProject(),
    assets: [videoAsset()],
    target: 'preview',
    ...overrides
  };
}

function createCompiler(requests: MediaUrlResolutionRequest[] = []): ExperienceCompiler {
  return new ExperienceCompiler({
    viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION,
    mediaUrlResolver: {
      resolve: vi.fn((request: MediaUrlResolutionRequest) => {
        requests.push(request);
        return `/media/${request.access}/${request.derivative.id}`;
      })
    }
  });
}

async function compileVideo(
  input: CompileExperienceInput = compilerInput()
): Promise<CompiledVideoExperienceManifest> {
  const manifest = await createCompiler().compile(input);
  if (!isVideoExperienceManifest(manifest)) throw new Error('Expected a video360 manifest.');
  return manifest;
}

describe('Experience compiler — 360 video', () => {
  it('compiles a video360 manifest through the shared compiler path', async () => {
    const requests: MediaUrlResolutionRequest[] = [];
    const compiler = createCompiler(requests);
    const input = compilerInput();

    const first = await compiler.compile(input);
    const second = await compiler.compile(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      manifestVersion: COMPILED_MANIFEST_VERSION,
      experienceType: 'video360',
      experienceId: 'project-1',
      projectRevision: 3,
      publicationRevision: null,
      target: 'preview',
      visibility: 'private',
      viewerIntegrationVersion: PHOTO_SPHERE_VIEWER_INTEGRATION_VERSION
    });
    expect(requests.every((request) => request.access === 'protected')).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('private/asset-video');
  });

  it('publishes ordered playback candidates with a handheld-safe default', async () => {
    const manifest = await compileVideo();

    expect(manifest.video).toMatchObject({
      assetId: 'asset-video',
      projection: 'equirectangular',
      durationMs: 120_000,
      width: 8_192,
      height: 4_096,
      frameRate: 30,
      audioPresent: true,
      stereoMode: 'mono'
    });
    expect(manifest.video.poster?.kind).toBe('videoPoster');
    expect(manifest.video.profiles.map((profile) => profile.profileId))
      .toEqual(['mobile', 'desktop']);
    expect(manifest.video.profiles[0]!.constraints).toMatchObject({
      handheldSafe: true,
      maxWidth: 4_096,
      mimeType: 'video/mp4'
    });
    expect(manifest.video.selectionPolicy).toMatchObject({
      strategy: 'ordered-candidates-client-selects',
      handheldMaxWidth: 4_096,
      defaultProfileId: 'mobile',
      fallbackProfileId: 'mobile'
    });
  });

  it('normalises the timeline deterministically and sanitizes timed content', async () => {
    const manifest = await compileVideo();

    expect(manifest.timeline.map((interaction) => interaction.id))
      .toEqual(['interaction-1', 'interaction-2', 'interaction-3']);
    const information = manifest.timeline[1]!;
    expect(information.content?.bodyHtml).toBe('<p>Take a closer look</p>');
    expect(information.endTimeMs).toBe(50_000);
    expect(information.visibilityRules).toMatchObject({ pauseVideoWhenShown: true });
    const hotspot = manifest.timeline[0]!;
    expect(hotspot.action).toEqual({ kind: 'openUrl', url: 'https://example.com/bridge' });
    expect(hotspot.position).toMatchObject({ longitudeDegrees: 30, latitudeDegrees: -10 });
    expect(manifest.timeline[2]!.viewpoint).toMatchObject({
      headingDegrees: 90,
      transition: 'smooth',
      transitionMs: 800
    });
  });

  it('declares the video capability set, runtime policy and telemetry contract', async () => {
    const manifest = await compileVideo();

    const capabilityIds = manifest.capabilities.map((capability) => capability.id);
    expect(capabilityIds).toEqual(expect.arrayContaining([
      'video360',
      'videoTimeline',
      'timedHotspots',
      'timedViewpoint',
      'externalLink'
    ]));
    expect(capabilityIds).not.toContain('basicPanorama');
    expect(manifest.capabilities.find((capability) => capability.id === 'video360')?.required)
      .toBe(true);
    expect(manifest.runtime.preload).toMatchObject({ strategy: 'video-progressive' });
    expect(manifest.runtime.fallbackPolicy).toMatchObject({
      video: 'ordered-playback-profile-candidates',
      optionalCapabilities: 'continue-without-capability'
    });
    expect(manifest.runtime.cache.profiles.standard.mediaClass).toBe('video-tour');
    expect(manifest.telemetry.events).toEqual(expect.arrayContaining([
      'video_started',
      'video_stalled',
      'video_profile_selected',
      'video_playback_failed',
      'timeline_interaction_shown'
    ]));
    expect(manifest.telemetry.videoPlaybackFailureCategories)
      .toContain('profile_unavailable');
  });

  it('emits renderer configuration only through the integration adapter', async () => {
    const manifest = await compileVideo();

    expect(manifest.viewerIntegration.rendererId).toBe('photo-sphere-viewer');
    expect(manifest.viewerIntegration.config).toMatchObject({
      adapter: 'equirectangular-video',
      video: { autoplay: true, muted: true, durationMs: 120_000 }
    });
    // Product entities never carry renderer vocabulary.
    expect(JSON.stringify(manifest.video)).not.toContain('adapter');
    expect(JSON.stringify(manifest.timeline)).not.toContain('yaw');
  });

  it('uses public media for public publications and pins the selection endpoint', async () => {
    const requests: MediaUrlResolutionRequest[] = [];
    const manifest = await createCompiler(requests).compile(compilerInput({
      target: 'publication',
      publicationRevision: 5,
      visibility: 'public',
      publicationSlug: 'harbour-tour'
    }));
    if (!isVideoExperienceManifest(manifest)) throw new Error('Expected a video360 manifest.');

    expect(manifest.publicationRevision).toBe(5);
    expect(requests.every((request) => request.access === 'public')).toBe(true);
    expect(manifest.video.selectionPolicy.selectionUrl)
      .toBe('/view/harbour-tour/playback-profile');
  });

  it('refuses to compile a video experience with no playback profile', async () => {
    const asset = videoAsset({ derivatives: [videoDerivative('videoPoster')] });

    await expect(createCompiler().compile(compilerInput({ assets: [asset] })))
      .rejects.toMatchObject({
        code: 'EXPERIENCE_COMPILATION_FAILED',
        issues: expect.arrayContaining([expect.objectContaining({
          code: 'VIDEO_PROFILE_UNAVAILABLE',
          retryable: true
        })])
      });
  });

  it('refuses to compile while the video is still processing', async () => {
    const asset = videoAsset({ processingStatus: 'processing', derivatives: [] });

    await expect(createCompiler().compile(compilerInput({ assets: [asset] })))
      .rejects.toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({
          code: 'VIDEO_ASSET_NOT_READY',
          path: 'videoAssetId',
          retryable: true
        })])
      });
  });

  it('rejects a timeline entry beyond the media duration', async () => {
    const project = videoProject({
      timeline: [{
        id: 'interaction-late',
        projectId: 'project-1',
        kind: 'information',
        timeMs: 500_000,
        action: { kind: 'showInformation' }
      }]
    });

    await expect(createCompiler().compile(compilerInput({ project })))
      .rejects.toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({
          code: 'TIMELINE_TIME_OUT_OF_RANGE',
          path: 'timeline[0].timeMs'
        })])
      });
  });

  it('rejects an unsafe timed link before it can reach the runtime', async () => {
    const project = videoProject({
      timeline: [{
        id: 'interaction-unsafe',
        projectId: 'project-1',
        kind: 'link',
        timeMs: 1_000,
        action: { kind: 'openUrl', url: 'javascript:alert(1)' }
      }]
    });

    await expect(createCompiler().compile(compilerInput({ project })))
      .rejects.toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({
          code: 'INVALID_URL',
          path: 'timeline[0].action.url'
        })])
      });
  });

  it('rejects panorama scenes on a video experience', async () => {
    const project = videoProject({
      scenes: [{
        id: 'scene-1',
        projectId: 'project-1',
        name: 'Lobby',
        panoramaAssetId: 'asset-panorama',
        hotspots: []
      }]
    });

    await expect(createCompiler().compile(compilerInput({ project })))
      .rejects.toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({
          code: 'CAPABILITY_UNSUPPORTED',
          path: 'scenes'
        })])
      });
  });
});
