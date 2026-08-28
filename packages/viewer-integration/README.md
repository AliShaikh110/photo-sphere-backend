# @alishaikh110/viewer-integration

Versioned adapters turning a compiled manifest into renderer configuration.

Part of the shared package set released in lockstep by the
[Sphere backend](https://github.com/AliShaikh110/photo-sphere-backend). The six
packages always carry the same version; installing one at a different version
than the rest is unsupported and the compatibility check rejects it.

Each adapter version is pinned to the renderer release it was written and
tested against. A publication keeps the version it was compiled with, so
retired entries stay meaningful long after they stop being selectable.

## Install

Published privately to GitHub Packages. See
[docs/shared-packages.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/docs/shared-packages.md)
for registry authentication, the version policy and the startup compatibility
check every consumer must run.

```bash
npm install @alishaikh110/viewer-integration
```

## Version

```ts
import { VIEWER_INTEGRATION_PACKAGE_NAME, VIEWER_INTEGRATION_PACKAGE_VERSION } from '@alishaikh110/viewer-integration';
```

Changes are recorded in
[packages/CHANGELOG.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/packages/CHANGELOG.md).
