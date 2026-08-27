# Frontend Sprint 07 — Spatial, Immersive & Advanced Interactions

> **Depends on:** [FE-05](fe-sprint-05-tours-navigation-progressive.md)
> **Backend basis:** backend Sprint 04 (plans, spatial data, overlays, advanced geometry, extensions, immersive resolver, quality policy), implemented
> **Runtime contract:** [../frontend-viewer-runtime.md](../frontend-viewer-runtime.md) §4, §7, §10

---

## 1. Sprint Objective

Add the advanced spatial and immersive layer on top of tours: floor and site
plans with scene placement, world-map navigation, richer interaction geometry
(areas, routes, image and video layers), registered custom interactions, motion
navigation, stereo and immersive viewing — each appearing only when it is
genuinely usable, and each degrading safely when it is not.

Everything here is **progressive capability**: it must be invisible to a creator
who does not need it, and it must never break base 360° navigation.

---

## 2. Outcomes Required

By sprint completion:

- Floor and site plans can be created, ordered, given an image and deleted.
- Scenes can be placed on a plan by clicking the plan image, and given world
  coordinates when the experience is outdoors.
- Map and plan navigation appear only when scenes actually carry the matching
  placement, and the compiler's `FEATURE_FALLBACK_APPLIED` warning is shown as an
  advisory.
- Overlays can be authored with polygon, polyline, image-layer and video-layer
  geometry, and render in preview and published playback.
- Registered custom interactions can be created, validated against the
  extension's declared schema, and rendered through the allow-listed runtime
  module.
- Motion navigation, stereo and immersive viewing appear only when the device
  supports them, with permission handled correctly, and always degrade to normal
  360°.
- Quality preference is exposed as a product control, and high-resolution and
  cubemap panorama families render correctly.
- Advanced tools stay hidden behind progressive disclosure and never clutter a
  simple experience.
- Spatial telemetry is emitted.

---

## 3. Dependencies

| Dependency | Status |
| --- | --- |
| FE-05 scenes, connections, tour runtime | Required |
| FE-02 asset picker with `plan_image` and layer media | Required |
| Backend plans, scene `spatialData`, overlays, extensions, map/plan compilation | Implemented |
| Backend `GET /api/v1/platform/capabilities` | Implemented |
| Backend `GET /api/v1/extensions` | Implemented |

---

## 4. In Scope

### Plans and placement
- Plans tool: create, rename, reorder, attach a plan image, delete.
- Plan viewer with scene markers, drag placement and heading indication.
- Scene placement in `plan_normalized` (0–1) or `plan_pixels` coordinates.
- World placement: latitude and longitude together, optional altitude, plus a
  scene heading.
- Independent placement families — a floor-plan experience never invents GPS
  data, and an outdoor tour never needs a plan.
- Deleting a plan clears placements rather than blocking; state this clearly.

### Map and plan navigation
- `settings.map`: enable, show scene markers, show heading cone, default zoom.
- `settings.plan`: enable, default plan, show scene markers, show heading cone.
- Player map and plan surfaces driven by `manifest.spatialIndex` and
  `manifest.plans`, without fetching scene definitions.
- Selecting a scene from the map or plan navigates through the same transition
  path as any other navigation.

### Overlays and advanced geometry
- Overlays tool per scene: list, create, edit, reorder, delete.
- Geometry authoring:
  - `polygon` — click vertices on the panorama, close the shape (3–512 vertices)
  - `polyline` — click a route (2–512 vertices)
  - `imageLayer` — pick a ready image, then size and place it angularly
  - `videoLayer` — pick a ready video, then size, place, optional chroma key
- Overlay appearance: label, colour, fill opacity, stroke width, emphasis.
- Overlays share the hotspot content and action contracts.
- A `point` geometry belongs to a hotspot; the overlay editor never offers it.

### Custom interactions
- Read `GET /api/v1/extensions`; offer only `active` extensions valid for the
  experience type.
- Render a form from the extension's declarative field schema (string, number,
  enum, required, min/max, maxLength, `additionalFields: false`).
- Persist `extensionId` + `extensionVersion` with the geometry.
- Player loads the extension's allow-listed runtime module through the static
  registry map.
- Deprecated extensions are usable but flagged; disabled ones cannot be newly
  authored while published revisions keep their pinned version.

