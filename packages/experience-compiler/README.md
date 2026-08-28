# @alishaikh110/experience-compiler

The pure, deterministic Experience Compiler: `CompilerInput` in, `CompileResult` out.

Part of the shared package set released in lockstep by the
[Sphere backend](https://github.com/AliShaikh110/photo-sphere-backend). The six
packages always carry the same version; installing one at a different version
than the rest is unsupported and the compatibility check rejects it.

No clock, no randomness, no host environment, no Node built-in. The same input
compiles to the same bytes in a browser and on the server, which is what lets an
editor preview and a publish agree. Fifteen recorded golden fixtures gate every
release.

## Install

Published privately to GitHub Packages. See
[docs/shared-packages.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/docs/shared-packages.md)
for registry authentication, the version policy and the startup compatibility
check every consumer must run.

```bash
npm install @alishaikh110/experience-compiler
```

## Version

```ts
import { EXPERIENCE_COMPILER_PACKAGE_NAME, EXPERIENCE_COMPILER_PACKAGE_VERSION } from '@alishaikh110/experience-compiler';
```

Changes are recorded in
[packages/CHANGELOG.md](https://github.com/AliShaikh110/photo-sphere-backend/blob/main/packages/CHANGELOG.md).
