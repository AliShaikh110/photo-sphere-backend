# Sprint 05 — Compiler Extraction & Frontend Enablement (Backend Only)

> **Execution target:** Backend changes to the existing No-Code 360° Experience Platform repository
> **Source basis:** Product/Architecture/Runtime Specification Revision 2.0, Backend PRD, Backend TRD, Frontend TRD, executed Sprints 01–04
> **Implementation style:** Update the existing repository in place. Reuse the current language, framework, ORM, job system, storage provider, and testing conventions. Sprints 01–04 remain executed; this sprint reorganizes and extends, it does not re-implement.
>
> **Architecture rule:** The Experience Compiler stops being a private service inside the API and becomes a shared, pure, deterministic package that the API and the future editor both import. There must never be a second implementation of the compiler.

---

## 1. Sprint Objective

Make the backend capable of supporting a **live authoring session** — an editor where the preview is running continuously and edits are applied to it directly — without a second compiler ever existing in the browser.

This sprint delivers no user-facing feature. It removes the four structural blockers that would otherwise force the frontend into a slow round-trip loop or a drifting client-side copy of platform logic.

The four blockers:

1. The compiler is only reachable through an HTTP call to the API.
2. The editor cannot draw anything until four sequential requests complete.
3. Multi-object edits have no atomic write path for scene hotspots.
4. There is no push channel, so every status change must be polled.

---

## 2. Outcomes Required

By sprint completion:

- The Experience Compiler runs as a pure function in a shared package, importable by both the API and a browser application.
- Compiling the same input twice produces byte-identical output.
- Every manifest produced by Sprints 01–04 is reproduced byte-for-byte by the extracted compiler.
- Publishing still compiles server-side and remains the only authority.
- A single bootstrap request returns everything an editor needs to render a live preview.
- Scene hotspots support atomic batch mutation.
- Asset processing, revision changes and publication completion can be pushed to a connected client.
- Expiring media URLs can be refreshed without recompiling.
- Every canonical property is classified as `live`, `recompile`, or `remount`, and that classification is enforced by a conformance test.
- Telemetry event names and payload shapes live in one shared contract.
- All Sprint 01–04 behaviour, routes, error codes and tests remain unchanged.

---

## 3. In Scope

### Package extraction
- Workspace/package structure inside the existing repository.
- `experience-schema` package.
- `experience-compiler` package (pure).
- `viewer-integration` package (versioned adapters).
- `capability-registry` package.
- `live-patch` classification package.
- `telemetry-contract` package.

### New backend capability
- Editor bootstrap endpoint.
- Atomic batch hotspot mutation.
- Media token refresh.
- Server-push event channel.
- Browser-direct access policy (CORS, scoped tokens) for media, events and telemetry.

### Verification
- Golden manifest fixtures.
- Determinism tests.
- Live-patch conformance tests.
- Full Sprint 01–04 regression.

---

## 4. Out of Scope for Sprint 05

- Any editor or player application code.
- Any new user-facing product feature.
- Any change to the canonical data model or database schema beyond additive columns if strictly required.
- Any change to existing route paths, request shapes, response shapes or error codes.
- Live collaborative editing (operational transform / CRDT).
- Renderer version upgrades.

---

## 5. Behaviour Freeze — Do This First

Before moving a single file, capture current compiler output as fixtures.

Required fixtures, covering at minimum:

```text
image360 single scene, no hotspots
image360 multi-scene tour with connections
image360 with cropped panorama and pose correction
image360 with gallery enabled
image360 private publication
video360 with timeline interactions
video360 with multiple playback profiles
project with an unavailable optional capability and fallback
project failing validation
large tour using progressive scene index
```

For each fixture record:

- the canonical Experience input,
- the compiled manifest,
- the emitted viewer integration config,
- the compiled scene definitions,
- a content hash of each.

**Rule:** after extraction, every one of these must reproduce byte-for-byte. A single differing byte means the refactor changed behaviour and must be corrected before the sprint continues.

This fixture set is the sprint's most valuable artifact. It is what makes the extraction provably safe.

---

## 6. Package Structure

Default arrangement inside the existing repository:

```text
apps/
  api/                    existing backend, moved down one level
  worker/                 existing media pipeline jobs

packages/
  experience-schema/      canonical types, validation, schemaVersion
  experience-compiler/    pure: CompilerInput -> CompileResult
  viewer-integration/     versioned adapters: manifest -> renderer config
  capability-registry/    dependencies, incompatibilities, fallbacks
  live-patch/             property classification table
  telemetry-contract/     event names and payload schemas
```

