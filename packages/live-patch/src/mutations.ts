import {
  compileCanonicalSettings,
  compileHotspotAppearanceValues,
  compileHotspotContentValues,
  compileOverlayAppearance,
  isImageExperienceManifest,
  type CanonicalHotspot,
  type CanonicalOverlay,
  type CanonicalProjectSettings,
  type CompiledExperienceManifest,
  type CompiledHotspot,
  type CompiledOverlay,
  type CompiledScene,
  type SphericalPosition,
} from '@alishaikh110/experience-compiler';
import { createViewerIntegrationAdapter } from '@alishaikh110/viewer-integration';

import type { LiveMutationName } from './classification';

/**
 * The enumerated mutations a live property is applied with.
 *
 * Each one names the running-viewer operation an editor performs and, applied
 * to a compiled manifest here, produces exactly what recompiling the same
 * change would produce. The conformance suite is what holds those two
 * together; without it a preview would eventually start lying.
 */
export type LiveMutation =
  | {
    readonly kind: 'setHotspotPosition';
    readonly sceneId: string;
    readonly hotspotId: string;
    readonly position: SphericalPosition;
  }
  | {
    readonly kind: 'setHotspotColor';
    readonly sceneId: string;
    readonly hotspotId: string;
    readonly color?: string;
  }
  | {
    readonly kind: 'setHotspotLabel';
    readonly sceneId: string;
    readonly hotspotId: string;
    readonly label?: string;
  }
  | {
    readonly kind: 'setHotspotTooltip';
    readonly sceneId: string;
    readonly hotspotId: string;
    readonly tooltip?: string;
  }
  | {
    readonly kind: 'setHotspotEnabled';
    readonly sceneId: string;
    readonly hotspotId: string;
    readonly enabled?: boolean;
  }
  | {
    readonly kind: 'setOverlayColor';
    readonly sceneId: string;
    readonly overlayId: string;
    readonly color?: string;
  }
  | {
    readonly kind: 'setOverlayFillOpacity';
    readonly sceneId: string;
    readonly overlayId: string;
    readonly fillOpacity?: number;
  }
  | {
    readonly kind: 'setOverlayEnabled';
    readonly sceneId: string;
    readonly overlayId: string;
    readonly enabled?: boolean;
  }
  | {
    /**
     * Re-times automatic rotation. Whether rotation is enabled at all is a
     * capability, and capabilities resolve at compile time, so turning it on
     * or off is a recompile rather than a mutation.
     */
    readonly kind: 'setAutoRotation';
    readonly speedDegreesPerSecond?: number;
    readonly direction?: 'clockwise' | 'counterclockwise';
    readonly startAutomatically?: boolean;
  };

export class LiveMutationError extends Error {
  readonly code = 'LIVE_MUTATION_NOT_APPLICABLE';

  constructor(message: string) {
    super(message);
    this.name = 'LiveMutationError';
  }
}

/** The mutation name a `LiveMutation` corresponds to in the classification table. */
export function liveMutationName(mutation: LiveMutation): LiveMutationName {
  return mutation.kind;
}

type AppearanceProperties = NonNullable<CanonicalHotspot['appearance']>;
type ContentProperties = NonNullable<CanonicalHotspot['content']>;
type OverlayAppearanceProperties = NonNullable<CanonicalOverlay['appearance']>;

/**
 * A compiled appearance carries its own authored values under `properties`,
 * so a change can be recompiled from the manifest alone without going back to
 * the draft. The same is true of content and of overlay appearance.
 */
function authoredAppearance(hotspot: CompiledHotspot): AppearanceProperties {
  return (hotspot.appearance?.properties ?? {}) as unknown as AppearanceProperties;
}

function authoredContent(hotspot: CompiledHotspot): ContentProperties {
  return (hotspot.content?.properties ?? {}) as unknown as ContentProperties;
}

function authoredOverlayAppearance(overlay: CompiledOverlay): OverlayAppearanceProperties {
  return (overlay.appearance?.properties ?? {}) as unknown as OverlayAppearanceProperties;
}

/**
 * Drops keys whose value is undefined.
 *
 * Clearing an authored value means the property is absent, not present and
 * empty, which is what the compiler emits and therefore what a patch has to.
 */
