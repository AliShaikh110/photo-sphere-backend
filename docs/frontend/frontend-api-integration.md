# Frontend API Integration Contract

How the frontend talks to the backend. The HTTP contract itself is defined in
[../backend-api.md](../backend-api.md) and is **not** restated here. This
document defines the **client-side policy** built on top of it: transport
layering, session handling, the revision and idempotency protocols, the query
key registry, cache invalidation, URL resolution, and error mapping.

Layering rules (components never call Axios; TanStack Query owns server state;
GET is `useQuery`, mutations are `useMutation`) come from
[frontend_trd.md](frontend_trd.md) §3 and §7 and are assumed, not repeated.

---

## 1. Transport architecture

### 1.1 Decision

[frontend_trd.md](frontend_trd.md) §7 specifies the chain
`Component → Feature Hook → TanStack Query → Server Action → Axios → Backend API`.
The backend authenticates with `Authorization: Bearer <JWT>` and has no refresh,
logout or current-user endpoint. Two consequences follow:

1. **The access token is held server-side in an httpOnly session cookie.** A
   Next.js Route Handler exchanges credentials for the token and sets the
   cookie; the token is never exposed to browser JavaScript. This satisfies the
   frontend TRD chain literally and keeps the JWT out of XSS reach.
2. **Raw media upload cannot go through a Server Action.** Uploads reach
   `MAX_VIDEO_UPLOAD_BYTES` (1 GiB by default) and Server Actions are not a
   streaming body transport. Binary upload therefore uses a dedicated
   **streaming Route Handler** that pipes the request body to the backend and
   attaches the bearer token server-side.

This is a stated architectural decision, recorded in
[frontend-validation-report.md](frontend-validation-report.md) §R6. If the
project later decides to hold the token in the browser instead, only
`src/lib/api/*` changes; feature hooks and components are unaffected.

### 1.2 Layers

```text
src/lib/api/http.ts          Axios instance (SERVER ONLY). Base URL, envelope
                             unwrapping, error normalisation, X-Request-ID.
src/lib/api/session.ts       Read/write the httpOnly session cookie.
src/services/*.ts            'use server' Server Actions, one module per resource.
                             The only callers of src/lib/api/http.ts.
src/app/api/session/route.ts Route Handler: login/register/sign-out.
src/app/api/upload/[sessionId]/route.ts
                             Route Handler: streams binary upload to the backend.
src/features/*/hooks/*.ts    useQuery / useMutation wrappers over the services.
```

`src/lib/api/http.ts` must carry `import 'server-only'` so a client component
importing it fails at build time rather than leaking the token path.

### 1.3 Environment variables

| Variable | Example | Used by |
| --- | --- | --- |
| `API_BASE_URL` | `http://localhost:4000` | Server-side Axios. Server-only. |
| `NEXT_PUBLIC_MEDIA_ORIGIN` | `http://localhost:4000` | Browser-side resolution of root-relative manifest URLs (§6). Empty string when the deployment is same-origin. |
| `SESSION_COOKIE_NAME` | `sphere_session` | Session cookie name. |
| `NEXT_PUBLIC_APP_ORIGIN` | `http://localhost:3000` | Embed snippet and QR generation when overriding the backend `share` values. |

The backend's `CORS_ORIGINS` must include `NEXT_PUBLIC_APP_ORIGIN` for any
browser-originated request (media, manifest, telemetry). Its `PUBLIC_BASE_URL`
must be the externally routed origin that serves `/view/:slug`, otherwise the
`share.directUrl` it returns points at the wrong host — see
[frontend-validation-report.md](frontend-validation-report.md) §R8.

---

## 2. Response envelope handling

Success responses are `{ success, data, message? }`; errors are
`{ error: { code, message, entityId?, path?, retryable, details?, requestId } }`
(see [../backend-api.md](../backend-api.md)).

The Axios layer must:

1. Unwrap `data` so services return the payload, never the envelope.
2. Normalise every failure into one `ApiError` class carrying
   `code`, `message`, `status`, `path`, `entityId`, `retryable`, `details`,
   `requestId`.
3. Generate and send `X-Request-ID` per request and record the echoed value on
   `ApiError` so a creator-reported problem maps to a backend log line.
4. Never surface `details` verbatim in UI copy — `message` is the safe string.
5. Treat 204 and binary responses as envelope-free.

