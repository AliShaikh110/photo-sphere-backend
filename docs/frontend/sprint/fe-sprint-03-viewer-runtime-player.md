# Frontend Sprint 03 — Viewer Runtime & Public Player

> **Depends on:** [FE-01](fe-sprint-01-foundation-auth-dashboard.md)
> **Backend basis:** backend Sprints 01–04 compiler, manifest and delivery routes, implemented
> **Primary contract:** [../frontend-viewer-runtime.md](../frontend-viewer-runtime.md) — binding for this sprint
> **Telemetry contract:** [../frontend-telemetry.md](../frontend-telemetry.md)

---

## 1. Sprint Objective

Build the **core product component**: a manifest-driven Viewer Runtime, and the
public player route that hosts it. At the end of this sprint a published
`image360` experience is fully viewable by a visitor at `/view/[slug]`, with
lazy-loaded runtime modules, low-resolution-first rendering, hotspot
interactions, graceful capability fallback, clean lifecycle teardown and
complete baseline telemetry.

This sprint delivers **no editor**. It is verified against experiences published
through the backend API directly.

---

## 2. Outcomes Required

By sprint completion:

- The runtime accepts a compiled manifest and renders it, with **no product
  logic of its own** beyond the policies the manifest declares.
- `manifestVersion` other than `4` fails explicitly and safely.
- Only the runtime modules the manifest declares are loaded; everything heavy is
  lazy.
- Rendering is low-resolution-first: `basePanorama` paints before any
  full-resolution or tiled source loads.
- Cropped panoramas and capture-pose corrections render correctly from the
  manifest's `panoData` and `sphereCorrection`, unchanged.
- Point hotspots render and their `none`, `showInformation`, `openUrl` and
  `openAsset` actions work. `goToScene` is wired but exercised in FE-05.
- Branding (logo, watermark, welcome/loading copy, colours) is applied.
- Public, private and share-token access all resolve correctly, with clear
  visitor-facing states when they do not.
- Baseline telemetry is emitted with the payload keys the analytics views
  require.
- Repeated mount/unmount leaves no duplicate subscriptions, no leaked listeners
  and no growing memory.
- Tiled panoramas load through the tile URL template, preserving signed-token
  query strings.

---

## 3. Dependencies

| Dependency | Status |
| --- | --- |
| FE-01 foundation, service layer, error mapping | Required |
| Backend `GET /view/:slug/manifest` and delivery routes | Implemented |
| Backend `POST /api/v1/runtime/events` | Implemented |
| At least one published test experience | Seed through the backend API — see §13 |
| Photo Sphere Viewer 5.14.3 packages | To be added this sprint |

FE-02 is **not** a dependency: the runtime consumes compiled media references,
not the upload flow.

---

## 4. In Scope

### Viewer Runtime (`src/features/viewer/runtime/`)
- Manifest type definitions mirroring `CompiledExperienceManifest`.
- Manifest guard: version check, discriminated `experienceType` narrowing.
- `resolveManifestUrl()` and the media-URL policy.
- Device capability probe (device class, handheld, texture size, codec support,
  orientation, immersive, reduced motion, save-data).
- Capability resolution: deferred device capabilities, compiler fallbacks.
- Module registry with dynamic imports (see
  [../frontend-viewer-runtime.md](../frontend-viewer-runtime.md) §4).
- **Renderer binder**: translates `viewerIntegration.config` into the Photo
  Sphere Viewer constructor plus plugin options.
- Scene renderer: family selection, fallback families, low-res-first upgrade,
  tiles, `panoData`, `sphereCorrection`, `visibleRange`.
- Marker action handler for hotspots.
- Information panel and image/video content surfaces (`image-content`,
  `video-content` modules).
- Scene cache primitive with request coalescing (populated in FE-05).
- Lifecycle controller: construct, teardown, cancellation, Strict-Mode safety.
- Error boundary around the canvas with a stable error taxonomy.

### Telemetry (`src/features/telemetry/`)
- Batching client with beacon flush.
- Ingest-token handling and expiry.
- Session id and coarse device context.
- Baseline events plus `capability_fallback`.

### Public player (`app/(player)/view/[slug]/`)
- Server-side manifest fetch for public slugs; client fetch when a share token
  or session is involved.
- Loading screen honouring `branding.loadingMessage`.
- Optional welcome screen from `branding.welcomeMessage`.
- Visitor error states: not found, private, embed-denied, unsupported manifest.
- Share-token handling from `?shareToken=` or a prompt.
- Embed-friendly rendering: no app chrome, correct sizing in an iframe.
- `<meta>` and Open Graph tags derived from experience name and branding.

---

## 5. Out of Scope for FE-03

- The editor shell, tool panel or properties panel (FE-04).
- Draft preview route `/viewer/[projectId]` (FE-04 — it reuses this runtime).
- Multi-scene navigation, gallery, compass, progressive tours, preload policy
  (FE-05). The scene renderer must be built so FE-05 adds them without a rewrite.
- Video experiences (FE-06). `experienceType: 'video360'` renders an
  "unsupported in this build" state this sprint.