function withoutUndefined<T>(value: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function isEmpty(value: object): boolean {
  return Object.keys(value).length === 0;
}

/**
 * Rebuilds a compiled hotspot in the compiler's own field order.
 *
 * Order matters because the patched manifest is compared byte for byte with a
 * recompiled one; a field appended in the wrong place is a real difference
 * even when the values match.
 */
function rebuildHotspot(
  hotspot: CompiledHotspot,
  changes: {
    readonly position?: SphericalPosition;
    readonly appearance?: AppearanceProperties;
    readonly content?: ContentProperties;
    readonly enabled?: boolean | undefined;
    readonly enabledChanged?: boolean;
  }
): CompiledHotspot {
  const appearance = changes.appearance === undefined
    ? hotspot.appearance
    : isEmpty(changes.appearance)
      ? undefined
      : {
        ...compileHotspotAppearanceValues(changes.appearance),
        ...(hotspot.appearance?.icon === undefined ? {} : { icon: hotspot.appearance.icon }),
      };
  const content = changes.content === undefined
    ? hotspot.content
    : isEmpty(changes.content)
      ? undefined
      : (() => {
        const { properties, ...fields } = compileHotspotContentValues(changes.content);
        return {
          ...fields,
          ...(hotspot.content?.image === undefined ? {} : { image: hotspot.content.image }),
          ...(hotspot.content?.video === undefined ? {} : { video: hotspot.content.video }),
          properties,
        };
      })();
  const enabled = changes.enabledChanged === true ? changes.enabled : hotspot.enabled;
  const visibilityRules = changes.enabledChanged === true
    ? (changes.enabled === undefined ? {} : { enabled: changes.enabled })
    : hotspot.visibilityRules;
  return {
    id: hotspot.id,
    geometry: hotspot.geometry,
    position: changes.position === undefined ? hotspot.position : { ...changes.position },
    ...(appearance === undefined ? {} : { appearance }),
    ...(content === undefined ? {} : { content }),
    action: hotspot.action,
    enabled: enabled ?? true,
    visibilityRules,
  };
}

/** Rebuilds a compiled overlay in the compiler's own field order. */
function rebuildOverlay(
  overlay: CompiledOverlay,
  changes: {
    readonly appearance?: OverlayAppearanceProperties;
    readonly enabled?: boolean | undefined;
    readonly enabledChanged?: boolean;
  }
): CompiledOverlay {
  const appearance = changes.appearance === undefined
    ? overlay.appearance
    : isEmpty(changes.appearance)
      ? undefined
      : compileOverlayAppearance(changes.appearance);
  const enabled = changes.enabledChanged === true ? changes.enabled : overlay.enabled;
  const visibilityRules = changes.enabledChanged === true
    ? (changes.enabled === undefined ? {} : { enabled: changes.enabled })
    : overlay.visibilityRules;
  return {
    id: overlay.id,
    ...(overlay.name === undefined ? {} : { name: overlay.name }),
    geometry: overlay.geometry,
    ...(overlay.position === undefined ? {} : { position: overlay.position }),
    ...(appearance === undefined ? {} : { appearance }),
    ...(overlay.content === undefined ? {} : { content: overlay.content }),
    action: overlay.action,
    enabled: enabled ?? true,
    visibilityRules,
  };
}

function replaceScene(
  manifest: CompiledExperienceManifest,
  sceneId: string,
  replace: (scene: CompiledScene) => CompiledScene
): readonly CompiledScene[] {
  if (!isImageExperienceManifest(manifest)) {
    throw new LiveMutationError('This mutation applies only to a 360 image experience.');
  }
  const target = manifest.scenes.find((scene) => scene.id === sceneId);
  if (target === undefined) {
    // A progressive tour ships only its initial scene, so an edit to a scene
    // that is not in the manifest has to be recompiled rather than patched.
    throw new LiveMutationError('That scene is not part of this compiled manifest.');
  }
  return manifest.scenes.map((scene) => (scene.id === sceneId ? replace(scene) : scene));
}

function requireHotspot(scene: CompiledScene, hotspotId: string): CompiledHotspot {
  const hotspot = scene.hotspots.find((candidate) => candidate.id === hotspotId);
  if (hotspot === undefined) {
    throw new LiveMutationError('That hotspot is not part of this compiled scene.');
  }
  return hotspot;
}

function requireOverlay(scene: CompiledScene, overlayId: string): CompiledOverlay {
  const overlay = scene.overlays.find((candidate) => candidate.id === overlayId);
  if (overlay === undefined) {
    throw new LiveMutationError('That overlay is not part of this compiled scene.');
  }
  return overlay;
}

/** Regenerates renderer configuration from the patched manifest. */
function withViewerIntegration(
  manifest: CompiledExperienceManifest
): CompiledExperienceManifest {
  const adapter = createViewerIntegrationAdapter(manifest.viewerIntegrationVersion);
  const viewerIntegration = isImageExperienceManifest(manifest)
    ? adapter.adapt({
      initialSceneId: manifest.initialSceneId,
      settings: manifest.settings,
      branding: manifest.branding,
      scenes: manifest.scenes,
      sceneIndex: manifest.tour.sceneIndex,
      plans: manifest.plans,
      spatialIndex: manifest.spatialIndex,
      capabilities: manifest.capabilities.map((capability) => capability.id),
    })
    : adapter.adaptVideo({
      settings: manifest.settings,
      branding: manifest.branding,
      video: manifest.video,
      timeline: manifest.timeline,
    });
  return { ...manifest, viewerIntegration };
}

/**
 * Applies one enumerated mutation to a compiled manifest.
 *
 * Pure: the result is a new manifest, and the same mutation on the same input
 * always produces the same bytes — the bytes recompiling would have produced.
 */
export function applyLiveMutation(
  manifest: CompiledExperienceManifest,
  mutation: LiveMutation
): CompiledExperienceManifest {
  switch (mutation.kind) {
    case 'setHotspotPosition':
    case 'setHotspotColor':
    case 'setHotspotLabel':
    case 'setHotspotTooltip':
    case 'setHotspotEnabled': {
      const scenes = replaceScene(manifest, mutation.sceneId, (scene) => {
        const hotspot = requireHotspot(scene, mutation.hotspotId);
        const hotspots = scene.hotspots.map((candidate) => {
          if (candidate.id !== mutation.hotspotId) return candidate;
          switch (mutation.kind) {
            case 'setHotspotPosition':
              return rebuildHotspot(hotspot, { position: mutation.position });
            case 'setHotspotColor':
              return rebuildHotspot(hotspot, {
                appearance: withoutUndefined<AppearanceProperties>({
                  ...authoredAppearance(hotspot),
                  color: mutation.color,
                }),
              });
            case 'setHotspotLabel':
              return rebuildHotspot(hotspot, {
                appearance: withoutUndefined<AppearanceProperties>({
                  ...authoredAppearance(hotspot),
                  label: mutation.label,
                }),
              });
            case 'setHotspotTooltip':
              return rebuildHotspot(hotspot, {
                content: withoutUndefined<ContentProperties>({
                  ...authoredContent(hotspot),
                  tooltip: mutation.tooltip,
                }),
              });
            default:
              return rebuildHotspot(hotspot, {
                enabled: mutation.enabled,
                enabledChanged: true,
              });
          }
        });
        return { ...scene, hotspots };
      });
      return withViewerIntegration({ ...manifest, scenes } as CompiledExperienceManifest);
    }

    case 'setOverlayColor':
    case 'setOverlayFillOpacity':
    case 'setOverlayEnabled': {
      const scenes = replaceScene(manifest, mutation.sceneId, (scene) => {
        const overlay = requireOverlay(scene, mutation.overlayId);
        const overlays = scene.overlays.map((candidate) => {
          if (candidate.id !== mutation.overlayId) return candidate;
          switch (mutation.kind) {
            case 'setOverlayColor':
              return rebuildOverlay(overlay, {
                appearance: withoutUndefined<OverlayAppearanceProperties>({
                  ...authoredOverlayAppearance(overlay),
                  color: mutation.color,
                }),
              });
            case 'setOverlayFillOpacity':
              return rebuildOverlay(overlay, {
                appearance: withoutUndefined<OverlayAppearanceProperties>({
                  ...authoredOverlayAppearance(overlay),
                  fillOpacity: mutation.fillOpacity,
                }),
              });
            default:
              return rebuildOverlay(overlay, {
                enabled: mutation.enabled,
                enabledChanged: true,
              });
          }
        });
        return { ...scene, overlays };
      });
      return withViewerIntegration({ ...manifest, scenes } as CompiledExperienceManifest);
    }

    case 'setAutoRotation': {
      const current = manifest.settings.autorotation;
      if (current === undefined) {
        throw new LiveMutationError(
          'This experience has no automatic rotation to re-time; recompile instead.'
        );
      }
      const settings = compileCanonicalSettings({
        ...manifest.settings,
        autorotation: withoutUndefined<NonNullable<CanonicalProjectSettings['autorotation']>>({
          ...current,
          ...(mutation.speedDegreesPerSecond === undefined
            ? {}
            : { speedDegreesPerSecond: mutation.speedDegreesPerSecond }),
          ...(mutation.direction === undefined ? {} : { direction: mutation.direction }),
          ...(mutation.startAutomatically === undefined
            ? {}
            : { startAutomatically: mutation.startAutomatically }),
        }),
      });
      return withViewerIntegration({ ...manifest, settings });
    }
  }
}