Use the repository's existing package manager workspace feature. Move files with history-preserving moves, not copy-and-delete.

**Hard dependency rule:**

- `packages/*` may not import from `apps/*`.
- `packages/*` may not access a database, network, filesystem, environment variables, `process`, or `window`.
- `apps/*` imports `packages/*` freely.

Enforce this with a lint rule or dependency-boundary check in CI, not by convention.

**Decision — package consumption.** Default: the frontend lives in the same repository as a workspace app and imports these packages directly. If the frontend must live in a separate repository, publish the packages to a private registry with pinned semantic versions, and treat `experience-schema` and `viewer-integration` version bumps as coordinated releases. The monorepo path is strongly preferred; cross-repository package versioning is the main way this architecture goes wrong.

---

## 7. Compiler Contract

### Signature

```text
compile(input: CompilerInput): CompileResult
```

### `CompilerInput`

Everything the compiler needs, fully resolved by the caller:

```text
experience              canonical draft or published Experience
assets[]                asset snapshots: metadata, processingStatus, derivative references
capabilities            capability registry snapshot
policy                  playback/tiling/preload policy configuration
viewerIntegrationVersion
schemaVersion
```

### `CompileResult`

```text
manifest                canonical runtime manifest
sceneDefinitions[]      compiled scenes for progressive fetch
viewerIntegration       { rendererId, config }
diagnostics[]           validation findings, product-language, with stable codes and paths
contentHash             deterministic hash of the compiled output
```

### Purity requirements

The compiler must not:

- read the database, filesystem, network, or environment,
- call `Date.now()`, `Math.random()`, or generate IDs,
- produce signed URLs or any credential,
- sanitize content,
- mutate its input.

Any value that varies per request is passed **in** as part of `CompilerInput`.

### Signed URLs stay outside

The compiler emits **logical derivative references** only. Swapping a reference for a signed, expiring URL is a server-only hydration step performed after compilation. This already matches current behaviour: the persisted immutable manifest does not store expiring credentials. Keep it that way — it is what makes the compiler safe to run in a browser.

### Sanitization stays outside

Rich content and URLs must be sanitized and validated **at write time**, so canonical stored data is already safe. The compiler must not be the only sanitization point.

Verify this during the sprint. If any sanitization currently happens only at publish, move it to the write path and re-apply idempotently at publish as a defence in depth. A browser running the compiler must not be able to bypass a security control.

---

## 8. Live-Patch Classification

Create a static table mapping every canonical property path to one of three behaviours:

| Class | Meaning | Example |
| --- | --- | --- |
| `live` | Can be applied directly to a running viewer with an enumerated mutation. | hotspot position, hotspot colour, tooltip text, auto-rotation speed |
| `recompile` | Requires the compiler to run again; viewer instance is reused. | adding a scene, enabling a capability, changing view limits |
| `remount` | Requires the viewer to be destroyed and rebuilt. | swapping the panorama asset, changing experience type |

Rules:

- Every `live` property must name the mutation that applies it.
- Default for an unclassified property is `recompile`. Never `live`.
- The table is versioned as `livePatchContractVersion` and returned in the bootstrap response.

### Conformance test — the anti-drift mechanism

For every `live` property, a test must:

1. compile experience `A`,
2. apply the live mutation for the property change,
3. compile experience `B` (the same change made canonically),
4. assert the patched result equals the compiled result.

If a live mutation and the compiler ever disagree, this test fails in CI rather than a customer seeing a preview that lied.

---

## 9. New Endpoint — Editor Bootstrap

```http
GET /api/v1/projects/:projectId/editor-bootstrap
```

Returns, in one round trip, everything required to render a live editing session:

```text
project                 canonical draft Experience
revision
assets[]                snapshots with derivative references
mediaUrls               signed URLs with expiresAt
capabilities            resolved for this project, product language, with availability reasons
compileResult           manifest + viewerIntegration + diagnostics
schemaVersion
viewerIntegrationVersion
livePatchContractVersion
compilerVersion
editorPolicy            which tools are available, unavailable, or hidden, and why
```

Rationale: an editor currently needs project, capabilities, assets and preview-manifest as four sequential calls before it can draw a single pixel. That is the blank-screen problem, and it is a backend problem.

Access control, role checks and error envelope match existing project-scoped routes exactly. A caller with no access receives `404`, consistent with current behaviour.

---

## 10. New Endpoint — Batch Hotspot Mutation