- Map, plan, overlays, extensions, motion, stereo (FE-07).
- Analytics dashboards (FE-08).

---

## 6. Routes & Screens

| Route | Screen | Rendering |
| --- | --- | --- |
| `/view/[slug]` | Public player | Server component fetches a public manifest; the runtime is a client component. |

The frontend defines **only** `/view/[slug]`. Every path beneath it belongs to
the backend — see [../frontend-validation-report.md](../frontend-validation-report.md)
§R7.

---

## 7. Frontend Work Breakdown

### 7.1 Manifest layer
`types/manifest.ts`, `runtime/manifest-guard.ts`, `runtime/resolve-url.ts`.

Type names mirror the compiler exactly: `CompiledExperienceManifest`,
`CompiledScene`, `CompiledPanoramaMedia`, `CompiledHotspot`,
`CompiledMediaReference`, `RuntimeDeclarations`, `CompiledTourDelivery`.

### 7.2 Capability layer
`runtime/device-probe.ts`, `runtime/capability-resolver.ts`.

Input: `manifest.capabilities`, `manifest.runtime.deferredDeviceCapabilities`,
`manifest.runtime.capabilityFallbacks`, the device probe.
Output: the module id set to load, plus the fallbacks to report.

### 7.3 Module registry
`runtime/modules/index.ts` — a frozen map from module id to `() => import(...)`.
Unknown ids resolve to `null`, which triggers the capability fallback path
rather than an error.

### 7.4 Renderer binder
`runtime/binder/` — one file per config family: `viewer-options.ts`,
`navbar.ts`, `scene.ts`, `markers.ts`, `plugins.ts`.

This is the only directory permitted to reference Photo Sphere Viewer types or
option names.

### 7.5 Scene renderer
`runtime/scene-renderer.ts` — family selection with fallback, base-then-primary
upgrade, tile binding, correction passthrough, view limits.

### 7.6 Interaction layer
`runtime/actions.ts` plus `components/InformationPanel`, `ImageContentSurface`,
`VideoContentSurface`.

### 7.7 Lifecycle and host
`runtime/viewer-host.tsx` — the single React component that owns the viewer
instance. Everything else is pure TypeScript so it can be unit tested without a
DOM viewer.

### 7.8 Telemetry
`telemetry/client.ts`, `telemetry/session.ts`, `telemetry/events.ts`,
`telemetry/device-context.ts`.

### 7.9 Player route
`app/(player)/view/[slug]/page.tsx`, `player-shell.tsx`, `error-states.tsx`,
`branding-overlay.tsx`.

---

