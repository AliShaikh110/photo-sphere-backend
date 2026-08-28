/**
 * How a change to a canonical property reaches a running preview.
 *
 * `live`     the running viewer is mutated in place by an enumerated operation
 * `recompile` the compiler runs again; the viewer instance is reused
 * `remount`  the viewer is destroyed and rebuilt
 */
export type LivePatchClass = 'live' | 'recompile' | 'remount';

/** The enumerated mutations a live property may be applied with. */
export const LIVE_MUTATION_NAMES = [
  'setHotspotPosition',
  'setHotspotColor',
  'setHotspotLabel',
  'setHotspotTooltip',
  'setHotspotEnabled',
  'setOverlayColor',
  'setOverlayFillOpacity',
  'setOverlayEnabled',
  'setAutoRotation',
] as const;
export type LiveMutationName = (typeof LIVE_MUTATION_NAMES)[number];

export interface LivePropertyClassification {
  /** A canonical property path; `[]` stands for any index. */
  readonly path: string;
  readonly class: LivePatchClass;
  /** Required for every `live` property: the mutation that applies it. */
  readonly mutation?: LiveMutationName;
  readonly summary: string;
}

/**
 * The version of this table.
 *
 * An editor is built against a specific classification. Returning the version
 * in the bootstrap response lets a client that was built against an older one
 * fall back to recompiling rather than applying a mutation the server no
 * longer agrees with.
 */
export const LIVE_PATCH_CONTRACT_VERSION = 'live-patch-1' as const;

/**
 * The classification table.
 *
 * A property that is not listed is `recompile`. That default is deliberate and
 * one-directional: treating a recompile property as live shows a creator a
 * preview that lied, while treating a live property as a recompile only costs
 * a round trip.
 */
