# Shared packages

The six `@alishaikh110/*` packages the frontend installs: what they are, how to
authenticate to the registry, what a version number means, how a release
happens, and how to iterate locally without publishing.

The backend consumes the same packages from `packages/*` through npm
workspaces. The frontend lives in a separate repository and consumes them from
the registry, which is why they are published at all.

---

## The set

| Package | What it is |
| --- | --- |
| `@alishaikh110/telemetry-contract` | Runtime event names and payload schemas. |
| `@alishaikh110/capability-registry` | Capability definitions, dependencies, incompatibilities, fallbacks. |
| `@alishaikh110/experience-schema` | Canonical types, validation, the compiled runtime contract, the compatibility check. |
| `@alishaikh110/viewer-integration` | Versioned adapters: manifest to renderer configuration. |
| `@alishaikh110/experience-compiler` | `compile()`: `CompilerInput` to `CompileResult`. |
| `@alishaikh110/live-patch` | The property classification table: `live`, `recompile`, `remount`. |

Sprint 05 extracted five. `capability-registry` is the sixth: `experience-schema`,
`viewer-integration` and `experience-compiler` all import it, so a release
without it would publish three packages that cannot resolve their own
dependency.

`experience-compiler` and `live-patch` are the two that matter most. A frontend
running an outdated copy of either shows a preview that diverges from what
publishes.

### Dependencies

The set is meant to carry no third-party runtime code. Two exceptions are
unavoidable without changing compiled output:

| Package | Dependency | Why it stays |
| --- | --- | --- |
| `experience-schema` | `sanitize-html` | Runs inside the compiler's output path. Removing it changes what every compiled manifest contains. |
| `telemetry-contract` | `zod` (**peer**) | The payload schemas are the wire contract; they are zod objects, and they cross the package boundary. |

Both are browser-safe and neither reaches a Node built-in. `zod` is a peer
rather than a dependency because two zod instances in one application produce
failures that are very hard to read; npm installs it for you.

The allowlist is exact and enforced. A seventh dependency fails
`npm run packages:check` and the CI job, in this repository, before it can reach
a release. Sprint 05's boundary tests still hold too: no package imports a Node
built-in, a server runtime, an application module, a clock or a random source.

---

## Installing them

### Registry

GitHub Packages, at `https://npm.pkg.github.com`, private.

Chosen because it needs no new vendor and reuses the repository permissions
that already exist. GitHub Packages requires the npm scope to equal the
repository owner, which is why the packages are scoped `@alishaikh110`.

### On a fresh machine

1. Create a personal access token (classic) at
   <https://github.com/settings/tokens> with the **`read:packages`** scope only.
   A token with `write:packages` on a developer machine can publish, and
   publishing from a developer machine is exactly what the release process
   exists to prevent.

2. Put the token in your environment, not in a file that git can see:

   ~~~powershell
   # PowerShell, current session
   $env:GITHUB_PACKAGES_TOKEN = 'ghp_...'
   ~~~

   ~~~bash
   # bash, add to your shell profile
   export GITHUB_PACKAGES_TOKEN=ghp_...
   ~~~

3. Add an `.npmrc` to the consuming repository, committed, with **no token in
   it**:

   ~~~ini
   @alishaikh110:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
   ~~~

   npm expands `${...}` from the environment at read time. The file is safe to
   commit; the token never is.

4. Install:

   ~~~bash
   npm install @alishaikh110/experience-compiler @alishaikh110/live-patch \
     @alishaikh110/experience-schema @alishaikh110/viewer-integration \
     @alishaikh110/capability-registry @alishaikh110/telemetry-contract
   ~~~

   Install all six. They are released together and the compatibility check
   refuses a partial or mixed set.

If `npm install` returns `401` or `404`, the token is missing, expired, or
lacks `read:packages`. A `404` on a private package means "not authorised",
not "not published".

### In the frontend's CI

`actions/setup-node` writes the `.npmrc` for you:

~~~yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm
    registry-url: https://npm.pkg.github.com
    scope: '@alishaikh110'

