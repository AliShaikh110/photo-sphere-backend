# Frontend Scope, Routes & Flows

Derived from [../prd.md](../prd.md), [../product_architecture.md](../product_architecture.md)
and [frontend_trd.md](frontend_trd.md), and validated against the implemented
backend contracts in [../backend-api.md](../backend-api.md).

This document answers three questions: **what surfaces exist**, **what each one
does**, and **which backend capability makes it possible**. Behavioural detail
lives in [frontend-ux-spec.md](frontend-ux-spec.md); transport detail lives in
[frontend-api-integration.md](frontend-api-integration.md).

---

## 1. Application boundary

One Next.js application serves two distinct surfaces:

| Surface | Audience | Auth | Bundle rule |
| --- | --- | --- | --- |
| **Creator app** | Authenticated creators | Session required | May be large; loads editor tooling. |
| **Public player** | Anonymous or share-token visitors | None, or share token | Must stay minimal. Only the runtime modules the manifest declares. |

The two surfaces share exactly one thing: the **Viewer Runtime**
([frontend-viewer-runtime.md](frontend-viewer-runtime.md)). Editor code must
never be imported into the player bundle.

```text
Next.js application
├── (creator)          authenticated shell, dashboard, editor, analytics
│      └── uses Viewer Runtime for draft preview
└── (player)           /view/[slug] — published visitor experience
       └── uses Viewer Runtime for published manifests
                 ↑
        Viewer Runtime (shared, renderer-facing)
                 ↑
        Photo Sphere Viewer 5.14.3
```

### Photo Sphere Viewer version

The backend compiles against `viewerIntegrationVersion: psv-5.14.3-adapter-2`
and exposes the active version through `GET /api/v1/platform/viewer-integrations`.
The frontend **pins `@photo-sphere-viewer/*` to 5.14.3** and reports the
`viewerIntegrationVersion` it rendered with in every telemetry event.

---

## 2. Route map

`[projectId]` is a UUID. `[slug]` is a publication slug.

### Public / unauthenticated

| Route | Purpose | Backend | Sprint |
| --- | --- | --- | --- |
| `/login` | Sign in | `POST /api/v1/auth/login` | FE-01 |
| `/register` | Create account | `POST /api/v1/auth/register` | FE-01 |
| `/view/[slug]` | **Published player.** The canonical share/embed/QR target. | `GET /view/:slug/manifest` and the delivery routes beneath it | FE-03 |

> `/view/:slug` is served by the frontend; every path **beneath** it
> (`/view/:slug/manifest`, `/view/:slug/scenes/:sceneId`,
> `/view/:slug/revisions/...`, `/view/:slug/playback-profile`) is served by the
> backend. The frontend must not define those child routes. See
> [frontend-validation-report.md](frontend-validation-report.md) §R7.

### Creator app (session required)

| Route | Purpose | Primary backend routes | Sprint |
| --- | --- | --- | --- |
| `/dashboard` | Projects overview + primary **Create Experience** action | `GET /api/v1/projects` | FE-01 |
| `/projects` | Full project index with filtering | `GET /api/v1/projects` | FE-01 |
| `/experiences/[projectId]` | **The editor.** Canvas-first builder for `image360` and `video360` | `GET/PATCH /api/v1/projects/:projectId` and its child resources | FE-04 |
| `/viewer/[projectId]` | Full-screen **draft preview** of the current revision | `POST /api/v1/projects/:projectId/preview-manifest` | FE-04 |
| `/projects/[projectId]/share` | Publication history, share links, embed policy | publish / publications / share-tokens / embed-policy | FE-04, FE-08 |
| `/projects/[projectId]/analytics` | Creator analytics | six `.../analytics/*` routes | FE-08 |
| `/projects/[projectId]/access` | Per-project access grants and audit log | `.../access`, `.../audit-log` | FE-08 |
| `/assets` | Media library (scope-limited, see §5) | `GET /api/v1/assets/:assetId` | FE-02 |
| `/templates` | Template catalogue and instantiation | `/api/v1/templates*` | FE-08 |
| `/workspaces` | Workspace list and creation | `/api/v1/workspaces` | FE-08 |
| `/workspaces/[workspaceId]` | Members, custom domains, audit log | `/api/v1/workspaces/:workspaceId/*` | FE-08 |
| `/settings` | Account settings | — | FE-01 |
| `/admin/viewer-integrations` | Rollout console (platform admin only) | `/api/v1/platform/*` | FE-08 (optional) |

