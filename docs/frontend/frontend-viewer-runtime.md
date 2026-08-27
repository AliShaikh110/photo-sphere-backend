# Viewer Runtime & Renderer Integration Contract

The Viewer Runtime is the single frontend module that turns a **compiled
manifest** into a running Photo Sphere Viewer experience. It is the core product
component ([frontend_trd.md](frontend_trd.md) §8 and §12) and is shared by the
draft preview (`/viewer/[projectId]`) and the published player (`/view/[slug]`).

Nothing outside this module may import Photo Sphere Viewer, mention yaw, pitch,
radians, adapters or plugins, or construct renderer configuration.

---

## 1. Position and packages

```text
Manifest  ──►  Runtime Host  ──►  Module Registry  ──►  Photo Sphere Viewer 5.14.3
(product)      (lifecycle,        (lazy imports of      (rendering only)
                policy, events)    adapters/plugins)
```

Pin every renderer package at **5.14.3** to match
`viewerIntegrationVersion: psv-5.14.3-adapter-2`:

`@photo-sphere-viewer/core`, `equirectangular-tiles-adapter`,
`equirectangular-video-adapter`, `cubemap-adapter`, `cubemap-tiles-adapter`,
`cubemap-video-adapter`, `markers-plugin`, `virtual-tour-plugin`,
`gallery-plugin`, `compass-plugin`, `map-plugin`, `plan-plugin`,
`gyroscope-plugin`, `stereo-plugin`, `video-plugin`, `resolution-plugin`,
`overlays-plugin`, plus `three` at the version those packages require.

Only `@photo-sphere-viewer/core` and the markers plugin are eager. Everything
else loads on demand (§4).

Upgrading the renderer is a coordinated change: the backend registers a new
adapter version, runs the reference suite and rolls it out
(`GET /api/v1/platform/viewer-integrations`). The frontend must tolerate
receiving either the active or the candidate `viewerIntegrationVersion` in a
manifest and must report the version it actually rendered with in telemetry.

---

## 2. What the runtime consumes

The runtime's only input is a compiled manifest. Its exact shape is
`CompiledExperienceManifest` in `src/compiler/types.ts`; the fields the runtime
must read are:

### 2.1 Common

| Field | Use |
| --- | --- |
| `manifestVersion` | **Must equal `4`.** Any other value is a hard, explicit failure (PRD BE-002) — never a best-effort render. |
| `schemaVersion`, `experienceId`, `projectRevision`, `publicationRevision` | Identity and telemetry attribution. |
| `experienceType` | Discriminates the payload: `image360` or `video360`. |
| `target` | `preview` or `publication`. Controls signed-URL refresh (§9). |
| `visibility` | `public` or `private`. |
| `viewerIntegrationVersion` | Telemetry, and the module-registry contract version. |
| `settings` | Product-level settings, already compiled. |
| `branding` | Logo, favicon, watermark, welcome/loading copy, colours. |
| `capabilities[]` | `{ id, required, fallback?, deviceRequirements?, resolution }`. |
| `runtime` | `modules`, `moduleDeclarations`, `capabilityFallbacks`, `deferredDeviceCapabilities`, `preload`, `cache`, `fallbackPolicy`. |
| `telemetry` | `ingestToken`, `ingestTokenExpiresAt`, allowed `events`, failure categories. |
| `pinnedExtensions` | Extension id to version for custom interactions. |
| `viewerIntegration` | `{ rendererId, viewerIntegrationVersion, config }` — see §5. |

### 2.2 `image360` only

`initialSceneId`, `scenes[]`, `tour`, `plans[]`, `spatialIndex`.

### 2.3 `video360` only

`video` (media, profiles, selection policy) and `timeline[]`.

---

## 3. Boot sequence

```text
1  fetch manifest              (public slug, session, or share token)
2  assert manifestVersion === 4
3  emit experience_load_started
4  evaluate deferredDeviceCapabilities against the real device
5  resolve the module set  = runtime.modules minus device-rejected capabilities
6  lazy-import those modules in parallel
7  construct the Viewer with the initial/startup scene configuration
8  load basePanorama (low-resolution) → first paint
      emit first_panorama_visible
9  upgrade to the primary or tiled panorama
10 mount markers, links, gallery, compass, map, plan, stereo, gyroscope
      emit time_to_interactive
11 start the preload policy for likely next scenes
12 register the unload handler → experience_exited
```

