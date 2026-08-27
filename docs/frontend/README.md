# Frontend Documentation Index

These documents guide the implementation of the frontend for the No-Code 360°
Experience Platform. The backend is already implemented through backend Sprints
01–04; every contract referenced here was verified against the running backend
source, not only against its documentation.

## Read in this order

| # | Document | Purpose |
| --- | --- | --- |
| 1 | [../prd.md](../prd.md) | Product requirements. **Shared PRD — there is no separate frontend PRD.** |
| 2 | [../product_architecture.md](../product_architecture.md) | Product vision, UX direction, phase order. |
| 3 | [frontend_trd.md](frontend_trd.md) | **Frontend technical source of truth**: stack, layering rules, routing, state, forms. |
| 4 | [frontend-scope.md](frontend-scope.md) | Route map, screen inventory, flows, requirement traceability. |
| 5 | [frontend-api-integration.md](frontend-api-integration.md) | Transport architecture, revision/idempotency protocols, query keys, error mapping. |
| 6 | [frontend-viewer-runtime.md](frontend-viewer-runtime.md) | Manifest → Photo Sphere Viewer runtime, module registry, lifecycle, preload/cache, video. |
| 7 | [frontend-telemetry.md](frontend-telemetry.md) | Runtime event contract the creator analytics views depend on. |
| 8 | [frontend-ux-spec.md](frontend-ux-spec.md) | Editor shell behaviour, tool registry, interaction and state conventions. |
| 9 | [frontend-validation-report.md](frontend-validation-report.md) | Documentation conflicts, backend gaps and the assumptions taken. |
| 10 | [sprint/](sprint/) | Eight frontend sprint execution documents. |

## Backend contracts (authoritative, do not restate)

- [../backend-api.md](../backend-api.md) — HTTP contract, error codes, auth model.
- [../backend-schema.md](../backend-schema.md) — canonical Experience model and persistence.
- [../runbook.md](../runbook.md) — environment variables, deployment shape, `/view/:slug` routing.
- [../trd.md](../trd.md) — backend technical requirements.

## Non-duplication rule

These documents describe **only what the frontend must decide or build**. Where
a fact already exists in the PRD, product architecture, frontend TRD, backend
API or backend schema, it is referenced rather than copied. If a statement here
ever contradicts `backend-api.md` or the backend source, the backend wins and
the discrepancy belongs in
[frontend-validation-report.md](frontend-validation-report.md).

## Frontend application root

The frontend application lives in the sibling repository directory
`photo-sphere-execution/sphere-frontend`, which is currently empty. Frontend
Sprint 01 bootstraps it. These documents live in the backend repository because
they are derived from, and validated against, the backend contracts.