### Route-level notes

- `/experiences/[projectId]` branches on `project.type`. An `image360` project
  gets the scene canvas; a `video360` project gets the same shell plus the
  timeline. Scene routes return `422 PROJECT_TYPE_MISMATCH` on a video project
  and timeline routes return `422 TIMELINE_NOT_AVAILABLE` on an image project —
  the editor must never call the wrong family.
- `/viewer/[projectId]` and `/view/[slug]` render through the **same** Viewer
  Runtime. PRD PUB-001 requires preview behaviour to match the published player
  for the same revision; a divergent preview implementation violates it.
- Directory placement follows [frontend_trd.md](frontend_trd.md) §6: route-local
  UI in `_components`, cross-cutting UI in `src/components`, feature logic in
  `src/features/*`.

---

## 3. Primary flows

### 3.1 Image experience (PRD §3.3)

```text
Register/Login → Dashboard → Create Experience → "360° Image"
   → project created (revision 1, image360)
   → Editor opens with an empty canvas and the Media tool active
   → Upload panorama  (session → PUT bytes → complete → poll to `ready`)
   → Scene created from the ready panorama asset
   → Add hotspots by clicking the panorama; edit contextual properties
   → Appearance / Branding / Navigation settings
   → Preview  (preview-manifest, same compiler path as publish)
   → Publish  (slug + visibility, Idempotency-Key)
   → Copy Link / Embed / QR
```

### 3.2 Video experience (PRD §3.4)

```text
Create Experience → "360° Video" → project created (video360)
   → Upload 360° video (poster + desktop/mobile profiles produced asynchronously)
   → PATCH project with videoAssetId
   → Timeline appears once durationMs is known
   → Place timed interactions; drag, duplicate, delete
   → Preview → Publish → Share
```

### 3.3 Visitor (published)

```text
Open /view/[slug]
   → fetch manifest (public, or private with session/share token)
   → resolve capabilities; lazy-load declared runtime modules
   → render low-resolution base, then the primary/tiled derivative
   → emit experience_load_started, first_panorama_visible, time_to_interactive
   → navigate scenes / play video / open hotspots
   → emit engagement + reliability telemetry
   → experience_exited
```

### 3.4 Recovery flows (PRD §15)

Every flow above must have a defined failure branch:

| Failure | Frontend behaviour |
| --- | --- |
| Upload fails | Project untouched; retry available; no phantom ready asset. |
| Processing fails | Asset shows plain-language failure and a **Reprocess** action. |
| Save conflict (`409 REVISION_CONFLICT`) | Never silently overwrite; offer reload/retry with edits preserved. |
| Preflight fails | Show product-language issues; focus the editor control named by `path`. |
| Publish fails | Previous published revision stays live; draft stays editable; retry with a new idempotency key. |
| Runtime asset fails | Graceful fallback; the shell keeps working; `asset_failed` telemetry. |
| Optional capability unsupported | Continue in normal 360°; `capability_fallback` telemetry. |

---

## 4. Feature to backend capability matrix

Every frontend feature below is backed by an implemented backend route or
manifest field. Nothing in this table is speculative.