Steps 4–6 must complete before the Viewer is constructed: a capability the
device cannot support must never reach the renderer (PRD RUN-004).

---

## 4. Runtime module registry

`runtime.modules` is a list of platform module ids and
`runtime.moduleDeclarations[]` gives each one `{ id, load: 'eager' | 'lazy',
capabilities[] }`. The registry is a single map from module id to a dynamic
import. **Never** import a renderer package outside it.

| Module id | Renderer artefact | Load |
| --- | --- | --- |
| `core-panorama` | `@photo-sphere-viewer/core` (also serves autorotation and view limits) | eager |
| `hotspots` | `markers-plugin` | eager |
| `virtual-tour` | `virtual-tour-plugin` | eager when present |
| `gallery` | `gallery-plugin` | lazy |
| `compass` | `compass-plugin` | lazy |
| `equirectangular-tiles` | `equirectangular-tiles-adapter` | lazy |
| `resolution-selection` | `resolution-plugin` | lazy |
| `image-content` | Product image/lightbox surface (not a renderer plugin) | lazy |
| `video-content` | Product video content surface | lazy |
| `content-actions` | Product action handlers (links, CTA) | eager, tiny |
| `video-panorama` | `equirectangular-video-adapter` / `cubemap-video-adapter` | lazy |
| `video-timeline` | Product timeline scheduler + `video-plugin` | lazy |
| `map` | `map-plugin` | lazy |
| `plan` | `plan-plugin` | lazy |
| `gyroscope` | `gyroscope-plugin` | lazy |
| `stereo` | `stereo-plugin` | lazy |
| `immersive-viewing` | Immersive/VR entry built on the stereo plugin | lazy |
| `advanced-overlays` | `overlays-plugin` and layer marker support | lazy |
| `advanced-geometry` | Polygon/polyline marker support | lazy |
| `cubemap` | `cubemap-adapter` / `cubemap-tiles-adapter` | lazy |
| `extensions` | Extension host that loads allow-listed `runtimeModule` entry points | lazy |

Rules:

- An **unknown module id** is not fatal. Skip it, apply the capability's
  fallback, and emit `capability_fallback` with reason
  `FEATURE_UNAVAILABLE`. Forward compatibility beats a blank screen.
- Never load a module the manifest did not declare (PRD §14.1, product
  architecture §36.4).
- `extensions` may only load the `module` string carried inside a compiled
  `custom` geometry. That string is allow-listed at extension registration; the
  runtime resolves it against a **static local allow-list map** and loads
  nothing else. Never `import()` a string straight from a manifest.

---

## 5. `viewerIntegration.config` is a binder input, not PSV options

The backend adapter emits renderer-shaped JSON, but it is **not** a Photo Sphere
Viewer constructor object. `adapter` is a name, not a class; `gallery`, `map`,
`plan`, `compass`, `stereo`, `gyroscope` and `autorotation` are plugin
configurations, not viewer options; `touchControlsEnabled`, `sceneNavigation`
and `basePanorama` are platform keys with no PSV equivalent.

The runtime therefore contains one **binder** that translates this object into
the real constructor plus plugin list. The binder is the only file that changes
when the renderer integration version changes.

### 5.1 Image config keys

| Key | Meaning |
| --- | --- |
| `adapter` | `equirectangular` \| `equirectangular-tiles` \| `cubemap` \| `cubemap-tiles`. Selects the adapter class. |
| `initialSceneId` | Scene to construct with. |
| `navbar[]` | Ordered control ids: `move`, `zoom`, `gyroscope`, `stereo`, `fullscreen`, `compass`, `gallery`. |
| `mousewheel`, `mousemove`, `keyboard` | Direct viewer options. |
| `touchControlsEnabled` | Platform key. Bind to the renderer's touch behaviour; when `false`, touch navigation is disabled. |
| `sceneNavigation` | Platform key. Whether the virtual-tour module is mounted. |
| `gallery`, `compass`, `autorotation`, `map`, `plan`, `gyroscope`, `stereo` | Present only when enabled. Each maps to one plugin's options. |
| `startup` | The initial scene configuration object. |
| `scenes[]` | Scene configuration objects (only the scenes the manifest carries). |