### 2.1 Error code to UI behaviour

Treat the server code as authoritative. Unknown codes fall through to the
generic branch — never crash on an unrecognised code.

| Code / status | UI behaviour |
| --- | --- |
| `AUTHENTICATION_REQUIRED`, `INVALID_ACCESS_TOKEN` (401) | Clear session, redirect to `/login` preserving the return path. |
| `PROJECT_ACCESS_DENIED`, `WORKSPACE_ACCESS_DENIED` (403) | Inline "You do not have permission" state; hide the action on next render. |
| `PLATFORM_ADMIN_REQUIRED` (403) | Hide the operator surface entirely. |
| 404 on a project route | "Not found" page. Never say "you lack access" — 404 is deliberately indistinguishable. |
| `VALIDATION_FAILED` (422) with `path` | Focus and mark the named form control. Field-level message, no toast. |
| `REVISION_CONFLICT` (409) | Conflict dialog (§3.2). |
| `IDEMPOTENCY_KEY_REUSED` (409) | Regenerate the key and let the user retry; log a defect — this means the client mutated a payload mid-retry. |
| `REQUEST_IN_PROGRESS` (409) | Keep the pending state; poll or re-submit with the same key after a short backoff. |
| `SLUG_ALREADY_EXISTS` (409) | Field-level error on the publish slug input. |
| `SCENE_IN_USE` (409) | Reference-resolution dialog listing `details.references` (§7.3). |
| `ASSET_NOT_READY` (409/422) | Disable the dependent action; keep polling asset status. |
| `UPLOAD_TOO_LARGE` (413), `UPLOAD_MIME_MISMATCH` (415) | Reject before or during upload with a plain-language reason. |
| `UPLOAD_SESSION_EXPIRED` | Restart the upload session transparently, once. |
| `VIDEO_ASSET_NOT_READY`, `VIDEO_DURATION_UNKNOWN` (409, retryable) | Keep the timeline read-only and continue polling. |
| `TIMELINE_TIME_OUT_OF_RANGE`, `TIMELINE_PAYLOAD_INVALID` (422) | Field-level error on the interaction form. |
| `INVALID_ASSET_REFERENCE`, `PLAN_NOT_FOUND` (422) | Field-level error on the picker. |
| `DATE_RANGE_TOO_LARGE` (422) | Clamp the range picker to `details.maximumDays`. |
| `EMBED_ORIGIN_DENIED` (403) | Player shows an "unavailable here" state; do not retry. |
| `PRIVATE_PUBLICATION_ACCESS_DENIED` (401/403) | Player prompts for sign-in or a valid share link. |
| `TELEMETRY_TOKEN_*`, `TELEMETRY_SCOPE_MISMATCH` | Silently stop telemetry for the session. **Never** surface to a visitor or block playback. |
| `RATE_LIMITED` (429) | Backoff and retry once; then a non-blocking toast. |
| 500 | Generic error state plus the `requestId` for support. |
| 503 `SERVICE_NOT_READY` | Maintenance state; retry with backoff. |

---

## 3. Optimistic concurrency (revision protocol)

This is the single most error-prone contract in the editor. The backend does not
use `If-Match`; preconditions are JSON body fields.

### 3.1 Which field, where

| Operation family | Precondition field |
| --- | --- |
| `PATCH /projects/:id`, `validate`, `preview-manifest`, `publish` | `revision` |
| Scenes, hotspots, overlays, plans, timeline (**including DELETE**) | `projectRevision` |

`DELETE` requests carry a JSON body and therefore must send
`Content-Type: application/json`.

### 3.2 Client rules

1. **One source of truth.** The project revision lives in the TanStack Query
   cache under `['project', projectId]`. Never keep a second copy in component
   state or a form default.
2. **Read before write.** Every mutation reads the current revision from the
   cache at submit time, not at mount time.
3. **Every successful editor mutation increments the project revision and
   returns the new value.** The mutation's `onSuccess` must write the returned
   revision back into the project cache before any dependent invalidation runs.
4. **Serialise mutations per project.** Concurrent in-flight editor mutations
   against the same project are guaranteed to conflict. Use a per-project
   mutation queue (TanStack Query `scope: { id: projectId }`) so writes are
   issued one at a time.