| Frontend feature | Backend basis | Sprint |
| --- | --- | --- |
| Auth, session | `POST /auth/register`, `POST /auth/login` | FE-01 |
| Project list / create / rename / settings / branding | `/api/v1/projects*` | FE-01 |
| Effective role gating | `GET /api/v1/projects/:projectId/access/me` | FE-04 |
| Panorama and video upload, status, reprocess | `/api/v1/assets*`, `processingStages` | FE-02 |
| Panorama rendering, crop, straighten | `manifest.scenes[].panorama` (`crop`, `sphereCorrection`) | FE-03 |
| Point hotspots + information/link/asset/scene actions | `/scenes/:sceneId/hotspots*`, `CompiledHotspotAction` | FE-03, FE-04 |
| Draft preview | `POST /projects/:id/preview-manifest` | FE-04 |
| Preflight validation | `POST /projects/:id/validate` | FE-04 |
| Publish, share link, embed HTML, QR target | `POST /projects/:id/publish` then `share` | FE-04 |
| Publication history, unpublish, republish | `/publications`, `/unpublish` | FE-04 |
| Scenes: create, reorder, delete-with-references | `/scenes`, `/scenes/reorder`, `409 SCENE_IN_USE` | FE-05 |
| Scene connections, preload hints | `scene.connections[]` (`importance`, `preloadHint`) | FE-05 |
| Gallery, compass, view limits, auto-rotation | `settings.gallery/compass/autorotation`, `scene.viewLimits` | FE-05 |
| Progressive large tours | `tour.strategy`, `sceneDefinitionUrlTemplate`, `sceneIndexUrl` | FE-05 |
| Scene cache + adjacent preload | `runtime.cache`, `runtime.preload`, `scene.preloadSceneIds` | FE-05 |
| 360° video playback + profile selection | `manifest.video.profiles`, `POST /view/:slug/playback-profile` | FE-06 |
| Timeline authoring (7 interaction kinds) | `/timeline*`, incl. batch `PATCH /timeline` | FE-06 |
| Floor/site plans + scene placement | `/plans*`, `scenes.spatialData` | FE-07 |
| Map / plan navigation | `settings.map`, `settings.plan`, `manifest.spatialIndex`, `manifest.plans` | FE-07 |
| Overlays and advanced geometry | `/scenes/:sceneId/overlays*` | FE-07 |
| Custom interactions | `/api/v1/extensions*`, `geometry.kind = custom` | FE-07 |
| Motion navigation / stereo / VR | `settings.motionNavigation`, `settings.immersiveViewing`, `runtime.deferredDeviceCapabilities` | FE-07 |
| Quality / high-resolution / cubemap | `settings.quality`, `panorama.family`, `fallbackFamilies` | FE-07 |
| Templates | `/api/v1/templates*` | FE-08 |
| Workspaces, members, project grants, audit log | `/api/v1/workspaces*`, `/access*`, `/audit-log` | FE-08 |
| Share tokens, embed policy, custom domains | `/share-tokens*`, `/embed-policy`, `/custom-domains*` | FE-08 |
| Creator analytics (6 views) | `/analytics/summary`, `timeseries`, `scenes`, `interactions`, `video`, `reliability` | FE-08 |
| Capability catalogue for progressive disclosure | `GET /api/v1/platform/capabilities` | FE-04 onward |

---

## 5. Deliberately constrained or excluded

These are **not** frontend decisions to revisit — they follow from what the
backend does and does not expose. Each is tracked in
[frontend-validation-report.md](frontend-validation-report.md).

| Item | Status | Reason |
| --- | --- | --- |
| Cross-project reusable **asset library** | Constrained | No `GET /api/v1/assets` list route exists. `/assets` shows assets referenced by projects the user can read plus a client-side recent-uploads list. |
| **Delete project** | Not available | No `DELETE /api/v1/projects/:projectId` route exists. |
| **Sign out / refresh / current-user** endpoints | Client-side only | Only `register` and `login` exist. Sign-out clears the session locally; expiry is handled by re-authentication. |
| Dashboard **project thumbnails** | Not in v1 | The project list DTO carries no media reference, and PRD PRJ-001 forbids fetching full Experience payloads for the list. |
| **QR bitmap** | Frontend-generated | The backend returns `share.qrTarget` (a URL), explicitly not a bitmap. |
| Renderer vocabulary in the UI | Forbidden | PRD Appendix C. Yaw/pitch, adapters, plugins, `panoData`, cache policy and codecs never appear in creator-facing copy. |
| Live 360° input, dual-fisheye ingest | Hidden unless enabled | `GET /api/v1/platform/capabilities` reports these providers as `enabled` or `unavailable`; `501 LIVE_SOURCE_NOT_SUPPORTED` otherwise. |
| Non-linear video editing | Out of product scope | PRD §2.2 and product architecture §22 and §24. |

