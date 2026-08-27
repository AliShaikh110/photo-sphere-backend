# Frontend Sprint 02 — Media Upload & Asset Pipeline UI

> **Depends on:** [FE-01](fe-sprint-01-foundation-auth-dashboard.md)
> **Backend basis:** backend Sprint 01 (image pipeline) and Sprint 03 (video pipeline), implemented
> **Contracts:** [../frontend-api-integration.md](../frontend-api-integration.md) §5 (upload protocol), §2.1 (error mapping)

---

## 1. Sprint Objective

Make media a solved problem for every later sprint. Deliver the complete upload
experience — one clear surface, a correct three-step protocol, honest processing
status in plain language, recoverable failures — plus the reusable **asset
picker** that the editor, branding, hotspots, plans and overlays all consume.

The creator uploads a file and learns whether it is usable. They never see a
derivative, a codec, a storage key or a MIME signature.

---

## 2. Outcomes Required

By sprint completion:

- Drag-and-drop and browse upload work from one surface, for panoramas, ordinary
  images, logos and 360° video.
- The three-step protocol (session → binary PUT → complete) is implemented, with
  the binary body streamed through a Route Handler so the token stays server-side.
- Upload progress is accurate and survives ordinary UI re-renders.
- Unsupported types and oversized files are rejected before the editor is
  entered.
- Processing status is shown as `uploading / checking / preparing / ready /
  failed` with per-stage detail available on demand.
- A failed asset exposes a working **Reprocess** path; a video can reprocess a
  single profile.
- A ready asset shows a useful media summary — dimensions, type, 360° detection
  — and never raw metadata.
- A partially successful video (one profile missing) is usable, with an advisory
  rather than an error.
- The `AssetPicker` component is reusable and filters by required media type.
- `/assets` shows the constrained media library described in
  [../frontend-validation-report.md](../frontend-validation-report.md) §B G1.

---

## 3. Dependencies

| Dependency | Status |
| --- | --- |
| FE-01 service layer, session, query keys, error mapping | Required |
| Backend `/api/v1/assets/*` | Implemented |
| Backend media worker running (embedded or external) | Operator setup — [../../runbook.md](../../runbook.md) |
| `MAX_IMAGE_UPLOAD_BYTES`, `MAX_VIDEO_UPLOAD_BYTES` | Backend configuration; the frontend reads its own mirrored limits from env |

---

## 4. In Scope

### Upload
- `POST /api/v1/assets/uploads` session creation with exact `sizeBytes`.
- Streaming Route Handler `/api/upload/[uploadSessionId]` proxying the raw PUT.
- `POST /api/v1/assets/:assetId/complete` with `Idempotency-Key`.
- Optional client-side SHA-256 checksum for files under a configurable threshold.
- Progress store outside the React tree, keyed by `uploadSessionId`.
- Cancel, retry, and one automatic session restart on `UPLOAD_SESSION_EXPIRED`.
- Multi-file queue with sequential upload and per-file state.

### Processing
- Status polling with backoff, stopping on terminal state or hidden tab.
- Per-stage display driven by `processingStages`.
- Plain-language status and failure copy derived from `processingError`.
- `POST /api/v1/assets/:assetId/reprocess`, including
  `{ "profiles": ["mobile"] }` targeted video reprocess.
- `metadata.unavailablePlaybackProfiles` surfaced as an advisory.

### Asset presentation
- Media summary card: detected 360° format, dimensions, duration for video,
  readiness. No XMP dumps, no codec strings, no bitrates.
- Thumbnail rendering from the `thumbnail` derivative through
  `resolveManifestUrl`.
- `AssetPicker` — dialog with upload-or-choose, filtered by required media type
  (`panorama_image`, `image`, `logo`, `plan_image`, `video360`, `video`).
- `AssetStatusBadge`, `AssetProcessingDetails`.
- `DELETE /api/v1/assets/:assetId` with reference-aware messaging.

### Media library (constrained)
- `/assets` listing assets referenced by projects the caller can read, plus a
  locally persisted recent-uploads list.
- Filter by media type and status; open an asset's detail.
- A clearly worded note that the library reflects assets used in the caller's
  experiences.

---

## 5. Out of Scope for FE-02

- Any viewer or rendering of a panorama (FE-03).
- Creating scenes from an uploaded panorama (FE-04).
- Assigning a project's primary video (FE-06).
- Plan images and overlay layer assets as *features* — the picker supports the
  media types, but plans and overlays arrive in FE-07.
- A true cross-project asset library — blocked on a backend list route.
- Any client-side image manipulation, cropping or straightening. Corrections are
  backend-derived from XMP; a manual straighten UI is not offered because no
  backend route accepts one.

