# Shared package set — changelog

The six `@alishaikh110/*` packages are versioned and released together. One
entry per release covers all of them.

Every entry states its level and why. The rules are in
[docs/runbook.md](../docs/runbook.md#shared-package-versioning); the two that
get missed are that **a change to compiled output** and **a change to any
property's live-patch classification** are both **major**, even when no
signature changed.

A release without an entry here fails `npm run packages:check`.

---

## 1.0.0 — 2026-08-28

**major** — first published release.

The five packages Sprint 05 extracted, plus `capability-registry`, which the
other three import and which therefore has to be published alongside them.

- `@alishaikh110/telemetry-contract` — runtime event names and payload schemas.
  `zod` is a peer dependency.
- `@alishaikh110/capability-registry` — capability definitions, dependencies,
  incompatibilities and fallbacks.
- `@alishaikh110/experience-schema` — canonical types, validation,
  `CANONICAL_SCHEMA_VERSION = 1`, and the shared-package compatibility check.
- `@alishaikh110/viewer-integration` — versioned renderer adapters. Active
  version `psv-5.14.3-adapter-2`, pinned to Photo Sphere Viewer 5.14.3.
- `@alishaikh110/experience-compiler` — `compile()`, `COMPILER_VERSION =
  experience-compiler-1`.
- `@alishaikh110/live-patch` — the property classification table,
  `LIVE_PATCH_CONTRACT_VERSION = live-patch-1`.

### Classification changes

None. This is the first release; the table is the one recorded in Sprint 05,
including `settings.controls.autoRotate.enabled` as `live` via
`setAutoRotation` and `settings.controls.autoRotate.speed` as `recompile`.

### Compiled output

Frozen against the fifteen golden fixtures recorded before the compiler was
extracted from the backend. Reproduced byte for byte by the published
`experience-compiler`.

### Compatibility

Minimum compatible package version for a frontend: **1.0.0**, reported by
`GET /api/v1/projects/:projectId/editor-bootstrap` under `packageCompatibility`.