---

## 6. Requirement traceability

Every requirement ID in [../prd.md](../prd.md) is listed. Backend-owned
requirements are included with the obligation they place on the frontend, so
"backend concern" is a stated conclusion rather than an omission.

### 6.1 UX and frontend requirements

| ID | Requirement | Sprint | Where specified |
| --- | --- | --- | --- |
| FE-001 | Canvas-first editor shell | FE-04 | [frontend-ux-spec.md](frontend-ux-spec.md) §1 |
| FE-002 | Progressive disclosure | FE-04 | [frontend-ux-spec.md](frontend-ux-spec.md) §2 |
| FE-003 | Save state and unsaved changes | FE-04 | [frontend-ux-spec.md](frontend-ux-spec.md) §4.1 |
| FE-004 | Responsive editor behaviour | FE-04 | [frontend-ux-spec.md](frontend-ux-spec.md) §5 |
| PRJ-001 | Dashboard | FE-01 | FE-01 §6, §10 |
| PRJ-002 | Experience type selection | FE-01 | FE-01 §10 |
| PRJ-003 | Project naming | FE-01 | FE-01 §10 |
| AST-001 | Drag/drop + browse upload | FE-02 | FE-02 §4, §10 |
| AST-002 | Processing status | FE-02 | FE-02 §10 |
| AST-003 | Media summary | FE-02 | FE-02 §10 |
| AST-004 | Correction actions | FE-02 | Backend-derived from XMP; no client correction UI — FE-02 §5, §15 |
| HOT-001 | Visual hotspot placement | FE-04 | [frontend-ux-spec.md](frontend-ux-spec.md) §3 |
| HOT-002 | Hotspot properties | FE-04 | FE-04 §4, §10 |
| HOT-003 | Hotspot action types | FE-04 (information, image, video, link), FE-05 (scene) | FE-04 §4; broken references caught by preflight, FE-04 §8.1 |
| HOT-004 | Future geometry compatibility | FE-04 (points only), FE-07 (richer geometry) | [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §7 |
| SCN-001 | Scene list | FE-05 | FE-05 §4, §10 |
| SCN-002 | Connect scenes visually | FE-05 | FE-05 §4 |
| SCN-003 | Large-tour UX | FE-05 | FE-05 §4, §12 |
| SCN-004 | Scene runtime hints | FE-05 | FE-05 §4, §10 |
| CNT-001 | Information panels | FE-04 | FE-04 §4; sanitisation in [frontend-api-integration.md](frontend-api-integration.md) §10 |
| APP-001 | Appearance | FE-04 | FE-04 §4, §10 |
| BRD-001 | Branding | FE-04 | FE-04 §4; missing-asset rule in FE-03 §10 |
| NAV-001 | Viewer controls | FE-05 | FE-05 §4 |
| NAV-002 | Allowed viewing area | FE-05 | FE-05 §4, §10 |
| NAV-003 | Auto rotation | FE-05 | FE-05 §4, §10 |
| GAL-001 | Gallery | FE-05 | FE-05 §4, §12 |
| IMM-001 | Gyroscope / stereo / VR | FE-07 | FE-07 §4, §10; [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §10.2 |
| VID-001 | Video canvas + timeline | FE-06 | FE-06 §4, §10 |
| VID-002 | Timed interactions | FE-06 | FE-06 §4 |
| VID-003 | Device-aware playback | FE-06 | [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §9.1 |
| PUB-001 | Preview mode | FE-04 | FE-04 §4; [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §13 |
| PUB-002 | Publish form | FE-04 | [frontend-ux-spec.md](frontend-ux-spec.md) §4.4 |
| PUB-003 | Share outputs | FE-04 | FE-04 §4, §8.1 |
| PUB-004 | Republish | FE-04 | FE-04 §4; cache note in [frontend-validation-report.md](frontend-validation-report.md) §B G7 |

### 6.2 Runtime and security requirements the frontend owns

| ID | Requirement | Sprint | Where specified |
| --- | --- | --- | --- |
| RUN-001 | Viewer lifecycle | FE-03 | [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §11 |
| RUN-002 | Preloading | FE-05 | [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §8.3 |
| RUN-003 | Caching | FE-05 | [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §8.4 |
| RUN-004 | Capability fallback | FE-03, FE-07 | [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §10 |
| SEC-001 | Rich-content sanitisation | FE-04 | Server response authoritative — [frontend-api-integration.md](frontend-api-integration.md) §10 |
| SEC-002 | URL validation | FE-04 | Client validates scheme; server policy authoritative — same §10 |
| SEC-003 | Upload validation | FE-02 | Client checks are convenience only — FE-02 §8.1 |
| SEC-004 | Private experiences | FE-03, FE-04 | Visibility labelled at publish (FE-04 §10); access states in FE-03 §8.1 |
| SEC-005 | Embed security | FE-08 | Embed policy editor — FE-08 §8.2 |
| SEC-006 | Asset delivery | FE-03 | Never log, rewrite or persist a signed URL — [frontend-api-integration.md](frontend-api-integration.md) §6 |

### 6.3 Backend-owned requirements and the obligation they place on the frontend

| ID | Requirement | Frontend obligation |
| --- | --- | --- |
| BE-001 | Renderer-independent persistence | Never send renderer configuration in a canonical payload; renderer vocabulary exists only inside the Viewer Runtime binder. |
| BE-002 | Schema versioning | Assert `manifestVersion === 4`; fail explicitly on anything else. FE-03 §12. |
| BE-003 | Optimistic concurrency | Revision protocol and conflict handling. [frontend-api-integration.md](frontend-api-integration.md) §3. |
| BE-004 | Idempotent media/job requests | One key per intent, reused across transport retries. Same doc §4. |
| BE-005 | Immutable derivatives | Treat every derivative URL as version-specific and cache-safe; never cache-bust, rewrite or re-sign one. Same doc §6. |
| BE-006 | Progressive scene fetch | Progressive tour delivery and paged scene index. FE-05 §4. |
| BE-007 | Capability-safe compilation | Editor requests preflight and renders product-language issues. FE-04 §8.1. |
| BE-008 | Safe rich content | Rich editor allowed; the server response is the source of truth after save. FE-04 §4. |
| MED-001 | Logical asset abstraction | Show one asset, never its derivative catalogue. FE-02 §15. |
| MED-002 | Automatic derivative selection | Use the family and profile the manifest selected. [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §6.1, §9.1. |
| MED-003 | Low-res-first panorama | Paint `basePanorama` before the primary or tiled source. Same doc §6.2. |
| MED-004 | Video compatibility | Select a handheld-safe profile; never assume the original is playable. FE-06 §12. |
| MED-005 | Recoverable jobs | Expose reprocess, including per-profile video reprocess. FE-02 §4. |

### 6.4 Cross-cutting sections

| PRD section | Frontend delivery |
| --- | --- |
| §13 Analytics and Observability | FE-03 emission, FE-08 dashboards; [frontend-telemetry.md](frontend-telemetry.md) |
| §14 Performance and Reliability | FE-03, FE-05, FE-06 budgets; [frontend-viewer-runtime.md](frontend-viewer-runtime.md) §14 |
| §15 Error Handling and Recovery | §3.4 above; per-sprint error tables |
| §16.1 Phase-1 Definition of Done | Complete at the end of FE-04 |
