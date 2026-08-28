# Sprint 05B — Package Publishing & Versioning

> **Execution target:** Backend repository. Prerequisite for the Sprint 06 frontend programme.
> **Source basis:** Executed Sprints 01–05, Frontend TRD, `sprint-06-overview-and-shared-contracts.md`
> **Position:** Runs **before** Sprint 06A. The frontend repository cannot be created until this sprint's gate is met.
>
> **Context:** The frontend lives in a separate repository. The five shared packages extracted in Sprint 05 must therefore be consumable as published dependencies rather than local workspace imports.

---

## 1. Objective

Make the five shared packages installable from a second repository, with a version policy that prevents the frontend from silently running against a stale compiler or a stale live-patch table.

No product feature. No frontend code. This sprint exists so that Sprint 06A can begin.

---

## 2. The packages

```text
@platform/experience-schema        canonical types, validation, schemaVersion
@platform/experience-compiler      pure: CompilerInput -> CompileResult
@platform/viewer-integration       versioned adapters: manifest -> renderer config
@platform/live-patch               property classification table
@platform/telemetry-contract       event names and payload schemas
```

`experience-compiler` and `live-patch` are the two that matter most. If the frontend runs against an outdated copy of either, the preview will diverge from what publishes — the exact failure Sprint 05 was built to prevent.

---

## 3. In Scope

### Registry
- Publish to GitHub Packages under the organisation scope. It requires no new vendor and reuses existing repository permissions.
- Packages are private. Access is granted by token, not by making them public.
- Record the registry choice and the reason in the runbook.

### Package preparation
For each of the five packages:

- `name`, `version`, `publishConfig`, `repository`, `files`.
- Build to both ESM and CommonJS, or ESM only if the frontend can consume it. Next.js can; the API must be checked.
- Emit type declarations. A frontend without types on `compile()` is a downgrade from the monorepo arrangement and must not be accepted.
- `sideEffects: false` so the frontend bundler can tree-shake.
- Peer dependency policy stated. These packages should have no runtime dependencies at all; Sprint 05 already established that they use no Node built-ins.
- No source maps pointing at unpublished paths.

### Versioning policy
Semantic versioning, with the meaning of each level written down:

| Change | Level |
| --- | --- |
| Compiler output changes for any existing input | **major** |
| A property's live-patch classification changes | **major** |
| `schemaVersion` increments | **major** |
| A viewer integration version is retired | **major** |
| New optional field, new capability, new classified property | minor |
| Internal fix with byte-identical compiler output | patch |

The middle two rows are the ones that will be got wrong. A classification moving from `live` to `recompile` — the autorotation case found in Sprint 05 — is a **breaking change for the frontend**, even though nothing about the API changed. Treat it as major.

### Release process
- One command releases all five packages together at a common version.
- **Lockstep versioning.** The five move as a set. Independent versioning creates combinations nobody has tested, and the compiler and the classification table must never be mismatched.
- Publishing runs from CI on a tag, never from a developer machine.
- The golden manifest fixtures from Sprint 05 must pass before a publish proceeds.
- A changelog entry is required, naming any classification change explicitly.

### Consumer authentication
- A read-only token for the frontend repository's CI and for local development.
- `.npmrc` guidance for both, with the token supplied by environment variable and never committed.
- Document the exact steps a developer follows on a fresh machine.

### Staleness protection
This is the part that earns the sprint.

- Every package exports its own version at runtime.
- The `/editor-bootstrap` response already carries `schemaVersion`, `viewerIntegrationVersion`, `livePatchContractVersion` and `compilerVersion`. Sprint 06C checks them on entry.
- Extend that check: the backend returns the **minimum compatible package version** the frontend must be running, and the frontend refuses to start below it, with a message naming the version to install.
- A mismatch must fail loudly at startup. It must never degrade into a subtly wrong preview.

### Local development path
Publishing on every compiler edit would make Sprints 06C and 06D painful. Provide a documented linking path — `npm link`, `yalc`, or the equivalent for the chosen package manager — so a developer can point the frontend at a local build while iterating.

Document it clearly as a development-only mechanism, and add a CI check that a linked package can never reach a build.

---

## 4. Out of Scope

- Any frontend code.
- Any change to compiler, classification or adapter behaviour.
- Public npm publication.
- A private registry other than GitHub Packages.

---

## 5. Tests

- Each package builds, publishes to a test tag, and installs cleanly in a scratch project.
- Type declarations resolve; `compile()` is fully typed at the call site.
- Installed packages have zero runtime dependencies.
- The published `experience-compiler` reproduces the Sprint 05 golden fixtures byte-for-byte.
- Every package reports its own version at runtime.
- A frontend below the minimum compatible version fails at startup with an actionable message.
- Release fails when golden fixtures fail.
- Release fails when the changelog is missing.
- A linked local package cannot pass a production build check.

---

## 6. Gate

- [ ] All five packages are published and installable from a second repository.
- [ ] Types resolve fully in a consuming project.
- [ ] Published compiler reproduces the Sprint 05 golden fixtures byte-for-byte.
- [ ] Versioning policy is documented, including classification changes as major.
- [ ] Release is lockstep, CI-only, tag-triggered, and gated on the fixtures.
- [ ] Backend reports a minimum compatible package version and the contract is documented.
- [ ] Read-only consumer authentication is documented for CI and local development.
- [ ] Local linking path is documented and cannot reach a production build.
- [ ] Runbook updated with the release and rollback procedure.
- [ ] Sprint 01–05 suites still pass.

---

## 7. Execution order

1. Choose and configure the registry; document the decision.
2. Prepare the five packages: build outputs, types, metadata, tree-shaking.
3. Verify zero runtime dependencies.
4. Write the versioning policy into the runbook.
5. Build the lockstep release command.
6. Move publishing into CI, tag-triggered, gated on golden fixtures and changelog.
7. Add runtime version reporting to each package.
8. Add the minimum-compatible-version field to `/editor-bootstrap`.
9. Document consumer authentication for CI and local development.
10. Document the local linking path and add the build-time guard.
11. Publish `1.0.0` and verify installation in a scratch project.
12. Update the runbook; run the full suite.

---

## 8. Risks

**The one that costs you the sprint:** a classification change published as a minor version. The frontend picks it up on a routine install, its live mutations no longer match the table, and the preview quietly diverges from what publishes. Sprint 05 found exactly this class of change with autorotation. The policy exists for this case, and the minimum-version check is the backstop.

**Independent versioning.** Five packages drifting to different versions produces combinations nobody tested. Lockstep, always.

**Missing type declarations.** Easy to ship, and it turns `compile()` into an untyped call at the most important boundary in the system. Test it in a scratch project, not by inspection.

**Publishing from a laptop.** Bypasses the golden fixture gate. CI only.

**Linked packages reaching production.** A developer links locally during 06C, forgets, and a build ships against a local path. The guard is cheap; add it.

---

## 9. What changes for Sprint 06

Once this gate is met:

- Sprint 06A creates the frontend in **its own repository**, installing the five packages from the registry.
- Sprint 06C's contract version check becomes a real compatibility gate rather than an informational field.
- Everything else in the Sprint 06 programme is unchanged. Same six sprints, same gates, same order.