5. **Conflict handling (`409 REVISION_CONFLICT`).** Do not auto-retry blindly.
   Show a conflict dialog offering:
   - **Reload** — refetch the project and discard the local pending change; or
   - **Retry** — refetch the project, re-apply the pending change onto the fresh
     revision, resubmit once. Only offer Retry when the pending change is a
     whole-field replacement that cannot silently clobber someone else's edit.

   Never silently overwrite (PRD BE-003, §15 "Save conflict").
6. **Optimistic UI is allowed, rollback is mandatory.** Optimistic cache updates
   must snapshot the previous value in `onMutate` and restore it in `onError`.

### 3.3 Autosave

Property-panel edits autosave on a 600 ms debounce, coalescing consecutive edits
to the same entity into one request. The shell's save indicator reflects
`saving | saved | error` (PRD FE-003). A failed save stays visible and retryable;
navigation away with unsaved changes warns.

---

## 4. Idempotency

Four routes require a caller-generated `Idempotency-Key`:

- `POST /assets/:assetId/complete`
- `POST /assets/:assetId/reprocess`
- `POST /projects/:projectId/publish`
- `POST /templates/:templateId/instantiate`

Rules:

1. Generate the key with `crypto.randomUUID()` **once per user intent**, at the
   moment the user commits the action, and store it with the pending operation.
2. Reuse the same key for every transport retry of that intent — timeouts,
   aborted connections, offline recovery.
3. Use a **new** key when the user changes the payload or deliberately starts a
   new attempt. Reuse with a different payload returns `409`.
4. `Idempotency-Replayed: true` on the response means the result is a replay;
   the UI must treat it as success, not as a duplicate action.
5. A publish that fails compiler validation records one `publish_failed`
   attempt. Replaying the same key replays the same error. After the creator
   fixes the draft, **mint a new key** — otherwise the fix is never attempted.

---

## 5. Media upload protocol

Three backend calls plus polling. See [../backend-api.md](../backend-api.md)
"Assets and uploads" for payload shapes.

```text
1. POST /api/v1/assets/uploads
      { projectId?, mediaType, filename, mimeType, sizeBytes, checksumSha256? }
   -> { asset: { id, processingStatus: 'uploaded' },
        upload: { sessionId, method: 'PUT', url, headers, expiresAt } }

2. PUT  <upload.url>            (proxied by /api/upload/[sessionId])
      raw bytes, exact declared length, declared Content-Type
   -> { uploadSessionId, assetId, status: 'uploaded' }

3. POST /api/v1/assets/:assetId/complete   + Idempotency-Key
      { uploadSessionId }
   -> 202 Accepted (inspection enqueued)

4. Poll GET /api/v1/assets/:assetId until processingStatus is terminal.
```

### 5.1 Client obligations

- **Validate before step 1.** Extension and MIME must match the declared
  `mediaType`; sizes must respect `MAX_IMAGE_UPLOAD_BYTES` /
  `MAX_VIDEO_UPLOAD_BYTES`. Rejecting locally is a UX convenience only — the
  backend validates signatures and is authoritative (PRD SEC-003).
- **Progress must survive re-renders** (PRD AST-001). Hold upload progress in a
  store keyed by `uploadSessionId`, outside the component tree.
- **`sizeBytes` must be exact.** A mismatch is rejected.
- **Step 3 is required.** Uploading bytes alone does not enqueue processing.
- **Never send `mediaType` the flow does not need.** Scene panoramas require
  `panorama_image`; hotspot/overlay display images require `image` or `logo`;
  plan images require `plan_image` or `image`; the primary video requires
  `video360`.

### 5.2 Polling and status

| `processingStatus` | Terminal | Creator-facing copy |
| --- | --- | --- |
| `uploaded` | no | "Uploaded" |
| `inspecting` | no | "Checking your file" |
| `processing` | no | "Preparing your media" |
| `ready` | yes | "Ready to edit" |
| `failed` | yes | Plain-language reason from `processingError` + **Reprocess** |

Poll with backoff (2 s for the first 30 s, then 5 s, capped at 5 minutes for
images and 30 minutes for video), and stop on terminal state or when the tab is
hidden. `processingStages` drives a per-stage progress list
(`inspect → derivatives → thumbnail → lowResolutionBase → standardWeb →
tiledLevels? → finalize` for images; `inspect → poster → transcodeDesktop →
transcodeMobile → finalize` for video).