```http
PATCH /api/v1/projects/:projectId/scenes/:sceneId/hotspots
```

Mirror the semantics already proven by `PATCH /api/v1/projects/:projectId/timeline`:

- requires `projectRevision` precondition,
- validates **every** entry before writing any row,
- writes atomically,
- a rejected batch leaves the scene and the project revision unchanged,
- bumps the project revision once for the whole batch.

Rationale: the timeline has an atomic multi-move route; scene hotspots do not. Without this, a multi-select drag either fires one request per hotspot against a revision counter that changes each time, or is not offered at all.

---

## 11. New Endpoint — Media Token Refresh

```http
POST /api/v1/media/tokens
```

Request: a list of derivative references the caller is already authorized to read.
Response: fresh signed URLs with `expiresAt`.

Rationale: preview media URLs expire. A long editing session must renew them without recompiling the experience or reloading the editor. Authorization is re-checked per derivative on every call; this route grants nothing the caller could not already fetch.

---

## 12. New Capability — Server Push Channel

```http
GET /api/v1/projects/:projectId/events
```

Server-Sent Events. One-way, server to client.

Minimum event types:

```text
asset.processing.progress
asset.ready
asset.failed
project.revision.changed
publication.completed
publication.failed
```

Requirements:

- authenticated and authorized identically to other project-scoped reads,
- periodic heartbeat to survive intermediate proxies,
- `Last-Event-ID` resume support,
- bounded per-connection and per-user connection limits,
- `project.revision.changed` carries the actor so a client can ignore its own writes.

**Additive only.** Every existing polling path must continue to work unchanged. A deployment behind a proxy that blocks streaming must degrade to polling without loss of function. SSE is an optimization, not a dependency.

---

## 13. Browser-Direct Access Policy

The frontend TRD routes CRUD through Next.js Server Actions, which are server-to-server calls. Three paths must still reach the backend **directly from the browser**:

```text
media derivative fetches      (signed URLs)
the SSE event channel
runtime telemetry ingest
```

Define and document, per route group:

- allowed origins (editor origin, player origin, and embed origins where policy permits),
- credential mode,
- which token is acceptable.

Introduce a short-lived, project-scoped **editor session token** for the browser-direct paths, so the creator's long-lived bearer token is never exposed to browser JavaScript. This mirrors the existing pattern where signed media URLs, not bearer tokens, are the capability handed to the player.

---

## 14. Publish Remains Server-Authoritative

Non-negotiable:

- Publish always recompiles server-side and stores its own result.
- A client may send the `contentHash` it computed locally. It is **advisory only** — used to detect drift, never trusted.
- A hash mismatch is logged as an operational alert with project, revision, `compilerVersion` and `livePatchContractVersion`, and the server's result wins silently.

A browser compiling a preview is a rendering convenience. It is never an authorization or integrity decision.

---

## 15. Tests

### Extraction safety
- All golden fixtures reproduce byte-for-byte.
- `compile()` called twice on identical input returns identical output and hash.
- `compile()` throws or fails lint if it touches database, network, filesystem, env, or clock.
- Dependency-boundary check fails when a package imports from an app.

### New endpoints
- Bootstrap returns a renderable payload for image360 and video360.
- Bootstrap respects viewer/editor/admin roles and returns `404` for no access.
- Batch hotspot update is atomic; one invalid entry rejects the whole batch.
- Batch update bumps the revision exactly once.
- Stale `projectRevision` returns `409 REVISION_CONFLICT`.
- Media token refresh re-checks authorization per derivative.
- Expired token is rejected.

### Push channel
- Events are delivered for processing progress, ready, failed.
- `project.revision.changed` fires on a concurrent edit.
- Resume with `Last-Event-ID` does not duplicate or drop events.
- Connection limits are enforced.
- Disabling SSE leaves all polling paths functional.

### Live-patch conformance
- Every `live` property passes patch-equals-recompile.
- An unclassified property defaults to `recompile`.

### Regression
- Full Sprint 01, 02, 03 and 04 suites pass unchanged.

---

## 16. Acceptance Criteria / Sprint Gate

