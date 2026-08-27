# Frontend Documentation Validation Report

Result of validating the frontend documentation and sprint plan against
[../prd.md](../prd.md), [../product_architecture.md](../product_architecture.md),
[frontend_trd.md](frontend_trd.md), [../backend-api.md](../backend-api.md),
[../backend-schema.md](../backend-schema.md), the four backend sprint documents,
and the implemented backend source.

Everything below was checked against the running backend code, not only its
documentation. Each item states the resolution taken so implementers do not have
to re-derive it.

---

## A. Documentation conflicts resolved

### R1 — `manifestVersion` is 4, not 3

- [../backend-schema.md](../backend-schema.md) §"Compiler and manifest
  versioning" states the manifest contract version is "currently `3`".
- [../backend-api.md](../backend-api.md) §Publishing states it is the numeric
  compiler schema version `4`, serialised as `"4"`.
- `src/compiler/types.ts` defines `COMPILED_MANIFEST_VERSION = 4`.

**Resolution:** the frontend targets **`manifestVersion === 4`** and fails
explicitly on any other value (PRD BE-002). `backend-schema.md` is stale on this
point and should be corrected in the backend repository.

### R2 — `GET /api/v1/projects` returns more than owned projects

[../backend-api.md](../backend-api.md) says "Lists projects owned by the current
user". `src/services/project-service.ts` filters with
`accessibleProjectFilter(userId)`, which includes workspace membership and
per-project grants.

**Resolution:** the dashboard treats the list as "projects I can access". It must
not assume the caller is the owner, and must resolve the effective role per
project through `GET /api/v1/projects/:projectId/access/me` before showing
editor or admin actions.

### R3 — Sprint-01 preflight restrictions are superseded

[../backend-schema.md](../backend-schema.md) §Hotspot says `openAsset` and
`goToScene` actions "return `CAPABILITY_UNSUPPORTED` at preflight", and that
non-empty `viewLimits`, `overlays`, `connections`, `spatialData` and
`runtimeHints` "fail Sprint 01 runtime preflight". Sprints 02–04 implemented all
of these.

**Resolution:** those sentences describe the Sprint-01 state only. The frontend
must never hard-code which actions or fields are supported — it relies on the
live result of `POST /projects/:id/validate` and on
`GET /api/v1/platform/capabilities`.

### R4 — Manifest URLs are root-relative

Verified in `src/services/experience-service.ts` (`/api/v1/media/...`,
`/api/v1/publications/...`) and `src/compiler/experience-compiler.ts`
(`tileUrlTemplate`, `sceneDefinitionUrlTemplate`, `sceneIndexUrl`,
`selectionUrl`). None is absolute.

**Resolution:** a single `resolveManifestUrl()` helper prefixes
`NEXT_PUBLIC_MEDIA_ORIGIN`, preserving query strings (signed media tokens live
there). See [frontend-api-integration.md](frontend-api-integration.md) §6. In the
production same-origin reverse-proxy shape the prefix is empty.

### R5 — `viewerIntegration.config` is not Photo Sphere Viewer options

`src/compiler/viewer-integration-adapter.ts` emits renderer-*shaped* JSON:
`adapter` is a string name; `gallery`, `map`, `plan`, `compass`, `stereo`,
`gyroscope` and `autorotation` are plugin configurations; `touchControlsEnabled`,
`sceneNavigation` and `basePanorama` have no Photo Sphere Viewer equivalent.

**Resolution:** the Viewer Runtime contains an explicit **binder** that
translates this object into the real constructor and plugin set. It is the only
file that changes when the renderer integration version changes. See
[frontend-viewer-runtime.md](frontend-viewer-runtime.md) §5.

### R6 — Frontend TRD's Server Actions chain versus binary upload

[frontend_trd.md](frontend_trd.md) §7 specifies
`TanStack Query → Server Action → Axios → Backend API`, but uploads can reach
1 GiB and Server Actions are not a streaming body transport. The backend has no
refresh, logout or current-user endpoint.

**Resolution (stated architectural decision):** the access token lives in an
httpOnly session cookie; JSON calls go through Server Actions as the TRD
specifies; binary upload uses a dedicated **streaming Route Handler** that
attaches the bearer server-side. If the team prefers a browser-held token, only
`src/lib/api/*` changes. Recorded in
[frontend-api-integration.md](frontend-api-integration.md) §1.