---

## 6. Routes & Screens

| Route | Screen |
| --- | --- |
| `/assets` | Constrained media library: grid, filters, detail drawer. |
| `/assets/[assetId]` | Asset detail: summary, stages, actions. |
| (component) | `AssetPicker` dialog, used from anywhere. |
| (component) | `UploadDropzone`, embeddable in the editor's Media tool. |

---

## 7. Frontend Work Breakdown

### 7.1 Types and schemas
`Asset`, `AssetDerivative`, `AssetMediaType`, `AssetProcessingStatus`,
`AssetProcessingStage`, `UploadSession`, `AssetMetadata`. Mirror
[../../backend-schema.md](../../backend-schema.md) names exactly.

### 7.2 Route Handler
`app/api/upload/[uploadSessionId]/route.ts`:
- Reads the session cookie, attaches `Authorization: Bearer`.
- Streams the request body to
  `PUT {API_BASE_URL}/api/v1/assets/uploads/:uploadSessionId/content` with the
  declared `Content-Type` and `Content-Length`.
- Node runtime, streaming enabled, no buffering of the whole body.
- Passes the backend's status and error envelope through unchanged.

### 7.3 Services
`asset-service.ts`: `createUploadSession`, `completeUpload`, `getAsset`,
`reprocessAsset`, `deleteAsset`.

### 7.4 Upload engine
`features/assets/upload/`:
- `upload-store.ts` — progress and per-file state, outside React.
- `use-upload.ts` — orchestrates the three steps and surfaces state.
- `use-asset-status.ts` — polling with backoff and terminal detection.
- `file-validation.ts` — extension/MIME/size checks per media type.

### 7.5 Components
`UploadDropzone`, `UploadQueue`, `UploadProgressBar`, `AssetCard`,
`AssetSummary`, `AssetStatusBadge`, `AssetProcessingDetails`, `AssetPicker`,
`AssetDeleteDialog`.

---

## 8. Backend / API Integrations

| Method | Route | Notes |
| --- | --- | --- |
| POST | `/api/v1/assets/uploads` | `mediaType` defaults to `panorama_image`. Declared type and file type must agree. |
| PUT | `/api/v1/assets/uploads/:uploadSessionId/content` | Raw binary, **not multipart**. Exact byte count. Proxied. |
| POST | `/api/v1/assets/:assetId/complete` | `Idempotency-Key` required. Returns 202. |
| GET | `/api/v1/assets/:assetId` | Status, metadata, `processingStages`, derivative catalogue. |
| POST | `/api/v1/assets/:assetId/reprocess` | `Idempotency-Key` required. Optional `{ profiles }` for video. |
| DELETE | `/api/v1/assets/:assetId` | Only `ready` or `failed` assets with no active job. |
| GET | `/api/v1/media/:derivativeId` | Thumbnail bytes for an owner-authenticated creator. |

### 8.1 Media type rules

| Use | Required `mediaType` |
| --- | --- |
| Scene panorama | `panorama_image` |
| Hotspot / overlay display image | `image` or `logo` |
| Branding logo, favicon, watermark | `image` or `logo` |
| Floor or site plan image | `plan_image` or `image` |
| Project primary 360° video | `video360` |
| Hotspot / timeline video content | `video` |

Supported inputs: JPEG (including the `image/jpg` alias), PNG, WebP for images;
MP4 and WebM for video. The backend validates real signatures — client checks
are convenience only.

### 8.2 Failure codes

`UPLOAD_TOO_LARGE` (413), `UPLOAD_MIME_MISMATCH` (415),
`UPLOAD_SESSION_EXPIRED`, `ASSET_NOT_READY`, `IDEMPOTENCY_KEY_REUSED`,
`REPROCESS_TARGET_NOT_SUPPORTED` (422 for `profiles` on a non-video asset),
`VIDEO_PROFILE_UNAVAILABLE` (asset-level failure diagnosis).

---

## 9. State, Cache & Invalidation

- `['asset', assetId]` — `staleTime: 0` with `refetchInterval` while
  non-terminal; `staleTime: 5 min` once `ready` or `failed`.
- Polling cadence: 2 s for the first 30 s, then 5 s; ceiling 5 minutes for
  images, 30 minutes for video; pause when the document is hidden.
- Upload progress lives in the upload store, never in query cache.
- Recent uploads persist in `localStorage` as `{ assetId, mediaType, filename,
  uploadedAt }`, capped and pruned when an asset 404s.
- On `complete`, invalidate `['asset', assetId]`; on `reprocess`, the same plus
  any scene or timeline query referencing it.