### Immersive and quality
- Motion navigation setting with an explicit permission-request preference.
- Stereo and immersive viewing settings.
- Player device evaluation of `device-orientation`, `stereo-rendering` and
  `immersive-runtime`, with fallback messaging and `capability_fallback`
  telemetry.
- Quality preference control (`automatic` / `standard` / `high`).
- Rendering of `tiledEquirectangular`, `cubemap` and `tiledCubemap` families with
  `fallbackFamilies`.

---

## 5. Out of Scope for FE-07

- Templates, workspaces, access grants, share tokens, embed policy, analytics
  (FE-08).
- Any overlay or plan feature on `video360` projects — the backend restricts
  plans and scenes to `image360`.
- Authoring new extensions. Registration is a platform-admin API surface; the
  optional console is FE-08.
- Dual-fisheye ingest and live 360° input — both report `unavailable` unless the
  deployment enables them.
- Manual tiling or resolution selection beyond the product-level quality
  preference.

---

## 6. Routes & Screens

No new routes. New surfaces:

| Surface | Location |
| --- | --- |
| Plans tool, plan viewer, placement | `/experiences/[projectId]` tool panel and a plan modal |
| Map tool and world placement | Tool panel and scene properties |
| Overlays tool and geometry editors | Tool panel and canvas |
| Custom interaction form | Properties panel |
| Motion / VR and Quality tools | Advanced tool group |
| Map, plan, overlays, immersive controls | Player and preview |

---

## 7. Frontend Work Breakdown

### 7.1 Types
`Plan`, `SpatialData`, `SpatialCoordinateSystem`, `Overlay`, `OverlayAppearance`,
`InteractionGeometry`, `LayerAnchor`, `Extension`, `ExtensionFieldSchema`,
`CompiledSpatialIndex`, `CompiledPlan`, `PanoramaDerivativeFamily`.

### 7.2 Services
`plan-service.ts`: `listPlans`, `createPlan`, `updatePlan`, `reorderPlans`,
`deletePlan`.
`overlay-service.ts`: `listOverlays`, `createOverlay`, `updateOverlay`,
`deleteOverlay`.
`extension-service.ts`: `listExtensions`, `getExtension`.
Scene placement rides on `updateScene` via `spatialData`.

### 7.3 Editor features
`features/plans/` — plan management, plan viewer, drag placement.
`features/spatial/` — world placement, heading control, map settings.
`features/overlays/` — overlay list, geometry editors, appearance form.
`features/extensions/` — schema-driven form renderer.
`features/immersive/` — motion, stereo, VR and quality settings.

### 7.4 Runtime additions
`runtime/modules/` gains `map`, `plan`, `gyroscope`, `stereo`,
`immersive-viewing`, `advanced-overlays`, `advanced-geometry`, `cubemap`,
`extensions`.
`runtime/spatial-controller.ts` — map and plan surfaces from the spatial index.
`runtime/extension-host.ts` — resolves an allow-listed module id to a local
import; never imports a raw manifest string.
`runtime/immersive-controller.ts` — permission flow, activation, fallback.

### 7.5 Geometry capture
`features/overlays/geometry-capture.ts` converts canvas clicks to
`spherical_degrees` vertices, enforces vertex counts and rejects degenerate
shapes before the request.

---

## 8. Backend / API Integrations

| Method | Route | Precondition | Notes |
| --- | --- | --- | --- |
| GET/POST | `/api/v1/projects/:projectId/plans` | `projectRevision` on POST | `image360` only. `assetId` optional — a plan can exist before its image. |
| POST | `.../plans/reorder` | `projectRevision` | Complete `planIds` array. |
| PATCH/DELETE | `.../plans/:planId` | `projectRevision` | Delete clears scene placements. |
| PATCH | `.../scenes/:sceneId` | `projectRevision` | Sets `spatialData`. |
| GET/POST | `.../scenes/:sceneId/overlays` | `projectRevision` on POST | Geometry union excluding `point`. |
| PATCH/DELETE | `.../scenes/:sceneId/overlays/:overlayId` | `projectRevision` | PATCH accepts any subset. |
| GET | `/api/v1/extensions` | — | Active and deprecated only; `runtimeModule` and `securityPolicy` are deliberately absent. |
| GET | `/api/v1/extensions/:extensionId/:version` | — | Draft or disabled answers as not found. |
| GET | `/api/v1/platform/capabilities` | — | Availability, device and media requirements, fallbacks. |

