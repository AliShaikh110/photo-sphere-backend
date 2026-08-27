# Frontend Sprint 04 — Image Editor, Preview, Publish & Share

> **Depends on:** [FE-02](fe-sprint-02-media-upload-assets.md), [FE-03](fe-sprint-03-viewer-runtime-player.md)
> **Backend basis:** backend Sprint 01 editing/preview/publish plus the Sprint 04 role model, implemented
> **UX contract:** [../frontend-ux-spec.md](../frontend-ux-spec.md) — binding for this sprint
>
> **This sprint completes PRD §16.1, the Phase-1 Definition of Done.**

---

## 1. Sprint Objective

Deliver the canvas-first editor for a single-scene `image360` experience and the
whole path from editing to a shareable published link:

**Upload → edit visually → preview → publish → share.**

A first-time creator must complete this without documentation and without ever
seeing a technical field.

---

## 2. Outcomes Required

By sprint completion:

- The editor shell renders top bar, collapsible tool panel, dominant viewer and
  a contextual properties panel that is never empty.
- A ready panorama becomes the project's scene; the canvas shows the live draft.
- A hotspot is created by clicking the panorama — no angle is ever typed — and
  edited in the properties panel.
- Hotspot types cover information, image, video, link (and scene, wired but
  exercised in FE-05), with type changes clearing incompatible fields.
- Appearance, branding and navigation settings are editable with product-level
  controls and no CSS.
- Save state is visible; conflicts are handled; navigation with unsaved work
  warns.
- Preflight validation surfaces product-language issues that focus the offending
  control.
- Preview renders the draft through the **same** runtime and compiler path as
  publish.
- Publish is atomic from the creator's view; failure leaves the previous
  published revision live and the draft editable.
- Share outputs — direct link, embed code, QR — are produced and copyable.
- Publication history supports republish and unpublish.
- The effective project role gates which controls appear.

---

## 3. Dependencies

| Dependency | Status |
| --- | --- |
| FE-02 upload, asset picker, readiness helpers | Required |
| FE-03 Viewer Runtime | Required — preview reuses it unchanged |
| Backend scenes, hotspots, validate, preview-manifest, publish, publications, unpublish | Implemented |
| Backend `GET /projects/:id/access/me` | Implemented |
| Backend `GET /api/v1/platform/capabilities` | Implemented (cached in FE-01) |

---

## 4. In Scope

### Editor shell
- `/experiences/[projectId]` with the layout and panel states in
  [../frontend-ux-spec.md](../frontend-ux-spec.md) §1.
- Tool registry and the FE-04 tool set: Media, Hotspots, Information,
  Appearance, Branding, Settings.
- Contextual properties panel driven by a single selection model.
- Viewer resize on panel change; collapse state persisted.
- Save indicator, unsaved-change guard, conflict dialog.
- Role resolution via `access/me`; publish and admin controls hidden below
  `admin`.

### Scene and canvas
- Create the project's first scene from a ready `panorama_image`.
- Replace the scene's panorama.
- Edit scene name and initial view — **by framing the viewer and pressing "Set
  as opening view"**, never by typing angles.
- Render the draft canvas through the Viewer Runtime using the preview manifest.

### Hotspots
- Placement mode state machine ([../frontend-ux-spec.md](../frontend-ux-spec.md) §3).
- Optimistic creation, drag to reposition, delete.
- Properties: name/label, type, tooltip, emphasis, content, action.
- Type-aware content forms:
  - information — title, description, rich body, button label + link
  - image — image asset picker (`image` / `logo`)
  - video — video asset picker (`video`)
  - link — external URL with scheme validation
  - scene — target scene selector (single-scene projects show an empty-state hint)
- Rich text editor constrained to the server's allow-list; re-render from the
  server response after save.

### Settings, appearance and branding
- Appearance: theme, primary colour, background colour, hotspot style,
  typography.
- Navigation: mouse, touch, zoom, keyboard, fullscreen, navigation buttons.
- Information: experience title, description, body, external link.
- Branding: company name, logo/favicon/watermark asset pickers, primary colour,
  welcome and loading messages.