- run: npm ci
  env:
    NODE_AUTH_TOKEN: ${{ secrets.SPHERE_PACKAGES_READ_TOKEN }}
~~~

`secrets.GITHUB_TOKEN` only reaches packages owned by the same repository. For a
package published from `photo-sphere-backend` and installed by the frontend
repository, either:

- grant the frontend repository read access to each package
  (**Package settings -> Manage Actions access -> Add repository**, role
  `Read`), after which `secrets.GITHUB_TOKEN` works; or
- store a `read:packages` PAT as a repository secret, as above.

The first is better: no token to rotate.

---

## The compatibility check

Every package exports its own version at runtime:

~~~ts
import { EXPERIENCE_COMPILER_PACKAGE_VERSION } from '@alishaikh110/experience-compiler';
~~~

`GET /api/v1/projects/:projectId/editor-bootstrap` returns, under
`packageCompatibility`, the floor the deployed backend requires and the versions
it is itself running. Check it once, at startup, before anything renders:

~~~ts
import { assertSharedPackageCompatibility } from '@alishaikh110/experience-schema';

import { CAPABILITY_REGISTRY_PACKAGE_VERSION } from '@alishaikh110/capability-registry';
import { EXPERIENCE_COMPILER_PACKAGE_VERSION } from '@alishaikh110/experience-compiler';
import { EXPERIENCE_SCHEMA_PACKAGE_VERSION } from '@alishaikh110/experience-schema';
import { LIVE_PATCH_PACKAGE_VERSION } from '@alishaikh110/live-patch';
import { TELEMETRY_CONTRACT_PACKAGE_VERSION } from '@alishaikh110/telemetry-contract';
import { VIEWER_INTEGRATION_PACKAGE_VERSION } from '@alishaikh110/viewer-integration';

assertSharedPackageCompatibility(bootstrap.packageCompatibility, {
  '@alishaikh110/telemetry-contract': TELEMETRY_CONTRACT_PACKAGE_VERSION,
  '@alishaikh110/capability-registry': CAPABILITY_REGISTRY_PACKAGE_VERSION,
  '@alishaikh110/experience-schema': EXPERIENCE_SCHEMA_PACKAGE_VERSION,
  '@alishaikh110/viewer-integration': VIEWER_INTEGRATION_PACKAGE_VERSION,
  '@alishaikh110/experience-compiler': EXPERIENCE_COMPILER_PACKAGE_VERSION,
  '@alishaikh110/live-patch': LIVE_PATCH_PACKAGE_VERSION,
});
~~~

It throws `SharedPackageCompatibilityError` when the installed set is:

| Condition | Why it is refused |
| --- | --- |
| below `minimumCompatibleVersion` | An older classification table or compiler than this backend agrees with. |
| a major ahead of the backend | The same divergence reversed: the client's compiler is not the one that will publish. |
| missing a package | Nothing to compare, so nothing can be guaranteed. |
| not in lockstep with itself | A combination nobody has tested. |

The message names every problem and the `npm install` command that resolves it.
Use `checkSharedPackageCompatibility` instead when you want the report without
the throw.

This must fail loudly at startup. It must never degrade into a subtly wrong
preview: a client on an older `live-patch` table keeps applying mutations to the
running viewer that the compiler no longer agrees with, nothing errors, and the
creator is shown a preview that disagrees with what publishes.

---

## Version policy

Semantic versioning, **in lockstep**. All six packages always carry the same
version, and every sibling dependency is pinned to the exact version rather than
a range. Independent versions would let a resolver assemble a combination nobody
has tested, and the compiler and the classification table must never be
mismatched.

| Change | Level |
| --- | --- |
| Compiled output changes for any existing input | **major** |
| A property's live-patch classification changes | **major** |
| `schemaVersion` increments | **major** |
| A viewer integration version is retired | **major** |
| New optional field, new capability, new classified property | minor |
| Internal fix with byte-identical compiled output | patch |

**The two middle rows are the ones that get missed.** Neither changes a
signature, so neither looks like a breaking change in review.