### 8.1 Spatial rules

- `latitude` and `longitude` are supplied together or not at all.
- `planId`, `mapX` and `mapY` are supplied together or not at all.
- Plan coordinates may never declare `wgs84`.
- `plan_normalized` is 0–1; `plan_pixels` is plan-image pixels.
- Incomplete placement returns `SCENE_SPATIAL_DATA_INCOMPLETE`; an unresolvable
  plan returns `PLAN_NOT_FOUND`; plan coordinates with a world system return
  `MAP_SCENE_MAPPING_INVALID`.
- `settings.map.enabled` and `settings.plan.enabled` are creator intent. The
  resolver drops either at compile time when no scene carries the corresponding
  placement, reported as a `FEATURE_FALLBACK_APPLIED` **warning**, not a publish
  failure. Surface it as "The map isn't shown because no scene has a location
  yet."

### 8.2 Geometry rules

| Kind | Rules |
| --- | --- |
| `polygon` | 3–512 finite vertices |
| `polyline` | 2–512 finite vertices |
| `imageLayer` | ready `image`/`logo` asset + angular `anchor` |
| `videoLayer` | ready `video` asset + angular `anchor`, optional `chromaKeyColor` |
| `custom` | registered enabled extension; payload validated against its schema |

`anchor` is angular: `widthDegrees`, `heightDegrees`, optional
`rotationDegrees`, `opacity`, `chromaKeyColor`. Renderer mesh, texture or adapter
vocabulary in a payload is rejected. Degenerate geometry returns
`INVALID_GEOMETRY`; an unknown kind returns `UNSUPPORTED_OVERLAY_GEOMETRY`.

### 8.3 Extension errors

`EXTENSION_NOT_REGISTERED`, `EXTENSION_NOT_AVAILABLE`,
`EXTENSION_PAYLOAD_INVALID` — all field-level errors on the extension form.

---

## 9. State, Cache & Invalidation

- `plans` — `staleTime: 0`; invalidated by plan mutations and by scene placement
  changes.
- `overlays` per scene — `staleTime: 0`; invalidated with its scene.
- `extensions` — `staleTime: 1 hour`.
- Deleting a plan invalidates `plans` **and** `scenes`, because placements are
  cleared server-side.
- Geometry drafts (an in-progress polygon) are local UI state until committed.
- Map and plan player surfaces read the manifest's `spatialIndex` and `plans`;
  they never fetch scene definitions.

---

## 10. UX & Responsive Requirements

- Advanced tools live in the collapsed advanced group; a simple panorama project
  stays clean (product architecture §10, PRD FE-002).
- Map appears only when a scene has a location; Plan only when a plan exists.
  Where the creator can fix it, say so in product language rather than hiding it
  silently.
- Plan placement is done by dragging a scene marker onto the plan image. No
  coordinate entry (product architecture §3.3).
- Polygon and polyline authoring shows vertex count, supports undo of the last
  vertex, `Enter` to close and `Esc` to cancel, and refuses to commit a
  degenerate shape.
- Layer sizing is a visual handle on the panorama, not a degrees field.
- Motion navigation states the permission request in plain language before
  triggering the browser prompt.
- Stereo and VR appear only when the device supports them; an unsupported device
  continues in normal 360° with no error (PRD IMM-001).
- Quality preference is three product choices, never a resolution or tile-level
  picker.
- Below `md`, plan placement and polygon authoring are unavailable, with a stated
  reason; viewing everything authored elsewhere still works.
- The player's map and plan panels are dismissible and never occlude the
  panorama permanently.

---

## 11. Error, Loading & Empty States

| Situation | Behaviour |
| --- | --- |
| Plan without an image | Placement disabled with an explanation; the plan still exists. |
| Incomplete placement | Field-level error naming the missing half of the pair. |
| Map enabled, no located scenes | Advisory in validate/publish; map absent at runtime. |
| Overlay asset not ready | Picker blocks selection; existing overlay shows a processing state. |
| Degenerate geometry | Blocked before the request; server error surfaces as a field error. |
| Extension disabled after authoring | Existing published revisions keep their pinned version; the editor blocks new authoring and explains. |
| Extension module fails to load | Overlay omitted; experience continues; `capability_fallback`. |
| Motion permission denied | Control hidden; normal 360° continues; `capability_fallback`. |
| Stereo unsupported | Control hidden; fallback message where the visitor would expect it. |
| Cubemap or tile family fails | Step through `fallbackFamilies`, then the scene error state. |