- [x] Golden manifest fixtures exist and reproduce byte-for-byte after extraction.
- [x] `experience-compiler` is pure, deterministic, and has no runtime dependency on the API.
- [x] Compiler emits logical derivative references only; no signed URLs, no credentials.
- [x] Sanitization occurs at write time and is not dependent on the compiler.
- [x] `viewer-integration`, `capability-registry`, `experience-schema`, `live-patch` and `telemetry-contract` are separate packages.
- [x] Dependency boundaries are enforced in CI.
- [x] Live-patch classification table exists, is versioned, and every `live` property passes conformance.
- [x] `GET /editor-bootstrap` returns a complete renderable payload in one request.
- [x] `PATCH .../hotspots` batch route is atomic and revision-safe.
- [x] `POST /api/v1/media/tokens` refreshes expiring URLs without recompiling.
- [x] SSE channel delivers processing, revision and publication events.
- [x] All existing polling paths still work with SSE disabled.
- [x] Browser-direct access policy is documented and enforced for media, events and telemetry.
- [x] Publish recompiles server-side; client hash is advisory only and drift is logged.
- [x] No existing route path, request shape, response shape or error code changed.
- [x] Full Sprint 01–04 regression suites pass.

---

## 17. Execution Order

1. Capture golden manifest fixtures from the current code. Commit them before touching anything.
2. Introduce the workspace/package structure; move `apps/api` and `apps/worker` down one level. Confirm the full test suite still passes.
3. Extract `experience-schema`.
4. Extract `capability-registry`.
5. Extract `viewer-integration`.
6. Extract `experience-compiler` and make it pure. Re-run golden fixtures until byte-identical.
7. Add dependency-boundary enforcement to CI.
8. Verify sanitization happens at write time; move it if it does not.
9. Create `live-patch` classification table and conformance tests.
10. Extract `telemetry-contract` and point the ingest endpoint at it.
11. Implement `GET /editor-bootstrap`.
12. Implement batch hotspot mutation.
13. Implement media token refresh.
14. Implement the SSE channel with heartbeat, resume and limits.
15. Define and enforce the browser-direct access policy and editor session token.
16. Add advisory hash comparison and drift logging to publish.
17. Update `backend-api.md`, `backend-schema.md` and `runbook.md`.
18. Run lint, typecheck and the full Sprint 01–05 suites.

Steps 1 and 2 are the safety net. Do not reorder them.

---

## 18. Guardrails

- Do not change any Sprint 01–04 route path, payload, or error code.
- Do not let `packages/*` import from `apps/*`.
- Do not allow database, network, filesystem, environment, clock, or randomness inside the compiler.
- Do not emit signed URLs or credentials from the compiler.
- Do not make the compiler the only place sanitization happens.
- Do not let a client-supplied hash influence what is published.
- Do not make SSE a hard dependency; polling must keep working.
- Do not expose renderer, plugin, or adapter names in product-facing responses.
- Do not build a second compiler. If a feature seems to need one, the live-patch classification table is the answer, not a fork.
- Do not add editor or player application code in this sprint.

---

## 19. Notes Carried Into the Frontend Sprint

Recorded here so they are not lost, not to be implemented now:

- TanStack Query is the right owner of **server** state, but the live draft being edited is not server state. It needs a separate client store, or drag interactions will fight the query cache.
- Next.js Server Actions are fine for CRUD. Media, SSE and telemetry must go browser-direct — which is why §13 exists.
- Tool names in the frontend TRD such as "Virtual Tour Tool" and "Gallery Tool" echo renderer plugin names. PRD Appendix C asks for product language. Worth renaming before it reaches customers.
- The pinned renderer version and its documented plugin incompatibilities should be re-verified against current upstream documentation when the viewer-integration adapter is next revised, rather than carried forward from an earlier revision.

---

## 20. Execution Notes

Recorded after the sprint ran, for whoever reads this next.

**The event channel is in-process.** Delivery fans out to subscribers held by
the process that published the event. A multi-process deployment therefore needs
a shared fan-out before the channel is dependable across processes; until then,
run a single API process for editing traffic or leave the channel off. Because
the channel is an optimization and every fact it carries is also readable by
polling, this limits latency rather than function. The publisher API in
`project-events-service` is the seam a shared transport plugs into.

**The classification table earned its conformance suite immediately.** The first
draft classified `settings.autorotation` as live in full. The patch-equals-
recompile test failed: turning automatic rotation on or off resolves a
capability, which changes the manifest's capability list and runtime module
declarations. Only its speed, direction and start behaviour are live. That is
exactly the class of mistake the suite exists to catch, and it caught it before
any client was written against the wrong answer.

**Signed URL hydration is now one code path.** Removing the media URL resolver
from the compiler meant a draft preview and a private publication both get their
credentials from the same server-side hydration step, where previously preview
signed during compilation and publication signed on read.