A classification moving from `live` to `recompile` — the autorotation case
Sprint 05 found — is breaking for the frontend even though the API is
unchanged. A frontend that picks it up as a routine minor keeps mutating the
running viewer, its live mutations no longer match the table, and the preview
quietly diverges from what publishes. That is the failure this whole mechanism
exists to prevent. Publish it as a major, name it in the changelog, and raise
`MINIMUM_COMPATIBLE_PACKAGE_VERSION`.

Every release needs an entry in [`packages/CHANGELOG.md`](../packages/CHANGELOG.md)
naming any classification change explicitly. `npm run packages:check` fails
without one.

The release and rollback procedure is in
[runbook.md](runbook.md#shared-package-release).

---

## Local development against an unpublished build

Publishing on every compiler edit would make frontend work painful. Link
instead.

**This is a development-only mechanism.** A linked package must never reach a
build.

### Linking

Preferred, because it exercises the real tarball, `files` filtering included:

~~~bash
# in the backend repository
npm run build
npm run packages:pack            # writes .package-tarballs/

# in the frontend repository
npm install ../sphere-backend/.package-tarballs/alishaikh110-experience-compiler-1.0.0.tgz
~~~

`npm link` also works and is faster to iterate with, but it leaves no trace in
`package.json` or the lockfile, which is what makes forgetting it dangerous:

~~~bash
# in the backend repository
cd packages/experience-compiler && npm link

# in the frontend repository
npm link @alishaikh110/experience-compiler
~~~

Rebuild the backend packages (`npm run build`) after every source change; a link
points at `dist/`, not at the TypeScript.

### Unlinking

~~~bash
npm unlink --no-save @alishaikh110/experience-compiler
npm ci
~~~

### The guard

[`scripts/assert-no-linked-packages.mjs`](../scripts/assert-no-linked-packages.mjs)
detects all three ways a link happens: a local specifier in `package.json`, a
link or a `file:` resolution recorded in the lockfile, and a symlinked
`node_modules/@alishaikh110/*` left by `npm link`. Each leaves a different
trace, which is why it checks all three.

Copy it into the frontend repository and run it before every production build:

~~~yaml
- name: No linked shared packages
  run: node scripts/assert-no-linked-packages.mjs

- name: Build
  run: npm run build
~~~

Or inline, without copying anything:

~~~yaml
- name: No linked shared packages
  run: |
    node -e "
      const { execSync } = require('node:child_process');
      const lock = require('./package-lock.json');
      const linked = Object.entries(lock.packages ?? {}).filter(
        ([location, entry]) =>
          location.includes('node_modules/@alishaikh110/') &&
          (entry.link === true || String(entry.resolved ?? '').startsWith('file:'))
      );
      if (linked.length > 0) {
        console.error('Linked @alishaikh110 packages would reach this build:');
        for (const [location] of linked) console.error('  - ' + location);
        process.exit(1);
      }
    "
~~~

The guard is exercised in this repository's own suite against every linking
mechanism, and `npm run packages:verify` fires it against a real npm install
tree on the CI platform, so it is known to work rather than assumed to.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Declarations via `tsc -b`, then the publishable ESM and CommonJS bundles. |
| `npm run packages:check` | Metadata, lockstep, sibling pinning, dependency allowlist, generated version constants, changelog entry, and that nothing unpublishable sits in `dist/`. |
| `npm run packages:pack` | Writes the exact tarballs `npm publish` would upload to `.package-tarballs/`. |
| `npm run packages:verify` | Installs those tarballs into a project outside this repository and runs the ten gate checks. |
| `npm run packages:version -- <major\|minor\|patch\|x.y.z>` | Moves all six to one version, repoints every sibling pin, regenerates the runtime constants. |
| `npm run packages:sync-versions` | Regenerates the runtime version constants alone. |
| `npm run packages:publish -- --dry-run` | Runs every release gate and a publish dry run, without publishing. |

`packages:verify` is the one that matters. Inspecting `dist/` proves nothing:
the workspace resolves these packages by symlink and by tsconfig path, so every
mistake a second repository would hit is invisible here.