### 5.2 Scene configuration keys

| Key | Meaning |
| --- | --- |
| `id`, `adapter` | Scene identity and its adapter family. |
| `panorama` | A URL string, **or** for tiles `{ baseUrl, tileUrlTemplate, tileSize, levels[] }`. |
| `basePanorama` | Low-resolution base URL. Platform key driving low-res-first (§6.2). |
| `panoData` | Cropped-panorama geometry. Pass through unchanged. |
| `sphereCorrection` | `{ pan, tilt, roll }` in radians, **already inverted** by the backend. Pass through; never recompute. |
| `defaultYaw`, `defaultPitch` | Radians. |
| `defaultZoomLvl` | 0–100, already converted from field of view. |
| `visibleRange` | `{ longitude: [min,max], latitude: [min,max] }` in radians. |
| `markers[]` | Hotspots and overlays, already renderer-shaped (§7). |
| `links[]` | `{ id, nodeId, label? }` — virtual-tour connections. |
| `preloadSceneIds[]` | The preload policy's recommendation for this scene. |

### 5.3 Video config keys

| Key | Meaning |
| --- | --- |
| `adapter` | `equirectangular-video` or `cubemap-video`. |
| `panorama.source` | Best-first default profile URL. |
| `panorama.sources[]` | `{ profileId, url, type, width, height, handheldSafe }`, ordered handheld-safe first. |
| `panorama.poster` | Poster URL when produced. |
| `video` | `{ autoplay, loop, muted, progressbar, bigbutton, durationMs, startAtMs? }`. |
| `timeline[]` | `{ id, kind, startTime (seconds), endTime?, visible, viewpoint?, data }`. |
| `markers[]` | Timed markers for interactions carrying a position. |

> Time units differ by design: canonical and manifest timeline values are
> milliseconds; `viewerIntegration.config.timeline[].startTime` is **seconds**.
> Use the manifest's `timeline[]` (`timeMs`) for product logic and the config's
> value only when binding the renderer.

---

## 6. Scene rendering

### 6.1 Family and fallback

`panorama.family` is one of `standardEquirectangular`, `tiledEquirectangular`,
`cubemap`, `tiledCubemap`; `panorama.fallbackFamilies[]` lists what to try if the
chosen family cannot be loaded. On failure, step down the fallback list before
declaring the scene failed, and emit `asset_failed` for each abandoned attempt.

### 6.2 Low-resolution first (PRD MED-003)

Always render `basePanorama` first, then upgrade:

```text
load base (lowResolutionBase)  → paint → emit first_panorama_visible
      ↓
load primary (standardWeb) or attach the tiled adapter
      ↓
tiles stream on demand as the visitor zooms/pans
```

The highest-resolution source must never be the first download.

### 6.3 Tiles

Use `tileUrlTemplate` with `{level}`, `{x}`, `{y}` substituted, resolved through
`resolveManifestUrl` ([frontend-api-integration.md](frontend-api-integration.md)
§6). The template already carries any signed-token query string — preserve it.

### 6.4 Corrections

`panoData` (cropped panorama) and `sphereCorrection` (straighten) are computed by
the backend from XMP/GPano metadata. The runtime passes them through verbatim.
A level panorama carries no correction at all; absence is meaningful, not a
default of zero.

---

## 7. Hotspots, overlays and actions

Markers arrive pre-built. The runtime's job is **action handling**, not marker
construction.

| `data.action.kind` | Runtime behaviour |
| --- | --- |
| `none` | Non-interactive. Tooltip only. |
| `showInformation` | Open the information panel using the marker's compiled content. |
| `openUrl` | Open `action.url` in a new tab with `rel="noopener noreferrer"`. The URL already passed the server URL policy; do not re-derive it. |
| `openAsset` | Open the compiled `action.media` in the image or video content surface (`image-content` / `video-content` modules). |
| `goToScene` | Navigate to `action.sceneId` through the scene-transition path (§8). |

