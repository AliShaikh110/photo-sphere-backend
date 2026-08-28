# @alishaikh110/live-patch

The canonical property classification: `live`, `recompile` or `remount`.

Part of the shared package set released in lockstep by the
[Sphere backend](https://github.com/AliShaikh110/photo-sphere-backend). The six
packages always carry the same version; installing one at a different version
than the rest is unsupported and the compatibility check rejects it.

How a change to a canonical property reaches a running preview. A property that
is not listed is `recompile`; that default is deliberate and one-directional.
**A change to any property's classification is a major version**, because a
frontend on the older table applies mutations the compiler no longer agrees
with.

## Install

Published privately to GitHub Packages. See
[docs/shared-packages.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/docs/shared-packages.md)
for registry authentication, the version policy and the startup compatibility
check every consumer must run.

```bash
npm install @alishaikh110/live-patch
```

## Version

```ts
import { LIVE_PATCH_PACKAGE_NAME, LIVE_PATCH_PACKAGE_VERSION } from '@alishaikh110/live-patch';
```

Changes are recorded in
[packages/CHANGELOG.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/packages/CHANGELOG.md).