### R7 — `/view/:slug` path ownership

[../runbook.md](../runbook.md) states production routing must serve the frontend
shell at `/view/:slug` and route its manifest request to the backend. The backend
already owns `/view/:slug/manifest`, `/view/:slug/scenes/:sceneId`,
`/view/:slug/revisions/...` and `/view/:slug/playback-profile`.

**Resolution:** the frontend defines **only** `/view/[slug]`. It must not define
any child route under it. Deployment routes `/view/:slug/*` to the backend and
the bare `/view/:slug` to the frontend.

### R8 — `PUBLIC_BASE_URL` controls share targets

The backend builds `share.directUrl`, `embedUrl`, `embedHtml` and `qrTarget`
from `PUBLIC_BASE_URL`, which defaults to `http://localhost:4000` — the backend's
own origin.

**Resolution:** deployment must set `PUBLIC_BASE_URL` to the externally routed
origin that serves the frontend player. The frontend displays the backend's
returned share values verbatim so what a creator copies is what visitors get; if
the value is wrong, that is a deployment configuration defect, not a frontend
workaround. `NEXT_PUBLIC_APP_ORIGIN` exists only for local development where the
two origins differ.

### R9 — Telemetry payload keys are not schema-enforced

Most runtime events accept a permissive payload, but the analytics queries group
by specific keys (`sceneId`, `hotspotId`, `overlayId`, `interactionId`,
`profileId`, `failureCategory`, `durationMs`). A player that omits them produces
accepted events and empty dashboards.

**Resolution:** those keys are a hard frontend contract, listed in
[frontend-telemetry.md](frontend-telemetry.md) §5 and verified in the FE-03,
FE-05, FE-06 and FE-08 sprint gates.

### R10 — Timeline time units differ between manifest and viewer config

The canonical model and the manifest timeline use milliseconds; the compiled
`viewerIntegration.config.timeline[].startTime` is in **seconds**.

**Resolution:** product logic uses the manifest's millisecond values; the seconds
form is used only when binding the renderer.

### R11 — Query key naming differs from the frontend TRD's illustrative list

[frontend_trd.md](frontend_trd.md) §7 names centralised query keys
`projects / experiences / scenes / assets / hotspots`. The registry in
[frontend-api-integration.md](frontend-api-integration.md) §7.1 uses
`projects` / `project` for that entity (the backend calls it a project; the
product calls it an experience — they are the same record) and has **no
top-level `hotspots` key**, because the backend has no standalone hotspot read
route: hotspots are returned inside `GET /scenes/:sceneId`.

**Resolution:** hotspots are cached with their scene. The TRD's list is a
conceptual inventory, and the registry is a superset of it with names that match
the backend's own vocabulary. Feature folders follow the same reasoning —
`gallery` and `virtual-tour` behaviour lives in `features/navigation` and
`features/connections` plus the runtime tour controller.

---

## B. Backend gaps that constrain frontend scope

None of these blocks the sprint plan; each has a documented mitigation. All are
worth raising as backend enhancement requests.

| # | Gap | Product requirement affected | Frontend mitigation |
| --- | --- | --- | --- |
| G1 | **No `GET /api/v1/assets` list route.** Only `GET /api/v1/assets/:assetId` exists. | PRD §3.2 "Reuse uploaded assets across the project without duplicate uploads"; product architecture §16 Media & Asset Library; frontend TRD §4 "Assets". | FE-02 builds the library from assets already referenced by projects the user can read, plus a client-persisted recent-uploads list keyed by asset id. A true cross-project library needs the endpoint. |
| G2 | **No `DELETE /api/v1/projects/:projectId`.** | Frontend TRD §4 "Project management". | The dashboard offers no delete. Unpublish is offered instead where relevant. |
| G3 | **No session endpoints** — no refresh, logout, or current-user route. | Session lifecycle. | Sign-out clears the local session cookie. Expiry surfaces as a 401 and redirects to `/login`. The safe user DTO returned at login is stored in the session so the shell can render an identity without a `me` call. |
| G4 | **Project list DTO has no media reference and no pagination.** | PRD PRJ-001 (list without full payloads). | No dashboard thumbnails in v1; list is sorted by `updatedAt` and filtered client-side. Pagination becomes necessary as project counts grow. |
| G5 | **No scene-level "duplicate" route.** | Product architecture §14 authoring convenience. | Not offered. Templates cover reuse at project level. |
| G6 | **QR is a target URL, not a bitmap.** | PRD PUB-003. | The frontend renders the QR code from `share.qrTarget` client-side. Explicitly intended by the backend. |
| G7 | **Public derivative cache revocation is bounded at 60 seconds.** | PRD PUB-004 republish semantics. | After publishing, the share panel notes that visitors may see the previous media for up to a minute. No frontend cache-busting is permitted — it would defeat CDN caching. |