## 8. Backend / API Integrations

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/view/:slug/manifest` | Optional bearer, `X-Share-Token` or `?shareToken=`. Public: `max-age=0, must-revalidate`. Private: `no-store`. Returns `{ manifest, publication }`. |
| GET | `/api/v1/publications/:projectId/:publicationRevision/media/:derivativeId` | Anonymous public derivative bytes. Referenced by the manifest; never constructed by the client. |
| GET | `/api/v1/media/:derivativeId?token=…` | Signed private/preview derivative bytes. |
| GET | `/api/v1/media/:derivativeId/tiles/:level/:x/:y` | Tile bytes via `tileUrlTemplate`. |
| POST | `/api/v1/runtime/events` | `X-Telemetry-Token` from `manifest.telemetry.ingestToken`. |

### 8.1 Access outcomes

| Outcome | Visitor state |
| --- | --- |
| Public manifest | Renders. |
| Private, no credential | "Sign in or use a valid share link". |
| `PRIVATE_PUBLICATION_ACCESS_DENIED` | Same, without disclosing existence. |
| `EMBED_ORIGIN_DENIED` (403) | "This experience can't be shown here." No retry. |
| 404 | "This experience isn't available." |
| Unsupported `manifestVersion` | "This experience can't be displayed." |

### 8.2 URL rules

Every URL in the manifest is root-relative. Resolve through
`resolveManifestUrl()`, preserve query strings, never re-sign, never log a
signed URL. See [../frontend-api-integration.md](../frontend-api-integration.md)
§6.

---

## 9. State, Cache & Invalidation

- `['manifest', slug]` — `staleTime: 60 s`, matching the backend's
  `must-revalidate` public policy.
- Scene definitions and index pages, once fetched, are revision-pinned and
  immutable: `staleTime: Infinity`. The cache primitive lands here even though
  FE-05 exercises it.
- Media requests are deduplicated by URL through the coalescing cache.
- The runtime holds **no** TanStack Query state internally; the host passes the
  manifest in. This keeps the runtime usable from the editor in FE-04 without a
  second data path.

---

## 10. UX & Responsive Requirements

- The panorama fills the viewport at every size; the player has no app chrome.
- Loading uses `branding.loadingMessage` when present, otherwise a neutral
  message; branding colours theme the loading and error states.
- A missing branding asset never blocks playback (PRD BRD-001).
- Viewer controls come from the compiled navbar; the runtime does not invent
  controls the manifest did not enable.
- Touch, mouse, keyboard and fullscreen follow the compiled navigation settings.
- The information panel is a bottom sheet on phones and a side panel on wide
  viewports; it never occludes more than half the panorama.
- Reduced motion suppresses auto-rotation auto-start and panel animation.
- The canvas has an accessible name; keyboard navigation works when the project
  enables keyboard controls.
- Inside an iframe the player fills the frame and never attempts to break out.

---

## 11. Error, Loading & Empty States

| Situation | Behaviour | Telemetry |
| --- | --- | --- |
| Manifest fetch fails | Retryable visitor error | none |
| Unsupported manifest version | Explicit unsupported state | `viewer_error` when a token exists |
| Base panorama fails, fallback family succeeds | Renders; advisory only in development | `asset_failed` |
| All families fail | Scene error state; chrome stays usable | `asset_failed` |
| Renderer throws | Canvas error boundary; page survives | `viewer_error` |
| Module load fails | Capability fallback; experience continues | `capability_fallback` |
| Telemetry rejected | Silent stop | none |

---

## 12. Acceptance Criteria / Sprint Gate

1. A published single-scene `image360` experience renders at `/view/[slug]` from
   a cold cache.
2. A network trace shows `lowResolutionBase` requested and painted **before**
   `standardWeb` or any tile.
3. For an experience declaring no gallery, map, plan, stereo, gyroscope, video,
   overlay or extension capability, none of those renderer packages appears in
   the loaded JavaScript.
4. A tiled panorama loads tiles through `tileUrlTemplate` with `{level}/{x}/{y}`
   substituted and the query string preserved.
5. A cropped panorama renders with the correct framing, and a panorama with a
   tilted capture pose renders level — with `panoData` and `sphereCorrection`
   passed through unmodified.
6. Hotspots render; `showInformation` opens the panel with the compiled content;
   `openUrl` opens in a new tab with `rel="noopener noreferrer"`; `openAsset`
   opens the content surface.
7. Mounting and unmounting the player twenty times shows no growth in listener
   count, plugin subscriptions or retained heap.
8. Baseline telemetry is delivered with `durationMs` on
   `first_panorama_visible` and `time_to_interactive`, and `sceneId` on
   `scene_changed`, `hotspotId` on `hotspot_clicked`.
9. A private experience without credentials shows the access state and does not
   reveal whether the slug exists.
10. A valid share token renders the private experience; a revoked one does not,
    immediately.
11. `manifestVersion: 5` (simulated) produces the explicit unsupported state, not
    a partial render.
12. Photo Sphere Viewer is imported only under `features/viewer/runtime/` — an
    import elsewhere fails lint.

---

## 13. Verification Requirements

### Seeding test experiences

The backend is complete, so fixtures are produced by calling it directly — no
frontend publish UI is required this sprint:

```text
register → create image360 project → upload panorama → complete → wait ready
        → create scene → create hotspots → publish (public)
        → repeat with visibility: private, and with a share token
```

Cover at least: a plain equirectangular panorama, a cropped panorama, a panorama
with a tilted capture pose, a tiled high-resolution panorama, a private
publication, a share-token link, and an experience declaring an optional
capability the test device cannot satisfy.

### Test layers
- Unit: manifest guard; capability resolver against synthetic
  `deferredDeviceCapabilities`; URL resolution including signed query strings;
  binder output for each config family; telemetry batching and flush.
- Integration: full player boot against a live backend for each fixture.
- Performance: first panorama visible p75 ≤ 2.5 s on the defined test profile.
- Leak: repeated mount/unmount under devtools memory profiling.
- Security: no signed URL is logged; no token is written to storage; embed-denied
  is handled without retry loops.

---

## 14. Execution Order

1. Add and pin the Photo Sphere Viewer packages.
2. Manifest types, guard, URL resolution.
3. Device probe and capability resolver.
4. Module registry with dynamic imports.
5. Renderer binder — viewer options, navbar, scene, markers.
6. Viewer host and lifecycle controller; verify teardown before adding features.
7. Scene renderer: families, fallback, low-res-first, tiles, corrections.
8. Marker action handling, information panel, content surfaces.
9. Telemetry client and baseline events.
10. Player route: manifest fetch, branding, error states, share tokens, embed.
11. Seed fixtures and run the gate.

---

## 15. Guardrails

1. Photo Sphere Viewer is imported **only** inside the runtime; enforce with an
   ESLint boundary rule.
2. Never construct a media, tile, scene-definition or scene-index URL by hand —
   use the manifest's values.
3. Never recompute `sphereCorrection`, `panoData` or `defaultZoomLvl`; the
   backend already did.
4. Never load a module the manifest did not declare; never `import()` a raw
   string from a manifest.
5. Never block first paint on telemetry, branding assets or optional modules.
6. Never let an optional capability failure prevent base 360° navigation.
7. Never re-sanitise or bypass escaping for compiled HTML content.
8. Do not add scene navigation, gallery or preload behaviour in this sprint —
   leave the extension points and stop.
9. Do not couple the runtime to TanStack Query; it receives a manifest as input.
