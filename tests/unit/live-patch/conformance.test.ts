import { describe, expect, it } from 'vitest';

import { compile, type CompilerInput } from '@alishaikh110/experience-compiler';
import type {
  CanonicalHotspot,
  CanonicalOverlay,
  CanonicalProject,
  CanonicalScene
} from '@alishaikh110/experience-schema';
import {
  LIVE_MUTATION_NAMES,
  LIVE_PATCH_CLASSIFICATIONS,
  LIVE_PATCH_CONTRACT_VERSION,
  applyLiveMutation,
  classifyProperty,
  liveMutationName,
  liveProperties,
  type LiveMutation
} from '@alishaikh110/live-patch';

import { goldenCompileInput } from '../../golden/record';
import { goldenScenarios } from '../../golden/scenarios';

const SCENE_ID = '22222222-2222-4000-8000-000000000009';
const HOTSPOT_ID = '33333333-4444-4000-8000-000000000001';
const OVERLAY_ID = '22222222-6666-4000-8000-000000000001';

function position(longitudeDegrees: number, latitudeDegrees: number) {
  return { coordinateSystem: 'spherical_degrees' as const, longitudeDegrees, latitudeDegrees };
}

/**
 * One experience carrying every shape the live properties touch: a hotspot
 * with appearance and content, an overlay with appearance, and configured
 * automatic rotation.
 */
function baseInput(): CompilerInput {
  const scenario = goldenScenarios().find((entry) => entry.id === 'image360-overlays-and-layers')!;
  const input = goldenCompileInput(scenario);
  const scene = input.project.scenes[0]!;
  const hotspot: CanonicalHotspot = {
    id: HOTSPOT_ID,
    sceneId: SCENE_ID,
    geometry: { kind: 'point' },
    position: position(12, 4),
    appearance: { label: 'Entrance', color: '#123456', emphasis: 'normal' },
    content: { title: 'Entrance', description: 'The main door.', tooltip: 'Go in' },
    action: { kind: 'showInformation' },
    visibilityRules: { enabled: true }
  };
  const project: CanonicalProject = {
    ...input.project,
    settings: {
      ...input.project.settings,
      autorotation: {
        enabled: true,
        speedDegreesPerSecond: 2,
        direction: 'clockwise',
        startAutomatically: true
      }
    },
    scenes: [{ ...scene, id: SCENE_ID, hotspots: [hotspot] } as CanonicalScene]
  };
  return { ...input, project };
}

/** The same experience with the change made canonically instead. */
function withCanonicalChange(
  edit: (project: CanonicalProject) => CanonicalProject
): CompilerInput {
  const input = baseInput();
  return { ...input, project: edit(input.project) };
}

function editHotspot(
  project: CanonicalProject,
  change: (hotspot: CanonicalHotspot) => CanonicalHotspot
): CanonicalProject {
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      hotspots: scene.hotspots.map((hotspot) => (
        hotspot.id === HOTSPOT_ID ? change(hotspot) : hotspot
      ))
    }))
  };
}

function editOverlay(
  project: CanonicalProject,
  change: (overlay: CanonicalOverlay) => CanonicalOverlay
): CanonicalProject {
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      overlays: (scene.overlays ?? []).map((overlay) => (
        overlay.id === OVERLAY_ID ? change(overlay) : overlay
      ))
    }))
  };
}

interface ConformanceCase {
  readonly property: string;
  readonly mutation: LiveMutation;
  readonly canonical: (project: CanonicalProject) => CanonicalProject;
}