### Validate, preview, publish, share
- `POST /validate` before preview and before publish; issues panel grouped by
  entity with `path`-based focus.
- `/viewer/[projectId]` full-screen draft preview with device simulation
  (Phone / Tablet / Desktop) and signed-URL expiry refresh.
- Publish dialog: name, slug, visibility, with slug validation and
  `SLUG_ALREADY_EXISTS` as a field error.
- Share panel: Copy Link, Copy Embed Code, QR (rendered client-side from
  `share.qrTarget`).
- `/projects/[projectId]/share`: publication history, current revision,
  republish, unpublish.

---

## 5. Out of Scope for FE-04

- Multiple scenes, scene list, reorder, connections, gallery, compass, view
  limits, auto-rotation (FE-05).
- Progressive tours, preload and cache tuning (FE-05).
- Video projects and the timeline (FE-06).
- Plans, map, overlays, advanced geometry, extensions, immersive (FE-07).
- Share tokens, embed policy, access management UI, templates, analytics
  (FE-08). Only the read-only role gate lands here.

A `video360` project opened in the editor this sprint shows a
"coming in a later release" state rather than a broken canvas.

---

## 6. Routes & Screens

| Route | Screen |
| --- | --- |
| `/experiences/[projectId]` | The editor. |
| `/viewer/[projectId]` | Full-screen draft preview. |
| `/projects/[projectId]/share` | Publication history and share outputs. |

---

## 7. Frontend Work Breakdown

### 7.1 Types and schemas
`Scene`, `Hotspot`, `HotspotGeometry`, `HotspotAction`, `HotspotContent`,
`HotspotAppearance`, `InitialView`, `ValidationIssue`, `Publication`,
`ShareTargets`, `ProjectRole`.

### 7.2 Services
- `scene-service.ts`: `listScenes`, `getScene`, `createScene`, `updateScene`,
  `deleteScene`.
- `hotspot-service.ts`: `createHotspot`, `updateHotspot`, `deleteHotspot`.
- `experience-service.ts`: `validateProject`, `getPreviewManifest`,
  `publishProject`, `unpublishProject`, `listPublications`.
- `access-service.ts`: `getMyRole`.

Every scene and hotspot call carries `projectRevision`; every project-level call
carries `revision`. `DELETE` requests send a JSON body with
`Content-Type: application/json`.

### 7.3 Editor feature modules
`features/editor/` — shell, tool registry, selection store, save controller.
`features/scenes/`, `features/hotspots/`, `features/appearance/`,
`features/branding/`, `features/publish/`.

### 7.4 Editor canvas
`features/editor/canvas/EditorCanvas.tsx` wraps the Viewer Runtime host in edit
mode:
- Feeds it the preview manifest.
- Adds an interaction layer for placement and selection.
- Converts a canvas click to `{ coordinateSystem: 'spherical_degrees',
  longitudeDegrees, latitudeDegrees }`.
- Reads the current camera framing for "Set as opening view".

The runtime is **not** forked. Edit affordances are a layer above it.

### 7.5 Preview manifest lifecycle
`use-preview-manifest.ts` — recompiles on revision change, debounced, with a
manual refresh, and refetches before `expiresAt` lapses.

---

## 8. Backend / API Integrations