A video asset can be `ready` with one profile missing:
`metadata.unavailablePlaybackProfiles` names what could not be produced. Surface
it as an advisory, not an error, and offer targeted reprocess
(`POST /assets/:id/reprocess` with `{ "profiles": ["mobile"] }`).

---

## 6. Manifest URL resolution (critical)

**Every URL the compiler emits is root-relative**, verified in
`src/services/experience-service.ts` and `src/compiler/experience-compiler.ts`:

| Field | Emitted form |
| --- | --- |
| `...media.url` (public publication) | `/api/v1/publications/{projectId}/{revision}/media/{derivativeId}` |
| `...media.url` (preview / private) | `/api/v1/media/{derivativeId}?token=...` |
| `panorama.tiles.tileUrlTemplate` | `/api/v1/media/{derivativeId}/tiles/{level}/{x}/{y}` (query string preserved) |
| `tour.sceneDefinitionUrlTemplate` | `/view/{slug}/revisions/{revision}/scenes/{sceneId}` |
| `tour.sceneIndexUrl` | `/view/{slug}/revisions/{revision}/scene-index` |
| `video.selectionPolicy.selectionUrl` | `/view/{slug}/playback-profile` |

The Viewer Runtime must resolve all of them through a single helper:

```text
resolveManifestUrl(path) = NEXT_PUBLIC_MEDIA_ORIGIN + path
```

Rules:

- Preserve the query string (signed media tokens live there).
- Never rewrite or re-sign a URL. Never strip `?token=`.
- Never log a signed URL.
- In a same-origin deployment `NEXT_PUBLIC_MEDIA_ORIGIN` is the empty string and
  the paths are used verbatim — this is the production shape described in
  [../runbook.md](../runbook.md).
- A signed preview URL carries `expiresAt`. When a scene is open longer than the
  TTL (`SIGNED_MEDIA_TTL_SECONDS`, 900 s default) the runtime must re-request
  the preview manifest before loading further media rather than letting a media
  request 401.

---

## 7. Query keys, caching and invalidation

### 7.1 Key registry

One module, `src/lib/query-keys.ts`, is the only place keys are constructed.

```text
auth                      ['auth','session']
projects                  ['projects','list']
project                   ['project', projectId]
projectAccess             ['project', projectId, 'access']
projectRole               ['project', projectId, 'access', 'me']
scenes                    ['project', projectId, 'scenes']
scene                     ['project', projectId, 'scene', sceneId]
overlays                  ['project', projectId, 'scene', sceneId, 'overlays']
plans                     ['project', projectId, 'plans']
timeline                  ['project', projectId, 'timeline']
publications              ['project', projectId, 'publications']
shareTokens               ['project', projectId, 'share-tokens']
auditLog                  ['project', projectId, 'audit-log']
analytics                 ['project', projectId, 'analytics', view, params]
asset                     ['asset', assetId]
templates                 ['templates', filters]
template                  ['template', templateId]
workspaces                ['workspaces']
workspaceMembers          ['workspace', workspaceId, 'members']
customDomains             ['workspace', workspaceId, 'custom-domains']
extensions                ['extensions']
platformCapabilities      ['platform','capabilities']
viewerIntegrations        ['platform','viewer-integrations']
manifest                  ['manifest', slug]                 (player)
previewManifest           ['preview-manifest', projectId, revision]
sceneDefinition           ['scene-definition', slug, revision, sceneId]
sceneIndexPage            ['scene-index', slug, revision, offset]
```

### 7.2 Cache configuration

| Data | `staleTime` | Notes |
| --- | --- | --- |
| `platformCapabilities`, `extensions`, `viewerIntegrations` | 1 hour | Effectively static per deployment. |
| `projects`, `project`, `scenes`, `timeline`, `plans` | 0 | Revision-critical. Always fresh on focus. |
| `asset` (non-terminal) | 0, with `refetchInterval` | See §5.2. |
| `asset` (terminal) | 5 minutes | Stops polling. |
| `publications`, `shareTokens`, `auditLog` | 30 seconds | |
| `analytics` | 5 minutes | Bounded, expensive queries. |
| `sceneDefinition`, `sceneIndexPage` | `Infinity` | Revision-pinned and immutable; the backend serves them `immutable`. |
| `manifest` | 60 seconds | Public manifests are `must-revalidate`; the current revision can change. |
| `previewManifest` | until `expiresAt` | Contains expiring signed URLs. |