const CASES: readonly ConformanceCase[] = [
  {
    property: 'scenes[].hotspots[].position',
    mutation: {
      kind: 'setHotspotPosition',
      sceneId: SCENE_ID,
      hotspotId: HOTSPOT_ID,
      position: position(-33.5, 12.25)
    },
    canonical: (project) => editHotspot(project, (hotspot) => ({
      ...hotspot,
      position: position(-33.5, 12.25)
    }))
  },
  {
    property: 'scenes[].hotspots[].appearance.color',
    mutation: {
      kind: 'setHotspotColor',
      sceneId: SCENE_ID,
      hotspotId: HOTSPOT_ID,
      color: '#ff8800'
    },
    canonical: (project) => editHotspot(project, (hotspot) => ({
      ...hotspot,
      appearance: { ...hotspot.appearance!, color: '#ff8800' }
    }))
  },
  {
    property: 'scenes[].hotspots[].appearance.color (cleared)',
    mutation: { kind: 'setHotspotColor', sceneId: SCENE_ID, hotspotId: HOTSPOT_ID },
    canonical: (project) => editHotspot(project, (hotspot) => {
      const appearance = { ...hotspot.appearance! };
      delete appearance.color;
      return { ...hotspot, appearance };
    })
  },
  {
    property: 'scenes[].hotspots[].appearance.label',
    mutation: {
      kind: 'setHotspotLabel',
      sceneId: SCENE_ID,
      hotspotId: HOTSPOT_ID,
      label: 'Main entrance <script>alert(1)</script>'
    },
    canonical: (project) => editHotspot(project, (hotspot) => ({
      ...hotspot,
      appearance: { ...hotspot.appearance!, label: 'Main entrance <script>alert(1)</script>' }
    }))
  },
  {
    property: 'scenes[].hotspots[].content.tooltip',
    mutation: {
      kind: 'setHotspotTooltip',
      sceneId: SCENE_ID,
      hotspotId: HOTSPOT_ID,
      tooltip: 'Step inside'
    },
    canonical: (project) => editHotspot(project, (hotspot) => ({
      ...hotspot,
      content: { ...hotspot.content!, tooltip: 'Step inside' }
    }))
  },
  {
    property: 'scenes[].hotspots[].visibilityRules.enabled',
    mutation: {
      kind: 'setHotspotEnabled',
      sceneId: SCENE_ID,
      hotspotId: HOTSPOT_ID,
      enabled: false
    },
    canonical: (project) => editHotspot(project, (hotspot) => ({
      ...hotspot,
      visibilityRules: { enabled: false }
    }))
  },
  {
    property: 'scenes[].overlays[].appearance.color',
    mutation: {
      kind: 'setOverlayColor',
      sceneId: SCENE_ID,
      overlayId: OVERLAY_ID,
      color: '#00aa55'
    },
    canonical: (project) => editOverlay(project, (overlay) => ({
      ...overlay,
      appearance: { ...overlay.appearance!, color: '#00aa55' }
    }))
  },
  {
    property: 'scenes[].overlays[].appearance.fillOpacity',
    mutation: {
      kind: 'setOverlayFillOpacity',
      sceneId: SCENE_ID,
      overlayId: OVERLAY_ID,
      fillOpacity: 0.75
    },
    canonical: (project) => editOverlay(project, (overlay) => ({
      ...overlay,
      appearance: { ...overlay.appearance!, fillOpacity: 0.75 }
    }))
  },
  {
    property: 'scenes[].overlays[].visibilityRules.enabled',
    mutation: {
      kind: 'setOverlayEnabled',
      sceneId: SCENE_ID,
      overlayId: OVERLAY_ID,
      enabled: false
    },
    canonical: (project) => editOverlay(project, (overlay) => ({
      ...overlay,
      visibilityRules: { enabled: false }
    }))
  },
  {
    property: 'settings.autorotation.speedDegreesPerSecond',
    mutation: { kind: 'setAutoRotation', speedDegreesPerSecond: 8 },
    canonical: (project) => ({
      ...project,
      settings: {
        ...project.settings,
        autorotation: { ...project.settings.autorotation!, speedDegreesPerSecond: 8 }
      }
    })
  },
  {
    property: 'settings.autorotation.direction',
    mutation: { kind: 'setAutoRotation', direction: 'counterclockwise' },
    canonical: (project) => ({
      ...project,
      settings: {
        ...project.settings,
        autorotation: { ...project.settings.autorotation!, direction: 'counterclockwise' }
      }
    })
  },
  {
    property: 'settings.autorotation.startAutomatically',
    mutation: { kind: 'setAutoRotation', startAutomatically: false },
    canonical: (project) => ({
      ...project,
      settings: {
        ...project.settings,
        autorotation: { ...project.settings.autorotation!, startAutomatically: false }
      }
    })
  }
];

