# @alishaikh110/experience-schema

Canonical Experience types, validation, the compiled runtime contract, and the shared-package compatibility check.

Part of the shared package set released in lockstep by the
[Sphere backend](https://github.com/AliShaikh110/photo-sphere-backend). The six
packages always carry the same version; installing one at a different version
than the rest is unsupported and the compatibility check rejects it.

Also exports `assertSharedPackageCompatibility`, the startup gate a consumer
runs against the `packageCompatibility` block of `GET
/api/v1/projects/:projectId/editor-bootstrap`. Running an older package set
than the backend requires is a startup failure, never a silently divergent
preview.

## Install

Published privately to GitHub Packages. See
[docs/shared-packages.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/docs/shared-packages.md)
for registry authentication, the version policy and the startup compatibility
check every consumer must run.

```bash
npm install @alishaikh110/experience-schema
```

## Version

```ts
import { EXPERIENCE_SCHEMA_PACKAGE_NAME, EXPERIENCE_SCHEMA_PACKAGE_VERSION } from '@alishaikh110/experience-schema';
```

Changes are recorded in
[packages/CHANGELOG.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/packages/CHANGELOG.md).