Rules:

- All HTML in markers, tooltips and information panels is **already sanitised
  server-side** (PRD SEC-001). The frontend must not re-sanitise in a way that
  strips valid content, and must not bypass framework escaping to inject
  unsanitised strings from any other source.
- `hotspot_clicked` telemetry must carry `payload.hotspotId`;
  `overlay_clicked` must carry `payload.overlayId`. See
  [frontend-telemetry.md](frontend-telemetry.md).
- Overlay `style` (`fill`, `stroke`, `fillOpacity`, `strokeWidth`) binds to the
  renderer's marker styling. Layer geometries (`imageLayer`, `videoLayer`) carry
  angular `size` plus optional `rotation`, `opacity` and `chromaKey`.

---

## 8. Tour delivery, preload and cache

### 8.1 Delivery strategies

`tour.strategy` is `embedded` or `progressive`. The backend chooses; the runtime
obeys. Thresholds are platform policy (currently 32 inline scenes, 1 MiB inline
manifest, 128 connections, 5 average connections per scene) and must not be
re-implemented on the client.

| Strategy | Runtime behaviour |
| --- | --- |
| `embedded` | `manifest.scenes[]` contains every scene definition. No scene fetching. |
| `progressive` | `manifest.scenes[]` contains only the initial scene. Fetch others from `tour.sceneDefinitionUrlTemplate` with `{sceneId}` substituted. Responses are revision-pinned and immutable — cache indefinitely. |

### 8.2 Scene index

`tour.sceneIndex[]` drives gallery and scene-list UI without fetching scene
definitions. When `tour.sceneIndexSegmented` is true the manifest carries only
the first `tour.sceneIndexSegmentSize` entries (currently 250) and the rest are
paged from `tour.sceneIndexUrl` with `offset` and `limit` (max 250). Page lazily,
on demand — a 100-scene gallery must not block first paint.

Index entries carry a small `thumbnail`, `hasHotspots`, `hasOverlays`,
`connectionTargetSceneIds` and optional `spatial`. Never render a gallery from
the full-size scene panoramas.

### 8.3 Preload (PRD RUN-002)

`runtime.preload` gives `{ strategy, maxScenesPerSource, content }` — for image
tours `selective-adjacent`, `maxScenesPerSource: 2`,
`scene-definition-and-base-media`. Each scene also carries `preloadSceneIds[]`,
already ranked by the backend's policy from connection importance and preload
hints.

The runtime preloads, for the active scene only, at most `maxScenesPerSource`
entries from `preloadSceneIds`: their scene definition and their
**base** (low-resolution) media. Never the primary or tiled media, never the
whole tour. Cancel in-flight preloads when the visitor navigates elsewhere.

### 8.4 Cache (PRD RUN-003)

`runtime.cache` provides `defaultProfile: 'standard'` and three profiles
(`constrained`, `standard`, `capable`), each with `maxRecentScenes`,
`maxEstimatedBytes`, `evictionStrategy: 'least-recently-used'`,
`duplicateRequestStrategy: 'coalesce'` and `suppressDuplicateRequests: true`.

The runtime:

1. Picks the profile from the observed device class (§10.1), defaulting to
   `standard`.
2. Keeps an LRU of recently visited scenes bounded by **both** limits.
3. Coalesces concurrent requests for the same URL into one in-flight promise.
4. Evicts and releases media on eviction so memory stays bounded across long
   sessions.

Cache internals are never exposed to creators (PRD Appendix C).

### 8.5 Scene transitions

```text
select target scene
   → resolve definition (cache → manifest → progressive fetch)
   → load base media → swap → load detail
   → emit scene_changed { sceneId }
   on failure → emit scene_transition_failed
                { sourceSceneId, targetSceneId, failureCategory, assetId? }
```