| Method | Route | Precondition | Notes |
| --- | --- | --- | --- |
| GET | `/api/v1/projects/:projectId` | — | Canonical draft with `revision`. |
| PATCH | `/api/v1/projects/:projectId` | `revision` | Settings, branding, name. |
| GET | `/api/v1/projects/:projectId/access/me` | — | Effective role and its source. |
| GET | `/api/v1/projects/:projectId/scenes` | — | Ordered by `sortOrder`. |
| POST | `/api/v1/projects/:projectId/scenes` | `projectRevision` | Omit `initialView` to inherit the panorama's captured framing. |
| GET/PATCH | `/api/v1/projects/:projectId/scenes/:sceneId` | `projectRevision` on PATCH | |
| DELETE | `/api/v1/projects/:projectId/scenes/:sceneId` | `projectRevision` | May return `409 SCENE_IN_USE`. |
| POST/PATCH/DELETE | `.../scenes/:sceneId/hotspots[/:hotspotId]` | `projectRevision` | Geometry is `{ kind: 'point' }` this sprint. |
| POST | `/api/v1/projects/:projectId/validate` | `revision` | Issues returned as **data**, not an HTTP error. |
| POST | `/api/v1/projects/:projectId/preview-manifest` | `revision` | Signed media URLs with `expiresAt`. |
| POST | `/api/v1/projects/:projectId/publish` | `revision`, `Idempotency-Key` | Returns `publication` and `share`. |
| POST | `/api/v1/projects/:projectId/unpublish` | current publication | Admin only. |
| GET | `/api/v1/projects/:projectId/publications` | — | History, including failed attempts. |

### 8.1 Behaviour notes

- **Scene creation without `initialView`** adopts the panorama's captured
  framing from XMP when present. Prefer omitting it so creators get a sensible
  first view for free.
- **Validation issues are data.** `{ valid, issues[] }` with `code`,
  `entityType`, `entityId`, `path`, `message`, `retryable`. Only a malformed
  request or stale revision is an HTTP error.
- **Publish failure** creates one non-current `publish_failed` attempt.
  Replaying the same idempotency key replays the same error — mint a **new** key
  after fixing the draft.
- **Share values are backend-generated.** Display `share.directUrl`,
  `share.embedHtml` and `share.qrTarget` verbatim; do not rebuild them. The QR
  image is rendered client-side from `qrTarget`.

### 8.2 Role gating

`access/me` returns `{ role, source }`. `viewer` sees a read-only editor;
`editor` can edit but not publish; `admin` and `owner` can publish, unpublish and
change embed policy. Hide, do not disable, actions the role cannot perform.

---

## 9. State, Cache & Invalidation

- `project`, `scenes`, `scene` — `staleTime: 0`; `refetchOnWindowFocus` disabled
  while the canvas is mounted.
- `previewManifest` keyed by `[projectId, revision]`; invalidated by any
  successful mutation; refetched before `expiresAt`.
- `publications` — `staleTime: 30 s`; invalidated on publish and unpublish.
- `projectRole` — `staleTime: 5 min`.
- Every editor mutation writes the returned `projectRevision` into the `project`
  cache before dependent invalidations.
- Mutations scoped per project so writes serialise.
- Selection state (`{ kind: 'hotspot' | 'scene' | 'none', id? }`) lives in a
  React context, never in the query cache.

---

## 10. UX & Responsive Requirements

Binding: [../frontend-ux-spec.md](../frontend-ux-spec.md) §1–§7.

Sprint-specific emphasis:

- The viewer expands whenever a panel collapses (PRD FE-001).
- The properties panel is never mounted with nothing selected (PRD FE-001).
- Hotspot placement shows a persistent hint; `Esc` cancels and creates nothing
  (PRD HOT-001).
- Changing a hotspot type must not leave invalid fields — clear the payload
  sections that do not belong to the new type, matching backend behaviour
  (PRD HOT-002).
- Colour and font choices fall back safely; no CSS is required for branding
  (PRD APP-001).
- Preview hides all editor chrome in one action (PRD PUB-001).
- Publish copy explains visibility in visitor terms, not policy terms.
- Tablet width keeps the viewer usable with panels as drawers (PRD FE-004).
- No essential action requires hover.

---

## 11. Error, Loading & Empty States