---

## C. Assumptions taken

| # | Assumption | Basis | Impact if wrong |
| --- | --- | --- | --- |
| A1 | The frontend application lives in `photo-sphere-execution/sphere-frontend`. | The sibling directory exists and is empty. | Directory paths in FE-01 change; nothing else. |
| A2 | The editor route is `/experiences/[projectId]` and the draft preview is `/viewer/[projectId]`. | [frontend_trd.md](frontend_trd.md) §6 names both. | Route strings change; structure does not. |
| A3 | Photo Sphere Viewer is pinned at 5.14.3. | Product architecture Revision 2.0 validation basis; `psv-5.14.3-adapter-2`. | A different renderer version needs a matching backend adapter version. |
| A4 | Next.js App Router. | `src/app/` layout in frontend TRD §6. | Pages Router would change route files only. |
| A5 | Effective role is resolved per project via `access/me` from FE-04 onward. | Sprint-04 role model; single-owner projects work without it earlier. | Earlier resolution is harmless. |
| A6 | Video profile selection happens client-side by default, with the server endpoint as fallback. | The manifest ships ordered candidates specifically so a client can select; the backend documents that a client selecting locally never needs the call. | Server-first selection adds a round trip per session. |
| A7 | Analytics dashboards ship in FE-08, after telemetry emission is proven. | PRD §17.2 lists analytics launch phase as an open decision; backend analytics is implemented. | Analytics could ship earlier, but would show empty data until players emit events. |
| A8 | Platform-admin surfaces (`/admin/*`) are optional within FE-08. | `GET /api/v1/platform/*` is implemented; operators can also use the runbook procedures. | Dropping them costs nothing product-facing. |

---

## D. Coverage check

| Check | Result |
| --- | --- |
| Every PRD frontend requirement family (FE, PRJ, AST, HOT, SCN, CNT, APP, BRD, NAV, GAL, IMM, VID, PUB) is assigned to a sprint | Pass — see [frontend-scope.md](frontend-scope.md) §6 |
| Every implemented backend route family has a frontend consumer or a documented reason it has none | Pass — the only unconsumed families are platform-admin routes (optional, FE-08) and the dual-fisheye/live provider surfaces, which report `unavailable` unless enabled |
| No frontend feature is specified that the backend cannot support | Pass — every feature in the matrix names its backend basis; constrained items are listed in §B |
| Sprint dependencies form a directed acyclic graph with no forward references | Pass — see [sprint/README.md](sprint/README.md) |
| Technical decisions follow [frontend_trd.md](frontend_trd.md) | Pass. Stack, layering rules, routing structure, state and form choices are adopted unchanged. Two recorded deviations: R6 (binary-upload transport, by necessity) and R11 (query key naming, to match backend vocabulary). |
| Renderer vocabulary is absent from all creator-facing specifications | Pass — renderer terms appear only inside [frontend-viewer-runtime.md](frontend-viewer-runtime.md), which is the integration boundary |

---

## E. Recommended backend follow-ups

Ordered by frontend value. None is required for the plan to proceed.

1. `GET /api/v1/assets` with owner/project filters and pagination (unblocks G1,
   the reusable media library).
2. A lightweight media reference on the project list DTO (unblocks G4 thumbnails
   without violating PRD PRJ-001).
3. `DELETE /api/v1/projects/:projectId` with reference and publication guards
   (G2).
4. A current-user route, and token refresh or a documented expiry policy (G3).
5. Correct the `manifestVersion` sentence in
   [../backend-schema.md](../backend-schema.md) (R1) and the
   `GET /api/v1/projects` scope sentence in
   [../backend-api.md](../backend-api.md) (R2).