`gcTime` defaults to 5 minutes except the immutable published entries, which may
hold longer. Disable `refetchOnWindowFocus` inside the editor canvas to avoid
interrupting an in-progress edit; keep it on for lists.

### 7.3 Invalidation matrix

| Mutation | Invalidate / update |
| --- | --- |
| Create project | `projects` |
| Patch project | write returned project into `project`; invalidate `projects` |
| Create/patch/delete/reorder scene | `scenes`, affected `scene`, `project` (revision), `plans` if placement changed |
| Create/patch/delete hotspot | affected `scene`; `project` (revision) |
| Create/patch/delete overlay | `overlays` for the scene; affected `scene`; `project` |
| Create/patch/delete/reorder plan | `plans`; `scenes` (placement may be cleared); `project` |
| Any timeline mutation | `timeline`; `project` |
| Publish | `publications`, `project`, `manifest` for the slug |
| Unpublish | `publications`, `project`, `manifest` |
| Embed policy | `project`, `publications` |
| Share token create/revoke | `shareTokens`, `auditLog` |
| Access grant / revoke | `projectAccess`, `projectRole`, `auditLog` |
| Workspace member change | `workspaceMembers`, `workspaces`, `auditLog` |
| Asset complete / reprocess | `asset`; any `scene` or `timeline` referencing it |
| Asset delete | `asset`, `scenes`, `plans`, `timeline`, `project` |
| Template instantiate | `projects` |

**Scene delete with `409 SCENE_IN_USE`** returns
`details.references[]` with `{ type, id, sourceSceneId, path? }` where `type` is
`sceneConnection`, `hotspotAction` or `runtimeHint`. Render each reference as a
navigable item that opens the offending entity in the editor, then allow the
delete to be retried once the creator has cleared them.

---

## 8. Token audiences

The backend mints three non-interchangeable audiences plus share tokens. The
frontend must never mix them.

| Audience | Where it lives | Sent as | Who uses it |
| --- | --- | --- | --- |
| `sphere-creator` | httpOnly session cookie, server-side only | `Authorization: Bearer` | Creator app |
| `sphere-media` | Inside a preview/private manifest URL query string | `?token=` | Viewer Runtime, opaquely |
| `sphere-telemetry` | `manifest.telemetry.ingestToken` (in memory only) | `X-Telemetry-Token` | Telemetry client |
| Share token | Player URL parameter or user input | `X-Share-Token` or `?shareToken=` | Player, on published delivery routes |

Rules: never persist a media or telemetry token; never put a creator bearer in a
browser-visible location; never attach a share token to `/api/v1/*` creator
routes; treat `telemetry.ingestTokenExpiresAt` as the session telemetry lifetime
and stop emitting after it, silently.

---

## 9. Retry and resilience policy

| Class | Policy |
| --- | --- |
| GET queries | 2 retries, exponential backoff, only on network errors and 5xx. Never retry 4xx. |
| Idempotent mutations (with `Idempotency-Key`) | 3 retries on network error / timeout / 5xx, same key. |
| Non-idempotent mutations (revision-guarded) | **No automatic retry.** A stale revision surfaces as a conflict; retrying blindly can double-apply. |
| Binary upload | Restart the session once on `UPLOAD_SESSION_EXPIRED`; otherwise surface the failure with a manual retry. |
| Telemetry | Fire-and-forget. At most one retry. Never block playback. |
| Player manifest | 2 retries then a visitor-facing error state with a retry button. |

---

## 10. Validation and forms

- All request bodies are validated with Zod schemas mirroring the backend's
  accepted shapes before submission (frontend_trd §10). Client validation is a
  UX affordance; the server is authoritative (PRD SEC-001, SEC-002).
- Rich text is authored with a constrained editor, but **the server response is
  the source of truth for sanitised content**. After saving HTML, re-render from
  the server's returned value, not the local draft.
- URL fields validate scheme locally (`http`/`https` only) and rely on the
  server's centralised URL policy for the authoritative decision.
- Colour inputs must fall back safely on an invalid value (PRD APP-001).
- Never expose a form field for yaw, pitch, radians, adapters, plugins, codecs
  or cache settings (PRD Appendix C). Positions are captured by clicking the
  panorama and stored as `spherical_degrees` longitude/latitude.