---

## 12. Acceptance Criteria / Sprint Gate

1. A plan can be created, given an image, and have scenes placed on it by
   dragging; placement survives reload and republish.
2. A scene can carry world coordinates and a heading independently of any plan,
   and a plan-only experience stores no GPS data.
3. Enabling the map with no located scene publishes successfully with a
   `FEATURE_FALLBACK_APPLIED` advisory, and the visitor sees no empty map.
4. Deleting a plan clears placements and does not block; the UI states this
   before confirming.
5. Polygon, polyline, image-layer and video-layer overlays can be authored,
   render identically in preview and published playback, and respect their
   appearance settings.
6. Overlay geometry limits are enforced (3–512 polygon vertices, 2–512 polyline
   vertices); a degenerate shape cannot be committed.
7. A registered custom interaction renders a schema-driven form, rejects an
   invalid payload field-by-field, and renders in the player through the
   allow-listed module only.
8. The player never `import()`s a string taken directly from a manifest;
   extension modules resolve through the static local map.
9. On a device without orientation support, motion navigation is hidden, base
   navigation is unaffected, and `capability_fallback` is emitted with
   `FEATURE_DEVICE_UNAVAILABLE`.
10. On a device without stereo or immersive support, those controls are hidden
    and normal 360° continues (PRD IMM-001).
11. A high-resolution tiled panorama and a cubemap panorama both render, and a
    forced primary-family failure falls back through `fallbackFamilies`.
12. An experience with no spatial, overlay, immersive or extension capability
    loads none of those modules — verified in the network trace.
13. `overlay_clicked` carries `overlayId`; `map_interaction` carries `surface`
    and `action`.
14. No creator-facing string contains "mesh", "texture", "adapter", "plugin",
    "shader", "tile level" or "cubemap face".

---

## 13. Verification Requirements

- Unit: placement pair validation; plan-coordinate system rules; geometry vertex
  capture and limits; angular anchor computation; extension schema form
  generation and validation; capability-to-module resolution.
- Integration: author a plan-based indoor tour and a GPS-based outdoor tour;
  author each overlay geometry kind; author a custom interaction; publish and
  replay each in the player.
- Device: motion navigation on a real handheld with permission granted and
  denied; stereo on a supporting device; a desktop with no orientation support.
- Bundle: assert the player bundle for a plain panorama excludes map, plan,
  stereo, gyroscope, overlay and extension code.
- Security: confirm no arbitrary module path can be loaded from a crafted
  manifest.

---

## 14. Execution Order

1. Plan types, service, plans tool, plan image attachment.
2. Plan viewer with drag placement and heading.
3. World placement and map settings; scene spatial properties.
4. Runtime map and plan surfaces from the spatial index.
5. Overlay types, service, overlay list.
6. Geometry capture: polygon, polyline, then layer placement and sizing.
7. Overlay appearance and action forms; runtime overlay rendering.
8. Extension catalogue, schema-driven form, extension host with the static
   allow-list.
9. Motion, stereo and immersive settings; device evaluation and fallback flow.
10. Quality preference; cubemap and tiled family rendering with fallbacks.
11. Spatial telemetry.
12. Bundle audit and gate verification.

---

## 15. Guardrails

1. Never offer `point` geometry in the overlay editor; a point is a hotspot.
2. Never store or accept renderer mesh, texture or adapter vocabulary in a
   payload.
3. Never invent GPS data for a plan-only experience, or a plan for an outdoor
   tour.
4. Never present a map or plan the compiler dropped.
5. Never `import()` a module path taken from a manifest; resolve through the
   static registry.
6. Never let a missing extension, denied permission or unsupported device break
   base 360° navigation.
7. Never expose tile levels, cubemap faces, resolutions or adapter names.
8. Never load spatial, immersive, overlay or extension modules for an experience
   that does not declare them.
9. Do not add plans or overlays to `video360` projects.
10. Do not build extension registration UI here; it is an optional FE-08 operator
    surface.