---

## 10. UX & Responsive Requirements

- **One upload surface** (PRD AST-001). Drag-and-drop and browse are the same
  component.
- **Progress survives re-renders** — verified by opening and closing a panel
  mid-upload.
- **Plain-language status** (PRD AST-002):

  | Backend status | Creator copy |
  | --- | --- |
  | `uploaded` | Uploaded |
  | `inspecting` | Checking your file |
  | `processing` | Preparing your media |
  | `ready` | Ready to edit |
  | `failed` | Plain reason + Reprocess |

- **Useful summary, not raw metadata** (PRD AST-003):
  `✓ 360° panorama detected · 8192 × 4096 · Ready to edit`.
- The editor only enables operations the current derivative set supports —
  expose `isReady(asset, requirement)` for later sprints.
- Responsive: the dropzone works on touch; the picker is a full-screen sheet
  below `md`.
- Accessibility: the dropzone has a keyboard-reachable browse button; progress
  announces via a polite live region; status changes are announced once each.

---

## 11. Error, Loading & Empty States

| Situation | Behaviour |
| --- | --- |
| File rejected locally | Inline reason before any request. |
| 413 / 415 from the backend | Inline reason with the actual limit; keep the queue intact. |
| Network failure mid-PUT | Retry the same session; restart the session once if expired. |
| `complete` times out | Retry with the same idempotency key. |
| Processing fails | Failure card with the safe reason, the failed stage, and Reprocess. |
| One video profile fails | Asset is usable; advisory names the missing profile and offers targeted reprocess. |
| Delete blocked by references | Explain what still uses the asset; do not offer force-delete. |
| Empty library | Explain the constraint and offer upload. |

---

## 12. Acceptance Criteria / Sprint Gate

1. A panorama can be uploaded end to end and reaches `ready`, with progress
   visible throughout.
2. Navigating within the app during an upload does not lose progress or abort
   the transfer.
3. A `.txt` renamed to `.jpg` is rejected; the failure names the file type, not a
   signature or MIME string.
4. A file above the configured limit is rejected before any bytes are sent.
5. `complete` retried with the same idempotency key does not enqueue a second
   job; the response reports `Idempotency-Replayed: true`.
6. A deliberately corrupt image reaches `failed`, shows a plain-language reason
   and the failing stage, and reprocess is offered.
7. A 360° video upload reaches `ready` with a poster and at least one playback
   profile, and per-stage progress is visible.
8. A video with only one profile available is `ready`, shows the advisory, and
   `{ "profiles": ["mobile"] }` reprocess succeeds without changing the logical
   asset id.
9. `AssetPicker` filtered to `panorama_image` never offers a logo or video.
10. The access token never appears in a browser-visible request; the upload PUT
    is issued to the frontend origin.
11. No creator-facing string contains "MIME", "derivative", "codec", "bitrate",
    "storage key" or "signature".

---

## 13. Verification Requirements

- Unit: file validation per media type; polling backoff and terminal detection;
  progress store isolation from re-renders; stage-to-copy mapping.
- Integration: full upload of a real panorama fixture and a real video fixture
  against a local backend with the worker running; forced failure and reprocess.
- Manual: 1 GiB video upload proxied through the Route Handler without exhausting
  server memory; upload on a phone; upload with the tab backgrounded.
- Security: confirm the streaming Route Handler rejects requests without a valid
  session and never echoes the bearer token.

---

## 14. Execution Order

1. Types and schemas for assets, derivatives, stages, sessions.
2. `asset-service.ts` server actions.
3. Streaming upload Route Handler; verify with a large fixture first.
4. Upload store and `use-upload` orchestration.
5. `UploadDropzone`, `UploadQueue`, progress UI.
6. `use-asset-status` polling and terminal handling.
7. Status, summary and stage components with product-language copy.
8. Reprocess and delete flows.
9. `AssetPicker`.
10. `/assets` library and detail route.
11. Gate verification with image and video fixtures.

---

## 15. Guardrails

1. Never send the upload as multipart — the endpoint takes a raw body.
2. Never call `complete` before the PUT succeeds; bytes alone do not enqueue
   processing.
3. Never mint a new idempotency key on a transport retry.
4. Never show derivative kinds, codecs, MIME types, storage keys or XMP fields to
   a creator.
5. Never let a still-processing asset be selected where a ready one is required.
6. Never build a client-side straighten or crop tool — corrections are derived
   from metadata by the backend, and no route accepts client corrections.
7. Never buffer an entire upload in memory in the Route Handler.
8. Do not add a cross-project asset browser implying assets the API cannot list.