| Situation | Behaviour |
| --- | --- |
| No panorama yet | Canvas empty state pointing at the Media tool. |
| Panorama still processing | Canvas shows the processing state; hotspot tools disabled with a reason. |
| Panorama failed | Canvas failure state with Replace and Reprocess. |
| Preview manifest compile fails | Issues panel; each issue focuses its control via `path`. |
| Hotspot create fails | Optimistic marker removed; retryable error; placement mode not re-entered automatically. |
| Save conflict | Conflict dialog; edits preserved. |
| Publish preflight fails | Issues panel instead of the publish dialog. |
| Publish fails | Error state stating the previous published version is still live. |
| Signed preview URL expired | Silent manifest refresh; a visible error only if the refresh fails. |
| Role below `editor` | Read-only editor with an explanatory banner. |

---

## 12. Acceptance Criteria / Sprint Gate

PRD §16.1 Phase-1 DoD is the bar. Specifically:

1. An authenticated creator can create an `image360` project, upload a panorama,
   watch processing, and enter the editor once a ready derivative exists.
2. A hotspot can be added, edited and deleted **entirely visually**; no yaw,
   pitch, radian or coordinate field exists anywhere in the UI.
3. Changing a hotspot's type leaves no incompatible fields, and the panel
   reflects the server's stored result.
4. Appearance and branding are configurable through product-level controls with
   no CSS.
5. Preview uses the same compiler and runtime path as publish, and hides all
   authoring UI.
6. Publishing produces a public or private revision and returns a working direct
   URL, embed code and QR target; the direct URL renders in FE-03's player.
7. A forced publish failure leaves the previously published revision live and
   the draft editable, and retry after a fix (with a new key) succeeds.
8. A `409 REVISION_CONFLICT` during editing never loses work silently.
9. Preflight issues focus the correct editor control from the returned `path`.
10. A `viewer`-role user sees a read-only editor with no publish control; an
    `editor`-role user sees no publish control; an `admin` does.
11. Collapsing the tool panel expands the viewer; the properties panel is absent
    when nothing is selected.
12. No creator-facing string contains renderer vocabulary
    ([../frontend-ux-spec.md](../frontend-ux-spec.md) §7).

---

## 13. Verification Requirements

- Unit: selection model; hotspot type-change field clearing; canvas click to
  spherical degrees; validation-issue to control mapping; save state machine;
  idempotency-key lifecycle across a failed then corrected publish.
- Integration, against a live backend: create → upload → scene → hotspots →
  validate → preview → publish → open the published URL in the player →
  republish → unpublish.
- Concurrency: two sessions editing the same project produce a conflict dialog,
  not a lost update.
- Manual: complete the whole flow on a tablet; complete it with keyboard only;
  complete it with `prefers-reduced-motion` enabled.
- Performance: property changes give visible feedback within ~100 ms; publish of
  a ready single-scene image experience completes within a few seconds.

---

## 14. Execution Order

1. Editor shell, panel states, tool registry, selection model.
2. Role resolution and control gating.
3. Scene service and first-scene creation from a ready panorama.
4. Editor canvas wrapping the Viewer Runtime with the preview manifest.
5. Save controller: debounce, revision handling, conflict dialog, unsaved guard.
6. Hotspot placement, optimistic create, drag, delete.
7. Hotspot properties, type-aware content forms, asset pickers.
8. Appearance, branding, navigation and information settings.
9. Validation service and issues panel with `path` focus.
10. Preview route and device simulation.
11. Publish dialog, share panel, QR rendering.
12. Publication history, republish, unpublish.
13. Gate verification against the Phase-1 DoD list.

---

## 15. Guardrails

1. Never expose yaw, pitch, radians, adapters, plugins or `panoData` in the UI.
2. Never build a second viewer implementation for the editor; wrap FE-03's
   runtime.
3. Never send a scene or hotspot mutation without `projectRevision`, or a
   project-level one without `revision`.
4. Never auto-retry a revision-guarded mutation after a conflict.
5. Never reuse an idempotency key after the creator changes the draft.
6. Never construct share URLs client-side; display the backend's values.
7. Never mount the properties panel empty.
8. Never trust local rich-text sanitisation; re-render from the server response.
9. Do not implement multi-scene UI, gallery, auto-rotation or view limits — they
   are FE-05, and shipping them early breaks the tool-availability rules.
10. Do not add share tokens, embed policy or access management here.