`failureCategory` must be one of the backend's stable categories:
`scene_definition_unavailable`, `scene_definition_invalid`, `asset_unavailable`,
`asset_decode_failed`, `unsupported_media`, `viewer_error`,
`transition_timeout`, `unknown`. A failed transition must leave the current
scene intact and interactive.

---

## 9. 360° video runtime

### 9.1 Profile selection

`manifest.video.profiles[]` is ordered best-first with handheld-safe candidates
leading, and each carries `constraints { maxWidth, handheldSafe, mimeType }`.
`selectionPolicy` gives `handheldMaxWidth`, `defaultProfileId`,
`fallbackProfileId` and an optional `selectionUrl`.

**Default: select locally.** Walk the ordered candidates and take the first whose
constraints the device satisfies (`canPlayType` for the MIME type, handheld
width limit for touch/handheld devices, texture-size limit). This is one fewer
round trip and the manifest is built for it.

Use `POST /view/:slug/playback-profile` only when local selection is
inconclusive. It returns the selection, the reason, the rejected candidates and
the ordered candidate ids; `422 VIDEO_PLAYBACK_CAPABILITY_UNSUPPORTED` means no
published profile fits — show the visitor-facing playback error rather than
attempting an unsupported source.

Emit `video_profile_selected` with `assetId`, `derivativeId`, `profileId` and,
when known, `reason` and `candidateProfileIds`. On any playback failure emit
`video_playback_failed` with `assetId` and a `failureCategory` from
`profile_unavailable`, `media_unavailable`, `decode_failed`,
`codec_unsupported`, `network_error`, `autoplay_blocked`, `viewer_error`,
`unknown`. Autoplay rejection is `autoplay_blocked` and must fall back to a
poster plus a play control, never a broken canvas.

### 9.2 Timeline scheduling

`manifest.timeline[]` is already ordered by `(timeMs, sortOrder, id)`. The
runtime schedules against playback time, not wall-clock:

- Show an interaction when `currentTime >= timeMs`; hide it at `endTimeMs` when
  present, unless `visibilityRules.persistUntilDismissed`.
- `visibilityRules.pauseVideoWhenShown` pauses playback on show and resumes on
  dismiss.
- A `viewpoint` interaction moves the camera using the compiled
  `viewpoint.transition` value: `false` means cut, a number is the transition
  duration in milliseconds.
- Seeking backwards must re-arm interactions; seeking forwards must not fire
  every skipped interaction. Recompute the active set from the current time
  after every seek.
- Emit `timeline_interaction_shown` and `timeline_interaction_clicked` with
  `interactionId` and `kind`.

### 9.3 Playback events

Emit `video_started`, `video_paused`, `video_resumed`, `video_seeked`,
`video_stalled`, `video_ended`. Stall detection must be debounced so a normal
buffering hiccup does not flood ingestion.

---

## 10. Capability resolution at runtime

### 10.1 Device evaluation

The runtime derives a small, privacy-safe device profile once per session:

| Signal | Source | Used for |
| --- | --- | --- |
| Device class (`constrained` / `standard` / `capable`) | `navigator.hardwareConcurrency`, `deviceMemory`, viewport | Cache profile, telemetry `deviceContext.class` |
| Handheld | Pointer/touch capability plus viewport | Video profile selection |
| Max texture size | WebGL `MAX_TEXTURE_SIZE` | Panorama family and video width limits |
| Codec support | `HTMLMediaElement.canPlayType` | Video profile selection |
| Device orientation | Presence of the API and permission state | `device-orientation` requirement |
| Immersive runtime | WebXR availability | `immersive-runtime` requirement |
| Reduced motion | `prefers-reduced-motion` | Auto-rotation auto-start (PRD NAV-003) |
| Save-data / network | `navigator.connection` when available | Preload aggressiveness |

Never send raw fingerprinting detail to telemetry — only the coarse class.

### 10.2 Deferred device capabilities

`runtime.deferredDeviceCapabilities[]` lists capabilities that compiled
successfully but whose device support only the player can confirm, each with
`deviceRequirements`, `fallbackMessage` and `alternatives`. For each one:

```text
requirement satisfied?  ── yes ─► load the module, expose the control
        │
        no
        ▼
skip the module, hide the control,
show fallbackMessage only where the visitor would otherwise expect the feature,
emit capability_fallback { capabilityId, reason: FEATURE_DEVICE_UNAVAILABLE }
```

`runtime.fallbackPolicy.immersive` is `continue-in-normal-360` and
`optionalCapabilities` is `continue-without-capability`: **an optional capability
failing must never prevent base 360° navigation** (PRD RUN-004, IMM-001).

`runtime.capabilityFallbacks[]` records fallbacks the **compiler** already
applied (for example map dropped because no scene carries coordinates). Those
features are already absent from the config — do not attempt to mount them, and
do not re-emit telemetry for them.

---

## 11. Lifecycle and cleanup (PRD RUN-001)

Exactly one viewer instance per canvas context. On unmount or navigation:

1. Cancel in-flight media and preload requests.
2. Remove every listener and plugin subscription registered by the runtime.
3. Stop the timeline scheduler and detach media elements; call `pause()` and
   clear `src` before releasing a video element.
4. Destroy the viewer, releasing GPU resources.
5. Flush pending telemetry (`experience_exited`) with a keepalive request.
6. Clear the scene cache for the experience.

React Strict Mode double-invokes effects in development: construction must be
idempotent and teardown complete, or the second mount produces duplicate plugin
subscriptions. **Repeated route changes must not accumulate subscriptions** —
this is an explicit acceptance criterion.

---

## 12. Error taxonomy

| Situation | Visitor experience | Telemetry |
| --- | --- | --- |
| Manifest fetch fails | Retryable error screen | none (no token yet) |
| `manifestVersion` unsupported | Explicit "cannot be displayed" state | `viewer_error` if a token exists |
| Panorama media fails after all fallback families | Scene error state; shell and navigation stay usable | `asset_failed` |
| Scene definition fetch fails | Stay on the current scene; surface a retry | `scene_transition_failed` |
| Renderer throws | Error boundary around the canvas; the rest of the page survives | `viewer_error` |
| Optional capability unsupported | Silent degradation | `capability_fallback` |
| Video profile unusable | Poster plus playback error message | `video_playback_failed` |

The experience shell (branding, navigation chrome, information panels) must stay
functional whenever the failure is confined to one asset or scene (PRD §15).

---

## 13. Preview versus published

| Aspect | `/viewer/[projectId]` (preview) | `/view/[slug]` (published) |
| --- | --- | --- |
| Source | `POST /projects/:id/preview-manifest` with `revision` | `GET /view/:slug/manifest` |
| Auth | Creator session | Anonymous, session, or `X-Share-Token` |
| Media URLs | `/api/v1/media/:id?token=...` with `expiresAt` | Revision-scoped public routes, or signed for private |
| Publication revision | `null` | The current or pinned revision |
| Progressive tours | Not applicable — a preview compiles all carried scenes | May be progressive |
| Telemetry | Creator bearer path, or the manifest ingest token | Manifest ingest token |
| Caching | None; recompile on revision change | Per [frontend-api-integration.md](frontend-api-integration.md) §7.2 |

Both paths go through the **same** runtime with the same policies. Any preview-only
behaviour is a defect against PRD PUB-001.

Signed preview URLs expire (`SIGNED_MEDIA_TTL_SECONDS`, 900 s default). When the
preview outlives its `expiresAt`, refetch the preview manifest before loading
further media rather than allowing a 401.

---

## 14. Performance budgets

From PRD §14.2, measured on the defined test profile:

| Metric | Target |
| --- | --- |
| First panorama visible | p75 ≤ 2.5 s |
| Scene transition with preload hit | p75 ≤ 1.5 s |
| Editor local interaction feedback | ~100 ms |

Structural requirements that make these achievable, all verifiable from a
network trace:

- The player route's initial JavaScript must not contain map, plan, stereo,
  gyroscope, video, overlay or extension code for an experience that does not
  declare them.
- First paint uses `lowResolutionBase`, never `standardWeb` or a full tile set.
- No blanket full-resolution preload of unvisited scenes.
- No duplicate requests for the same derivative URL within a session.
