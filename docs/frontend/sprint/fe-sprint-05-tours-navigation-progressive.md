# Frontend Sprint 05 — Multi-Scene Tours, Navigation & Runtime Efficiency

> **Depends on:** [FE-04](fe-sprint-04-image-editor-publish.md)
> **Backend basis:** backend Sprint 02 (tours, capability resolver, preload/cache policy, progressive delivery), implemented
> **Runtime contract:** [../frontend-viewer-runtime.md](../frontend-viewer-runtime.md) §8

---

## 1. Sprint Objective

Turn a single-panorama experience into a **virtual tour**: multiple scenes,
visual connections between them, gallery and navigation options — and make the
player efficient enough for large tours through progressive scene delivery,
selective preloading and a bounded scene cache.

The creator thinks "connect scenes". They never see a node, a graph, a preload
rule or a cache budget.

---

## 2. Outcomes Required

By sprint completion:

- Scenes can be added, renamed, reordered, selected and deleted; selecting a
  scene changes the canvas without a page reload.
- Deleting a referenced scene surfaces every blocking reference and lets the
  creator resolve each one, then retry.
- Scenes can be connected visually, and a hotspot can navigate to another scene.
- Gallery, compass, allowed viewing area and auto-rotation are configurable
  through product controls and behave identically in preview and published
  playback.
- The capability resolver's outcomes are surfaced in product language —
  including the gallery / fixed-high-resolution incompatibility.
- The player renders embedded tours and progressive tours identically from the
  visitor's point of view.
- The scene index pages lazily for very large tours.
- Adjacent preloading follows the manifest's policy: at most the declared number
  of likely-next scenes, base media only.
- The scene cache is bounded by the manifest's device-aware budgets, coalesces
  duplicate requests, and evicts least-recently-used scenes.
- Scene transition telemetry is complete, including stable failure categories.

---

## 3. Dependencies

| Dependency | Status |
| --- | --- |
| FE-04 editor shell, save controller, preview, publish | Required |
| FE-03 Viewer Runtime with its cache and preload extension points | Required |
| Backend scene reorder, connections, runtime hints, published scene definitions, scene index | Implemented |
| Backend `GET /api/v1/platform/capabilities` | Implemented |

---

## 4. In Scope

### Scene authoring
- Scenes tool: list with thumbnails, add, rename, select, reorder (drag), delete.
- Virtualised list so a 100-scene project stays responsive (PRD SCN-003).
- Primary scene indication; the first scene is primary by default.
- Scene properties: name, panorama, initial view ("Set as opening view"),
  allowed viewing area, preload preference.
- `409 SCENE_IN_USE` resolution dialog listing `sceneConnection`,
  `hotspotAction` and `runtimeHint` references, each navigable.

### Connections
- Connect scenes from the scene properties panel and from a hotspot's `scene`
  action.