export const LIVE_PATCH_CLASSIFICATIONS: readonly LivePropertyClassification[] = Object.freeze([
  // Live — an enumerated mutation on the running viewer.
  Object.freeze({
    path: 'scenes[].hotspots[].position',
    class: 'live' as const,
    mutation: 'setHotspotPosition' as const,
    summary: 'Moves a hotspot without reloading the scene.',
  }),
  Object.freeze({
    path: 'scenes[].hotspots[].appearance.color',
    class: 'live' as const,
    mutation: 'setHotspotColor' as const,
    summary: 'Recolours a hotspot marker.',
  }),
  Object.freeze({
    path: 'scenes[].hotspots[].appearance.label',
    class: 'live' as const,
    mutation: 'setHotspotLabel' as const,
    summary: 'Retitles a hotspot marker.',
  }),
  Object.freeze({
    path: 'scenes[].hotspots[].content.tooltip',
    class: 'live' as const,
    mutation: 'setHotspotTooltip' as const,
    summary: 'Changes the text shown when a visitor hovers a hotspot.',
  }),
  Object.freeze({
    path: 'scenes[].hotspots[].visibilityRules.enabled',
    class: 'live' as const,
    mutation: 'setHotspotEnabled' as const,
    summary: 'Shows or hides a hotspot.',
  }),
  Object.freeze({
    path: 'scenes[].overlays[].appearance.color',
    class: 'live' as const,
    mutation: 'setOverlayColor' as const,
    summary: 'Recolours an overlay.',
  }),
  Object.freeze({
    path: 'scenes[].overlays[].appearance.fillOpacity',
    class: 'live' as const,
    mutation: 'setOverlayFillOpacity' as const,
    summary: 'Changes how solid an overlay looks.',
  }),
  Object.freeze({
    path: 'scenes[].overlays[].visibilityRules.enabled',
    class: 'live' as const,
    mutation: 'setOverlayEnabled' as const,
    summary: 'Shows or hides an overlay.',
  }),
  Object.freeze({
    path: 'settings.autorotation.speedDegreesPerSecond',
    class: 'live' as const,
    mutation: 'setAutoRotation' as const,
    summary: 'Re-times automatic rotation while it stays enabled.',
  }),
  Object.freeze({
    path: 'settings.autorotation.direction',
    class: 'live' as const,
    mutation: 'setAutoRotation' as const,
    summary: 'Reverses automatic rotation while it stays enabled.',
  }),
  Object.freeze({
    path: 'settings.autorotation.startAutomatically',
    class: 'live' as const,
    mutation: 'setAutoRotation' as const,
    summary: 'Changes whether rotation begins on load, while it stays enabled.',
  }),

  // Recompile — the compiler runs again, the viewer instance is reused.
  Object.freeze({
    path: 'scenes[]',
    class: 'recompile' as const,
    summary: 'Adding, removing or reordering a scene changes the tour delivery.',
  }),
  Object.freeze({
    path: 'scenes[].connections',
    class: 'recompile' as const,
    summary: 'Connections drive preloading and the scene index.',
  }),
  Object.freeze({
    path: 'scenes[].hotspots[].action',
    class: 'recompile' as const,
    summary: 'An action can reference an asset or a scene that must be resolved.',
  }),
  Object.freeze({
    path: 'scenes[].hotspots[].geometry',
    class: 'recompile' as const,
    summary: 'Layer and custom geometry resolve media and extension registrations.',
  }),
  Object.freeze({
    path: 'scenes[].overlays[].geometry',
    class: 'recompile' as const,
    summary: 'Overlay geometry resolves media and extension registrations.',
  }),
  Object.freeze({
    path: 'scenes[].viewLimits',
    class: 'recompile' as const,
    summary: 'View limits are part of the compiled scene contract.',
  }),
  Object.freeze({
    path: 'scenes[].spatialData',
    class: 'recompile' as const,
    summary: 'Placement feeds the spatial index and the plan and map views.',
  }),
  Object.freeze({
    path: 'settings.autorotation.enabled',
    class: 'recompile' as const,
    summary: 'Automatic rotation is a capability, and capabilities resolve at compile time.',
  }),
  Object.freeze({
    path: 'settings.gallery',
    class: 'recompile' as const,
    summary: 'The gallery is a capability, and capabilities resolve at compile time.',
  }),
  Object.freeze({
    path: 'settings.map',
    class: 'recompile' as const,
    summary: 'The map is a capability, and capabilities resolve at compile time.',
  }),
  Object.freeze({
    path: 'settings.plan',
    class: 'recompile' as const,
    summary: 'Plans are a capability, and capabilities resolve at compile time.',
  }),
  Object.freeze({
    path: 'settings.quality',
    class: 'recompile' as const,
    summary: 'Quality selects a delivery family and its fallbacks.',
  }),
  Object.freeze({
    path: 'branding',
    class: 'recompile' as const,
    summary: 'Branding resolves logo, favicon and watermark media.',
  }),
  Object.freeze({
    path: 'plans',
    class: 'recompile' as const,
    summary: 'A plan resolves its image and the scenes placed on it.',
  }),
  Object.freeze({
    path: 'timeline',
    class: 'recompile' as const,
    summary: 'Timed interactions resolve media and are ordered at compile time.',
  }),

  // Remount — the viewer is destroyed and rebuilt.
  Object.freeze({
    path: 'type',
    class: 'remount' as const,
    summary: 'An image experience and a video experience are different viewers.',
  }),
  Object.freeze({
    path: 'scenes[].panoramaAssetId',
    class: 'remount' as const,
    summary: 'Swapping the panorama replaces the texture the viewer was built on.',
  }),
  Object.freeze({
    path: 'videoAssetId',
    class: 'remount' as const,
    summary: 'Swapping the video replaces the media element playback is bound to.',
  }),
  Object.freeze({
    path: 'settings.immersiveViewing',
    class: 'remount' as const,
    summary: 'Stereo and immersive viewing change how the viewer is constructed.',
  }),
  Object.freeze({
    path: 'settings.motionNavigation',
    class: 'remount' as const,
    summary: 'Motion navigation attaches device sensors at construction.',
  }),
]);

const byPath = new Map(
  LIVE_PATCH_CLASSIFICATIONS.map((entry) => [entry.path, entry])
);

/** Turns a concrete property path into the pattern the table is keyed by. */
export function toClassificationPath(path: string): string {
  return path.replace(/\[\d+\]/gu, '[]');
}

/**
 * The classification for a property path.
 *
 * An unclassified property is `recompile`, and so is any property nested under
 * one, unless it is itself classified. Nothing is ever `live` by default.
 */
export function classifyProperty(path: string): LivePropertyClassification {
  const normalized = toClassificationPath(path);
  const exact = byPath.get(normalized);
  if (exact !== undefined) return exact;
  // Fall back to the closest classified ancestor, longest first, so a specific
  // entry always wins over the segment that contains it.
  const ancestors = [...byPath.keys()]
    .filter((candidate) => normalized.startsWith(`${candidate}.`)
      || normalized.startsWith(`${candidate}[`))
    .sort((left, right) => right.length - left.length);
  for (const ancestor of ancestors) {
    const entry = byPath.get(ancestor)!;
    // An ancestor never confers `live`: the mutation named there applies to
    // that property, not to something nested inside it.
    if (entry.class !== 'live') return entry;
    return {
      path: normalized,
      class: 'recompile',
      summary: 'Not classified; recompiling is always correct.',
    };
  }
  return {
    path: normalized,
    class: 'recompile',
    summary: 'Not classified; recompiling is always correct.',
  };
}

/** Every property the table declares live, with the mutation that applies it. */
export function liveProperties(): readonly LivePropertyClassification[] {
  return LIVE_PATCH_CLASSIFICATIONS.filter((entry) => entry.class === 'live');
}