/**
 * Patch equals recompile.
 *
 * For every property the table calls live, applying the enumerated mutation to
 * a compiled manifest must produce exactly what compiling the same change
 * canonically produces. When the two ever disagree this fails here, rather
 * than a customer seeing a preview that lied about what they published.
 */
describe('live-patch conformance', () => {
  for (const testCase of CASES) {
    it(`patching ${testCase.property} equals recompiling it`, () => {
      const compiledA = compile(baseInput());
      const patched = applyLiveMutation(compiledA.manifest, testCase.mutation);
      const compiledB = compile(withCanonicalChange(testCase.canonical));
      expect(JSON.stringify(patched)).toBe(JSON.stringify(compiledB.manifest));
    });
  }

  it('changes something, so an equality that always held would be noticed', () => {
    const compiledA = compile(baseInput());
    for (const testCase of CASES) {
      const patched = applyLiveMutation(compiledA.manifest, testCase.mutation);
      expect(JSON.stringify(patched), testCase.property)
        .not.toBe(JSON.stringify(compiledA.manifest));
    }
  });

  it('names a mutation for every live property, and only known mutations', () => {
    const live = liveProperties();
    expect(live.length).toBeGreaterThan(0);
    for (const entry of live) {
      expect(entry.mutation, entry.path).toBeDefined();
      expect(LIVE_MUTATION_NAMES).toContain(entry.mutation!);
    }
    // Every mutation the classification names is covered by a conformance case.
    const covered = new Set(CASES.map((testCase) => liveMutationName(testCase.mutation)));
    for (const entry of live) {
      expect(covered, `${entry.path} has no conformance case`).toContain(entry.mutation!);
    }
  });

  it('defaults an unclassified property to recompile, never to live', () => {
    for (const path of [
      'settings.somethingNobodyHasWrittenYet',
      'scenes[3].hotspots[1].appearance.emphasis',
      'scenes[0].runtimeHints.qualityPreference',
      'branding.primaryColor'
    ]) {
      expect(classifyProperty(path).class, path).toBe('recompile');
    }
    expect(classifyProperty('scenes[0].hotspots[0].position').class).toBe('live');
    expect(classifyProperty('scenes[0].panoramaAssetId').class).toBe('remount');
    // Turning automatic rotation on or off resolves a capability, so only its
    // timing is live; the switch itself is a recompile.
    expect(classifyProperty('settings.autorotation.speedDegreesPerSecond').class).toBe('live');
    expect(classifyProperty('settings.autorotation.enabled').class).toBe('recompile');
    // A property nested under a live one is not itself live.
    expect(classifyProperty('scenes[0].hotspots[0].position.longitudeDegrees').class)
      .toBe('recompile');
  });

  it('classifies no property as live without an enumerated mutation', () => {
    for (const entry of LIVE_PATCH_CLASSIFICATIONS) {
      if (entry.class === 'live') expect(entry.mutation, entry.path).toBeDefined();
      else expect(entry.mutation, entry.path).toBeUndefined();
    }
    expect(LIVE_PATCH_CONTRACT_VERSION).toBe('live-patch-1');
  });

  it('refuses to re-time rotation an experience does not have', () => {
    const scenario = goldenScenarios().find((entry) => entry.id === 'image360-single-scene')!;
    const manifest = compile(goldenCompileInput(scenario)).manifest;
    expect(() => applyLiveMutation(manifest, {
      kind: 'setAutoRotation',
      speedDegreesPerSecond: 4
    })).toThrow(/no automatic rotation to re-time/u);
  });

  it('refuses a mutation aimed at something this manifest does not carry', () => {
    const manifest = compile(baseInput()).manifest;
    expect(() => applyLiveMutation(manifest, {
      kind: 'setHotspotColor',
      sceneId: SCENE_ID,
      hotspotId: '00000000-0000-4000-8000-000000000000',
      color: '#ffffff'
    })).toThrow(/hotspot is not part of this compiled scene/u);
    expect(() => applyLiveMutation(manifest, {
      kind: 'setHotspotColor',
      sceneId: '00000000-0000-4000-8000-000000000000',
      hotspotId: HOTSPOT_ID,
      color: '#ffffff'
    })).toThrow(/scene is not part of this compiled manifest/u);
  });
});