- Connection fields: target scene, label, optional content, importance
  (presented as a simple "how likely is this route" control), preload preference
  (`none` / `normal` / `high`, presented as "Standard / Prepare early / Don't
  prepare").
- Replacing a scene's connection set correctly retains connections whose `id` is
  resent.
- Broken or self-referential targets rejected in the UI before the request, and
  `422 INVALID_SCENE_REFERENCE` handled as a field error.
- A connection graph overview panel showing which scenes are unreachable.

### Navigation and presentation settings
- Gallery: enable, show scene names, show thumbnails.
- Compass: enable.
- Auto rotation: enable, speed, direction, start automatically.
- Allowed viewing area: set from the current framing ("Limit viewing to what I
  can see now") plus a reset, never numeric angles.
- Navigation buttons and scene navigation toggles.

### Capability surfacing
- Read `GET /api/v1/platform/capabilities` and hide or explain unavailable
  features in product language.
- Present `FEATURE_FALLBACK_APPLIED` warnings from validate and publish as
  advisories, not failures.
- Handle the documented gallery / fixed-high-resolution incompatibility as a
  product-level choice — offer the supported alternative rather than a technical
  error (PRD GAL-001).

### Player: tours, preload and cache
- Scene navigation via hotspot actions, gallery selection and connection links.
- Embedded tours: scenes from the manifest.
- Progressive tours: fetch definitions from `tour.sceneDefinitionUrlTemplate`.
- Scene index paging from `tour.sceneIndexUrl` with `offset` and `limit`.
- Preload policy implementation (`runtime.preload` + `scene.preloadSceneIds`).
- Cache implementation (`runtime.cache` profiles, LRU, coalescing, eviction).
- Scene transition orchestration with base-first swap and failure recovery.
- `scene_changed` and `scene_transition_failed` telemetry.

---

## 5. Out of Scope for FE-05

- Video projects and the timeline (FE-06).
- Plans, map navigation, spatial placement, overlays, extensions, immersive
  modes (FE-07).
- Templates, collaboration, analytics dashboards (FE-08).
- Creator-visible cache or preload internals — only product-level intent.
- Any client-side re-derivation of the small/large tour threshold. The backend
  decides; the player obeys.

---

## 6. Routes & Screens

No new routes. New surfaces inside existing routes:

| Surface | Location |
| --- | --- |
| Scenes tool + scene list | `/experiences/[projectId]` tool panel |
| Scene properties | Properties panel |
| Connection editor | Properties panel, scene and hotspot contexts |
| Connection overview | Editor modal |
| Gallery / Navigation / Auto Rotation / Compass / View Limits tools | Tool panel |
| Gallery, compass and scene navigation | Player and preview |

---

## 7. Frontend Work Breakdown

### 7.1 Types
`SceneConnection`, `SceneRuntimeHints`, `TourDelivery`, `SceneIndexEntry`,
`RuntimeCacheProfile`, `RuntimePreloadDeclaration`, `SceneTransitionFailureCategory`.

### 7.2 Services
`scene-service.ts` gains `reorderScenes`; connection changes ride on
`updateScene`. `player-service.ts` gains `getSceneDefinition` and
`getSceneIndexPage`.

### 7.3 Editor features
`features/scenes/` — list, virtualisation, drag reorder, delete-with-references
dialog, properties.
`features/connections/` — editor, graph overview, reachability analysis.
`features/navigation/` — gallery, compass, auto-rotation, view-limit tools.

### 7.4 Runtime additions
`runtime/tour-controller.ts` — resolves a scene definition from cache, manifest
or the progressive route; owns transition orchestration.
`runtime/preload-controller.ts` — implements the declared policy with
cancellation.
`runtime/scene-cache.ts` — completes the FE-03 primitive: LRU by both
`maxRecentScenes` and `maxEstimatedBytes`, request coalescing, eviction with
media release.
`runtime/scene-index.ts` — paged index access for gallery and scene lists.

---

## 8. Backend / API Integrations

| Method | Route | Precondition | Notes |
| --- | --- | --- | --- |
| POST | `/api/v1/projects/:projectId/scenes` | `projectRevision` | Service assigns `sortOrder` and marks the first scene primary. |
| POST | `/api/v1/projects/:projectId/scenes/reorder` | `projectRevision` | Must list **every** scene exactly once; otherwise `422 INVALID_SCENE_ORDER` names missing and unknown ids. |
| PATCH | `.../scenes/:sceneId` | `projectRevision` | `connections` **replaces** the set; resend an existing `id` to retain it. |
| DELETE | `.../scenes/:sceneId` | `projectRevision` | `409 SCENE_IN_USE` with `details.references[]`. |
| GET | `/view/:slug/scenes/:sceneId` | — | Current-revision scene definition. `must-revalidate` + ETag. |
| GET | `/view/:slug/revisions/:revision/scenes/:sceneId` | — | Revision-pinned, `immutable`. **This is the form the manifest emits.** |
| GET | `/view/:slug/revisions/:revision/scene-index` | — | `offset`, `limit` (max 250). Revision-pinned, `immutable`. |
| GET | `/api/v1/platform/capabilities` | — | Product-language capability registry. |

### 8.1 Contract notes

- Reorder rewrites `sortOrder` only. Scene ids are stable, so connections,
  hotspot actions, publications and analytics keep resolving.
- `importance` is 0–100 and `preloadHint` is `none` / `normal` / `high`. Both are
  **hints** the platform's policy weighs — never cache or network commands.
- The manifest's `tour.strategy` decides delivery. `tour.sceneIndexSegmented`
  with `sceneIndexSegmentSize` (currently 250) signals a paged index.
- A scene id absent from the resolved publication returns 404 even if it exists
  as a draft. Handle it as a transition failure, not a crash.

---

## 9. State, Cache & Invalidation

- `scenes` and each `scene` — `staleTime: 0`. Reorder writes the returned
  ordering directly into cache before invalidating.
- Deleting a scene invalidates `scenes`, the deleted `scene`, `project`, and any
  scene whose connections referenced it.
- `sceneDefinition` and `sceneIndexPage` — keyed by slug **and** revision,
  `staleTime: Infinity`.
- Runtime scene cache is separate from TanStack Query: it holds decoded media
  and definitions for the active session and is bounded by the manifest budget.
- Preload requests are cancellable and cancelled on navigation.

---

## 10. UX & Responsive Requirements

- Selecting a scene changes the canvas **without a page reload** (PRD SCN-001).
- The scene list stays usable at 100+ scenes through virtualisation; the mental
  model does not change with size (PRD SCN-003).
- The creator connects scenes; the words "node", "graph" and "virtual tour node"
  never appear (product architecture §14, PRD Appendix C).
- Deleting a scene explains exactly what must be resolved first, with each
  reference navigable (PRD SCN-001).
- Preload and importance controls are expressed as intent, never as cache
  internals (PRD SCN-004).
- Auto-rotation preview reflects the saved behaviour; reduced-motion suppresses
  auto-start (PRD NAV-003).
- Allowed viewing area is set by framing the viewer, not by entering bounds
  (PRD NAV-002).
- The gallery is usable on touch; on phones it is a horizontally scrollable strip.
- Default behaviour must be good without any tuning (PRD SCN-004).

---

## 11. Error, Loading & Empty States

| Situation | Behaviour | Telemetry |
| --- | --- | --- |
| Single scene | Scenes tool shows an add-scene empty state; gallery hidden. | — |
| Scene delete blocked | Reference dialog; retry enabled after resolution. | — |
| Reorder rejected | Restore prior order; explain and retry. | — |
| Connection target deleted | Field-level error; the connection editor offers removal. | — |
| Scene definition fetch fails | Stay on the current scene, offer retry. | `scene_transition_failed` (`scene_definition_unavailable`) |
| Scene media fails | Same, after family fallbacks. | `scene_transition_failed` (`asset_unavailable`) |
| Scene index page fails | Gallery shows what loaded plus a retry affordance. | — |
| Capability fallback applied at compile | Advisory in validate/publish output, never a blocking error. | — |

---

## 12. Acceptance Criteria / Sprint Gate

1. A five-scene tour can be authored, connected, previewed and published, and
   navigation in preview matches the published player exactly (PRD SCN-002).
2. Reordering scenes persists, and every connection, hotspot action and
   publication reference still resolves afterwards.
3. Deleting a referenced scene returns `409 SCENE_IN_USE`; the dialog lists every
   reference; resolving them allows deletion.
4. A 100-scene project loads the editor without fetching every scene definition,
   and the scene list scrolls smoothly (PRD SCN-003).
5. A published 100-scene tour compiles as `progressive`; the initial manifest
   carries only the initial scene, and definitions are fetched on navigation
   (PRD BE-006).
6. A tour with more than 250 scenes pages its index, and the gallery renders
   incrementally.
7. A network trace during navigation shows: the target scene definition, at most
   `runtime.preload.maxScenesPerSource` preloaded scene definitions with **base**
   media only, and **no** blanket full-resolution preload (PRD RUN-002).
8. Back-navigation to a recently visited scene is served from cache with no
   duplicate media requests, and retained memory stays within the manifest's
   budget across 30 transitions (PRD RUN-003).
9. Gallery, compass, view limits and auto-rotation behave identically in preview
   and published playback.
10. Enabling a combination the resolver rejects produces a product-language
    explanation with a supported alternative — never a plugin error
    (PRD GAL-001).
11. `scene_changed` carries `sceneId`; every failed transition emits
    `scene_transition_failed` with `sourceSceneId`, `targetSceneId` and a valid
    `failureCategory`.
12. Scene transition with a preload hit meets p75 ≤ 1.5 s on the test profile.

---

## 13. Verification Requirements

- Unit: reorder payload completeness; connection set replacement semantics;
  reachability analysis; cache eviction against both budgets; preload selection
  and cancellation; transition failure categorisation.
- Integration: author and publish 3-scene, 40-scene and 300-scene tours; verify
  `embedded` versus `progressive` strategy and index segmentation.
- Performance: navigate 30 scenes and assert bounded memory, zero duplicate
  media requests, and preload counts within the declared maximum.
- Manual: gallery and scene navigation on a phone; reduced-motion behaviour;
  keyboard-only scene navigation.
- Resilience: delete a published scene from the draft and confirm the published
  player is unaffected until republish.

---

## 14. Execution Order

1. Scene list, add, rename, select; virtualisation.
2. Drag reorder with the complete-list contract.
3. Scene properties: panorama, opening view, viewing area, preload preference.
4. Delete flow with the `SCENE_IN_USE` reference dialog.
5. Connection editor, hotspot `scene` action, reachability overview.
6. Runtime `tour-controller` and transition orchestration.
7. Scene cache completion: LRU, coalescing, eviction, media release.
8. Preload controller with cancellation.
9. Progressive delivery and paged scene index.
10. Gallery, compass, auto-rotation, view-limit tools and their player behaviour.
11. Capability surfacing and fallback advisories.
12. Transition telemetry; gate verification at all three tour sizes.

---

## 15. Guardrails

1. Never re-derive the small/large tour threshold on the client.
2. Never preload more than `runtime.preload.maxScenesPerSource` scenes, and never
   preload primary or tiled media.
3. Never exceed the manifest's cache budgets; never cache without eviction.
4. Never send a partial scene list to the reorder route.
5. Never expose cache, eviction, preload counts or importance weights as
   technical settings.
6. Never say "node", "graph", "plugin" or "virtual tour node" in creator copy.
7. Never construct a scene-definition or scene-index URL by hand; use the
   manifest's templates.
8. Never let a failed transition destroy the current scene.
9. Do not add map, plan, overlay or immersive features here — they are FE-07.
